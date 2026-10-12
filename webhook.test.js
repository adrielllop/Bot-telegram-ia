import test from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import handler from './telegram.js';

function responseMock() {
  return {
    statusCode: 200, headers: {}, payload: null,
    status(code) { this.statusCode = code; return this; },
    setHeader(name, value) { this.headers[name] = value; },
    json(value) { this.payload = value; return this; }
  };
}

test('health check GET não requer credenciais', async () => {
  const res = responseMock();
  await handler({ method: 'GET', headers: {} }, res);
  assert.equal(res.statusCode, 200);
  assert.equal(res.payload.status, 'ready');
});

test('webhook rejeita secret inválido antes de tocar no banco', async () => {
  const previous = process.env.TELEGRAM_BOT_TOKEN;
  process.env.TELEGRAM_BOT_TOKEN = 'token-de-teste';
  try {
    const res = responseMock();
    await handler({ method: 'POST', headers: { 'x-telegram-bot-api-secret-token': 'errado' }, body: {} }, res);
    assert.equal(res.statusCode, 401);
  } finally {
    if (previous === undefined) delete process.env.TELEGRAM_BOT_TOKEN;
    else process.env.TELEGRAM_BOT_TOKEN = previous;
  }
});

test('webhook aceita o segredo derivado do token e segue para verificar Firebase', async () => {
  const previous = Object.fromEntries(['TELEGRAM_BOT_TOKEN','FIREBASE_DATABASE_URL','FIREBASE_SERVICE_ACCOUNT_JSON','FIREBASE_SERVICE_ACCOUNT_BASE64'].map(key => [key, process.env[key]]));
  process.env.TELEGRAM_BOT_TOKEN = 'token-de-teste';
  for (const key of ['FIREBASE_DATABASE_URL','FIREBASE_SERVICE_ACCOUNT_JSON','FIREBASE_SERVICE_ACCOUNT_BASE64']) delete process.env[key];
  try {
    const secret = createHmac('sha256', process.env.TELEGRAM_BOT_TOKEN).update('MestreXit.ia:webhook-secret:v1').digest('hex');
    const res = responseMock();
    await handler({ method: 'POST', headers: { 'x-telegram-bot-api-secret-token': secret }, body: { update_id: 123 } }, res);
    assert.equal(res.statusCode, 503);
    assert.equal(res.payload.error, 'Service not configured');
  } finally {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
});

test('webhook rejeita método não permitido', async () => {
  const res = responseMock();
  await handler({ method: 'DELETE', headers: {} }, res);
  assert.equal(res.statusCode, 405);
  assert.equal(res.headers.Allow, 'GET, POST');
});
