import { ChevronDown } from 'lucide-react';
import type { ReactNode } from 'react';
import { Icon, Kbd } from '@/ui';
import { ToolSheet } from './ToolSheet';
import { GLOSSARY } from '@/lib/glossary';

const SECTIONS: Array<{ title: string; body: ReactNode }> = [
  {
    title: 'Chatting',
    body: (
      <ul>
        <li>Tap › under the newest reply for a new version (or swipe it sideways); ‹ › move between versions. The story state follows the version you keep.</li>
        <li>Tap a message for Edit, Copy and Delete; More has branch, hide from the AI, bookmark and read aloud.</li>
        <li>Tools, next to the message box, finds every tool and setting by name, with a line on what each does. Pin the ones you use.</li>
        <li>Stage view (the book button at the top) shows one line at a time with pictures and the background.</li>
      </ul>
    ),
  },
  {
    title: 'The game layer',
    body: (
      <ul>
        <li>After each reply, auto-tracking reads the scene and updates time, needs, items, people and places. You see a short summary under the message.</li>
        <li>Tools › Story changes lists every change with Undo, and a new version, an edit or a deleted message rolls its changes back exactly.</li>
        <li>You can edit everything yourself: open Tools and pick Inventory, People, Journal, Map and so on.</li>
        <li>Lock a person, place or organization to stop the model from changing it.</li>
      </ul>
    ),
  },
  {
    title: 'Map and travel',
    body: (
      <ul>
        <li>Tabs switch between World, Region, Local, Nearby and Area. Tap a place, then Enter to see inside it.</li>
        <li>Travel shows every way to get there with time, cost and energy — worked out by the game, not guessed.</li>
        <li>Expand with AI invents a few unexplored places for the level you’re viewing. Place landmark lets you drop your own.</li>
      </ul>
    ),
  },
  {
    title: 'Time, phone and diary',
    body: (
      <ul>
        <li>While time passes, people keep to their schedules, the weather turns, birthdays come round and rumours spread. Meanwhile… collects what happened.</li>
        <li>People with your number text you. Opening a thread writes their messages; recent texts are shared with the story.</li>
        <li>The diary can draft a page from today’s events in your voice. Add photos and stickers, then save.</li>
      </ul>
    ),
  },
  {
    title: 'Lorebooks, presets and models',
    body: (
      <ul>
        <li>Lorebooks work like SillyTavern World Info: keywords, secondary keys, recursion, sticky and cooldown, scan depth and budget.</li>
        <li>Presets hold the prompt order and sampler settings. Tools › Everything sent to the AI shows exactly what is sent.</li>
        <li>Main writes the story. Utility (optional, cheaper) handles bookkeeping, summaries, the helper and texts.</li>
      </ul>
    ),
  },
  {
    title: 'Keyboard',
    body: (
      <ul>
        <li>
          <Kbd>Ctrl</Kbd> + <Kbd>K</Kbd> opens Tools.
        </li>
        <li>
          <Kbd>Enter</Kbd> sends, <Kbd>Shift</Kbd> + <Kbd>Enter</Kbd> adds a new line (configurable in Settings).
        </li>
        <li>
          <Kbd>←</Kbd> <Kbd>→</Kbd> move between versions of the last reply when the message box is empty.
        </li>
      </ul>
    ),
  },
  {
    title: 'Your data',
    body: (
      <ul>
        <li>Everything lives on your server. API keys are encrypted there and never sent to the browser.</li>
        <li>Settings › Backups &amp; import has backups, restore and the SillyTavern importer. Characters export as PNG or JSON cards.</li>
      </ul>
    ),
  },
  {
    title: 'Words',
    body: (
      <dl className="flex flex-col gap-2">
        {GLOSSARY.map((g) => (
          <div key={g.term}>
            <dt className="font-medium text-fg">{g.term}</dt>
            <dd>
              {g.means}
              {g.was ? <span className="text-fg-3"> (Also: {g.was}.)</span> : null}
            </dd>
          </div>
        ))}
      </dl>
    ),
  },
];

export default function Help() {
  return (
    <ToolSheet title="Help" description="How Everloom works">
      <div className="flex flex-col divide-y divide-line">
        {SECTIONS.map((s, i) => (
          <details key={s.title} className="group py-1" open={i === 0}>
            <summary className="pressable flex min-h-12 cursor-pointer list-none items-center gap-2 font-medium [&::-webkit-details-marker]:hidden">
              <span className="flex-1">{s.title}</span>
              <Icon icon={ChevronDown} size={18} className="text-fg-3 transition-transform group-open:rotate-180" />
            </summary>
            <div className="pb-3 text-sm leading-6 text-fg-2 [&_li]:mb-1.5 [&_li]:ml-4 [&_li]:list-disc">{s.body}</div>
          </details>
        ))}
      </div>
    </ToolSheet>
  );
}
