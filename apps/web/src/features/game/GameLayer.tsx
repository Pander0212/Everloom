import type { CampaignDTO, ChatDTO, Op } from "@everloom/engine";
import {
  lazy,
  Suspense,
  useCallback,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { Sheet, Spinner } from "@/ui";
import { Palette, type PaletteItem } from "@/features/palette/Palette";
import { usePaletteWiring } from "@/features/palette/wiring";
import { entryForTool, type Entry } from "@/lib/registry";
import { applyOps, GameContext, type GameCtx, type ToolId } from "./context";
import { FeaturesContext } from "@/lib/features";
import { presetFeatures, type FeatureId } from "@everloom/engine";
import { useContext } from "react";
const Hud = lazy(() => import("./Hud").then((m) => ({ default: m.Hud })));
const LevelUpMoment = lazy(() =>
  import("./LevelUp").then((m) => ({ default: m.LevelUpMoment })),
);
const AudioDirector = lazy(() =>
  import("./AudioDirector").then((m) => ({ default: m.AudioDirector })),
);
const StageFxLayer = lazy(() =>
  import("./StageFx").then((m) => ({ default: m.StageFxLayer })),
);
const CutscenePlayer = lazy(() =>
  import("./StageFx").then((m) => ({ default: m.CutscenePlayer })),
);

/** Which module each tool belongs to: a tool whose module is off isn't offered (or downloaded). */
const TOOL_FEATURE: Partial<Record<ToolId, FeatureId>> = {
  journal: "journal",
  diary: "diary",
  map: "map",
  orgs: "orgs",
  activities: "time",
  battle: "battle",
  persona: "game",
  inventory: "inventory",
  money: "inventory",
  home: "home",
  crafting: "crafting",
  shop: "inventory",
  trade: "inventory",
  stage: "stage",
  characters: "game",
  party: "party",
  social: "npcs",
  databank: "databank",
  phone: "phone",
  npcs: "npcs",
  calendar: "time",
  atmosphere: "weather",
  helper: "helper",
};

const TOOLS: Partial<
  Record<ToolId, React.LazyExoticComponent<(p: { arg?: string }) => ReactNode>>
> = {
  status: lazy(() => import("./tools/Status")),
  inventory: lazy(() => import("./tools/Inventory")),
  npcs: lazy(() => import("./tools/Npcs")),
  journal: lazy(() => import("./tools/Journal")),
  databank: lazy(() => import("./tools/Databank")),
  calendar: lazy(() => import("./tools/Calendar")),
  log: lazy(() => import("./tools/WorldLog")),
  map: lazy(() => import("./tools/MapTool")),
  orgs: lazy(() => import("./tools/Orgs")),
  social: lazy(() => import("./tools/Social")),
  persona: lazy(() => import("./tools/PersonaTool")),
  characters: lazy(() => import("./tools/CharactersTool")),
  newgame: lazy(() => import("./tools/NewGame")),
  activities: lazy(() => import("./tools/Activities")),
  party: lazy(() => import("./tools/Party")),
  battle: lazy(() => import("./tools/Battle")),
  diary: lazy(() => import("./tools/Diary")),
  phone: lazy(() => import("./tools/Phone")),
  atmosphere: lazy(() => import("./tools/AtmosphereTool")),
  helper: lazy(() => import("./tools/Helper")),
  help: lazy(() => import("./tools/Help")),
  money: lazy(() => import("./tools/Money")),
  shop: lazy(() => import("./tools/Shop")),
  home: lazy(() => import("./tools/Home")),
  crafting: lazy(() => import("./tools/Crafting")),
  trade: lazy(() => import("./tools/Trade")),
  stage: lazy(() => import("./tools/StageTool")),
};

export interface GameLayerProps {
  chat: ChatDTO;
  campaign: CampaignDTO | null;
  busy: boolean;
  onRun: (type: "normal" | "continue", text?: string) => Promise<unknown>;
  setComposer: (v: string) => void;
  menuOpen: boolean;
  setMenuOpen: (o: boolean) => void;
  /** Runs palette entries that aren't game tools (sheets, actions, pages). */
  onEntry: (e: Entry) => void;
  /** Extra palette rows (extension panels and screens). */
  extra: PaletteItem[];
  children: ReactNode;
}

export function GameLayer({
  chat,
  campaign,
  busy,
  onRun,
  setComposer,
  menuOpen,
  setMenuOpen,
  onEntry,
  extra,
  children,
}: GameLayerProps) {
  const [tool, setTool] = useState<{ id: ToolId; arg?: string } | null>(null);
  const open = useCallback(
    (id: ToolId, arg?: string) => setTool({ id, arg }),
    [],
  );
  const close = useCallback(() => setTool(null), []);
  const state = campaign?.state ?? null;
  const features = useContext(FeaturesContext) ?? presetFeatures("full");
  const ctx: GameCtx = useMemo(
    () => ({
      chat,
      campaign,
      state,
      busy,
      open,
      close,
      toolId: tool?.id ?? null,
      apply: (ops: Op[] | Op, opts?: { quiet?: boolean }) =>
        applyOps(chat, Array.isArray(ops) ? ops : [ops], opts?.quiet),
      run: onRun,
      setComposer,
    }),
    [chat, campaign, state, busy, open, close, onRun, setComposer, tool?.id],
  );

  useEffect(() => {
    const onTool = (e: Event) => open((e as CustomEvent).detail as ToolId);
    document.addEventListener("everloom:tool", onTool);
    return () => document.removeEventListener("everloom:tool", onTool);
  }, [open]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setMenuOpen(true);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [setMenuOpen]);

  const unread = state
    ? Object.values(state.phone.unread).reduce((a, b) => a + b, 0)
    : 0;
  const wiring = usePaletteWiring(features);
  const scope = useMemo(
    () => ({ features, chat: true, game: !!state, experimental: wiring.experimental }),
    [features, state, wiring.experimental],
  );
  const badges = useMemo(
    () => ({
      phone: unread || undefined,
      battle: state?.battle?.status === "active" ? "!" : undefined,
    }),
    [unread, state?.battle?.status],
  );
  const runEntry = useCallback(
    (e: Entry) => {
      if (e.target.kind === "tool") open(e.target.tool as ToolId, e.target.arg);
      else onEntry(e);
    },
    [open, onEntry],
  );

  // A tool for a module that is off can't be opened, even from a link or an event.
  const allowed =
    !tool ||
    !TOOL_FEATURE[tool.id] ||
    features.on[TOOL_FEATURE[tool.id]!];
  const Tool = tool && allowed ? TOOLS[tool.id] : null;
  return (
    <GameContext.Provider value={ctx}>
      <div className="relative flex min-h-0 flex-1 flex-col">
        {features.on.trackers ? (
          <Suspense fallback={null}>
            <Hud />
          </Suspense>
        ) : null}
        {children}
      </div>
      <Suspense fallback={null}>
        {features.on.party ? <LevelUpMoment /> : null}
        {state ? (
          <>
            {features.on.effects ? <StageFxLayer /> : null}
            {features.on.cutscenes ? <CutscenePlayer /> : null}
            {features.on.music || features.on.ambience ? (
              <AudioDirector />
            ) : null}
          </>
        ) : null}
      </Suspense>
      <Palette
        open={menuOpen}
        onOpenChange={setMenuOpen}
        scope={scope}
        onEntry={runEntry}
        extra={extra}
        badges={badges}
        pins={wiring.pins}
        onPins={wiring.onPins}
        onFeature={wiring.onFeature}
        onSettings={wiring.onSettings}
        campaign={campaign}
        characters={wiring.characters}
        onCharacter={wiring.onCharacter}
        onPlace={(id) => open("map", id)}
        onItem={(id) => open("inventory", id)}
        onPerson={(id) => open("npcs", id)}
      />
      {tool && Tool ? (
        <Suspense
          fallback={
            <Sheet
              open
              onOpenChange={close}
              title={entryForTool(tool.id)?.label ?? ""}
            >
              <div className="flex justify-center py-10">
                <Spinner />
              </div>
            </Sheet>
          }
        >
          <Tool arg={tool.arg} />
        </Suspense>
      ) : null}
    </GameContext.Provider>
  );
}
