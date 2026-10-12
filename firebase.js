import admin from 'firebase-admin';

function serviceAccountFromEnv() {
  let raw = process.env.FIREBASE_SERVICE_ACCOUNT_JSON;
  if (!raw && process.env.FIREBASE_SERVICE_ACCOUNT_BASE64) {
    raw = Buffer.from(process.env.FIREBASE_SERVICE_ACCOUNT_BASE64, 'base64').toString('utf8');
  }
  if (!raw) throw new Error('Configure FIREBASE_SERVICE_ACCOUNT_JSON ou FIREBASE_SERVICE_ACCOUNT_BASE64.');
  try { return JSON.parse(raw); }
  catch { throw new Error('As credenciais Firebase não contêm JSON válido.'); }
}

export function database() {
  if (!process.env.FIREBASE_DATABASE_URL) throw new Error('Configure FIREBASE_DATABASE_URL.');
  if (!admin.apps.length) {
    admin.initializeApp({ credential: admin.credential.cert(serviceAccountFromEnv()), databaseURL: process.env.FIREBASE_DATABASE_URL });
  }
  return admin.database();
}

export const paths = Object.freeze({
  keys: 'keys', users: 'users', conversations: 'conversations', activation: 'activation',
  actions: 'adminActions', updates: 'processedUpdates', attempts: 'security/keyAttempts',
  imageUsage: 'imageUsage'
});

export async function claimUpdate(db, updateId, leaseMs = Number(process.env.UPDATE_LEASE_MS || 120000)) {
  const ref = db.ref(`${paths.updates}/${updateId}`);
  const result = await ref.transaction(current => {
    const now = Date.now();
    if (current?.status === 'done') return;
    if (current?.status === 'processing' && now - Number(current.startedAt || 0) < leaseMs) return;
    return { status: 'processing', startedAt: now };
  });
  return result.committed && result.snapshot.val()?.status === 'processing';
}

export async function finishUpdate(db, updateId, error = null) {
  await db.ref(`${paths.updates}/${updateId}`).set({ status: error ? 'failed' : 'done', finishedAt: Date.now(), ...(error ? { error: String(error).slice(0, 300) } : {}) });
}

export async function appendAdminAction(db, adminId, action, details = {}) {
  await db.ref(paths.actions).push({ adminId: String(adminId), action, details, at: Date.now() });
}
