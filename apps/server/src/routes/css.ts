/** The AI CSS assistant: writes and revises custom CSS snippets from a description. */
import { extractJson } from '@everloom/engine';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { HttpError, owner, type AppContext } from '../context.js';
import { completeChat } from '../llm/providers.js';
import { logged, promptTokens } from '../services/calls.js';
import { connectionForRole } from '../services/connections.js';
import { sanitizeCss } from '../util/css.js';
import { parse } from '../util/validate.js';

/** What the assistant may target: the design tokens and the stable class hooks in the app. */
export const CSS_GUIDE = `Everloom's design tokens (CSS custom properties on :root; dark mode redefines them):
--bg, --surface, --surface-2, --surface-3 (backgrounds, lightest to strongest)
--text, --text-2, --text-3 (text, strongest to faintest)
--accent, --accent-hover, --accent-soft, --accent-text, --accent-fg (the accent color and its variants)
--border, --border-strong, --danger, --danger-soft, --success, --success-soft, --warning, --warning-soft
--radius-sm, --radius-md, --radius-lg, --shadow-1, --shadow-2, --shadow-3, --font-sans, --font-serif, --story-size
Stable class hooks (use these, never generated utility classes):
.ev-message (every chat message) with .ev-message-user / .ev-message-assistant / .ev-message-system
.ev-message-text (the message body), .ev-composer (the message box), .ev-hud (the status bar in a chat)
.ev-sidebar (desktop navigation), .ev-tabbar (phone navigation), .ev-page-header, .ev-card (a character card in the library)
Rules: prefer changing tokens over restyling components; keep text readable in both light and dark (use the tokens, or
:root[data-theme="dark"] / @media (prefers-color-scheme: dark) for dark-only changes); no @import, no remote url() (data: is fine).`;

const SYSTEM = `You write small custom CSS snippets for the Everloom app, and revise them when asked.
${CSS_GUIDE}
Reply with JSON only: {"name": "3-5 word name", "css": "the complete snippet", "notes": "one sentence on what it does"}`;

export function registerCss(app: FastifyInstance, ctx: AppContext) {
  app.post('/api/css/assist', async (req) => {
    const o = owner(req);
    const b = parse(z.object({ request: z.string().trim().min(3).max(2000), current: z.string().max(20000).default(''), history: z.array(z.object({ role: z.enum(['user', 'assistant']), content: z.string().max(20000) })).max(20).default([]) }), req.body);
    const conn = connectionForRole(ctx, o, 'utility');
    if (!conn) throw new HttpError(400, 'Add a connection first');
    const messages = [
      { role: 'system' as const, content: SYSTEM },
      ...b.history,
      { role: 'user' as const, content: `${b.current.trim() ? `Current snippet:\n${b.current}\n\n` : ''}${b.request}` },
    ];
    const r = await logged(ctx, o, conn, { purpose: 'css assistant', role: 'utility' }, promptTokens(messages), () =>
      completeChat(conn, { messages, overrides: { temperature: 0.4, max_tokens: 1200, reasoning: false, stop: [] }, signal: AbortSignal.timeout(90_000) }),
    );
    const out = extractJson<{ name?: string; css?: string; notes?: string }>(r.text);
    let css = out.ok && typeof out.value?.css === 'string' ? out.value.css : (/```(?:css)?\n([\s\S]*?)```/.exec(r.text)?.[1] ?? '');
    css = sanitizeCss(css);
    if (!css.trim()) throw new HttpError(502, 'The model did not return any CSS');
    return { name: out.ok ? String(out.value?.name ?? '').slice(0, 60) : '', css, notes: out.ok ? String(out.value?.notes ?? '').slice(0, 300) : '' };
  });
}
