import { timingSafeEqual } from 'node:crypto';
import { claimUpdate, database, finishUpdate } from './firebase.js';
import { processUpdate } from './bot.js';

export const config = { api: { bodyParser: { sizeLimit: '1mb' } } };

function safeEqual(a, b) {
  const left = Buffer.from(String(a || ''), 'utf8');
  const right = Buffer.from(String(b || ''), 'utf8');
  return left.length === right.length && left.length > 0 && timingSafeEqual(left, right);
}

async function getBody(req) {
  if (req.body && typeof req.body === 'object') return req.body;
  if (typeof req.body === 'string') return JSON.parse(req.body);
  if (Buffer.isBuffer(req.body)) return JSON.parse(req.body.toString('utf8'));
  let body = '';
  for await (const chunk of req) {
    body += chunk;
    if (body.length > 1_000_000) throw new Error('Payload excede 1 MB.');
  }
  return JSON.parse(body || '{}');
}

export default async function handler(req, res) {
  if (req.method === 'GET') {
    res.status(200).json({ service: 'MestreXit.ia Telegram webhook', status: 'ready' });
    return;
  }
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'GET, POST');
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }
  const secret = process.env.TELEGRAM_WEBHOOK_SECRET;
  if (!secret || !safeEqual(req.headers['x-telegram-bot-api-secret-token'], secret)) {
    res.status(401).json({ error: 'Unauthorized' });
    return;
  }
  let update;
  try { update = await getBody(req); }
  catch { res.status(400).json({ error: 'Invalid JSON payload' }); return; }
  if (!Number.isInteger(update.update_id)) {
    res.status(400).json({ error: 'Missing Telegram update_id' });
    return;
  }
  let db;
  try { db = database(); }
  catch (error) {
    console.error('firebase_initialization_error', error.message);
    res.status(503).json({ error: 'Service not configured' });
    return;
  }
  try {
    const claimed = await claimUpdate(db, update.update_id);
    if (!claimed) { res.status(200).json({ ok: true, duplicate: true }); return; }
    try {
      await processUpdate(update);
      await finishUpdate(db, update.update_id);
      res.status(200).json({ ok: true });
    } catch (error) {
      console.error('telegram_update_error', update.update_id, error.message);
      await finishUpdate(db, update.update_id, error.message).catch(() => {});
      res.status(500).json({ error: 'Update processing failed' });
    }
  } catch (error) {
    console.error('telegram_webhook_error', error.message);
    res.status(500).json({ error: 'Webhook processing failed' });
  }
}
