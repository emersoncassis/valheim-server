'use strict';

const { execFile } = require('child_process');
const { promisify } = require('util');

const execFileAsync = promisify(execFile);

/**
 * Controle do container do Valheim via docker CLI.
 *
 * Usamos execFile (não exec/shell) em todo lugar: os argumentos vão como
 * array, então nome de container com caractere estranho não vira injeção
 * de comando. Nenhuma string do usuário entra numa shell.
 */

const CONTAINER = () => process.env.VALHEIM_CONTAINER || 'valheim-server';

// O container é lento pra parar (salva o mundo antes). 2 min de folga.
const STOP_TIMEOUT = '120';

async function docker(args, { timeout = 150000 } = {}) {
  try {
    const { stdout } = await execFileAsync('docker', args, {
      timeout,
      maxBuffer: 10 * 1024 * 1024,
    });
    return stdout;
  } catch (err) {
    const msg = (err.stderr || err.message || '').trim();
    throw new Error(`docker ${args[0]} falhou: ${msg}`);
  }
}

/** Estado do container: running, exited, missing... + uptime. */
async function status() {
  let out;
  try {
    out = await docker([
      'inspect', CONTAINER(),
      '--format', '{{.State.Status}}|{{.State.StartedAt}}|{{.State.Health.Status}}',
    ], { timeout: 15000 });
  } catch {
    return { state: 'missing', running: false, startedAt: null, uptimeSeconds: 0, health: null };
  }

  const [state, startedAt, health] = out.trim().split('|');
  const running = state === 'running';

  let uptimeSeconds = 0;
  if (running && startedAt) {
    const t = Date.parse(startedAt);
    if (!Number.isNaN(t)) uptimeSeconds = Math.max(0, Math.floor((Date.now() - t) / 1000));
  }

  return {
    state,
    running,
    startedAt: running ? startedAt : null,
    uptimeSeconds,
    // Sem healthcheck configurado, o docker devolve "<no value>".
    health: health && health !== '<no value>' ? health : null,
  };
}

async function start() {
  await docker(['start', CONTAINER()]);
  return { ok: true, action: 'start' };
}

/**
 * Para o container com tempo de sobra pro Valheim salvar o mundo.
 * Matar o servidor na força perde o progresso desde o último save.
 */
async function stop() {
  await docker(['stop', '-t', STOP_TIMEOUT, CONTAINER()]);
  return { ok: true, action: 'stop' };
}

async function restart() {
  await docker(['restart', '-t', STOP_TIMEOUT, CONTAINER()]);
  return { ok: true, action: 'restart' };
}

/** Últimas N linhas do log (stdout + stderr). */
async function logs(lines = 200) {
  const n = Math.min(Math.max(parseInt(lines, 10) || 200, 1), 2000);
  try {
    const out = await docker(['logs', '--tail', String(n), CONTAINER()], { timeout: 20000 });
    return out;
  } catch (err) {
    return `Não foi possível ler o log: ${err.message}`;
  }
}

module.exports = { status, start, stop, restart, logs, CONTAINER };
