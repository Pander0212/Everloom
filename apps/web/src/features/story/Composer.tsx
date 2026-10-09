import { ArrowUp, Check, Compass, Footprints, LayoutGrid, MessageCircle, MessageSquareQuote, Mic, MicOff, PenLine, Square, Theater } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { cx } from '@/lib/format';
import { toast, toastError } from '@/lib/store';
import { apiFetch } from '@/lib/api';
import { IconButton, Icon } from '@/ui';
import * as P from '@radix-ui/react-popover';
import { INPUT_MODES, type InputMode } from '@everloom/engine';

export interface ComposerProps {
  busy: boolean;
  enterToSend: boolean;
  /** Arrow keys on an empty box swipe the last reply. */
  onSwipeKey?: (dir: -1 | 1) => void;
  stt: boolean;
  /** Dictation by the browser, or recorded and transcribed by the voice connection. */
  sttEngine?: 'browser' | 'connection';
  placeholder: string;
  onSend: (text: string) => void;
  onStop: () => void;
  onMenu: () => void;
  /** Chips above the input (target selector, emotes…). */
  accessory?: React.ReactNode;
  value: string;
  onChange: (v: string) => void;
  /** Input mode (Act, Say, Story, Direct), or null for plain chat; omitted: no mode switch. */
  mode?: InputMode | null;
  onMode?: (m: InputMode | null) => void;
}

type SR = { start: () => void; stop: () => void; onresult: (e: any) => void; onend: () => void; onerror: (e: any) => void; continuous: boolean; interimResults: boolean; lang: string };

export function Composer({ busy, enterToSend, onSwipeKey, stt, sttEngine = 'browser', placeholder, onSend, onStop, onMenu, accessory, value, onChange, mode, onMode }: ComposerProps) {
  const modeInfo = INPUT_MODES.find((m) => m.id === mode);
  const ref = useRef<HTMLTextAreaElement>(null);
  const [listening, setListening] = useState(false);
  const recog = useRef<SR | null>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const fit = () => {
      // Empty: one line (measuring a placeholder before layout settles can give two).
      if (!el.value) return void (el.style.height = '');
      el.style.height = 'auto';
      el.style.height = `${Math.min(el.scrollHeight, 180)}px`;
    };
    fit();
    const ro = new ResizeObserver(() => el.value && fit());
    ro.observe(el);
    return () => ro.disconnect();
  }, [value]);
  const submit = () => {
    if (busy) return;
    onSend(value);
  };
  const SpeechRec: any = typeof window !== 'undefined' ? (window as any).SpeechRecognition ?? (window as any).webkitSpeechRecognition : null;
  const recorder = useRef<MediaRecorder | null>(null);
  const [transcribing, setTranscribing] = useState(false);
  const toggleRecord = async () => {
    if (recorder.current) return recorder.current.stop();
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const r = new MediaRecorder(stream);
      const chunks: Blob[] = [];
      r.ondataavailable = (e) => e.data.size && chunks.push(e.data);
      r.onstop = async () => {
        stream.getTracks().forEach((t) => t.stop());
        recorder.current = null;
        setListening(false);
        const blob = new Blob(chunks, { type: r.mimeType || 'audio/webm' });
        setTranscribing(true);
        try {
          const res = await apiFetch(`/api/stt?lang=${encodeURIComponent(navigator.language || 'en')}`, { raw: blob, contentType: blob.type });
          const { text } = (await res.json()) as { text: string };
          if (text) onChange(`${value}${value && !value.endsWith(' ') ? ' ' : ''}${text}`);
        } catch (e) {
          toastError(e);
        } finally {
          setTranscribing(false);
        }
      };
      recorder.current = r;
      r.start();
      setListening(true);
    } catch {
      toast({ title: 'The microphone could not be opened', tone: 'danger' });
    }
  };
  const toggleMic = () => {
    if (sttEngine === 'connection') return void toggleRecord();
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
  return (
    <div className="ev-composer mx-auto w-full max-w-[var(--story-width)] px-3 pb-[calc(var(--safe-bottom)+8px)] pt-2 sm:px-4">
      {accessory}
      <div className="flex items-end gap-1.5 rounded-lg bg-surface-2 p-1.5 transition-shadow focus-within:shadow-[0_0_0_2px_var(--accent-soft)]">
        <IconButton icon={LayoutGrid} label="Tools" title="Tools (Ctrl K)" onClick={onMenu} />
        {onMode ? <ModeSwitch mode={mode ?? null} onMode={onMode} /> : null}
        <textarea
          ref={ref}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey && (enterToSend || e.metaKey || e.ctrlKey)) {
              e.preventDefault();
              submit();
            } else if ((e.key === 'ArrowLeft' || e.key === 'ArrowRight') && !value && onSwipeKey && !e.altKey && !e.metaKey && !e.ctrlKey) {
              e.preventDefault();
              onSwipeKey(e.key === 'ArrowLeft' ? -1 : 1);
            }
          }}
          rows={1}
          placeholder={modeInfo?.placeholder ?? placeholder}
          aria-label="Message"
          className="max-h-[180px] min-h-10 flex-1 resize-none bg-transparent px-1 py-2 text-base leading-6 text-fg outline-none placeholder:text-fg-3 focus-visible:shadow-none"
        />
        {stt ? <IconButton icon={listening ? MicOff : Mic} label={listening ? 'Stop dictation' : transcribing ? 'Writing down what you said…' : 'Dictate'} active={listening} disabled={transcribing} onClick={toggleMic} /> : null}
        {busy ? (
          <IconButton icon={Square} label="Stop" onClick={onStop} className="!bg-fg !text-bg" />
        ) : (
          <IconButton icon={value.trim() ? ArrowUp : Theater} label={value.trim() ? 'Send' : 'Continue the story'} tone="accent" onClick={submit} className={cx(!value.trim() && '!bg-surface-3 !text-fg-2')} />
        )}
      </div>
    </div>
  );
}

const MODE_ICON = { act: Footprints, say: MessageSquareQuote, story: PenLine, direct: Compass } as const;

/** The input mode: a small switch beside the box (plain chat, Act, Say, Story, Direct). */
function ModeSwitch({ mode, onMode }: { mode: InputMode | null; onMode: (m: InputMode | null) => void }) {
  const label = INPUT_MODES.find((m) => m.id === mode)?.label ?? 'Chat';
  const options: Array<{ id: InputMode | null; label: string; hint: string; icon: typeof Compass }> = [
    { id: null, label: 'Chat', hint: 'Plain message, as it is', icon: MessageCircle },
    ...INPUT_MODES.map((m) => ({ id: m.id, label: m.label, hint: m.hint, icon: MODE_ICON[m.id] })),
  ];
  return (
    <P.Root>
      <P.Trigger asChild>
        <button type="button" aria-label={`Input mode: ${label}`} className={cx('pressable flex h-10 flex-none items-center gap-1 rounded-md px-2 text-xs font-semibold', mode ? 'bg-accent-soft text-accent-text' : 'text-fg-2 hover:bg-surface-3')}>
          <Icon icon={mode ? MODE_ICON[mode] : MessageCircle} size={16} />
          <span className="max-sm:hidden">{label}</span>
        </button>
      </P.Trigger>
      <P.Portal>
        <P.Content side="top" align="start" sideOffset={8} className="z-[70] w-60 rounded-md bg-surface p-1 shadow-3 dark:bg-surface-2" role="radiogroup" aria-label="Input mode">
          {options.map((o) => (
            <P.Close asChild key={o.label}>
              <button role="radio" aria-checked={mode === o.id} onClick={() => onMode(o.id)} className="flex min-h-11 w-full items-center gap-3 rounded-sm px-3 text-left hover:bg-surface-2">
                <Icon icon={o.icon} size={18} className="text-fg-2" />
                <span className="min-w-0 flex-1">
                  <span className="block text-sm font-medium">{o.label}</span>
                  <span className="block text-xs text-fg-2">{o.hint}</span>
                </span>
                {mode === o.id ? <Icon icon={Check} size={16} className="text-accent-text" /> : null}
              </button>
            </P.Close>
          ))}
        </P.Content>
      </P.Portal>
    </P.Root>
  );
}
