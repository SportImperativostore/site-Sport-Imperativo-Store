const crypto = require('crypto');
const { q } = require('../db');
const { sha, token, HttpError } = require('./util');

const SESSION_DAYS = 14;

function hashPassword(pw) {
  const salt = crypto.randomBytes(16);
  const h = crypto.scryptSync(pw, salt, 64);
  return `scrypt$${salt.toString('hex')}$${h.toString('hex')}`;
}
function verifyPassword(pw, stored) {
  const [alg, salt, hash] = String(stored).split('$');
  if (alg !== 'scrypt') return false;
  const h = crypto.scryptSync(pw, Buffer.from(salt, 'hex'), 64);
  return crypto.timingSafeEqual(h, Buffer.from(hash, 'hex'));
}
function parseCookies(req) {
  const o = {};
  for (const part of (req.headers.cookie || '').split(';')) {
    const i = part.indexOf('=');
    if (i > 0) o[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return o;
}
async function startSession(res, userId) {
  const t = token(32);
  await q.run('INSERT INTO sessions(token_hash,user_id,expires_at) VALUES(?,?,?)', sha(t), userId, Date.now() + SESSION_DAYS * 864e5);
  const secure = process.env.NODE_ENV === 'production' ? '; Secure' : '';
  res.setHeader('Set-Cookie', `sid=${t}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${SESSION_DAYS * 86400}${secure}`);
}
async function endSession(req, res) {
  const t = parseCookies(req).sid;
  if (t) await q.run('DELETE FROM sessions WHERE token_hash=?', sha(t));
  res.setHeader('Set-Cookie', 'sid=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0');
}
async function loadUser(req, _res, next) {
  const t = parseCookies(req).sid;
  req.user = null;
  if (t) {
    const s = await q.get('SELECT user_id, expires_at FROM sessions WHERE token_hash=?', sha(t));
    if (s && s.expires_at > Date.now()) {
      req.user = (await q.get('SELECT id,name,email,cpf,phone,whatsapp,role FROM users WHERE id=? AND deleted_at IS NULL', s.user_id)) || null;
    }
  }
  next();
}
const requireUser = (req, _res, next) => (req.user ? next() : next(new HttpError(401, 'Faça login para continuar.')));
const requireAdmin = (req, _res, next) => (req.user && req.user.role === 'admin' ? next() : next(new HttpError(403, 'Acesso restrito.')));

// Proteção CSRF: requisições que alteram estado precisam ser JSON/fetch e, se houver Origin, ele deve ser do mesmo host.
function csrfGuard(req, _res, next) {
  if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return next();
  if (req.path.startsWith('/api/webhooks/')) return next();
  const origin = req.headers.origin;
  if (origin) {
    try { if (new URL(origin).host !== req.headers.host) return next(new HttpError(403, 'Origem inválida.')); } catch { return next(new HttpError(403, 'Origem inválida.')); }
  }
  if (!req.headers['x-requested-with']) return next(new HttpError(403, 'Requisição inválida.'));
  next();
}
module.exports = { hashPassword, verifyPassword, startSession, endSession, loadUser, requireUser, requireAdmin, csrfGuard };
