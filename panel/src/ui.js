'use strict';

/**
 * HTML do painel, gerado em string. Sem build, sem bundler, sem framework.
 * O JS do cliente vai inline porque são ~80 linhas e não justifica um
 * segundo arquivo estático.
 */

/** Escapa HTML. Usado em tudo que vem do log ou de nome de jogador. */
function esc(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

const STYLE = `
:root {
  --bg: #14110e; --panel: #1e1a16; --line: #332c24;
  --fg: #e8e0d4; --muted: #9a8f80; --accent: #d97a2b;
  --ok: #5fa855; --bad: #c4483a; --warn: #d4a13a;
}
* { box-sizing: border-box; }
body {
  margin: 0; background: var(--bg); color: var(--fg);
  font: 15px/1.5 system-ui, -apple-system, Segoe UI, sans-serif;
}
.wrap { max-width: 960px; margin: 0 auto; padding: 24px 16px 64px; }
header {
  display: flex; align-items: center; justify-content: space-between;
  border-bottom: 2px solid var(--line); padding-bottom: 12px; margin-bottom: 24px;
}
h1 { font-size: 20px; margin: 0; letter-spacing: .5px; }
h1 span { color: var(--accent); }
h2 { font-size: 14px; text-transform: uppercase; letter-spacing: 1px;
     color: var(--muted); margin: 0 0 12px; }
.card {
  background: var(--panel); border: 1px solid var(--line);
  border-radius: 6px; padding: 16px; margin-bottom: 16px;
}
.row { display: flex; gap: 12px; flex-wrap: wrap; align-items: center; }
.stat { flex: 1; min-width: 120px; }
.stat .label { font-size: 12px; color: var(--muted); text-transform: uppercase; }
.stat .value { font-size: 20px; font-weight: 600; }
.dot { display: inline-block; width: 10px; height: 10px; border-radius: 50%;
       margin-right: 6px; vertical-align: middle; }
.dot.on { background: var(--ok); box-shadow: 0 0 8px var(--ok); }
.dot.off { background: var(--bad); }
.dot.wait { background: var(--warn); }
button {
  background: var(--accent); color: #16120e; border: 0; border-radius: 4px;
  padding: 9px 16px; font-size: 14px; font-weight: 600; cursor: pointer;
  font-family: inherit;
}
button:hover:not(:disabled) { filter: brightness(1.12); }
button:disabled { opacity: .45; cursor: not-allowed; }
button.ghost { background: transparent; color: var(--fg); border: 1px solid var(--line); }
button.danger { background: var(--bad); color: #fff; }
button.small { padding: 5px 10px; font-size: 12px; }
pre {
  background: #0e0c0a; border: 1px solid var(--line); border-radius: 4px;
  padding: 12px; overflow: auto; max-height: 380px;
  font: 12px/1.45 ui-monospace, Menlo, Consolas, monospace;
  color: #c3b8a8; white-space: pre-wrap; word-break: break-word;
}
table { width: 100%; border-collapse: collapse; font-size: 14px; }
th, td { text-align: left; padding: 8px 6px; border-bottom: 1px solid var(--line); }
th { color: var(--muted); font-size: 12px; text-transform: uppercase; font-weight: 500; }
a { color: var(--accent); }
input {
  width: 100%; padding: 10px; border-radius: 4px; background: #0e0c0a;
  border: 1px solid var(--line); color: var(--fg); font-size: 15px; font-family: inherit;
}
label { display: block; font-size: 12px; color: var(--muted);
        text-transform: uppercase; margin: 14px 0 6px; }
.login { max-width: 340px; margin: 12vh auto; }
.err { background: #3a1c18; border: 1px solid var(--bad); color: #f0c4bd;
       padding: 10px; border-radius: 4px; font-size: 14px; margin-bottom: 8px; }
.muted { color: var(--muted); font-size: 13px; }
#toast {
  position: fixed; bottom: 20px; left: 50%; transform: translateX(-50%);
  background: var(--panel); border: 1px solid var(--accent); color: var(--fg);
  padding: 12px 20px; border-radius: 4px; display: none; max-width: 90vw;
}
`;

function login(error = '') {
  return `<!doctype html>
<html lang="pt-BR"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Painel Valheim — Entrar</title><style>${STYLE}</style></head>
<body><div class="wrap"><div class="login">
  <h1>Painel <span>Valheim</span></h1>
  <div class="card" style="margin-top:20px">
    ${error ? `<div class="err">${esc(error)}</div>` : ''}
    <form method="POST" action="/login">
      <label for="user">Usuário</label>
      <input id="user" name="user" autocomplete="username" required autofocus>
      <label for="pass">Senha</label>
      <input id="pass" name="pass" type="password" autocomplete="current-password" required>
      <button type="submit" style="width:100%;margin-top:20px">Entrar</button>
    </form>
  </div>
</div></div></body></html>`;
}

function dashboard() {
  return `<!doctype html>
<html lang="pt-BR"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Painel Valheim</title><style>${STYLE}</style></head>
<body><div class="wrap">
  <header>
    <h1>Painel <span>Valheim</span></h1>
    <a href="/logout"><button class="ghost small">Sair</button></a>
  </header>

  <div class="card">
    <h2>Status</h2>
    <div class="row">
      <div class="stat"><div class="label">Servidor</div>
        <div class="value" id="st-state"><span class="dot wait"></span>…</div></div>
      <div class="stat"><div class="label">Uptime</div>
        <div class="value" id="st-uptime">—</div></div>
      <div class="stat"><div class="label">Online</div>
        <div class="value" id="st-players">—</div></div>
      <div class="stat"><div class="label">Mundo</div>
        <div class="value" id="st-world">—</div></div>
    </div>
    <div class="row" style="margin-top:16px">
      <button id="btn-start">Ligar</button>
      <button id="btn-stop" class="ghost">Parar</button>
      <button id="btn-restart" class="ghost">Reiniciar</button>
      <span class="muted" id="st-hint"></span>
    </div>
    <div id="playerlist" class="muted" style="margin-top:12px"></div>
  </div>

  <div class="card">
    <h2>Backups</h2>
    <button id="btn-backup">Fazer backup agora</button>
    <table style="margin-top:14px">
      <thead><tr><th>Arquivo</th><th>Data</th><th>Tamanho</th><th></th></tr></thead>
      <tbody id="backup-rows"><tr><td colspan="4" class="muted">carregando…</td></tr></tbody>
    </table>
  </div>

  <div class="card">
    <h2>Log recente</h2>
    <button id="btn-logs" class="ghost small">Atualizar</button>
    <pre id="logbox" style="margin-top:12px">carregando…</pre>
  </div>
</div>
<div id="toast"></div>

<script>
const $ = (id) => document.getElementById(id);

function toast(msg, ms = 4000) {
  const t = $('toast');
  t.textContent = msg;
  t.style.display = 'block';
  clearTimeout(t._h);
  t._h = setTimeout(() => { t.style.display = 'none'; }, ms);
}

function fmtUptime(s) {
  if (!s) return '—';
  const d = Math.floor(s / 86400), h = Math.floor(s % 86400 / 3600), m = Math.floor(s % 3600 / 60);
  if (d) return d + 'd ' + h + 'h';
  if (h) return h + 'h ' + m + 'm';
  return m + 'm';
}

function fmtSize(b) {
  if (b > 1048576) return (b / 1048576).toFixed(1) + ' MB';
  if (b > 1024) return (b / 1024).toFixed(0) + ' KB';
  return b + ' B';
}

async function api(url, opts) {
  const r = await fetch(url, opts);
  if (r.status === 401) { location.href = '/login'; throw new Error('sessão expirada'); }
  const data = await r.json();
  if (!r.ok) throw new Error(data.error || 'erro');
  return data;
}

async function refreshStatus() {
  try {
    const s = await api('/api/status');
    const cls = s.running ? 'on' : 'off';
    const label = s.running ? 'No ar' : (s.state === 'missing' ? 'Não criado' : 'Parado');
    $('st-state').innerHTML = '<span class="dot ' + cls + '"></span>' + label;
    $('st-uptime').textContent = fmtUptime(s.uptimeSeconds);
    $('st-players').textContent = s.running ? s.playerCount : '—';
    $('st-world').textContent = s.world;
    $('btn-start').disabled = s.running;
    $('btn-stop').disabled = !s.running;
    $('btn-restart').disabled = !s.running;
    $('st-hint').textContent = s.health === 'starting' ? 'subindo, pode levar alguns minutos…' : '';
    $('playerlist').textContent = (s.players && s.players.length)
      ? 'Online: ' + s.players.map(p => p.name || p.steamId).join(', ')
      : '';
  } catch (e) { /* silencioso no polling */ }
}

async function refreshBackups() {
  try {
    const { backups } = await api('/api/backups');
    const tb = $('backup-rows');
    if (!backups.length) {
      tb.innerHTML = '<tr><td colspan="4" class="muted">nenhum backup ainda</td></tr>';
      return;
    }
    tb.innerHTML = backups.map(b =>
      '<tr><td style="font-family:monospace;font-size:12px">' + b.name + '</td>' +
      '<td>' + new Date(b.date).toLocaleString('pt-BR') + '</td>' +
      '<td>' + fmtSize(b.size) + '</td>' +
      '<td style="white-space:nowrap">' +
      '<a href="/api/backups/download?name=' + encodeURIComponent(b.name) + '">' +
      '<button class="ghost small">Baixar</button></a> ' +
      '<button class="danger small" data-restore="' + b.name + '">Restaurar</button>' +
      '</td></tr>'
    ).join('');
  } catch (e) { toast('Erro ao listar backups: ' + e.message); }
}

async function refreshLogs() {
  try {
    const { lines } = await api('/api/logs?lines=200');
    const box = $('logbox');
    box.textContent = lines.join('\\n') || '(vazio)';
    box.scrollTop = box.scrollHeight;
  } catch (e) { $('logbox').textContent = 'Erro: ' + e.message; }
}

async function power(action) {
  if (action !== 'start' && !confirm('Confirma ' + action + ' do servidor? Jogadores online vão cair.')) return;
  const btns = ['btn-start', 'btn-stop', 'btn-restart'];
  btns.forEach(b => $(b).disabled = true);
  toast('Executando ' + action + '… parar pode levar até 2 min (salvando o mundo).', 10000);
  try {
    await api('/api/power', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: 'action=' + action,
    });
    toast('OK: ' + action);
  } catch (e) { toast('Falhou: ' + e.message, 6000); }
  await refreshStatus();
}

$('btn-start').onclick = () => power('start');
$('btn-stop').onclick = () => power('stop');
$('btn-restart').onclick = () => power('restart');
$('btn-logs').onclick = refreshLogs;

$('btn-backup').onclick = async () => {
  $('btn-backup').disabled = true;
  toast('Fazendo backup…', 10000);
  try {
    const r = await api('/api/backups', { method: 'POST' });
    toast('Backup criado: ' + r.created + (r.removed.length ? ' (' + r.removed.length + ' antigos removidos)' : ''));
    await refreshBackups();
  } catch (e) { toast('Falhou: ' + e.message, 6000); }
  $('btn-backup').disabled = false;
};

document.addEventListener('click', async (ev) => {
  const name = ev.target.getAttribute && ev.target.getAttribute('data-restore');
  if (!name) return;
  if (!confirm('Restaurar ' + name + '?\\n\\nO mundo atual será salvo como backup de segurança antes. O servidor vai parar e voltar.')) return;
  toast('Restaurando… isso para o servidor.', 15000);
  try {
    const r = await api('/api/backups/restore', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: 'name=' + encodeURIComponent(name),
    });
    toast('Restaurado. Backup de segurança: ' + (r.safetyBackup || 'nenhum'), 8000);
    await refreshBackups();
    await refreshStatus();
  } catch (e) { toast('Falhou: ' + e.message, 6000); }
});

refreshStatus(); refreshBackups(); refreshLogs();
setInterval(refreshStatus, 10000);
</script>
</body></html>`;
}

function notFound() {
  return `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8">
<title>404</title><style>${STYLE}</style></head>
<body><div class="wrap"><h1>404</h1>
<p class="muted">Essa página não existe. <a href="/">Voltar ao painel</a>.</p>
</div></body></html>`;
}

module.exports = { page: { login, dashboard, notFound }, esc };
