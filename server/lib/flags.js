/* Chaves liga/desliga editáveis no admin (tabela settings), com a variável de ambiente como alternativa. */
const { q } = require('../db');
async function flag(key, envName) {
  if (envName && process.env[envName] === 'on') return true;
  const r = await q.get('SELECT value FROM settings WHERE key=?', key);
  return !!r && String(r.value) === '1';
}
module.exports = { flag };
