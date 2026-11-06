import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import request from 'supertest';
import { upstoxLoginUrl } from '../src/services/upstoxAuth.js';
import { upstoxRoutes } from '../src/routes/upstox.js';
import { UpstoxProvider } from '../src/market/providers/upstox/UpstoxProvider.js';
import { authRoutes } from '../src/routes/auth.js';
import { errorHandler } from '../src/middleware/errorHandler.js';

test('Upstox login URL includes the exact callback and one-time OAuth state', () => {
  const url = new URL(upstoxLoginUrl({ apiKey: 'client-key', redirectUri: 'https://callback.example/upstox/callback' }, 'random-state'));
  assert.equal(url.origin, 'https://api.upstox.com');
  assert.equal(url.searchParams.get('client_id'), 'client-key');
  assert.equal(url.searchParams.get('redirect_uri'), 'https://callback.example/upstox/callback');
  assert.equal(url.searchParams.get('response_type'), 'code');
  assert.equal(url.searchParams.get('state'), 'random-state');
});

test('session start returns a state-protected URL and rejects unsolicited callbacks', async () => {
  const config = {
    upstox: { apiKey: 'client-key', apiSecret: 'client-secret', redirectUri: 'https://callback.example/upstox/callback' },
    clientOrigin: ['https://trading.example'],
  };
  const market = { provider: { name: 'upstox' }, status: () => ({ feed: { provider: 'upstox', connected: false } }) };
  const routes = upstoxRoutes({ config, market });
  const app = express();
  app.use('/api/upstox', routes.api);
  app.use('/upstox', routes.callback);

  const started = await request(app).post('/api/upstox/session').expect(200);
  assert.ok(new URL(started.body.url).searchParams.get('state')?.length >= 32);
  await request(app).get('/upstox/callback?code=untrusted').expect(400);
});

test('replacing the daily token makes the provider resubscribe on reconnect', () => {
  const provider = new UpstoxProvider({ accessToken: 'old' });
  provider.subscribed.add('NSE_EQ|old-subscription');
  provider.setAccessToken('new');
  assert.equal(provider.accessToken, 'new');
  assert.equal(provider.subscribed.size, 0);
});

test('production registration can be disabled while login remains available', async () => {
  const config = { nodeEnv: 'test', allowRegistration: false, jwtSecret: 'test-secret-that-is-long-enough-for-hs256-signing', jwtExpiresIn: '1h', startingBalance: 100000 };
  const app = express();
  app.use(express.json());
  app.use('/api/auth', authRoutes(config));
  app.use(errorHandler);

  assert.equal((await request(app).get('/api/auth/config').expect(200)).body.registrationEnabled, false);
  const result = await request(app).post('/api/auth/register').send({ name: 'Blocked', email: 'blocked@example.com', password: 'password123' }).expect(403);
  assert.equal(result.body.error.code, 'REGISTRATION_DISABLED');
});
