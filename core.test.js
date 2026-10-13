import test from 'node:test';
import assert from 'node:assert/strict';
import {
  ADMIN_ID, DURATIONS, activateKey, activationTransactionValue, durationOfKey, formatRemaining, isAdmin, licenseStatus,
  pauseKey, remainingMs, resetKey, resumeKey, validKeyFormat, validManualId, validTelegramId
} from './core.js';

test('as dez durações especificadas são preservadas', () => {
  assert.equal(Object.keys(DURATIONS).length, 10);
  assert.deepEqual(Object.values(DURATIONS).map(x => x.label), ['1 HORA','6 HORAS','1 DIA','3 DIAS','7 DIAS','10 DIAS','15 DIAS','30 DIAS','60 DIAS','90 DIAS']);
});

test('Keys novas de 6 dígitos e antigas de 16 continuam válidas', () => {
  assert.equal(validKeyFormat('005349'), true);
  assert.equal(validKeyFormat('7836491058273640'), true);
  assert.equal(validKeyFormat('783649105827364'), false);
  assert.equal(validKeyFormat('12345'), false);
  assert.equal(validKeyFormat('1234567'), false);
  assert.equal(validKeyFormat('783649105827364x'), false);
});

test('ID numérico do Telegram é validado sem confundir com Key', () => {
  assert.equal(validTelegramId('1234567890'), true);
  assert.equal(validTelegramId('12345'), true);
  assert.equal(validTelegramId('1234'), false);
  assert.equal(validTelegramId('a12345678'), false);
});

test('confirmação manual precisa coincidir com ID real', () => {
  assert.equal(validManualId('8646015281', '8646015281'), true);
  assert.equal(validManualId('8646015282', '8646015281'), false);
  assert.equal(validManualId('abc', '8646015281'), false);
});

test('somente o ID configurado entra como admin', () => {
  assert.equal(ADMIN_ID, '8646015281');
  assert.equal(isAdmin(8646015281), true);
  assert.equal(isAdmin('1'), false);
});

test('ativação parte de disponível e define vencimento pelo instante de ativação', () => {
  const now = 1_800_000_000_000;
  const key = { status: 'available', durationMs: 3600000 };
  const active = activateKey(key, { id: 42, username: 'mestre' }, now);
  assert.equal(active.status, 'active');
  assert.equal(active.userId, '42');
  assert.equal(active.activatedAt, now);
  assert.equal(active.expiresAt, now + 3600000);
  assert.equal(activateKey(active, { id: 43 }, now), null);
});

test('pausar congela o restante e retomar continua exatamente desse ponto', () => {
  const active = { status: 'active', expiresAt: 500000, durationMs: 1000000 };
  const paused = pauseKey(active, 200000);
  assert.equal(paused.status, 'paused');
  assert.equal(paused.remainingMs, 300000);
  assert.equal(remainingMs(paused, 400000), 300000);
  const resumed = resumeKey(paused, 900000);
  assert.equal(resumed.status, 'active');
  assert.equal(resumed.expiresAt, 1200000);
  assert.equal(licenseStatus(resumed, 1199999), 'active');
  assert.equal(licenseStatus(resumed, 1200000), 'expired');
});

test('reset remove o vínculo e disponibiliza a Key novamente', () => {
  const result = resetKey({ status: 'active', userId: '123', expiresAt: 100, durationMs: 999 }, 50);
  assert.equal(result.status, 'available');
  assert.equal(result.userId, null);
  assert.equal(result.activatedAt, null);
});

test('licença pausada, expirada e revogada não dá acesso', () => {
  assert.equal(licenseStatus({ status: 'paused', remainingMs: 100 }), 'paused');
  assert.equal(licenseStatus({ status: 'active', expiresAt: 10 }, 10), 'expired');
  assert.equal(licenseStatus({ status: 'revoked' }, 0), 'revoked');
});

test('formatação do tempo restante é legível', () => {
  assert.equal(formatRemaining(0), '0s');
  assert.equal(formatRemaining(90_000), '1min');
  assert.equal(formatRemaining(90_000_000), '1d 1h');
});


test('primeira leitura vazia do Firebase nao aborta a transacao', () => {
  const user = { id: 9876543210 };
  const first = activationTransactionValue(null, user, 1000);
  assert.equal(first, null);
  const second = activationTransactionValue({ status: 'available', durationId: '1h' }, user, 1000);
  assert.equal(second.status, 'active');
  assert.equal(second.expiresAt, 1000 + 60 * 60 * 1000);
  assert.equal(second.userId, '9876543210');
  assert.equal(activationTransactionValue({ status: 'active', userId: 'outro' }, user), undefined);
});

test('licenca antiga que so tem durationId recebe duracao correta', () => {
  assert.equal(durationOfKey({ durationId: '7d' }), DURATIONS['7d'].ms);
  assert.equal(durationOfKey({ durationLabel: '1 HORA' }), DURATIONS['1h'].ms);
  assert.equal(durationOfKey({ durationMs: 2000 }), 2000);
  assert.equal(durationOfKey({}), 0);
  assert.equal(activateKey({ status: 'available' }, { id: 1 }), null);
});
