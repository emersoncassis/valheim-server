'use strict';

const test = require('node:test');
const assert = require('node:assert');
const backup = require('../src/backup');

/** Helper: gera um nome de backup com N dias de idade. */
function aged(days, world = 'Dedicated', now = Date.now()) {
  const d = new Date(now - days * 24 * 3600 * 1000);
  return backup.backupName(world, d);
}

test('nome de backup vai e volta sem perder a data', () => {
  const d = new Date(2026, 8, 11, 14, 30, 0); // 11/09/2026 14:30:00
  const name = backup.backupName('Dedicated', d);
  assert.strictEqual(name, 'valheim-Dedicated-20260911T143000.tar.gz');
  const parsed = backup.parseBackupName(name);
  assert.ok(parsed);
  assert.strictEqual(parsed.world, 'Dedicated');
  assert.strictEqual(parsed.date.getTime(), d.getTime());
});

test('nomes inválidos não são reconhecidos como backup', () => {
  const ruins = [
    'aleatorio.tar.gz',
    'valheim-Mundo.tar.gz',
    'valheim-Mundo-2026.tar.gz',
    '../../../etc/passwd',
    'valheim-../evil-20260911T143000.tar.gz',
    'valheim-Mundo-20260911T143000.zip',
    '',
    'valheim--20260911T143000.tar.gz',
  ];
  for (const n of ruins) {
    assert.strictEqual(backup.parseBackupName(n), null, `deveria rejeitar: ${n}`);
  }
});

test('nome de mundo com espaço não é aceito (evita quebra no tar)', () => {
  assert.strictEqual(backup.parseBackupName('valheim-Meu Mundo-20260911T143000.tar.gz'), null);
});

// ---- ROTAÇÃO: o que quebra calado ----

test('rotação mantém exatamente os N mais recentes', () => {
  const now = Date.now();
  const lista = [];
  for (let i = 0; i < 20; i++) lista.push(aged(i, 'Dedicated', now));

  const { keep, remove } = backup.planRotation(lista, { keep: 5, maxAgeDays: 0, now });

  assert.strictEqual(keep.length, 5);
  assert.strictEqual(remove.length, 15);
  // Os mantidos são os 5 mais novos (0 a 4 dias).
  const idades = keep.map(k => Math.round((now - k.date.getTime()) / 86400000));
  assert.deepStrictEqual(idades.sort((a, b) => a - b), [0, 1, 2, 3, 4]);
});

test('rotação NUNCA apaga tudo, mesmo com keep=0', () => {
  // Esse é o bug clássico: keep mal configurado zera os backups.
  const now = Date.now();
  const lista = [aged(1, 'Dedicated', now), aged(2, 'Dedicated', now)];
  const { keep, remove } = backup.planRotation(lista, { keep: 0, maxAgeDays: 1, now });
  assert.ok(keep.length >= 1, 'precisa sobrar pelo menos um backup');
  assert.strictEqual(keep.length + remove.length, 2);
});

test('keep negativo também não zera os backups', () => {
  const now = Date.now();
  const lista = [aged(5, 'Dedicated', now)];
  const { keep } = backup.planRotation(lista, { keep: -3, maxAgeDays: 1, now });
  assert.strictEqual(keep.length, 1);
});

test('backup velho é removido quando está FORA da cota de quantidade', () => {
  // Atenção à interação das duas regras: a idade só é consultada depois que
  // o backup já saiu da cota dos `keep` mais recentes. Com keep=2 e três
  // arquivos, o de 100 dias é o único candidato — e aí a idade o condena.
  const now = Date.now();
  const lista = [aged(0, 'Dedicated', now), aged(1, 'Dedicated', now), aged(100, 'Dedicated', now)];
  const { keep, remove } = backup.planRotation(lista, { keep: 2, maxAgeDays: 30, now });
  assert.strictEqual(keep.length, 2);
  assert.strictEqual(remove.length, 1);
  assert.ok(remove[0].name.includes(backup.stamp(new Date(now - 100 * 86400000))));
});

test('backup velho DENTRO da cota de quantidade é preservado', () => {
  // O contrário do teste acima, explicitado: keep=10 cobre os três, então
  // nem o de 100 dias sai. É essa a regra — quantidade ganha de idade.
  const now = Date.now();
  const lista = [aged(0, 'Dedicated', now), aged(1, 'Dedicated', now), aged(100, 'Dedicated', now)];
  const { keep, remove } = backup.planRotation(lista, { keep: 10, maxAgeDays: 30, now });
  assert.strictEqual(keep.length, 3);
  assert.strictEqual(remove.length, 0);
});

test('maxAgeDays=0 desliga a regra de idade', () => {
  const now = Date.now();
  const lista = [aged(0, 'Dedicated', now), aged(500, 'Dedicated', now)];
  const { keep, remove } = backup.planRotation(lista, { keep: 10, maxAgeDays: 0, now });
  assert.strictEqual(keep.length, 2, 'sem limite de idade, os dois ficam');
  assert.strictEqual(remove.length, 0);
});

test('a regra de quantidade tem prioridade sobre a de idade', () => {
  // Todos velhos, mas keep=3: os 3 mais recentes sobrevivem mesmo assim.
  // Sem isso, um servidor parado por 2 meses perderia todo o histórico.
  const now = Date.now();
  const lista = [];
  for (let i = 50; i < 60; i++) lista.push(aged(i, 'Dedicated', now));

  const { keep, remove } = backup.planRotation(lista, { keep: 3, maxAgeDays: 30, now });
  assert.strictEqual(keep.length, 3);
  assert.strictEqual(remove.length, 7);
});

test('lista vazia não explode', () => {
  const { keep, remove } = backup.planRotation([], { keep: 5, maxAgeDays: 30 });
  assert.deepStrictEqual(keep, []);
  assert.deepStrictEqual(remove, []);
});

test('um backup só sempre é mantido', () => {
  const now = Date.now();
  const { keep, remove } = backup.planRotation([aged(999, 'Dedicated', now)], {
    keep: 1, maxAgeDays: 1, now,
  });
  assert.strictEqual(keep.length, 1);
  assert.strictEqual(remove.length, 0);
});

test('arquivos estranhos no diretório são ignorados pela rotação', () => {
  const now = Date.now();
  const lista = [aged(0, 'Dedicated', now), 'README.txt', 'lixo.tar.gz', aged(1, 'Dedicated', now)];
  const { keep, remove } = backup.planRotation(lista, { keep: 10, maxAgeDays: 0, now });
  assert.strictEqual(keep.length, 2, 'só os backups válidos entram na conta');
  assert.strictEqual(remove.length, 0, 'arquivos alheios nunca são removidos');
});

test('ordem da entrada não importa — o resultado é o mesmo', () => {
  const now = Date.now();
  const lista = [aged(3, 'D', now), aged(0, 'D', now), aged(5, 'D', now), aged(1, 'D', now)];
  const a = backup.planRotation(lista, { keep: 2, maxAgeDays: 0, now });
  const b = backup.planRotation([...lista].reverse(), { keep: 2, maxAgeDays: 0, now });
  assert.deepStrictEqual(a.keep.map(x => x.name).sort(), b.keep.map(x => x.name).sort());
});

test('keep + remove sempre cobre todos os backups válidos, sem duplicar', () => {
  const now = Date.now();
  const lista = [];
  for (let i = 0; i < 40; i++) lista.push(aged(i * 2, 'Dedicated', now));

  const { keep, remove } = backup.planRotation(lista, { keep: 7, maxAgeDays: 30, now });
  const todos = [...keep, ...remove].map(x => x.name);
  assert.strictEqual(todos.length, 40);
  assert.strictEqual(new Set(todos).size, 40, 'nenhum backup em ambas as listas');
});
