/**
 * Paired and group animations: one clip per participant (a handshake, a hug, a dance for two),
 * placed relative to each other and played on one clock. Contacts say which bones meet when (hands in
 * a handshake), so the browser can adjust for different heights with light inverse kinematics.
 */
import { z } from 'zod';
import { ClipSchema } from './config.js';
import { HUMANOID_BONES } from './skeleton.js';

export const PAIRED_ID = /^[a-z][a-z0-9_]{0,39}$/;

export const PairedRoleSchema = z.object({
  /** Shown in pickers ("Leader", "Follower"). */
  name: z.string().trim().min(1).max(30),
  clip: ClipSchema,
  /** Where this participant stands relative to the first, in metres at a 1.7 m height (x right, z toward the camera). */
  offset: z.tuple([z.number().min(-5).max(5), z.number().min(-5).max(5)]).default([0, 0]),
  /** Degrees this participant turns (0 faces the camera; 90 faces right). */
  yaw: z.number().min(-360).max(360).default(0),
});

export const ContactSchema = z.object({
  a: z.object({ role: z.number().int().min(0).max(3), bone: z.enum(HUMANOID_BONES) }),
  b: z.object({ role: z.number().int().min(0).max(3), bone: z.enum(HUMANOID_BONES) }),
  /** Seconds into the clip the bones meet, and part. */
  from: z.number().min(0).max(120),
  to: z.number().min(0).max(120),
});

export const PairedClipSchema = z
  .object({
    v: z.literal(1),
    id: z.string().regex(PAIRED_ID),
    label: z.string().trim().min(1).max(60),
    aliases: z.array(z.string().max(40)).max(12).default([]),
    roles: z.array(PairedRoleSchema).min(2).max(4),
    contacts: z.array(ContactSchema).max(8).default([]),
    loop: z.boolean().default(false),
    adult: z.boolean().default(false),
    /** Where it comes from and its license (only clips that allow it are bundled). */
    source: z.string().max(200).default(''),
  })
  .superRefine((c, ctx) => {
    for (const k of c.contacts) if (k.a.role >= c.roles.length || k.b.role >= c.roles.length) ctx.addIssue({ code: 'custom', message: 'A contact names a missing participant' });
  });
export type PairedClip = z.infer<typeof PairedClipSchema>;

export interface PairedInfo {
  id: string;
  label: string;
  participants: number;
  loop: boolean;
  adult: boolean;
  aliases: string[];
  source: 'authored' | 'imported';
}

/** Paired clips Everloom ships (keyframed for Everloom, CC0; the clips live in the web app). */
export const BUILTIN_PAIRED: PairedInfo[] = [
  { id: 'handshake', label: 'Handshake', participants: 2, loop: false, adult: false, aliases: ['shake hands', 'shake_hands'], source: 'authored' },
  { id: 'high_five', label: 'High five', participants: 2, loop: false, adult: false, aliases: ['high five', 'highfive'], source: 'authored' },
  { id: 'hug_pair', label: 'Hug', participants: 2, loop: false, adult: false, aliases: ['hug', 'embrace', 'hugs'], source: 'authored' },
  { id: 'dance_pair', label: 'Dance together', participants: 2, loop: true, adult: false, aliases: ['dance together', 'slow dance', 'partner dance'], source: 'authored' },
];

const key = (s: string) => s.trim().toLowerCase().replace(/[\s-]+/g, '_');

/** The installed paired clip a name refers to, or null (never a guess). */
export function resolvePaired(installed: readonly PairedInfo[], name: string | null | undefined): PairedInfo | null {
  if (!name) return null;
  const k = key(name);
  return installed.find((x) => x.id === k) ?? installed.find((x) => key(x.label) === k) ?? installed.find((x) => x.aliases.some((a) => key(a) === k)) ?? null;
}

/** Clips a set of participants may play: adult clips only when every participant is an adult. */
export function allowedPaired(installed: readonly PairedInfo[], opts: { adultMode: boolean; everyoneAdult: boolean }): PairedInfo[] {
  return installed.filter((p) => !p.adult || (opts.adultMode && opts.everyoneAdult));
}

/** The tracker prompt line for paired clips. */
export function pairedOpReference(installed: readonly PairedInfo[]): string {
  if (!installed.length) return '';
  return `- {"type":"avatar.paired","clip":"handshake","who":["Mara Quill","Theo"]}  two or more 3D characters do something together; clip is one of: ${installed.map((p) => `${p.id} (${p.participants})`).join(', ')}`;
}
