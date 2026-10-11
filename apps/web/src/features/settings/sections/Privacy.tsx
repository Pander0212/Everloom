/**
 * Settings › Privacy › Name shield: names the AI provider never sees. Each protected term has a
 * stand-in (suggested, re-rollable or typed), a kind, extra forms and a scope. Storage always keeps
 * the real names; only what goes over the wire changes.
 */
import type { ShieldKind, ShieldTerm } from '@everloom/engine';
import { Dices, Plus, Trash2 } from 'lucide-react';
import { useEffect, useState } from 'react';
import { post } from '@/lib/api';
import { useCharacters, useChats, usePersonas } from '@/lib/queries';
import { toastError } from '@/lib/store';
import { askExportPasswordChoice, setAskExportPassword, vaultOn } from '@/lib/vaultMode';
import { Button, Field, IconButton, Input, Select, Switch, Textarea, ToggleRow } from '@/ui';
import { Section, useSettingsPatch } from '../common';
import { VaultSection } from './Vault';

const KINDS: Array<{ value: ShieldKind; label: string }> = [
  { value: 'full', label: 'Full name' },
  { value: 'first', label: 'First name' },
  { value: 'last', label: 'Last name' },
  { value: 'place', label: 'Place' },
  { value: 'other', label: 'Other' },
];

export default function PrivacySection() {
  const { settings, update } = useSettingsPatch();
  const [terms, setTerms] = useState<ShieldTerm[]>([]);
  useEffect(() => {
    if (settings) setTerms(settings.privacy.shield.terms);
  }, [settings?.privacy.shield.terms]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!settings) return null;
  const sh = settings.privacy.shield;
  const save = (next: ShieldTerm[]) => {
    setTerms(next);
    void update({ privacy: { shield: { terms: next } } } as never);
  };
  const add = async () => {
    try {
      const { standin } = await post<{ standin: string }>('/api/privacy/standin', { kind: 'full', seed: String(Date.now()) });
      save([...terms, { id: `t${Date.now().toString(36)}`, real: '', standin, kind: 'full', forms: [], scope: { type: 'all' }, enabled: true }]);
    } catch (e) {
      toastError(e);
    }
  };
  return (
    <>
      <VaultSection />
      <ExportPasswordSection />
      <Section title="Screen sharing">
        <ToggleRow label="Blur 18+ pictures in lists" description="Off by default. Blurs the pictures of characters, 3D avatars and online characters marked 18+ in lists and grids, for when you share your screen. Opening one shows it as usual." checked={settings?.library.blurAdult === true} onChange={(v) => update({ library: { blurAdult: v } } as never)} />
      </Section>
      <Section title="Name shield" description="Names you list here never reach the AI provider. It gets a stand-in name instead, and Everloom puts the real name back in the reply before anything is saved or shown.">
        <div className="flex flex-col gap-4">
          <ToggleRow label="Use the name shield" description="Off, everything is sent as written." checked={sh.enabled} onChange={(v) => update({ privacy: { shield: { enabled: v } } } as never)} />
          <ul className="flex flex-col gap-3" aria-label="Protected names">
            {terms.map((t, i) => (
              <TermRow key={t.id} term={t} onChange={(nt) => save(terms.map((x, j) => (j === i ? nt : x)))} onDelete={() => save(terms.filter((_, j) => j !== i))} />
            ))}
          </ul>
          <div>
            <Button icon={Plus} onClick={add}>
              Add a name
            </Button>
          </div>
          <Field label="If a protected name is still in a request" htmlFor="sh-leak" hint="A last check runs on every request after the swap.">
            <Select id="sh-leak" value={sh.onLeak} onChange={(e) => update({ privacy: { shield: { onLeak: e.target.value as 'block' | 'ask' } } } as never)}>
              <option value="block">Stop the request</option>
              <option value="ask">Stop it and let me send it anyway</option>
            </Select>
          </Field>
          <ToggleRow
            label="Let cloud voices say the real names"
            description="Off, a cloud voice reads the stand-in (it never receives the real name). The browser's own voice runs on your device and always says the real name."
            checked={sh.ttsRealNames}
            onChange={(v) => update({ privacy: { shield: { ttsRealNames: v } } } as never)}
          />
          <ShieldPreview />
        </div>
      </Section>
      <Section title="What the name shield can't do">
        <ul className="flex list-disc flex-col gap-1.5 pl-5 text-sm text-fg-2">
          <li>Context can still identify someone: a job, a street or a unique story isn't hidden.</li>
          <li>Misspellings aren't caught unless you add them as extra forms.</li>
          <li>A model may shorten a stand-in ("Marcus" to "Marc"). Simple cases are flagged on the message; check them.</li>
          <li>Pictures you upload aren't analyzed: a name written in an image goes out as is.</li>
          <li>Stand-ins are changed per chat if they clash with a character, person or place in it (you get a notice).</li>
        </ul>
      </Section>
    </>
  );
}

function ExportPasswordSection() {
  const [ask, setAsk] = useState(askExportPasswordChoice);
  const forced = vaultOn();
  return (
    <Section title="Exports">
      <ToggleRow
        label="Offer a password for exports"
        description={forced ? 'Always on while the vault is on. Leave the password empty to export a plain file.' : 'Each export asks for an optional password. A protected file (.evlt) opens only in Everloom, with that password.'}
        checked={forced || ask}
        disabled={forced}
        onChange={(v) => {
          setAsk(v);
          setAskExportPassword(v);
        }}
      />
    </Section>
  );
}

function TermRow({ term, onChange, onDelete }: { term: ShieldTerm; onChange: (t: ShieldTerm) => void; onDelete: () => void }) {
  const personas = usePersonas();
  const chars = useCharacters();
  const chats = useChats();
  const [real, setReal] = useState(term.real);
  const [standin, setStandin] = useState(term.standin);
  const [forms, setForms] = useState(term.forms.join(', '));
  useEffect(() => {
    setReal(term.real);
    setStandin(term.standin);
    setForms(term.forms.join(', '));
  }, [term]);
  const reroll = async () => {
    try {
      const r = await post<{ standin: string }>('/api/privacy/standin', { kind: term.kind, seed: `${term.real}:${Date.now()}` });
      onChange({ ...term, standin: r.standin });
    } catch (e) {
      toastError(e);
    }
  };
  const scopeValue = term.scope.type === 'all' ? 'all' : `${term.scope.type}:${term.scope.id}`;
  const label = term.real || 'New name';
  return (
    <li className="flex flex-col gap-2 rounded-lg border border-line p-3">
      <div className="grid gap-2 sm:grid-cols-2">
        <Input aria-label={`Real name (${label})`} placeholder="Real name" value={real} onChange={(e) => setReal(e.target.value)} onBlur={() => real !== term.real && onChange({ ...term, real: real.trim() })} />
        <div className="flex gap-1">
          <Input aria-label={`Stand-in for ${label}`} placeholder="Stand-in" value={standin} onChange={(e) => setStandin(e.target.value)} onBlur={() => standin.trim() && standin !== term.standin && onChange({ ...term, standin: standin.trim() })} />
          <IconButton icon={Dices} label={`New stand-in for ${label}`} onClick={reroll} />
        </div>
      </div>
      <div className="grid gap-2 sm:grid-cols-2">
        <Select aria-label={`Kind of ${label}`} value={term.kind} onChange={(e) => onChange({ ...term, kind: e.target.value as ShieldKind })}>
          {KINDS.map((k) => (
            <option key={k.value} value={k.value}>
              {k.label}
            </option>
          ))}
        </Select>
        <Select
          aria-label={`Where ${label} is hidden`}
          value={scopeValue}
          onChange={(e) => {
            const v = e.target.value;
            if (v === 'all') return onChange({ ...term, scope: { type: 'all' } });
            const [type, id] = v.split(':') as ['persona' | 'character' | 'chat', string];
            onChange({ ...term, scope: { type, id } });
          }}
        >
          <option value="all">Everywhere</option>
          <optgroup label="One persona">
            {(personas.data ?? []).map((p) => (
              <option key={p.id} value={`persona:${p.id}`}>
                {p.name}
              </option>
            ))}
          </optgroup>
          <optgroup label="One character">
            {(chars.data ?? []).slice(0, 300).map((c) => (
              <option key={c.id} value={`character:${c.id}`}>
                {c.name}
              </option>
            ))}
          </optgroup>
          <optgroup label="One chat">
            {(chats.data ?? []).slice(0, 100).map((c) => (
              <option key={c.id} value={`chat:${c.id}`}>
                {c.title}
              </option>
            ))}
          </optgroup>
        </Select>
      </div>
      <Input aria-label={`Other forms of ${label}`} placeholder="Nicknames and other spellings, comma separated" value={forms} onChange={(e) => setForms(e.target.value)} onBlur={() => onChange({ ...term, forms: forms.split(',').map((f) => f.trim()).filter(Boolean) })} />
      <div className="flex items-center gap-3">
        <Switch label={`Hide ${label}`} checked={term.enabled !== false} onChange={(v) => onChange({ ...term, enabled: v })} />
        <span className="flex-1 text-xs text-fg-2">{term.enabled !== false ? 'Hidden' : 'Not hidden'}</span>
        <IconButton icon={Trash2} label={`Remove ${label}`} onClick={onDelete} />
      </div>
    </li>
  );
}

function ShieldPreview() {
  const [text, setText] = useState('');
  const [out, setOut] = useState<{ sent: string; leaks: string[] } | null>(null);
  useEffect(() => {
    if (!text.trim()) return setOut(null);
    const t = setTimeout(() => {
      post<{ sent: string; leaks: string[] }>('/api/privacy/preview', { text }).then(setOut, () => setOut(null));
    }, 300);
    return () => clearTimeout(t);
  }, [text]);
  return (
    <Field label="Try it" htmlFor="sh-try" hint="What the provider would receive for this text.">
      <Textarea id="sh-try" rows={2} value={text} onChange={(e) => setText(e.target.value)} placeholder="Type something with a protected name" />
      {out ? (
        <p className="mt-2 rounded-md bg-surface-2 p-2 text-sm" aria-label="As sent">
          {out.sent}
        </p>
      ) : null}
    </Field>
  );
}
