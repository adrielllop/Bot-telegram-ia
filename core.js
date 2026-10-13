export const ADMIN_ID = '8646015281';
export const DURATIONS = Object.freeze({
  '1h': { label: '1 HORA', ms: 60 * 60 * 1000 },
  '6h': { label: '6 HORAS', ms: 6 * 60 * 60 * 1000 },
  '1d': { label: '1 DIA', ms: 24 * 60 * 60 * 1000 },
  '3d': { label: '3 DIAS', ms: 3 * 24 * 60 * 60 * 1000 },
  '7d': { label: '7 DIAS', ms: 7 * 24 * 60 * 60 * 1000 },
  '10d': { label: '10 DIAS', ms: 10 * 24 * 60 * 60 * 1000 },
  '15d': { label: '15 DIAS', ms: 15 * 24 * 60 * 60 * 1000 },
  '30d': { label: '30 DIAS', ms: 30 * 24 * 60 * 60 * 1000 },
  '60d': { label: '60 DIAS', ms: 60 * 24 * 60 * 60 * 1000 },
  '90d': { label: '90 DIAS', ms: 90 * 24 * 60 * 60 * 1000 }
});

export function isAdmin(telegramUserId) {
  return String(telegramUserId ?? '') === ADMIN_ID;
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

export function activateKey(key, user, now = Date.now()) {
  if (!key || key.status !== 'available' || key.deletedAt) return null;
  const durationMs = Number(key.durationMs);
  if (!Number.isFinite(durationMs) || durationMs <= 0) return null;
  return {
    ...key, status: 'active', userId: String(user.id), username: user.username || null,
    firstName: user.first_name || null, activatedAt: now, expiresAt: now + durationMs,
    remainingMs: null, pausedAt: null, updatedAt: now
  };
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
