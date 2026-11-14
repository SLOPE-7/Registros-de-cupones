// Escudos de football-data.org, logos y banderas de Wikipedia (Wikimedia Commons) y banderas de flagcdn.
export function isExtraLogoSource(u) {
  if (u.protocol !== "https:") return false;
  if (u.hostname === "crests.football-data.org") return /^\/[\w.-]+\.(?:png|svg)$/i.test(u.pathname);
  if (u.hostname === "flagcdn.com") return /^\/w\d{2,4}\/[a-z]{2}(?:-[a-z]{2,3})?\.png$/i.test(u.pathname);
  if (u.hostname === "commons.wikimedia.org") return /^\/wiki\/Special:FilePath\/[^/]+$/.test(u.pathname);
  if (u.hostname === "upload.wikimedia.org") return /^\/wikipedia\/commons\//.test(u.pathname);
  return false;
}
export default async (request) => {
  const headers = {
    "cache-control": "public, max-age=31536000, immutable",
    "x-content-type-options": "nosniff",
  };
  if (request.method !== "GET") return new Response("Method not allowed", { status: 405, headers });
  let target;
  try {
    target = new URL(new URL(request.url).searchParams.get("url") || "");
  } catch {
    return new Response("Invalid image URL", { status: 400, headers });
  }
  const apiSports = /^media(?:-\d+)?\.api-sports\.io$/i.test(target.hostname);
  const theSportsDb = /^(?:r2|www)\.thesportsdb\.com$/i.test(target.hostname);
  const extra = isExtraLogoSource(target);
  const allowedHost = apiSports || theSportsDb || extra;
  const allowedPath = extra
    ? true
    : apiSports
      ? /^\/football\/(?:teams|leagues|players)\/\d+\.png$/i.test(target.pathname) ||
        /^\/flags\/[a-z]{2}\.svg$/i.test(target.pathname)
      : /^\/images\/media\/[a-z0-9/_-]+\.(?:png|jpe?g|webp)$/i.test(target.pathname);
  if (target.protocol !== "https:" || !allowedHost || !allowedPath)
    return new Response("Image source not allowed", { status: 400, headers });
  try {
    const upstream = await fetch(target, {
      signal: AbortSignal.timeout(10000),
      headers: { "user-agent": "KAL-Cupones/1.0 (app personal de seguimiento de apuestas)" },
    });
    if (!upstream.ok)
      return new Response("Logo not found", { status: upstream.status === 404 ? 404 : 502, headers });
    const contentType = upstream.headers.get("content-type") || "image/png";
    const size = Number(upstream.headers.get("content-length") || 0);
    if (!contentType.startsWith("image/") || size > 2000000)
      return new Response("Invalid image", { status: 502, headers });
    headers["content-type"] = contentType;
    // Un SVG se muestra como imagen; si alguien lo abre directamente, no puede ejecutar nada.
    headers["content-security-policy"] = "default-src 'none'; style-src 'unsafe-inline'; sandbox";
    return new Response(upstream.body, { status: 200, headers });
  } catch {
    return new Response("Could not load image", { status: 502, headers });
  }
};
