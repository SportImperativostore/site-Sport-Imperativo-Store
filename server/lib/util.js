const crypto = require('crypto');

const norm = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();
const slugify = (s) => norm(s).replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
const onlyDigits = (s) => String(s || '').replace(/\D/g, '');
const sha = (s) => crypto.createHash('sha256').update(s).digest('hex');
const token = (n = 32) => crypto.randomBytes(n).toString('base64url');
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const brl = (c) => (c / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

function validCPF(v) {
  const c = onlyDigits(v);
  if (c.length !== 11 || /^(\d)\1+$/.test(c)) return false;
  for (let t = 9; t < 11; t++) {
    let s = 0;
    for (let i = 0; i < t; i++) s += +c[i] * (t + 1 - i);
    if (((s * 10) % 11) % 10 !== +c[t]) return false;
  }
  return true;
}
const validEmail = (e) => /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(e || '') && e.length < 160;

const buckets = new Map();
// Limitador simples em memória (por IP + chave). Em produção multi-instância, usar Redis.
function rateLimit(key, max, windowMs) {
  return (req, res, next) => {
    const k = key + ':' + (req.ip || '');
    const now = Date.now();
    let b = buckets.get(k);
    if (!b || b.reset < now) b = { n: 0, reset: now + windowMs };
    b.n++;
    buckets.set(k, b);
    if (b.n > max) return res.status(429).json({ error: 'Muitas tentativas. Aguarde alguns minutos.' });
    next();
  };
}
setInterval(() => { const n = Date.now(); for (const [k, b] of buckets) if (b.reset < n) buckets.delete(k); }, 60000).unref();

class HttpError extends Error { constructor(status, msg) { super(msg); this.status = status; } }
const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

module.exports = { norm, slugify, onlyDigits, sha, token, esc, brl, validCPF, validEmail, rateLimit, HttpError, wrap };
