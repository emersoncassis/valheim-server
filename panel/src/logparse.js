'use strict';

/**
 * Parsing do log do servidor de Valheim.
 *
 * O log do Valheim é ruidoso e o formato varia entre versões. As regex aqui
 * são deliberadamente tolerantes: se uma linha não casa, ela é ignorada em
 * vez de derrubar o parser. É melhor mostrar "0 online" do que quebrar.
 *
 * Linhas que interessam:
 *   Got connection SteamID 76561198000000000
 *   Got handshake from client 12345678901234567
 *   Closing socket 76561198000000000
 *   Destroying abandoned non persistent zdo ...  (ignorada)
 *   Game server connected
 *   World saved ( 1234.5ms )
 */

const RE_CONNECT = /Got connection SteamID\s+(\d{5,25})/i;
const RE_HANDSHAKE = /Got handshake from client\s+(\d{5,25})/i;
const RE_DISCONNECT = /Closing socket\s+(\d{5,25})/i;
const RE_PLAYER_NAME = /Got character ZDOID from\s+(.+?)\s*:\s*(-?\d+):(-?\d+)/i;
const RE_SERVER_UP = /Game server connected|DungeonDB Start/i;
const RE_WORLD_SAVED = /World saved\s*\(\s*([\d.]+)\s*ms\s*\)/i;

/**
 * Varre as linhas do log e reconstrói quem está online.
 *
 * Estratégia: conexão entra no set, desconexão sai. O estado final do set
 * é quem está online. Isso é mais confiável do que contar eventos, porque
 * reconexões e quedas se cancelam naturalmente.
 *
 * "Closing socket 0" aparece no shutdown e não é um jogador — filtrado
 * pelo mínimo de 5 dígitos na regex.
 */
function parsePlayers(lines) {
  const online = new Map(); // steamId -> { steamId, name, since }

  for (const raw of toLines(lines)) {
    const line = String(raw);

    const conn = RE_CONNECT.exec(line) || RE_HANDSHAKE.exec(line);
    if (conn) {
      const id = conn[1];
      if (!online.has(id)) {
        online.set(id, { steamId: id, name: null, since: extractTime(line) });
      }
      continue;
    }

    // O nome do personagem aparece numa linha separada, logo depois da
    // conexão. Associamos ao jogador mais recente que ainda não tem nome.
    const named = RE_PLAYER_NAME.exec(line);
    if (named) {
      const charName = named[1].trim();
      for (const p of [...online.values()].reverse()) {
        if (!p.name) { p.name = charName; break; }
      }
      continue;
    }

    const disc = RE_DISCONNECT.exec(line);
    if (disc) {
      online.delete(disc[1]);
      continue;
    }
  }

  return [...online.values()];
}

/** Último "World saved" encontrado. Null se não houver. */
function lastWorldSave(lines) {
  let last = null;
  for (const raw of toLines(lines)) {
    const line = String(raw);
    const m = RE_WORLD_SAVED.exec(line);
    if (m) last = { durationMs: Number(m[1]), time: extractTime(line), line };
  }
  return last;
}

/** true se o log indica que o servidor terminou de subir. */
function serverReady(lines) {
  for (const raw of toLines(lines)) {
    if (RE_SERVER_UP.test(String(raw))) return true;
  }
  return false;
}

/**
 * Tenta extrair o timestamp do começo da linha.
 * O formato varia; se não reconhecer, devolve null em vez de chutar.
 */
function extractTime(line) {
  const m = /^(\d{2}\/\d{2}\/\d{4}\s+\d{2}:\d{2}:\d{2})/.exec(line)
    || /^\[?(\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}:\d{2})/.exec(line);
  return m ? m[1] : null;
}

/**
 * Limpa o log pra exibição: tira as linhas de ruído que enchem a tela
 * e não dizem nada.
 */
const NOISE = [
  /Destroying abandoned non persistent zdo/i,
  /^\s*$/,
  /Time server/i,
  /Sending RPC/i,
];

function cleanForDisplay(lines, limit = 200) {
  const out = [];
  for (const raw of toLines(lines)) {
    const line = String(raw);
    if (NOISE.some((re) => re.test(line))) continue;
    out.push(line);
  }
  return out.slice(-limit);
}

/** Aceita string com \n ou array. Normaliza pra array de linhas. */
function toLines(input) {
  if (Array.isArray(input)) return input;
  if (typeof input === 'string') return input.split(/\r?\n/);
  if (input == null) return [];
  return [String(input)];
}

module.exports = {
  parsePlayers,
  lastWorldSave,
  serverReady,
  cleanForDisplay,
  extractTime,
  toLines,
};
