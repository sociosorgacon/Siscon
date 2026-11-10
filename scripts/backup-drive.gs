/**
 * Siscon — backup automático diário no Google Drive (Google Apps Script).
 *
 * Como instalar (uma vez só), logado na conta Google dona da pasta de backup:
 *   1. script.google.com → Novo projeto → apagar o conteúdo → colar este arquivo → salvar (nome: "Siscon Backup").
 *   2. Escolher a função "configurar" na barra de cima → Executar → autorizar o acesso (Drive, e-mail, serviços externos).
 *   3. Ver o "Registro de execução": ele mostra o TOKEN. Copiar e cadastrar no Supabase → Edge Functions → Secrets
 *      com o nome BACKUP_TOKEN (o token fica só no Supabase e nas Propriedades deste script; não colar em chat nem e-mail).
 *   4. Escolher a função "fazerBackup" → Executar → conferir o arquivo na pasta.
 *
 * Depois disso roda sozinho todo dia de madrugada (entre 3h e 4h). Em caso de falha, manda e-mail para a conta dona do script.
 * Guarda os backups dos últimos 30 dias; o do dia 1º de cada mês é mantido sempre. Os antigos vão para a LIXEIRA do Drive
 * (dá para recuperar por mais 30 dias), não são apagados de vez.
 */

const PASTA_ID = '1DuZEetUHLfHp4NXV-h_l2MqZFTGc909o';
const URL_BACKUP = 'https://glffjwcikoyggdfuzgyw.supabase.co/functions/v1/backup';
const DIAS_GUARDAR = 30;
const PREFIXO = 'siscon_backup_';

/** Rodar UMA vez: cria o token (se ainda não existir) e agenda o backup diário */
function configurar() {
  const props = PropertiesService.getScriptProperties();
  let token = props.getProperty('BACKUP_TOKEN');
  if (!token) {
    token = (Utilities.getUuid() + Utilities.getUuid()).replace(/-/g, '');
    props.setProperty('BACKUP_TOKEN', token);
  }
  ScriptApp.getProjectTriggers()
    .filter(function (g) { return g.getHandlerFunction() === 'fazerBackup'; })
    .forEach(function (g) { ScriptApp.deleteTrigger(g); });
  ScriptApp.newTrigger('fazerBackup').timeBased().everyDays(1).atHour(3).inTimezone('America/Sao_Paulo').create();
  DriveApp.getFolderById(PASTA_ID); // confere o acesso à pasta
  Logger.log('Backup diário agendado (3h–4h). TOKEN para o Secret BACKUP_TOKEN do Supabase:\n' + token);
}

/** Baixa o backup do Siscon e salva na pasta (compactado em .zip) */
function fazerBackup() {
  try {
    const token = PropertiesService.getScriptProperties().getProperty('BACKUP_TOKEN');
    if (!token) throw new Error('Token não configurado: rode a função "configurar".');
    const r = UrlFetchApp.fetch(URL_BACKUP, { method: 'post', headers: { 'X-Backup-Token': token }, muteHttpExceptions: true });
    if (r.getResponseCode() !== 200) throw new Error('Supabase respondeu ' + r.getResponseCode() + ': ' + r.getContentText().slice(0, 300));
    const texto = r.getContentText();
    const dados = JSON.parse(texto);
    if (!dados.clientes || !dados.clientes.length) throw new Error('Backup veio sem clientes: arquivo não salvo.');

    const quando = Utilities.formatDate(new Date(), 'America/Sao_Paulo', 'yyyy-MM-dd_HHmm');
    const json = Utilities.newBlob(texto, 'application/json', PREFIXO + quando + '.json');
    const pasta = DriveApp.getFolderById(PASTA_ID);
    pasta.createFile(Utilities.zip([json], PREFIXO + quando + '.zip'));
    limparAntigos(pasta);

    if (dados.tabelas_com_erro) avisar('Backup salvo, mas com tabelas faltando:\n' + dados.tabelas_com_erro.join('\n'));
    Logger.log('Backup salvo: ' + PREFIXO + quando + '.zip · ' + JSON.stringify(dados.contagem));
  } catch (e) {
    avisar('O backup automático do Siscon falhou.\n\n' + e.message);
    throw e;
  }
}

/** Manda para a lixeira os backups com mais de DIAS_GUARDAR dias (mantém sempre o do dia 1º de cada mês) */
function limparAntigos(pasta) {
  const limite = new Date(Date.now() - DIAS_GUARDAR * 86400000);
  const arquivos = pasta.getFiles();
  while (arquivos.hasNext()) {
    const f = arquivos.next();
    const m = f.getName().match(/^siscon_backup_(\d{4})-(\d{2})-(\d{2})/);
    if (!m || m[3] === '01') continue;
    if (f.getDateCreated() < limite) f.setTrashed(true);
  }
}

function avisar(msg) {
  MailApp.sendEmail(Session.getEffectiveUser().getEmail(), 'Siscon: problema no backup automático', msg +
    '\n\nPasta: https://drive.google.com/drive/folders/' + PASTA_ID);
}
