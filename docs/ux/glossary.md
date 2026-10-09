# Glossary

One name for each thing, in the app, in Help and in these docs. The list lives in
`apps/web/src/lib/glossary.ts` (the app's Help › Words shows it) and a test checks that every term
is here. *Also called* lists older Everloom names and the words SillyTavern and other apps use, so
search finds them.

| Term | What it means | Also called |
|---|---|---|
| **Tools** | The button next to the message box (Ctrl/⌘K on a computer) that finds every tool, setting, place, item and person by name. | Actions and tools, command menu, the "+" button |
| **Pinned** | The tools at the top of Tools, chosen by you (Edit pins). |  |
| **Version** | One of the AI's replies to the same turn. › makes a new version; ‹ › move between them. The story state follows the version you keep. | swipe |
| **Rewrite this version** | Replaces the version on screen with a new one, instead of adding another. | Regenerate |
| **Continue the story** | Send with an empty message box: the AI writes the next part without anything from you. | Let the story continue |
| **Make the reply longer** | The AI keeps writing the last reply. | Continue the reply, /continue |
| **Write my next line** | The AI drafts your next message in the box, for you to change and send. | Impersonate |
| **Branch** | A new chat that goes on from a message; the original stays as it was. |  |
| **Hide from the AI** | The message stays on screen but the AI no longer reads it. | Hide from prompt |
| **This chat** | A chat's own settings: title, model, mode, persona, branches, export. Tap the chat's title. | Chat details |
| **Mode** | How much of Everloom a chat uses: Classic chat, Story or Full RPG. | feature preset |
| **Classic chat** | A plain roleplay chat: character, persona, lorebooks. One AI call per reply, no game. |  |
| **Story** | Classic chat plus memory, light tracking and the stage. |  |
| **Full RPG** | Everything: items, money, the map, people, quests, battles. |  |
| **Feature** | A part of Everloom you can switch off in Settings › Features. Off means gone: no buttons, no extra AI calls. | module |
| **Story state** | Everything the game keeps track of: time, places, people, items, quests, feelings. Every change can be undone. | World inspector, game state, ops |
| **Story changes** | The list of every change the story made, each with Undo. | World inspector › Changes |
| **Story problems** | Things in the story state that look wrong (like a name that matches nobody), each with a fix. | World inspector › Health |
| **Auto-tracking** | After each reply, a small extra AI call notes what changed: items, time, places, feelings. | Tracker pass, tracker |
| **What the AI sees** | The story state (time, place, who is here, what each person knows) given to the AI with every reply. | Scene block |
| **Everything sent to the AI** | The exact text the AI read for the last reply, piece by piece, with sizes. | Prompt inspector |
| **Read my message first** | An AI call that reads your message before the reply, for where you go and how long it takes. Adds a little delay. | Pre-read |
| **Off-screen life** | Now and then, an AI call in the background for what people do while you are away. |  |
| **Facts** | Things the story has established, which the AI keeps to. | Databank |
| **People** | Everyone in a story's world: where they are, what they do. | NPCs |
| **Relationships** | How people feel about you, and about each other. | Social |
| **Story cast** | The character cards a chat uses. | Characters (tool) |
| **Outfits** | The clothes you own, with Wear and Take off. |  |
| **Weather & mood** | The weather, the time-of-day tint and particles over the story. | Atmosphere |
| **Memory** | A summary of the story so far that the AI reads every turn. |  |
| **Note to the AI** | A standing instruction the AI reads every reply, like "short replies". | Author's note |
| **Lorebook** | Entries the AI reads when their keywords come up in the story. | World info, Lore |
| **Persona** | The character you play. |  |
| **Stage view** | A scene shown like a visual novel, one line at a time, with pictures. | Stage mode |
| **Cinematic mode** | Only the story on screen, nothing else. Esc leaves it. |  |
| **Main model** | The AI that writes the story. |  |
| **Utility model** | An optional cheaper AI for small jobs: tracking, summaries, the helper. |  |
| **Token** | The unit AI services count text in; about three quarters of a word. |  |
| **Name shield** | Swaps real names for stand-ins before anything leaves your server, and back when replies arrive. |  |
| **Vault** | Encrypts everything Everloom stores; it opens with your passphrase. |  |
| **Simple and Advanced** | The two views of Settings: Simple shows what most people need, Advanced shows everything. |  |
| **Experimental** | Test pages for building Everloom itself, hidden unless switched on in Settings › Features. |  |

