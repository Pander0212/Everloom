/**
 * Creator notes are often HTML/CSS. They are shown in a sandboxed iframe: no scripts (no
 * allow-scripts), no same-origin access, a strict Content-Security-Policy, no forms or popups,
 * and links open outside. Markdown is rendered first; the result is also sanitized.
 */
import DOMPurify from 'dompurify';
import { marked } from 'marked';
import { useEffect, useMemo, useRef, useState } from 'react';

export const NOTES_CSP = "default-src 'none'; img-src https: http: data: blob:; media-src https: http: data: blob:; style-src 'unsafe-inline' https://fonts.googleapis.com; font-src https://fonts.gstatic.com data:; script-src 'none'; form-action 'none'; frame-src 'none'; base-uri 'none'";

export function notesDocument(source: string, theme: { fg: string; muted: string; link: string; bg: string }): string {
  const looksHtml = /<\w+[^>]*>/.test(source);
  const html = looksHtml ? source : (marked.parse(source, { async: false, breaks: true }) as string);
  const clean = DOMPurify.sanitize(html, { WHOLE_DOCUMENT: false, ADD_TAGS: ['style'], FORBID_TAGS: ['script', 'iframe', 'object', 'embed', 'form', 'input', 'button', 'meta', 'base', 'link'], FORBID_ATTR: ['srcdoc', 'formaction'] });
  return `<!doctype html><html><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="${NOTES_CSP}"><meta name="viewport" content="width=device-width, initial-scale=1"><base target="_blank"><style>
html,body{margin:0;padding:0;background:${theme.bg};color:${theme.fg};font:15px/1.6 -apple-system,BlinkMacSystemFont,"Inter Variable",system-ui,sans-serif;overflow-wrap:anywhere}
body{padding:2px}
a{color:${theme.link}}
img,video{max-width:100%;height:auto;border-radius:8px}
p{margin:0 0 .8em}
h1,h2,h3{line-height:1.25;margin:.8em 0 .4em}
blockquote{margin:0 0 .8em;padding-left:12px;border-left:3px solid ${theme.muted};color:${theme.muted}}
table{border-collapse:collapse;max-width:100%}
td,th{border:1px solid ${theme.muted};padding:4px 8px}
</style></head><body>${clean}</body></html>`;
}

/** Height follows the content (measured from the outside, since the frame can't run scripts). */
export function SandboxedHtml({ source, title = 'Creator notes' }: { source: string; title?: string }) {
  const ref = useRef<HTMLIFrameElement>(null);
  const [height, setHeight] = useState(120);
  const [theme, setTheme] = useState(() => readTheme());
  useEffect(() => {
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    const on = () => setTheme(readTheme());
    mq.addEventListener('change', on);
    const obs = new MutationObserver(on);
    obs.observe(document.documentElement, { attributes: true, attributeFilter: ['class', 'data-theme'] });
    return () => {
      mq.removeEventListener('change', on);
      obs.disconnect();
    };
  }, []);
  const doc = useMemo(() => notesDocument(source, theme), [source, theme]);
  // The frame never runs scripts (no allow-scripts, and the CSP forbids them), so letting the
  // parent read its size (allow-same-origin) gives the frame's content no extra power.
  const measure = () => {
    const d = ref.current?.contentDocument;
    if (!d) return;
    const fit = () => setHeight(Math.min(4000, d.documentElement.scrollHeight + 4));
    fit();
    new ResizeObserver(fit).observe(d.body);
  };
  return <iframe ref={ref} title={title} sandbox="allow-same-origin allow-popups allow-popups-to-escape-sandbox" srcDoc={doc} onLoad={measure} referrerPolicy="no-referrer" className="w-full rounded-md border-0" style={{ height }} />;
}

function readTheme() {
  const cs = getComputedStyle(document.documentElement);
  const v = (n: string, f: string) => cs.getPropertyValue(n).trim() || f;
  return { fg: v('--text', '#222'), muted: v('--text-3', '#888'), link: v('--accent-text', '#b86b00'), bg: v('--surface', '#fff') };
}
