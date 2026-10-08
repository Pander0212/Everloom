/**
 * Removes a picture's background before layering (the TypeScript twin of tools/puppets/key.py).
 * First a flat key: the colour of the corners, everything connected to the border within a
 * distance of it (and the greyer, slightly darker floor shadow). When that keeps more than half the
 * picture, the background wasn't flat, so a fill that follows it from neighbour to neighbour (and
 * stops at the figure's outline) is used instead. A picture that already has transparency is kept.
 */

/** RGBA in, RGBA out (same size), straight alpha. */
export function keyBackground(rgba: Uint8Array, W: number, H: number, o: { tol?: number; shadow?: number; step?: number } = {}): Uint8Array {
  let transparent = 0;
  for (let i = 3; i < rgba.length; i += 4 * 7) if (rgba[i]! < 250) transparent++;
  if (transparent > (W * H) / 7 / 20) return rgba;
  let bg = flatMask(rgba, W, H, o.tol ?? 22, o.shadow ?? 30);
  let kept = 0;
  for (let i = 0; i < W * H; i++) if (!bg[i]) kept++;
  if (kept > (W * H) / 2) bg = neighbourMask(rgba, W, H, o.step ?? 3);
  return withAlpha(rgba, W, H, bg);
}

function borderFill(W: number, H: number, ok: (i: number, from: number) => boolean): Uint8Array {
  const bg = new Uint8Array(W * H), stack: number[] = [];
  const seed = (i: number) => { if (!bg[i] && ok(i, i)) { bg[i] = 1; stack.push(i); } };
  for (let x = 0; x < W; x++) { seed(x); seed((H - 1) * W + x); }
  for (let y = 0; y < H; y++) { seed(y * W); seed(y * W + W - 1); }
  while (stack.length) {
    const i = stack.pop()!, x = i % W, y = (i - x) / W;
    for (const j of [x > 0 ? i - 1 : -1, x < W - 1 ? i + 1 : -1, y > 0 ? i - W : -1, y < H - 1 ? i + W : -1]) {
      if (j >= 0 && !bg[j] && ok(j, i)) { bg[j] = 1; stack.push(j); }
    }
  }
  return bg;
}

function flatMask(a: Uint8Array, W: number, H: number, tol: number, shadow: number): Uint8Array {
  const rs: number[] = [], gs: number[] = [], bs: number[] = [];
  for (const [x0, y0] of [[0, 0], [W - 8, 0], [0, H - 8], [W - 8, H - 8]] as const) for (let y = y0; y < y0 + 8; y++) for (let x = x0; x < x0 + 8; x++) { const i = (y * W + x) * 4; rs.push(a[i]!); gs.push(a[i + 1]!); bs.push(a[i + 2]!); }
  const med = (v: number[]) => v.sort((p, q) => p - q)[v.length >> 1]!;
  const br = med(rs), bgc = med(gs), bb = med(bs), bm = (br + bgc + bb) / 3;
  return borderFill(W, H, (i) => {
    const r = a[i * 4]!, g = a[i * 4 + 1]!, b = a[i * 4 + 2]!;
    if (Math.max(Math.abs(r - br), Math.abs(g - bgc), Math.abs(b - bb)) <= tol) return true;
    const m = (r + g + b) / 3;
    return m <= bm && bm - m < shadow && Math.max(r, g, b) - Math.min(r, g, b) < 10;
  });
}

function neighbourMask(a: Uint8Array, W: number, H: number, step: number): Uint8Array {
  return borderFill(W, H, (j, i) => j === i || (Math.abs(a[j * 4]! - a[i * 4]!) <= step && Math.abs(a[j * 4 + 1]! - a[i * 4 + 1]!) <= step && Math.abs(a[j * 4 + 2]! - a[i * 4 + 2]!) <= step));
}

/** Opening (removes specks), then a one-pixel feather. */
function withAlpha(a: Uint8Array, W: number, H: number, bg: Uint8Array): Uint8Array {
  const fg = new Uint8Array(W * H);
  for (let i = 0; i < W * H; i++) fg[i] = bg[i] ? 0 : 1;
  const erode = (m: Uint8Array) => { const o = new Uint8Array(W * H); for (let y = 1; y < H - 1; y++) for (let x = 1; x < W - 1; x++) { const i = y * W + x; o[i] = m[i]! & m[i - 1]! & m[i + 1]! & m[i - W]! & m[i + W]! & m[i - W - 1]! & m[i - W + 1]! & m[i + W - 1]! & m[i + W + 1]!; } return o; };
  const dilate = (m: Uint8Array) => { const o = new Uint8Array(W * H); for (let y = 1; y < H - 1; y++) for (let x = 1; x < W - 1; x++) { const i = y * W + x; o[i] = m[i]! | m[i - 1]! | m[i + 1]! | m[i - W]! | m[i + W]! | m[i - W - 1]! | m[i - W + 1]! | m[i + W - 1]! | m[i + W + 1]!; } return o; };
  const open = dilate(erode(fg));
  const out = new Uint8Array(a.length);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const i = y * W + x;
    let s = 0, n = 0;
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) { const yy = y + dy, xx = x + dx; if (yy < 0 || xx < 0 || yy >= H || xx >= W) continue; s += open[yy * W + xx]! * (dx || dy ? 1 : 4); n += dx || dy ? 1 : 4; }
    out[i * 4] = a[i * 4]!; out[i * 4 + 1] = a[i * 4 + 1]!; out[i * 4 + 2] = a[i * 4 + 2]!; out[i * 4 + 3] = Math.round((s / n) * 255);
  }
  return out;
}
