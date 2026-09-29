import * as S from '@radix-ui/react-slider';

export function Slider({ value, onChange, min = 0, max = 100, step = 1, label }: { value: number; onChange: (v: number) => void; min?: number; max?: number; step?: number; label: string }) {
  return (
    <S.Root className="relative flex h-8 w-full touch-none select-none items-center" value={[value]} min={min} max={max} step={step} onValueChange={(v) => onChange(v[0])} aria-label={label}>
      <S.Track className="relative h-1 grow overflow-hidden rounded-full bg-surface-3">
        <S.Range className="absolute h-full bg-accent" />
      </S.Track>
      <S.Thumb className="block h-5 w-5 rounded-full bg-white shadow-2 outline-none transition-transform focus-visible:shadow-[var(--focus)] active:scale-95" />
    </S.Root>
  );
}
