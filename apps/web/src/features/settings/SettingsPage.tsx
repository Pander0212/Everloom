import { ArrowLeft, Bot, Search } from 'lucide-react';
import { SETTINGS_GROUPS, SETTINGS_PAGES } from '@/lib/registry';
import { useSettings } from '@/lib/queries';
import { useSettingsPatch } from './common';
import { lazy, Suspense } from 'react';
import type { FeatureId } from '@everloom/engine';
import { useFeatures } from '@/lib/features';
import { NavLink, useLocation, useNavigate, useParams } from 'react-router';
import { Page } from '@/app/Shell';
import { cx } from '@/lib/format';
import { HelpToggle, Icon, IconButton, Segmented, Spinner, useDesktop } from '@/ui';

const ConnectionsSection = lazy(() => import('./sections/Connections'));
const PromptsSection = lazy(() => import('./sections/Prompts'));
const GameSection = lazy(() => import('./sections/Game'));
const LoreSection = lazy(() => import('./sections/Lore'));
const AppearanceSection = lazy(() => import('./sections/Appearance'));
const CustomCssSection = lazy(() => import('./sections/CustomCss'));
const CharactersSection = lazy(() => import('./sections/Characters'));
const SourcesSection = lazy(() => import('./sections/Sources'));
const FeaturesSection = lazy(() => import('./sections/Features'));
const PrivacySection = lazy(() => import('./sections/Privacy'));
const ChatSection = lazy(() => import('./sections/ChatSettings'));
const VoiceSection = lazy(() => import('./sections/Voice'));
const ImagesSection = lazy(() => import('./sections/Images'));
const DataSection = lazy(() => import('./sections/Data'));
const AccountSection = lazy(() => import('./sections/Account'));
const AboutSection = lazy(() => import('./sections/About'));
const DiagnosticsSection = lazy(() => import('./sections/Diagnostics'));
const ScriptsSection = lazy(() => import('./sections/Scripts'));
const ExtensionsSection = lazy(() => import('./sections/Extensions'));
const ThreeDSection = lazy(() => import('./sections/ThreeD'));
const PuppetsSection = lazy(() => import('./sections/Puppets'));

const ELEMENTS: Record<string, React.LazyExoticComponent<() => React.ReactNode>> = {
  connections: ConnectionsSection,
  features: FeaturesSection,
  prompts: PromptsSection,
  chat: ChatSection,
  game: GameSection,
  characters: CharactersSection,
  sources: SourcesSection,
  lore: LoreSection,
  appearance: AppearanceSection,
  css: CustomCssSection,
  scripts: ScriptsSection,
  extensions: ExtensionsSection,
  '3d': ThreeDSection,
  puppets: PuppetsSection,
  voice: VoiceSection,
  images: ImagesSection,
  data: DataSection,
  privacy: PrivacySection,
  account: AccountSection,
  diagnostics: DiagnosticsSection,
  about: AboutSection,
};

/** Every settings page (lib/registry: name, group, help); a page whose module is off isn't listed. */
export const SECTIONS = SETTINGS_PAGES.map((p) => ({ ...p, el: ELEMENTS[p.id]! }));

export default function SettingsPage() {
  const params = useParams();
  const section = (params['*'] ?? '').split('/')[0];
  const desktop = useDesktop();
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const features = useFeatures(null);
  const settings = useSettings();
  const { update } = useSettingsPatch();
  const sections = SECTIONS.filter((s) => !s.feature || features.on[s.feature]);
  const active = sections.find((s) => s.id === section) ?? (desktop ? sections[0] : null);

  const advanced = !!settings.data?.ui?.advanced;
  const listed = advanced ? sections : sections.filter((x) => x.simple || x.id === active?.id);
  const setAdvanced = (v: boolean) => void update({ ui: { advanced: v } as never });
  const viewSwitch = (
    <Segmented
      size="sm"
      label="Settings view"
      value={advanced ? 'advanced' : 'simple'}
      onChange={(v) => setAdvanced(v === 'advanced')}
      options={[
        { value: 'simple', label: 'Simple' },
        { value: 'advanced', label: 'Advanced' },
      ]}
    />
  );
  const nav = (compact: boolean) => (
    <nav className="flex flex-col gap-3" aria-label="Settings pages">
      {SETTINGS_GROUPS.map((g) => {
        const items = listed.filter((x) => x.group === g.id);
        if (!items.length) return null;
        return (
          <div key={g.id}>
            <h2 className={cx('px-2.5 pb-1 text-xs font-medium text-fg-3', !compact && 'px-0')}>{g.label}</h2>
            {items.map((x) =>
              compact ? (
                <NavLink key={x.id} to={`/settings/${x.id}`} className={cx('pressable flex h-9 items-center gap-2.5 rounded-md px-2.5 text-sm', active?.id === x.id ? 'bg-surface-2 font-medium text-fg' : 'text-fg-2 hover:bg-surface-2 hover:text-fg')}>
                  <Icon icon={x.icon} size={18} />
                  {x.label}
                </NavLink>
              ) : (
                <NavLink key={x.id} to={`/settings/${x.id}`} className="pressable -mx-2 flex min-h-14 items-center gap-3 rounded-md px-2 py-1.5 hover:bg-surface-2">
                  <Icon icon={x.icon} className="flex-none text-fg-2" />
                  <span className="min-w-0">
                    <span className="block text-base">{x.label}</span>
                    <span className="block truncate text-xs text-fg-2">{x.description}</span>
                  </span>
                </NavLink>
              ),
            )}
          </div>
        );
      })}
      {!advanced ? (
        <p className={cx('text-xs text-fg-2', compact ? 'px-2.5' : '')}>
          {sections.length - listed.length} more in{' '}
          <button className="font-medium text-accent-text underline-offset-2 hover:underline" onClick={() => setAdvanced(true)}>
            Advanced
          </button>
          .
        </p>
      ) : null}
    </nav>
  );

  if (!desktop && !active) {
    return (
      <Page narrow title="Settings" actions={viewSwitch}>
        <button onClick={() => document.dispatchEvent(new CustomEvent('everloom:palette'))} className="pressable mb-4 flex h-11 w-full items-center gap-2 rounded-md bg-surface-2 px-3 text-left text-sm text-fg-3">
          <Icon icon={Search} size={18} /> Search settings and tools
        </button>
        {nav(false)}
      </Page>
    );
  }
  const Section = active!.el;
  return (
    <Page narrow={!desktop} title={desktop ? 'Settings' : active!.label} back={!desktop ? <IconButton icon={ArrowLeft} label="All settings" onClick={() => navigate('/settings')} /> : undefined}>
      <div className={cx(desktop && 'grid grid-cols-[220px_1fr] gap-8')}>
        {desktop ? (
          <div className="sticky top-[72px] flex h-fit flex-col gap-3">
            {viewSwitch}
            {nav(true)}
          </div>
        ) : null}
        <div className="min-w-0 max-w-[680px]" key={pathname}>
          <p className="pt-2 text-sm text-fg-2">{active!.description}</p>
          <HelpToggle help={active!.help} className="pt-1.5" />
          <Suspense fallback={<Spinner />}>
            <Section />
          </Suspense>
        </div>
      </div>
    </Page>
  );
}

export { Bot };
