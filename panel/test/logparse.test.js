'use strict';

const test = require('node:test');
const assert = require('node:assert');
const lp = require('../src/logparse');

test('conta um jogador que conectou', () => {
  const log = [
    '09/11/2026 14:00:01: Got connection SteamID 76561198000000001',
    '09/11/2026 14:00:02: Got character ZDOID from Bjorn : 123:1',
  ];
  const players = lp.parsePlayers(log);
  assert.strictEqual(players.length, 1);
  assert.strictEqual(players[0].steamId, '76561198000000001');
  assert.strictEqual(players[0].name, 'Bjorn');
});

test('jogador que desconectou sai da lista', () => {
  const log = [
    'Got connection SteamID 76561198000000001',
    'Got connection SteamID 76561198000000002',
    'Closing socket 76561198000000001',
  ];
  const players = lp.parsePlayers(log);
  assert.strictEqual(players.length, 1);
  assert.strictEqual(players[0].steamId, '76561198000000002');
});

test('reconexão não duplica o jogador', () => {
  // Queda de conexão é comum. Contar duas vezes mostraria "2 online"
  // com uma pessoa só — erro silencioso clássico.
  const log = [
    'Got connection SteamID 76561198000000001',
    'Closing socket 76561198000000001',
    'Got connection SteamID 76561198000000001',
  ];
  assert.strictEqual(lp.parsePlayers(log).length, 1);
});

test('conexão repetida sem desconexão também não duplica', () => {
  const log = [
    'Got connection SteamID 76561198000000001',
    'Got handshake from client 76561198000000001',
  ];
  assert.strictEqual(lp.parsePlayers(log).length, 1);
});

test('servidor vazio devolve lista vazia', () => {
  const log = [
    'Game server connected',
    'Destroying abandoned non persistent zdo 123:45',
    'World saved ( 250.3ms )',
  ];
  assert.deepStrictEqual(lp.parsePlayers(log), []);
});

test('"Closing socket 0" do shutdown não vira jogador', () => {
  const log = ['Closing socket 0', 'Got connection SteamID 76561198000000001'];
  const players = lp.parsePlayers(log);
  assert.strictEqual(players.length, 1);
});

test('log vazio ou nulo não derruba o parser', () => {
  assert.deepStrictEqual(lp.parsePlayers([]), []);
  assert.deepStrictEqual(lp.parsePlayers(''), []);
  assert.deepStrictEqual(lp.parsePlayers(null), []);
  assert.deepStrictEqual(lp.parsePlayers(undefined), []);
});

test('linhas em formato desconhecido são ignoradas, não quebram', () => {
  const log = [
    'lixo aleatório que não é log de nada',
    '!!!@#$%^&*()',
    'Got connection SteamID 76561198000000001',
    '',
  ];
  assert.strictEqual(lp.parsePlayers(log).length, 1);
});

test('aceita string com quebras de linha, não só array', () => {
  const log = 'Got connection SteamID 76561198000000001\nGot character ZDOID from Freya : 5:2';
  const players = lp.parsePlayers(log);
  assert.strictEqual(players.length, 1);
  assert.strictEqual(players[0].name, 'Freya');
});

test('aceita CRLF (log vindo de host Windows)', () => {
  const log = 'Got connection SteamID 76561198000000001\r\nClosing socket 76561198000000001\r\n';
  assert.deepStrictEqual(lp.parsePlayers(log), []);
});

test('vários jogadores entrando e saindo', () => {
  const log = [
    'Got connection SteamID 76561198000000001',
    'Got character ZDOID from Bjorn : 1:1',
    'Got connection SteamID 76561198000000002',
    'Got character ZDOID from Freya : 2:1',
    'Got connection SteamID 76561198000000003',
    'Got character ZDOID from Thor : 3:1',
    'Closing socket 76561198000000002',
  ];
  const players = lp.parsePlayers(log);
  assert.strictEqual(players.length, 2);
  const ids = players.map(p => p.steamId).sort();
  assert.deepStrictEqual(ids, ['76561198000000001', '76561198000000003']);
});

// ---- world save ----

test('pega o último World saved', () => {
  const log = [
    'World saved ( 100.0ms )',
    'alguma coisa',
    'World saved ( 250.5ms )',
  ];
  const last = lp.lastWorldSave(log);
  assert.ok(last);
  assert.strictEqual(last.durationMs, 250.5);
});

test('sem World saved devolve null', () => {
  assert.strictEqual(lp.lastWorldSave(['nada aqui']), null);
  assert.strictEqual(lp.lastWorldSave([]), null);
});

// ---- pronto / ruído ----

test('detecta servidor pronto', () => {
  assert.strictEqual(lp.serverReady(['Game server connected']), true);
  assert.strictEqual(lp.serverReady(['DungeonDB Start']), true);
  assert.strictEqual(lp.serverReady(['ainda subindo...']), false);
});

test('limpeza tira o ruído e respeita o limite', () => {
  const log = [
    'Destroying abandoned non persistent zdo 1:2',
    'Linha útil A',
    '',
    'Destroying abandoned non persistent zdo 3:4',
    'Linha útil B',
  ];
  const out = lp.cleanForDisplay(log);
  assert.deepStrictEqual(out, ['Linha útil A', 'Linha útil B']);
});

test('limpeza devolve as ÚLTIMAS N linhas, não as primeiras', () => {
  const log = [];
  for (let i = 0; i < 100; i++) log.push('linha ' + i);
  const out = lp.cleanForDisplay(log, 10);
  assert.strictEqual(out.length, 10);
  assert.strictEqual(out[9], 'linha 99');
  assert.strictEqual(out[0], 'linha 90');
});

test('extrai timestamp quando existe, null quando não', () => {
  assert.strictEqual(lp.extractTime('09/11/2026 14:00:01: Got connection'), '09/11/2026 14:00:01');
  assert.strictEqual(lp.extractTime('2026-09-11T14:00:01 algo'), '2026-09-11T14:00:01');
  assert.strictEqual(lp.extractTime('sem data aqui'), null);
});
