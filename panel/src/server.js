'use strict';

const http = require('http');
const fs = require('fs');
const path = require('path');
const { URL } = require('url');

const auth = require('./auth');
const backup = require('./backup');
const dockerCtl = require('./docker');
const logparse = require('./logparse');
const { page } = require('./ui');

const PORT = Number(process.env.PORT || 8080);
const SESSION_HOURS = Number(process.env.PANEL_SESSION_HOURS || 12);
const SECRET = process.env.PANEL_SESSION_SECRET;
const WORLD = process.env.VALHEIM_WORLD_NAME || 'Dedicated';

const DATA_DIR = process.env.DATA_DIR || '/app/data';
const BACKUP_DIR = process.env.BACKUP_DIR || '/app/backups';
const WORLDS_DIR = path.join(DATA_DIR, 'config', 'worlds_local');

const limiter = new auth.LoginLimiter();

// ---------------------------------------------------------------
// Checagem de configuração. Falhar aqui é melhor do que subir um
// painel inseguro e só descobrir depois.
// ---------------------------------------------------------------
function preflight() {
  const missing = [];
  if (!process.env.PANEL_USER) missing.push('PANEL_USER');
  if (!process.env.PANEL_PASS) missing.push('PANEL_PASS');
  if (!SECRET) missing.push('PANEL_SESSION_SECRET');

  if (missing.length) {
    console.error(`[FATAL] Variáveis obrigatórias ausentes: ${missing.join(', ')}`);
    console.error('Copie .env.example para .env e preencha.');
    process.exit(1);
  }
  if (String(process.env.PANEL_PASS).length < 8) {
    console.error('[FATAL] PANEL_PASS precisa ter no mínimo 8 caracteres.');
    process.exit(1);
  }
  if (SECRET.length < 16) {
    console.error('[FATAL] PANEL_SESSION_SECRET curto demais. Use: openssl rand -hex 32');
    process.exit(1);
  }
  if (String(process.env.PANEL_PASS).startsWith('trocar-')) {
    console.warn('[AVISO] PANEL_PASS ainda é o valor de exemplo. Troque.');
  }
}

// ---------------------------------------------------------------
// Helpers HTTP
// ---------------------------------------------------------------
function json(res, code, body) {
  const payload = JSON.stringify(body);
  res.writeHead(code, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(payload),
    'X-Content-Type-Options': 'nosniff',
    'Cache-Control': 'no-store',
  });
  res.end(payload);
}

function html(res, code, body, extraHeaders = {}) {
  res.writeHead(code, {
    'Content-Type': 'text/html; charset=utf-8',
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'DENY',
    'Referrer-Policy': 'no-referrer',
    'Content-Security-Policy': "default-src 'self'; style-src 'self' 'unsafe-inline'; script-src 'self' 'unsafe-inline'",
    'Cache-Control': 'no-store',
    ...extraHeaders,
  });
  res.end(body);
}

function clientIp(req) {
  return req.socket.remoteAddress || 'unknown';
}

function readBody(req, limitBytes = 64 * 1024) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (c) => {
      size += c.length;
      if (size > limitBytes) {
        reject(new Error('corpo grande demais'));
        req.destroy();
        return;
      }
      chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

function parseForm(body) {
  const params = new URLSearchParams(body);
  const out = {};
  for (const [k, v] of params) out[k] = v;
  return out;
}

function isAuthed(req) {
  const token = auth.parseCookie(req.headers.cookie, 'vh_session');
  return auth.verifySession(token, SECRET);
}

/** Sessão via cookie SameSite=Strict já barra CSRF cross-site. */
function requireAuth(req, res) {
  const session = isAuthed(req);
  if (!session) {
    json(res, 401, { error: 'não autenticado' });
    return null;
  }
  return session;
}

// ---------------------------------------------------------------
// Rotas
// ---------------------------------------------------------------
async function handle(req, res) {
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  const route = url.pathname;
  const method = req.method;

  if (route === '/healthz') return json(res, 200, { ok: true });

  // ---- Login ----
  if (route === '/login' && method === 'GET') {
    if (isAuthed(req)) {
      res.writeHead(302, { Location: '/' });
      return res.end();
    }
    return html(res, 200, page.login());
  }

  if (route === '/login' && method === 'POST') {
    const ip = clientIp(req);
    if (limiter.isBlocked(ip)) {
      return html(res, 429, page.login('Tentativas demais. Espere 15 minutos.'));
    }
    const form = parseForm(await readBody(req));
    if (auth.checkCredentials(form.user, form.pass)) {
      limiter.reset(ip);
      const token = auth.createSession(form.user, SECRET, SESSION_HOURS);
      const secure = (req.headers['x-forwarded-proto'] || '').includes('https');
      res.writeHead(302, {
        Location: '/',
        'Set-Cookie': auth.sessionCookie(token, SESSION_HOURS, secure),
      });
      return res.end();
    }
    limiter.recordFailure(ip);
    console.warn(`[auth] login falhou de ${ip}`);
    // Mensagem genérica: não dizemos se errou o usuário ou a senha.
    return html(res, 401, page.login('Usuário ou senha inválidos.'));
  }

  if (route === '/logout') {
    res.writeHead(302, { Location: '/login', 'Set-Cookie': auth.clearCookie() });
    return res.end();
  }

  // ---- Painel ----
  if (route === '/' && method === 'GET') {
    if (!isAuthed(req)) {
      res.writeHead(302, { Location: '/login' });
      return res.end();
    }
    return html(res, 200, page.dashboard());
  }

  // ---- API (tudo daqui pra baixo exige sessão) ----
  if (route.startsWith('/api/')) {
    const session = requireAuth(req, res);
    if (!session) return;

    try {
      if (route === '/api/status' && method === 'GET') {
        const st = await dockerCtl.status();
        let players = [];
        let lastSave = null;
        if (st.running) {
          const raw = await dockerCtl.logs(500);
          players = logparse.parsePlayers(raw);
          lastSave = logparse.lastWorldSave(raw);
        }
        return json(res, 200, { ...st, world: WORLD, players, playerCount: players.length, lastSave });
      }

      if (route === '/api/logs' && method === 'GET') {
        const n = url.searchParams.get('lines') || 200;
        const raw = await dockerCtl.logs(n);
        return json(res, 200, { lines: logparse.cleanForDisplay(raw, Number(n) || 200) });
      }

      if (route === '/api/power' && method === 'POST') {
        const { action } = parseForm(await readBody(req));
        if (action === 'start') return json(res, 200, await dockerCtl.start());
        if (action === 'stop') return json(res, 200, await dockerCtl.stop());
        if (action === 'restart') return json(res, 200, await dockerCtl.restart());
        return json(res, 400, { error: 'ação inválida' });
      }

      if (route === '/api/backups' && method === 'GET') {
        const list = await backup.listBackups(BACKUP_DIR);
        return json(res, 200, {
          backups: list.map((b) => ({
            name: b.name,
            date: b.date.toISOString(),
            size: b.size,
          })),
        });
      }

      if (route === '/api/backups' && method === 'POST') {
        const result = await backup.createBackup({
          worldsDir: WORLDS_DIR,
          backupDir: BACKUP_DIR,
          world: WORLD,
          keep: Number(process.env.BACKUP_KEEP || 14),
          maxAgeDays: Number(process.env.BACKUP_MAX_AGE_DAYS || 30),
        });
        console.log(`[backup] criado ${result.created}, removidos ${result.removed.length}`);
        return json(res, 200, result);
      }

      if (route === '/api/backups/download' && method === 'GET') {
        const name = url.searchParams.get('name') || '';
        // Só aceita nomes que casam com o padrão. Isso sozinho já mata
        // path traversal — "../../etc/passwd" não casa com a regex.
        if (!backup.parseBackupName(name)) {
          return json(res, 400, { error: 'nome inválido' });
        }
        const file = path.join(BACKUP_DIR, name);
        const resolved = path.resolve(file);
        if (!resolved.startsWith(path.resolve(BACKUP_DIR) + path.sep)) {
          return json(res, 400, { error: 'caminho inválido' });
        }
        try {
          const st = await fs.promises.stat(resolved);
          res.writeHead(200, {
            'Content-Type': 'application/gzip',
            'Content-Length': st.size,
            'Content-Disposition': `attachment; filename="${name}"`,
          });
          return fs.createReadStream(resolved).pipe(res);
        } catch {
          return json(res, 404, { error: 'backup não encontrado' });
        }
      }

      if (route === '/api/backups/restore' && method === 'POST') {
        const { name } = parseForm(await readBody(req));
        if (!backup.parseBackupName(name)) {
          return json(res, 400, { error: 'nome inválido' });
        }

        // Restaurar com o servidor no ar sobrescreve arquivo aberto e o
        // Valheim salva por cima depois. Para, restaura, sobe de novo.
        const before = await dockerCtl.status();
        if (before.running) await dockerCtl.stop();

        const result = await backup.restoreBackup({
          worldsDir: WORLDS_DIR,
          backupDir: BACKUP_DIR,
          name,
          world: WORLD,
        });

        if (before.running) await dockerCtl.start();

        console.log(`[backup] restaurado ${name} (segurança: ${result.safetyBackup})`);
        return json(res, 200, { ...result, serverRestarted: before.running });
      }

      return json(res, 404, { error: 'rota não encontrada' });
    } catch (err) {
      console.error(`[erro] ${route}:`, err.message);
      return json(res, 500, { error: err.message });
    }
  }

  return html(res, 404, page.notFound());
}

// ---------------------------------------------------------------
// Backup automático agendado
// ---------------------------------------------------------------
function scheduleBackups() {
  const hours = Number(process.env.BACKUP_INTERVAL_HOURS || 6);
  if (!hours || hours <= 0) {
    console.log('[backup] automático desligado (BACKUP_INTERVAL_HOURS=0)');
    return;
  }

  const intervalMs = hours * 3600 * 1000;
  console.log(`[backup] automático a cada ${hours}h, mantendo ${process.env.BACKUP_KEEP || 14}`);

  setInterval(async () => {
    try {
      const st = await dockerCtl.status();
      // Backup de servidor parado é backup do mesmo arquivo de sempre.
      // Pula, pra não gastar slot de rotação com cópia idêntica.
      if (!st.running) {
        console.log('[backup] servidor parado, pulando');
        return;
      }
      const r = await backup.createBackup({
        worldsDir: WORLDS_DIR,
        backupDir: BACKUP_DIR,
        world: WORLD,
        keep: Number(process.env.BACKUP_KEEP || 14),
        maxAgeDays: Number(process.env.BACKUP_MAX_AGE_DAYS || 30),
      });
      console.log(`[backup] auto: ${r.created} (removidos: ${r.removed.length})`);
    } catch (err) {
      console.error('[backup] auto falhou:', err.message);
    }
  }, intervalMs).unref?.();
}

// ---------------------------------------------------------------
if (require.main === module) {
  preflight();
  const server = http.createServer((req, res) => {
    handle(req, res).catch((err) => {
      console.error('[erro não tratado]', err);
      if (!res.headersSent) json(res, 500, { error: 'erro interno' });
    });
  });
  server.listen(PORT, '0.0.0.0', () => {
    console.log(`[painel] ouvindo em :${PORT} — mundo "${WORLD}"`);
    scheduleBackups();
  });

  for (const sig of ['SIGTERM', 'SIGINT']) {
    process.on(sig, () => {
      console.log(`[painel] ${sig}, encerrando`);
      server.close(() => process.exit(0));
      setTimeout(() => process.exit(0), 5000).unref();
    });
  }
}

module.exports = { handle };
