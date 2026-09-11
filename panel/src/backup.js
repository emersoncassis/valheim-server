'use strict';

const fs = require('fs');
const path = require('path');
const { execFile } = require('child_process');
const { promisify } = require('util');

const execFileAsync = promisify(execFile);

/**
 * Backup do mundo, com rotação.
 *
 * O mundo do Valheim são dois arquivos em /config/worlds_local:
 *   <World>.db   — o mundo em si (terreno, construções)
 *   <World>.fwl  — metadados (seed). Sem ele o .db não serve.
 * Backup que pega só o .db é backup inútil. Pegamos os dois.
 */

// Nome do mundo: letras, números, _ e -. Sem ponto e sem barra, de propósito:
// ponto abre espaço pra ".." e barra pra caminho. Menos superfície, menos dor.
const BACKUP_RE = /^valheim-([A-Za-z0-9_-]+)-(\d{8}T\d{6})\.tar\.gz$/;

/** Timestamp compacto e ordenável: 20260911T143000 */
function stamp(date = new Date()) {
  const p = (n) => String(n).padStart(2, '0');
  return (
    date.getFullYear() +
    p(date.getMonth() + 1) +
    p(date.getDate()) + 'T' +
    p(date.getHours()) +
    p(date.getMinutes()) +
    p(date.getSeconds())
  );
}

function backupName(world, date = new Date()) {
  return `valheim-${world}-${stamp(date)}.tar.gz`;
}

/** Converte o timestamp do nome de volta pra Date. Null se não casar. */
function parseBackupName(name) {
  const m = BACKUP_RE.exec(name);
  if (!m) return null;
  const [, world, ts] = m;
  const date = new Date(
    Number(ts.slice(0, 4)),
    Number(ts.slice(4, 6)) - 1,
    Number(ts.slice(6, 8)),
    Number(ts.slice(9, 11)),
    Number(ts.slice(11, 13)),
    Number(ts.slice(13, 15))
  );
  if (Number.isNaN(date.getTime())) return null;
  return { world, date, name };
}

/**
 * Decide quais backups apagar.
 *
 * Função pura: recebe a lista, devolve o que fica e o que sai.
 * Testável sem tocar em disco — que é o ponto, porque rotação
 * errada apaga o mundo do cara em silêncio.
 *
 * Regras:
 *  1. Mantém os `keep` mais recentes, sempre. Isso vem primeiro.
 *  2. Dos que sobraram, apaga os mais velhos que `maxAgeDays`.
 *  3. maxAgeDays = 0 desliga a regra de idade.
 *  4. NUNCA apaga tudo. Se só existe um, ele fica.
 */
function planRotation(backups, { keep = 14, maxAgeDays = 30, now = Date.now() } = {}) {
  const parsed = backups
    .map((b) => (typeof b === 'string' ? parseBackupName(b) : b))
    .filter(Boolean)
    .sort((a, b) => b.date - a.date); // mais recente primeiro

  if (parsed.length === 0) return { keep: [], remove: [] };

  const keepCount = Math.max(1, Number(keep) || 1); // nunca zero
  const kept = [];
  const removed = [];

  for (let i = 0; i < parsed.length; i++) {
    const item = parsed[i];

    if (i < keepCount) {
      kept.push(item);
      continue;
    }

    if (maxAgeDays > 0) {
      const ageDays = (now - item.date.getTime()) / (24 * 3600 * 1000);
      if (ageDays > maxAgeDays) {
        removed.push(item);
        continue;
      }
    }

    // Passou do limite de quantidade: sai.
    removed.push(item);
  }

  // Trava de segurança: se por qualquer motivo tudo caiu na lista de remoção,
  // resgata o mais recente.
  if (kept.length === 0 && removed.length > 0) {
    kept.push(removed.shift());
  }

  return { keep: kept, remove: removed };
}

/** Lista os backups em disco, do mais recente pro mais antigo. */
async function listBackups(dir) {
  let entries;
  try {
    entries = await fs.promises.readdir(dir);
  } catch (err) {
    if (err.code === 'ENOENT') return [];
    throw err;
  }

  const out = [];
  for (const name of entries) {
    const meta = parseBackupName(name);
    if (!meta) continue;
    try {
      const st = await fs.promises.stat(path.join(dir, name));
      out.push({ ...meta, size: st.size });
    } catch {
      // sumiu no meio do caminho; ignora
    }
  }
  out.sort((a, b) => b.date - a.date);
  return out;
}

/**
 * Cria um backup (.tar.gz do diretório de mundos) e roda a rotação.
 * Retorna o nome criado e o que foi apagado.
 */
async function createBackup({ worldsDir, backupDir, world, keep, maxAgeDays }) {
  await fs.promises.mkdir(backupDir, { recursive: true });

  // Se o mundo ainda não existe, não cria tar vazio.
  const dbFile = path.join(worldsDir, `${world}.db`);
  try {
    await fs.promises.access(dbFile);
  } catch {
    throw new Error(`mundo "${world}" ainda não existe em ${worldsDir} — nada pra salvar`);
  }

  const name = backupName(world);
  const dest = path.join(backupDir, name);

  // Escreve em .tmp e só depois renomeia: se o processo morrer no meio,
  // não fica um .tar.gz truncado parecendo backup bom.
  const tmp = `${dest}.tmp`;
  await execFileAsync('tar', [
    '-czf', tmp,
    '-C', worldsDir,
    `${world}.db`,
    `${world}.fwl`,
  ]);
  await fs.promises.rename(tmp, dest);

  const all = await listBackups(backupDir);
  const plan = planRotation(all, { keep, maxAgeDays });

  const removed = [];
  for (const item of plan.remove) {
    try {
      await fs.promises.unlink(path.join(backupDir, item.name));
      removed.push(item.name);
    } catch { /* já sumiu */ }
  }

  return { created: name, removed };
}

/**
 * Restaura um backup por cima do mundo atual.
 * Antes de sobrescrever, salva o estado atual como pre-restore —
 * restaurar o backup errado não pode ser irreversível.
 * O servidor precisa estar PARADO. Quem chama garante isso.
 */
async function restoreBackup({ worldsDir, backupDir, name, world }) {
  const meta = parseBackupName(name);
  if (!meta) throw new Error('nome de backup inválido');

  const src = path.join(backupDir, name);
  // Confere que o caminho resolvido continua dentro de backupDir.
  const resolved = path.resolve(src);
  if (!resolved.startsWith(path.resolve(backupDir) + path.sep)) {
    throw new Error('caminho de backup fora do diretório permitido');
  }
  await fs.promises.access(resolved);

  await fs.promises.mkdir(worldsDir, { recursive: true });

  // Rede de segurança.
  let safety = null;
  try {
    safety = (await createBackup({
      worldsDir, backupDir, world, keep: 999, maxAgeDays: 0,
    })).created;
  } catch {
    // Mundo pode não existir ainda (restaurar em servidor limpo). Segue.
  }

  await execFileAsync('tar', ['-xzf', resolved, '-C', worldsDir]);

  return { restored: name, safetyBackup: safety };
}

module.exports = {
  stamp,
  backupName,
  parseBackupName,
  planRotation,
  listBackups,
  createBackup,
  restoreBackup,
};
