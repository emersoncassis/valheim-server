'use strict';

const test = require('node:test');
const assert = require('node:assert');
const auth = require('../src/auth');

const SECRET = 'segredo-de-teste-bem-longo-abcdef0123456789';

test('sessão válida sobrevive ao round-trip', () => {
  const token = auth.createSession('admin', SECRET, 12);
  const payload = auth.verifySession(token, SECRET);
  assert.ok(payload);
  assert.strictEqual(payload.u, 'admin');
});

test('token com assinatura adulterada é rejeitado', () => {
  const token = auth.createSession('admin', SECRET, 12);
  const [body] = token.split('.');
  const forjado = body + '.' + 'a'.repeat(43);
  assert.strictEqual(auth.verifySession(forjado, SECRET), null);
});

test('payload adulterado invalida a assinatura', () => {
  // Cenário real: atacante troca o usuário pra "admin" e reenvia.
  const token = auth.createSession('convidado', SECRET, 12);
  const [, sig] = token.split('.');
  const mau = Buffer.from(JSON.stringify({ u: 'admin', exp: Date.now() + 1e6 }))
    .toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  assert.strictEqual(auth.verifySession(`${mau}.${sig}`, SECRET), null);
});

test('token assinado com outro segredo é rejeitado', () => {
  const token = auth.createSession('admin', 'outro-segredo-completamente-diferente', 12);
  assert.strictEqual(auth.verifySession(token, SECRET), null);
});

test('sessão expirada é rejeitada', () => {
  const agora = Date.now();
  const token = auth.createSession('admin', SECRET, 1, agora);
  // 1h1min depois
  assert.strictEqual(auth.verifySession(token, SECRET, agora + 3660 * 1000), null);
  // ainda dentro da hora: vale
  assert.ok(auth.verifySession(token, SECRET, agora + 1800 * 1000));
});

test('entradas malformadas não derrubam o verify', () => {
  for (const t of [null, undefined, '', 'abc', 'a.b.c', '.', 'x.', '.y', 42, {}]) {
    assert.strictEqual(auth.verifySession(t, SECRET), null, `falhou em: ${JSON.stringify(t)}`);
  }
});

test('verify sem segredo retorna null em vez de passar', () => {
  const token = auth.createSession('admin', SECRET, 12);
  assert.strictEqual(auth.verifySession(token, ''), null);
  assert.strictEqual(auth.verifySession(token, undefined), null);
});

test('createSession sem segredo lança', () => {
  assert.throws(() => auth.createSession('admin', '', 12));
});

test('dois tokens seguidos são diferentes (nonce)', () => {
  const a = auth.createSession('admin', SECRET, 12);
  const b = auth.createSession('admin', SECRET, 12);
  assert.notStrictEqual(a, b);
});

// ---- credenciais ----

test('credenciais corretas passam, erradas não', () => {
  const env = { PANEL_USER: 'admin', PANEL_PASS: 'senha-secreta-123' };
  assert.strictEqual(auth.checkCredentials('admin', 'senha-secreta-123', env), true);
  assert.strictEqual(auth.checkCredentials('admin', 'errada', env), false);
  assert.strictEqual(auth.checkCredentials('outro', 'senha-secreta-123', env), false);
  assert.strictEqual(auth.checkCredentials('', '', env), false);
});

test('senha quase certa é rejeitada', () => {
  const env = { PANEL_USER: 'admin', PANEL_PASS: 'senha-secreta-123' };
  assert.strictEqual(auth.checkCredentials('admin', 'senha-secreta-12', env), false);
  assert.strictEqual(auth.checkCredentials('admin', 'senha-secreta-1234', env), false);
  assert.strictEqual(auth.checkCredentials('admin', 'Senha-secreta-123', env), false);
});

test('env sem senha configurada nega tudo', () => {
  // Protege contra o pior caso: variável esquecida virando painel aberto.
  assert.strictEqual(auth.checkCredentials('admin', 'qualquer', {}), false);
  assert.strictEqual(auth.checkCredentials('', '', {}), false);
  assert.strictEqual(auth.checkCredentials('admin', '', { PANEL_USER: 'admin' }), false);
});

test('tipos não-string em credenciais são rejeitados', () => {
  const env = { PANEL_USER: 'admin', PANEL_PASS: 'senha-secreta-123' };
  assert.strictEqual(auth.checkCredentials(null, null, env), false);
  assert.strictEqual(auth.checkCredentials({}, [], env), false);
});

// ---- cookies ----

test('parseCookie acha o cookie certo no meio dos outros', () => {
  const h = 'outro=1; vh_session=abc.def; theme=dark';
  assert.strictEqual(auth.parseCookie(h, 'vh_session'), 'abc.def');
  assert.strictEqual(auth.parseCookie(h, 'inexistente'), null);
  assert.strictEqual(auth.parseCookie(undefined, 'vh_session'), null);
});

test('cookie de sessão tem HttpOnly e SameSite', () => {
  const c = auth.sessionCookie('tok', 12, false);
  assert.match(c, /HttpOnly/);
  assert.match(c, /SameSite=Strict/);
  assert.ok(!/Secure/.test(c));
  assert.match(auth.sessionCookie('tok', 12, true), /Secure/);
});

test('clearCookie expira imediatamente', () => {
  assert.match(auth.clearCookie(), /Max-Age=0/);
});

// ---- rate limit ----

test('limiter bloqueia após 5 falhas e libera depois da janela', () => {
  const lim = new auth.LoginLimiter({ maxAttempts: 5, windowMs: 1000 });
  const ip = '10.0.0.1';
  const t0 = 1_000_000;

  for (let i = 0; i < 4; i++) lim.recordFailure(ip, t0);
  assert.strictEqual(lim.isBlocked(ip, t0), false, '4 falhas não devem bloquear');

  lim.recordFailure(ip, t0);
  assert.strictEqual(lim.isBlocked(ip, t0), true, '5 falhas devem bloquear');

  // Passada a janela, libera.
  assert.strictEqual(lim.isBlocked(ip, t0 + 2000), false);
});

test('login bem-sucedido zera o contador', () => {
  const lim = new auth.LoginLimiter({ maxAttempts: 3, windowMs: 60000 });
  const ip = '10.0.0.2';
  lim.recordFailure(ip); lim.recordFailure(ip); lim.recordFailure(ip);
  assert.strictEqual(lim.isBlocked(ip), true);
  lim.reset(ip);
  assert.strictEqual(lim.isBlocked(ip), false);
});

test('bloqueio de um IP não afeta outro', () => {
  const lim = new auth.LoginLimiter({ maxAttempts: 2, windowMs: 60000 });
  lim.recordFailure('1.1.1.1'); lim.recordFailure('1.1.1.1');
  assert.strictEqual(lim.isBlocked('1.1.1.1'), true);
  assert.strictEqual(lim.isBlocked('2.2.2.2'), false);
});
