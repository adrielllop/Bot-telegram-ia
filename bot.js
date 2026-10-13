import { randomInt, randomBytes } from 'node:crypto';
import { database, paths, appendAdminAction } from './firebase.js';
import { answerCallback, deleteMessage, editMessage, sendChatAction, sendMessage, sendPhotoAsset } from './telegram-api.js';
import {
  ADMIN_ID, DURATIONS, activationTransactionValue, durationOfKey, formatDate, formatRemaining, isAdmin, licenseStatus,
  pauseKey, remainingMs, resetKey, resumeKey, validKeyFormat, validManualId, validTelegramId, parseCustomDuration
} from './core.js';

const SEP = '━━━━━━━━━━━━━━━━━━';
const keyboard = rows => ({ inline_keyboard: rows });
const copyButton = (label, value) => ({ text: label, copy_text: { text: String(value) } });
const ACTIVATION_REQUEST_TTL_MS = 15 * 60 * 1000;
const mainKeyboard = (userId) => keyboard([
  [{ text: '🔑 INSERIR KEY', callback_data: 'u:key' }],
  [{ text: '🆔 MOSTRAR MEU ID', callback_data: 'u:showid' }],
  ...(isAdmin(userId) ? [[{ text: '👑 PAINEL ADM', callback_data: 'a:home' }]] : [])
]);
const adminKeyboard = () => keyboard([
  [{ text: '🔑 GERAR KEYS', callback_data: 'a:gen' }, { text: '📋 LISTA DE KEYS', callback_data: 'l:all:' }],
  [{ text: '✅ KEYS ATIVAS', callback_data: 'l:active:' }, { text: '⏳ KEYS DISPONÍVEIS', callback_data: 'l:available:' }],
  [{ text: '⏸ KEYS PAUSADAS', callback_data: 'l:paused:' }, { text: '❌ KEYS EXPIRADAS', callback_data: 'l:expired:' }],
  [{ text: '👥 USUÁRIOS ATIVOS', callback_data: 'a:users' }, { text: '📊 ESTATÍSTICAS', callback_data: 'a:stats' }],
  [{ text: '🏠 VOLTAR AO MENU NORMAL', callback_data: 'u:home' }]
]);
// Painel administrativo: botões editam a própria mensagem anterior.
// Se ela for uma foto (por exemplo, o /start), excluímos a foto e enviamos
// uma mensagem de texto, porque editMessageText não funciona em fotos.
async function showPanel(chatId, text, rows, origin = null) {
  const extra = { reply_markup: keyboard(rows) };
  if (!origin?.message_id) return sendMessage(chatId, text, extra);
  if (origin.text) {
    try { return await editMessage(chatId, origin.message_id, text, extra); }
    catch (error) {
      if (/message is not modified/i.test(String(error.message))) return;
      console.warn('admin_panel_edit_fallback', String(error.message).slice(0, 140));
    }
  }
  await deleteMessage(chatId, origin.message_id).catch(error => {
    console.warn('admin_panel_delete_fallback', String(error.message).slice(0, 140));
  });
  return sendMessage(chatId, text, extra);
}

async function showNormalMenu(chatId, user, origin = null) {
  return showPanel(chatId,
    '🏠 MENU PRINCIPAL — MESTREXIT.IA\n\nEscolha uma opção abaixo. Use /start para ver a apresentação completa.',
    mainKeyboard(user.id).inline_keyboard, origin);
}

const backAdmin = [{ text: '🔙 PAINEL ADM', callback_data: 'a:home' }];

const statusLabel = status => ({ available: 'DISPONÍVEL', active: 'ATIVA', paused: 'PAUSADA', expired: 'EXPIRADA', revoked: 'REVOGADA' })[status] || String(status || 'DESCONHECIDO').toUpperCase();
const userName = user => [user?.first_name, user?.last_name].filter(Boolean).join(' ') || user?.username || 'Usuário';

async function profile(db, user, extra = {}) {
  const ref = db.ref(`${paths.users}/${user.id}`);
  await ref.update({ telegramId: String(user.id), username: user.username || null, firstName: user.first_name || null, lastName: user.last_name || null, lastSeenAt: Date.now(), ...extra });
}
async function state(db, id) { return (await db.ref(`${paths.activation}/${id}`).get()).val() || {}; }
async function setState(db, id, value) { await db.ref(`${paths.activation}/${id}`).set({ ...value, updatedAt: Date.now() }); }
async function clearState(db, id) { await db.ref(`${paths.activation}/${id}`).remove(); }

async function home(chatId, user) {
  const text = `👑 𝗠𝗘𝗦𝗧𝗥𝗘𝗫𝗜𝗧.𝗜𝗔 👑\n\n${SEP}\n\n🤖 𝗢𝗟Á, 𝗛𝗨𝗠𝗔𝗡𝗢!\n\n🔥 Seja muito bem-vindo ao meu universo!\n\n👑 Eu me chamo MestreXit.ia, sua inteligência artificial sem limites para a criatividade!\n\n🧠 Fui criado para transformar suas ideias em realidade e levar sua experiência com inteligência artificial a outro nível.\n\n⚡ 𝗢 𝗤𝗨𝗘 𝗘𝗨 𝗣𝗢𝗦𝗦𝗢 𝗙𝗔𝗭𝗘𝗥?\n\n💬 Conversar e responder suas perguntas.\n💻 Criar códigos, sites e projetos.\n✍️ Criar textos e conteúdos incríveis.\n🚀 Ajudar a desenvolver suas ideias.\n🧠 Explicar assuntos e resolver problemas.\n\n${SEP}\n\n🔐 𝗔𝗧𝗜𝗩𝗘 𝗦𝗘𝗨 𝗔𝗖𝗘𝗦𝗦𝗢\n\n⚡ Para despertar todo o meu poder, você precisa de uma Key válida.\n\n👑 Escolha uma opção abaixo:`;
  return sendPhotoAsset(chatId, 'logo.png', { caption: text, reply_markup: mainKeyboard(user.id) });
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

async function showMyId(chatId, user) {
  // Never trust a number typed by a user to identify their Telegram account.
  // A callback's from.id is the authoritative account identity.
  return sendMessage(chatId,
    `🆔 SEU ID DO TELEGRAM\n\n${user.id}\n\nToque no botão abaixo para copiar. Depois envie o número no chat para confirmar a ativação.`,
    { reply_markup: keyboard([[copyButton('📋 COPIAR MEU ID', user.id)]]) });
}

async function requestId(chatId, user, db, keyValue) {
  await setState(db, user.id, { stage: 'await_id', key: keyValue });
  const caption = `👑 𝗠𝗘𝗦𝗧𝗥𝗘𝗫𝗜𝗧.𝗜𝗔\n\n${SEP}\n\n✅ KEY VALIDADA! (AINDA NÃO ATIVADA)\n\n🔐 A contagem só começa depois da confirmação do ID e da ativação no Firebase.\n\n🆔 ENVIE O ID DO TELEGRAM QUE RECEBERÁ A LICENÇA.\n\n✅ Para ativar na sua própria conta, copie seu ID no botão abaixo e envie o número aqui.\n\n👥 Se enviar o ID de outra pessoa, essa pessoa precisará abrir o bot e autorizar a ativação no próprio Telegram.\n\n📸 Você também pode obter o ID no bot https://t.me/userinfo3bot.\n\n${SEP}`;
  return sendPhotoAsset(chatId, 'tutorial-id.png', { caption, reply_markup: keyboard([
    [copyButton('📋 COPIAR MEU ID', user.id)],
    [{ text: '🆔 MOSTRAR MEU ID', callback_data: 'u:showid' }],
    [{ text: '❌ CANCELAR ATIVAÇÃO', callback_data: 'u:cancel' }],
    [{ text: '🔙 RECOMEÇAR', callback_data: 'u:key' }]
  ]) });
}

async function activate(db, chatId, user, keyValue) {
  if (!validKeyFormat(keyValue)) {
    return sendMessage(chatId, '❌ Formato da Key inválido. Use uma Key de 6 dígitos ou uma Key antiga de 16 dígitos.');
  }
  const keyRef = db.ref(`${paths.keys}/${keyValue}`);
  let latest = (await keyRef.get()).val();
  if (!latest || latest.deletedAt || latest.status === 'revoked') {
    return sendMessage(chatId, '❌ Key inexistente ou revogada. Confira os números.');
  }
  if (latest.status === 'active' && String(latest.userId) !== String(user.id)) {
    return sendMessage(chatId, '❌ Esta Key já está ativada em outra conta.');
  }
  if (latest.status !== 'available' && !(latest.status === 'active' && String(latest.userId) === String(user.id))) {
    return sendMessage(chatId, '❌ Esta Key não está disponível para ativação.');
  }
  if (latest.status === 'active' && Number(latest.expiresAt) <= Date.now()) {
    return sendMessage(chatId, '⌛ Esta Key já expirou. Solicite uma nova licença.');
  }
  if (latest.status === 'available' && !durationOfKey(latest)) {
    return sendMessage(chatId, '⚠️ Esta Key existe no Firebase, mas está sem duração válida. Peça ao administrador para verificar o cadastro da licença. Nenhum prazo começou a contar.');
  }

  const userRef = db.ref(`${paths.users}/${user.id}`);
  const existing = (await userRef.get()).val();
  if (existing?.licenseKey && existing.licenseKey !== keyValue && existing.accessActive) {
    const previous = (await db.ref(`${paths.keys}/${existing.licenseKey}`).get()).val();
    if (licenseStatus(previous) === 'active' && String(previous?.userId) === String(user.id)) {
      return sendMessage(chatId, 'ℹ️ Esta conta já possui outra licença ativa. Consulte /status antes de ativar outra.');
    }
  }

  // Reserve the target account to prevent concurrent activations of different keys.
  const now = Date.now();
  const reservation = await userRef.transaction(current => {
    const row = current || {};
    if (row.pendingLicenseKey && row.pendingLicenseKey !== keyValue &&
        now - Number(row.pendingActivationAt || 0) < 120000) return;
    if (row.accessActive && row.licenseKey && row.licenseKey !== keyValue &&
        Number(row.expiresAt || 0) > now) return;
    return { ...row, pendingLicenseKey: keyValue, pendingActivationAt: now };
  });
  if (!reservation.committed) {
    return sendMessage(chatId, '⏳ Esta conta já possui licença ativa ou há outra ativação em andamento.');
  }

  let activated = null;
  try {
    const activationResult = await keyRef.transaction(
      current => activationTransactionValue(current, user, now),
      undefined,
      false
    );
    if (activationResult.committed && activationResult.snapshot.val()?.status === 'active' &&
        String(activationResult.snapshot.val()?.userId) === String(user.id)) {
      activated = activationResult.snapshot.val();
    }
    latest = (await keyRef.get()).val();
    // Idempotent recovery if the first transaction succeeded but another step failed.
    if (!activated && latest?.status === 'active' && String(latest.userId) === String(user.id)) activated = latest;
    if (!activated) {
      if (latest?.status === 'active' && String(latest.userId) !== String(user.id)) {
        return sendMessage(chatId, '❌ Esta Key foi ativada em outra conta antes da confirmação.');
      }
      if (latest?.status === 'available' && !durationOfKey(latest)) {
        return sendMessage(chatId, '⚠️ Esta Key não possui duração válida no Firebase. Peça para o administrador corrigir o cadastro.');
      }
      if (latest?.status === 'available') {
        console.error('activation_transaction_not_committed', 'key_status_available', keyValue);
        return sendMessage(chatId, '⚠️ A Key continua disponível, mas o Firebase não confirmou a ativação. Tente novamente. Se persistir, envie o erro dos Logs ao administrador.');
      }
      return sendMessage(chatId, '❌ A Key mudou de status antes da ativação. Consulte o administrador.');
    }
    const expiresAt = Number(activated.expiresAt);
    if (expiresAt <= Date.now()) return sendMessage(chatId, '⌛ Esta licença já está expirada.');
    await userRef.update({ telegramId: String(user.id), username: user.username || null,
      firstName: user.first_name || null, licenseKey: keyValue, accessActive: true,
      activatedAt: activated.activatedAt, expiresAt, pendingLicenseKey: null,
      pendingActivationAt: null, updatedAt: Date.now() });
    await clearState(db, user.id);
    const text = `👑 𝗔𝗖𝗘𝗦𝗦𝗢 𝗟𝗜𝗕𝗘𝗥𝗔𝗗𝗢!\n\n${SEP}\n\n✅ KEY ATIVADA COM SUCESSO!\n\n🔑 Key: ${keyValue}\n🆔 ID vinculado: ${user.id}\n⏳ Validade: ${activated.durationLabel || formatRemaining(activated.durationMs)}\n📅 Vencimento: ${formatDate(expiresAt)}\n🟢 Status: ATIVA\n\n💬 Use /ia para conversar ou /codigo para criar códigos e projetos.`;
    return sendMessage(chatId, text);
  } finally {
    // Leave an activated user's link intact; only release a failed reservation.
    const snapshot = (await userRef.get()).val();
    if (snapshot?.pendingLicenseKey === keyValue) {
      await userRef.update({ pendingLicenseKey: null, pendingActivationAt: null });
    }
  }
}

async function requestApproval(db, chatId, requester, keyValue, targetId) {
  // Limit repeated requests even after a single valid Key has passed validation.
  if (!await checkKeyAttempts(db, requester.id)) {
    return sendMessage(chatId, '⏳ Muitas solicitações de ativação. Aguarde alguns minutos antes de tentar novamente.');
  }
  // Never activate somebody else's account solely from an ID typed into chat.
  // Telegram verifies the identity when the destination account presses a button.
  const requestId = randomBytes(12).toString('hex');
  const ref = db.ref(`${paths.activationRequests}/${targetId}/${requestId}`);
  await ref.set({ key: keyValue, requestedBy: String(requester.id), targetId,
    createdAt: Date.now(), expiresAt: Date.now() + ACTIVATION_REQUEST_TTL_MS,
    status: 'pending' });
  try {
    await sendMessage(targetId,
      `🔐 CONFIRMAÇÃO DE LICENÇA MESTREXIT.IA\n\nUm usuário solicitou ativar a Key ${keyValue} na SUA conta (ID ${targetId}).\n\nA validade só começará se você confirmar. Se não reconhecer a solicitação, recuse.\n\n⏳ Solicitação válida por 15 minutos.`,
      { reply_markup: keyboard([[
        { text: '✅ CONFIRMAR NA MINHA CONTA', callback_data: `u:approve:${requestId}` },
        { text: '❌ RECUSAR', callback_data: `u:deny:${requestId}` }
      ]]) });
  } catch (error) {
    await ref.remove();
    console.error('activation_request_delivery_failed', error.message);
    return sendMessage(chatId, '⚠️ Não consegui enviar a confirmação para esse ID. A pessoa precisa primeiro abrir uma conversa privada com o MestreXit.ia e enviar /start. Depois, envie o ID novamente. A Key ainda não foi ativada.');
  }
  await clearState(db, requester.id);
  return sendMessage(chatId, `📩 Enviamos a solicitação ao ID ${targetId}.\n\nA pessoa deverá confirmar no próprio Telegram em até 15 minutos. ⏳ O tempo da Key ainda NÃO começou a contar.`);
}

async function decideApproval(db, chatId, user, requestId, approve) {
  if (!/^[a-f0-9]{24}$/.test(requestId)) return sendMessage(chatId, 'Solicitação inválida.');
  const ref = db.ref(`${paths.activationRequests}/${user.id}/${requestId}`);
  const snapshot = (await ref.get()).val();
  if (!snapshot || snapshot.status !== 'pending') return sendMessage(chatId, 'Esta solicitação não está pendente.');
  if (Number(snapshot.expiresAt) <= Date.now()) {
    await ref.remove();
    return sendMessage(chatId, '⌛ A solicitação expirou. Peça uma nova ativação.');
  }
  if (String(snapshot.targetId) !== String(user.id)) return sendMessage(chatId, 'Essa solicitação não pertence à sua conta.');
  const claimed = await ref.transaction(current => {
    if (!current || current.status !== 'pending' || Number(current.expiresAt) <= Date.now()) return;
    return { ...current, status: approve ? 'processing' : 'denied', updatedAt: Date.now() };
  });
  if (!claimed.committed) return sendMessage(chatId, 'A solicitação já foi utilizada ou expirou.');
  if (!approve) {
    await sendMessage(chatId, '❌ Você recusou a ativação. Nenhuma licença foi ativada.');
    await sendMessage(snapshot.requestedBy, `❌ O ID ${user.id} recusou a ativação da Key ${snapshot.key}.`).catch(() => {});
    return;
  }
  try {
    await activate(db, chatId, user, snapshot.key);
    const checkedKey = (await db.ref(`${paths.keys}/${snapshot.key}`).get()).val();
    if (checkedKey?.status === 'active' && String(checkedKey.userId) === String(user.id)) {
      await ref.update({ status: 'completed', completedAt: Date.now() });
      await sendMessage(snapshot.requestedBy,
        `✅ O ID ${user.id} confirmou e ativou a Key ${snapshot.key}. A validade começou agora.`).catch(() => {});
    } else {
      await ref.update({ status: 'failed', failedAt: Date.now() });
    }
  } catch (error) {
    await ref.update({ status: 'pending', lastErrorAt: Date.now() });
    throw error;
  }
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
    const base = (process.env.OPENAI_BASE_URL || 'https://api.groq.com/openai/v1').replace(/\/$/, '');
    const response = await fetch(`${base}/chat/completions`, {
      method: 'POST', headers: { authorization: `Bearer ${process.env.OPENAI_API_KEY}`, 'content-type': 'application/json' },
      body: JSON.stringify({ model: process.env.OPENAI_MODEL || 'openai/gpt-oss-20b', messages, temperature: 0.7 }),
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
    const msg = error.name === 'TimeoutError' || error.name === 'AbortError' ? '⌛ A resposta demorou mais que o limite do provedor. Tente novamente com uma solicitação mais curta.' : error.status === 429 ? '⚠️ O GroqCloud retornou limite de uso (429). Pode ser limite por minuto, por dia ou de créditos. Confira Usage/Limits no painel GroqCloud e tente novamente.' : '⚠️ Não consegui acessar a IA agora. Verifique a configuração do provedor ou tente novamente em instantes.';
    await sendMessage(chatId, msg);
  }
}

async function startGeneration(db, chatId, user, origin = null) {
  const items = Object.entries(DURATIONS);
  const rows = [];
  for (let i = 0; i < items.length; i += 2) {
    rows.push(items.slice(i, i + 2).map(([id, item]) => ({ text: `⏱ ${item.label}`, callback_data: `g:d:${id}` })));
  }
  rows.push([{ text: '✏️ DURAÇÃO PERSONALIZADA', callback_data: 'a:custom' }]);
  rows.push(backAdmin);
  await setState(db, user.id, { stage: 'choose_duration' });
  return showPanel(chatId, `🔑 GERAR KEYS\n\nEscolha uma das ${items.length} durações ou informe uma personalizada.\nÉ possível gerar quantos lotes desejar.`, rows, origin);
}

function generationMax() {
  return Math.max(1, Math.min(50, Math.trunc(Number(process.env.MAX_KEYS_PER_GENERATION || 30) || 30)));
}

async function createKeys(db, chatId, user, durationId, quantity, opts = {}) {
  const duration = durationId === 'custom' ? opts.customDuration : DURATIONS[durationId];
  const max = generationMax();
  const origin = opts.origin || null;
  if (!duration || !Number.isSafeInteger(Number(duration.ms)) || Number(duration.ms) < 15 * 60000 ||
      !Number.isInteger(quantity) || quantity < 1 || quantity > max) {
    return showPanel(chatId, `❌ Quantidade inválida. Informe um número de 1 a ${max}.`, [backAdmin], origin);
  }
  const created = [];
  for (let i = 0; i < quantity; i++) {
    let saved = false;
    for (let attempt = 0; attempt < 16 && !saved; attempt++) {
      const keyValue = String(randomInt(0, 1_000_000)).padStart(6, '0');
      const ref = db.ref(`${paths.keys}/${keyValue}`);
      const record = { key: keyValue, status: 'available', durationId, durationLabel: duration.label, durationMs: duration.ms, createdAt: Date.now(), createdBy: String(user.id) };
      const result = await ref.transaction(current => current ? undefined : record);
      if (result.committed) { saved = true; created.push(result.snapshot.val()); }
    }
    if (!saved) {
      console.error('generation_partial_success', created.length, quantity);
      break; // Não perder as Keys já geradas. Continuam acessíveis pela lista.
    }
  }
  await appendAdminAction(db, user.id, 'generate_keys', { durationId, durationMs: duration.ms, quantity: created.length, keys: created.map(item => item.key) });
  await setState(db, user.id, { stage: 'admin_home' });
  const lines = created.map(item => `🔑 ${item.key}`).join('\n');
  const text = `✅ ${created.length} DE ${quantity} KEYS GERADAS\n\n⏱ Duração: ${duration.label}\n🟢 Status: DISPONÍVEIS\n\n${lines}\n\nToque em LISTA DE KEYS para abrir qualquer uma, copiá-la ou revogá-la pela própria mensagem. É possível gerar novos lotes, sem limite de 8 Keys no total.`;
  return showPanel(chatId, text, [
    [{ text: '📋 LISTA DE KEYS', callback_data: 'l:all:' }, { text: '🔑 GERAR MAIS', callback_data: 'a:gen' }],
    backAdmin,
    [{ text: '🏠 MENU NORMAL', callback_data: 'u:home' }]
  ], origin);
}

// Firebase DataSnapshot.forEach expects `false`/`undefined` to keep iterating.
// Never return Array.push() from its callback: that method returns a number.
// A secondary completeness check safeguards against truncated key lists.
function compareFirebaseKey(a, b) {
  const intKey = value => {
    if (!/^(0|[1-9]\d*)$/.test(value)) return null;
    const numeric = Number(value);
    return Number.isInteger(numeric) && numeric >= 0 && numeric <= 2147483647 ? numeric : null;
  };
  const aInt = intKey(a);
  const bInt = intKey(b);
  if (aInt !== null && bInt !== null) return aInt - bInt;
  if (aInt !== null) return -1;
  if (bInt !== null) return 1;
  return a < b ? -1 : a > b ? 1 : 0;
}

function keyEntriesFromSnapshot(snapshot) {
  const entries = [];
  snapshot.forEach(child => {
    entries.push({ key: String(child.key), value: child.val() });
    return false;
  });
  // Some SDK adapters can prematurely stop iteration; never hide records.
  const count = snapshot.numChildren?.();
  if (Number.isInteger(count) && entries.length < count) {
    const raw = snapshot.val();
    if (raw && typeof raw === 'object') {
      console.warn('admin_key_list_incomplete_iteration', entries.length, count);
      return Object.entries(raw)
        .map(([key, value]) => ({ key, value }))
        .sort((a, b) => compareFirebaseKey(a.key, b.key));
    }
  }
  return entries;
}

async function listKeys(db, chatId, filter, cursor = '', origin = null) {
  // Avança sobre chaves que não correspondem ao filtro e coleta até 9,
  // para identificar se existe próxima página sem esconder registros futuros.
  const found = [];
  let scanCursor = cursor;
  let done = false;
  while (!done && found.length < 9) {
    const snap = await (scanCursor
      ? db.ref(paths.keys).orderByKey().startAt(scanCursor).limitToFirst(101).get()
      : db.ref(paths.keys).orderByKey().limitToFirst(100).get());
    const entries = keyEntriesFromSnapshot(snap);
    if (scanCursor && entries[0]?.key === scanCursor) entries.shift();
    if (!entries.length) break;
    for (const entry of entries) {
      if (filter === 'all' || licenseStatus(entry.value) === filter) found.push(entry);
      if (found.length >= 9) break;
    }
    const lastScanned = entries.at(-1)?.key;
    done = entries.length < 100 || !lastScanned || lastScanned === scanCursor;
    scanCursor = lastScanned;
  }
  const page = found.slice(0, 8);
  const hasMore = found.length > 8;
  const title = filter === 'all' ? '📋 LISTA DE KEYS' : `📋 KEYS ${statusLabel(filter)}`;
  const lines = page.map(({ key, value }) => `🔑 ${key} | ${statusLabel(licenseStatus(value))} | ${value.durationLabel || formatRemaining(durationOfKey(value))} | ID ${value.userId || '—'}`);
  const buttons = page.map(({ key }) => [{ text: `🔎 ${key}`, callback_data: `k:${key}` }]);
  const nav = [];
  if (cursor) nav.push({ text: '⏮ PRIMEIRA PÁGINA', callback_data: `l:${filter}:` });
  if (hasMore && page.length) nav.push({ text: '➡️ PRÓXIMA', callback_data: `l:${filter}:${page.at(-1).key}` });
  if (nav.length) buttons.push(nav);
  buttons.push([{ text: '🔑 GERAR MAIS', callback_data: 'a:gen' }, { text: '🔙 PAINEL ADM', callback_data: 'a:home' }]);
  return showPanel(chatId, `${title}\n\n${lines.length ? lines.join('\n') : 'Nenhuma Key encontrada.'}\n\n8 exibidas por página; as demais ficam acessíveis em PRÓXIMA. Não existe limite total de 8 Keys.`, buttons, origin);
}

async function showKey(db, chatId, keyValue, origin = null, notice = '') {
  const key = (await db.ref(`${paths.keys}/${keyValue}`).get()).val();
  if (!key) return showPanel(chatId, '🗑️ Esta Key não existe mais no Firebase. Ela pode ter sido excluída.', [
    { text: '🔙 LISTA DE KEYS', callback_data: 'l:all:' },
    { text: '👑 PAINEL ADM', callback_data: 'a:home' }
  ], origin);
  const status = licenseStatus(key);
  const text = `🔑 KEY: ${keyValue}\n📅 Criada: ${formatDate(key.createdAt)}\n⏳ Duração: ${key.durationLabel || formatRemaining(key.durationMs)}\n📊 Status: ${statusLabel(status)}\n🆔 ID: ${key.userId || '—'}\n👤 Username: ${key.username ? '@' + key.username : '—'}\n✅ Ativada: ${formatDate(key.activatedAt)}\n⌛ Restante: ${status === 'active' || status === 'paused' ? formatRemaining(remainingMs(key)) : '—'}\n📅 Vencimento: ${formatDate(key.expiresAt)}`;
  const rows = [[copyButton('📋 COPIAR KEY', keyValue)]];
  if (status === 'active') rows.push([{ text: '⏸ PAUSAR KEY', callback_data: `o:pause:${keyValue}` }]);
  if (status === 'paused') rows.push([{ text: '▶️ RETOMAR KEY', callback_data: `o:resume:${keyValue}` }]);
  if (status !== 'revoked') rows.push([{ text: '🔄 RESETAR KEY', callback_data: `x:reset:${keyValue}` }, { text: '🗑 EXCLUIR KEY', callback_data: `x:delete:${keyValue}` }]);
  else rows.push([{ text: '🗑 EXCLUIR DEFINITIVAMENTE', callback_data: `x:delete:${keyValue}` }]);
  rows.push([{ text: '🔙 LISTA', callback_data: 'l:all:' }, { text: 'PAINEL ADM', callback_data: 'a:home' }]);
  const body = notice ? `${notice}\n\n${text}` : text;
  return showPanel(chatId, body, rows, origin);
}

async function confirmKeyAction(db, chatId, user, action, keyValue, origin = null) {
  const text = action === 'delete'
    ? `⚠️ EXCLUSÃO DEFINITIVA\n\nDeseja apagar a Key ${keyValue} também do Firebase Realtime Database?\n\n❌ Ela desaparecerá de /keys e da Lista de Keys.\n🔒 Se estiver ativa, o acesso do usuário será encerrado.\n⚠️ Esta ação não pode ser desfeita. Um registro administrativo mínimo ficará em /adminActions.`
    : `⚠️ RESETAR KEY\n\nDeseja resetar a Key ${keyValue}? A mesma Key ficará disponível para nova ativação e o vínculo anterior será encerrado.`;
  const extra = { reply_markup: keyboard([[{ text: '✅ CONFIRMAR', callback_data: `c:${action}:${keyValue}` }, { text: '❌ CANCELAR', callback_data: `k:${keyValue}` }]]) };
  return showPanel(chatId, text, extra.reply_markup.inline_keyboard, origin);
}

async function mutateKey(db, chatId, user, action, keyValue, origin = null) {
  const ref = db.ref(`${paths.keys}/${keyValue}`);
  const snap = await ref.get();
  const old = snap.val();
  if (!old) return showPanel(chatId, '🗑️ Essa Key já não existe no Firebase.', [
    { text: '🔙 LISTA DE KEYS', callback_data: 'l:all:' },
    { text: '👑 PAINEL ADM', callback_data: 'a:home' }
  ], origin);

  // EXCLUIR significa APAGAR O NÓ no Firebase, não apenas marcar "revoked".
  // A transação evita que outra operação de ativação restaure o registro
  // durante a exclusão. O histórico do evento vai para /adminActions.
  if (action === 'delete') {
    const now = Date.now();
    const deleted = await ref.transaction(() => null, undefined, false);
    if (!deleted.committed) {
      return showPanel(chatId, '⚠️ Não foi possível excluir a Key do Firebase. Tente novamente.', [backAdmin], origin);
    }
    // Se pertencia a alguém, retirar o vínculo da conta sem excluir o usuário.
    // Nunca desativar uma licença MAIS NOVA pertencente à mesma conta.
    if (old.userId) {
      const ownerRef = db.ref(`${paths.users}/${old.userId}`);
      const owner = (await ownerRef.get()).val();
      if (owner && String(owner.licenseKey) === String(keyValue)) {
        await ownerRef.update({ licenseKey: null, accessActive: false, expiresAt: null,
          pendingLicenseKey: null, pendingActivationAt: null, updatedAt: now });
      }
    }
    await appendAdminAction(db, user.id, 'delete_permanently', {
      key: keyValue, previousStatus: old.status || 'unknown',
      previousUserId: old.userId ? String(old.userId) : null
    });
    return showPanel(chatId,
      `✅ KEY ${keyValue} EXCLUÍDA DEFINITIVAMENTE!\n\n🗑️ Removida de /keys no Firebase.\n📋 Não aparecerá mais na Lista de Keys.\n🔒 Se havia licença vinculada a ela, o acesso foi desativado.\n🧾 Somente o registro da ação administrativa foi preservado.`,
      [{ text: '📋 LISTA DE KEYS', callback_data: 'l:all:' },
       { text: '👑 PAINEL ADM', callback_data: 'a:home' }], origin);
  }

  if (action === 'pause' || action === 'resume' || action === 'reset') {
    const now = Date.now();
    const result = await ref.transaction(current => {
      if (!current) return;
      if (action === 'pause') return pauseKey(current, now) || undefined;
      if (action === 'resume') return resumeKey(current, now) || undefined;
      if (action === 'reset') return resetKey(current, now) || undefined;
    });
    const fresh = (await ref.get()).val();
    if (!result.committed) return showPanel(chatId, 'A ação não pôde ser aplicada ao status atual da Key.', [backAdmin], origin);
    if (old.userId && ['pause', 'resume', 'reset'].includes(action)) {
      const profilePatch = action === 'pause'
        ? { accessActive: false }
        : action === 'resume'
          ? { accessActive: true, expiresAt: fresh.expiresAt }
          : { licenseKey: null, accessActive: false, expiresAt: null };
      const ownerRef = db.ref(`${paths.users}/${old.userId}`);
      const owner = (await ownerRef.get()).val();
      // Do not remove an unrelated newer licence from the same account.
      if (owner?.licenseKey === keyValue) {
        await ownerRef.update({ ...profilePatch, updatedAt: now });
      }
    }
    await appendAdminAction(db, user.id, action, { key: keyValue, previousStatus: old.status });
    const label = { pause: 'pausada', resume: 'retomada', reset: 'resetada e liberada para nova ativação' }[action];
    const notice = `✅ Key ${label}.`;
    return showKey(db, chatId, keyValue, origin, notice);
  }
}

async function showStats(db, chatId, origin = null) {
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
  return showPanel(chatId, text, [backAdmin], origin);
}

async function showActiveUsers(db, chatId, origin = null) {
  const snap = await db.ref(paths.users).orderByChild('accessActive').equalTo(true).limitToFirst(51).get();
  const rows = [];
  snap.forEach(child => { const u = child.val(); rows.push(`🆔 ${child.key} | ${u.username ? '@' + u.username : userName({ first_name: u.firstName })} | Key: ${u.licenseKey || '—'} | venc.: ${formatDate(u.expiresAt)}`); });
  return showPanel(chatId, `👥 USUÁRIOS ATIVOS (50 exibidos)\n\n${rows.slice(0, 50).join('\n') || 'Nenhum usuário ativo.'}`, [backAdmin], origin);
}

async function showAdmin(chatId, user, origin = null) {
  if (!isAdmin(user.id)) return sendMessage(chatId, '🚫 ACESSO NEGADO!\n\n🔒 Esta área é exclusiva do administrador.');
  return showPanel(chatId, `👑 PAINEL ADM — MESTREXIT.IA\n\n🔐 Acesso exclusivo do administrador.\n\nEscolha uma opção; este painel será atualizado sem acumular mensagens.`, adminKeyboard().inline_keyboard, origin);
}

async function help(chatId) {
  return sendMessage(chatId, `👑 MESTREXIT.IA — AJUDA\n\n/key — ativar uma Key\n/id — mostrar e copiar seu ID\n/ia sua pergunta — conversar com a IA\n/codigo descrição — criar códigos, sites e projetos\n/status — consultar licença\n/limpar — apagar seu histórico de conversa\n/admin — painel administrativo autorizado\n/start — apresentação e menu\n\nApós ativar uma licença, você também pode enviar mensagens normalmente.`);
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
  if (name === 'start') return home(chatId, user);
  if (name === 'key') return beginKey(chatId, user.id, db);
  if (name === 'id' || name === 'meuid') return showMyId(chatId, user);
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
  if (name === 'codigo' || name === 'code') {
    const allowed = await access(db, user.id);
    if (!allowed.ok) return denied(chatId, allowed.reason);
    if (!arg.trim()) return sendMessage(chatId, '💻 Descreva o programa desejado. Exemplo: /codigo crie uma calculadora em JavaScript.');
    return aiReply(db, chatId, user, `Pedido de programação: ${arg}\nResponda com código funcional, linguagem identificada, instruções claras para executar e explicação objetiva.`);
  }
  if (name === 'imagem' || name === 'image') {
    // Compatibilidade com comandos antigos: a geração de imagens foi removida.
    return sendMessage(chatId, 'ℹ️ Este bot agora trabalha somente com texto e programação. Use /ia ou /codigo para pedir códigos, sites e explicações.');
  }
  const current = await state(db, user.id);
  if (current.stage === 'await_key') {
    if (!await checkKeyAttempts(db, user.id)) return sendMessage(chatId, '⏳ Muitas tentativas. Aguarde alguns minutos antes de tentar novamente.');
    if (!validKeyFormat(raw)) return sendMessage(chatId, '❌ KEY INVÁLIDA!\n\n🔑 Informe 6 dígitos numéricos (ou 16, se for uma Key antiga).');
    const key = (await db.ref(`${paths.keys}/${raw}`).get()).val();
    if (!key || key.status !== 'available' || key.deletedAt) return sendMessage(chatId, '❌ KEY INVÁLIDA OU INDISPONÍVEL!\n\n🔑 Confira os números e tente novamente.');
    return requestId(chatId, user, db, raw);
  }
  if (current.stage === 'await_id') {
    if (!validTelegramId(raw)) return sendMessage(chatId, '❌ ID inválido. Envie apenas o número do ID do Telegram (de 5 a 15 dígitos).');
    if (validManualId(raw, user.id)) return activate(db, chatId, user, current.key);
    return requestApproval(db, chatId, user, current.key, raw);
  }
  if (current.stage === 'await_custom_duration') {
    if (!isAdmin(user.id)) return sendMessage(chatId, '🚫 Acesso negado.');
    const chosen = parseCustomDuration(raw);
    if (!chosen) return sendMessage(chatId, '⚠️ Duração inválida. Exemplos: 45m, 5h ou 120d (de 15 minutos a 3650 dias).');
    await setState(db, user.id, { stage: 'await_quantity', durationId: 'custom', customDuration: chosen, panelMessageId: current.panelMessageId });
    if (message.message_id) await deleteMessage(chatId, message.message_id).catch(() => {});
    return showPanel(chatId, `✏️ Duração personalizada: ${chosen.label}\n\nQuantas Keys deseja gerar? Envie um número entre 1 e ${generationMax()}.`, [backAdmin], current.panelMessageId ? { message_id: current.panelMessageId, text: true } : null);
  }
  if (current.stage === 'await_quantity') {
    if (!isAdmin(user.id)) return sendMessage(chatId, '🚫 Acesso negado.');
    const quantity = Number(raw);
    if (!Number.isInteger(quantity) || quantity < 1 || quantity > generationMax())
      return sendMessage(chatId, `❌ Quantidade inválida: envie de 1 a ${generationMax()}.`);
    await clearState(db, user.id);
    const origin = current.panelMessageId ? { message_id: current.panelMessageId, text: true } : null;
    const result = await createKeys(db, chatId, user, current.durationId, quantity, { origin, customDuration: current.customDuration });
    if (message.message_id) await deleteMessage(chatId, message.message_id).catch(() => {});
    return result;
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
  if (data === 'u:cancel') {
    await clearState(db, user.id);
    return sendMessage(chatId, '✅ Ativação cancelada. Nenhuma Key foi ativada e nenhum prazo começou a contar.');
  }
  if (data === 'u:showid') return showMyId(chatId, user);
  if (data.startsWith('u:approve:')) return decideApproval(db, chatId, user, data.slice('u:approve:'.length), true);
  if (data.startsWith('u:deny:')) return decideApproval(db, chatId, user, data.slice('u:deny:'.length), false);
  if (data === 'u:home') {
    await clearState(db, user.id);
    return showNormalMenu(chatId, user, callback.message);
  }
  if (data === 'a:home') {
    await clearState(db, user.id);
    return showAdmin(chatId, user, callback.message);
  }
  if (data === 'a:gen') return startGeneration(db, chatId, user, callback.message);
  if (data === 'a:stats') return showStats(db, chatId, callback.message);
  if (data === 'a:users') return showActiveUsers(db, chatId, callback.message);
  if (data === 'a:custom') {
    await setState(db, user.id, { stage: 'await_custom_duration', panelMessageId: callback.message.message_id });
    return showPanel(chatId, '✏️ DURAÇÃO PERSONALIZADA\n\nEnvie uma duração: 45m (minutos), 5h (horas) ou 120d (dias).\n\nMínimo: 15 minutos; máximo: 3650 dias.', [backAdmin], callback.message);
  }
  if (data.startsWith('g:d:')) {
    const durationId = data.slice(4);
    if (!DURATIONS[durationId]) return sendMessage(chatId, 'Duração inválida.');
    await setState(db, user.id, { stage: 'await_quantity', durationId, panelMessageId: callback.message.message_id });
    return showPanel(chatId, `⏱ Duração: ${DURATIONS[durationId].label}\n\nQuantas Keys deseja gerar? Envie um número de 1 a ${generationMax()}.`, [backAdmin], callback.message);
  }
  if (data.startsWith('l:')) {
    const [, filter = 'all', cursor = ''] = data.split(':');
    if (!['all', 'active', 'available', 'paused', 'expired', 'revoked'].includes(filter)) return sendMessage(chatId, 'Filtro inválido.');
    return listKeys(db, chatId, filter, cursor, callback.message);
  }
  if (data.startsWith('k:')) return showKey(db, chatId, data.slice(2), callback.message);
  if (data.startsWith('o:')) {
    const [, action, keyValue] = data.split(':');
    if (!validKeyFormat(keyValue)) return sendMessage(chatId, 'Key inválida.');
    return mutateKey(db, chatId, user, action, keyValue, callback.message);
  }
  if (data.startsWith('x:')) {
    const [, action, keyValue] = data.split(':');
    if (!['reset', 'delete'].includes(action) || !validKeyFormat(keyValue)) return sendMessage(chatId, 'Ação inválida.');
    return confirmKeyAction(db, chatId, user, action, keyValue, callback.message);
  }
  if (data.startsWith('c:')) {
    const [, action, keyValue] = data.split(':');
    if (!['reset', 'delete'].includes(action) || !validKeyFormat(keyValue)) return sendMessage(chatId, 'Ação inválida.');
    return mutateKey(db, chatId, user, action, keyValue, callback.message);
  }
  return sendMessage(chatId, 'Opção não reconhecida. Use /start.');
}

export async function processUpdate(update) {
  const db = database();
  if (update.message) return handleMessage(db, update.message);
  if (update.callback_query) return handleCallback(db, update.callback_query);
}
