import { createHmac } from 'node:crypto';

const token = process.env.TELEGRAM_BOT_TOKEN;
const rawBase = process.env.APP_BASE_URL || process.argv[2] || process.env.VERCEL_PROJECT_PRODUCTION_URL || process.env.VERCEL_URL;
if (!token || !rawBase) throw new Error('Defina TELEGRAM_BOT_TOKEN e informe a URL pública: npm run set:webhook -- https://seu-projeto.vercel.app');
const base = `${/^https?:\/\//i.test(rawBase) ? '' : 'https://'}${rawBase}`.replace(/\/$/, '');
const secret = createHmac('sha256', token).update('MestreXit.ia:webhook-secret:v1').digest('hex');
const response = await fetch(`https://api.telegram.org/bot${token}/setWebhook`, {
  method: 'POST', headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ url: `${base}/api/telegram`, secret_token: secret, allowed_updates: ['message', 'callback_query'], drop_pending_updates: false })
});
const data = await response.json();
if (!response.ok || !data.ok) throw new Error(data.description || 'Falha ao configurar webhook.');
console.log(`Webhook registrado em ${base}/api/telegram`);
