const token = process.env.TELEGRAM_BOT_TOKEN;
if (!token) throw new Error('Defina TELEGRAM_BOT_TOKEN antes de executar.');
const commands = [
  { command: 'start', description: 'Abrir apresentação e menu' },
  { command: 'key', description: 'Ativar ou inserir uma Key' },
  { command: 'id', description: 'Mostrar e copiar meu ID do Telegram' },
  { command: 'ia', description: 'Conversar com MestreXit.ia' },
  { command: 'codigo', description: 'Criar códigos, sites e programas' },
  { command: 'status', description: 'Consultar validade da licença' },
  { command: 'ajuda', description: 'Ver instruções de uso' },
  { command: 'limpar', description: 'Apagar seu histórico de conversa' },
  { command: 'admin', description: 'Abrir painel administrativo autorizado' }
];
const response = await fetch(`https://api.telegram.org/bot${token}/setMyCommands`, {
  method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ commands })
});
const data = await response.json();
if (!response.ok || !data.ok) throw new Error(data.description || 'Falha ao cadastrar comandos.');
console.log('Comandos MestreXit.ia registrados no Telegram.');
