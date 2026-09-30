/** Finding remote images inside card text, and pointing them at local copies. */

const IMG_EXT = /\.(?:png|jpe?g|gif|webp|avif|bmp|svg)(?:[?#][^\s"'<>)]*)?$/i;

/** http(s) image links in markdown images, <img src>, CSS url(), and bare links that end in an image extension. */
export function findRemoteMedia(text: string): string[] {
  if (!text || !/https?:\/\//i.test(text)) return [];
  const found = new Set<string>();
  const add = (u: string | undefined) => {
    if (!u) return;
    const url = u.trim().replace(/&amp;/g, '&');
    if (/^https?:\/\/[^\s/]+\.[^\s]*$/i.test(url)) found.add(url);
  };
  for (const m of text.matchAll(/!\[[^\]]*\]\(\s*<?(https?:\/\/[^\s)>]+)>?(?:\s+"[^"]*")?\s*\)/gi)) add(m[1]);
  for (const m of text.matchAll(/<(?:img|source|video|audio)\b[^>]*?\ssrc\s*=\s*(["'])(https?:\/\/[^"']+)\1/gi)) add(m[2]);
  for (const m of text.matchAll(/<(?:img|source)\b[^>]*?\ssrc\s*=\s*(https?:\/\/[^\s>"']+)/gi)) add(m[1]);
  for (const m of text.matchAll(/url\(\s*(["']?)(https?:\/\/[^"')\s]+)\1\s*\)/gi)) add(m[2]);
  for (const m of text.matchAll(/(?<![("'=])\bhttps?:\/\/[^\s"'<>()\]]+/gi)) {
    const bare = m[0].replace(/[.,;:!?]+$/, ''); // "look at https://x/pic.png, then…"
    if (IMG_EXT.test(bare)) add(bare);
  }
  return [...found];
}

/** Replaces each mapped URL everywhere it appears (also its &amp;-escaped form in HTML). */
export function replaceMediaUrls(text: string, map: Record<string, string>): string {
  let out = text;
  for (const [from, to] of Object.entries(map).sort((a, b) => b[0].length - a[0].length)) {
    out = out.split(from).join(to);
    const escaped = from.replace(/&/g, '&amp;');
    if (escaped !== from) out = out.split(escaped).join(to);
  }
  return out;
}
