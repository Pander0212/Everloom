/** No imports and no remote resources (privacy); data: URLs are fine. */
export function sanitizeCss(css: string): string {
  return css
    .replace(/@import[^;]*;?/gi, '')
    .replace(/url\(\s*(['"]?)(?!data:)[^)]*\1\s*\)/gi, 'none')
    .replace(/(?:-webkit-)?image-set\((?:[^()]|\([^()]*\))*\)/gi, (m) => (/(['"])(?!data:)[^'"]+\1/.test(m.replace(/url\([^)]*\)/gi, '')) ? 'none' : m))
    .replace(/expression\s*\(/gi, '(')
    .replace(/(?:-moz-binding|behavior)\s*:[^;}]*/gi, '')
    .slice(0, 20000);
}
