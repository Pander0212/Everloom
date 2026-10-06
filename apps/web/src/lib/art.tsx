/**
 * Everloom's bundled illustrations (apps/web/public/art). Every one is optional: with
 * Settings › Appearance › Illustrations off, or if a file is missing, nothing is drawn and the
 * screen looks as it did without art.
 */
import { useState, type ReactNode } from 'react';
import { useSettings } from './queries';

export function useArtEnabled(): boolean {
  const s = useSettings();
  return s.data?.art?.enabled !== false;
}

/** A bundled picture: AVIF where the browser has it, WebP otherwise; lazy, with fixed proportions. */
export function ArtPicture({ src, alt = '', avif = true, className, imgClassName, width, height, eager, fallback = null }: { src: string; alt?: string; avif?: boolean; className?: string; imgClassName?: string; width: number; height: number; eager?: boolean; fallback?: ReactNode }) {
  const on = useArtEnabled();
  const [failed, setFailed] = useState(false);
  if (!on || failed) return <>{fallback}</>;
  return (
    <picture className={className}>
      {avif ? <source srcSet={`/art/${src}.avif`} type="image/avif" /> : null}
      <img src={`/art/${src}.webp`} alt={alt} width={width} height={height} loading={eager ? 'eager' : 'lazy'} decoding="async" onError={() => setFailed(true)} className={imgClassName} />
    </picture>
  );
}
