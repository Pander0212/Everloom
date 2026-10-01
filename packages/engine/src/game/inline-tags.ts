/** The <everloom>…</everloom> blocks a model may write inline (kept free of imports so the UI can strip them cheaply). */
export const INLINE_TAG_RE = /<everloom>([\s\S]*?)(?:<\/everloom>|$)/gi;

/** Remove <everloom>…</everloom> blocks (also an unterminated one while streaming). */
export function stripInlineTags(text: string): string {
  return text.replace(INLINE_TAG_RE, '').replace(/<everloom[^>]*$/i, '').trimEnd();
}
