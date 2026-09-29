import type { LucideIcon } from 'lucide-react';
import { ArrowUp, FastForward, Mic, MicOff, Plus, Square, Theater, UserRoundPen, Wand2 } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { cx } from '@/lib/format';
import { toast } from '@/lib/store';
import { IconButton, Menu, type MenuItem } from '@/ui';

export interface ComposerProps {
  busy: boolean;
  enterToSend: boolean;
  stt: boolean;
  placeholder: string;
  onSend: (text: string) => void;
  onStop: () => void;
  onContinue: () => void;
  onImpersonate: () => Promise<string | null>;
  onSuggest?: () => Promise<string | null>;
  extraItems?: MenuItem[];
  /** Chips above the input (target selector, emotes…). */
  accessory?: React.ReactNode;
  value: string;
  onChange: (v: string) => void;
}

type SR = { start: () => void; stop: () => void; onresult: (e: any) => void; onend: () => void; onerror: (e: any) => void; continuous: boolean; interimResults: boolean; lang: string };

export function Composer({ busy, enterToSend, stt, placeholder, onSend, onStop, onContinue, onImpersonate, onSuggest, extraItems = [], accessory, value, onChange }: ComposerProps) {
  const ref = useRef<HTMLTextAreaElement>(null);
  const [listening, setListening] = useState(false);
  const recog = useRef<SR | null>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, 180)}px`;
  }, [value]);
  const submit = () => {
    if (busy) return;
    onSend(value);
  };
  const SpeechRec: any = typeof window !== 'undefined' ? (window as any).SpeechRecognition ?? (window as any).webkitSpeechRecognition : null;
  const toggleMic = () => {
    if (!SpeechRec) return toast({ title: 'Voice input is not supported in this browser', tone: 'danger' });
    if (listening) {
      recog.current?.stop();
      return;
    }
    const r: SR = new SpeechRec();
    r.continuous = true;
    r.interimResults = false;
    r.lang = navigator.language || 'en-US';
    const base = value;
    let acc = '';
    r.onresult = (e: any) => {
      for (let i = e.resultIndex; i < e.results.length; i++) if (e.results[i].isFinal) acc += e.results[i][0].transcript;
      onChange(`${base}${base && acc ? ' ' : ''}${acc.trim()}`);
    };
    r.onend = () => setListening(false);
    r.onerror = () => setListening(false);
    recog.current = r;
    r.start();
    setListening(true);
  };
  const items: MenuItem[] = [
    { label: 'Continue the reply', icon: FastForward, onSelect: onContinue, disabled: busy },
    {
      label: 'Write my next line',
      icon: UserRoundPen,
      disabled: busy,
      onSelect: async () => {
        const t = await onImpersonate();
        if (t) onChange(t);
      },
    },
    ...(onSuggest
      ? [
          {
            label: 'Suggest an action',
            icon: Wand2 as LucideIcon,
            disabled: busy,
            onSelect: async () => {
              const t = await onSuggest();
              if (t) onChange(t);
            },
          },
        ]
      : []),
    ...extraItems,
  ];
  return (
    <div className="mx-auto w-full max-w-[760px] px-3 pb-[calc(var(--safe-bottom)+8px)] pt-2 sm:px-4">
      {accessory}
      <div className="flex items-end gap-1.5 rounded-lg bg-surface-2 p-1.5 transition-shadow focus-within:shadow-[0_0_0_2px_var(--accent-soft)]">
        <Menu align="start" trigger={<IconButton icon={Plus} label="More actions" />} items={items} />
        <textarea
          ref={ref}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey && (enterToSend || e.metaKey || e.ctrlKey)) {
              e.preventDefault();
              submit();
            }
          }}
          rows={1}
          placeholder={placeholder}
          aria-label="Message"
          className="max-h-[180px] min-h-10 flex-1 resize-none bg-transparent px-1 py-2 text-base leading-6 text-fg outline-none placeholder:text-fg-3 focus-visible:shadow-none"
        />
        {stt ? <IconButton icon={listening ? MicOff : Mic} label={listening ? 'Stop dictation' : 'Dictate'} active={listening} onClick={toggleMic} /> : null}
        {busy ? (
          <IconButton icon={Square} label="Stop" onClick={onStop} className="!bg-fg !text-bg" />
        ) : (
          <IconButton icon={value.trim() ? ArrowUp : Theater} label={value.trim() ? 'Send' : 'Let the story continue'} tone="accent" onClick={submit} className={cx(!value.trim() && '!bg-surface-3 !text-fg-2')} />
        )}
      </div>
    </div>
  );
}
