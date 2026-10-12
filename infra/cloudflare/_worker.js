// Cloudflare Pages Functions advanced mode. Static assets bypass this Worker
// through _routes.json. Return WebSocket upgrade responses without buffering.
export function isProxyPath(pathname) {
  return pathname === '/api' || pathname.startsWith('/api/') ||
    pathname === '/engine' || pathname.startsWith('/engine/');
}

export async function proxy(request, env, fetcher = fetch) {
  const browserUrl = new URL(request.url);
  if (!isProxyPath(browserUrl.pathname)) return env.ASSETS.fetch(request);
  if (!env.API_ORIGIN || !env.PUBLIC_ORIGIN || !env.SKRIBBIL_ORIGIN_KEY || env.SKRIBBIL_ORIGIN_KEY.length < 32) {
    return new Response('Skribbil backend is not configured.', { status: 503 });
  }
  let origin;
  try {
    origin = new URL(env.API_ORIGIN);
    if (origin.protocol !== 'https:' || origin.username || origin.password ||
      origin.pathname !== '/' || origin.search || origin.hash ||
      new URL(env.PUBLIC_ORIGIN).origin !== browserUrl.origin) {
      return new Response('Invalid proxy configuration or public origin.', { status: 503 });
    }
  } catch {
    return new Response('Invalid proxy configuration.', { status: 503 });
  }

  let decodedPath;
  try { decodedPath = decodeURIComponent(browserUrl.pathname); }
  catch { return new Response('Invalid path.', { status: 400 }); }
  if (decodedPath.startsWith('/api/internal/') || decodedPath.startsWith('/engine/internal/')) {
    return new Response('Not found.', { status: 404 });
  }
  const target = new URL(origin);
  target.pathname = browserUrl.pathname;
  target.search = browserUrl.search;
  const headers = new Headers(request.headers);
  headers.delete('host');
  headers.delete('forwarded');
  headers.delete('x-forwarded-for');
  headers.delete('x-forwarded-host');
  headers.delete('x-forwarded-proto');
  headers.set('X-Skribbil-Origin-Key', env.SKRIBBIL_ORIGIN_KEY);
  headers.set('X-Forwarded-Host', browserUrl.host);
  headers.set('X-Forwarded-Proto', 'https');
  // CF-Connecting-IP is populated by Cloudflare; never trust a browser's XFF.
  const clientAddress = request.headers.get('CF-Connecting-IP');
  if (clientAddress) headers.set('X-Forwarded-For', clientAddress);
  const upstreamRequest = new Request(target, request);
  const outgoing = new Request(upstreamRequest, { headers, redirect: 'manual' });
  let response;
  try { response = await fetcher(outgoing); }
  catch {
    return new Response('The game server is waking up or unavailable. Try again shortly.', {
      status: 503, headers: { 'Cache-Control': 'no-store', 'Retry-After': '60' },
    });
  }
  if (response.status === 101) return response;
  const result = new Response(response.body, response);
  result.headers.set('Cache-Control', 'no-store');
  const location = result.headers.get('Location');
  if (location) {
    const redirect = new URL(location, target);
    if (redirect.origin === origin.origin) {
      redirect.protocol = browserUrl.protocol;
      redirect.host = browserUrl.host;
      result.headers.set('Location', redirect.toString());
    }
  }
  return result;
}

export default {
  fetch(request, env) { return proxy(request, env); },
};
