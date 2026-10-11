# Task tests: taps and time on a phone

Nine common tasks, done by Playwright on a 390×844 touch phone in a Full RPG chat, before the
redesign and after. Each task starts on the play screen after the chat has loaded and follows the
shortest path a player can see.

- **Taps** count every tap; typing into a field counts as one tap (focusing it). A native select
  counts two (open, choose).
- **Scrolls** count controls that were off screen when it was time to tap them (measured once
  sheets and drawers have stopped moving).
- **Time** is how long the automated run took, which is mostly animations and server round trips,
  not thinking time. It is reported for completeness; taps and scrolls are the measure.

Run: `npx playwright test --config playwright.ux.config.ts` (after, current build), and with
`UX_LABEL=before E2E_WEB_DIR=<apps/web/dist built from commit ad35fed>` for the before numbers
(the server is today's; the old web app talks to it unchanged). Results are in
[evidence/tasks-before.json](evidence/tasks-before.json),
[evidence/tasks-after.json](evidence/tasks-after.json) and the `controls-*.json` files next to them.

## Results

| Task | Before: path | Taps | Scrolls | After: path | Taps | Scrolls |
|---|---|---|---|---|---|---|
| Send a message and swipe | box · Send · New swipe | 3 | 0 | box · Send · New version | 3 | 0 |
| Edit a message | ⋯ · Edit · text · Save | 4 | 0 | Edit · text · Save | **3** | 0 |
| Change the character's outfit | + · Inventory · Summer dress · Equip | 4 | 0 | Tools · Outfits · Wear Summer dress | **3** | 0 |
| Open the map and travel | + · Map · Eastport · Travel here | 4 | 0 | the place in the status bar · Eastport · Travel here | **3** | 0 |
| Check the inventory | + · Inventory | 2 | 0 | Tools · Inventory (pinned) | 2 | 0 |
| Change the model | Back · Settings · Connections · Main model (2) | 5 | 1 | the chat's title · Model (2) | **3** | **0** |
| Turn a feature off | Back · Settings · Features · Diary | 4 | 1 | Tools · "diary" · the Diary switch | **3** | **0** |
| Find the memory screen | ⋯ · Memory | 2 | 0 | Tools · Memory (pinned) | 2 | 0 |
| Start a new chat with a character | Back · New chat · Iris · Start chat | 4 | 0 | Tools · New chat with this character · Start chat | **3** | 0 |
| **Total** | | **32** | **2** | | **25** | **0** |

Seven of nine tasks take one or two fewer taps; none takes more; nothing needs a scroll any more.

| Time (ms, automated) | Before | After |
|---|---|---|
| Send a message and swipe | 1129 | 1381 |
| Edit a message | 915 | 655 |
| Change the character's outfit | 2631 | 2010 |
| Open the map and travel | 2787 | 2092 |
| Check the inventory | 1345 | 1400 |
| Change the model | 1289 | 980 |
| Turn a feature off | 1804 | 1316 |
| Find the memory screen | 527 | 1292 |
| Start a new chat with a character | 1631 | 1861 |
| **Total** | **14 058** | **12 987** |

The two slower ones open the Tools drawer (a slide-up animation) where the old path opened a small
menu; the old Memory path was two menu taps with no animation.

## Visible controls on the play screen

(Measured after Part 3, which added the input-mode switch beside the message box; before it the
count was 15.)

Counted on the same phone after one turn: buttons, links and fields inside the screen that are
visible and not covered.

| Before (20) | After (16) |
|---|---|
| Back, title, Find in chat, Switch to stage mode, Chat menu, Status bar, Message actions ×3, Previous swipe, New swipe, Regenerate, Tobias, Everyone, Emote, Suggest, Actions and tools, Message, Dictate, Let the story continue | Back, title, Switch to stage view, the place (map), Status bar, New version, Edit, More actions, Tobias, Everyone, Suggest, Tools, Input mode, Message, Dictate, Continue the story |

## Notes on the method

- The first "before" run counted scrolls while sheets were still sliding in, and counted buttons
  inside invisible (transparent) rows as visible. Both were fixed in the probe and the before
  numbers re-measured with the old build; the numbers above are from the fixed probe. The fixed
  count also caught a bug in a draft of the new message actions (hidden rows could still be tapped
  on a touch screen), fixed before release: hidden rows take no taps until shown.
- The palette's search is counted as one tap for typing, like any field.
