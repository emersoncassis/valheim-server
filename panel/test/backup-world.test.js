'use strict';

/**
 * Testes de integração do backup/restore com o formato de mundo do
 * Valheim 1.0+ (pasta com .chunk + _main.<n>.db2/.fwl2/.chunks/.ok).
 *
 * Estes testes mexem em disco de verdade e chamam `tar`, porque é
 * exatamente aí que o bug do formato antigo se escondia: as funções puras
 * passavam todas, e o backup real gerava arquivo inútil.
 *
 * Em máquina sem `tar` no PATH os testes se marcam como skip em vez de
 * falhar — assim `npm test` continua verde no Windows sem Git Bash.
 */

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

const backup = require('../src/backup');

function hasTar() {
  try {
    execFileSync('tar', ['--version'], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

const TAR = hasTar();
const skip = TAR ? false : 'tar não disponível no PATH';

/** Cria um tmpdir isolado e devolve os caminhos do teste. */
function makeEnv() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'vh-test-'));
  const worldsDir = path.join(root, 'worlds_local');
  const backupDir = path.join(root, 'backups');
  fs.mkdirSync(worldsDir, { recursive: true });
  fs.mkdirSync(backupDir, { recursive: true });
  return { root, worldsDir, backupDir };
}

/** Monta um mundo no formato 1.0: pasta com chunks e metadados. */
function makeWorld10(worldsDir, world, { rev = 233, chunks = ['1c_1a__1_1', '1e_20__1_57'] } = {}) {
  const dir = path.join(worldsDir, world);
  fs.mkdirSync(dir, { recursive: true });
  for (const c of chunks) {
    fs.writeFileSync(path.join(dir, `${c}.chunk`), `conteudo-${c}`);
  }
  fs.writeFileSync(path.join(dir, `_main.${rev}.db2`), 'metadados');
  fs.writeFileSync(path.join(dir, `_main.${rev}.fwl2`), 'seed');
  fs.writeFileSync(path.join(dir, `_main.${rev}.chunks`), 'indice');
  fs.writeFileSync(path.join(dir, `_main.${rev}.ok`), 'ok\n');
  return dir;
}

/** Monta um mundo no formato antigo: dois arquivos soltos. */
function makeWorldLegacy(worldsDir, world) {
  fs.writeFileSync(path.join(worldsDir, `${world}.db`), 'mundo-antigo');
  fs.writeFileSync(path.join(worldsDir, `${world}.fwl`), 'seed-antiga');
}

function cleanup(root) {
  try { fs.rmSync(root, { recursive: true, force: true }); } catch { /* ok */ }
}

// ---------------------------------------------------------------

test('backup do formato 1.0 inclui chunks e metadados', { skip }, async () => {
  const { root, worldsDir, backupDir } = makeEnv();
  try {
    makeWorld10(worldsDir, 'ICELAND');

    const r = await backup.createBackup({
      worldsDir, backupDir, world: 'ICELAND', keep: 10, maxAgeDays: 0,
    });

    assert.ok(r.created, 'deveria ter criado backup');
    const tarPath = path.join(backupDir, r.created);
    assert.ok(fs.existsSync(tarPath), 'arquivo .tar.gz deveria existir');
    assert.ok(fs.statSync(tarPath).size > 0, 'backup não pode estar vazio');

    // Confere o conteúdo do tar, não só que ele existe. Backup que existe
    // mas não tem o mundo dentro é o erro que estamos justamente caçando.
    const listing = execFileSync('tar', ['-tzf', tarPath], { encoding: 'utf8' });
    assert.match(listing, /ICELAND\/1c_1a__1_1\.chunk/);
    assert.match(listing, /ICELAND\/_main\.233\.db2/);
    assert.match(listing, /ICELAND\/_main\.233\.fwl2/);
    assert.match(listing, /ICELAND\/_main\.233\.ok/);
  } finally {
    cleanup(root);
  }
});

test('backup do formato antigo continua funcionando', { skip }, async () => {
  const { root, worldsDir, backupDir } = makeEnv();
  try {
    makeWorldLegacy(worldsDir, 'Dedicated');

    const r = await backup.createBackup({
      worldsDir, backupDir, world: 'Dedicated', keep: 10, maxAgeDays: 0,
    });

    const listing = execFileSync('tar', ['-tzf', path.join(backupDir, r.created)], { encoding: 'utf8' });
    assert.match(listing, /Dedicated\.db/);
    assert.match(listing, /Dedicated\.fwl/);
  } finally {
    cleanup(root);
  }
});

test('mundo inexistente dá erro claro, sem criar tar vazio', { skip }, async () => {
  const { root, worldsDir, backupDir } = makeEnv();
  try {
    await assert.rejects(
      () => backup.createBackup({
        worldsDir, backupDir, world: 'NaoExiste', keep: 10, maxAgeDays: 0,
      }),
      /não encontrado/
    );
    assert.strictEqual(fs.readdirSync(backupDir).length, 0,
      'não deve sobrar arquivo nenhum quando o mundo não existe');
  } finally {
    cleanup(root);
  }
});

test('round-trip: backup e restore devolvem o mundo idêntico', { skip }, async () => {
  const { root, worldsDir, backupDir } = makeEnv();
  try {
    const dir = makeWorld10(worldsDir, 'ICELAND');
    const antes = fs.readdirSync(dir).sort();

    const r = await backup.createBackup({
      worldsDir, backupDir, world: 'ICELAND', keep: 10, maxAgeDays: 0,
    });

    // Destrói o mundo, simulando o desastre que o backup existe pra cobrir.
    fs.rmSync(dir, { recursive: true, force: true });
    assert.ok(!fs.existsSync(dir));

    await backup.restoreBackup({
      worldsDir, backupDir, name: r.created, world: 'ICELAND',
    });

    const depois = fs.readdirSync(dir).sort();
    assert.deepStrictEqual(depois, antes, 'mundo restaurado deve ter os mesmos arquivos');
    assert.strictEqual(
      fs.readFileSync(path.join(dir, '_main.233.fwl2'), 'utf8'), 'seed',
      'conteúdo dos metadados deve sobreviver ao round-trip'
    );
  } finally {
    cleanup(root);
  }
});

test('restore não deixa chunk órfão do mundo anterior', { skip }, async () => {
  const { root, worldsDir, backupDir } = makeEnv();
  try {
    // Mundo antigo, com um chunk que NÃO existe no backup.
    makeWorld10(worldsDir, 'ICELAND', { chunks: ['aa_aa__1_1'] });
    const r = await backup.createBackup({
      worldsDir, backupDir, world: 'ICELAND', keep: 10, maxAgeDays: 0,
    });

    // Agora o mundo "avança": ganha um chunk novo que o backup não tem.
    const dir = path.join(worldsDir, 'ICELAND');
    fs.writeFileSync(path.join(dir, 'zz_zz__9_9.chunk'), 'chunk-mais-novo');

    await backup.restoreBackup({
      worldsDir, backupDir, name: r.created, world: 'ICELAND',
    });

    // O chunk que só existia no mundo novo tem que sumir. Se sobreviver,
    // o mundo restaurado vira mistura de dois saves — corrupção silenciosa.
    assert.ok(
      !fs.existsSync(path.join(dir, 'zz_zz__9_9.chunk')),
      'chunk órfão do mundo anterior não pode sobreviver ao restore'
    );
    assert.ok(fs.existsSync(path.join(dir, 'aa_aa__1_1.chunk')));
  } finally {
    cleanup(root);
  }
});

test('restore no mesmo segundo do backup não sobrescreve a origem', { skip }, async () => {
  // Bug real: o backup de segurança usava o mesmo formato de nome do backup
  // normal (resolução de segundos). Restaurar logo após criar gerava nome
  // idêntico, o de segurança sobrescrevia o de origem, e o restore extraía
  // o mundo ATUAL de volta. Parecia ter funcionado e não tinha mudado nada.
  const { root, worldsDir, backupDir } = makeEnv();
  try {
    makeWorld10(worldsDir, 'ICELAND', { chunks: ['aa_aa__1_1'] });
    const r = await backup.createBackup({
      worldsDir, backupDir, world: 'ICELAND', keep: 10, maxAgeDays: 0,
    });
    const tarAntes = fs.readFileSync(path.join(backupDir, r.created));

    // Sem esperar: força a janela de colisão.
    await backup.restoreBackup({
      worldsDir, backupDir, name: r.created, world: 'ICELAND',
    });

    const tarDepois = fs.readFileSync(path.join(backupDir, r.created));
    assert.ok(
      tarAntes.equals(tarDepois),
      'o backup de origem não pode ser sobrescrito pelo de segurança'
    );
  } finally {
    cleanup(root);
  }
});

test('backup de segurança fica fora da rotação', { skip }, async () => {
  // pre-restore-* não casa com o padrão de nome, então listBackups ignora
  // e a rotação nunca apaga. É de propósito: é a última linha de defesa.
  const { root, worldsDir, backupDir } = makeEnv();
  try {
    makeWorld10(worldsDir, 'ICELAND');
    const safety = await backup.createSafetyBackup({
      worldsDir, backupDir, world: 'ICELAND',
    });

    assert.match(safety, /^pre-restore-ICELAND-/);
    assert.ok(fs.existsSync(path.join(backupDir, safety)));

    const listados = await backup.listBackups(backupDir);
    assert.ok(
      !listados.some((b) => b.name === safety),
      'backup de segurança não deve entrar na lista que a rotação usa'
    );
  } finally {
    cleanup(root);
  }
});

test('restore cria backup de segurança do mundo atual', { skip }, async () => {
  const { root, worldsDir, backupDir } = makeEnv();
  try {
    makeWorld10(worldsDir, 'ICELAND');
    const r = await backup.createBackup({
      worldsDir, backupDir, world: 'ICELAND', keep: 10, maxAgeDays: 0,
    });

    const out = await backup.restoreBackup({
      worldsDir, backupDir, name: r.created, world: 'ICELAND',
    });

    assert.ok(out.safetyBackup, 'deveria ter criado backup de segurança');
    assert.ok(
      fs.existsSync(path.join(backupDir, out.safetyBackup)),
      'o arquivo de segurança precisa existir de verdade'
    );
  } finally {
    cleanup(root);
  }
});
