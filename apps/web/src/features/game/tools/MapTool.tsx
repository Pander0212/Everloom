import type { CampaignState, Location, LocationKind, MapLevel, MapNode, MapScene, Op, PinKind, RouteMode, TravelOption } from '@everloom/engine';
import { childLevelOf, defaultTravelOption, generateMapScene, linesAt, locationPath, MAP_LEVELS, travelOptions } from '@everloom/engine';
import { Car, ChevronRight, CircleDot, Clock, Footprints, DoorOpen, Info, Landmark, LocateFixed, MapPin, MapPinPlus, Minus, Pencil, Plus, Route, Skull, Sparkles, Store, TrainFront, Trash2, type LucideIcon } from 'lucide-react';
import { animate, useReducedMotion } from 'motion/react';
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type PointerEvent as RPointerEvent } from 'react';
import { post } from '@/lib/api';
import { cx } from '@/lib/format';
import { ease } from '@/lib/motion';
import { setCampaignState } from '@/lib/queries';
import { toast, toastError } from '@/lib/store';
import { Badge, Button, confirm, Dialog, Field, Icon, IconButton, Input, Popover, Select, Sheet, Textarea, ToggleRow } from '@/ui';
import { useGame } from '../context';
import { JourneySheet, RideList } from './Journeys';
import { NoCampaign, ToolSheet } from './ToolSheet';

const LEVEL_LABEL: Record<MapLevel, string> = { world: 'World', region: 'Region', local: 'Local', nearby: 'Nearby', area: 'Area' };

export const PIN_ICON: Record<PinKind, LucideIcon> = {
  you: CircleDot,
  station: TrainFront,
  vehicle: Car,
  danger: Skull,
  service: Store,
  interior: DoorOpen,
  landmark: Landmark,
  place: MapPin,
};

const PIN_LABEL: Record<PinKind, string> = {
  you: 'You are here',
  station: 'Station or dock',
  vehicle: 'Vehicle',
  danger: 'Danger',
  service: 'Shop or service',
  interior: 'Building or room',
  landmark: 'Landmark',
  place: 'Place',
};

const KINDS: LocationKind[] = ['city', 'town', 'village', 'district', 'building', 'room', 'wilds', 'road', 'station', 'dock', 'landmark', 'shop', 'service', 'danger', 'interior', 'home', 'vehicle', 'region', 'realm', 'other'];

export function fmtMinutes(m: number): string {
  if (m < 60) return `${m} min`;
  const h = Math.floor(m / 60);
  const r = m % 60;
  if (h < 24) return r ? `${h} h ${r} min` : `${h} h`;
  const d = Math.floor(h / 24);
  return `${d} d ${h % 24} h`;
}

function fmtKm(km: number): string {
  return km < 1 ? `${Math.round(km * 1000)} m` : `${km < 10 ? km.toFixed(1) : Math.round(km)} km`;
}

interface View {
  x: number;
  y: number;
  k: number;
}

const MAX_K = 6;

/** Visible extent of the canvas in map units (the SVG uses "slice", so one side is 1000). Updated by the canvas. */
const vis = { w: 1000, h: 1000 };

/** Zoomed all the way out, the whole 1000×1000 map fits the canvas. */
function minK(): number {
  return Math.min(1, Math.min(vis.w, vis.h) / 1000);
}

function clampAxis(pos: number, k: number, extent: number): number {
  const slack = 160;
  const max = 500 - extent / 2 + slack;
  const min = 500 + extent / 2 - 1000 * k - slack;
  return min > max ? 500 - 500 * k : Math.min(max, Math.max(min, pos));
}

function clampView(v: View): View {
  const k = Math.min(MAX_K, Math.max(minK(), v.k));
  return { k, x: clampAxis(v.x, k, vis.w), y: clampAxis(v.y, k, vis.h) };
}

function focusView(x: number, y: number, k: number): View {
  return clampView({ k, x: 500 - x * k, y: 500 - y * k });
}

/** Frame every node with some margin (never zooming out past the whole map). */
function fitView(nodes: Array<{ x: number; y: number }>, focus?: { x: number; y: number } | null): View {
  if (!nodes.length) return { x: 0, y: 0, k: 1 };
  const xs = nodes.map((n) => n.x);
  const ys = nodes.map((n) => n.y);
  const pad = 140;
  const w = Math.max(...xs) - Math.min(...xs) + pad * 2;
  const h = Math.max(...ys) - Math.min(...ys) + pad * 2;
  const k = Math.min(2.2, Math.max(minK(), Math.min(vis.w / w, vis.h / h)));
  if (focus && nodes.length === 1) return focusView(focus.x, focus.y, 2);
  return focusView((Math.max(...xs) + Math.min(...xs)) / 2, (Math.max(...ys) + Math.min(...ys)) / 2, k);
}

const TERRAIN_FILL: Record<string, string> = {
  land: 'var(--map-land)',
  water: 'var(--map-water)',
  sand: 'var(--map-sand)',
  forest: 'var(--map-forest)',
  hill: 'var(--map-hill)',
  park: 'var(--map-park)',
  block: 'var(--map-block)',
  plaza: 'var(--map-sand)',
  room: 'var(--map-room)',
  hall: 'var(--map-floor)',
};

const BASE_FILL: Record<MapScene['base'], string> = { land: 'var(--map-land)', water: 'var(--map-water)', floor: 'var(--map-floor)' };

export default function MapTool({ arg }: { arg?: string }) {
  const { state: s, chat, apply } = useGame();
  const reduce = useReducedMotion();
  const initialParent = useMemo(() => {
    if (!s) return null;
    if (arg && s.locations[arg]) return s.locations[arg].parentId ?? null;
    const cur = s.currentLocationId ? s.locations[s.currentLocationId] : null;
    if (!cur) return null;
    // Standing in a town with charted streets: open inside it. Otherwise show the neighbourhood.
    const hasInside = Object.values(s.locations).some((l) => l.parentId === cur.id);
    return hasInside ? cur.id : cur.parentId ?? null;
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const [parentId, setParentId] = useState<string | null>(initialParent);
  const [selected, setSelected] = useState<string | null>(arg ?? null);
  const [placing, setPlacing] = useState(false);
  const [placeAt, setPlaceAt] = useState<{ x: number; y: number } | null>(null);
  const [expanding, setExpanding] = useState(false);
  const [showVisited, setShowVisited] = useState(false);
  const [journeys, setJourneys] = useState(false);
  const [view, setView] = useState<View>({ x: 0, y: 0, k: 1 });
  const viewRef = useRef(view);
  viewRef.current = view;
  const stopAnim = useRef<(() => void) | null>(null);
  /** Until the player pans or zooms, keep the scene framed as the panel settles or resizes. */
  const touched = useRef(false);

  // A parent that disappeared (removed, undo) falls back to the root.
  const parent = parentId && s ? s.locations[parentId] ?? null : null;
  const effectiveParent = parent ? parent.id : null;
  const scene = useMemo(() => (s ? generateMapScene(s, effectiveParent) : null), [s, effectiveParent]);
  const path = useMemo(() => (s ? locationPath(s, effectiveParent) : []), [s, effectiveParent]);

  const flyTo = useCallback(
    (target: View) => {
      stopAnim.current?.();
      touched.current = true;
      if (reduce) {
        setView(target);
        return;
      }
      const from = viewRef.current;
      const ctl = animate(0, 1, {
        duration: 0.45,
        ease,
        onUpdate: (t) => setView({ x: from.x + (target.x - from.x) * t, y: from.y + (target.y - from.y) * t, k: from.k + (target.k - from.k) * t }),
      });
      stopAnim.current = () => ctl.stop();
    },
    [reduce],
  );

  // Frame the scene when the level changes: centre on the player's branch if it's here.
  const frame = () => {
    if (!scene) return;
    const target = arg && scene.nodes.find((n) => n.id === arg);
    setView(target ? focusView(target.x, target.y, 2) : fitView(scene.nodes, scene.nodes.find((n) => n.current || n.containsCurrent)));
  };
  useEffect(() => {
    touched.current = false;
    frame();
  }, [effectiveParent]); // eslint-disable-line react-hooks/exhaustive-deps

  // Reframe when places are added or removed at this level.
  const nodeCount = scene?.nodes.length ?? 0;
  const prevCount = useRef(nodeCount);
  useEffect(() => {
    if (scene && prevCount.current !== nodeCount && nodeCount > prevCount.current) flyTo(fitView(scene.nodes));
    prevCount.current = nodeCount;
  }, [nodeCount]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!s || !scene) return <ToolSheet title="Map"><NoCampaign /></ToolSheet>;

  const levelIndex = parent ? MAP_LEVELS.indexOf(childLevelOf(parent.level)) : 0;
  const goLevel = (i: number) => {
    if (i === 0) setParentId(null);
    else if (path[i - 1]) setParentId(path[i - 1].id);
    setSelected(null);
  };
  const selectedNode = selected ? s.locations[selected] ?? null : null;

  const expand = async () => {
    setExpanding(true);
    try {
      const r = await post<{ state: CampaignState; added: number }>(`/api/campaigns/${chat.campaignId}/map/expand`, { chatId: chat.id, parentId: effectiveParent });
      setCampaignState(chat.campaignId!, r.state);
      toast({ title: r.added ? `Added ${r.added} unexplored ${r.added === 1 ? 'place' : 'places'}` : 'Nothing new was added', tone: r.added ? 'success' : undefined });
    } catch (e) {
      toastError(e);
    } finally {
      setExpanding(false);
    }
  };

  return (
    <ToolSheet
      title="Map"
      description={path.length ? path.map((l) => l.name).join(' › ') : s.meta.title || 'World'}
      size="full"
      flush
      headerActions={<IconButton icon={TrainFront} label="Journeys" onClick={() => setJourneys(true)} />}
      footer={
        <>
          <Button variant={placing ? 'primary' : 'secondary'} icon={MapPinPlus} className="flex-1" onClick={() => setPlacing((p) => !p)} aria-pressed={placing}>
            {placing ? 'Tap the map' : 'Place landmark'}
          </Button>
          <Button variant="secondary" icon={Sparkles} className="flex-1" loading={expanding} onClick={expand}>
            Expand with AI
          </Button>
        </>
      }
    >
      <div className="flex h-full min-h-[220px] flex-col">
        <div className="flex flex-none gap-1 overflow-x-auto px-4 pb-2 sm:px-5" role="tablist" aria-label="Map level">
          {MAP_LEVELS.map((lv, i) => {
            const enabled = i === 0 || !!path[i - 1];
            return (
              <button
                key={lv}
                role="tab"
                aria-selected={i === levelIndex}
                disabled={!enabled}
                onClick={() => goLevel(i)}
                className={cx(
                  'pressable h-8 flex-none rounded-md px-3 text-xs font-medium',
                  i === levelIndex ? 'bg-accent-soft text-accent-text' : enabled ? 'text-fg-2 hover:bg-surface-2 hover:text-fg' : 'text-fg-3 opacity-50',
                )}
              >
                {LEVEL_LABEL[lv]}
              </button>
            );
          })}
          <span className="flex-1" />
          <button
            aria-pressed={showVisited}
            onClick={() => setShowVisited((v) => !v)}
            className={cx('pressable flex h-8 flex-none items-center gap-1.5 rounded-md px-3 text-xs font-medium', showVisited ? 'bg-accent-soft text-accent-text' : 'text-fg-2 hover:bg-surface-2 hover:text-fg')}
          >
            <Icon icon={Footprints} size={14} />
            Visited
          </button>
        </div>
        <MapCanvas
          scene={scene}
          view={view}
          setView={(v) => {
            stopAnim.current?.();
            touched.current = true;
            setView(clampView(v));
          }}
          onMeasure={() => !touched.current && frame()}
          placing={placing}
          showVisited={showVisited}
          selected={selected}
          onNode={(n) => {
            setSelected(n.id);
            flyTo(focusView(n.x, n.y, Math.max(viewRef.current.k, 1.6)));
          }}
          onPlace={(pt) => {
            setPlacing(false);
            setPlaceAt(pt);
          }}
          onZoom={(d) => {
            const v = viewRef.current;
            const k = Math.min(MAX_K, Math.max(minK(), v.k * d));
            const cx0 = (500 - v.x) / v.k;
            const cy0 = (500 - v.y) / v.k;
            flyTo(focusView(cx0, cy0, k));
          }}
          onRecenter={() => {
            const here = scene.nodes.find((n) => n.current || n.containsCurrent);
            if (here) flyTo(focusView(here.x, here.y, Math.max(2, viewRef.current.k)));
            else if (s.currentLocationId) {
              // The player is elsewhere: jump to their level.
              setParentId(s.locations[s.currentLocationId]?.parentId ?? null);
            } else flyTo({ x: 0, y: 0, k: 1 });
          }}
        />
      </div>

      <NodeSheet
        loc={selectedNode}
        state={s}
        onClose={() => setSelected(null)}
        onEnter={(id) => {
          setSelected(null);
          setParentId(id);
        }}
        onTravel={async (loc, mode) => {
          const r = await apply({ type: 'travel', to: loc.id, mode } as Op);
          if (r) {
            setSelected(null);
            const n = scene.nodes.find((x) => x.id === loc.id);
            if (n) flyTo(focusView(n.x, n.y, Math.max(viewRef.current.k, 1.6)));
          }
        }}
      />

      <JourneySheet
        open={journeys}
        onOpenChange={setJourneys}
        onShow={(loc) => {
          setJourneys(false);
          setParentId(loc.parentId ?? null);
          setSelected(loc.id);
        }}
      />

      <PlaceDialog
        at={placeAt}
        state={s}
        parent={parent}
        level={scene.level}
        onClose={() => setPlaceAt(null)}
        onDone={async (op) => {
          const r = await apply(op);
          if (r) setPlaceAt(null);
        }}
      />
    </ToolSheet>
  );
}

// ------------------------------------------------------------------ canvas

function MapCanvas({
  scene,
  view,
  setView,
  placing,
  showVisited,
  selected,
  onNode,
  onPlace,
  onZoom,
  onRecenter,
  onMeasure,
}: {
  onMeasure: () => void;
  showVisited?: boolean;
  scene: MapScene;
  view: View;
  setView: (v: View) => void;
  placing: boolean;
  selected: string | null;
  onNode: (n: MapNode) => void;
  onPlace: (pt: { x: number; y: number }) => void;
  onZoom: (factor: number) => void;
  onRecenter: () => void;
}) {
  const box = useRef<HTMLDivElement>(null);
  const pointers = useRef(new Map<number, { x: number; y: number }>());
  const gesture = useRef<{ start: View; ax: number; ay: number; dist: number; moved: boolean } | null>(null);
  const moved = useRef(false);
  const viewRef = useRef(view);
  viewRef.current = view;
  const [px, setPx] = useState(0.4);
  // Layout effect: measured before the parent frames the scene (child effects run first).
  useLayoutEffect(() => {
    const el = box.current;
    if (!el) return;
    const measure = () => {
      const r = el.getBoundingClientRect();
      if (!r.width || !r.height) return;
      const scale = Math.max(r.width, r.height) / 1000;
      const changed = Math.abs(vis.w - r.width / scale) > 1 || Math.abs(vis.h - r.height / scale) > 1;
      vis.w = r.width / scale;
      vis.h = r.height / scale;
      setPx(scale);
      if (changed) onMeasure();
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  /** Pixels → map units (viewBox is 1000×1000 with "slice": it covers the canvas). */
  const metrics = () => {
    const r = box.current!.getBoundingClientRect();
    const s = Math.max(r.width, r.height) / 1000;
    return { r, s, ox: (r.width - 1000 * s) / 2, oy: (r.height - 1000 * s) / 2 };
  };
  const toMap = (clientX: number, clientY: number, v = viewRef.current) => {
    const { r, s, ox, oy } = metrics();
    const vx = (clientX - r.left - ox) / s;
    const vy = (clientY - r.top - oy) / s;
    return { x: (vx - v.x) / v.k, y: (vy - v.y) / v.k, vx, vy };
  };

  const begin = () => {
    const pts = [...pointers.current.values()];
    const { s } = metrics();
    if (pts.length === 1) gesture.current = { start: viewRef.current, ax: pts[0].x, ay: pts[0].y, dist: 0, moved: gesture.current?.moved ?? false };
    else if (pts.length >= 2) {
      const [a, b] = pts;
      gesture.current = { start: viewRef.current, ax: (a.x + b.x) / 2, ay: (a.y + b.y) / 2, dist: Math.hypot(a.x - b.x, a.y - b.y) / s, moved: true };
    }
  };

  const onDown = (e: RPointerEvent) => {
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pointers.current.size === 1) moved.current = false;
    begin();
    const move = (ev: PointerEvent) => {
      if (!pointers.current.has(ev.pointerId)) return;
      pointers.current.set(ev.pointerId, { x: ev.clientX, y: ev.clientY });
      const g = gesture.current;
      if (!g) return;
      const { s } = metrics();
      const pts = [...pointers.current.values()];
      if (pts.length === 1) {
        const dx = (pts[0].x - g.ax) / s;
        const dy = (pts[0].y - g.ay) / s;
        if (Math.hypot(dx * s, dy * s) > 6) moved.current = true;
        if (moved.current) setView({ ...g.start, x: g.start.x + dx, y: g.start.y + dy });
      } else {
        const [a, b] = pts;
        moved.current = true;
        const dist = Math.hypot(a.x - b.x, a.y - b.y) / s;
        const k = Math.min(MAX_K, Math.max(minK(), (g.start.k * dist) / Math.max(1, g.dist)));
        // Keep the point under the fingers' midpoint fixed.
        const start = toMap(g.ax, g.ay, g.start);
        const mid = toMap((a.x + b.x) / 2, (a.y + b.y) / 2, g.start);
        setView({ k, x: mid.vx - start.x * k, y: mid.vy - start.y * k });
      }
    };
    const up = (ev: PointerEvent) => {
      pointers.current.delete(ev.pointerId);
      if (pointers.current.size) begin();
      else {
        gesture.current = null;
        window.removeEventListener('pointermove', move);
        window.removeEventListener('pointerup', up);
        window.removeEventListener('pointercancel', up);
      }
    };
    if (pointers.current.size === 1) {
      window.addEventListener('pointermove', move);
      window.addEventListener('pointerup', up);
      window.addEventListener('pointercancel', up);
    }
  };

  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const wheel = (e: WheelEvent) => {
      e.preventDefault();
      const v = viewRef.current;
      const k = Math.min(MAX_K, Math.max(minK(), v.k * Math.exp(-e.deltaY * 0.0015)));
      const p = toMap(e.clientX, e.clientY, v);
      setView({ k, x: p.vx - p.x * k, y: p.vy - p.y * k });
    };
    el.addEventListener('wheel', wheel, { passive: false });
    return () => el.removeEventListener('wheel', wheel);
  }); // eslint-disable-line react-hooks/exhaustive-deps

  // Pins and labels keep a constant on-screen size: 1 unit inside a pin group = 1 CSS pixel.
  const inv = 1 / (view.k * px);
  const labelSize = 12;

  return (
    <div
      ref={box}
      data-map-style={scene.style}
      className={cx('relative min-h-0 flex-1 touch-none select-none overflow-hidden', placing && 'cursor-crosshair')}
      style={{ background: BASE_FILL[scene.base] }}
      onPointerDown={onDown}
      onClick={(e) => {
        if (moved.current || !placing) return;
        const p = toMap(e.clientX, e.clientY);
        const c = (n: number) => Math.round(Math.max(10, Math.min(990, n)));
        onPlace({ x: c(p.x), y: c(p.y) });
      }}
      data-testid="map-canvas"
    >
      <svg viewBox="0 0 1000 1000" preserveAspectRatio="xMidYMid slice" className="absolute inset-0 h-full w-full" role="img" aria-label={`Map, ${LEVEL_LABEL[scene.level]} level`}>
        <defs>
          <pattern id="map-streets" width="50" height="50" patternUnits="userSpaceOnUse">
            <path d="M50 0H0V50" fill="none" stroke="var(--map-grid)" strokeWidth="1" />
          </pattern>
          <pattern id="map-hex" width="34.6" height="60" patternUnits="userSpaceOnUse" patternTransform="scale(0.8)">
            <path d="M17.3 0L34.6 10V30L17.3 40L0 30V10ZM17.3 40V60" fill="none" stroke="var(--map-grid)" strokeWidth="1" />
          </pattern>
        </defs>
        <g transform={`translate(${view.x} ${view.y}) scale(${view.k})`}>
          <rect x={-2000} y={-2000} width={5000} height={5000} fill={BASE_FILL[scene.base]} />
          {scene.terrain.map((t, i) => (t.d ? <path key={i} d={t.d} fill={TERRAIN_FILL[t.kind]} stroke={t.kind === 'room' ? 'var(--map-line)' : 'none'} strokeWidth={t.kind === 'room' ? 1.5 : 0} vectorEffect="non-scaling-stroke" fillRule="evenodd" /> : null))}
          {scene.grid !== 'none' ? <rect x={0} y={0} width={1000} height={1000} fill={`url(#map-${scene.grid === 'hex' ? 'hex' : 'streets'})`} pointerEvents="none" /> : null}
          {scene.roads.map((r, i) => (
            <path
              key={i}
              d={r.d}
              fill="none"
              stroke={r.kind === 'water' || r.kind === 'rail' ? 'var(--map-line)' : 'var(--map-road)'}
              strokeWidth={r.kind === 'corridor' ? 10 : r.kind === 'road' || r.kind === 'street' ? 3.5 : 2}
              strokeDasharray={r.kind === 'trail' ? '6 6' : r.kind === 'rail' ? '10 5' : r.kind === 'water' ? '2 6' : undefined}
              strokeLinecap="round"
              vectorEffect="non-scaling-stroke"
              opacity={r.kind === 'corridor' ? 0.45 : 0.9}
            />
          ))}
          {scene.nodes.map((n) => {
            const I = PIN_ICON[n.pin];
            const active = selected === n.id;
            const hot = n.current || n.containsCurrent;
            return (
              <g
                key={n.id}
                transform={`translate(${n.x} ${n.y}) scale(${inv})`}
                opacity={showVisited && !n.visited && !n.current && !n.containsCurrent ? 0.3 : 1}
                data-visited={n.visited || undefined}
                className="cursor-pointer"
                role="button"
                tabIndex={0}
                aria-label={n.discovered || n.current ? `${n.name}${n.current ? ', you are here' : n.containsCurrent ? ', you are inside' : ''}${showVisited && n.visited && !n.current ? ', visited' : ''}` : 'Unknown place, unexplored'}
                data-testid="map-node"
                onClick={(e) => {
                  // While placing, let the tap fall through to the canvas.
                  if (placing) return;
                  e.stopPropagation();
                  if (moved.current) return;
                  onNode(n);
                }}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    onNode(n);
                  }
                }}
              >
                <circle r={22} fill="transparent" />
                {hot ? <circle r={19} fill="var(--accent-soft)" /> : null}
                <circle
                  r={13}
                  fill={n.current ? 'var(--accent)' : 'var(--surface)'}
                  stroke={active ? 'var(--accent)' : n.discovered ? 'var(--map-line)' : 'var(--text-3)'}
                  strokeWidth={active ? 3 : 1.5}
                  strokeDasharray={n.discovered ? undefined : '3 3'}
                />
                {showVisited && n.visited && !n.current ? <circle cx={10} cy={-10} r={4.5} fill="var(--accent)" stroke="var(--surface)" strokeWidth={1.5} /> : null}
                <I x={-8} y={-8} width={16} height={16} strokeWidth={1.75} color={n.current ? 'var(--accent-fg)' : n.discovered ? 'var(--text)' : 'var(--text-3)'} aria-hidden="true" />
                <text
                  y={28}
                  textAnchor="middle"
                  fontSize={labelSize}
                  fontWeight={hot ? 600 : 500}
                  fill={n.discovered ? 'var(--text)' : 'var(--text-3)'}
                  stroke={BASE_FILL[scene.base]}
                  strokeWidth={3.5}
                  paintOrder="stroke"
                  strokeLinejoin="round"
                  style={{ fontFamily: 'var(--font-sans)' }}
                >
                  {n.discovered || n.current ? n.name : 'Unknown'}
                </text>
              </g>
            );
          })}
        </g>
      </svg>
      {!scene.nodes.length ? (
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center p-6">
          <p className="max-w-[260px] rounded-md bg-surface/95 px-4 py-3 text-center text-sm text-fg-2 shadow-2">Nothing charted here yet. Place a landmark or expand with AI.</p>
        </div>
      ) : null}
      <div className="absolute right-3 top-3 flex flex-col gap-1 rounded-md bg-surface p-0.5 shadow-2" onPointerDown={(e) => e.stopPropagation()}>
        <IconButton size="sm" icon={Plus} label="Zoom in" onClick={() => onZoom(1.5)} />
        <IconButton size="sm" icon={Minus} label="Zoom out" onClick={() => onZoom(1 / 1.5)} />
        <IconButton size="sm" icon={LocateFixed} label="Find me" onClick={onRecenter} />
      </div>
      <div className="absolute bottom-3 left-3" onPointerDown={(e) => e.stopPropagation()}>
        <Popover
          trigger={
            <Button size="sm" variant="secondary" icon={Info} className="shadow-2">
              Legend
            </Button>
          }
        >
          <ul className="flex flex-col gap-2 text-sm">
            {(Object.keys(PIN_LABEL) as PinKind[]).map((k) => (
              <li key={k} className="flex items-center gap-2.5">
                <Icon icon={PIN_ICON[k]} size={16} className={k === 'you' ? 'text-accent-text' : 'text-fg-2'} />
                {PIN_LABEL[k]}
              </li>
            ))}
            <li className="flex items-center gap-2.5 text-fg-2">
              <svg width="16" height="16" aria-hidden="true">
                <circle cx="8" cy="8" r="6" fill="none" stroke="currentColor" strokeDasharray="2 2" />
              </svg>
              Unexplored
            </li>
          </ul>
        </Popover>
      </div>
    </div>
  );
}

// ------------------------------------------------------------------ node sheet

function NodeSheet({ loc, state: s, onClose, onEnter, onTravel }: { loc: Location | null; state: CampaignState; onClose: () => void; onEnter: (id: string) => void; onTravel: (loc: Location, mode: string) => Promise<void> }) {
  const { apply } = useGame();
  const [mode, setMode] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [going, setGoing] = useState(false);
  const [routeTo, setRouteTo] = useState('');
  const [routeMode, setRouteMode] = useState<RouteMode>('road');
  const options: TravelOption[] = useMemo(() => (loc && loc.id !== s.currentLocationId ? travelOptions(s, s.currentLocationId, loc.id) : []), [loc, s]);
  const def = defaultTravelOption(options);
  const blocked = options.filter((o, i) => o.fix && options.findIndex((x) => x.reason === o.reason) === i);
  useEffect(() => {
    setMode(null);
    setEditing(false);
  }, [loc?.id]);
  if (!loc) return <Sheet open={false} onOpenChange={onClose} title="">{null}</Sheet>;
  const chosen = options.find((o) => o.mode === (mode ?? def?.mode));
  const here = loc.id === s.currentLocationId;
  const children = Object.values(s.locations).filter((l) => l.parentId === loc.id);
  const people = Object.values(s.npcs).filter((n) => n.locationId === loc.id && n.status === 'alive');
  const routes = Object.values(s.routes).filter((r) => r.from === loc.id || r.to === loc.id);
  const siblings = Object.values(s.locations).filter((l) => l.parentId === loc.parentId && l.id !== loc.id);
  const orgs = Object.values(s.orgs).filter((o) => o.mainLocationId === loc.id || o.influence.some((i) => i.locationId === loc.id));
  const cur = s.meta.currency;
  const known = loc.discovered || here;
  const nameOf = (l: Location | undefined) => (l ? (l.discovered || l.id === s.currentLocationId ? l.name : 'Unknown place') : 'Unknown place');

  return (
    <Sheet
      open
      onOpenChange={(o) => !o && onClose()}
      title={known ? loc.name : 'Unknown place'}
      description={known ? [loc.kind !== 'other' ? loc.kind[0].toUpperCase() + loc.kind.slice(1) : null, LEVEL_LABEL[loc.level]].filter(Boolean).join(' · ') : LEVEL_LABEL[loc.level]}
      headerActions={<IconButton icon={Pencil} label="Edit place" onClick={() => setEditing(true)} />}
      footer={
        <>
          <Button variant="secondary" icon={ChevronRight} className="flex-1" onClick={() => onEnter(loc.id)}>
            Enter
          </Button>
          {!here ? (
            <Button
              variant="primary"
              className="flex-1"
              disabled={!chosen?.available}
              loading={going}
              onClick={async () => {
                if (!chosen) return;
                setGoing(true);
                await onTravel(loc, chosen.mode);
                setGoing(false);
              }}
            >
              Travel here
            </Button>
          ) : null}
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <div className="flex flex-wrap gap-1.5">
          {here ? <Badge tone="accent">You are here</Badge> : loc.visited ? <Badge>Visited</Badge> : loc.discovered ? <Badge>Known</Badge> : <Badge tone="warning">Unexplored</Badge>}
          {loc.locked ? <Badge>Locked</Badge> : null}
          {children.length ? <Badge>{children.length} inside</Badge> : null}
        </div>
        {!known ? (
          <p className="text-sm text-fg-2">You haven’t been here yet. Travel there to find out what it is.</p>
        ) : loc.description ? (
          <p className="text-sm leading-6 text-fg">{loc.description}</p>
        ) : (
          <p className="text-sm text-fg-3">No description yet.</p>
        )}
        {known && loc.customs ? (
          <div>
            <h3 className="mb-1 text-xs font-semibold uppercase tracking-wide text-fg-3">Customs</h3>
            <p className="text-sm text-fg-2">{loc.customs}</p>
          </div>
        ) : null}

        {!here ? (
          <div>
            <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-fg-3">Getting there</h3>
            {blocked.length ? (
              <ul className="mb-2 flex flex-col gap-1.5" aria-label="What's in the way">
                {blocked.map((o) => (
                  <li key={o.reason} className="flex items-center gap-2 rounded-md bg-surface-2 px-3 py-2 text-xs">
                    <span className="min-w-0 flex-1">
                      <span className="block font-medium text-fg">{o.reason}</span>
                      <span className="block text-fg-2">{o.fix}</span>
                    </span>
                    {o.wait ? (
                      <Button size="sm" variant="secondary" icon={Clock} onClick={() => apply({ type: 'time.advance', minutes: o.wait } as Op)}>
                        Wait
                      </Button>
                    ) : null}
                  </li>
                ))}
              </ul>
            ) : null}
            {options.length ? (
              <div role="radiogroup" aria-label="Travel mode" className="flex flex-col gap-1">
                {options.map((o) => {
                  const on = chosen?.mode === o.mode;
                  return (
                    <button
                      key={o.mode}
                      role="radio"
                      aria-checked={on}
                      disabled={!o.available}
                      onClick={() => setMode(o.mode)}
                      className={cx('pressable flex min-h-12 items-center gap-3 rounded-md border px-3 py-2 text-left', on ? 'border-accent bg-accent-soft' : 'border-line hover:bg-surface-2', !o.available && 'opacity-50')}
                    >
                      <span className="min-w-0 flex-1">
                        <span className="block text-sm font-medium">{o.label}</span>
                        <span className="block text-xs text-fg-2">{o.available ? [fmtMinutes(o.minutes), fmtKm(o.km)].join(' · ') : o.reason}</span>
                      </span>
                      <span className="text-right text-xs tabular-nums text-fg-2">
                        {o.fare > 0 ? <span className="block">{cur.symbol ? `${cur.symbol}${o.fare}` : `${o.fare} ${cur.name}`}</span> : <span className="block">Free</span>}
                        {o.energy > 0 && s.trackers.energy ? <span className="block">−{o.energy} {s.trackers.energy.label}</span> : null}
                      </span>
                    </button>
                  );
                })}
              </div>
            ) : (
              <p className="text-sm text-fg-3">No way to get there from here.</p>
            )}
            {linesAt(s, s.currentLocationId).some((l) => l.stops.includes(loc.id)) ? (
              <div className="mt-3">
                <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-fg-3">Scheduled</h3>
                <RideList s={s} to={loc} />
              </div>
            ) : null}
          </div>
        ) : null}

        {known && people.length ? (
          <div>
            <h3 className="mb-1 text-xs font-semibold uppercase tracking-wide text-fg-3">People here</h3>
            <p className="text-sm text-fg-2">{people.map((p) => p.name).join(', ')}</p>
          </div>
        ) : null}
        {known && orgs.length ? (
          <div>
            <h3 className="mb-1 text-xs font-semibold uppercase tracking-wide text-fg-3">Organizations</h3>
            <p className="text-sm text-fg-2">{orgs.map((o) => o.name).join(', ')}</p>
          </div>
        ) : null}

        <div>
          <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-fg-3">Paths</h3>
          {routes.length ? (
            <ul className="mb-2 flex flex-col gap-1">
              {routes.map((r) => {
                const other = s.locations[r.from === loc.id ? r.to : r.from];
                return (
                  <li key={r.id} className="flex items-center gap-2 text-sm">
                    <Icon icon={Route} size={16} className="text-fg-3" />
                    <span className="flex-1">
                      {nameOf(other)} <span className="text-fg-3">· {r.mode}{r.minutes ? ` · ${fmtMinutes(r.minutes)}` : ''}</span>
                    </span>
                  </li>
                );
              })}
            </ul>
          ) : (
            <p className="mb-2 text-sm text-fg-3">Only ordinary roads and trails.</p>
          )}
          {siblings.length ? (
            <div className="flex gap-2">
              <Select aria-label="Path to" value={routeTo} onChange={(e) => setRouteTo(e.target.value)} className="min-w-0 flex-1">
                <option value="">Add a path to…</option>
                {siblings.map((l) => (
                  <option key={l.id} value={l.id}>
                    {nameOf(l)}
                  </option>
                ))}
              </Select>
              <Select aria-label="Path type" value={routeMode} onChange={(e) => setRouteMode(e.target.value as RouteMode)} className="w-28">
                {(['road', 'trail', 'rail', 'water', 'air', 'portal'] as RouteMode[]).map((m) => (
                  <option key={m} value={m}>
                    {m[0].toUpperCase() + m.slice(1)}
                  </option>
                ))}
              </Select>
              <IconButton
                icon={Plus}
                label="Add path"
                disabled={!routeTo}
                onClick={async () => {
                  if (await apply({ type: 'route.add', from: loc.id, to: routeTo, mode: routeMode } as Op)) setRouteTo('');
                }}
              />
            </div>
          ) : null}
        </div>
      </div>
      <EditPlace loc={editing ? loc : null} onClose={() => setEditing(false)} onRemoved={onClose} />
    </Sheet>
  );
}

function EditPlace({ loc, onClose, onRemoved }: { loc: Location | null; onClose: () => void; onRemoved: () => void }) {
  const { apply } = useGame();
  const [draft, setDraft] = useState<Pick<Location, 'name' | 'kind' | 'description' | 'customs' | 'discovered' | 'locked'> | null>(null);
  useEffect(() => {
    setDraft(loc ? { name: loc.name, kind: loc.kind, description: loc.description, customs: loc.customs, discovered: loc.discovered, locked: loc.locked } : null);
  }, [loc]);
  return (
    <Sheet
      open={!!loc && !!draft}
      onOpenChange={(o) => !o && onClose()}
      title="Edit place"
      size="md"
      footer={
        <>
          <IconButton
            icon={Trash2}
            label="Remove place"
            onClick={async () => {
              if (!loc) return;
              if (!(await confirm({ title: `Remove ${loc.name}?`, description: 'Places inside it move up one level. You can undo this from the change summary.', confirmLabel: 'Remove', danger: true }))) return;
              if (await apply({ type: 'location.remove', name: loc.id } as Op)) {
                onClose();
                onRemoved();
              }
            }}
          />
          <Button
            variant="primary"
            className="flex-1"
            disabled={!draft?.name.trim()}
            onClick={async () => {
              if (!loc || !draft) return;
              if (await apply({ type: 'location.set', id: loc.id, patch: { ...draft, name: draft.name.trim() } } as Op, { quiet: true })) onClose();
            }}
          >
            Save
          </Button>
        </>
      }
    >
      {draft ? (
        <div className="flex flex-col gap-4">
          <Field label="Name" htmlFor="pl-name">
            <Input id="pl-name" value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} maxLength={80} />
          </Field>
          <Field label="Kind" htmlFor="pl-kind">
            <Select id="pl-kind" value={draft.kind} onChange={(e) => setDraft({ ...draft, kind: e.target.value as LocationKind })}>
              {KINDS.map((k) => (
                <option key={k} value={k}>
                  {k[0].toUpperCase() + k.slice(1)}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Description" htmlFor="pl-desc">
            <Textarea id="pl-desc" value={draft.description} onChange={(e) => setDraft({ ...draft, description: e.target.value })} maxLength={2000} />
          </Field>
          <Field label="Customs and rules" htmlFor="pl-cust" hint="Local laws, etiquette, dress code — sent to the model while you're here.">
            <Textarea id="pl-cust" value={draft.customs} onChange={(e) => setDraft({ ...draft, customs: e.target.value })} maxLength={2000} />
          </Field>
          <ToggleRow label="Discovered" description="Unexplored places show as outlines until you visit." checked={draft.discovered} onChange={(v) => setDraft({ ...draft, discovered: v })} />
          <ToggleRow label="Locked" description="The model can't change a locked place." checked={draft.locked} onChange={(v) => setDraft({ ...draft, locked: v })} />
        </div>
      ) : null}
    </Sheet>
  );
}

function PlaceDialog({ at, state: s, parent, level, onClose, onDone }: { at: { x: number; y: number } | null; state: CampaignState; parent: Location | null; level: MapLevel; onClose: () => void; onDone: (op: Op) => void }) {
  const [name, setName] = useState('');
  const [kind, setKind] = useState<LocationKind>('landmark');
  const [desc, setDesc] = useState('');
  useEffect(() => {
    if (at) {
      setName('');
      setDesc('');
      setKind('landmark');
    }
  }, [at]);
  const clash = name.trim() && Object.values(s.locations).some((l) => l.name.toLowerCase() === name.trim().toLowerCase());
  return (
    <Dialog
      open={!!at}
      onOpenChange={(o) => !o && onClose()}
      title="Place a landmark"
      description={parent ? `Inside ${parent.name}` : 'On the world map'}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button
            variant="primary"
            disabled={!name.trim() || !!clash}
            onClick={() => at && onDone({ type: 'location.upsert', name: name.trim(), parent: parent?.id ?? null, level, kind, description: desc.trim() || undefined, x: at.x, y: at.y, discovered: true } as Op)}
          >
            Place
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-3">
        <Field label="Name" htmlFor="lm-name" error={clash ? 'A place with this name already exists' : null}>
          <Input id="lm-name" value={name} onChange={(e) => setName(e.target.value)} maxLength={80} autoFocus />
        </Field>
        <Field label="Kind" htmlFor="lm-kind">
          <Select id="lm-kind" value={kind} onChange={(e) => setKind(e.target.value as LocationKind)}>
            {KINDS.map((k) => (
              <option key={k} value={k}>
                {k[0].toUpperCase() + k.slice(1)}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Description" htmlFor="lm-desc">
          <Input id="lm-desc" value={desc} onChange={(e) => setDesc(e.target.value)} maxLength={500} />
        </Field>
      </div>
    </Dialog>
  );
}
