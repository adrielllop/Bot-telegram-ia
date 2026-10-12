import test from 'node:test';
import assert from 'node:assert/strict';
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

test('webhook rejeita secret ausente ou inválido antes de tocar no banco', async () => {
  const previous = process.env.TELEGRAM_WEBHOOK_SECRET;
  process.env.TELEGRAM_WEBHOOK_SECRET = 'segredo-teste';
  try {
    const res = responseMock();
    await handler({ method: 'POST', headers: { 'x-telegram-bot-api-secret-token': 'errado' }, body: {} }, res);
    assert.equal(res.statusCode, 401);
  } finally {
    if (previous === undefined) delete process.env.TELEGRAM_WEBHOOK_SECRET;
    else process.env.TELEGRAM_WEBHOOK_SECRET = previous;
  }
});

test('webhook rejeita método não permitido', async () => {
  const res = responseMock();
  await handler({ method: 'DELETE', headers: {} }, res);
  assert.equal(res.statusCode, 405);
  assert.equal(res.headers.Allow, 'GET, POST');
});
