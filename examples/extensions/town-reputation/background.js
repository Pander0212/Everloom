// Keeps {{script::townrep}} current for the prompt block, and adds /rep.
const label = (v) => (v >= 60 ? 'beloved' : v >= 25 ? 'liked' : v > -25 ? 'known' : v > -60 ? 'distrusted' : 'hated');

async function publish() {
  const state = await everloom.state.get().catch(() => null);
  const towns = state?.ext?.['town-reputation']?.towns ?? {};
  const text = Object.entries(towns).map(([t, v]) => `${t}: ${label(v)} (${v})`).join('; ') || 'none yet';
  await everloom.macros.set('townrep', text);
}

everloom.slash.register('rep', { help: 'Change your reputation with a town', usage: '/rep Eastport +5' }, async (call) => {
  const m = /^(.+?)\s+([+-]?\d+)$/.exec(call.text.trim());
  if (!m) throw new Error('Write it as /rep Town +5');
  const r = await everloom.state.propose({ type: 'ext.op', ext: 'town-reputation', name: 'change', args: { town: m[1], amount: Number(m[2]) } });
  if (r.errors?.length) throw new Error(r.errors.join('; '));
  await publish();
  return (r.summary || []).join(', ');
});

everloom.on('message', publish);
everloom.on('swipe', publish);
everloom.on('chatOpen', publish);
publish();
