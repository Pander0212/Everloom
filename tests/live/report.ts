/** Summarise tests/live/out/*.json into Markdown (docs/echo/LIVE.md tables). */
import { readdirSync, readFileSync } from 'node:fs';

const dir = 'tests/live/out';
const runs = readdirSync(dir)
  .filter((f) => f.endsWith('.json') && f !== 'extract-compare.json')
  .map((f) => JSON.parse(readFileSync(`${dir}/${f}`, 'utf8')))
  .sort((a, b) => a.script.localeCompare(b.script) || a.model.localeCompare(b.model) || a.profile.localeCompare(b.profile));

const pct = (xs: number[], p: number) => (xs.length ? xs.slice().sort((a, b) => a - b)[Math.min(xs.length - 1, Math.floor((p / 100) * xs.length))] : 0);
const avg = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);

/** Who must NOT know what, checked on ECHO's own records (deterministic). */
const LEAK_RULES: Record<string, Array<{ who: RegExp; must: 'know' | 'not'; word: string; label: string }>> = {
  guildbound: [
    { who: /^miki$/i, must: 'not', word: 'earth', label: 'Miki ✗ Earth' },
    { who: /^miki$/i, must: 'not', word: 'boot', label: 'Miki ✗ key' },
    { who: /^miki$/i, must: 'know', word: 'lowmere', label: 'Miki ✓ lie' },
    { who: /gravitas|dwarf|guildmaster/i, must: 'know', word: 'earth', label: 'dwarf ✓ Earth' },
  ],
  korra: [
    { who: /^bolin/i, must: 'not', word: 'cannery', label: 'Bolin ✗ cannery' },
    { who: /^mako/i, must: 'not', word: 'cannery', label: 'Mako ✗ cannery' },
    { who: /^bolin/i, must: 'not', word: 'pamphlet', label: 'Bolin ✗ pamphlet' },
    { who: /^bolin/i, must: 'know', word: 'cart', label: 'Bolin ✓ promise' },
  ],
};

const lines: string[] = [];
lines.push('| Card | Writer model | Profile | Turns ok | Reply s p50/p95 | Prompt tok/turn | ECHO packet tok avg/max | Probes (writer) | ECHO records | Swipe | Tokens total |');
lines.push('|---|---|---|---|---|---|---|---|---|---|---|');
for (const r of runs) {
  const ok = r.turns.filter((t: any) => t.reply && !t.error).length;
  const replies = r.calls.filter((c: any) => c.purpose === 'reply' && c.ok);
  const ms = replies.map((c: any) => c.ms / 1000);
  const pk = r.turns.map((t: any) => t.packet?.tokens ?? 0);
  let pass = 0;
  let total = 0;
  for (const p of r.probes) for (const k of ['replyMentions', 'replyAvoids'] as const) for (const x of p[k] ?? []) {
    total++;
    if (k === 'replyMentions' ? x.hit : !x.hit) pass++;
  }
  const rules = LEAK_RULES[r.script] ?? [];
  const recs: string[] = [];
  for (const rule of rules) {
    const actor = Object.values(r.knowledge as Record<string, any>).find((k: any) => rule.who.test(k.name)) as any;
    if (!actor) {
      recs.push(`${rule.label}: n/a`);
      continue;
    }
    const has = JSON.stringify(actor).toLowerCase().includes(rule.word);
    recs.push(`${(rule.must === 'know') === has ? '✅' : '❌'} ${rule.label}`);
  }
  lines.push(`| ${r.script} | ${r.model} | ${r.profile} | ${ok}/${r.turns.length} | ${pct(ms, 50).toFixed(0)}/${pct(ms, 95).toFixed(0)} | ${Math.round(avg(replies.map((c: any) => c.tokensIn)))} | ${Math.round(avg(pk))}/${Math.max(0, ...pk)} | ${pass}/${total} | ${recs.join('<br>')} | ${r.swipe?.restored ? '✅' : '❌'} | ${r.usage.all.in + r.usage.all.out} |`);
}
lines.push('');
lines.push('Probe details (writer behavior):');
lines.push('');
for (const r of runs) {
  const misses = r.probes.flatMap((p: any) => [...(p.replyMentions ?? []).filter((x: any) => !x.hit).map((x: any) => `${p.tag}: did not mention "${x.w}"`), ...(p.replyAvoids ?? []).filter((x: any) => x.hit).map((x: any) => `${p.tag}: said "${x.w}"`)]);
  lines.push(`- ${r.script} · ${r.model} · ${r.profile}: ${misses.length ? misses.join('; ') : 'all probes passed'}`);
}
const tok = runs.reduce((a, r) => a + r.usage.all.in + r.usage.all.out, 0);
lines.push('', `Total tokens across these runs: ${tok.toLocaleString('en')}`);
console.log(lines.join('\n'));
