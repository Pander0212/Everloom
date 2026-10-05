/**
 * A message with interactive HTML: text parts render as usual; each HTML block renders in its own
 * sandboxed, auto-height frame that mounts when scrolled near (long chats stay light on a phone).
 * Scripts inside run only for characters the owner approved (or always, if they chose so).
 */
import type { MessageDTO } from '@everloom/engine';
import { Code2, Play, ShieldQuestion } from 'lucide-react';
import { lazy, Suspense, useEffect, useMemo, useRef, useState } from 'react';
import { renderStory } from '@/lib/render';
import { Button, IconButton } from '@/ui';
import { SandboxedHtml } from '@/features/library/SandboxedHtml';
import { splitInteractive, type Part } from './bus';
import { CodeView } from './CodeView';
import { useScriptView } from './context';
import { ScriptFrame } from './ScriptFrame';

const EntryFrame = lazy(() => import('./EntryFrame'));

function useNear(ref: React.RefObject<HTMLElement | null>) {
  const [near, setNear] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el || typeof IntersectionObserver === 'undefined') {
      setNear(true);
      return;
    }
    const io = new IntersectionObserver((entries) => setNear(entries.some((e) => e.isIntersecting)), { rootMargin: '900px 0px' });
    io.observe(el);
    return () => io.disconnect();
  }, [ref]);
  return near;
}

function Block({ part, m, index }: { part: Extract<Part, { type: 'html' }>; m: MessageDTO; index: number }) {
  const view = useScriptView();
  const ref = useRef<HTMLDivElement>(null);
  const near = useNear(ref);
  const [asCode, setAsCode] = useState(false);
  const [lastH, setLastH] = useState(120);
  const [manual, setManual] = useState(false);
  const s = view?.settings;
  const cid = m.characterId ?? view?.characterId ?? null;
  const info = cid ? view?.active?.messages[cid] : undefined;
  const scriptsOn = !!s?.enabled && !view?.safe;
  const hasScript = /<script\b|\son[a-z]+\s*=/i.test(part.html);
  const jsAllowed = scriptsOn && s?.messageJs !== 'never' && (!!info?.granted || s?.messageJs === 'always');
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setLastH(el.offsetHeight || 120));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  const toolbar = (
    <div className="mb-1 flex items-center justify-end gap-1">
      {hasScript && !jsAllowed && scriptsOn && cid && s?.messageJs !== 'never' ? (
        <Button size="sm" variant="quiet" icon={ShieldQuestion} onClick={() => view?.review({ kind: 'character', id: cid })}>
          Scripts off · Review
        </Button>
      ) : null}
      <IconButton size="sm" icon={Code2} label={asCode ? 'Show as content' : 'Show as code'} active={asCode} onClick={() => setAsCode((v) => !v)} />
    </div>
  );
  return (
    <div ref={ref} className="ev-interactive my-2" data-part={index} style={{ minHeight: near || asCode ? undefined : lastH }}>
      {toolbar}
      {asCode ? (
        <CodeView code={part.html} />
      ) : !near && !manual ? (
        <div className="flex h-24 items-center justify-center rounded-md bg-surface-2">
          <Button size="sm" variant="quiet" icon={Play} onClick={() => setManual(true)}>
            Show
          </Button>
        </div>
      ) : jsAllowed ? (
        <ScriptFrame
          spec={{
            kind: 'message',
            key: info?.key ?? `character:${cid}:@messages`,
            name: `${m.name} (message)`,
            permissions: info?.granted ? info.permissions : [],
            html: part.html,
            compat: !!s?.compat,
            chatId: view?.chatId,
            characterId: cid,
            messageId: m.id,
            messageIndex: index,
            budgetMs: s?.timeBudgetMs,
          }}
          minHeight={24}
          title={`Interactive content from ${m.name}`}
        />
      ) : (
        <SandboxedHtml source={part.html.replace(/<script\b[\s\S]*?<\/script\s*>/gi, '')} title={`Content from ${m.name}`} />
      )}
    </div>
  );
}

/** <tag>…</tag> drawn by an extension's renderer page (its permissions, the tag's text as context.content). */
function RendererBlock({ part, m }: { part: Extract<Part, { type: 'renderer' }>; m: MessageDTO }) {
  const view = useScriptView();
  const ref = useRef<HTMLDivElement>(null);
  const near = useNear(ref);
  const r = view?.renderers.find((x) => x.tag === part.tag);
  return (
    <div ref={ref} className="ev-interactive my-2" style={{ minHeight: near ? undefined : 60 }}>
      {near && r ? (
        <Suspense fallback={null}>
          <EntryFrame
            spec={{ kind: 'renderer', key: r.key, name: `${r.ext} (${part.tag})`, permissions: r.permissions as never, content: part.content, chatId: view?.chatId, characterId: m.characterId ?? view?.characterId ?? null, messageId: m.id, extId: r.ext, entry: { extId: r.ext, file: r.file, updatedAt: r.updatedAt } }}
            minHeight={24}
            title={`${part.tag} from ${r.ext}`}
          />
        </Suspense>
      ) : null}
    </div>
  );
}

export default function InteractiveMessage({ m, text, index, streaming }: { m: MessageDTO; text: string; index: number; streaming?: boolean }) {
  const view = useScriptView();
  const tags = useMemo(() => (view?.settings?.enabled && !view.safe ? view.renderers.map((r) => r.tag) : []), [view]);
  const parts = useMemo(() => splitInteractive(text, view?.settings?.htmlTag, tags), [text, view?.settings?.htmlTag, tags]);
  if (streaming) return <div className="ev-message-text story" dangerouslySetInnerHTML={{ __html: renderStory(text) }} />;
  return (
    <div className="ev-message-text">
      {parts.map((p, i) =>
        p.type === 'text' ? (
          <div key={i} className="story" dangerouslySetInnerHTML={{ __html: renderStory(p.text) }} />
        ) : p.type === 'renderer' ? (
          <RendererBlock key={`${i}:${p.tag}`} part={p} m={m} />
        ) : (
          <Block key={`${i}:${p.html.length}`} part={p} m={m} index={index} />
        ),
      )}
    </div>
  );
}
