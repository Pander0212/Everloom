# Navigation: before and after

How a player finds things, before the redesign (commit `ad35fed`) and after. The full inventory
of what existed is in [audit.md](audit.md); the measured tasks are in [task-tests.md](task-tests.md);
the words are in [glossary.md](glossary.md).

## The rules the redesign follows

1. **The play screen shows what a player needs every turn**: the story, the message box with one
   send button, the newest reply's version and edit buttons, and the status bar. Everything else is
   one level deeper, in **Tools**.
2. **Tools is grouped by what you want to do**, not by how the code is organized: *This scene, My
   character, The world, Story tools, Create, Settings, Advanced*.
3. **Every entry says what it does** in one line, and every screen has a **What is this?** with an
   example. The list lives in one file (`apps/web/src/lib/registry.ts`), and a test fails if a tool,
   sheet, page or settings page has no entry, no description or no way in.
4. **Off means gone.** An entry whose feature is switched off isn't listed, searched or loaded.
   Classic chat shows no game entry anywhere.
5. **One name per thing**, the same in the app, Help and the docs ([glossary.md](glossary.md)).

## Top level

Unchanged: Chats, Characters, Personas, Lore, Settings (phone bottom bar, desktop sidebar). Added: a
**Search** entry in the desktop sidebar and Ctrl/⌘K everywhere, which open the same palette outside
a chat (pages, settings, feature switches, characters).

## The play screen (phone, 390×844, a Full RPG chat after one turn)

| | Before | After |
|---|---|---|
| Header | Back · title · Find in chat · Stage · ⋯ Chat menu (9 entries) | Back · title (opens **This chat**) · Stage view |
| Status bar | one button (Status) | the place (opens the **map**) · the rest (Status) |
| Each message | ⋯ menu with 9 entries, always visible on phones | nothing until tapped; then Edit · More · Copy · Delete |
| Newest reply | ‹ n/m › ⟳ and its ⋯ | › New version · Edit · More (‹ n/m only once there are two versions) |
| Above the box | person present · @ Everyone · Emote · Suggest | person present · Talk to (only when someone is here) · Suggest — **customizable** (Settings › Chat › Quick actions) |
| Message box | + · box · mic · send | **Tools** · input mode (Chat, Act, Say, Story, Direct) · box · mic (only with Voice on) · send |
| **Visible controls** | **20** | **16** |

What moved where:

| Before | After |
|---|---|
| Header › Find in chat | Tools › This scene › Find in chat (pinned in Classic and Story) |
| Header ⋯ › Prompt inspector | Tools › Advanced › **Everything sent to the AI** |
| Header ⋯ › Author's note | Tools › Story tools › **Note to the AI** |
| Header ⋯ › Memory | Tools › Story tools › Memory (pinned) — now hidden when memory is off |
| Header ⋯ › World inspector | Tools › Advanced › **Story state**; its Changes and Health tabs also as Tools › Story tools › **Story changes** and **Story problems** |
| Header ⋯ › Saves | Tools › Story tools › Saves (pinned) |
| Header ⋯ › View | Tools › Settings › **View on this device** |
| Header ⋯ › Cinematic mode | Tools › This scene › Cinematic mode |
| Header ⋯ › Scripts | Tools › Advanced › Scripts (hidden when Scripts is off) |
| Header ⋯ › Chat details | tap the title: **This chat** (now with the chat's **Model**) |
| Message ⋯ › Edit, Copy, Delete | buttons under the message |
| Message ⋯ › Regenerate (bar) | More › **Rewrite this version** |
| Message ⋯ › Branch, Re-read, Hide, Bookmark, Read aloud, Delete after | More, in labelled groups (This version · Story · Keep · Delete); Read aloud only with Voice on, Re-read only with a game |
| Emote chip | a quick action you can turn on |
| "+" drawer › 37 entries | Tools: 8 pinned, then 7 groups with descriptions; settings pages, feature switches, places, items, people and characters by search |
| "+" › Continue the reply | Tools › This scene › **Make the reply longer** (or the "Longer" quick action) |
| "+" › Write my next line | Tools › This scene › Write my next line (or the "Write for me" quick action) |
| Status (tap the bar only) | also Tools › My character › Status |
| — | new: Tools › My character › **Outfits** (wear or take off in one tap) |
| — | new: Tools › This scene › **New chat with this character** |
| — | new: Tools › Settings › **Take the tour**, **Change the model** |
| `/design`, `/lab/3d` (no link) | Tools › Advanced, with Settings › Features › Experimental on |

## Tools (the palette)

Opened by the Tools button next to the message box, Ctrl/⌘K, the Search entry on desktop, or the
search field at the top of Settings on a phone. Searching finds names, keywords and descriptions.

| Group | Entries (each hidden when its feature is off) |
|---|---|
| Pinned | your own choice, up to eight (defaults: Full RPG: Inventory, Outfits, Map, Journal, Status, People, Memory, Saves; Story: Memory, Journal, Note to the AI, Saves, Diary, Find in chat, Stage view, This chat; Classic: Note to the AI, Find in chat, Saves, This chat, Make the reply longer, Write my next line) |
| This scene | Make the reply longer, Write my next line, Find in chat, New chat with this character, Stage view, Stage & sound, Weather & mood, Battle, Cinematic mode |
| My character | Status, Outfits, Inventory, Money, Persona, Party, Crafting, Home, Activities |
| The world | Map, People, Relationships, Calendar, Phone, Shops, Trade, Organizations, Meanwhile, Story cast, Helper |
| Story tools | Journal, Diary, Facts, Memory, Note to the AI, Saves, Story changes, Story problems, New game setup, This chat |
| Create | New chat, Characters, Character studio, Browse characters online, Personas, Lorebooks, 3D avatars, Puppets |
| Settings | All settings, Change the model, Features, Appearance & themes, View on this device, Backups & import, Help, Take the tour |
| Advanced | What the AI sees, Everything sent to the AI, Story state, Scripts, Prompts & presets, Extensions, Diagnostics, Custom CSS (+ Design system, 3D lab, Puppet lab when Experimental is on) |
| Search only | every settings page, every feature switch (with an on/off switch in the row), the story's places, items and people, and your characters |

**Depth.** Before, a tool was one level deep (the drawer) but the drawer was a flat list of 37;
the sheets in the ⋯ menu were also one level deep, twice. After, the eight pinned tools are one
tap from the play screen with no scrolling, every other tool one tap plus at most a short scroll,
or a search.

## Settings

| | Before | After |
|---|---|---|
| Index | 21 pages in one list | **Simple** view: 9 pages in 4 groups (Basics, Voice & pictures, Your data & account, Advanced › About), with a line under each; **Advanced** view: all 21 in 5 groups. A search field on phones. |
| Each page | title | one-line description and **What is this?** with an example |
| Scripts, Extensions pages | shown with their features off | hidden with their features off |
| Game page | Tracker mode incl. Off · Send game state · Scene block budget · HUD · world simulation rows for switched-off features · Show the helper companion (did nothing) · weather overlay and particles | **Auto-tracking** (how it runs; on/off is the feature switch) · **What the AI sees** (size limit) · **Status bar** · world simulation rows only for features that are on · Helper name · weather settings live in Weather & mood |
| Chat page | 4 switches | 2 switches, Dictation and Read aloud only with Voice on, and **Quick actions** |
| Features page | presets, memory, 38 switches | the same, with plain names (Auto-tracking, What the AI sees, Read my message first, Facts, Stage view, Interactive messages), and **Experimental** |

Renamed pages: Connections → **Models & connections**, Game & trackers → **Game & story state**,
World info → **Lorebooks**, Characters → **Character library**, Appearance → **Appearance &
themes**.

## First run

After the "How will you use Everloom?" question, a short tour (six cards) for the chosen mode;
Skip ends it, Tools › Take the tour opens it again. Classic chat never mentions game tools.
