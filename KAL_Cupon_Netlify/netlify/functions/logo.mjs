export default async (request) => {
  const headers = { "cache-control": "public, max-age=31536000, immutable", "x-content-type-options": "nosniff" };
  if (request.method !== "GET") return new Response("Method not allowed", { status: 405, headers });
  let target;
  try { target = new URL(new URL(request.url).searchParams.get("url") || ""); }
  catch { return new Response("Invalid image URL", { status: 400, headers }); }
  const allowedHost = /^media(?:-\d+)?\.api-sports\.io$/i.test(target.hostname);
  const allowedPath = /^\/football\/(?:teams|leagues|players)\/\d+\.png$/i.test(target.pathname) || /^\/flags\/[a-z]{2}\.svg$/i.test(target.pathname);
  if (target.protocol !== "https:" || !allowedHost || !allowedPath) return new Response("Image source not allowed", { status: 400, headers });
  try {
    const upstream = await fetch(target, { signal: AbortSignal.timeout(10000) });
    if (!upstream.ok) return new Response("Logo not found", { status: upstream.status === 404 ? 404 : 502, headers });
    const contentType = upstream.headers.get("content-type") || "image/png";
    const size = Number(upstream.headers.get("content-length") || 0);
    if (!contentType.startsWith("image/") || size > 2000000) return new Response("Invalid image", { status: 502, headers });
    headers["content-type"] = contentType;
    return new Response(upstream.body, { status: 200, headers });
  } catch {
    return new Response("Could not load image", { status: 502, headers });
  }
};
