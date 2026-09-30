import { ArrowLeft, Bot, BookOpen, Brush, Code, Database, Gamepad2, Image, Info, KeyRound, MessageSquare, Plug, ScrollText, Users, Volume2, Stethoscope } from 'lucide-react';
import { lazy, Suspense } from 'react';
import { NavLink, useLocation, useNavigate, useParams } from 'react-router';
import { Page } from '@/app/Shell';
import { cx } from '@/lib/format';
import { Icon, IconButton, Spinner, useDesktop } from '@/ui';

const ConnectionsSection = lazy(() => import('./sections/Connections'));
const PromptsSection = lazy(() => import('./sections/Prompts'));
const GameSection = lazy(() => import('./sections/Game'));
const LoreSection = lazy(() => import('./sections/Lore'));
const AppearanceSection = lazy(() => import('./sections/Appearance'));
const CustomCssSection = lazy(() => import('./sections/CustomCss'));
const CharactersSection = lazy(() => import('./sections/Characters'));
const ChatSection = lazy(() => import('./sections/ChatSettings'));
const VoiceSection = lazy(() => import('./sections/Voice'));
const ImagesSection = lazy(() => import('./sections/Images'));
const DataSection = lazy(() => import('./sections/Data'));
const AccountSection = lazy(() => import('./sections/Account'));
const AboutSection = lazy(() => import('./sections/About'));
const DiagnosticsSection = lazy(() => import('./sections/Diagnostics'));

export const SECTIONS = [
  { id: 'connections', label: 'Connections', icon: Plug, el: ConnectionsSection },
  { id: 'prompts', label: 'Prompts & presets', icon: ScrollText, el: PromptsSection },
  { id: 'chat', label: 'Chat', icon: MessageSquare, el: ChatSection },
  { id: 'game', label: 'Game & trackers', icon: Gamepad2, el: GameSection },
  { id: 'characters', label: 'Characters', icon: Users, el: CharactersSection },
  { id: 'lore', label: 'World info', icon: BookOpen, el: LoreSection },
  { id: 'appearance', label: 'Appearance', icon: Brush, el: AppearanceSection },
  { id: 'css', label: 'Custom CSS', icon: Code, el: CustomCssSection },
  { id: 'voice', label: 'Voice', icon: Volume2, el: VoiceSection },
  { id: 'images', label: 'Images', icon: Image, el: ImagesSection },
  { id: 'data', label: 'Backups & import', icon: Database, el: DataSection },
  { id: 'account', label: 'Account & security', icon: KeyRound, el: AccountSection },
  { id: 'diagnostics', label: 'Diagnostics', icon: Stethoscope, el: DiagnosticsSection },
  { id: 'about', label: 'About', icon: Info, el: AboutSection },
];

export default function SettingsPage() {
  const params = useParams();
  const section = (params['*'] ?? '').split('/')[0];
  const desktop = useDesktop();
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const active = SECTIONS.find((s) => s.id === section) ?? (desktop ? SECTIONS[0] : null);

  if (!desktop && !active) {
    return (
      <Page narrow title="Settings">
        <nav className="flex flex-col">
          {SECTIONS.map((s) => (
            <NavLink key={s.id} to={`/settings/${s.id}`} className="pressable -mx-2 flex min-h-12 items-center gap-3 rounded-md px-2 text-base hover:bg-surface-2">
              <Icon icon={s.icon} className="text-fg-2" />
              {s.label}
            </NavLink>
          ))}
        </nav>
      </Page>
    );
  }
  const Section = active!.el;
  return (
    <Page narrow={!desktop} title={desktop ? 'Settings' : active!.label} back={!desktop ? <IconButton icon={ArrowLeft} label="All settings" onClick={() => navigate('/settings')} /> : undefined}>
      <div className={cx(desktop && 'grid grid-cols-[220px_1fr] gap-8')}>
        {desktop ? (
          <nav className="sticky top-[72px] flex h-fit flex-col gap-0.5">
            {SECTIONS.map((s) => (
              <NavLink key={s.id} to={`/settings/${s.id}`} className={cx('pressable flex h-9 items-center gap-2.5 rounded-md px-2.5 text-sm', active!.id === s.id ? 'bg-surface-2 font-medium text-fg' : 'text-fg-2 hover:bg-surface-2 hover:text-fg')}>
                <Icon icon={s.icon} size={18} />
                {s.label}
              </NavLink>
            ))}
          </nav>
        ) : null}
        <div className="min-w-0 max-w-[680px]" key={pathname}>
          <Suspense fallback={<Spinner />}>
            <Section />
          </Suspense>
        </div>
      </div>
    </Page>
  );
}

export { Bot };
