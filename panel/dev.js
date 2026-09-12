'use strict';

/**
 * Servidor local de teste. NÃO é pra produção.
 *
 * Existe porque o painel normalmente recebe tudo do Docker Compose:
 * as variáveis do .env e os caminhos /app/data e /app/backups. Rodando
 * direto no Windows, nada disso existe — então este script:
 *
 *   1. lê o .env da raiz do projeto (o painel sozinho não lê arquivo .env)
 *   2. aponta os diretórios pra dentro da pasta do projeto, não pra /app
 *   3. preenche valores de teste se o .env não existir
 *   4. desliga o backup automático (senão fica gravando sozinho)
 *
 * Uso:  npm run dev
 *
 * O que dá pra testar assim: login, sessão, expiração, rate limit, layout,
 * lista de backups, download e restauração.
 * O que NÃO dá: ligar/parar servidor e ver jogadores online — isso precisa
 * do Docker com o container do Valheim rodando. Os botões vão dar erro de
 * "docker falhou", e isso é o esperado aqui.
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');

// ---- 1. Carrega o .env, se existir -------------------------------
function loadEnv(file) {
  if (!fs.existsSync(file)) return 0;
  let n = 0;
  for (const raw of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq === -1) continue;
    const key = line.slice(0, eq).trim();
    let val = line.slice(eq + 1).trim();
    // Tira aspas se a pessoa botou.
    if ((val.startsWith('"') && val.endsWith('"')) ||
        (val.startsWith("'") && val.endsWith("'"))) {
      val = val.slice(1, -1);
    }
    // Variável já definida no ambiente ganha do arquivo.
    if (process.env[key] === undefined) {
      process.env[key] = val;
      n++;
    }
  }
  return n;
}

const envFile = path.join(ROOT, '.env');
const loaded = loadEnv(envFile);

// ---- 2. Valores de teste se faltar algo --------------------------
const defaults = {
  PANEL_USER: 'admin',
  PANEL_PASS: 'teste12345',
  PANEL_SESSION_SECRET: 'dev-secret-apenas-para-teste-local-nao-use-em-producao',
  VALHEIM_WORLD_NAME: 'Dedicated',
  PANEL_SESSION_HOURS: '12',
};

const usados = [];
for (const [k, v] of Object.entries(defaults)) {
  if (!process.env[k]) {
    process.env[k] = v;
    usados.push(k);
  }
}

// ---- 3. Caminhos locais em vez de /app ---------------------------
process.env.DATA_DIR = path.join(ROOT, 'data');
process.env.BACKUP_DIR = path.join(ROOT, 'backups');
process.env.PORT = process.env.PORT || '8080';

// Sem backup automático em dev.
process.env.BACKUP_INTERVAL_HOURS = '0';

fs.mkdirSync(path.join(ROOT, 'data', 'config', 'worlds_local'), { recursive: true });
fs.mkdirSync(path.join(ROOT, 'backups'), { recursive: true });

// ---- 4. Relatório antes de subir ---------------------------------
console.log('');
console.log('  ┌─ MODO DEV ─ servidor local de teste ─────────────────┐');
console.log(`  │ .env:      ${loaded ? `${loaded} variáveis carregadas` : 'não encontrado'}`);
if (usados.length) {
  console.log(`  │ Padrões:   ${usados.join(', ')}`);
}
console.log(`  │ Usuário:   ${process.env.PANEL_USER}`);
console.log(`  │ Senha:     ${process.env.PANEL_PASS}`);
console.log(`  │ URL:       http://localhost:${process.env.PORT}`);
console.log('  ├──────────────────────────────────────────────────────┤');
console.log('  │ Docker não é usado aqui: Ligar/Parar e a lista de    │');
console.log('  │ jogadores vão falhar. É o esperado neste modo.       │');
console.log('  └──────────────────────────────────────────────────────┘');
console.log('');

// Sobe o servidor. require() dispara o bloco require.main do server.js?
// Não — require.main continua sendo ESTE arquivo, então o server.js só
// exporta. Por isso subimos o http aqui mesmo.
const http = require('http');
const { handle } = require('./src/server');

const server = http.createServer((req, res) => {
  handle(req, res).catch((err) => {
    console.error('[erro não tratado]', err);
    if (!res.headersSent) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'erro interno' }));
    }
  });
});

server.listen(Number(process.env.PORT), '127.0.0.1', () => {
  console.log(`[dev] ouvindo em http://localhost:${process.env.PORT}`);
  console.log('[dev] Ctrl+C para parar.');
});

process.on('SIGINT', () => {
  console.log('\n[dev] encerrando.');
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 2000).unref();
});
