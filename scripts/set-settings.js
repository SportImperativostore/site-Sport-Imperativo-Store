/* Ajusta configurações públicas da loja (WhatsApp, YouTube, Instagram) e remove o TikTok. Uso: node --env-file=.env scripts/set-settings.js */
const { q, init, refreshSettings } = require('../server/db');
(async () => {
  await init();
  const S = { whatsapp_link: 'https://wa.me/message/JH33EJEBWUIHG1', youtube: 'https://youtube.com/@sportimperativo', instagram_feedback_url: 'https://www.instagram.com/stories/highlights/17940549296839297/' };
  for (const [k, v] of Object.entries(S)) await q.run('INSERT INTO settings(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value', k, v);
  const ig = await q.get("SELECT value FROM settings WHERE key='instagram'");
  if (!ig || !ig.value || /^https:\/\/www\.instagram\.com\/?$/.test(ig.value)) await q.run("INSERT INTO settings(key,value) VALUES('instagram',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value", S.instagram_feedback_url);
  await q.run("DELETE FROM settings WHERE key='tiktok'");
  await refreshSettings();
  console.log('configurações atualizadas'); process.exit(0);
})().catch((e) => { console.error(e); process.exit(1); });
