/** Sanitized markdown for story text, with "speech" and *action* styling. */
import DOMPurify from 'dompurify';
import { marked } from 'marked';

marked.setOptions({ gfm: true, breaks: true });

const cache = new Map<string, string>();

function styleSpeech(html: string): string {
  // Wrap "quoted speech" outside of tags in a span (curly or straight quotes).
  return html.replace(/(^|>)([^<]+)(?=<|$)/g, (_m, pre: string, text: string) =>
    pre + text.replace(/(“[^”]{1,1200}”|"[^"<>]{1,1200}")/g, '<span class="speech">$1</span>'),
  );
}

export function renderStory(text: string): string {
  if (!text) return '';
  const hit = cache.get(text);
  if (hit) return hit;
  // Escape raw HTML from the model but keep markdown.
  const escaped = text.replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const html = marked.parse(escaped, { async: false }) as string;
  const clean = DOMPurify.sanitize(styleSpeech(html), { ALLOWED_TAGS: ['p', 'em', 'strong', 'span', 'br', 'blockquote', 'ul', 'ol', 'li', 'code', 'pre', 'hr', 'del', 'h1', 'h2', 'h3', 'h4', 'a'], ALLOWED_ATTR: ['class', 'href'] });
  if (cache.size > 800) cache.clear();
  cache.set(text, clean);
  return clean;
}

export function plainText(text: string): string {
  return text.replace(/[*_`#>]/g, '').replace(/\s+/g, ' ').trim();
}
