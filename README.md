# MestreXit.ia — texto e programação com GroqCloud

Projeto para Telegram, Vercel e Firebase Realtime Database. **Não gera imagens por IA.** Os arquivos `logo.png` e `tutorial-id.png` são imagens estáticas usadas na apresentação e nas instruções de ID; não são geração de imagens.

## Comandos

- `/start` — apresentação e botões de acesso.
- `/key` — ativar licença numérica vinculada ao Telegram ID (6 dígitos; antigas de 16 continuam aceitas).
- `/id` — mostrar e copiar seu ID do Telegram.
- `/status` — conferir vencimento de sua licença.
- `/ia sua pergunta` — conversar, explicar e responder dúvidas.
- `/codigo descrição` — criar, revisar e explicar código, sites e projetos de programação.
- `/limpar` — apagar seu histórico de conversa.
- `/ajuda` — consultar instruções.
- `/admin` — painel apenas para conta autorizada, geração, listagem, pausa, reset e exclusão real de Keys no Firebase.

Mensagens comuns também são enviadas à IA se a licença do usuário estiver ativa. `/imagem` apenas informa que foi desativado, para evitar que um menu antigo gere erro.

## Publicação no GitHub e Vercel

- Mantenha **todos os arquivos na raiz** do repositório que já está conectado à Vercel.
- Para uma atualização de código existente, substitua os arquivos dentro do ZIP `SOMENTE_ALTERADOS`.
- Na Vercel (Production), mantenha `TELEGRAM_BOT_TOKEN`, `FIREBASE_SERVICE_ACCOUNT_JSON` e `FIREBASE_DATABASE_URL` como antes, e configure:
  - `OPENAI_API_KEY`: token secreto da **GroqCloud**, que começa com `gsk_`.
  - `OPENAI_BASE_URL`: `https://api.groq.com/openai/v1`.
  - `OPENAI_MODEL`: `openai/gpt-oss-20b`.
- A variável `OPENAI_API_KEY` tem nome antigo apenas por compatibilidade; ela agora recebe o **token Groq**, não o token OpenAI.
- Não configure Cloudflare nem variáveis `IMAGE_*`: esta versão não gera imagens.
- Faça commit na branch `main` e aguarde um novo deploy **Ready** na Vercel.
- O webhook já registrado em `https://bot-telegram-ia.vercel.app/api/telegram` pode permanecer como está, desde que não tenha alterado o domínio ou token Telegram.
- Remova o comando `/imagem` do **menu de comandos do Telegram** usando BotFather (`/setcommands`) ou executando uma vez `node register-commands.js` com token do bot em um ambiente privado.
- Teste `/start`, `/ajuda`, `/codigo crie uma função de soma em JavaScript`, `/ia quanto é 1+1` e `/admin`.

## Segurança, dados e limites

Não suba `.env`, credenciais JSON privadas ou tokens para o GitHub. A exclusão de uma Key no painel remove seu registro em `/keys` e encerra o vínculo do usuário, mas preserva uma trilha administrativa mínima em `/adminActions`.

O sistema **não apaga nem migra os dados existentes** do Firebase por conta da publicação. O GroqCloud oferece cota gratuita sujeita a limites de requisição, tokens e disponibilidade — não é IA ilimitada. Um deploy com status Ready ainda precisa de testes reais no Telegram.

Para desenvolvimento local, execute `npm install`, `npm run check` e `npm test` com Node.js 20+.
