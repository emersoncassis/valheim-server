'use strict';

const crypto = require('crypto');

/**
 * Autenticação do painel.
 *
 * Decisões:
 * - Senha vem de variável de ambiente, nunca do código.
 * - Comparação em tempo constante (timingSafeEqual) pra não vazar a senha
 *   por diferença de tempo de resposta.
 * - Sessão = cookie assinado com HMAC. Sem banco, sem estado no servidor,
 *   então reiniciar o painel não derruba ninguém.
 * - O cookie carrega só usuário + validade. Não carrega a senha.
 */

/** Compara duas strings em tempo constante. */
function safeEqual(a, b) {
  const bufA = Buffer.from(String(a), 'utf8');
  const bufB = Buffer.from(String(b), 'utf8');
  // timingSafeEqual exige mesmo tamanho. Hasheamos pra normalizar o tamanho
  // sem criar um oráculo de comprimento.
  const hashA = crypto.createHash('sha256').update(bufA).digest();
  const hashB = crypto.createHash('sha256').update(bufB).digest();
  return crypto.timingSafeEqual(hashA, hashB);
}

function base64url(buf) {
  return Buffer.from(buf).toString('base64')
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function fromBase64url(str) {
  return Buffer.from(String(str).replace(/-/g, '+').replace(/_/g, '/'), 'base64');
}

/**
 * Cria um token de sessão assinado.
 * Formato: base64url(payloadJSON).base64url(hmac)
 */
function createSession(user, secret, hours = 12, now = Date.now()) {
  if (!secret) throw new Error('PANEL_SESSION_SECRET ausente');
  const payload = {
    u: user,
    exp: now + hours * 3600 * 1000,
    // nonce: dois logins seguidos geram tokens diferentes.
    n: crypto.randomBytes(8).toString('hex'),
  };
  const body = base64url(JSON.stringify(payload));
  const sig = base64url(crypto.createHmac('sha256', secret).update(body).digest());
  return `${body}.${sig}`;
}

/**
 * Verifica um token. Retorna o payload se válido, ou null.
 * null cobre: formato errado, assinatura inválida, expirado.
 */
function verifySession(token, secret, now = Date.now()) {
  if (!token || typeof token !== 'string' || !secret) return null;

  const parts = token.split('.');
  if (parts.length !== 2) return null;

  const [body, sig] = parts;
  if (!body || !sig) return null;

  const expected = crypto.createHmac('sha256', secret).update(body).digest();
  let given;
  try {
    given = fromBase64url(sig);
  } catch {
    return null;
  }
  if (given.length !== expected.length) return null;
  if (!crypto.timingSafeEqual(given, expected)) return null;

  let payload;
  try {
    payload = JSON.parse(fromBase64url(body).toString('utf8'));
  } catch {
    return null;
  }

  if (!payload || typeof payload.exp !== 'number') return null;
  if (payload.exp <= now) return null;

  return payload;
}

/** Confere usuário e senha contra as variáveis de ambiente. */
function checkCredentials(user, pass, env = process.env) {
  const expectedUser = env.PANEL_USER;
  const expectedPass = env.PANEL_PASS;
  if (!expectedUser || !expectedPass) return false;
  if (typeof user !== 'string' || typeof pass !== 'string') return false;
  // Avalia os dois sempre, sem curto-circuito, pra não vazar qual errou.
  const okUser = safeEqual(user, expectedUser);
  const okPass = safeEqual(pass, expectedPass);
  return okUser && okPass;
}

/** Lê um cookie específico do header Cookie. */
function parseCookie(header, name) {
  if (!header || typeof header !== 'string') return null;
  for (const part of header.split(';')) {
    const idx = part.indexOf('=');
    if (idx === -1) continue;
    if (part.slice(0, idx).trim() === name) {
      return decodeURIComponent(part.slice(idx + 1).trim());
    }
  }
  return null;
}

/** Monta o header Set-Cookie da sessão. HttpOnly + SameSite=Strict. */
function sessionCookie(token, hours = 12, secure = false) {
  const attrs = [
    `vh_session=${encodeURIComponent(token)}`,
    'HttpOnly',
    'SameSite=Strict',
    'Path=/',
    `Max-Age=${Math.floor(hours * 3600)}`,
  ];
  if (secure) attrs.push('Secure');
  return attrs.join('; ');
}

/** Cookie que apaga a sessão (logout). */
function clearCookie() {
  return 'vh_session=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0';
}

/**
 * Rate limit de login por IP, em memória.
 * Não é defesa contra botnet, mas mata brute force de um IP só.
 */
class LoginLimiter {
  constructor({ maxAttempts = 5, windowMs = 15 * 60 * 1000 } = {}) {
    this.maxAttempts = maxAttempts;
    this.windowMs = windowMs;
    this.attempts = new Map();
  }

  isBlocked(ip, now = Date.now()) {
    const rec = this.attempts.get(ip);
    if (!rec) return false;
    if (now - rec.first > this.windowMs) {
      this.attempts.delete(ip);
      return false;
    }
    return rec.count >= this.maxAttempts;
  }

  recordFailure(ip, now = Date.now()) {
    const rec = this.attempts.get(ip);
    if (!rec || now - rec.first > this.windowMs) {
      this.attempts.set(ip, { count: 1, first: now });
      return;
    }
    rec.count += 1;
  }

  reset(ip) {
    this.attempts.delete(ip);
  }
}

module.exports = {
  safeEqual,
  createSession,
  verifySession,
  checkCredentials,
  parseCookie,
  sessionCookie,
  clearCookie,
  LoginLimiter,
};
