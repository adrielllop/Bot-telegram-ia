export const ADMIN_ID = '8646015281';
export const DURATIONS = Object.freeze({
  '30m': { label: '30 MINUTOS', ms: 30 * 60 * 1000 },
  '1h': { label: '1 HORA', ms: 60 * 60 * 1000 },
  '2h': { label: '2 HORAS', ms: 2 * 60 * 60 * 1000 },
  '3h': { label: '3 HORAS', ms: 3 * 60 * 60 * 1000 },
  '4h': { label: '4 HORAS', ms: 4 * 60 * 60 * 1000 },
  '8h': { label: '8 HORAS', ms: 8 * 60 * 60 * 1000 },
  '12h': { label: '12 HORAS', ms: 12 * 60 * 60 * 1000 },
  '6h': { label: '6 HORAS', ms: 6 * 60 * 60 * 1000 },
  '1d': { label: '1 DIA', ms: 24 * 60 * 60 * 1000 },
  '2d': { label: '2 DIAS', ms: 2 * 24 * 60 * 60 * 1000 },
  '3d': { label: '3 DIAS', ms: 3 * 24 * 60 * 60 * 1000 },
  '5d': { label: '5 DIAS', ms: 5 * 24 * 60 * 60 * 1000 },
  '7d': { label: '7 DIAS', ms: 7 * 24 * 60 * 60 * 1000 },
  '10d': { label: '10 DIAS', ms: 10 * 24 * 60 * 60 * 1000 },
  '14d': { label: '14 DIAS', ms: 14 * 24 * 60 * 60 * 1000 },
  '15d': { label: '15 DIAS', ms: 15 * 24 * 60 * 60 * 1000 },
  '20d': { label: '20 DIAS', ms: 20 * 24 * 60 * 60 * 1000 },
  '30d': { label: '30 DIAS', ms: 30 * 24 * 60 * 60 * 1000 },
  '45d': { label: '45 DIAS', ms: 45 * 24 * 60 * 60 * 1000 },
  '60d': { label: '60 DIAS', ms: 60 * 24 * 60 * 60 * 1000 },
  '90d': { label: '90 DIAS', ms: 90 * 24 * 60 * 60 * 1000 },
  '120d': { label: '120 DIAS', ms: 120 * 24 * 60 * 60 * 1000 },
  '180d': { label: '180 DIAS', ms: 180 * 24 * 60 * 60 * 1000 },
  '365d': { label: '365 DIAS', ms: 365 * 24 * 60 * 60 * 1000 }
});

// Permite durações personalizadas sem modificar o Firebase nem perder a compatibilidade.
export function parseCustomDuration(input) {
  const match = /^(\d{1,4})\s*(m|min|h|d)$/i.exec(String(input || '').trim());
  if (!match) return null;
  const number = Number(match[1]);
  const unit = match[2].toLowerCase();
  const unitMs = unit === 'm' || unit === 'min' ? 60000 : unit === 'h' ? 3600000 : 86400000;
  const ms = number * unitMs;
  if (!Number.isSafeInteger(ms) || ms < 15 * 60000 || ms > 3650 * 86400000) return null;
  const label = `${number} ${unit === 'm' || unit === 'min' ? 'MINUTO(S)' : unit === 'h' ? 'HORA(S)' : 'DIA(S)'}`;
  return { id: 'custom', label, ms };
}

export function isAdmin(telegramUserId) {
  return String(telegramUserId ?? '') === (process.env.ADMIN_TELEGRAM_ID || ADMIN_ID);
}

// New licences use six digits; legacy 16-digit licences remain valid.
export function validKeyFormat(value) {
  return typeof value === 'string' && /^(?:\d{6}|\d{16})$/.test(value);
}

export function validTelegramId(value) {
  return /^\d{5,15}$/.test(String(value ?? '').trim());
}


export function validManualId(value, realTelegramId) {
  return validTelegramId(value) && String(value).trim() === String(realTelegramId);
}

export function licenseStatus(key, now = Date.now()) {
  if (!key || key.deletedAt || key.status === 'revoked') return 'revoked';
  if (key.status === 'paused') return 'paused';
  if (key.status !== 'active') return key.status || 'available';
  if (Number(key.expiresAt || 0) <= now) return 'expired';
  return 'active';
}

export function remainingMs(key, now = Date.now()) {
  if (!key) return 0;
  if (key.status === 'paused') return Math.max(0, Number(key.remainingMs || 0));
  if (key.status === 'active') return Math.max(0, Number(key.expiresAt || 0) - now);
  return 0;
}

export function durationOfKey(key) {
  if (!key) return 0;
  const explicit = Number(key.durationMs);
  if (Number.isFinite(explicit) && explicit > 0) return explicit;
  // Some legacy records saved only the duration identifier, not durationMs.
  const id = key.durationId || key.duration;
  if (id && DURATIONS[id]) return DURATIONS[id].ms;
  const label = String(key.durationLabel || '').trim();
  return Object.values(DURATIONS).find(item => item.label === label)?.ms || 0;
}

export function activateKey(key, user, now = Date.now()) {
  if (!key || key.status !== 'available' || key.deletedAt) return null;
  const durationMs = durationOfKey(key);
  if (!durationMs) return null;
  return {
    ...key, durationMs, status: 'active', userId: String(user.id), username: user.username || null,
    firstName: user.first_name || null, activatedAt: now, expiresAt: now + durationMs,
    remainingMs: null, pausedAt: null, updatedAt: now
  };
}

// Realtime Database transactions can initially receive null before their
// server value is loaded. Returning undefined in that first invocation
// aborts the transaction even if the Key exists on the server.
export function activationTransactionValue(current, user, now = Date.now()) {
  if (current == null) return null;
  return activateKey(current, user, now) || undefined;
}

export function pauseKey(key, now = Date.now()) {
  if (!key || key.status !== 'active') return null;
  const remaining = Math.max(0, Number(key.expiresAt || 0) - now);
  if (!remaining) return { ...key, status: 'expired', expiresAt: now, remainingMs: 0, updatedAt: now };
  return { ...key, status: 'paused', remainingMs: remaining, expiresAt: null, pausedAt: now, updatedAt: now };
}

export function resumeKey(key, now = Date.now()) {
  if (!key || key.status !== 'paused' || Number(key.remainingMs || 0) <= 0) return null;
  const remaining = Number(key.remainingMs);
  return { ...key, status: 'active', expiresAt: now + remaining, remainingMs: null, resumedAt: now, pausedAt: null, updatedAt: now };
}

export function resetKey(key, now = Date.now()) {
  if (!key || key.deletedAt || key.status === 'revoked') return null;
  return {
    ...key, status: 'available', userId: null, username: null, firstName: null,
    activatedAt: null, expiresAt: null, remainingMs: null, pausedAt: null,
    resetAt: now, updatedAt: now
  };
}

export function formatRemaining(ms) {
  const seconds = Math.max(0, Math.floor(ms / 1000));
  const days = Math.floor(seconds / 86400);
  const hours = Math.floor((seconds % 86400) / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const secs = seconds % 60;
  return [days ? `${days}d` : '', hours ? `${hours}h` : '', minutes ? `${minutes}min` : '', (!days && !hours && !minutes) ? `${secs}s` : ''].filter(Boolean).join(' ') || '0s';
}

export function formatDate(timestamp) {
  if (!timestamp) return '—';
  return new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short', timeStyle: 'short', timeZone: 'America/Sao_Paulo' }).format(new Date(timestamp));
}
