/** Everloom mark: a single thread looping through itself. */
export function Logo({ size = 28, className }: { size?: number; className?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" fill="none" className={className} aria-hidden="true">
      <rect width="32" height="32" rx="8" fill="var(--text)" />
      <path d="M9 20.5c0-5 3.2-9 7-9s7 4 7 9M9 11.5c0 5 3.2 9 7 9s7-4 7-9" stroke="var(--accent)" strokeWidth="2" strokeLinecap="round" />
    </svg>
  );
}
