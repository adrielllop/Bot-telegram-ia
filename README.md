# MestreXit.ia — bot de IA para Telegram

Bot Node.js para Vercel Functions, com webhook do Telegram, Firebase Realtime Database, Keys novas numéricas de 6 dígitos (Keys antigas de 16 dígitos continuam aceitas), painel administrativo, API de chat compatível com OpenAI e geração de imagens configurável. As imagens anexadas foram incluídas em `logo.png` e `tutorial-id.png`.

> **Estado desta entrega:** o código, os testes unitários e os passos de deploy estão preparados. Não foi possível comprovar uma conversa Telegram, gravação Firebase, resposta de modelo ou imagem ao vivo porque não foram fornecidos tokens/credenciais nem uma implantação. Não coloque segredos em mensagens, neste ZIP ou em commits públicos.

## O que está implementado

- `/start`: envia a logo original com os botões INSERIR KEY, MOSTRAR MEU ID e PAINEL ADM.
- `/key` e ativação: verifica Key existente/disponível, solicita ID após validar a Key (sem iniciar a contagem), fornece o botão COPIAR MEU ID e o comando `/id`. Para o próprio ID, o número é comparado ao `from.id` real do Telegram. Para outro ID, envia uma solicitação que somente o titular confirma no próprio Telegram (válida por 15 minutos).
- Ativação final: transação RTDB na Key impede que duas contas ativem simultaneamente a mesma licença; a contagem começa na ativação. O vínculo contém Telegram ID e username quando disponível.
- `/id`, `/status`, `/ajuda`, `/limpar`, `/ia`, `/imagem`; mensagens normais também são encaminhadas à IA com licença ativa.
- História de conversa separada por usuário; `/limpar` remove somente a própria conversa.
- Limite diário de imagens por usuário configurável, controlado por transação Firebase.
- `/admin` e todos os callbacks/operações administrativas conferem o `from.id` real contra `8646015281`.
- Geração criptograficamente segura de Keys de 6 dígitos, 24 durações prontas e duração personalizada, até 30 Keys por lote por padrão (máximo configurável 50), botão COPIAR KEY e gravação no Firebase antes de exibir.
- Listagem paginada por chave, detalhe, pausar, retomar com restante congelado, resetar (com confirmação), revogar/excluir (com confirmação), usuários ativos e estatísticas baseadas no Firebase.
- Verificação de vencimento em cada operação protegida, controle de tentativas de Key e deduplicação de `update_id` com lease no Firebase.
- Webhook confere o header `X-Telegram-Bot-Api-Secret-Token` com comparação de tempo constante.

## Requisitos

- Node.js 20 ou superior (Vercel Node runtime).
- Conta Telegram e bot criado pelo `@BotFather`.
- Projeto Firebase com **Realtime Database** habilitado e conta de serviço com acesso ao banco.
- Conta Vercel ligada a um repositório Git, com uma função Node.js habilitada.
- Chave e endpoint de um provedor de chat compatível com OpenAI Chat Completions.
- Chave e endpoint de geração compatível com OpenAI Images (para `/imagem`).

## Passo 1 — criar o bot no BotFather

1. No Telegram, abra [@BotFather](https://t.me/BotFather) e use `/newbot`.
2. Escolha nome e username; armazene o token de forma privada.
3. No terminal local, configure `TELEGRAM_BOT_TOKEN` no ambiente. Não envie o token ao Manus ou por chat.

## Passo 2 — configurar Firebase Realtime Database

1. Crie um projeto em Firebase Console e habilite Realtime Database.
2. A URL informada para seu banco já está preenchida como `FIREBASE_DATABASE_URL` no `.env.example`.
3. Abra `database.rules.json` neste ZIP e cole o conteúdo completo no campo **Rules** do RTDB. Ele já combina as regras restritivas e os índices; `database.indexes.json` fica como referência separada. O Admin SDK do servidor usa a conta de serviço e não depende de acesso público.
4. O app inicializa as raízes automaticamente conforme a utilização; não precisa criar keys manualmente.

Exemplo combinado para colar no campo **Rules** do RTDB:

```json
{
  "rules": {
    ".read": false,
    ".write": false,
    "keys": { ".indexOn": ["status", "userId", "createdAt"] },
    "users": { ".indexOn": ["accessActive", "expiresAt"] }
  }
}
```

> Atenção: os índices são metadados de consulta; as regras globais negam leitura/escrita dos clientes. O Firebase Admin SDK no servidor ignora Security Rules, como esperado.

## Passo 3 — preparar credenciais com segurança

1. Crie uma chave JSON de conta de serviço no Google Cloud/Firebase IAM com privilégio mínimo compatível com RTDB.
2. Converta o JSON completo para uma linha e armazene no ambiente de deploy em `FIREBASE_SERVICE_ACCOUNT_JSON`; alternativamente use `FIREBASE_SERVICE_ACCOUNT_BASE64` com o JSON codificado em Base64.
3. Nunca inclua a chave em Git, no ZIP compartilhado ou em código. `.gitignore` exclui `.env`.

## Passo 4 — criar repositório GitHub

1. Extraia o ZIP, crie repositório privado e envie os arquivos.
2. Verifique que `.env`, tokens e arquivos de serviço não aparecem no commit.
3. Adicione o projeto à Vercel importando esse repositório. Todos os arquivos estão na raiz; não mova ou renomeie os arquivos ao enviar pelo GitHub Mobile.

## Passo 5 — publicar na Vercel

1. Importe o repositório na Vercel. O framework pode ficar como Other; use `npm install` como instalação e não é necessário build estático.
2. `vercel.json` utiliza `builds` sem o campo incompatível `functions`; usa o builder Node da Vercel para mapear o arquivo raiz `telegram.js` ao endpoint `/api/telegram` e inclui as imagens da raiz. O tempo máximo é definido pela configuração do projeto e pelos limites do plano/runtime da conta. Se o plano não permitir essa duração, reduza os timeouts ou use worker/filas externos.
3. Em Project → Settings → Environment Variables, adicione as variáveis descritas em `.env.example` para Production (e Preview se necessário), sem aspas extras salvo se fizerem parte do JSON.
4. Faça deploy e anote a URL HTTPS do projeto.

## Passo 6 — configurar variáveis

São necessários somente quatro valores na Vercel:

- `TELEGRAM_BOT_TOKEN` — token do BotFather.
- `FIREBASE_DATABASE_URL` e `FIREBASE_SERVICE_ACCOUNT_JSON` — URL do Realtime Database e credencial privada de serviço.
- `OPENAI_API_KEY` — uma única chave é reutilizada para respostas e imagens; não configure `IMAGE_API_KEY` separadamente.

O ID administrativo `8646015281` já está fixado no código. O segredo do webhook é derivado automaticamente do token do Telegram. Modelos, endpoints e limites usam padrões no código, então você não precisa preencher dezenas de variáveis. Para outro provedor, será necessário adaptar `bot.js`. O prompt tenta evitar recusas desnecessárias, mas nenhum provedor garante uso literalmente sem restrições; políticas, limites de uso e cobrança do provedor continuam valendo.

## Passo 7 — configurar webhook do Telegram

Depois do deploy, execute uma vez em um terminal local. O comando abaixo lê o token sem mostrá-lo na tela; cole o token quando solicitado:

```bash
read -s -p "Token do BotFather: " TELEGRAM_BOT_TOKEN; echo
export TELEGRAM_BOT_TOKEN
npm install
npm run set:webhook -- https://SEU-PROJETO.vercel.app
npm run register:commands
unset TELEGRAM_BOT_TOKEN
```

O script chama `setWebhook` em `https://SEU-PROJETO.vercel.app/api/telegram`, deriva e registra o secret token, e habilita mensagens e callbacks. O endpoint valida esse mesmo segredo. A resposta ao webhook é processada na própria execução e limitada pelo tempo máximo da função.

Para remover o webhook manualmente, use Bot API `deleteWebhook` apenas se realmente desejar interromper o bot.

## Passo 8 — configurar a API de IA

Adicione `OPENAI_API_KEY` nas variáveis da Vercel. O padrão do código fornece a API de chat e o modelo. A mesma chave é usada para geração de imagens. A resposta é tratada em blocos abaixo do limite do Telegram.

## Passo 9 — configurar geração de imagens

Por padrão a imagem usa a mesma `OPENAI_API_KEY`; a variável `IMAGE_API_KEY` pode ser configurada separadamente, se necessário. A integração aceita retorno `b64_json` ou URL HTTP(S), baixa a imagem e envia o arquivo ao Telegram. Os dois PNG ficam diretamente na raiz do repositório. O padrão de upload é limitado a 9,5 MB para manter margem ao limite de foto do Bot API. O uso da API externa pode gerar cobrança e continua sujeito aos limites e regras do provedor.

**Tempo de execução (limitação conhecida):** o fluxo de imagem é síncrono, com timeout reduzido para deixar margem dentro de uma função Vercel de 60 segundos. Ele não mantém um processo contínuo nem simula imagens. Se o provedor exceder esse limite, a solicitação falha com mensagem de timeout; **a fila/worker assíncrono persistente para tarefas longas ainda precisa ser integrada** (por exemplo, Cloud Tasks/Cloud Run ou serviço equivalente), provisionada e testada antes de uso com provedores lentos ou tarefas longas. Esse componente externo não foi incluído nesta entrega.

## Passo 10 — registrar comandos e testar

```bash
npm test
npm run check
```

Os testes unitários são locais e não acessam serviços externos. Após deploy, confira `GET https://<domínio>/api/telegram` e teste no Telegram `/start`, inserir uma Key, ativação, `/status`, `/ia`, `/imagem` e as funções administrativas com as duas contas (admin e não-admin).

## Testes nesta entrega

- Testes locais de formato da Key de 6 dígitos (com compatibilidade com 16 dígitos), lista de 24 durações e duração personalizada, controle de admin, correspondência do ID, ativação e timestamp de vencimento, pausa/retomada, reset, expiração e formatação do restante.
- Checagem sintática Node para a aplicação.
- **Não executados sem credenciais:** integração real com Telegram, Firebase, APIs de texto/imagem, webhook registrado, validação de deployment na sua conta Vercel, Android/iOS/Telegram Web. A imagem tutorial é a captura fornecida pelo usuário; o botão “MOSTRAR MEU ID” usa o ID do próprio callback de Telegram.

## Estrutura do Firebase

- `keys/{16-dígitos}` — licença, duração, estado, timestamps e usuário vinculado.
- `users/{telegramId}` — perfil mínimo e referência à licença atual.
- `activation/{telegramId}` — etapa transitória do fluxo de ativação.
- `conversations/{telegramId}` — contexto individual, removível via `/limpar`.
- `adminActions/{pushId}` — trilha de auditoria administrativa.
- `processedUpdates/{update_id}` — deduplicação e lease de processamento.
- `security/keyAttempts/{telegramId}` — proteção contra descoberta por força bruta.
- `imageUsage/{telegramId}/{UTC-date}` — cota diária de imagens.

## Segurança e observações operacionais

- O ID administrativo padrão está no código. Opcionalmente, `ADMIN_TELEGRAM_ID` na Vercel pode substituir esse ID; confirme o número correto antes de configurar.
- As ações admin verificam `callback_query.from.id` ou `message.from.id` em cada operação, não somente ao abrir o painel.
- A transação na Key protege contra duas contas simultâneas. A atualização da Key e do perfil do usuário ocorre em duas gravações Firebase separadas; o handler permite reparar o vínculo do mesmo usuário numa repetição após interrupção, mas deploys altamente críticos podem adicionar reconciliação periódica.
- Revoke/delete é lógico e mantém registro mínimo; o acesso é revogado imediatamente. Reset é ação distinta e reabre a licença.
- Este pacote não cria sozinho suas contas, não compra créditos, não publica no seu Vercel/Firebase e não armazena dados secretos.
- Para tráfego grande, estatísticas consultam dados reais do RTDB e a função precisa de índices/capacidade adequados. Considere agregados e filas dedicados antes de escalar.

## Correção de 13/10/2026 — ativação por ID e Firebase

- A Key nova é numérica com 6 dígitos, por exemplo `004218`. **Os zeros iniciais são parte da Key**.
- O botão `📋 COPIAR KEY` usa a função `copy_text` do Telegram. O comando `/id` e o botão `📋 COPIAR MEU ID` usam o `from.id` real, e não um número inventado.
- A Key permanece `available` no Realtime Database até o ID ser confirmado e a transação de ativação concluir. A data de vencimento é calculada só nesse instante.
- É possível informar outro ID. O bot envia solicitação para a conversa privada desse ID; o destinatário precisa já ter dado `/start` no MestreXit.ia e **confirmar no próprio Telegram**. A solicitação vence em 15 minutos. Sem aceite, nenhuma validade começa.
- A função de copiar/mostrar ID não aciona ativação.
- `firebase.js` usa `getApps()/initializeApp()/getDatabase()` do Firebase Admin modular, evitando o erro `Cannot read properties of undefined (reading 'length')` observado anteriormente.
- `vercel.json` não mistura `builds` e `functions` (erro de deploy anterior).
- O Realtime Database existente NÃO é apagado nem recriado. Os nós `activationRequests` e `activation` são criados automaticamente no servidor pelo Firebase Admin. `database.rules.json` não é publicado automaticamente no Firebase apenas por estar no GitHub. Como as regras atuais negam acessos de clientes e o bot usa Admin SDK, **não é necessário alterar as regras para essa funcionalidade**.
- Se o repositório GitHub tiver correções posteriores à versão original deste ZIP, compare-as antes de substituir todos os arquivos; o ZIP base enviado ainda tinha `firebase.js` e `vercel.json` antigos.
- Testes ao vivo de Firebase/Telegram não foram realizados sem acesso às credenciais.


## Atualização de painel, durações e imagens (13/10/2026)

- O painel administrativo atualiza **a mesma mensagem** ao tocar nos botões; quando a origem é foto, ela é excluída e substituída por um texto. Se o Telegram não permitir editar/excluir a mensagem original, o bot faz fallback enviando outra mensagem.
- O botão **🏠 VOLTAR AO MENU NORMAL** fecha a navegação administrativa e mostra as opções comuns. Somente a conta reconhecida por `isAdmin` visualiza o botão do painel, e todos os callbacks administrativos também conferem o ID verdadeiro.
- O catálogo inclui **24 durações predefinidas** e opção de **duração personalizada** (`45m`, `5h`, `120d`; entre 15 minutos e 3650 dias). Durações preexistentes continuam aceitas.
- O painel lista **8 Keys por página**, com botão PRÓXIMA. Isso é apenas paginação, **não** limita o total de Keys no Realtime Database. Há **30 Keys por lote** por padrão (até 50 por lote com `MAX_KEYS_PER_GENERATION`), e você pode gerar outros lotes.
- Uma geração em lote resulta em **uma única mensagem resumida**, sem criar dezenas de mensagens separadas. Cada Key pode ser aberta pela LISTA para copiar, pausar ou revogar.
- Geração de imagens distingue falta de créditos/billing, erro de autorização, limite de taxa e parâmetros inválidos. Uma geração com erro não consome a cota diária do bot, e a mensagem temporária de progresso é removida quando possível.
- `IMAGE_TIMEOUT_MS` pode ser ajustado (padrão 55000 ms, teto no código 90000 ms), desde que o limite da função Vercel comporte esse tempo. **O código não contorna cotas, exigências de pagamento nem limites de gastos do provedor**. O plano ChatGPT Plus é separado da API.
- Verifique a API com logs `image_provider_error` e o faturamento da API do seu provedor caso apareça aviso de falta de créditos. Não cole suas chaves nos logs públicos ou em chats.
- Arquivos modificados: `bot.js`, `core.js`, `telegram-api.js`, `core.test.js`. Sem migração de dados e sem alterações necessárias em `firebase.js`, `database.rules.json`, `vercel.json` ou no webhook.
