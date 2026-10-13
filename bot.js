import { randomInt, randomBytes } from 'node:crypto';
import { database, paths, appendAdminAction } from './firebase.js';
import { answerCallback, editMessage, sendChatAction, sendMessage, sendPhotoAsset, sendPhotoBytes } from './telegram-api.js';
import {
  ADMIN_ID, DURATIONS, activationTransactionValue, durationOfKey, formatDate, formatRemaining, isAdmin, licenseStatus,
  pauseKey, remainingMs, resetKey, resumeKey, validKeyFormat, validManualId, validTelegramId
} from './core.js';

const SEP = '━━━━━━━━━━━━━━━━━━';
const keyboard = rows => ({ inline_keyboard: rows });
const copyButton = (label, value) => ({ text: label, copy_text: { text: String(value) } });
const ACTIVATION_REQUEST_TTL_MS = 15 * 60 * 1000;
const mainKeyboard = () => keyboard([
  [{ text: '🔑 INSERIR KEY', callback_data: 'u:key' }],
  [{ text: '🆔 MOSTRAR MEU ID', callback_data: 'u:showid' }],
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
    const text = `👑 𝗔𝗖𝗘𝗦𝗦𝗢 𝗟𝗜𝗕𝗘𝗥𝗔𝗗𝗢!\n\n${SEP}\n\n✅ KEY ATIVADA COM SUCESSO!\n\n🔑 Key: ${keyValue}\n🆔 ID vinculado: ${user.id}\n⏳ Validade: ${activated.durationLabel || formatRemaining(activated.durationMs)}\n📅 Vencimento: ${formatDate(expiresAt)}\n🟢 Status: ATIVA\n\n💬 Use /ia e 🎨 /imagem para aproveitar a licença.`;
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
  const max = Math.min(20, Math.max(1, Number(process.env.MAX_KEYS_PER_GENERATION || 6)));
  if (!duration || !Number.isInteger(quantity) || quantity < 1 || quantity > max) return sendMessage(chatId, `❌ Quantidade inválida. Informe um número de 1 a ${max}.`);
  const created = [];
  for (let i = 0; i < quantity; i++) {
    let saved = false;
    for (let attempt = 0; attempt < 8 && !saved; attempt++) {
      const keyValue = String(randomInt(0, 1_000_000)).padStart(6, '0');
      const ref = db.ref(`${paths.keys}/${keyValue}`);
      const record = { key: keyValue, status: 'available', durationId, durationLabel: duration.label, durationMs: duration.ms, createdAt: Date.now(), createdBy: String(user.id) };
      const result = await ref.transaction(current => current ? undefined : record);
      if (result.committed) { saved = true; created.push(result.snapshot.val()); }
    }
    if (!saved) throw new Error('Não foi possível reservar uma Key única após várias tentativas.');
  }
  await appendAdminAction(db, user.id, 'generate_keys', { durationId, quantity, keys: created.map(item => item.key) });
  for (const item of created) await sendMessage(chatId, `👑 KEY GERADA!\n\n${SEP}\n\n🔑 KEY: ${item.key}\n⏳ DURAÇÃO: ${item.durationLabel}\n🟢 STATUS: DISPONÍVEL\n📅 CRIAÇÃO: ${formatDate(item.createdAt)}\n\n${SEP}`, { reply_markup: keyboard([
    [copyButton('📋 COPIAR KEY', item.key)],
    [{ text: '🗑 EXCLUIR ESTA KEY', callback_data: `x:delete:${item.key}` }]
  ]) });
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

async function showKey(db, chatId, keyValue, messageId = null, notice = '') {
  const key = (await db.ref(`${paths.keys}/${keyValue}`).get()).val();
  if (!key) return sendMessage(chatId, 'Key não encontrada.');
  const status = licenseStatus(key);
  const text = `🔑 KEY: ${keyValue}\n📅 Criada: ${formatDate(key.createdAt)}\n⏳ Duração: ${key.durationLabel || formatRemaining(key.durationMs)}\n📊 Status: ${statusLabel(status)}\n🆔 ID: ${key.userId || '—'}\n👤 Username: ${key.username ? '@' + key.username : '—'}\n✅ Ativada: ${formatDate(key.activatedAt)}\n⌛ Restante: ${status === 'active' || status === 'paused' ? formatRemaining(remainingMs(key)) : '—'}\n📅 Vencimento: ${formatDate(key.expiresAt)}`;
  const rows = [[copyButton('📋 COPIAR KEY', keyValue)]];
  if (status === 'active') rows.push([{ text: '⏸ PAUSAR KEY', callback_data: `o:pause:${keyValue}` }]);
  if (status === 'paused') rows.push([{ text: '▶️ RETOMAR KEY', callback_data: `o:resume:${keyValue}` }]);
  if (status !== 'revoked') rows.push([{ text: '🔄 RESETAR KEY', callback_data: `x:reset:${keyValue}` }, { text: '🗑 EXCLUIR KEY', callback_data: `x:delete:${keyValue}` }]);
  rows.push([{ text: '🔙 LISTA', callback_data: 'l:all:' }, { text: 'PAINEL ADM', callback_data: 'a:home' }]);
  const body = notice ? `${notice}\n\n${text}` : text;
  const extra = { reply_markup: keyboard(rows) };
  return messageId ? editMessage(chatId, messageId, body, extra) : sendMessage(chatId, body, extra);
}

async function confirmKeyAction(db, chatId, user, action, keyValue, messageId = null) {
  const verb = action === 'reset' ? 'resetar' : 'revogar';
  const text = `⚠️ Confirma que deseja ${verb} a Key ${keyValue}?\n\nAo excluir, a Key será revogada no Firebase e deixará de funcionar. O registro será mantido para auditoria.`;
  const extra = { reply_markup: keyboard([[{ text: '✅ CONFIRMAR', callback_data: `c:${action}:${keyValue}` }, { text: '❌ CANCELAR', callback_data: `k:${keyValue}` }]]) };
  return messageId ? editMessage(chatId, messageId, text, extra) : sendMessage(chatId, text, extra);
}

async function mutateKey(db, chatId, user, action, keyValue, messageId = null) {
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
      if (action === 'delete') {
        if (current.deletedAt || current.status === 'revoked') return;
        return { ...current, status: 'revoked', deletedAt: now, revokedAt: now, userId: null, username: null, remainingMs: 0, expiresAt: null, updatedAt: now };
      }
    });
    const fresh = (await ref.get()).val();
    if (!result.committed) return sendMessage(chatId, 'A ação não pôde ser aplicada ao status atual da Key.');
    if (old.userId && ['pause', 'resume', 'reset', 'delete'].includes(action)) {
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
    const label = { pause: 'pausada', resume: 'retomada', reset: 'resetada e liberada para nova ativação', delete: 'revogada e excluída do uso' }[action];
    const notice = `✅ Key ${label}.`;
    if (messageId) return showKey(db, chatId, keyValue, messageId, notice);
    await sendMessage(chatId, notice);
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
  return sendMessage(chatId, `👑 MESTREXIT.IA — AJUDA\n\n/key — ativar uma Key\n/id — mostrar e copiar seu ID\n/ia sua pergunta — conversar com a IA\n/imagem descrição — gerar uma imagem\n/status — consultar licença\n/limpar — apagar seu histórico de conversa\n/admin — painel administrativo autorizado\n/start — apresentação e menu\n\nApós ativar uma licença, você também pode enviar mensagens normalmente.`);
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
  if (name === 'imagem') {
    const allowed = await access(db, user.id);
    if (!allowed.ok) return denied(chatId, allowed.reason);
    return generateImage(db, chatId, user, arg);
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
  if (data === 'u:cancel') {
    await clearState(db, user.id);
    return sendMessage(chatId, '✅ Ativação cancelada. Nenhuma Key foi ativada e nenhum prazo começou a contar.');
  }
  if (data === 'u:showid') return showMyId(chatId, user);
  if (data.startsWith('u:approve:')) return decideApproval(db, chatId, user, data.slice('u:approve:'.length), true);
  if (data.startsWith('u:deny:')) return decideApproval(db, chatId, user, data.slice('u:deny:'.length), false);
  if (data === 'u:home') return home(chatId);
  if (data === 'a:home') return showAdmin(chatId, user);
  if (data === 'a:gen') return startGeneration(db, chatId, user);
  if (data === 'a:stats') return showStats(db, chatId);
  if (data === 'a:users') return showActiveUsers(db, chatId);
  if (data.startsWith('g:d:')) {
    const durationId = data.slice(4);
    if (!DURATIONS[durationId]) return sendMessage(chatId, 'Duração inválida.');
    await setState(db, user.id, { stage: 'await_quantity', durationId });
    return sendMessage(chatId, `⏱ Duração: ${DURATIONS[durationId].label}\n\nQuantas Keys deseja gerar? Informe um número entre 1 e ${Math.min(20, Number(process.env.MAX_KEYS_PER_GENERATION || 6))}.`);
  }
  if (data.startsWith('l:')) {
    const [, filter = 'all', cursor = ''] = data.split(':');
    if (!['all', 'active', 'available', 'paused', 'expired', 'revoked'].includes(filter)) return sendMessage(chatId, 'Filtro inválido.');
    return listKeys(db, chatId, filter, cursor);
  }
  if (data.startsWith('k:')) return showKey(db, chatId, data.slice(2), callback.message?.message_id);
  if (data.startsWith('o:')) {
    const [, action, keyValue] = data.split(':');
    if (!validKeyFormat(keyValue)) return sendMessage(chatId, 'Key inválida.');
    return mutateKey(db, chatId, user, action, keyValue, callback.message?.message_id);
  }
  if (data.startsWith('x:')) {
    const [, action, keyValue] = data.split(':');
    if (!['reset', 'delete'].includes(action) || !validKeyFormat(keyValue)) return sendMessage(chatId, 'Ação inválida.');
    return confirmKeyAction(db, chatId, user, action, keyValue, callback.message?.message_id);
  }
  if (data.startsWith('c:')) {
    const [, action, keyValue] = data.split(':');
    if (!['reset', 'delete'].includes(action) || !validKeyFormat(keyValue)) return sendMessage(chatId, 'Ação inválida.');
    return mutateKey(db, chatId, user, action, keyValue, callback.message?.message_id);
  }
  return sendMessage(chatId, 'Opção não reconhecida. Use /start.');
}

export async function processUpdate(update) {
  const db = database();
  if (update.message) return handleMessage(db, update.message);
  if (update.callback_query) return handleCallback(db, update.callback_query);
}
