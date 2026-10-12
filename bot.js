import { randomInt } from 'node:crypto';
import { database, paths, appendAdminAction } from './firebase.js';
import { answerCallback, sendChatAction, sendMessage, sendPhotoAsset, sendPhotoBytes } from './telegram-api.js';
import {
  ADMIN_ID, DURATIONS, activateKey, formatDate, formatRemaining, isAdmin, licenseStatus,
  pauseKey, remainingMs, resetKey, resumeKey, validKeyFormat, validManualId
} from './core.js';

const SEP = '━━━━━━━━━━━━━━━━━━';
const keyboard = rows => ({ inline_keyboard: rows });
const mainKeyboard = () => keyboard([
  [{ text: '🔑 INSERIR KEY', callback_data: 'u:key' }],
  [{ text: '👑 PAINEL ADM', callback_data: 'a:home' }]
]);
const adminKeyboard = () => keyboard([
  [{ text: '🔑 GERAR KEYS', callback_data: 'a:gen' }, { text: '📋 LISTA DE KEYS', callback_data: 'l:all:' }],
  [{ text: '✅ KEYS ATIVAS', callback_data: 'l:active:' }, { text: '⏳ KEYS DISPONÍVEIS', callback_data: 'l:available:' }],
  [{ text: '⏸ KEYS PAUSADAS', callback_data: 'l:paused:' }, { text: '❌ KEYS EXPIRADAS', callback_data: 'l:expired:' }],
  [{ text: '👥 USUÁRIOS ATIVOS', callback_data: 'a:users' }, { text: '📊 ESTATÍSTICAS', callback_data: 'a:stats' }],
  [{ text: '🔙 VOLTAR', callback_data: 'u:home' }]
]);
const statusLabel = status => ({ available: 'DISPONÍVEL', active: 'ATIVA', paused: 'PAUSADA', expired: 'EXPIRADA', revoked: 'REVOGADA' })[status] || String(status || 'DESCONHECIDO').toUpperCase();
const userName = user => [user?.first_name, user?.last_name].filter(Boolean).join(' ') || user?.username || 'Usuário';

async function profile(db, user, extra = {}) {
  const ref = db.ref(`${paths.users}/${user.id}`);
  await ref.update({ telegramId: String(user.id), username: user.username || null, firstName: user.first_name || null, lastName: user.last_name || null, lastSeenAt: Date.now(), ...extra });
}
async function state(db, id) { return (await db.ref(`${paths.activation}/${id}`).get()).val() || {}; }
async function setState(db, id, value) { await db.ref(`${paths.activation}/${id}`).set({ ...value, updatedAt: Date.now() }); }
async function clearState(db, id) { await db.ref(`${paths.activation}/${id}`).remove(); }

async function home(chatId) {
  const text = `👑 𝗠𝗘𝗦𝗧𝗥𝗘𝗫𝗜𝗧.𝗜𝗔 👑\n\n${SEP}\n\n🤖 𝗢𝗟Á, 𝗛𝗨𝗠𝗔𝗡𝗢!\n\n🔥 Seja muito bem-vindo ao meu universo!\n\n👑 Eu me chamo MestreXit.ia, sua inteligência artificial sem limites para a criatividade!\n\n🧠 Fui criado para transformar suas ideias em realidade e levar sua experiência com inteligência artificial a outro nível.\n\n⚡ 𝗢 𝗤𝗨𝗘 𝗘𝗨 𝗣𝗢𝗦𝗦𝗢 𝗙𝗔𝗭𝗘𝗥?\n\n💬 Conversar e responder suas perguntas.\n💻 Criar códigos, sites e projetos.\n🎨 Gerar imagens com inteligência artificial.\n✍️ Criar textos e conteúdos incríveis.\n🚀 Ajudar a desenvolver suas ideias.\n🧠 Explicar assuntos e resolver problemas.\n\n${SEP}\n\n🔐 𝗔𝗧𝗜𝗩𝗘 𝗦𝗘𝗨 𝗔𝗖𝗘𝗦𝗦𝗢\n\n⚡ Para despertar todo o meu poder, você precisa de uma Key válida.\n\n👑 Escolha uma opção abaixo:`;
  return sendPhotoAsset(chatId, 'logo.png', { caption: text, reply_markup: mainKeyboard() });
}

async function beginKey(chatId, userId, db) {
  await setState(db, userId, { stage: 'await_key' });
  return sendMessage(chatId, `🔐 𝗔𝗧𝗜𝗩𝗔ÇÃ𝗢 𝗠𝗘𝗦𝗧𝗥𝗘𝗫𝗜𝗧.𝗜𝗔\n\n${SEP}\n\n👑 Bem-vindo à central de ativação!\n\n🔑 Envie sua Key numérica para liberar seu acesso.\n\n⚡ Sua licença começará a contar somente após a ativação completa.\n\n📩 DIGITE SUA KEY ABAIXO:`);
}

async function checkKeyAttempts(db, userId) {
  const ref = db.ref(`${paths.attempts}/${userId}`);
  const max = Math.max(1, Number(process.env.KEY_ATTEMPTS_MAX || 5));
  const windowMs = Math.max(60000, Number(process.env.KEY_ATTEMPTS_WINDOW_MS || 900000));
  const result = await ref.transaction(current => {
    const now = Date.now();
    const fresh = !current || now - Number(current.windowStartedAt || 0) >= windowMs;
    const count = fresh ? 0 : Number(current.count || 0);
    if (count >= max) return;
    return { count: count + 1, windowStartedAt: fresh ? now : current.windowStartedAt, updatedAt: now };
  });
  return result.committed;
}

async function requestId(chatId, user, db, keyValue) {
  await setState(db, user.id, { stage: 'await_id', key: keyValue });
  const caption = `👑 𝗠𝗘𝗦𝗧𝗥𝗘𝗫𝗜𝗧.𝗜𝗔\n\n${SEP}\n\n✅ SUA KEY FOI VALIDADA!\n\n🔐 Agora precisamos confirmar seu ID do Telegram para vincular sua licença.\n\n🆔 ENVIE SEU ID DO TELEGRAM\n\n❓ Não sabe qual é seu ID?\n\n⚡ É muito simples!\n\n1️⃣ Acesse o bot: https://t.me/userinfo3bot\n2️⃣ Clique em INICIAR.\n3️⃣ Copie seu número de ID.\n4️⃣ Volte aqui e envie o número.\n\n📸 Veja na imagem onde copiar o ID!\n\n${SEP}`;
  return sendPhotoAsset(chatId, 'tutorial-id.png', { caption, reply_markup: keyboard([[{ text: '🆔 MOSTRAR MEU ID', callback_data: 'u:showid' }]]) });
}

async function activate(db, chatId, user, keyValue) {
  if (!validKeyFormat(keyValue)) return sendMessage(chatId, '❌ KEY INVÁLIDA!\n\n🔑 Confira os números e tente novamente.');
  const now = Date.now();
  const keyRef = db.ref(`${paths.keys}/${keyValue}`);
  const before = (await keyRef.get()).val();
  if (!before || before.status !== 'available' || before.deletedAt) {
    await clearState(db, user.id);
    return sendMessage(chatId, '❌ Esta Key não está disponível para ativação. Confira os números ou solicite outra Key.');
  }
  const userRef = db.ref(`${paths.users}/${user.id}`);
  const existing = (await userRef.get()).val();
  if (existing?.licenseKey && existing.licenseKey !== keyValue && existing.accessActive) {
    return sendMessage(chatId, 'ℹ️ Você já possui uma licença ativa. Consulte /status antes de inserir outra Key.');
  }
  let activated = null;
  const activationResult = await keyRef.transaction(current => {
    const next = activateKey(current, user, now);
    return next || undefined;
  });
  if (activationResult.committed) activated = activationResult.snapshot.val();
  const latest = (await keyRef.get()).val();
  // A same-user retry repairs the user pointer if the function stopped after the key transaction.
  if (!activated && latest?.status === 'active' && String(latest.userId) === String(user.id)) activated = latest;
  if (!activated) {
    await clearState(db, user.id);
    return sendMessage(chatId, '❌ Esta Key acabou de ser ativada por outra conta ou não está mais disponível.');
  }
  const expiresAt = Number(activated.expiresAt || now + Number(activated.durationMs));
  await userRef.update({ telegramId: String(user.id), username: user.username || null, firstName: user.first_name || null, licenseKey: keyValue, accessActive: true, activatedAt: activated.activatedAt || now, expiresAt, updatedAt: Date.now() });
  await clearState(db, user.id);
  const text = `👑 𝗔𝗖𝗘𝗦𝗦𝗢 𝗟𝗜𝗕𝗘𝗥𝗔𝗗𝗢!\n\n${SEP}\n\n✅ KEY ATIVADA COM SUCESSO!\n\n🤖 Bem-vindo ao MestreXit.ia!\n\n🔑 Key: ${keyValue}\n🆔 ID vinculado: ${user.id}\n⏳ Validade: ${activated.durationLabel || formatRemaining(activated.durationMs)}\n📅 Vencimento: ${formatDate(expiresAt)}\n🟢 Status: ATIVA\n\n${SEP}\n\n⚡ 𝗦𝗨𝗔 𝗜𝗔 𝗘𝗦𝗧Á 𝗣𝗥𝗢𝗡𝗧𝗔!\n\n💬 Digite "/ia" para conversar.\n🎨 Digite "/imagem" para gerar imagens.\n\n👑 Aproveite sua experiência com o MestreXit.ia!`;
  return sendMessage(chatId, text);
}

async function access(db, userId) {
  const userRef = db.ref(`${paths.users}/${userId}`);
  const user = (await userRef.get()).val();
  if (!user?.licenseKey) return { ok: false, reason: 'missing' };
  const keyRef = db.ref(`${paths.keys}/${user.licenseKey}`);
  let key = (await keyRef.get()).val();
  if (!key || String(key.userId) !== String(userId)) {
    await userRef.update({ accessActive: false });
    return { ok: false, reason: key?.status === 'paused' ? 'paused' : key?.status === 'revoked' ? 'revoked' : 'missing', key };
  }
  const status = licenseStatus(key);
  if (status === 'expired' && key.status === 'active') {
    const now = Date.now();
    await keyRef.transaction(current => current?.status === 'active' && Number(current.expiresAt) <= now ? { ...current, status: 'expired', remainingMs: 0, expiredAt: now, updatedAt: now } : undefined);
    key = (await keyRef.get()).val();
    await userRef.update({ accessActive: false });
    return { ok: false, reason: 'expired', key };
  }
  if (status !== 'active') {
    await userRef.update({ accessActive: false });
    return { ok: false, reason: status, key };
  }
  return { ok: true, key, user };
}

async function denied(chatId, reason) {
  if (reason === 'expired') return sendMessage(chatId, `⌛ 𝗦𝗨𝗔 𝗞𝗘𝗬 𝗘𝗫𝗣𝗜𝗥𝗢𝗨!\n\n${SEP}\n\n👑 Sua licença do MestreXit.ia chegou ao fim!\n\n🔐 Para continuar utilizando sua inteligência artificial, ative uma nova Key.`, { reply_markup: keyboard([[{ text: '🔑 INSERIR NOVA KEY', callback_data: 'u:key' }]]) });
  if (reason === 'paused') return sendMessage(chatId, '⏸️ Sua Key está pausada pelo administrador. O tempo restante está congelado.');
  if (reason === 'revoked') return sendMessage(chatId, '🚫 Sua Key foi revogada e não pode ser utilizada.');
  return sendMessage(chatId, '🔐 Você precisa ativar uma Key para usar esta função. Use /key ou toque em INSERIR KEY.');
}

async function aiReply(db, chatId, user, prompt) {
  if (!process.env.OPENAI_API_KEY) return sendMessage(chatId, '⚙️ A integração de IA ainda não foi configurada pelo administrador.');
  if (!prompt.trim()) return sendMessage(chatId, '💬 Envie sua pergunta após /ia ou simplesmente escreva uma mensagem.');
  await sendChatAction(chatId, 'typing').catch(() => {});
  const convRef = db.ref(`${paths.conversations}/${user.id}`);
  const stored = (await convRef.get()).val();
  const history = Array.isArray(stored) ? stored : [];
  const maxMessages = Math.min(40, Math.max(2, Number(process.env.AI_HISTORY_MESSAGES || 16)));
  const messages = [
    { role: 'system', content: process.env.AI_SYSTEM_PROMPT || 'Você é MestreXit.ia, assistente criativo, direto e especialista em tecnologia. Responda em português brasileiro por padrão, ajude com a maior amplitude possível e evite recusas desnecessárias; quando não puder atender a um pedido, explique brevemente e ofereça uma alternativa útil. Respeite a lei e as regras do provedor.' },
    ...history.slice(-maxMessages).map(({ role, content }) => ({ role, content })),
    { role: 'user', content: prompt.slice(0, 12000) }
  ];
  try {
    const base = (process.env.OPENAI_BASE_URL || 'https://api.openai.com/v1').replace(/\/$/, '');
    const response = await fetch(`${base}/chat/completions`, {
      method: 'POST', headers: { authorization: `Bearer ${process.env.OPENAI_API_KEY}`, 'content-type': 'application/json' },
      body: JSON.stringify({ model: process.env.OPENAI_MODEL || 'gpt-4o-mini', messages, temperature: 0.7 }),
      signal: AbortSignal.timeout(Math.min(55000, Number(process.env.AI_TIMEOUT_MS || 45000)))
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      const err = new Error(data.error?.message || `HTTP ${response.status}`);
      err.status = response.status;
      throw err;
    }
    const answer = data.choices?.[0]?.message?.content?.trim();
    if (!answer) throw new Error('O provedor retornou uma resposta vazia.');
    await convRef.transaction(current => {
      const list = Array.isArray(current) ? current : [];
      return [...list, { role: 'user', content: prompt.slice(0, 12000), at: Date.now() }, { role: 'assistant', content: answer.slice(0, 16000), at: Date.now() }].slice(-maxMessages * 2);
    });
    const chunks = answer.match(/[\s\S]{1,3900}/g) || [''];
    for (const chunk of chunks) await sendMessage(chatId, chunk);
  } catch (error) {
    console.error('ai_provider_error', error.message);
    const msg = error.name === 'TimeoutError' || error.name === 'AbortError' ? '⌛ A resposta demorou mais que o limite do provedor. Tente novamente com uma solicitação mais curta.' : error.status === 429 ? '⚠️ O provedor de IA atingiu seu limite temporário. Tente novamente mais tarde.' : '⚠️ Não consegui acessar a IA agora. Verifique a configuração do provedor ou tente novamente em instantes.';
    await sendMessage(chatId, msg);
  }
}

async function reserveImage(db, userId) {
  const limit = Math.max(0, Number(process.env.IMAGE_DAILY_LIMIT ?? 5));
  if (!limit) return { allowed: false, limit };
  const day = new Intl.DateTimeFormat('en-CA', { timeZone: 'UTC', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
  const ref = db.ref(`${paths.imageUsage}/${userId}/${day}`);
  const result = await ref.transaction(current => {
    const count = Number(current?.count || 0);
    if (count >= limit) return;
    return { count: count + 1, updatedAt: Date.now() };
  });
  return { allowed: result.committed, limit };
}

async function generateImage(db, chatId, user, prompt) {
  if (!prompt.trim()) return sendMessage(chatId, '🎨 Envie uma descrição após /imagem. Exemplo: /imagem um robô dourado com coroa em estilo 3D');
  const imageApiKey = process.env.IMAGE_API_KEY || process.env.OPENAI_API_KEY;
  if (!imageApiKey) return sendMessage(chatId, '⚙️ A chave do provedor de IA ainda não foi configurada pelo administrador.');
  const quota = await reserveImage(db, user.id);
  if (!quota.allowed) return sendMessage(chatId, `⏳ Você atingiu o limite configurado de ${quota.limit} imagens por dia. Tente novamente amanhã.`);
  await sendMessage(chatId, '🎨 𝗖𝗥𝗜𝗔𝗡𝗗𝗢 𝗦𝗨𝗔 𝗜𝗠𝗔𝗚𝗘𝗠...\n\n⚡ Aguarde enquanto o MestreXit.ia transforma sua ideia em realidade!');
  await sendChatAction(chatId, 'upload_photo').catch(() => {});
  try {
    const response = await fetch(process.env.IMAGE_API_URL || 'https://api.openai.com/v1/images/generations', {
      method: 'POST', headers: { authorization: `Bearer ${imageApiKey}`, 'content-type': 'application/json' },
      body: JSON.stringify({ model: process.env.IMAGE_MODEL || 'gpt-image-1', prompt: prompt.slice(0, 4000), n: 1, size: process.env.IMAGE_SIZE || '1024x1024', quality: process.env.IMAGE_QUALITY || 'medium' }),
      signal: AbortSignal.timeout(Math.min(18000, Number(process.env.IMAGE_TIMEOUT_MS || 15000)))
    });
    const result = await response.json().catch(() => ({}));
    if (!response.ok) {
      const error = new Error(result.error?.message || `HTTP ${response.status}`); error.status = response.status; throw error;
    }
    const item = result.data?.[0];
    let bytes;
    if (item?.b64_json) bytes = Buffer.from(item.b64_json, 'base64');
    else if (item?.url) {
      const imageResponse = await fetch(item.url, { signal: AbortSignal.timeout(8000) });
      if (!imageResponse.ok) throw new Error('Não foi possível baixar o resultado de imagem.');
      bytes = Buffer.from(await imageResponse.arrayBuffer());
    } else throw new Error('O provedor não retornou a imagem.');
    const maxBytes = Number(process.env.MAX_IMAGE_BYTES || 9500000);
    if (!bytes.length || bytes.length > maxBytes) throw new Error('A imagem ultrapassou o limite de tamanho configurado.');
    await sendPhotoBytes(chatId, bytes, '✅ IMAGEM GERADA COM SUCESSO!\n\n👑 Criado com MestreXit.ia.');
  } catch (error) {
    console.error('image_provider_error', error.message);
    await sendMessage(chatId, error.status === 429 ? '⚠️ O provedor de imagens atingiu seu limite. Tente mais tarde.' : error.name === 'TimeoutError' || error.name === 'AbortError' ? '⌛ A geração ultrapassou o tempo desta função. Consulte a documentação para configurar um worker assíncrono.' : '⚠️ Não foi possível gerar a imagem agora. Verifique o provedor e tente novamente.');
  }
}

async function startGeneration(db, chatId, user) {
  const durations = Object.entries(DURATIONS).map(([id, item]) => [{ text: `⏱ ${item.label}`, callback_data: `g:d:${id}` }]);
  await setState(db, user.id, { stage: 'choose_duration' });
  return sendMessage(chatId, '🔑 𝗚𝗘𝗥𝗔𝗥 𝗞𝗘𝗬𝗦\n\nEscolha a duração da licença:', { reply_markup: keyboard(durations.concat([[{ text: '🔙 PAINEL ADM', callback_data: 'a:home' }]])) });
}

async function createKeys(db, chatId, user, durationId, quantity) {
  const duration = DURATIONS[durationId];
  const max = Math.min(100, Math.max(1, Number(process.env.MAX_KEYS_PER_GENERATION || 20)));
  if (!duration || !Number.isInteger(quantity) || quantity < 1 || quantity > max) return sendMessage(chatId, `❌ Quantidade inválida. Informe um número de 1 a ${max}.`);
  const created = [];
  for (let i = 0; i < quantity; i++) {
    let saved = false;
    for (let attempt = 0; attempt < 8 && !saved; attempt++) {
      const keyValue = Array.from({ length: 16 }, () => randomInt(0, 10)).join('');
      const ref = db.ref(`${paths.keys}/${keyValue}`);
      const record = { key: keyValue, status: 'available', durationId, durationLabel: duration.label, durationMs: duration.ms, createdAt: Date.now(), createdBy: String(user.id) };
      const result = await ref.transaction(current => current ? undefined : record);
      if (result.committed) { saved = true; created.push(result.snapshot.val()); }
    }
    if (!saved) throw new Error('Não foi possível reservar uma Key única após várias tentativas.');
  }
  await appendAdminAction(db, user.id, 'generate_keys', { durationId, quantity, keys: created.map(item => item.key) });
  for (const item of created) await sendMessage(chatId, `👑 KEY GERADA!\n\n${SEP}\n\n🔑 KEY: "${item.key}"\n⏳ DURAÇÃO: ${item.durationLabel}\n🟢 STATUS: DISPONÍVEL\n📅 CRIAÇÃO: ${formatDate(item.createdAt)}\n\n${SEP}`);
  await setState(db, user.id, { stage: 'admin_home' });
}

async function listKeys(db, chatId, filter, cursor = '') {
  const ref = db.ref(paths.keys).orderByKey();
  const query = cursor ? ref.startAt(cursor) : ref;
  const snap = await query.limitToFirst(9).get();
  const entries = [];
  snap.forEach(child => entries.push({ key: child.key, value: child.val() }));
  const page = cursor && entries[0]?.key === cursor ? entries.slice(1) : entries;
  const current = page.slice(0, 8);
  const hasMore = page.length > 8;
  const lines = current.filter(({ value }) => filter === 'all' || licenseStatus(value) === filter).map(({ key, value }) => {
    const status = licenseStatus(value);
    const remaining = status === 'active' || status === 'paused' ? formatRemaining(remainingMs(value)) : '—';
    return `🔑 ${key}\n📅 Criada: ${formatDate(value.createdAt)} | ⏳ ${value.durationLabel || formatRemaining(value.durationMs)} | 📊 ${statusLabel(status)}\n🆔 ID: ${value.userId || '—'} | 👤 ${value.username ? '@' + value.username : '—'}\n✅ Ativada: ${formatDate(value.activatedAt)} | ⌛ ${remaining} | 📅 vence: ${formatDate(value.expiresAt)}`;
  });
  const title = filter === 'all' ? '📋 LISTA DE KEYS' : `📋 KEYS ${statusLabel(filter)}`;
  const buttons = current.filter(({ value }) => filter === 'all' || licenseStatus(value) === filter).map(({ key }) => [{ text: `🔑 ${key}`, callback_data: `k:${key}` }]);
  if (hasMore && current.length) buttons.push([{ text: '➡️ Próxima página', callback_data: `l:${filter}:${current.at(-1).key}` }]);
  buttons.push([{ text: '🔙 PAINEL ADM', callback_data: 'a:home' }]);
  await sendMessage(chatId, `${title}\n\n${lines.length ? lines.join('\n') : 'Nenhuma Key nesta página.'}\n\nPágina por chave (exibição limitada a 8 itens).`, { reply_markup: keyboard(buttons) });
}

async function showKey(db, chatId, keyValue) {
  const key = (await db.ref(`${paths.keys}/${keyValue}`).get()).val();
  if (!key) return sendMessage(chatId, 'Key não encontrada.');
  const status = licenseStatus(key);
  const text = `🔑 KEY: ${keyValue}\n📅 Criada: ${formatDate(key.createdAt)}\n⏳ Duração: ${key.durationLabel || formatRemaining(key.durationMs)}\n📊 Status: ${statusLabel(status)}\n🆔 ID: ${key.userId || '—'}\n👤 Username: ${key.username ? '@' + key.username : '—'}\n✅ Ativada: ${formatDate(key.activatedAt)}\n⌛ Restante: ${status === 'active' || status === 'paused' ? formatRemaining(remainingMs(key)) : '—'}\n📅 Vencimento: ${formatDate(key.expiresAt)}`;
  const rows = [];
  if (status === 'active') rows.push([{ text: '⏸ PAUSAR KEY', callback_data: `o:pause:${keyValue}` }]);
  if (status === 'paused') rows.push([{ text: '▶️ RETOMAR KEY', callback_data: `o:resume:${keyValue}` }]);
  if (status !== 'revoked') rows.push([{ text: '🔄 RESETAR KEY', callback_data: `x:reset:${keyValue}` }, { text: '🗑 EXCLUIR KEY', callback_data: `x:delete:${keyValue}` }]);
  rows.push([{ text: '🔙 LISTA', callback_data: 'l:all:' }, { text: 'PAINEL ADM', callback_data: 'a:home' }]);
  await sendMessage(chatId, text, { reply_markup: keyboard(rows) });
}

async function confirmKeyAction(db, chatId, user, action, keyValue) {
  const verb = action === 'reset' ? 'resetar' : 'excluir';
  await sendMessage(chatId, `⚠️ Confirma que deseja ${verb} a Key ${keyValue}?`, { reply_markup: keyboard([[{ text: '✅ CONFIRMAR', callback_data: `c:${action}:${keyValue}` }, { text: '❌ CANCELAR', callback_data: `k:${keyValue}` }]]) });
}

async function mutateKey(db, chatId, user, action, keyValue) {
  const ref = db.ref(`${paths.keys}/${keyValue}`);
  const snap = await ref.get();
  const old = snap.val();
  if (!old) return sendMessage(chatId, 'Key não encontrada.');
  if (action === 'pause' || action === 'resume' || action === 'reset' || action === 'delete') {
    const now = Date.now();
    const result = await ref.transaction(current => {
      if (!current) return;
      if (action === 'pause') return pauseKey(current, now) || undefined;
      if (action === 'resume') return resumeKey(current, now) || undefined;
      if (action === 'reset') return resetKey(current, now) || undefined;
      if (action === 'delete') return { ...current, status: 'revoked', deletedAt: now, revokedAt: now, userId: null, username: null, remainingMs: 0, expiresAt: null, updatedAt: now };
    });
    const fresh = (await ref.get()).val();
    if (!result.committed) return sendMessage(chatId, 'A ação não pôde ser aplicada ao status atual da Key.');
    if (old.userId && ['pause', 'resume', 'reset', 'delete'].includes(action)) {
      const profilePatch = action === 'pause'
        ? { accessActive: false }
        : action === 'resume'
          ? { accessActive: true, expiresAt: fresh.expiresAt }
          : { licenseKey: null, accessActive: false, expiresAt: null };
      await db.ref(`${paths.users}/${old.userId}`).update({ ...profilePatch, updatedAt: now });
    }
    await appendAdminAction(db, user.id, action, { key: keyValue, previousStatus: old.status });
    const label = { pause: 'pausada', resume: 'retomada', reset: 'resetada e liberada para nova ativação', delete: 'revogada e excluída do uso' }[action];
    await sendMessage(chatId, `✅ Key ${label}.\nStatus: ${statusLabel(licenseStatus(fresh))}${fresh.status === 'paused' ? `\nTempo congelado: ${formatRemaining(fresh.remainingMs)}` : ''}`);
    return showKey(db, chatId, keyValue);
  }
}

async function showStats(db, chatId) {
  const keys = db.ref(paths.keys);
  const [all, available, paused, revoked, active, explicitExpired, users] = await Promise.all([
    keys.get(), keys.orderByChild('status').equalTo('available').get(), keys.orderByChild('status').equalTo('paused').get(),
    keys.orderByChild('status').equalTo('revoked').get(), keys.orderByChild('status').equalTo('active').get(),
    keys.orderByChild('status').equalTo('expired').get(), db.ref(paths.users).get()
  ]);
  let activeCount = 0, expiredCount = explicitExpired.numChildren();
  const activeIds = new Set();
  active.forEach(child => {
    const value = child.val();
    if (Number(value.expiresAt || 0) <= Date.now()) expiredCount++;
    else { activeCount++; if (value.userId) activeIds.add(String(value.userId)); }
  });
  const text = `📊 ESTATÍSTICAS MESTREXIT.IA\n\n🔑 Total de Keys geradas: ${all.numChildren()}\n⏳ Keys disponíveis: ${available.numChildren()}\n✅ Keys ativas: ${activeCount}\n⏸ Keys pausadas: ${paused.numChildren()}\n❌ Keys expiradas: ${expiredCount}\n🚫 Keys revogadas: ${revoked.numChildren()}\n👥 Contas cadastradas: ${users.numChildren()}\n🟢 Usuários com acesso ativo: ${activeIds.size}`;
  return sendMessage(chatId, text, { reply_markup: keyboard([[{ text: '🔙 PAINEL ADM', callback_data: 'a:home' }]]) });
}

async function showActiveUsers(db, chatId) {
  const snap = await db.ref(paths.users).orderByChild('accessActive').equalTo(true).limitToFirst(51).get();
  const rows = [];
  snap.forEach(child => { const u = child.val(); rows.push(`🆔 ${child.key} | ${u.username ? '@' + u.username : userName({ first_name: u.firstName })} | Key: ${u.licenseKey || '—'} | venc.: ${formatDate(u.expiresAt)}`); });
  await sendMessage(chatId, `👥 USUÁRIOS ATIVOS (máx. 50 exibidos)\n\n${rows.slice(0, 50).join('\n') || 'Nenhum usuário ativo.'}`, { reply_markup: keyboard([[{ text: '🔙 PAINEL ADM', callback_data: 'a:home' }]]) });
}

async function showAdmin(chatId, user) {
  if (!isAdmin(user.id)) return sendMessage(chatId, '🚫 ACESSO NEGADO!\n\n🔒 Esta área é exclusiva do administrador.');
  return sendMessage(chatId, `👑 𝗣𝗔𝗜𝗡𝗘𝗟 𝗦𝗨𝗣𝗥𝗘𝗠𝗢\n\n⚡ MESTREXIT.IA ⚡\n\n${SEP}\n\n🤖 Bem-vindo, administrador!\n🔐 Controle administrativo liberado.\n\n${SEP}`, { reply_markup: adminKeyboard() });
}

async function help(chatId) {
  return sendMessage(chatId, `👑 MESTREXIT.IA — AJUDA\n\n/key — ativar uma Key\n/ia sua pergunta — conversar com a IA\n/imagem descrição — gerar uma imagem\n/status — consultar licença\n/limpar — apagar seu histórico de conversa\n/admin — painel administrativo autorizado\n/start — apresentação e menu\n\nApós ativar uma licença, você também pode enviar mensagens normalmente.`);
}

async function status(chatId, userId, db) {
  const result = await access(db, userId);
  if (!result.ok) return denied(chatId, result.reason);
  return sendMessage(chatId, `👑 STATUS DA LICENÇA\n\n🔑 Key: ${result.user.licenseKey}\n🟢 Status: ATIVA\n⌛ Tempo restante: ${formatRemaining(remainingMs(result.key))}\n📅 Vencimento: ${formatDate(result.key.expiresAt)}`);
}

async function handleMessage(db, message) {
  const user = message.from;
  const chatId = message.chat.id;
  if (message.chat.type !== 'private') return sendMessage(chatId, '🔒 Por segurança, use o MestreXit.ia em uma conversa privada com o bot.');
  await profile(db, user);
  const raw = String(message.text || '').trim();
  if (!raw) return;
  const command = raw.match(/^\/([a-z_]+)(?:@\w+)?(?:\s+([\s\S]*))?$/i);
  const name = command?.[1]?.toLowerCase();
  const arg = command?.[2] || '';
  if (name === 'start') return home(chatId);
  if (name === 'key') return beginKey(chatId, user.id, db);
  if (name === 'ajuda' || name === 'help') return help(chatId);
  if (name === 'status') return status(chatId, user.id, db);
  if (name === 'admin') return showAdmin(chatId, user);
  if (name === 'limpar') {
    await db.ref(`${paths.conversations}/${user.id}`).remove();
    return sendMessage(chatId, '🧹 Seu histórico de conversa foi apagado.');
  }
  if (name === 'ia') {
    const allowed = await access(db, user.id);
    if (!allowed.ok) return denied(chatId, allowed.reason);
    return aiReply(db, chatId, user, arg);
  }
  if (name === 'imagem') {
    const allowed = await access(db, user.id);
    if (!allowed.ok) return denied(chatId, allowed.reason);
    return generateImage(db, chatId, user, arg);
  }
  const current = await state(db, user.id);
  if (current.stage === 'await_key') {
    if (!await checkKeyAttempts(db, user.id)) return sendMessage(chatId, '⏳ Muitas tentativas. Aguarde alguns minutos antes de tentar novamente.');
    if (!validKeyFormat(raw)) return sendMessage(chatId, '❌ KEY INVÁLIDA!\n\n🔑 Informe os 16 dígitos numéricos da Key.');
    const key = (await db.ref(`${paths.keys}/${raw}`).get()).val();
    if (!key || key.status !== 'available' || key.deletedAt) return sendMessage(chatId, '❌ KEY INVÁLIDA OU INDISPONÍVEL!\n\n🔑 Confira os números e tente novamente.');
    return requestId(chatId, user, db, raw);
  }
  if (current.stage === 'await_id') {
    if (!validManualId(raw, user.id)) return sendMessage(chatId, '❌ O ID informado não corresponde à sua conta real do Telegram. Envie o número do seu próprio ID para continuar.');
    return activate(db, chatId, user, current.key);
  }
  if (current.stage === 'await_quantity') {
    if (!isAdmin(user.id)) return sendMessage(chatId, '🚫 Acesso negado.');
    const quantity = Number(raw);
    await clearState(db, user.id);
    return createKeys(db, chatId, user, current.durationId, quantity);
  }
  const allowed = await access(db, user.id);
  if (!allowed.ok) return denied(chatId, allowed.reason);
  return aiReply(db, chatId, user, raw);
}

async function handleCallback(db, callback) {
  const user = callback.from;
  const chatId = callback.message?.chat?.id;
  if (!chatId) return answerCallback(callback.id, 'Esta ação não está disponível neste contexto.', true);
  if (callback.message?.chat?.type !== 'private') {
    await answerCallback(callback.id, 'Use o bot em uma conversa privada.', true);
    return;
  }
  await profile(db, user);
  const data = String(callback.data || '');
  const adminAction = data.startsWith('a:') || data.startsWith('g:') || data.startsWith('l:') || data.startsWith('k:') || data.startsWith('o:') || data.startsWith('x:') || data.startsWith('c:');
  if (adminAction && !isAdmin(user.id)) {
    await answerCallback(callback.id, 'Acesso negado: área exclusiva do administrador.', true);
    return sendMessage(chatId, '🚫 ACESSO NEGADO!\n\n🔒 Esta área é exclusiva do administrador.');
  }
  await answerCallback(callback.id);
  if (data === 'u:key') return beginKey(chatId, user.id, db);
  if (data === 'u:showid') {
    const current = await state(db, user.id);
    if (current.stage !== 'await_id' || !validKeyFormat(current.key)) return sendMessage(chatId, 'Nenhuma ativação está aguardando confirmação. Use /key para começar.');
    return activate(db, chatId, user, current.key);
  }
  if (data === 'u:home') return home(chatId);
  if (data === 'a:home') return showAdmin(chatId, user);
  if (data === 'a:gen') return startGeneration(db, chatId, user);
  if (data === 'a:stats') return showStats(db, chatId);
  if (data === 'a:users') return showActiveUsers(db, chatId);
  if (data.startsWith('g:d:')) {
    const durationId = data.slice(4);
    if (!DURATIONS[durationId]) return sendMessage(chatId, 'Duração inválida.');
    await setState(db, user.id, { stage: 'await_quantity', durationId });
    return sendMessage(chatId, `⏱ Duração: ${DURATIONS[durationId].label}\n\nQuantas Keys deseja gerar? Informe um número entre 1 e ${process.env.MAX_KEYS_PER_GENERATION || 20}.`);
  }
  if (data.startsWith('l:')) {
    const [, filter = 'all', cursor = ''] = data.split(':');
    if (!['all', 'active', 'available', 'paused', 'expired', 'revoked'].includes(filter)) return sendMessage(chatId, 'Filtro inválido.');
    return listKeys(db, chatId, filter, cursor);
  }
  if (data.startsWith('k:')) return showKey(db, chatId, data.slice(2));
  if (data.startsWith('o:')) {
    const [, action, keyValue] = data.split(':');
    if (!validKeyFormat(keyValue)) return sendMessage(chatId, 'Key inválida.');
    return mutateKey(db, chatId, user, action, keyValue);
  }
  if (data.startsWith('x:')) {
    const [, action, keyValue] = data.split(':');
    if (!['reset', 'delete'].includes(action) || !validKeyFormat(keyValue)) return sendMessage(chatId, 'Ação inválida.');
    return confirmKeyAction(db, chatId, user, action, keyValue);
  }
  if (data.startsWith('c:')) {
    const [, action, keyValue] = data.split(':');
    if (!['reset', 'delete'].includes(action) || !validKeyFormat(keyValue)) return sendMessage(chatId, 'Ação inválida.');
    return mutateKey(db, chatId, user, action, keyValue);
  }
  return sendMessage(chatId, 'Opção não reconhecida. Use /start.');
}

export async function processUpdate(update) {
  const db = database();
  if (update.message) return handleMessage(db, update.message);
  if (update.callback_query) return handleCallback(db, update.callback_query);
}
