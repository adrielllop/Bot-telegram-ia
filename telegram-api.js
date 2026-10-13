import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const API = () => `https://api.telegram.org/bot${process.env.TELEGRAM_BOT_TOKEN}`;
const ROOT = fileURLToPath(new URL('./', import.meta.url));

export async function tg(method, payload = {}) {
  if (!process.env.TELEGRAM_BOT_TOKEN) throw new Error('Configure TELEGRAM_BOT_TOKEN.');
  const response = await fetch(`${API()}/${method}`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(payload),
    signal: AbortSignal.timeout(25000)
  });
  const result = await response.json().catch(() => ({}));
  if (!response.ok || !result.ok) throw new Error(`Telegram ${method}: ${result.description || response.statusText || response.status}`);
  return result.result;
}

export const sendMessage = (chatId, text, extra = {}) => tg('sendMessage', { chat_id: chatId, text, ...extra });
export const editMessage = (chatId, messageId, text, extra = {}) => tg('editMessageText', { chat_id: chatId, message_id: messageId, text, ...extra });
export const answerCallback = (id, text = '', showAlert = false) => tg('answerCallbackQuery', { callback_query_id: id, text, show_alert: showAlert });
export const sendChatAction = (chatId, action) => tg('sendChatAction', { chat_id: chatId, action });
export const deleteMessage = (chatId, messageId) => tg('deleteMessage', { chat_id: chatId, message_id: messageId });

async function sendAsset(method, chatId, filename, fields, fileField = 'photo') {
  const bytes = await readFile(path.join(ROOT, filename));
  const form = new FormData();
  form.append('chat_id', String(chatId));
  for (const [key, value] of Object.entries(fields)) form.append(key, typeof value === 'string' ? value : JSON.stringify(value));
  form.append(fileField, new Blob([bytes]), filename);
  const response = await fetch(`${API()}/${method}`, { method: 'POST', body: form, signal: AbortSignal.timeout(25000) });
  const result = await response.json().catch(() => ({}));
  if (!response.ok || !result.ok) throw new Error(`Telegram ${method}: ${result.description || response.status}`);
  return result.result;
}

export const sendPhotoAsset = (chatId, filename, fields = {}) => sendAsset('sendPhoto', chatId, filename, fields);
export const sendPhotoBytes = async (chatId, bytes, caption) => {
  const form = new FormData();
  form.append('chat_id', String(chatId)); form.append('caption', caption);
  form.append('photo', new Blob([bytes], { type: 'image/png' }), 'mestrexit.png');
  const response = await fetch(`${API()}/sendPhoto`, { method: 'POST', body: form, signal: AbortSignal.timeout(25000) });
  const result = await response.json().catch(() => ({}));
  if (!response.ok || !result.ok) throw new Error(`Telegram sendPhoto: ${result.description || response.status}`);
  return result.result;
};
