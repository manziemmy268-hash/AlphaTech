// Cloudflare Pages Function: proxies /api/*, /pay, /status/* to the backend server
export async function onRequest(context) {
  const { request, env } = context;
  const url = new URL(request.url);

  // Backend URL from environment variable, with fallback
  const backend = env.BACKEND_URL || 'http://localhost:3000';
  const target = `${backend}${url.pathname}${url.search}`;

  const headers = new Headers(request.headers);

  const init = {
    method: request.method,
    headers,
  };

  if (!['GET', 'HEAD'].includes(request.method)) {
    init.body = request.body;
  }

  try {
    const response = await fetch(target, init);
    return new Response(response.body, {
      status: response.status,
      statusText: response.statusText,
      headers: response.headers,
    });
  } catch (err) {
    return new Response(
      JSON.stringify({ error: 'Backend unreachable', detail: err.message }),
      { status: 502, headers: { 'Content-Type': 'application/json' } },
    );
  }
}
