import { randomBytes } from 'node:crypto';
import { Router } from 'express';
import path from 'node:path';
import { upstoxLoginUrl, exchangeUpstoxCode, setEnvValue } from '../services/upstoxAuth.js';
import { logger } from '../utils/logger.js';

const page = (title, body) => `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${title}</title><style>body{font-family:system-ui,sans-serif;background:#0b0f17;color:#e6ebf5;display:grid;place-items:center;min-height:100vh;margin:0;padding:16px}
main{max-width:420px;text-align:center}a{color:#3b82f6}</style></head><body><main>${body}</main></body></html>`;

const LOOPBACK = new Set(['127.0.0.1', '::1', '::ffff:127.0.0.1']);
const STATE_TTL_MS = 10 * 60 * 1000;
const clean = (value) => String(value || '').replace(/[<>&]/g, '');

/** Retained for local-only utilities and its security regression test. */
export function loopbackOnly(req, res, next) {
  if (LOOPBACK.has(req.socket?.remoteAddress)) return next();
  res.status(403).send(page('Not allowed', '<h2>This page can only be opened on the server itself.</h2>'));
}

/**
 * Production-safe Upstox OAuth flow. Starting a session requires an app login;
 * the public callback accepts only a short-lived, one-time OAuth state value.
 */
export function upstoxRoutes({ config, market }) {
  const api = Router();
  const callback = Router();
  const creds = config.upstox || {};
  const states = new Map();

  const configured = () => Boolean(creds.apiKey && creds.apiSecret && creds.redirectUri);
  const prune = () => {
    const now = Date.now();
    for (const [state, expires] of states) if (expires <= now) states.delete(state);
  };

  api.get('/status', (_req, res) => {
    const feed = market.status().feed;
    res.json({ configured: configured(), connected: feed.provider === 'upstox' && feed.connected, redirectUri: creds.redirectUri || null });
  });

  api.post('/session', (_req, res) => {
    if (market.provider.name !== 'upstox') return res.status(400).json({ error: { code: 'WRONG_PROVIDER', message: 'Upstox is not the selected market-data provider' } });
    if (!configured()) return res.status(400).json({ error: { code: 'UPSTOX_NOT_CONFIGURED', message: 'Upstox API key, secret and redirect URL are not configured' } });
    prune();
    const state = randomBytes(32).toString('base64url');
    states.set(state, Date.now() + STATE_TTL_MS);
    res.json({ url: upstoxLoginUrl(creds, state) });
  });

  callback.get('/callback', async (req, res) => {
    prune();
    const state = typeof req.query.state === 'string' ? req.query.state : '';
    const code = typeof req.query.code === 'string' ? req.query.code : '';
    if (!state || !states.has(state)) return res.status(400).send(page('Upstox login', '<h2>Invalid or expired login request.</h2><p>Return to Account and start again.</p>'));
    states.delete(state);
    if (!code) return res.status(400).send(page('Upstox login', '<h2>Upstox did not return an authorization code.</h2><p>Return to Account and try again.</p>'));
    try {
      const token = await exchangeUpstoxCode(code, creds);
      await setEnvValue(path.resolve('.env'), 'UPSTOX_ACCESS_TOKEN', token);
      market.provider.setAccessToken(token);
      await market.stop().catch(() => {});
      await market.start();
      if (market.contracts?.size) await market.provider.subscribe([...market.contracts.keys()]);
      logger.info('Upstox access token saved and live market feed connected');
      res.send(page('Upstox connected', `<h2>Upstox connected</h2><p>Live market data is ready. The app remains paper trading.</p><p><a href="${clean(config.clientOrigin[0])}">Return to the app</a></p>`));
    } catch (err) {
      logger.error(err.message);
      res.status(502).send(page('Upstox login failed', `<h2>Login failed</h2><p>${clean(err.message)}</p><p>Return to Account and try again.</p>`));
    }
  });

  return { api, callback };
}
