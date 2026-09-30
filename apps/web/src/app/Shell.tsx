import { BookOpen, MessagesSquare, Settings, UserRound, Users } from 'lucide-react';
import { AnimatePresence, motion } from 'motion/react';
import { NavLink, Outlet, useLocation } from 'react-router';
import { Suspense } from 'react';
import { cx } from '@/lib/format';
import { t } from '@/lib/motion';
import { useUi } from '@/lib/store';
import { Icon, Spinner } from '@/ui';
import { Logo } from './Logo';

export const NAV = [
  { to: '/', label: 'Chats', icon: MessagesSquare, end: true },
  { to: '/characters', label: 'Characters', icon: Users },
  { to: '/personas', label: 'Personas', icon: UserRound },
  { to: '/lore', label: 'Lore', icon: BookOpen },
  { to: '/settings', label: 'Settings', icon: Settings },
];

export function ConnectionBanner() {
  const c = useUi((s) => s.connection);
  return (
    <AnimatePresence>
      {c !== 'online' ? (
        <motion.div
          initial={{ y: -40 }}
          animate={{ y: 0 }}
          exit={{ y: -40 }}
          transition={t.base}
          className="fixed inset-x-0 top-0 z-[95] flex items-center justify-center gap-2 bg-surface-3 pb-1.5 pt-[calc(var(--safe-top)+6px)] text-xs font-medium text-fg-2"
          role="status"
        >
          <span className="spinner" style={{ width: 12, height: 12, borderWidth: 1.5 }} />
          {c === 'offline' ? 'Offline — changes will sync when you are back' : 'Reconnecting…'}
        </motion.div>
      ) : null}
    </AnimatePresence>
  );
}

function useActive(to: string, end?: boolean) {
  const { pathname } = useLocation();
  return end ? pathname === to : pathname === to || pathname.startsWith(`${to}/`);
}

function SideItem({ item }: { item: (typeof NAV)[number] }) {
  const active = useActive(item.to, item.end);
  return (
    <NavLink to={item.to} end={item.end} className={cx('pressable relative flex h-10 items-center gap-3 rounded-md px-3 text-sm font-medium', active ? 'text-fg' : 'text-fg-2 hover:bg-surface-2 hover:text-fg')}>
      {active ? <motion.span layoutId="side-active" className="absolute inset-0 rounded-md bg-surface-2" transition={t.indicator} /> : null}
      <Icon icon={item.icon} className="relative" />
      <span className="relative">{item.label}</span>
    </NavLink>
  );
}

function TabItem({ item }: { item: (typeof NAV)[number] }) {
  const active = useActive(item.to, item.end);
  return (
    <NavLink to={item.to} end={item.end} className={cx('pressable relative flex flex-1 flex-col items-center justify-center gap-0.5 pt-1 text-xs font-medium', active ? 'text-fg' : 'text-fg-3')}>
      {active ? <motion.span layoutId="tab-active" className="absolute top-0 h-0.5 w-8 rounded-full bg-accent" transition={t.indicator} /> : null}
      <Icon icon={item.icon} size={22} />
      {item.label}
    </NavLink>
  );
}

export function Shell() {
  return (
    <div className="flex h-full">
      <aside className="ev-sidebar hidden w-[232px] flex-none flex-col border-r border-line px-3 py-4 md:flex">
        <div className="flex items-center gap-2.5 px-3 pb-5">
          <Logo size={26} />
          <span className="text-base font-semibold tracking-tight">Everloom</span>
        </div>
        <nav className="flex flex-col gap-0.5">
          {NAV.map((n) => (
            <SideItem key={n.to} item={n} />
          ))}
        </nav>
      </aside>
      <div className="flex min-w-0 flex-1 flex-col">
        <main className="min-h-0 flex-1 overflow-y-auto pb-[calc(var(--tabbar-h)+var(--safe-bottom))] md:pb-0">
          <Suspense
            fallback={
              <div className="flex h-[40vh] items-center justify-center">
                <Spinner />
              </div>
            }
          >
            <Outlet />
          </Suspense>
        </main>
        <nav className="ev-tabbar fixed inset-x-0 bottom-0 z-30 flex h-[calc(var(--tabbar-h)+var(--safe-bottom))] bg-bg pb-[var(--safe-bottom)] hairline-t md:hidden">
          {NAV.map((n) => (
            <TabItem key={n.to} item={n} />
          ))}
        </nav>
      </div>
    </div>
  );
}

/** Page scaffold: sticky left-aligned header with actions, readable width. */
export function Page({ title, actions, children, narrow, back }: { title: React.ReactNode; actions?: React.ReactNode; children: React.ReactNode; narrow?: boolean; back?: React.ReactNode }) {
  return (
    <div className={cx('mx-auto w-full px-4 sm:px-6', narrow ? 'max-w-[720px]' : 'max-w-[1080px]')}>
      <header className="ev-page-header sticky top-0 z-20 -mx-4 flex min-h-[60px] items-center gap-2 bg-bg px-4 pt-[var(--safe-top)] sm:-mx-6 sm:px-6">
        {back}
        <h1 className="min-w-0 flex-1 truncate text-lg font-semibold tracking-tight md:text-xl">{title}</h1>
        {actions}
      </header>
      <div className="pb-8">{children}</div>
    </div>
  );
}
