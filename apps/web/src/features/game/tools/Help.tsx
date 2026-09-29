import { ChevronDown } from 'lucide-react';
import type { ReactNode } from 'react';
import { Icon, Kbd } from '@/ui';
import { ToolSheet } from './ToolSheet';

const SECTIONS: Array<{ title: string; body: ReactNode }> = [
  {
    title: 'Chatting',
    body: (
      <ul>
        <li>Swipe a reply left or right (or use the arrows) to see other takes. The game state follows the take you keep.</li>
        <li>The ⋯ button on a message lets you edit, branch, hide, bookmark, copy or read it aloud.</li>
        <li>The plus button next to the message box opens every action and tool: continue, impersonate, suggestions, summaries and the game tools.</li>
        <li>Stage mode (the theatre icon) shows one line at a time with sprites and the background.</li>
      </ul>
    ),
  },
  {
    title: 'The game layer',
    body: (
      <ul>
        <li>After each reply a small model reads the scene and updates time, needs, items, people and places. You see a short summary under the message.</li>
        <li>Anything it changed can be undone from the summary, and swiping, editing or deleting a message rolls its changes back exactly.</li>
        <li>You can edit everything yourself: open the tools menu and pick Inventory, NPCs, Journal, Map and so on.</li>
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
        <li>Presets hold the prompt order and sampler settings. The prompt inspector in the chat menu shows exactly what is sent.</li>
        <li>Main writes the story. Utility (optional, cheaper) handles bookkeeping, summaries, the helper and texts.</li>
      </ul>
    ),
  },
  {
    title: 'Keyboard',
    body: (
      <ul>
        <li>
          <Kbd>Ctrl</Kbd> + <Kbd>K</Kbd> opens the tools menu.
        </li>
        <li>
          <Kbd>Enter</Kbd> sends, <Kbd>Shift</Kbd> + <Kbd>Enter</Kbd> adds a new line (configurable in Settings).
        </li>
        <li>
          <Kbd>←</Kbd> <Kbd>→</Kbd> swipe the last reply when the message box is empty.
        </li>
      </ul>
    ),
  },
  {
    title: 'Your data',
    body: (
      <ul>
        <li>Everything lives on your server. API keys are encrypted there and never sent to the browser.</li>
        <li>Settings → Data has backups, restore and the SillyTavern importer. Characters export as PNG or JSON cards.</li>
      </ul>
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
