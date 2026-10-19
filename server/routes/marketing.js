/* Rotas do e-mail marketing: públicas (aceite, convite, descadastro) e do admin (campanhas). */
const express = require('express');
const { q } = require('../db');
const mkt = require('../lib/marketing');
const { wrap, HttpError, rateLimit, validEmail } = require('../lib/util');

const pub = express.Router();
pub.post('/marketing/optin', rateLimit('mkt-optin', 20, 10 * 60 * 1000), wrap(async (req, res) => {
  const b = req.body || {};
  if (!validEmail(String(b.email || '').toLowerCase().trim())) throw new HttpError(400, 'E-mail inválido.');
  res.json(await mkt.optIn({ email: b.email, name: b.name, source: ['cadastro', 'checkout', 'rodape'].includes(b.source) ? b.source : 'site' }));
}));
const page = (msg) => `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Sport Imperativo Store</title><body style="font-family:system-ui,Arial;max-width:520px;margin:12vh auto;padding:0 20px;color:#0d1b33"><h2>${msg}</h2><p><a href="/" style="color:#0b5cff">Voltar para a loja</a></p></body>`;
pub.get('/marketing/confirm', wrap(async (req, res) => {
  const ok = await mkt.confirmByToken(req.query.t);
  res.set('Cache-Control', 'no-store').type('html').send(page(ok ? 'Pronto! Você vai receber nossas ofertas por e-mail.' : 'Link inválido ou expirado.'));
}));

const admin = express.Router();
const C = (r) => ({ ...r, params: mkt.parseP(r) });
admin.get('/marketing/overview', wrap(async (_req, res) => res.json({ ...(await mkt.overview()), enabled: await require('../lib/flags').flag('marketing_enabled', 'MARKETING_ENABLED'), cronSecret: true })));
admin.get('/marketing/campaigns', wrap(async (_req, res) => res.json((await q.all('SELECT * FROM mkt_campaigns ORDER BY id DESC LIMIT 50')).map(C))));
const clean = (b) => ({
  name: String(b.name || '').trim().slice(0, 80), subject: String(b.subject || '').trim().slice(0, 150), audience: ['opted', 'buyers', 'nonbuyers', 'invite'].includes(b.audience) ? b.audience : 'opted',
  params: { title: String(b.title || '').slice(0, 120), body: String(b.body || '').slice(0, 3000), banner: String(b.banner || '').trim().slice(0, 400), button_text: String(b.button_text || '').slice(0, 40), button_link: String(b.button_link || '').trim().slice(0, 400), products: String(b.products || '').slice(0, 1500), coupon: String(b.coupon || '').trim().slice(0, 30) },
});
admin.post('/marketing/preview', wrap(async (req, res) => { const c = clean(req.body || {}); res.json({ html: await mkt.render(c.params, 'preview', c.audience === 'invite' ? 'convite' : 'campanha') }); }));
admin.post('/marketing/test', wrap(async (req, res) => {
  const c = clean(req.body || {}); const to = (req.user && req.user.email) || '';
  if (!c.subject || !c.params.body) throw new HttpError(400, 'Informe assunto e texto.');
  res.json({ to, ...(await mkt.sendTest(c.params, c.subject, to)) });
}));
admin.post('/marketing/campaigns', wrap(async (req, res) => {
  const c = clean(req.body || {});
  if (!c.name || !c.subject || !c.params.body) throw new HttpError(400, 'Informe nome, assunto e texto da campanha.');
  const r = await q.run('INSERT INTO mkt_campaigns(name,subject,params,audience) VALUES(?,?,?,?)', c.name, c.subject, JSON.stringify(c.params), c.audience);
  res.json({ id: Number(r.lastInsertRowid) });
}));
admin.post('/marketing/campaigns/:id/start', wrap(async (req, res) => {
  if (!(await require('../lib/flags').flag('marketing_enabled', 'MARKETING_ENABLED'))) throw new HttpError(400, 'O envio de campanhas está desligado: ligue na parte de cima desta página.');
  const out = await mkt.start(+req.params.id); if (out.error) throw new HttpError(400, out.error); res.json(out);
}));
admin.post('/marketing/campaigns/:id/cancel', wrap(async (req, res) => { await mkt.cancel(+req.params.id); res.json({ ok: true }); }));
admin.get('/marketing/audience/:kind', wrap(async (req, res) => res.json({ count: (await mkt.audienceRows(req.params.kind)).length })));

module.exports = { pub, admin };
