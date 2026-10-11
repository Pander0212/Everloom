/**
 * Themes ("looks"): complete designs, not just accents. A look has its own colors for light and/or
 * dark, fonts (self-hosted), shape (radii, borders), a motion style, an optional texture, a typing
 * indicator, and optional scenery drawn around the story on the play screen
 * (apps/web/src/themes/scenery). docs/ux/themes.md has the rules; a test checks every look's text
 * against WCAG AA.
 *
 * Everloom's own designs; Hakawati (GPL-3.0) was looked at for the idea of full themes with scenery
 * and a gallery, and nothing of its code, CSS or art is used.
 */

export type Scheme = 'light' | 'dark';
export type MotionStyle = 'snappy' | 'soft' | 'playful';

/** The color tokens of app.css (see :root there). A look overrides some of them. */
export interface Tokens {
  bg: string;
  surface: string;
  'surface-2': string;
  'surface-3': string;
  border: string;
  'border-strong': string;
  text: string;
  'text-2': string;
  'text-3': string;
  accent: string;
  'accent-hover': string;
  'accent-fg': string;
  'accent-text': string;
  'accent-soft': string;
  danger: string;
  'danger-soft': string;
  success: string;
  'success-soft': string;
  warning: string;
  'warning-soft': string;
  overlay: string;
  'shadow-color': string;
}

/** app.css's own tokens (Everloom, light and dark); a test keeps these in step with the stylesheet. */
export const BASE: Record<Scheme, Tokens> = {
  light: {
    bg: '#f6f5f2', surface: '#ffffff', 'surface-2': '#efeeea', 'surface-3': '#e6e4de', border: '#e3e1db', 'border-strong': '#cdcac2',
    text: '#18191b', 'text-2': '#595c62', 'text-3': '#63666c', accent: '#cf912f', 'accent-hover': '#c2852a', 'accent-fg': '#1b1203', 'accent-text': '#8c5709', 'accent-soft': 'rgb(207 145 47 / 0.13)',
    danger: '#c7353c', 'danger-soft': 'rgb(199 53 60 / 0.1)', success: '#2f7a3c', 'success-soft': 'rgb(47 122 60 / 0.1)', warning: '#9a5b00', 'warning-soft': 'rgb(207 145 47 / 0.14)', overlay: 'rgb(20 20 22 / 0.36)', 'shadow-color': '30 25 15',
  },
  dark: {
    bg: '#0e0f11', surface: '#151619', 'surface-2': '#1b1c20', 'surface-3': '#24262b', border: '#25272c', 'border-strong': '#34373d',
    text: '#ecedee', 'text-2': '#a2a5ab', 'text-3': '#8a8d94', accent: '#e1a94f', 'accent-hover': '#ecb660', 'accent-fg': '#1b1203', 'accent-text': '#e8b566', 'accent-soft': 'rgb(225 169 79 / 0.14)',
    danger: '#f0676c', 'danger-soft': 'rgb(240 103 108 / 0.13)', success: '#5bbf6b', 'success-soft': 'rgb(91 191 107 / 0.13)', warning: '#f0b445', 'warning-soft': 'rgb(240 180 69 / 0.13)', overlay: 'rgb(0 0 0 / 0.55)', 'shadow-color': '0 0 0',
  },
};

const SANS = "'Inter Variable', ui-sans-serif, system-ui, -apple-system, 'Segoe UI', sans-serif";
const SERIF = "'Source Serif 4 Variable', ui-serif, Georgia, serif";
const GARAMOND = "'EB Garamond', 'Source Serif 4 Variable', Georgia, serif";
const CORMORANT = "'Cormorant Garamond', 'EB Garamond', Georgia, serif";
const MONO = "'IBM Plex Mono', ui-monospace, 'SFMono-Regular', Menlo, monospace";
const CRT = "'VT323', 'IBM Plex Mono', ui-monospace, monospace";
const PIXEL = "'Pixelify Sans', 'Inter Variable', sans-serif";
const HAND = "'Caveat', 'Inter Variable', cursive";
const CINZEL = "'Cinzel', 'EB Garamond', Georgia, serif";
const FELL = "'IM Fell English', 'EB Garamond', Georgia, serif";
const TYPEWRITER = "'Special Elite', 'IBM Plex Mono', monospace";

/** Fonts a player can pick for the story or the interface (Settings › Appearance & themes › Reading). */
export const FONTS: Array<{ id: string; label: string; css: string }> = [
  { id: 'sans', label: 'Inter (sans)', css: SANS },
  { id: 'serif', label: 'Source Serif', css: SERIF },
  { id: 'garamond', label: 'EB Garamond', css: GARAMOND },
  { id: 'cormorant', label: 'Cormorant Garamond', css: CORMORANT },
  { id: 'fell', label: 'IM Fell English (old print)', css: FELL },
  { id: 'mono', label: 'IBM Plex Mono', css: MONO },
  { id: 'typewriter', label: 'Special Elite (typewriter)', css: TYPEWRITER },
  { id: 'system', label: 'This device’s font', css: 'system-ui, -apple-system, sans-serif' },
];

export type Loader = 'dots' | 'quill' | 'cursor' | 'blocks' | 'drops' | 'petal' | 'pulse' | 'stars' | 'scribble';

export interface Look {
  id: string;
  name: string;
  /** One line in the gallery. */
  description: string;
  schemes: Scheme[];
  colors: Partial<Record<Scheme, Partial<Tokens>>>;
  fonts: { ui: string; story: string; heading: string };
  /** Corner radii: small, medium, large (px). */
  radius: [number, number, number];
  motion: MotionStyle;
  loader: Loader;
  /** Scenery module id (themes/scenery), drawn around the story. */
  scenery?: string;
  /** A background texture (CSS background-image) for the page. */
  texture?: string;
  /** Extra rules, scoped to the look by the generator (`&` is the look's root). */
  css?: string;
}

// Paper grain: a tiny SVG noise tile.
const grain = (alpha: number) =>
  `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='140' height='140'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='.9' numOctaves='2' stitchTiles='stitch'/%3E%3CfeColorMatrix values='0 0 0 0 .35 0 0 0 0 .25 0 0 0 0 .12 0 0 0 ${alpha} 0'/%3E%3C/filter%3E%3Crect width='140' height='140' filter='url(%23n)'/%3E%3C/svg%3E")`;

export const LOOKS: Look[] = [
  {
    id: 'everloom',
    name: 'Everloom',
    description: 'The house style: calm, warm amber, light or dark.',
    schemes: ['light', 'dark'],
    colors: {},
    fonts: { ui: SANS, story: SERIF, heading: SANS },
    radius: [6, 10, 16],
    motion: 'soft',
    loader: 'dots',
  },
  {
    id: 'lantern',
    name: 'Lantern Library',
    description: 'Warm paper, brass and a book face; dust drifting in lamplight.',
    schemes: ['light'],
    colors: {
      light: {
        bg: '#f2e8d3', surface: '#faf3e3', 'surface-2': '#eadfc5', 'surface-3': '#dfd1b2', border: '#d9c8a6', 'border-strong': '#bfa77d',
        text: '#2a2016', 'text-2': '#59472f', 'text-3': '#664f33', accent: '#a7782a', 'accent-hover': '#946924', 'accent-fg': '#1a1205', 'accent-text': '#79520f', 'accent-soft': 'rgb(167 120 42 / 0.15)', danger: '#a62a30',
        'shadow-color': '70 45 10',
      },
    },
    fonts: { ui: SANS, story: GARAMOND, heading: CORMORANT },
    radius: [4, 8, 12],
    motion: 'soft',
    loader: 'quill',
    scenery: 'lantern',
    texture: grain(0.12),
    css: `& .story { font-size: calc(var(--story-size) * 1.06); }
& h1, & h2 { letter-spacing: 0.01em; }`,
  },
  {
    id: 'night',
    name: 'Night Voyage',
    description: 'Deep navy and pale gold under stars and a slowly turning moon.',
    schemes: ['dark'],
    colors: {
      dark: {
        bg: '#0a1124', surface: '#101a33', 'surface-2': '#162241', 'surface-3': '#1e2b50', border: '#202d55', 'border-strong': '#33447a',
        text: '#e7eaf6', 'text-2': '#aab3d4', 'text-3': '#8f99c0', accent: '#d2bb72', 'accent-hover': '#e0ca86', 'accent-fg': '#151005', 'accent-text': '#e3cf8d', 'accent-soft': 'rgb(210 187 114 / 0.15)',
        overlay: 'rgb(2 5 15 / 0.6)',
      },
    },
    fonts: { ui: SANS, story: SERIF, heading: CORMORANT },
    radius: [8, 12, 18],
    motion: 'soft',
    loader: 'stars',
    scenery: 'night',
  },
  {
    id: 'terminal',
    name: 'Terminal',
    description: 'A green phosphor screen with a soft glow. Readability first.',
    schemes: ['dark'],
    colors: {
      dark: {
        bg: '#050b06', surface: '#09130b', 'surface-2': '#0e1b10', 'surface-3': '#142616', border: '#1b351f', 'border-strong': '#2b5130',
        text: '#bff7c4', 'text-2': '#86d48e', 'text-3': '#6fbd78', accent: '#52f074', 'accent-hover': '#79f492', 'accent-fg': '#021406', 'accent-text': '#72f58c', 'accent-soft': 'rgb(82 240 116 / 0.12)',
        danger: '#ff8a7a', success: '#7ff08f', warning: '#f3d36b', overlay: 'rgb(0 6 2 / 0.7)',
      },
    },
    fonts: { ui: MONO, story: MONO, heading: CRT },
    radius: [2, 3, 4],
    motion: 'snappy',
    loader: 'cursor',
    scenery: 'terminal',
    texture: 'repeating-linear-gradient(0deg, rgb(120 255 150 / 0.025) 0 1px, transparent 1px 3px)',
    css: `& .story { text-shadow: 0 0 6px rgb(110 245 140 / 0.28); letter-spacing: 0.005em; }
& h1, & h2 { font-size: 1.35em; letter-spacing: 0.04em; text-transform: uppercase; }`,
  },
  {
    id: 'pixel',
    name: 'Pixel Quest',
    description: 'An 8-bit landscape whose sky follows the story’s clock.',
    schemes: ['dark'],
    colors: {
      dark: {
        bg: '#19152e', surface: '#211c3b', 'surface-2': '#2a244e', 'surface-3': '#352e61', border: '#3b336b', 'border-strong': '#584d97',
        text: '#f2eeff', 'text-2': '#c6bee8', 'text-3': '#a99fd4', accent: '#ffcb47', 'accent-hover': '#ffd76c', 'accent-fg': '#1b1306', 'accent-text': '#ffd25f', 'accent-soft': 'rgb(255 203 71 / 0.15)',
      },
    },
    fonts: { ui: SANS, story: SERIF, heading: PIXEL },
    radius: [0, 2, 4],
    motion: 'playful',
    loader: 'blocks',
    scenery: 'pixel',
    css: `& h1, & h2, & [role=dialog] h2 { font-family: var(--font-heading); letter-spacing: 0.02em; }
& .pressable:active:not(:disabled) { transform: translateY(1px); }`,
  },
  {
    id: 'rain',
    name: 'Rainy Window',
    description: 'Cool grey, drops sliding down the glass, a blurred city behind.',
    schemes: ['dark'],
    colors: {
      dark: {
        bg: '#1a1f25', surface: '#212730', 'surface-2': '#29303a', 'surface-3': '#323a46', border: '#323a46', 'border-strong': '#495262',
        text: '#e4e9ef', 'text-2': '#abb5c1', 'text-3': '#909ba8', accent: '#82b6db', 'accent-hover': '#99c4e4', 'accent-fg': '#07131c', 'accent-text': '#97c6e7', 'accent-soft': 'rgb(130 182 219 / 0.15)',
      },
    },
    fonts: { ui: SANS, story: SERIF, heading: SANS },
    radius: [10, 14, 20],
    motion: 'soft',
    loader: 'drops',
    scenery: 'rain',
  },
  {
    id: 'sketch',
    name: 'Sketchbook',
    description: 'Off-white paper, ink lines, small doodles that draw themselves.',
    schemes: ['light'],
    colors: {
      light: {
        bg: '#fbf9f3', surface: '#fffefa', 'surface-2': '#f2efe5', 'surface-3': '#e8e4d7', border: '#bdb7a7', 'border-strong': '#57534a',
        text: '#22211f', 'text-2': '#54514a', 'text-3': '#625e56', accent: '#c4472e', 'accent-hover': '#b03e27', 'accent-fg': '#ffffff', 'accent-text': '#a83a23', 'accent-soft': 'rgb(196 71 46 / 0.11)',
        'shadow-color': '40 35 25',
      },
    },
    fonts: { ui: SANS, story: SERIF, heading: HAND },
    radius: [3, 6, 10],
    motion: 'playful',
    loader: 'scribble',
    scenery: 'sketch',
    texture: grain(0.06),
    css: `& h1, & h2 { font-family: var(--font-heading); font-size: 1.45em; font-weight: 600; }
& .field, & .ev-bubble { border: 1.5px solid var(--border-strong); }
& .ev-palette, & [role=dialog] { box-shadow: 3px 3px 0 rgb(40 35 25 / 0.85); border: 1.5px solid var(--border-strong); }`,
  },
  {
    id: 'sakura',
    name: 'Sakura',
    description: 'Soft pink and charcoal, petals drifting in the margins.',
    schemes: ['light'],
    colors: {
      light: {
        bg: '#fbf3f4', surface: '#fffafa', 'surface-2': '#f5e5e8', 'surface-3': '#edd6db', border: '#ebd1d7', 'border-strong': '#d6afb8',
        text: '#2d282a', 'text-2': '#5c5155', 'text-3': '#6a5e63', accent: '#b24c6c', 'accent-hover': '#a1405f', 'accent-fg': '#ffffff', 'accent-text': '#a63d5e', 'accent-soft': 'rgb(196 88 122 / 0.12)',
        'shadow-color': '90 40 55',
      },
    },
    fonts: { ui: SANS, story: SERIF, heading: CORMORANT },
    radius: [10, 16, 22],
    motion: 'soft',
    loader: 'petal',
    scenery: 'sakura',
  },
  {
    id: 'neon',
    name: 'Neon City',
    description: 'Dark streets, one restrained neon, slow light on wet glass.',
    schemes: ['dark'],
    colors: {
      dark: {
        bg: '#0c0b12', surface: '#13121c', 'surface-2': '#1b1928', 'surface-3': '#242136', border: '#25223b', 'border-strong': '#3b365a',
        text: '#edecf6', 'text-2': '#b0abca', 'text-3': '#938eb2', accent: '#ff5aa8', 'accent-hover': '#ff78b9', 'accent-fg': '#1a0611', 'accent-text': '#ff82c0', 'accent-soft': 'rgb(255 90 168 / 0.14)',
      },
    },
    fonts: { ui: SANS, story: SERIF, heading: MONO },
    radius: [8, 12, 16],
    motion: 'snappy',
    loader: 'pulse',
    scenery: 'neon',
    css: `& h1, & h2 { letter-spacing: 0.06em; text-transform: uppercase; font-size: 0.95em; }`,
  },
  {
    id: 'parchment',
    name: 'Parchment Quest',
    description: 'A fantasy map’s edge, a compass rose turning slowly.',
    schemes: ['light'],
    colors: {
      light: {
        bg: '#eee1c3', surface: '#f7eed7', 'surface-2': '#e5d4ae', 'surface-3': '#dac598', border: '#cfb887', 'border-strong': '#ad9461',
        text: '#2c2113', 'text-2': '#584426', 'text-3': '#644e2e', accent: '#8e3020', 'accent-hover': '#7b281a', 'accent-fg': '#ffffff', 'accent-text': '#86301f', 'accent-soft': 'rgb(142 48 32 / 0.12)', danger: '#9a2318',
        'shadow-color': '70 45 10',
      },
    },
    fonts: { ui: SANS, story: GARAMOND, heading: CINZEL },
    radius: [3, 6, 10],
    motion: 'soft',
    loader: 'quill',
    scenery: 'parchment',
    texture: grain(0.16),
    css: `& h1, & h2 { font-family: var(--font-heading); letter-spacing: 0.03em; }`,
  },
  {
    id: 'minimal',
    name: 'Minimal',
    description: 'Pure, quiet and high contrast. Nothing extra.',
    schemes: ['light', 'dark'],
    colors: {
      light: {
        bg: '#ffffff', surface: '#ffffff', 'surface-2': '#f3f3f3', 'surface-3': '#e8e8e8', border: '#e0e0e0', 'border-strong': '#c4c4c4',
        text: '#000000', 'text-2': '#3b3b3b', 'text-3': '#525252', accent: '#000000', 'accent-hover': '#262626', 'accent-fg': '#ffffff', 'accent-text': '#000000', 'accent-soft': 'rgb(0 0 0 / 0.07)',
      },
      dark: {
        bg: '#000000', surface: '#0c0c0c', 'surface-2': '#161616', 'surface-3': '#212121', border: '#262626', 'border-strong': '#3b3b3b',
        text: '#ffffff', 'text-2': '#cccccc', 'text-3': '#a6a6a6', accent: '#ffffff', 'accent-hover': '#e5e5e5', 'accent-fg': '#000000', 'accent-text': '#ffffff', 'accent-soft': 'rgb(255 255 255 / 0.1)',
      },
    },
    fonts: { ui: SANS, story: SANS, heading: SANS },
    radius: [4, 6, 8],
    motion: 'snappy',
    loader: 'dots',
  },
];

export const look = (id: string | null | undefined) => LOOKS.find((l) => l.id === id) ?? LOOKS[0]!;

/** The scheme a look shows in, given the player's light/dark choice. */
export function schemeFor(l: Look, wanted: Scheme): Scheme {
  return l.schemes.includes(wanted) ? wanted : l.schemes[0]!;
}

export const MOTION: Record<MotionStyle, { dur: number; ease: string; press: number }> = {
  snappy: { dur: 140, ease: 'cubic-bezier(0.2, 0.9, 0.3, 1)', press: 0.97 },
  soft: { dur: 220, ease: 'cubic-bezier(0.22, 1, 0.36, 1)', press: 0.98 },
  playful: { dur: 200, ease: 'cubic-bezier(0.34, 1.4, 0.64, 1)', press: 0.94 },
};

/** The full token set a look shows in a scheme (the base tokens under its own). */
export function tokensOf(l: Look, s: Scheme): Tokens {
  return { ...BASE[s], ...(l.colors[s] ?? {}) };
}

const sel = (id: string) => `[data-look='${id}'][data-look='${id}']`;

/** The stylesheet for every look: tokens per scheme, fonts, radii, motion, texture and extra rules. */
export function looksCss(): string {
  const out: string[] = [];
  for (const l of LOOKS) {
    const m = MOTION[l.motion];
    const common = [
      `--font-ui: ${l.fonts.ui}`,
      `--font-story: ${l.fonts.story}`,
      `--font-heading: ${l.fonts.heading}`,
      `--r-sm: ${l.radius[0]}px`,
      `--r-md: ${l.radius[1]}px`,
      `--r-lg: ${l.radius[2]}px`,
      `--ui-dur: ${m.dur}ms`,
      `--ui-ease: ${m.ease}`,
      `--press: ${m.press}`,
      `--texture: ${l.texture ?? 'none'}`,
    ];
    out.push(`${sel(l.id)} { ${common.join('; ')}; }`);
    for (const s of l.schemes) {
      const c = l.colors[s];
      if (!c || !Object.keys(c).length) continue;
      const vars = Object.entries(c).map(([k, v]) => `--${k}: ${v}`);
      vars.push(`color-scheme: ${s}`);
      // A one-scheme look applies whatever the light/dark choice; the root is switched to its scheme.
      const scope = l.schemes.length > 1 ? `${sel(l.id)}[data-theme='${s}'], [data-theme='${s}'] ${sel(l.id)}:not([data-theme])` : sel(l.id);
      out.push(`${scope} { ${vars.join('; ')}; }`);
    }
    if (l.css) out.push(l.css.split('\n').map((r) => r.replaceAll('&', sel(l.id))).join('\n'));
  }
  return out.join('\n');
}
