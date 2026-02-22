import { APPS_SCRIPT_URL } from '../shared/app-config.js';

const setCorsHeaders = (res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
};

export default async function handler(req, res) {
  setCorsHeaders(res);

  if (req.method === 'OPTIONS') {
    return res.status(204).end();
  }

  if (!APPS_SCRIPT_URL) {
    return res.status(500).json({ ok: false, error: 'APPS_SCRIPT_URL is not configured' });
  }

  try {
    const upstreamUrl =
      req.method === 'GET' && req.url?.includes('?')
        ? `${APPS_SCRIPT_URL}${req.url.slice(req.url.indexOf('?'))}`
        : APPS_SCRIPT_URL;

    let body;
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      body = typeof req.body === 'string' ? req.body : JSON.stringify(req.body || {});
    }

    const upstream = await fetch(upstreamUrl, {
      method: req.method,
      headers: {
        'Content-Type': req.headers['content-type'] || 'text/plain;charset=utf-8',
      },
      body,
      redirect: 'follow',
    });

    const text = await upstream.text();
    const contentType = upstream.headers.get('content-type') || 'text/plain; charset=utf-8';

    res.status(upstream.status);
    res.setHeader('Content-Type', contentType);
    return res.send(text);
  } catch (error) {
    return res.status(502).json({
      ok: false,
      error: 'Proxy request failed',
      message: error?.message || String(error),
    });
  }
}
