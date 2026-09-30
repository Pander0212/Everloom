import type { CampaignDTO, ChatDTO, Op } from '@everloom/engine';
import { lazy, Suspense, useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import { useNavigate } from 'react-router';
import { Archive, HelpCircle, Settings } from 'lucide-react';
import { Sheet, Spinner } from '@/ui';
import { CommandMenu, TOOL_META, type Command } from './CommandMenu';
import { applyOps, GameContext, type GameCtx, type ToolId } from './context';
import { Hud } from './Hud';

const TOOLS: Partial<Record<ToolId, React.LazyExoticComponent<(p: { arg?: string }) => ReactNode>>> = {
  status: lazy(() => import('./tools/Status')),
  inventory: lazy(() => import('./tools/Inventory')),
  npcs: lazy(() => import('./tools/Npcs')),
  journal: lazy(() => import('./tools/Journal')),
  databank: lazy(() => import('./tools/Databank')),
  calendar: lazy(() => import('./tools/Calendar')),
  log: lazy(() => import('./tools/WorldLog')),
  map: lazy(() => import('./tools/MapTool')),
  orgs: lazy(() => import('./tools/Orgs')),
  social: lazy(() => import('./tools/Social')),
  persona: lazy(() => import('./tools/PersonaTool')),
  characters: lazy(() => import('./tools/CharactersTool')),
  newgame: lazy(() => import('./tools/NewGame')),
  activities: lazy(() => import('./tools/Activities')),
  party: lazy(() => import('./tools/Party')),
  battle: lazy(() => import('./tools/Battle')),
  diary: lazy(() => import('./tools/Diary')),
  phone: lazy(() => import('./tools/Phone')),
  atmosphere: lazy(() => import('./tools/AtmosphereTool')),
  helper: lazy(() => import('./tools/Helper')),
  help: lazy(() => import('./tools/Help')),
  money: lazy(() => import('./tools/Money')),
  shop: lazy(() => import('./tools/Shop')),
  home: lazy(() => import('./tools/Home')),
  crafting: lazy(() => import('./tools/Crafting')),
  trade: lazy(() => import('./tools/Trade')),
};

export interface GameLayerProps {
  chat: ChatDTO;
  campaign: CampaignDTO | null;
  busy: boolean;
  onRun: (type: 'normal' | 'continue', text?: string) => Promise<unknown>;
  setComposer: (v: string) => void;
  menuOpen: boolean;
  setMenuOpen: (o: boolean) => void;
  quick: Command[];
  children: ReactNode;
}

export function GameLayer({ chat, campaign, busy, onRun, setComposer, menuOpen, setMenuOpen, quick, children }: GameLayerProps) {
  const [tool, setTool] = useState<{ id: ToolId; arg?: string } | null>(null);
  const navigate = useNavigate();
  const open = useCallback((id: ToolId, arg?: string) => setTool({ id, arg }), []);
  const close = useCallback(() => setTool(null), []);
  const state = campaign?.state ?? null;
  const ctx: GameCtx = useMemo(
    () => ({
      chat,
      campaign,
      state,
      busy,
      open,
      close,
      apply: (ops: Op[] | Op, opts?: { quiet?: boolean }) => applyOps(chat, Array.isArray(ops) ? ops : [ops], opts?.quiet),
      run: onRun,
      setComposer,
    }),
    [chat, campaign, state, busy, open, close, onRun, setComposer],
  );

  useEffect(() => {
    const onTool = (e: Event) => open((e as CustomEvent).detail as ToolId);
    document.addEventListener('everloom:tool', onTool);
    return () => document.removeEventListener('everloom:tool', onTool);
  }, [open]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setMenuOpen(true);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [setMenuOpen]);

  const unread = state ? Object.values(state.phone.unread).reduce((a, b) => a + b, 0) : 0;
  const commands: Command[] = useMemo(() => {
    const tools: Command[] = state
      ? (Object.entries(TOOL_META) as Array<[ToolId, (typeof TOOL_META)[keyof typeof TOOL_META]]>).map(([id, m]) => ({
          id,
          label: m.label,
          icon: m.icon,
          group: m.group,
          keywords: m.keywords,
          badge: id === 'phone' && unread ? unread : id === 'battle' && state.battle?.status === 'active' ? '!' : undefined,
          run: () => open(id),
        }))
      : [];
    const system: Command[] = [
      { id: 'settings', label: 'Settings', icon: Settings, group: 'System', keywords: 'preferences', run: () => navigate('/settings') },
      { id: 'help', label: 'Help', icon: HelpCircle, group: 'System', keywords: 'how guide', run: () => open('help' as ToolId) },
      { id: 'backups', label: 'Backups', icon: Archive, group: 'System', keywords: 'export save restore', run: () => navigate('/settings/data') },
    ];
    return [...quick, ...tools, ...system];
  }, [quick, state, unread, open, navigate]);

  const Tool = tool ? TOOLS[tool.id] : null;
  return (
    <GameContext.Provider value={ctx}>
      <div className="relative flex min-h-0 flex-1 flex-col">
        <Hud />
        {children}
      </div>
      <CommandMenu open={menuOpen} onOpenChange={setMenuOpen} commands={commands} />
      {tool && Tool ? (
        <Suspense
          fallback={
            <Sheet open onOpenChange={close} title={TOOL_META[tool.id as keyof typeof TOOL_META]?.label ?? ''}>
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
