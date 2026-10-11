# UX audit: every tool, action, menu and setting (before the redesign)

Written on 2026-10-09 against commit `4b0502d`, before any Part 1 change. This is the state the
redesign started from. The plan that follows from it is in [navigation.md](navigation.md), the
measurements in [task-tests.md](task-tests.md), and the words in [glossary.md](glossary.md).

**Baseline tests at this commit:** typecheck clean; Vitest 100 files, 618 passed, 5 skipped
(Blender-gated); the full Playwright suite is in [evidence/baseline.md](evidence/baseline.md).

**How to read the tables.** *Use* is how often a player is likely to need the entry:
**turn** (every turn), **often** (most sessions), **some** (now and then), **rare** (a few times
ever), **setup** (once, when setting things up), **dev** (debugging or power users). *Switch* is the
feature switch (Settings › Features) that hides it; `—` means it is always there, and
*ungated* means it should have a switch and didn't.

## Screenshots of the current state

| | Phone (390×844, dark) | Phone (light) | Desktop (1280×800) |
|---|---|---|---|
| Play screen | ![](screens/before/phone/02-play.webp) | ![](screens/before/phone-light/02-play.webp) | ![](screens/before/desktop/02-play.webp) |
| Message actions | ![](screens/before/phone/03-message-actions.webp) | ![](screens/before/phone-light/03-message-actions.webp) | ![](screens/before/desktop/03-message-actions.webp) |
| Tools menu (+) | ![](screens/before/phone/04-command-menu.webp) | ![](screens/before/phone-light/04-command-menu.webp) | ![](screens/before/desktop/04-command-menu.webp) |
| Chat menu (⋯) | — (the menu is the same as desktop) | | ![](screens/before/desktop/05-chat-menu.webp) |
| World inspector | | | ![](screens/before/desktop/06-world-inspector.webp) |
| Prompt inspector | ![](screens/before/phone/12-prompt-inspector.webp) | ![](screens/before/phone-light/12-prompt-inspector.webp) | |
| Settings | ![](screens/before/phone/07-settings.webp) | ![](screens/before/phone-light/07-settings.webp) | ![](screens/before/desktop/07-settings.webp) |
| Settings › Features | ![](screens/before/phone/08-settings-features.webp) | ![](screens/before/phone-light/08-settings-features.webp) | ![](screens/before/desktop/08-settings-features.webp) |
| Settings › Game | ![](screens/before/phone/09-settings-game.webp) | ![](screens/before/phone-light/09-settings-game.webp) | ![](screens/before/desktop/09-settings-game.webp) |
| Settings › Appearance | ![](screens/before/phone/10-settings-appearance.webp) | ![](screens/before/phone-light/10-settings-appearance.webp) | ![](screens/before/desktop/10-settings-appearance.webp) |
| Characters | ![](screens/before/phone/11-characters.webp) | ![](screens/before/phone-light/11-characters.webp) | ![](screens/before/desktop/11-characters.webp) |

## What is wrong, in short

1. **The tools drawer is a wall.** The "+" button opens 37 entries of equal weight in one list.
   Daily tools (Inventory, Map) sit next to debugging tools (Prompt inspector, World inspector,
   Scripts), and nothing says what any of them does. On a phone, Inventory and Map need a scroll.
2. **Two menus do the same job.** The header's ⋯ menu repeats seven of the drawer's eleven
   "Actions" (Prompt inspector, Author's note, Memory, World inspector, Saves, Cinematic mode,
   Scripts), with different switch rules (Memory shows in the ⋯ menu even when memory is off).
3. **Code words in the interface.** "Tracker pass", "Scene block", "Pre-read", "Prompt inspector",
   "Databank", "Swipe", "Hide from prompt", "Re-read game changes", "Squash system messages".
4. **One setting, two or three places.** Auto-tracking is a feature switch *and* a "Tracker mode"
   in Settings › Game; the story state in the prompt is a switch *and* "Send game state to the
   model"; weather overlay and particles are in Settings › Game *and* the Atmosphere tool under
   other names; scene effects are in four places.
5. **Switches that don't switch.** Dictation ignores the Voice switch, *Read aloud* shows with
   Voice off (and silently does nothing), the stage's Scene effects button ignores the Scene
   effects switch, and the Scripts and Extensions settings pages show with their switches off.
6. **Dead or developer-only entries** reachable by URL only: `/design`, `/lab/3d`,
   `/bridge/share`; "Show the helper companion" changes nothing in the app.
7. **Settings is 21 pages in one flat list**, from "Connections" to "Custom CSS", with no idea of
   which ones matter; there is no Simple view.
8. **Little help.** Settings groups have descriptions, but tools have none, there is no "What is
   this?", and the tools drawer has no descriptions at all.
9. **No guide after first run.** The preset question (Classic / Story / Full RPG) is asked, and
   then the player is alone with the full tools drawer.

The play screen itself is not crowded (20 controls on a phone, see below); the overload is one
level deeper, in the drawer, the two menus and Settings.

## 1. Top level

The same five entries are in the phone's bottom bar and the desktop sidebar (`app/Shell.tsx:11-17`).
None has a switch.

| Entry | Route | Use | Notes |
|---|---|---|---|
| Chats | `/` | often | New chat, search, filters |
| Characters | `/characters` | often | Library; its "+" holds Character studio, Browse online (`sources`), 3D avatars (`avatars3d`) |
| Personas | `/personas` | some | |
| Lore | `/lore` | some | Lorebooks ("World info" in Settings: two names for one thing) |
| Settings | `/settings` | some | 21 pages |

Pages without a nav entry: the chat itself (`/chat/:id`), the character editor, Character studio,
Browse online, Bridge receive, 3D avatars and their editor and maker, lorebook editor, extension
screens (`/x/…`), and three with **no link anywhere**: `/design` (the design-system page),
`/lab/3d` and `/bridge/share` (the Android share target, which is reached by the OS, not a link).
`/lab/puppets` is linked from Settings › Puppets only.

## 2. Play screen

Counted by `tests/ux/tasks.spec.ts` on a 390×844 phone, a Full RPG chat after one turn:
**20 visible controls**: Back, title, Find in chat, Switch to stage mode, Chat menu, the status
bar, three "Message actions" (one per message), Previous swipe, New swipe, Regenerate, the
person present (Tobias), @ Everyone, Emote, Suggest, Actions and tools (+), the message box,
Dictate, Let the story continue.

| Control | Where | What it does | Switch | Use |
|---|---|---|---|---|
| Back | header | to Chats | — | often |
| Title (avatar + name) | header | Chat details sheet | — | some |
| Find in chat | header | search sheet (messages, bookmarks) | — | rare |
| Switch to stage / chat mode | header | visual-novel view ↔ chat | `stage` | some |
| ⋯ Chat menu | header | 9 entries, see §5 | — | some |
| Status bar | under header | time, weather, place, bars; tap → Status | `trackers` | turn (glance) |
| Floating status bar | desktop | drag, dock | `trackers` | rare |
| Level-up dialog | overlay | "Spend points" → Party | `party` | some |
| Cutscene overlay | overlay | tap = next, Skip | `cutscenes` | some |
| Show earlier messages | story | loads 80 more | — | rare |
| Set up a new game | empty chat | New game wizard | game | setup |
| Jump to latest | story | scrolls down | — | often |
| Cinematic Exit | cinematic | leaves cinematic mode | — | rare |
| Person pills (cast strip) | above composer | dossier: feelings, wants, facts; "Edit" → NPCs | game | some |
| @ Everyone / target | chips | who you speak to | game | some |
| Emote | chips | inserts `*smiles*` etc. (12) | game | some |
| Suggest | chips | asks for suggested actions | game | some |
| Stage: Scene effects | stage | effect grid | *ungated* (should be `effects`) | rare |
| Stage: Emotes, Look around | stage | 3D only | `avatars3d` | some |
| Stage: History, previous/next line, swipe controls | stage | | `stage` | turn |

## 3. Message actions

Every message has a ⋯ button (always visible on phones, on hover on desktop) with nine entries
(`features/story/Message.tsx:85-100`). The last reply also has the version bar.

| Action | Where | What it does | Condition | Use |
|---|---|---|---|---|
| Previous / Next swipe, "n/m" | inline, last reply | moves between versions; › on the last one makes a new version | — | turn |
| Regenerate | inline, last reply | rewrites the current version in place | — | often |
| Drag sideways, ←/→ in an empty box | gesture | same as the swipe buttons | — | often |
| Edit | ⋯ | inline editor | — | often |
| Copy text | ⋯ | clipboard | — | some |
| Read aloud | ⋯ | text to speech | *ungated* (should be `voice`; does nothing when off) | some |
| Bookmark / Remove bookmark | ⋯ | marks it; listed under Find in chat › Bookmarks | — | rare |
| Branch from here | ⋯ | a new chat from this point | — | rare |
| Re-read game changes | ⋯ (replies) | runs the tracker again on this reply | *ungated* (should be game) | rare |
| Hide from prompt / Include in prompt | ⋯ | the AI doesn't see it | — | rare |
| Delete | ⋯ | asks; rolls back its game changes | — | some |
| Delete this and after | ⋯ | asks | — | rare |
| Reasoning | inline | the model's thinking, collapsible | Settings › Chat | some |

Problems: the three common ones (edit, copy, delete) are hidden in a menu of nine with no
grouping; "swipe" and "regenerate" sit side by side with no hint of the difference ("new
version" vs "rewrite this version"); "prompt" is jargon.

## 4. Composer

| Control | What it does | Switch | Use |
|---|---|---|---|
| + "Actions and tools" | opens the tools drawer (§5) | — | often |
| Message box | Enter sends if "Enter sends" is on; `/` starts a command | — | turn |
| Dictate | browser speech recognition | *ungated* (Settings › Chat "Voice input" only, not `voice`) | some |
| Send / Let the story continue | sends; with an empty box it asks for the next turn | — | turn |
| Stop | stops writing | — | some |
| Slash suggestions | up to 8 matching commands | — | dev |
| Quick replies, script buttons | from quick-reply sets and scripts | `scripts` | some |
| Group: Auto / speaker chips | who speaks next | groups | often |

**Slash commands** (`scripting/commands.ts`): /help, /echo, /roll (/r), /sys (/narrate), /send,
/sendas, /trigger, /continue, /swipe, /impersonate, /stop, /gen, /setvar, /getvar, /addvar,
/incvar, /decvar, /flushvar, /setglobalvar, /getglobalvar, /travel (/go), /give, /take, /money,
/wait, /emote, /pair, /pose, /qr, /run, /len, plus any from scripts and extensions. The game
commands don't check the feature switches in the client (the server refuses disabled ops).

Confusing pair: **"Let the story continue"** (empty Send: a normal next turn) and **"Continue
the reply"** (drawer: lengthens the last reply) sound the same and do different things.

## 5. The tools drawer ("+", Ctrl/⌘K) and the ⋯ chat menu

The drawer is searchable (label + keywords + group), a bottom drawer with a 2-column grid on
phones and a dialog on desktop. Entries have **no descriptions**. Groups: Actions, Story,
Character, World, System. With the game off only Actions and System remain.

**Actions** (11, `StoryView.tsx:348-375`)

| Entry | Also in ⋯ menu | Switch | Use |
|---|---|---|---|
| Continue the reply | | — | some |
| Write my next line | | — | some |
| New game setup | | game | setup |
| Meanwhile… (world log) | | game | some |
| Author's note | ✓ | — | rare |
| Memory | ✓ (ungated there) | memory ≠ off | some |
| Prompt inspector | ✓ | — | dev |
| World inspector | ✓ | — | dev |
| Saves | ✓ | — | some |
| Cinematic mode | ✓ (and in View) | — | rare |
| Scripts | ✓ | *ungated* (`scripts`) | dev |
| Extension panels and screens | | per extension | some |

**Tools** (23, `features/game/CommandMenu.tsx:22-46`, switches from `GameLayer.tsx:34-58`)

| Entry | Group | Switch | Use | Overlaps |
|---|---|---|---|---|
| Journal | Story | journal | often | |
| Diary | Story | diary | some | |
| Map | Story | map | often | travel lives inside it |
| Organizations | Story | orgs | rare | |
| Activities | Story | time | some | |
| Battle | Story | battle | some | |
| Persona | Character | game | some | Status, Party |
| Inventory | Character | inventory | often | outfits are equipped here |
| Money | Character | inventory | some | |
| Home | Character | home | some | |
| Crafting | Character | crafting | some | |
| Characters | Character | game | rare | NPCs, Social, Party, dossier |
| Party | Character | party | some | |
| Social | Character | npcs | some | "relationships" |
| Shops | World | inventory | some | |
| Trade | World | inventory | rare | |
| Stage & sound | World | stage | some | Scene effects ×4 |
| Databank | World | databank | rare | "facts" |
| Phone | World | phone | some | |
| NPCs | World | npcs | some | Characters, Social |
| Calendar | World | time | some | |
| Atmosphere | World | weather | rare | Settings › Game overlay |
| Helper | World | helper | some | |

Not in the drawer: **Status** (only by tapping the status bar), **Help** (System), **New game**
and **Meanwhile** (Actions).

**System** (3): Settings, Help, Backups (opens a page titled "Backups & import").

**⋯ Chat menu** (9, `StoryView.tsx:418-431`): Prompt inspector, Author's note, Memory, World
inspector, Saves, View, Cinematic mode, Scripts, Chat details. *View* (status bar, reply chips,
avatars, float, order, cinematic) and *Chat details* (title, mode, persona, branches, export,
import, duplicate, delete) are only here.

## 6. World inspector

Title "World inspector", "What the narrator sees, what changed, and what it cost."

| Tab | What it holds | Use |
|---|---|---|
| Scene | the *scene block* for the last or next reply, tokens, copy | dev |
| Changes | every change with its source; Undo this change | some (when the story got something wrong) |
| Model calls | calls per role, time, tokens, errors | dev |
| Health (badge) | problems with a fix button; unknown names → Create / It's… / Dismiss | some |
| Import | read a lorebook (and the card) and propose places, people, groups, facts | setup |

A player who wants to fix "the story thinks I'm still in the café" has to know that this lives
in a "World inspector" next to token counts. The *Changes* and *Health* tabs are player tools;
*Scene* and *Model calls* are developer tools.

## 7. Settings (21 pages, one flat list)

| Page | Switch | Groups and settings | Use |
|---|---|---|---|
| Connections | — | language models, voice, images, 3D, puppet layering; roles (Main, Utility, Background, Embeddings, Voice, Images, Puppet layering, 3D) | setup |
| Features | — | Mode (Classic / Story / Full RPG), Memory (Full / Rolling / Off), 38 switches in 4 groups | setup |
| Prompts & presets | — | preset, prompt blocks, 5 options + format fields | dev |
| Chat | — | Enter sends, Show model reasoning, Voice input, Read replies aloud | some |
| Game & trackers | `game` | Tracker mode, Send game state, Scene block budget; HUD items (13); World engine profile; World simulation (8); Memory (9); Helper and atmosphere (4) | some |
| Characters | — | card details on hover, previous/next, info tab, versions kept | rare |
| Character sources | `sources` | sources, accounts, site notices, diagnostics, browser bridge | setup |
| World info | — | scan depth, budgets, recursion, matching; semantic retrieval | dev |
| Appearance | — | theme (System/Light/Dark), accent (4), genre tint, illustrations, motion, story text size, new chats open in | some |
| Custom CSS | — | safe mode, snippets | dev |
| Scripts | *ungated* (`scripts`) | 8 settings, my scripts, regex rules, quick replies, trusted creators | dev |
| Extensions | *ungated* (`extensions`) | install, installed | dev |
| 3D characters | `avatars3d` | avatars, diagnostics, part packs, motions, paired animations, Blender, device settings, MPFB | some |
| Puppets | `puppets` | make, import, list | some |
| Voice | `voice` | engine, narrator voice, speed, pitch | setup |
| Images | `imagegen` | backgrounds, style | setup |
| Backups & import | — | back up, nightly, keep, restore; SillyTavern import | setup |
| Privacy | — | name shield, exports, vault | setup |
| Account & security | — | password, 2FA, devices, no-password PC | setup |
| Diagnostics | — | report, connections test, model calls, server errors | dev |
| About | — | version, credits | rare |

Per chat: **Chat details** (title, mode, persona, branches, export/import, duplicate, delete).
Per device: **View** (status bar, reply chips, avatars, floating, order, cinematic).

## 8. Feature switches (38)

`packages/engine/src/features.ts`. C = Classic chat, S = Story, F = Full RPG.

| Group | Switches (on in) |
|---|---|
| Game layer | Game layer (S F), Status bar and trackers (S F), Inventory and economy (F), Crafting (F), Map (F), Travel (F), Calendar and time (S F), NPC simulation and schedules (F), Organizations (F), Party (F), Battle (F), Player home (F), Phone and messages (F), Diary (S F), Journal (S F), Databank (S F), Helper (F), Dice (F), Storylines and random events (F), Weather and atmosphere (S F) |
| Story presentation | Stage mode, Scene effects, Cutscenes, Music, Ambience, Live2D, 3D characters, Puppets (all S F) |
| AI helpers | **Tracker pass** (S F), **Scene block** (S F), Off-screen life (F), **Pre-read** (F) |
| Tools | Scripts, Extensions, Interactive message cards, Online character sources, Voice, Image generation (all C S F) |

Classic chat already hides the game layer entirely in the play screen, but its tools drawer still
shows Prompt inspector, World inspector (with only "Model calls"), Saves, Scripts and Author's
note at the same level as everything else.

## 9. Duplicates (two places for one thing, or two names)

| # | Thing | Places | Decision (see navigation.md) |
|---|---|---|---|
| 1 | Prompt inspector, Author's note, Memory, World inspector, Saves, Cinematic mode, Scripts | ⋯ menu **and** drawer | one palette; ⋯ menu removed |
| 2 | Memory | ⋯ (ungated) and drawer (gated) | palette only, gated |
| 3 | Cinematic mode | ⋯, drawer, View sheet | palette + View |
| 4 | Auto-tracking on/off | switch "Tracker pass" **and** "Tracker mode: … / Off" | switch turns it on and off; the setting only picks *how* |
| 5 | Story state in the prompt | switch "Scene block" **and** "Send game state to the model" | the switch; the setting keeps only the size |
| 6 | Read my message first | switch "Pre-read" **and** Game "Read my message first" | one name; the Game row shows only with the switch on |
| 7 | Off-screen life | switch **and** Game row | as 6 |
| 8 | Dice | switch "Dice" **and** "Skill checks with real odds" | as 6 |
| 9 | Scene effects | switch, stage button (ungated), Atmosphere › Effects, Stage & sound › Scene | gated everywhere; one name |
| 10 | Storylines | switch **and** three Game rows | as 6 |
| 11 | Memory | Features › Memory, Game › Memory (9), Memory sheet | Memory sheet links to its settings |
| 12 | Weather overlay, particles | Game › Helper and atmosphere **and** Atmosphere tool, other names | Atmosphere tool only, one name |
| 13 | Voice | switch, Chat "Voice input" and "Read aloud", Voice page, Connections | dictation and read-aloud follow the switch |
| 14 | Scripts | switch and Settings › Scripts "Allow scripts" | page hidden with the switch off |
| 15 | Interactive HTML | switch and Scripts "Show HTML in messages" | kept (one is the module, the other a display choice), described |
| 16 | Helper | switch, tool, Game "Show the helper companion" (does nothing) | dead setting removed |
| 17 | Stage vs chat | header toggle, Appearance "New chats open in", switch | kept, one name ("Stage view") |
| 18 | Chat's mode | Features › Mode and Chat details › Mode (Features says "in the chat's menu") | text fixed |
| 19 | Status bar items | Game › HUD and View › Status bar order | both kept; View links to Game |
| 20 | Lore / World info | nav "Lore", Settings "World info", tool keywords "lorebook" | one name: **Lorebooks** |
| 21 | Swipe / Regenerate | message bar, stage, gesture, keys, /swipe | "New version" shown, "Rewrite this version" in More |
| 22 | Continue the reply / Let the story continue | drawer / empty Send | renamed "Make the reply longer" / "Next turn" |
| 23 | Backups | System entry "Backups", page "Backups & import" | one name |
| 24 | Help | drawer "Help", `/help` (command list) | `/help` described as "List the commands" |
| 25 | People | Characters, NPCs, Social, Party, dossier | grouped: People (NPCs), Relationships (Social), Party, Cards in this story (Characters) |
| 26 | Model calls | World inspector and Diagnostics | same name in both, both under Developer |
| 27 | Next-reply preview | Prompt inspector and World inspector › Scene | both under "What the AI sees" |

## 10. Words a player wouldn't know

Swipe, Regenerate, Branch, Hide from prompt, Re-read game changes, Name shield/stand-in,
Prompt inspector, tokens, prompt blocks, Author's note, depth, role System/User/Assistant, World
inspector, Scene block, Health, "It's…", Cinematic mode, Stage mode, "Let the story continue",
Impersonate, /sendas, /sys, /trigger, /flushvar, Databank, NPCs, Orgs, "Meanwhile…",
Sovereign, HP/MP/AP/XP, Tracker pass, Pre-read, Off-screen life, Interactive message cards,
Tracker mode "Separate pass / Inline tags", Scene block budget, World engine Cheap/Balanced/Max,
background call, Search by meaning, Gossip, Chronicler, Fold summaries, Utility model,
Background model, Embeddings, Squash system messages, Assistant prefill, Scan depth, Min
activations, Recursive scanning, Semantic retrieval, Regex rules, Tavern Helper globals, Safe
mode, Part packs, MPFB, Browser bridge, Device token, Recorded fixtures, JSONL, Vault, Recovery
key, 2FA.

Each now has a plain name or a one-line explanation; see [glossary.md](glossary.md).
