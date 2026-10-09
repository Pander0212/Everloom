/**
 * The scenes, one per theme (looks.ts › scenery). Each draws in the areas the runner gives it (the
 * margins beside the story, or a thin band on a phone), with few shapes per frame and glows drawn
 * once into small canvases, so a frame costs well under a millisecond. Everloom's own art.
 */
import { biggest, rng, type Env, type Rect, type Scene, type SceneFactory } from './runtime';

const TAU = Math.PI * 2;

function sprite(size: number, paint: (c: CanvasRenderingContext2D, s: number) => void) {
  const cv = document.createElement('canvas');
  cv.width = cv.height = size;
  paint(cv.getContext('2d')!, size);
  return cv;
}

function glow(size: number, color: string) {
  return sprite(size, (c, s) => {
    const g = c.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2);
    g.addColorStop(0, color);
    g.addColorStop(1, 'rgba(0,0,0,0)');
    c.fillStyle = g;
    c.fillRect(0, 0, s, s);
  });
}

/** Points scattered over the areas, in proportion to their size. */
function scatter(areas: Rect[], n: number, seed: number) {
  const r = rng(seed);
  const total = areas.reduce((a, b) => a + b.w * b.h, 0) || 1;
  const out: Array<{ x: number; y: number; a: Rect; r: number; s: number }> = [];
  for (const a of areas) {
    const k = Math.round((n * a.w * a.h) / total);
    for (let i = 0; i < k; i++) out.push({ x: a.x + r() * a.w, y: a.y + r() * a.h, a, r: r(), s: r() });
  }
  return out;
}

// ------------------------------------------------------------------ Lantern Library: lamplight and dust
const lantern: SceneFactory = () => {
  let motes: ReturnType<typeof scatter> = [];
  let light: HTMLCanvasElement | null = null;
  const dot = glow(16, 'rgba(255,214,150,0.9)');
  return {
    fps: 24,
    resize(_w, _h, env) {
      motes = scatter(env.areas, env.band ? 14 : 46, 3);
      light = glow(256, 'rgba(255,196,110,0.32)');
    },
    draw(c, t, _w, _h, env) {
      for (const a of env.areas) {
        // A lamp's pool of light near the top of each margin.
        const s = Math.min(a.w * 1.6, env.band ? a.h * 6 : 420);
        if (light) c.drawImage(light, a.x + a.w / 2 - s / 2, a.y + (env.band ? -s / 2 : 40 - s / 3), s, s);
      }
      for (const m of motes) {
        const a = m.a;
        const y = a.y + ((m.y - a.y - t * (4 + m.s * 8)) % a.h + a.h) % a.h;
        const x = m.x + Math.sin(t * 0.5 + m.r * 9) * 6;
        c.globalAlpha = 0.25 + 0.55 * (0.5 + 0.5 * Math.sin(t * (0.6 + m.s) + m.r * 20));
        const sz = 3 + m.s * 5;
        c.drawImage(dot, x - sz / 2, y - sz / 2, sz, sz);
      }
      c.globalAlpha = 1;
    },
  };
};

// ------------------------------------------------------------------ Night Voyage: stars, a turning moon, a shooting star
const night: SceneFactory = () => {
  let stars: ReturnType<typeof scatter> = [];
  let moonTex: HTMLCanvasElement | null = null;
  const starDot = glow(12, 'rgba(235,240,255,1)');
  const halo = glow(200, 'rgba(210,220,255,0.18)');
  return {
    fps: 30,
    resize(_w, _h, env) {
      stars = scatter(env.areas, env.band ? 30 : 140, 11);
      // The moon's face: a strip of craters twice as wide as the disc, scrolled to turn it.
      moonTex = sprite(256, (c, s) => {
        c.fillStyle = '#e9e4d2';
        c.fillRect(0, 0, s, s);
        const r = rng(5);
        for (let i = 0; i < 26; i++) {
          const x = r() * s, y = r() * s, rad = 4 + r() * 18;
          c.fillStyle = `rgba(150,145,130,${0.18 + r() * 0.25})`;
          for (const dx of [-s, 0, s]) {
            c.beginPath();
            c.arc(x + dx, y, rad, 0, TAU);
            c.fill();
          }
        }
      });
    },
    draw(c, t, _w, _h, env) {
      for (const s of stars) {
        const tw = 0.35 + 0.65 * (0.5 + 0.5 * Math.sin(t * (0.4 + s.s * 1.2) + s.r * 30));
        c.globalAlpha = tw * (0.4 + s.s * 0.6);
        const sz = 1.5 + s.s * 3;
        c.drawImage(starDot, s.x - sz, s.y - sz, sz * 2, sz * 2);
      }
      c.globalAlpha = 1;
      const a = biggest(env.areas);
      if (a && moonTex) {
        const r = env.band ? a.h * 0.32 : Math.min(a.w * 0.28, 58);
        const cx = env.band ? a.x + a.w - r * 2.5 : a.x + a.w / 2;
        const cy = env.band ? a.y + a.h / 2 : a.y + Math.min(a.h * 0.22, 170);
        c.drawImage(halo, cx - r * 3, cy - r * 3, r * 6, r * 6);
        c.save();
        c.beginPath();
        c.arc(cx, cy, r, 0, TAU);
        c.clip();
        const off = ((t * 3) % 256) / 256; // one turn in about 85 s
        const size = r * 2;
        c.drawImage(moonTex, cx - r - off * size, cy - r, size, size);
        c.drawImage(moonTex, cx - r - off * size + size, cy - r, size, size);
        // Shade the night side.
        const g = c.createLinearGradient(cx - r, cy, cx + r, cy);
        g.addColorStop(0, 'rgba(10,17,36,0.85)');
        g.addColorStop(0.45, 'rgba(10,17,36,0.15)');
        g.addColorStop(1, 'rgba(10,17,36,0)');
        c.fillStyle = g;
        c.fillRect(cx - r, cy - r, size, size);
        c.restore();
      }
      // Now and then, a shooting star (about every 14 s, for under a second).
      const cycle = 14;
      const k = Math.floor(t / cycle);
      const p = (t % cycle) / 0.9;
      if (p < 1 && env.areas.length) {
        const r = rng(k * 31 + 7);
        const ar = env.areas[k % env.areas.length]!;
        const x0 = ar.x + r() * ar.w, y0 = ar.y + r() * ar.h * 0.5;
        const len = env.band ? 40 : 120;
        const x = x0 + p * len, y = y0 + p * len * 0.45;
        const g = c.createLinearGradient(x, y, x - len * 0.5, y - len * 0.22);
        g.addColorStop(0, `rgba(255,255,255,${0.9 * (1 - p)})`);
        g.addColorStop(1, 'rgba(255,255,255,0)');
        c.strokeStyle = g;
        c.lineWidth = 1.5;
        c.beginPath();
        c.moveTo(x, y);
        c.lineTo(x - len * 0.5, y - len * 0.22);
        c.stroke();
      }
    },
  };
};

// ------------------------------------------------------------------ Terminal: quiet readouts and a cursor
const terminal: SceneFactory = () => {
  const glyphs = '0123456789ABCDEF<>/:;.#';
  let cols: Array<{ x: number; a: Rect; speed: number; seed: number }> = [];
  return {
    fps: 12,
    resize(_w, _h, env) {
      cols = [];
      for (const a of env.areas) {
        const step = env.band ? 18 : 22;
        for (let x = a.x + 8; x < a.x + a.w - 8; x += step) cols.push({ x, a, speed: 6 + ((x * 7) % 9), seed: Math.floor(x) });
      }
    },
    draw(c, t, _w, _h, env) {
      c.font = `${env.band ? 11 : 13}px 'VT323', 'IBM Plex Mono', monospace`;
      c.textBaseline = 'top';
      for (const col of cols) {
        const line = 16;
        const rows = Math.ceil(col.a.h / line) + 1;
        const shift = (t * col.speed) % line;
        for (let i = 0; i < rows; i++) {
          const n = Math.floor(t * col.speed / line) - i;
          const r = rng(col.seed * 977 + n)();
          if (r > 0.42) continue;
          c.fillStyle = `rgba(110,245,140,${0.06 + r * 0.22})`;
          c.fillText(glyphs[Math.floor(r * 1000) % glyphs.length]!, col.x, col.a.y + i * line + shift - line);
        }
      }
      const a = biggest(env.areas);
      if (a && Math.floor(t * 2) % 2 === 0) {
        c.fillStyle = 'rgba(110,245,140,0.55)';
        c.fillRect(a.x + 12, a.y + a.h - (env.band ? 14 : 40), 8, env.band ? 10 : 14);
      }
    },
  };
};

// ------------------------------------------------------------------ Pixel Quest: an 8-bit landscape on the story's clock
function skyFor(hour: number) {
  // [top, bottom] colors through the day.
  const stops: Array<[number, string, string]> = [
    [0, '#0b0a24', '#1d1a45'], [5, '#1d1a45', '#56407a'], [6.5, '#ff8f6b', '#ffd38a'], [9, '#5fa8ff', '#a8d8ff'],
    [16, '#5fa8ff', '#b6e0ff'], [18.5, '#ff7e5f', '#ffc46b'], [20, '#3b2a6b', '#7a4e8c'], [22, '#0b0a24', '#1d1a45'], [24, '#0b0a24', '#1d1a45'],
  ];
  let i = 0;
  while (i < stops.length - 2 && hour >= stops[i + 1]![0]) i++;
  return [stops[i]![1], stops[i]![2]] as const;
}
const pixel: SceneFactory = () => {
  const P = 4; // one 8-bit pixel, in CSS pixels
  return {
    fps: 10,
    draw(c, t, _w, _h, env) {
      c.imageSmoothingEnabled = false;
      const [top, bottom] = skyFor(env.hour);
      const night = env.hour < 5.5 || env.hour > 20.5;
      for (const a of env.areas) {
        const bands = 6;
        for (let i = 0; i < bands; i++) {
          c.fillStyle = i < bands / 2 ? top : bottom;
          c.globalAlpha = 0.55 + (i / bands) * 0.3;
          const y = a.y + Math.floor(((a.h * i) / bands) / P) * P;
          c.fillRect(a.x, y, a.w, Math.ceil(a.h / bands / P) * P + P);
        }
        c.globalAlpha = 1;
        // Sun or moon on an arc across the day.
        const d = ((env.hour - 6 + 24) % 24) / 12; // 0..2
        const up = d <= 1 ? d : d - 1;
        const bx = a.x + up * a.w, by = a.y + a.h * (0.75 - Math.sin(up * Math.PI) * 0.55);
        c.fillStyle = d <= 1 ? '#ffe066' : '#f4f1ff';
        const r = env.band ? 2 : 3;
        for (let yy = -r; yy <= r; yy++) for (let xx = -r; xx <= r; xx++) if (xx * xx + yy * yy <= r * r + 1) c.fillRect(Math.floor(bx / P) * P + xx * P, Math.floor(by / P) * P + yy * P, P, P);
        if (night) {
          const r2 = rng(Math.floor(a.x) + 3);
          for (let i = 0; i < (env.band ? 8 : 28); i++) {
            if (Math.sin(t * 2 + i) > 0.6) continue;
            c.fillStyle = '#ffffff';
            c.fillRect(Math.floor((a.x + r2() * a.w) / P) * P, Math.floor((a.y + r2() * a.h * 0.6) / P) * P, P, P);
          }
        }
        // Clouds drift.
        c.fillStyle = night ? 'rgba(160,150,210,0.35)' : 'rgba(255,255,255,0.85)';
        for (let i = 0; i < 2; i++) {
          const cx = a.x + ((t * (3 + i * 2) + i * 130) % (a.w + 60)) - 30;
          const cy = a.y + a.h * (0.18 + i * 0.12);
          for (const [dx, dy, ww] of [[0, 0, 6], [P, -P, 4], [2 * P, 0, 6]] as const) c.fillRect(Math.floor((cx + dx * 2) / P) * P, Math.floor((cy + dy) / P) * P, ww * P, P * 2);
        }
        // Mountains and hills, stepped.
        const ground = a.y + a.h;
        const hill = (base: number, amp: number, freq: number, color: string, phase: number) => {
          c.fillStyle = color;
          for (let x = a.x; x < a.x + a.w; x += P) {
            const hgt = base + Math.abs(Math.sin(x * freq + phase)) * amp + Math.sin(x * freq * 3.1 + phase) * amp * 0.25;
            const top2 = Math.floor((ground - hgt) / P) * P;
            c.fillRect(x, top2, P, ground - top2);
          }
        };
        const scale = env.band ? 0.35 : 1;
        hill(70 * scale, 90 * scale, 0.012, night ? '#2b2558' : '#6b6fb8', 1);
        hill(40 * scale, 40 * scale, 0.02, night ? '#1f3a36' : '#3f9b5d', 4);
        hill(14 * scale, 14 * scale, 0.05, night ? '#18302b' : '#2f7d48', 9);
      }
    },
  };
};

// ------------------------------------------------------------------ Rainy Window: drops on glass, a blurred city
const rain: SceneFactory = () => {
  let city: HTMLCanvasElement | null = null;
  let drops: Array<{ x: number; y: number; v: number; r: number; a: Rect; stick: number }> = [];
  return {
    fps: 30,
    resize(w, h, env) {
      // City lights: soft circles, drawn once.
      city = document.createElement('canvas');
      city.width = Math.max(1, Math.round(w));
      city.height = Math.max(1, Math.round(h));
      const c = city.getContext('2d')!;
      const r = rng(19);
      const colors = ['255,190,120', '255,120,110', '140,200,255', '255,230,160'];
      for (const a of env.areas) {
        for (let i = 0; i < (env.band ? 10 : 34); i++) {
          const x = a.x + r() * a.w, y = a.y + a.h * (env.band ? r() : 0.35 + r() * 0.65), rad = (env.band ? 6 : 10) + r() * (env.band ? 10 : 26);
          const g = c.createRadialGradient(x, y, 0, x, y, rad);
          const col = colors[Math.floor(r() * colors.length)];
          g.addColorStop(0, `rgba(${col},${0.12 + r() * 0.18})`);
          g.addColorStop(1, `rgba(${col},0)`);
          c.fillStyle = g;
          c.fillRect(x - rad, y - rad, rad * 2, rad * 2);
        }
      }
      const r2 = rng(23);
      drops = [];
      for (const a of env.areas) for (let i = 0; i < (env.band ? 10 : 30); i++) drops.push({ x: a.x + r2() * a.w, y: a.y + r2() * a.h, v: 8 + r2() * 40, r: 1.2 + r2() * 2.6, a, stick: r2() * 4 });
    },
    draw(c, t, _w, _h) {
      if (city) c.drawImage(city, 0, 0);
      for (const d of drops) {
        // Stick, then slide: drops on glass move in jerks.
        const phase = (t + d.stick) % 4;
        const moving = phase > 1.6;
        const y = d.a.y + ((d.y - d.a.y + (moving ? (phase - 1.6) * d.v : 0) + Math.floor((t + d.stick) / 4) * d.v * 2.4) % d.a.h);
        c.fillStyle = 'rgba(200,220,240,0.28)';
        c.beginPath();
        c.ellipse(d.x, y, d.r, d.r * 1.25, 0, 0, TAU);
        c.fill();
        c.fillStyle = 'rgba(255,255,255,0.45)';
        c.fillRect(d.x - d.r * 0.35, y - d.r * 0.6, d.r * 0.45, d.r * 0.45);
        if (moving) {
          c.fillStyle = 'rgba(200,220,240,0.10)';
          c.fillRect(d.x - d.r * 0.3, y - d.r * 9, d.r * 0.6, d.r * 8);
        }
      }
    },
  };
};

// ------------------------------------------------------------------ Sketchbook: doodles that draw themselves
const DOODLES: Array<Array<[number, number]>> = [
  // star
  [[0, -1], [0.24, -0.3], [0.95, -0.3], [0.38, 0.12], [0.6, 0.85], [0, 0.4], [-0.6, 0.85], [-0.38, 0.12], [-0.95, -0.3], [-0.24, -0.3], [0, -1]],
  // spiral
  Array.from({ length: 40 }, (_, i) => [Math.cos(i * 0.45) * (i / 40), Math.sin(i * 0.45) * (i / 40)] as [number, number]),
  // leaf
  [[-1, 0.6], [-0.4, -0.2], [0.4, -0.6], [1, -0.8], [0.6, 0], [0, 0.5], [-1, 0.6], [0.6, -0.5]],
  // little house
  [[-0.8, 0.8], [-0.8, -0.1], [0, -0.8], [0.8, -0.1], [0.8, 0.8], [-0.8, 0.8], [-0.2, 0.8], [-0.2, 0.3], [0.2, 0.3], [0.2, 0.8]],
  // cloud
  Array.from({ length: 30 }, (_, i) => {
    const a = (i / 29) * TAU;
    return [Math.cos(a) * (0.9 + 0.15 * Math.sin(a * 5)), Math.sin(a) * (0.5 + 0.12 * Math.sin(a * 5))] as [number, number];
  }),
];
const sketch: SceneFactory = () => ({
  fps: 30,
  draw(c, t, _w, _h, env) {
    c.strokeStyle = 'rgba(40,36,30,0.55)';
    c.lineWidth = 1.6;
    c.lineCap = c.lineJoin = 'round';
    const slots = env.areas.flatMap((a, i) => (env.band ? [0, 1, 2].map((k) => ({ a, k: k + i * 3 })) : [0, 1].map((k) => ({ a, k: k + i * 2 }))));
    slots.forEach(({ a, k }, si) => {
      const cycle = 9;
      const tt = t + si * 2.3;
      const n = Math.floor(tt / cycle);
      const p = (tt % cycle) / cycle; // draw 0–0.35, hold, fade 0.85–1
      const r = rng(n * 13 + k * 7);
      const pts = DOODLES[Math.floor(r() * DOODLES.length)]!;
      const size = env.band ? a.h * 0.3 : Math.min(a.w * 0.28, 38);
      const cx = a.x + size + r() * Math.max(1, a.w - size * 2);
      const cy = env.band ? a.y + a.h / 2 : a.y + (a.h / (env.band ? 1 : 2)) * ((k % 2) + 0.3 + r() * 0.4);
      const upto = Math.min(1, p / 0.35) * (pts.length - 1);
      c.globalAlpha = p > 0.85 ? (1 - p) / 0.15 : 1;
      c.beginPath();
      for (let i = 0; i <= Math.floor(upto); i++) {
        const [x, y] = pts[i]!;
        const jitter = Math.sin(i * 12.9 + n) * 0.03;
        if (i === 0) c.moveTo(cx + (x + jitter) * size, cy + (y - jitter) * size);
        else c.lineTo(cx + (x + jitter) * size, cy + (y - jitter) * size);
      }
      const f = upto - Math.floor(upto);
      if (f > 0 && Math.floor(upto) + 1 < pts.length) {
        const [x0, y0] = pts[Math.floor(upto)]!, [x1, y1] = pts[Math.floor(upto) + 1]!;
        c.lineTo(cx + (x0 + (x1 - x0) * f) * size, cy + (y0 + (y1 - y0) * f) * size);
      }
      c.stroke();
    });
    c.globalAlpha = 1;
  },
});

// ------------------------------------------------------------------ Sakura: petals drifting
const sakura: SceneFactory = () => {
  let petals: Array<{ x: number; y: number; a: Rect; s: number; r: number }> = [];
  const petal = sprite(32, (c, s) => {
    c.translate(s / 2, s / 2);
    const g = c.createLinearGradient(0, -s / 2, 0, s / 2);
    g.addColorStop(0, '#ffd6e0');
    g.addColorStop(1, '#f19ab4');
    c.fillStyle = g;
    c.beginPath();
    c.moveTo(0, -s * 0.42);
    c.bezierCurveTo(s * 0.38, -s * 0.3, s * 0.3, s * 0.3, 0, s * 0.42);
    c.bezierCurveTo(-s * 0.3, s * 0.3, -s * 0.38, -s * 0.3, 0, -s * 0.42);
    c.fill();
  });
  return {
    fps: 30,
    resize(_w, _h, env) {
      petals = scatter(env.areas, env.band ? 9 : 28, 29).map((p) => ({ x: p.x, y: p.y, a: p.a, s: p.s, r: p.r }));
    },
    draw(c, t, _w, _h, env) {
      for (const p of petals) {
        const a = p.a;
        const fall = 10 + p.s * 16;
        const y = a.y + (((p.y - a.y + t * fall) % (a.h + 30)) + a.h + 30) % (a.h + 30) - 15;
        const x = a.x + (((p.x - a.x + Math.sin(t * 0.7 + p.r * 9) * 18 + t * 6) % a.w) + a.w) % a.w;
        const sz = (env.band ? 7 : 10) + p.s * 8;
        c.save();
        c.translate(x, y);
        c.rotate(t * (0.5 + p.s) + p.r * 6);
        c.scale(Math.cos(t * (1.2 + p.s) + p.r * 4), 1);
        c.globalAlpha = 0.75;
        c.drawImage(petal, -sz / 2, -sz / 2, sz, sz);
        c.restore();
      }
    },
  };
};

// ------------------------------------------------------------------ Neon City: tubes, a slow sweep of light, wet reflections
const neon: SceneFactory = () => ({
  fps: 24,
  draw(c, t, _w, _h, env) {
    const tubes: Array<[string, number]> = [['255,90,168', 0], ['90,220,255', 0.5]];
    for (const a of env.areas) {
      tubes.forEach(([col, ph], i) => {
        if (env.band) {
          const y = a.y + a.h * (0.35 + i * 0.3);
          c.fillStyle = `rgba(${col},0.18)`;
          c.fillRect(a.x, y - 2, a.w, 4);
          const sx = a.x + ((t * 40 + ph * a.w) % (a.w + 120)) - 60;
          const g = c.createLinearGradient(sx - 60, 0, sx + 60, 0);
          g.addColorStop(0, `rgba(${col},0)`);
          g.addColorStop(0.5, `rgba(${col},0.75)`);
          g.addColorStop(1, `rgba(${col},0)`);
          c.fillStyle = g;
          c.fillRect(sx - 60, y - 1, 120, 2);
          return;
        }
        const x = a.x + a.w * (0.3 + i * 0.4);
        const top = a.y + 60 + i * 40, len = a.h * 0.45;
        // The tube's glow, then its bright core, with a light running along it.
        c.fillStyle = `rgba(${col},0.10)`;
        c.fillRect(x - 6, top, 12, len);
        c.fillStyle = `rgba(${col},0.55)`;
        c.fillRect(x - 1, top, 2, len);
        const sy = top + ((t * 30 + ph * len) % len);
        const g = c.createLinearGradient(0, sy - 50, 0, sy + 50);
        g.addColorStop(0, `rgba(${col},0)`);
        g.addColorStop(0.5, `rgba(${col},0.9)`);
        g.addColorStop(1, `rgba(${col},0)`);
        c.fillStyle = g;
        c.fillRect(x - 2, sy - 50, 4, 100);
        // Its reflection on the wet ground, broken by ripples.
        const ground = a.y + a.h;
        for (let k = 0; k < 10; k++) {
          const ry = ground - 12 - k * 9;
          const wob = Math.sin(t * 1.5 + k * 1.3 + i) * (2 + k * 0.4);
          c.fillStyle = `rgba(${col},${0.12 - k * 0.01})`;
          c.fillRect(x - 3 + wob, ry, 6, 4);
        }
      });
    }
  },
});

// ------------------------------------------------------------------ Parchment Quest: a map's edge and a compass rose
const parchment: SceneFactory = () => {
  let map: HTMLCanvasElement | null = null;
  return {
    fps: 20,
    resize(w, h, env) {
      map = document.createElement('canvas');
      map.width = Math.max(1, Math.round(w));
      map.height = Math.max(1, Math.round(h));
      const c = map.getContext('2d')!;
      const r = rng(41);
      c.strokeStyle = 'rgba(90,60,25,0.45)';
      c.lineWidth = 1.2;
      for (const a of env.areas) {
        // A coastline down the margin, hatched on the sea side.
        c.beginPath();
        const steps = Math.max(8, Math.floor((env.band ? a.w : a.h) / 14));
        for (let i = 0; i <= steps; i++) {
          const f = i / steps;
          const x = env.band ? a.x + f * a.w : a.x + a.w * (0.55 + 0.18 * Math.sin(f * 9) + 0.06 * (r() - 0.5));
          const y = env.band ? a.y + a.h * (0.6 + 0.2 * Math.sin(f * 11)) : a.y + f * a.h;
          if (i === 0) c.moveTo(x, y);
          else c.lineTo(x, y);
        }
        c.stroke();
        // Little mountains and a dotted route.
        c.fillStyle = 'rgba(90,60,25,0.35)';
        for (let i = 0; i < (env.band ? 4 : 9); i++) {
          const x = a.x + r() * a.w * 0.5 + 6, y = a.y + 20 + r() * (a.h - 40), s = 6 + r() * 6;
          c.beginPath();
          c.moveTo(x - s, y + s * 0.6);
          c.lineTo(x, y - s * 0.6);
          c.lineTo(x + s, y + s * 0.6);
          c.stroke();
        }
        c.setLineDash([2, 5]);
        c.strokeStyle = 'rgba(142,48,32,0.45)';
        c.beginPath();
        for (let i = 0; i < 6; i++) {
          const x = a.x + a.w * (0.15 + r() * 0.6), y = a.y + (env.band ? r() * a.h : (a.h * i) / 5);
          if (i === 0) c.moveTo(x, y);
          else c.lineTo(x, y);
        }
        c.stroke();
        c.setLineDash([]);
        c.strokeStyle = 'rgba(90,60,25,0.45)';
      }
    },
    draw(c, t, _w, _h, env) {
      if (map) c.drawImage(map, 0, 0);
      const a = biggest(env.areas);
      if (!a) return;
      const r = env.band ? a.h * 0.38 : Math.min(a.w * 0.3, 52);
      const cx = env.band ? a.x + a.w - r * 2 : a.x + a.w / 2;
      const cy = env.band ? a.y + a.h / 2 : a.y + a.h - r * 2.2;
      c.save();
      c.translate(cx, cy);
      c.rotate(Math.sin(t * 0.12) * 0.35 + t * 0.02);
      c.strokeStyle = 'rgba(80,52,20,0.7)';
      c.lineWidth = 1.2;
      c.beginPath();
      c.arc(0, 0, r, 0, TAU);
      c.stroke();
      c.beginPath();
      c.arc(0, 0, r * 0.82, 0, TAU);
      c.stroke();
      for (let i = 0; i < 8; i++) {
        const long = i % 2 === 0;
        const len = long ? r * 0.95 : r * 0.55;
        c.save();
        c.rotate((i * TAU) / 8);
        c.fillStyle = i === 0 ? 'rgba(142,48,32,0.8)' : long ? 'rgba(80,52,20,0.65)' : 'rgba(80,52,20,0.35)';
        c.beginPath();
        c.moveTo(0, -len);
        c.lineTo(r * 0.1, 0);
        c.lineTo(-r * 0.1, 0);
        c.closePath();
        c.fill();
        c.restore();
      }
      c.restore();
    },
  };
};

export const SCENES: Record<string, SceneFactory> = { lantern, night, terminal, pixel, rain, sketch, sakura, neon, parchment };

export type { Env, Scene };
