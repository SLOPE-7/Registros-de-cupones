// Notificaciones push (Web Push) solo con WebCrypto, para que funcione en Cloudflare Workers sin librerías de Node.
// Implementa:
//   - Claves VAPID (P-256) y su firma ES256 (RFC 8292).
//   - Cifrado del mensaje "aes128gcm" (RFC 8291 + RFC 8188), el que piden Apple, Google y Mozilla.
const enc = new TextEncoder();

export function b64u(bytes) {
  let s = "";
  for (const b of new Uint8Array(bytes)) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
export function unb64u(str) {
  const s = String(str).replace(/-/g, "+").replace(/_/g, "/");
  const bin = atob(s + "=".repeat((4 - (s.length % 4)) % 4));
  return Uint8Array.from(bin, (c) => c.charCodeAt(0));
}
const concat = (...parts) => {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let i = 0;
  for (const p of parts) {
    out.set(p, i);
    i += p.length;
  }
  return out;
};
async function hmac(key, data) {
  const k = await crypto.subtle.importKey("raw", key, { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return new Uint8Array(await crypto.subtle.sign("HMAC", k, data));
}
// HKDF de un solo bloque (todas las longitudes que pide el estándar son ≤ 32 bytes).
async function hkdf(salt, ikm, info, length) {
  const prk = await hmac(salt, ikm);
  return (await hmac(prk, concat(info, new Uint8Array([1])))).slice(0, length);
}

// Claves VAPID en el mismo formato que la librería web-push: pública sin comprimir (65 bytes) y privada "d" (32 bytes).
export async function generateVapidKeys() {
  const pair = await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, [
    "sign",
    "verify",
  ]);
  const jwk = await crypto.subtle.exportKey("jwk", pair.privateKey);
  const pub = concat(new Uint8Array([4]), unb64u(jwk.x), unb64u(jwk.y));
  return { publicKey: b64u(pub), privateKey: jwk.d };
}
function vapidSigningKey({ publicKey, privateKey }) {
  const pub = unb64u(publicKey);
  const jwk = {
    kty: "EC",
    crv: "P-256",
    x: b64u(pub.slice(1, 33)),
    y: b64u(pub.slice(33, 65)),
    d: privateKey,
    ext: true,
  };
  return crypto.subtle.importKey("jwk", jwk, { name: "ECDSA", namedCurve: "P-256" }, false, ["sign"]);
}
// Cabecera Authorization firmada para el servicio de push del teléfono (válida 12 horas).
export async function vapidAuthorization(endpoint, keys, subject, now = Date.now()) {
  const header = b64u(enc.encode(JSON.stringify({ typ: "JWT", alg: "ES256" })));
  const claims = b64u(
    enc.encode(
      JSON.stringify({
        aud: new URL(endpoint).origin,
        exp: Math.floor(now / 1000) + 12 * 3600,
        sub: subject,
      }),
    ),
  );
  const unsigned = header + "." + claims;
  const sig = await crypto.subtle.sign(
    { name: "ECDSA", hash: "SHA-256" },
    await vapidSigningKey(keys),
    enc.encode(unsigned),
  );
  return "vapid t=" + unsigned + "." + b64u(sig) + ", k=" + keys.publicKey;
}

// Cifra el mensaje para un teléfono (p256dh y auth vienen de su suscripción). Devuelve el cuerpo listo para enviar.
export async function encryptPayload(subscription, text) {
  const uaPublic = unb64u(subscription.keys.p256dh);
  const authSecret = unb64u(subscription.keys.auth);
  const local = await crypto.subtle.generateKey({ name: "ECDH", namedCurve: "P-256" }, true, ["deriveBits"]);
  const asPublic = new Uint8Array(await crypto.subtle.exportKey("raw", local.publicKey));
  const uaKey = await crypto.subtle.importKey(
    "raw",
    uaPublic,
    { name: "ECDH", namedCurve: "P-256" },
    false,
    [],
  );
  const ecdhSecret = new Uint8Array(
    await crypto.subtle.deriveBits({ name: "ECDH", public: uaKey }, local.privateKey, 256),
  );
  const ikm = await hkdf(
    authSecret,
    ecdhSecret,
    concat(enc.encode("WebPush: info\0"), uaPublic, asPublic),
    32,
  );
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const cek = await hkdf(salt, ikm, enc.encode("Content-Encoding: aes128gcm\0"), 16);
  const nonce = await hkdf(salt, ikm, enc.encode("Content-Encoding: nonce\0"), 12);
  const aes = await crypto.subtle.importKey("raw", cek, "AES-GCM", false, ["encrypt"]);
  // Un solo registro: el texto y el delimitador final 0x02.
  const plain = concat(enc.encode(text), new Uint8Array([2]));
  const cipher = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv: nonce }, aes, plain));
  const rs = new Uint8Array([0, 0, 16, 0]); // tamaño de registro 4096
  return concat(salt, rs, new Uint8Array([asPublic.length]), asPublic, cipher);
}

// Envía una notificación. Devuelve "ok", "gone" (el teléfono ya no la acepta: borrar suscripción) o "error".
export async function sendWebPush(subscription, payload, { keys, subject, ttl = 1800, urgency = "high" }) {
  try {
    const body = await encryptPayload(subscription, JSON.stringify(payload));
    const r = await fetch(subscription.endpoint, {
      method: "POST",
      headers: {
        Authorization: await vapidAuthorization(subscription.endpoint, keys, subject),
        "Content-Encoding": "aes128gcm",
        "Content-Type": "application/octet-stream",
        TTL: String(ttl),
        Urgency: urgency,
      },
      body,
    });
    if (r.status === 404 || r.status === 410) return "gone";
    return r.ok ? "ok" : "error";
  } catch {
    return "error";
  }
}
