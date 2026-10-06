// Uso:  npm run db:setup   (estrutura base + admin, sem produtos)    |   npm run db:seed   (com dados de demonstração)
// Em produção (Turso) defina TURSO_DATABASE_URL e TURSO_AUTH_TOKEN antes de rodar.
const { ensureSeed } = require('../server/seed');
const demo = process.argv.includes('--demo');
ensureSeed({ demo }).then((done) => {
  console.log(done ? `Banco inicializado${demo ? ' com dados de demonstração' : ' (estrutura base, sem produtos)'}.` : 'Banco já possui dados — nada a fazer.');
  process.exit(0);
}).catch((e) => { console.error(e); process.exit(1); });
