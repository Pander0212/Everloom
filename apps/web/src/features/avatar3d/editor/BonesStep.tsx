/** Step 2: which of the model's bones is which. Required bones first; fingers folded away. */
import { HUMANOID_BONES, REQUIRED_BONES, type AvatarConfig, type HumanBone } from '@everloom/engine';
import { RotateCcw } from 'lucide-react';
import { useMemo, useState } from 'react';
import type { AvatarDetail } from '@/features/avatars/api';
import { cx } from '@/lib/format';
import { Badge, Button, SectionTitle, Select } from '@/ui';
import type { PreviewHandle } from '../Preview3D';

const GROUPS: Array<{ label: string; bones: HumanBone[]; folded?: boolean }> = [
  { label: 'Body', bones: ['hips', 'spine', 'chest', 'upperChest', 'neck', 'head', 'jaw', 'leftEye', 'rightEye'] },
  { label: 'Left arm', bones: ['leftShoulder', 'leftUpperArm', 'leftLowerArm', 'leftHand'] },
  { label: 'Right arm', bones: ['rightShoulder', 'rightUpperArm', 'rightLowerArm', 'rightHand'] },
  { label: 'Left leg', bones: ['leftUpperLeg', 'leftLowerLeg', 'leftFoot', 'leftToes'] },
  { label: 'Right leg', bones: ['rightUpperLeg', 'rightLowerLeg', 'rightFoot', 'rightToes'] },
  { label: 'Left fingers', bones: HUMANOID_BONES.filter((b) => /^left(Thumb|Index|Middle|Ring|Little)/.test(b)), folded: true },
  { label: 'Right fingers', bones: HUMANOID_BONES.filter((b) => /^right(Thumb|Index|Middle|Ring|Little)/.test(b)), folded: true },
];

/** "leftUpperArm" → "Upper arm"; "leftIndexProximal" → "Index 1". */
function label(b: HumanBone): string {
  const s = b.replace(/^(left|right)/, '');
  const f = /^(Thumb|Index|Middle|Ring|Little)(Metacarpal|Proximal|Intermediate|Distal)$/.exec(s);
  if (f) return `${f[1]} ${{ Metacarpal: 0, Proximal: 1, Intermediate: 2, Distal: 3 }[f[2] as 'Proximal']}`;
  const words = s.replace(/([A-Z])/g, ' $1').trim().toLowerCase();
  return words.charAt(0).toUpperCase() + words.slice(1);
}

export function BonesStep({ avatar, config, set }: { avatar: AvatarDetail; config: AvatarConfig; set: (p: Partial<AvatarConfig>) => void; handle: PreviewHandle | null }) {
  const bones = avatar.info.bones ?? [];
  const names = useMemo(() => bones.map((b) => b.name), [bones]);
  const [open, setOpen] = useState<Record<string, boolean>>({});
  const used = new Map<string, HumanBone>();
  for (const [k, v] of Object.entries(config.boneMap)) if (v) used.set(v, k as HumanBone);
  const missing = REQUIRED_BONES.filter((b) => !config.boneMap[b]);
  // A short depth prefix shows the hierarchy in the list.
  const depth = useMemo(() => {
    const parent = new Map(bones.map((b) => [b.name, b.parent]));
    const d = new Map<string, number>();
    for (const b of bones) {
      let n = 0;
      let p = b.parent;
      while (p && n < 40) {
        n++;
        p = parent.get(p) ?? null;
      }
      d.set(b.name, n);
    }
    return d;
  }, [bones]);

  const assign = (b: HumanBone, v: string) => {
    const next = { ...config.boneMap };
    if (v) {
      // A model bone can only be one canonical bone.
      for (const [k, x] of Object.entries(next)) if (x === v) delete next[k as HumanBone];
      next[b] = v;
    } else delete next[b];
    set({ boneMap: next });
  };

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm text-fg-2">
          {missing.length ? (
            <span className="text-danger">Missing: {missing.map(label).join(', ')}. Body animation stays off until these are set.</span>
          ) : (
            'All main bones are mapped. Use the Check step to see that they move the right way.'
          )}
        </p>
        <Button size="sm" variant="ghost" icon={RotateCcw} onClick={() => set({ boneMap: avatar.info.boneMap ?? {} })}>
          Automatic
        </Button>
      </div>
      {GROUPS.map((g) => {
        const mapped = g.bones.filter((b) => config.boneMap[b]).length;
        const isOpen = open[g.label] ?? !g.folded;
        return (
          <section key={g.label}>
            <button type="button" className="flex w-full items-center justify-between py-1" onClick={() => setOpen((o) => ({ ...o, [g.label]: !isOpen }))} aria-expanded={isOpen}>
              <SectionTitle className="p-0">{g.label}</SectionTitle>
              <Badge>
                {mapped}/{g.bones.length}
              </Badge>
            </button>
            {isOpen ? (
              <div className="mt-1 flex flex-col gap-1.5">
                {g.bones.map((b) => {
                  const req = (REQUIRED_BONES as HumanBone[]).includes(b);
                  return (
                    <label key={b} className="grid grid-cols-[7.5rem_1fr] items-center gap-2 text-sm">
                      <span className={cx(req && !config.boneMap[b] && 'font-medium text-danger')}>
                        {label(b)}
                        {req ? <span className="text-fg-3"> *</span> : null}
                      </span>
                      <Select aria-label={label(b)} value={config.boneMap[b] ?? ''} onChange={(e) => assign(b, e.target.value)} className="h-9 py-0 text-sm">
                        <option value="">— none —</option>
                        {names.map((n) => (
                          <option key={n} value={n}>
                            {'· '.repeat(Math.min(8, depth.get(n) ?? 0))}
                            {n}
                            {used.get(n) && used.get(n) !== b ? ` (${label(used.get(n)!)})` : ''}
                          </option>
                        ))}
                      </Select>
                    </label>
                  );
                })}
              </div>
            ) : null}
          </section>
        );
      })}
    </div>
  );
}
