/**
 * Procedural, deterministic map scenes for the map screen. Everything is derived from the campaign
 * seed and the location being viewed, so the same place always looks the same.
 * Output is plain SVG path data in a 1000×1000 coordinate space.
 */
import { createRng, seedFrom, type Rng } from '../util/rng.js';
import type { CampaignState, Location, LocationKind, MapLevel, Style } from './state.js';
import { MAP_LEVELS } from './state.js';

export const MAP_SIZE = 1000;

export type TerrainKind = 'land' | 'water' | 'forest' | 'hill' | 'sand' | 'park' | 'block' | 'plaza' | 'room' | 'hall';
export type PinKind = 'you' | 'station' | 'vehicle' | 'danger' | 'service' | 'interior' | 'landmark' | 'place';

export interface MapNode {
  id: string;
  name: string;
  x: number;
  y: number;
  kind: LocationKind;
  pin: PinKind;
  discovered: boolean;
  current: boolean;
  /** The player is somewhere inside this node. */
  containsCurrent: boolean;
  hasChildren: boolean;
}

export interface MapScene {
  parentId: string | null;
  level: MapLevel;
  style: Style;
  base: 'land' | 'water' | 'floor';
  terrain: Array<{ kind: TerrainKind; d: string }>;
  roads: Array<{ d: string; kind: 'road' | 'trail' | 'rail' | 'water' | 'street' | 'corridor'; from?: string; to?: string }>;
  nodes: MapNode[];
  grid: 'none' | 'streets' | 'hex';
}

// ------------------------------------------------------------------ noise

function makeNoise(rng: Rng) {
  const size = 256;
  const perm = rng.shuffle(Array.from({ length: size }, (_, i) => i));
  const vals = Array.from({ length: size }, () => rng.next());
  const at = (x: number, y: number) => vals[perm[(perm[x & 255] + y) & 255]];
  const smooth = (t: number) => t * t * (3 - 2 * t);
  const noise = (x: number, y: number) => {
    const xi = Math.floor(x);
    const yi = Math.floor(y);
    const tx = smooth(x - xi);
    const ty = smooth(y - yi);
    const a = at(xi, yi);
    const b = at(xi + 1, yi);
    const c = at(xi, yi + 1);
    const d = at(xi + 1, yi + 1);
    return a + (b - a) * tx + (c - a) * ty + (a - b - c + d) * tx * ty;
  };
  return (x: number, y: number, octaves = 4) => {
    let amp = 1;
    let freq = 1;
    let sum = 0;
    let norm = 0;
    for (let o = 0; o < octaves; o++) {
      sum += noise(x * freq, y * freq) * amp;
      norm += amp;
      amp *= 0.5;
      freq *= 2;
    }
    return sum / norm;
  };
}

// ------------------------------------------------------------------ marching squares

type Pt = [number, number];

function contours(field: number[][], iso: number, cell: number): Pt[][] {
  const n = field.length;
  const segs: Array<[Pt, Pt]> = [];
  const lerp = (a: number, b: number) => (a === b ? 0.5 : (iso - a) / (b - a));
  for (let i = 0; i < n - 1; i++) {
    for (let j = 0; j < n - 1; j++) {
      const tl = field[i][j];
      const tr = field[i + 1][j];
      const br = field[i + 1][j + 1];
      const bl = field[i][j + 1];
      const idx = (tl >= iso ? 8 : 0) | (tr >= iso ? 4 : 0) | (br >= iso ? 2 : 0) | (bl >= iso ? 1 : 0);
      if (idx === 0 || idx === 15) continue;
      const x = i * cell;
      const y = j * cell;
      const top: Pt = [x + lerp(tl, tr) * cell, y];
      const right: Pt = [x + cell, y + lerp(tr, br) * cell];
      const bottom: Pt = [x + lerp(bl, br) * cell, y + cell];
      const left: Pt = [x, y + lerp(tl, bl) * cell];
      const add = (a: Pt, b: Pt) => segs.push([a, b]);
      switch (idx) {
        case 1: case 14: add(left, bottom); break;
        case 2: case 13: add(bottom, right); break;
        case 3: case 12: add(left, right); break;
        case 4: case 11: add(top, right); break;
        case 5: add(left, top); add(bottom, right); break;
        case 6: case 9: add(top, bottom); break;
        case 7: case 8: add(left, top); break;
        case 10: add(top, right); add(left, bottom); break;
      }
    }
  }
  // Link segments into loops.
  const key = (p: Pt) => `${p[0].toFixed(2)},${p[1].toFixed(2)}`;
  const adj = new Map<string, Array<{ seg: number; other: Pt }>>();
  segs.forEach(([a, b], k) => {
    if (!adj.has(key(a))) adj.set(key(a), []);
    if (!adj.has(key(b))) adj.set(key(b), []);
    adj.get(key(a))!.push({ seg: k, other: b });
    adj.get(key(b))!.push({ seg: k, other: a });
  });
  const used = new Set<number>();
  const loops: Pt[][] = [];
  for (let k = 0; k < segs.length; k++) {
    if (used.has(k)) continue;
    used.add(k);
    const loop: Pt[] = [segs[k][0], segs[k][1]];
    let cur = segs[k][1];
    for (let guard = 0; guard < 20000; guard++) {
      const next = adj.get(key(cur))?.find((e) => !used.has(e.seg));
      if (!next) break;
      used.add(next.seg);
      loop.push(next.other);
      cur = next.other;
    }
    if (loop.length > 3) loops.push(loop);
  }
  return loops;
}

function chaikin(loop: Pt[], iterations = 2): Pt[] {
  let pts = loop;
  for (let it = 0; it < iterations; it++) {
    const out: Pt[] = [];
    for (let i = 0; i < pts.length; i++) {
      const a = pts[i];
      const b = pts[(i + 1) % pts.length];
      out.push([a[0] * 0.75 + b[0] * 0.25, a[1] * 0.75 + b[1] * 0.25], [a[0] * 0.25 + b[0] * 0.75, a[1] * 0.25 + b[1] * 0.75]);
    }
    pts = out;
  }
  return pts;
}

const r1 = (n: number) => Math.round(n * 10) / 10;

function loopsToPath(loops: Pt[][], minArea = 400): string {
  const parts: string[] = [];
  for (const raw of loops) {
    let area = 0;
    for (let i = 0; i < raw.length; i++) {
      const a = raw[i];
      const b = raw[(i + 1) % raw.length];
      area += a[0] * b[1] - b[0] * a[1];
    }
    if (Math.abs(area / 2) < minArea) continue;
    const pts = chaikin(raw);
    parts.push(`M${pts.map((p) => `${r1(p[0])} ${r1(p[1])}`).join('L')}Z`);
  }
  return parts.join('');
}

function field(noise: (x: number, y: number, o?: number) => number, n: number, scale: number, offset: number, bumps: Array<{ x: number; y: number; r: number; h: number }>, edgeFalloff: number): number[][] {
  const cell = MAP_SIZE / (n - 1);
  const f: number[][] = [];
  for (let i = 0; i < n; i++) {
    f.push([]);
    for (let j = 0; j < n; j++) {
      const x = i * cell;
      const y = j * cell;
      let v = noise(x / scale + offset, y / scale + offset);
      for (const b of bumps) {
        const d2 = ((x - b.x) ** 2 + (y - b.y) ** 2) / (b.r * b.r);
        v += b.h * Math.exp(-d2);
      }
      if (edgeFalloff) {
        const edge = Math.min(x, y, MAP_SIZE - x, MAP_SIZE - y) / MAP_SIZE;
        v -= edgeFalloff * Math.max(0, 0.18 - edge) * 3;
      }
      // Pad borders so contours close.
      if (i === 0 || j === 0 || i === n - 1 || j === n - 1) v = -1;
      f[i].push(v);
    }
  }
  return f;
}

// ------------------------------------------------------------------ nodes & roads

export function pinFor(kind: LocationKind, current: boolean): PinKind {
  if (current) return 'you';
  if (kind === 'station' || kind === 'dock') return 'station';
  if (kind === 'vehicle') return 'vehicle';
  if (kind === 'danger') return 'danger';
  if (kind === 'shop' || kind === 'service') return 'service';
  if (kind === 'room' || kind === 'interior' || kind === 'building' || kind === 'home') return 'interior';
  if (kind === 'landmark') return 'landmark';
  return 'place';
}

function mst(points: Array<{ id: string; x: number; y: number }>): Array<[number, number]> {
  if (points.length < 2) return [];
  const inTree = new Set([0]);
  const edges: Array<[number, number]> = [];
  while (inTree.size < points.length) {
    let best: [number, number, number] | null = null;
    for (const i of inTree) {
      for (let j = 0; j < points.length; j++) {
        if (inTree.has(j)) continue;
        const d = Math.hypot(points[i].x - points[j].x, points[i].y - points[j].y);
        if (!best || d < best[2]) best = [i, j, d];
      }
    }
    if (!best) break;
    inTree.add(best[1]);
    edges.push([best[0], best[1]]);
  }
  return edges;
}

function curve(a: { x: number; y: number }, b: { x: number; y: number }, rng: Rng, bend = 0.18): string {
  const mx = (a.x + b.x) / 2;
  const my = (a.y + b.y) / 2;
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const k = (rng.next() * 2 - 1) * bend;
  return `M${r1(a.x)} ${r1(a.y)}Q${r1(mx - dy * k)} ${r1(my + dx * k)} ${r1(b.x)} ${r1(b.y)}`;
}

export function childLevelOf(level: MapLevel | null): MapLevel {
  if (!level) return 'world';
  const i = MAP_LEVELS.indexOf(level);
  return MAP_LEVELS[Math.min(MAP_LEVELS.length - 1, i + 1)];
}

/** Ancestor chain from the root down to (and including) the given location. */
export function locationPath(state: Pick<CampaignState, 'locations'>, id: string | null): Location[] {
  const out: Location[] = [];
  const seen = new Set<string>();
  let cur = id ? state.locations[id] : undefined;
  while (cur && !seen.has(cur.id)) {
    out.unshift(cur);
    seen.add(cur.id);
    cur = cur.parentId ? state.locations[cur.parentId] : undefined;
  }
  return out;
}

export function generateMapScene(state: CampaignState, parentId: string | null, styleOverride?: Style): MapScene {
  const style = styleOverride ?? state.meta.style;
  const parent = parentId ? state.locations[parentId] : null;
  const level: MapLevel = parent ? childLevelOf(parent.level) : 'world';
  const rng = createRng(seedFrom(state.meta.seed, 'map', parentId ?? 'root', style));
  const noise = makeNoise(rng);
  const pathToCurrent = new Set(locationPath(state, state.currentLocationId).map((l) => l.id));
  const children = Object.values(state.locations).filter((l) => (l.parentId ?? null) === parentId);
  const nodes: MapNode[] = children.map((l) => ({
    id: l.id,
    name: l.name,
    x: l.x,
    y: l.y,
    kind: l.kind,
    pin: pinFor(l.kind, l.id === state.currentLocationId),
    discovered: l.discovered,
    current: l.id === state.currentLocationId,
    containsCurrent: pathToCurrent.has(l.id) && l.id !== state.currentLocationId,
    hasChildren: Object.values(state.locations).some((c) => c.parentId === l.id),
  }));
  const terrain: MapScene['terrain'] = [];
  const roads: MapScene['roads'] = [];
  const indoor = level === 'area' || (parent && ['building', 'room', 'interior', 'home', 'vehicle'].includes(parent.kind));
  const urban = !indoor && (level === 'local' || level === 'nearby') && (style !== 'fantasy' || (parent && ['city', 'town', 'district'].includes(parent.kind)));

  if (indoor) {
    // Floor plan: BSP-split rooms, corridors between node rooms.
    const rooms: Array<{ x: number; y: number; w: number; h: number }> = [];
    const split = (x: number, y: number, w: number, h: number, depth: number) => {
      if (depth <= 0 || (w < 260 && h < 260)) {
        rooms.push({ x: x + 12, y: y + 12, w: w - 24, h: h - 24 });
        return;
      }
      const vertical = w > h ? true : h > w ? false : rng.chance(0.5);
      const t = 0.35 + rng.next() * 0.3;
      if (vertical) {
        split(x, y, w * t, h, depth - 1);
        split(x + w * t, y, w * (1 - t), h, depth - 1);
      } else {
        split(x, y, w, h * t, depth - 1);
        split(x, y + h * t, w, h * (1 - t), depth - 1);
      }
    };
    split(60, 60, 880, 880, 3 + Math.min(2, Math.floor(children.length / 3)));
    terrain.push({ kind: 'hall', d: `M60 60H940V940H60Z` });
    terrain.push({ kind: 'room', d: rooms.map((r) => `M${r1(r.x)} ${r1(r.y)}h${r1(r.w)}v${r1(r.h)}h${r1(-r.w)}Z`).join('') });
    const pts = nodes.map((n) => ({ id: n.id, x: n.x, y: n.y }));
    for (const [a, b] of mst(pts)) roads.push({ d: `M${r1(pts[a].x)} ${r1(pts[a].y)}H${r1(pts[b].x)}V${r1(pts[b].y)}`, kind: 'corridor', from: pts[a].id, to: pts[b].id });
    return { parentId, level, style, base: 'floor', terrain, roads, nodes, grid: 'none' };
  }

  const bumps = nodes.map((n) => ({ x: n.x, y: n.y, r: 120, h: 0.35 }));
  if (urban) {
    // Blocks on a jittered street grid, parks where the noise is high, maybe a river.
    const step = level === 'nearby' ? 130 : 100;
    const blocks: string[] = [];
    const parks: string[] = [];
    for (let x = 30; x < MAP_SIZE - 60; x += step) {
      for (let y = 30; y < MAP_SIZE - 60; y += step) {
        const w = step - 22 - rng.next() * 8;
        const h = step - 22 - rng.next() * 8;
        const v = noise((x + 11) / 260, (y + 7) / 260, 3);
        const rect = `M${r1(x)} ${r1(y)}h${r1(w)}v${r1(h)}h${r1(-w)}Z`;
        if (v > 0.66) parks.push(rect);
        else if (v > 0.2) blocks.push(rect);
      }
    }
    terrain.push({ kind: 'block', d: blocks.join('') });
    if (parks.length) terrain.push({ kind: 'park', d: parks.join('') });
    const river = rng.chance(0.55);
    if (river) {
      const y0 = 150 + rng.next() * 700;
      const y1 = 150 + rng.next() * 700;
      const w = 34;
      terrain.push({ kind: 'water', d: `M-20 ${r1(y0 - w)}C300 ${r1(y0 - w + 120)} 700 ${r1(y1 - w - 120)} 1020 ${r1(y1 - w)}L1020 ${r1(y1 + w)}C700 ${r1(y1 + w - 120)} 300 ${r1(y0 + w + 120)} -20 ${r1(y0 + w)}Z` });
    }
    const pts = nodes.map((n) => ({ id: n.id, x: n.x, y: n.y }));
    for (const [a, b] of mst(pts)) roads.push({ d: `M${r1(pts[a].x)} ${r1(pts[a].y)}L${r1(pts[b].x)} ${r1(pts[b].y)}`, kind: 'road', from: pts[a].id, to: pts[b].id });
    addRoutes(state, nodes, roads, rng);
    return { parentId, level, style, base: 'land', terrain, roads, nodes, grid: style === 'scifi' ? 'hex' : 'streets' };
  }

  // Natural terrain: land/water coastlines, forests and hills.
  const n = 64;
  const cell = MAP_SIZE / (n - 1);
  const scale = level === 'world' ? 360 : level === 'region' ? 280 : 220;
  const water = level === 'world' || level === 'region' || rng.chance(0.4);
  const height = field(noise, n, scale, 3.1, bumps, water ? 1 : 0);
  const landIso = water ? 0.5 : -0.5;
  terrain.push({ kind: 'land', d: loopsToPath(contours(height, landIso, cell), 900) });
  const beach = water ? loopsToPath(contours(height, landIso + 0.035, cell), 900) : '';
  if (beach) terrain.push({ kind: 'sand', d: beach });
  const forestField = field(noise, n, scale * 0.6, 17.3, [], 0).map((col, i) => col.map((v, j) => (height[i][j] > landIso + 0.05 ? v : -1)));
  terrain.push({ kind: 'forest', d: loopsToPath(contours(forestField, 0.56, cell), 600) });
  const hillField = field(noise, n, scale * 0.5, 41.7, [], 0).map((col, i) => col.map((v, j) => (height[i][j] > landIso + 0.12 ? v : -1)));
  terrain.push({ kind: 'hill', d: loopsToPath(contours(hillField, 0.64, cell), 500) });
  if (!water) {
    const lake = field(noise, n, scale * 0.8, 71.2, bumps.map((b) => ({ ...b, h: -0.6 })), 0);
    terrain.push({ kind: 'water', d: loopsToPath(contours(lake, 0.7, cell), 800) });
  }
  const pts = nodes.map((nd) => ({ id: nd.id, x: nd.x, y: nd.y }));
  for (const [a, b] of mst(pts)) roads.push({ d: curve(pts[a], pts[b], rng), kind: level === 'world' ? 'trail' : 'road', from: pts[a].id, to: pts[b].id });
  addRoutes(state, nodes, roads, rng);
  return { parentId, level, style, base: water ? 'water' : 'land', terrain, roads, nodes, grid: style === 'scifi' ? 'hex' : 'none' };
}

function addRoutes(state: CampaignState, nodes: MapNode[], roads: MapScene['roads'], rng: Rng) {
  const byId = new Map(nodes.map((n) => [n.id, n]));
  for (const r of Object.values(state.routes)) {
    const a = byId.get(r.from);
    const b = byId.get(r.to);
    if (!a || !b) continue;
    if (roads.some((x) => (x.from === a.id && x.to === b.id) || (x.from === b.id && x.to === a.id))) continue;
    roads.push({ d: curve(a, b, rng, r.mode === 'rail' ? 0.05 : 0.22), kind: r.mode === 'rail' ? 'rail' : r.mode === 'water' ? 'water' : r.mode === 'trail' ? 'trail' : 'road', from: a.id, to: b.id });
  }
}

/** Find a free spot for a new node near the centre, away from existing nodes (deterministic). */
export function freeSpot(state: CampaignState, parentId: string | null, name: string, taken: Array<{ x: number; y: number }> = []): { x: number; y: number } {
  const rng = createRng(seedFrom(state.meta.seed, 'spot', parentId ?? 'root', name));
  const siblings: Array<{ x: number; y: number }> = [...Object.values(state.locations).filter((l) => (l.parentId ?? null) === parentId), ...taken];
  let best = { x: 500, y: 500, d: -1 };
  for (let i = 0; i < 40; i++) {
    const x = 120 + rng.next() * 760;
    const y = 120 + rng.next() * 760;
    const d = siblings.length ? Math.min(...siblings.map((s) => Math.hypot(s.x - x, s.y - y))) : 500 - Math.hypot(500 - x, 500 - y);
    if (d > best.d) best = { x, y, d };
  }
  return { x: Math.round(best.x), y: Math.round(best.y) };
}
