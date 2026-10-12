const token = process.env.TELEGRAM_BOT_TOKEN;
const base = process.env.APP_BASE_URL?.replace(/\/$/, '');
const secret = process.env.TELEGRAM_WEBHOOK_SECRET;
if (!token || !base || !secret) throw new Error('Defina TELEGRAM_BOT_TOKEN, APP_BASE_URL e TELEGRAM_WEBHOOK_SECRET.');
if (!/^[A-Za-z0-9_-]{1,256}$/.test(secret)) throw new Error('TELEGRAM_WEBHOOK_SECRET deve conter 1 a 256 caracteres alfanuméricos, _ ou -.');
const response = await fetch(`https://api.telegram.org/bot${token}/setWebhook`, {
  method: 'POST', headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ url: `${base}/api/telegram`, secret_token: secret, allowed_updates: ['message', 'callback_query'], drop_pending_updates: false })
});
const data = await response.json();
if (!response.ok || !data.ok) throw new Error(data.description || 'Falha ao configurar webhook.');
console.log(`Webhook registrado em ${base}/api/telegram`);
