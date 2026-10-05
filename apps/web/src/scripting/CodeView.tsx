/** Read-only code with light syntax colouring (JavaScript, HTML and regex rules), for reviews. */
import { useMemo } from 'react';
import { cx } from '@/lib/format';

const KEYWORDS = /\b(async|await|break|case|catch|class|const|continue|default|delete|do|else|export|extends|finally|for|function|if|import|in|instanceof|let|new|of|return|switch|this|throw|try|typeof|var|void|while|yield|true|false|null|undefined)\b/;
const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/** One pass over the text: comments, strings, numbers, keywords, tags. Everything else is escaped as is. */
export function highlight(code: string): string {
  const re = /(\/\/[^\n]*|\/\*[\s\S]*?\*\/|<!--[\s\S]*?-->)|("(?:[^"\\\n]|\\.)*"|'(?:[^'\\\n]|\\.)*'|`(?:[^`\\]|\\.)*`)|(\b\d+(?:\.\d+)?\b)|(<\/?[a-zA-Z][\w-]*)|([A-Za-z_$][\w$]*)/g;
  let out = '';
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(code))) {
    out += esc(code.slice(last, m.index));
    const [t] = m;
    if (m[1]) out += `<span class="tok-c">${esc(t)}</span>`;
    else if (m[2]) out += `<span class="tok-s">${esc(t)}</span>`;
    else if (m[3]) out += `<span class="tok-n">${esc(t)}</span>`;
    else if (m[4]) out += `<span class="tok-t">${esc(t)}</span>`;
    else if (KEYWORDS.test(t)) out += `<span class="tok-k">${t}</span>`;
    else if (/^(fetch|eval|Function|XMLHttpRequest|WebSocket|localStorage|document\.cookie|postMessage|generate|generateRaw|triggerSlash)$/.test(t)) out += `<span class="tok-w">${t}</span>`;
    else out += esc(t);
    last = re.lastIndex;
    if (code.length > 200_000) break;
  }
  return out + esc(code.slice(last));
}

export function CodeView({ code, className, maxHeight = 320 }: { code: string; className?: string; maxHeight?: number }) {
  const html = useMemo(() => highlight(code.slice(0, 200_000)), [code]);
  const lines = useMemo(() => code.split('\n').length, [code]);
  return (
    <div className={cx('ev-code relative overflow-auto rounded-md bg-surface-2 text-[12.5px] leading-5', className)} style={{ maxHeight }}>
      <pre className="m-0 flex min-w-fit p-3 font-mono">
        <span aria-hidden="true" className="mr-3 select-none text-right text-fg-3">
          {Array.from({ length: Math.min(lines, 5000) }, (_, i) => (
            <span key={i} className="block">
              {i + 1}
            </span>
          ))}
        </span>
        <code className="whitespace-pre text-fg" dangerouslySetInnerHTML={{ __html: html }} />
      </pre>
    </div>
  );
}
