# Features from Hakawati: what was adopted, merged or skipped

[Hakawati](https://github.com/rakanssh/hakawati) (GPL-3.0) was read for ideas (commit `e3abf0a`,
2026-10-06). Everything below was built clean-room for Everloom; none of Hakawati's code, CSS or
art is in this repository. Decisions with reasons are also in
[PHASE2_DECISIONS.md](../PHASE2_DECISIONS.md#design-and-ux-features-from-hakawati-october-2026).

| Feature | Decision | What Everloom has now |
|---|---|---|
| Input modes | **Adopted** | A small switch beside the message box: Chat (plain, the default), **Act**, **Say**, **Story**, **Direct**; **Continue** is sending an empty box. |
| Scenario questions | **Adopted** | `${Question?}`, `${Q? \| options: A, B}` (suggestions), `${Q? \| choices: A, B}` (one of these) in cards and scenarios, asked before a story starts. |
| Quickstart | **Adopted** | New chat › Quickstart (or Tools › Create › Quickstart): an idea or a genre → a character, the opening and, in Story or Full RPG, the world. Steps and a timer; Cancel keeps the setup. |
| Scenarios | **Adopted** | Tools › Create › Scenarios: reusable starting points, each story gets its own copy, JSON import and export by clipboard or file, and This chat › Save as a scenario. |
| Story cards | **Merged** with lorebooks | The chat's own lorebook, shown as cards (character, place, thing, idea) with trigger words or a pin, and "Make cards from the story". |
| Story panel | **Adopted** | Beside the story on a desktop (resizable), a sheet on a phone: Story, Cards, Character, AI, Display. |
| Edit in place, undo/redo turns | **Adopted** (edit merged) | Editing already happened in place; the editor now opens at the text's height. Undo/redo for turns with their story changes. |
| Thinking levels | **Merged** | Everloom already saved reasoning effort per connection (one provider and model). The story panel's AI tab sets it in one tap: Off, Low, Medium, High. |
| Dictation | **Merged** | The browser's speech recognition was already there; dictation through the voice connection (OpenAI-compatible transcription, e.g. Whisper) is added. |
| Interface scaling | **Adopted** | Ctrl/⌘ + plus/minus/0 for the interface (50–200%, per device), Ctrl/⌘ + wheel over the story for its text size; also in Settings › Appearance & themes. |
| Backup before upgrading | **Checked, gap closed** | Everloom already copied the database before migrating (and `update.sh` and the Windows updater back up first). Now all pending migrations run as one step, so a failure changes nothing, and the error says where the copy is and how to get back. |
| Continue with ChatGPT | **Researched, not built yet** | See below. |
| Right-to-left languages | **Skipped** | Everloom has no translations yet; to be done with them. |

## Input modes

| Mode | You write | The AI reads | The story shows |
|---|---|---|---|
| Chat | anything | it as written | a message bubble, as before |
| Act | `open the door` | `*open the door*` | in italics |
| Say | `We leave at dawn` | `"We leave at dawn"` | in quotes |
| Story | narration | your narration, marked as written by you and to be continued from | as narration, marked "Your narration" |
| Direct | `Make it scarier` | an out-of-character direction for the next reply | a quiet "Direction:" note |
| Continue | nothing (empty box) | a request for the next part | the next reply |

The text is stored as you wrote it, with its mode on the message (`extra.inputMode`); the framing is
applied when the prompt is built, so changing how a mode is framed changes old turns too. The mode
is remembered on the device. Scripts sending messages always send plain chat.

## Scenario questions

- Asked in **New chat** (for a card) and when **starting a scenario**, in a short form: free text
  with suggestions as tappable chips, or a list for fixed choices. Start stays off until every
  question has an answer.
- Answers are stored on the chat (`metadata.answers`) and filled into that chat's copy of the card
  (description, personality, scenario, greetings, examples, system prompt) and its greeting. The
  card itself never changes. The same question asked twice is one question.
- Placeholders are text only; nothing inside them runs (a test checks).

## Quickstart

1. *Writing the character and the opening* (one utility-model call, `POST /api/quickstart/draft`;
   nothing saved yet).
2. *Making the character* (saved like any other).
3. *Starting the chat* in the chosen mode, with the opening as its greeting.
4. *Building the world* (Story and Full RPG): the game setup is filled from the premise, as in New
   game setup.

Each step shows as it runs, with a timer. Cancel stops at once, deletes whatever was already made
and leaves the idea, genre and mode in the form.

## Scenarios

A scenario holds a title, a line about it, a cover, a character (or one picked when starting), the
opening, how the narrator should run it, where the plot should go (the narrator's eyes only), a note
to the AI, the mode, a starting kit (money, items, place) and story cards. Starting one copies
everything into the new chat: the opening as its first message, the note, the instructions and plot
(sent to the narrator), the cards as the chat's own lorebook, the kit as the game's starting state.
Editing or deleting the scenario afterwards leaves those stories as they are (a server test checks).

## Story cards

The cards are the chat's own lorebook (scope "this chat"), so the lorebook editor, world info
activation, budgets and semantic search all apply unchanged; a card's type is stored on the entry
(`cardType`). Pinned cards are lorebook "constant" entries. "Make cards from the story" sends the last
30 messages to the utility model and proposes up to five new cards, which you keep or discard.

## Undo and redo

Undo takes the last turn away (your last message and the replies after it; never the opening) and
rolls back its story changes, exactly as deleting it does. Redo puts the same messages back, with all
their versions, and reads their story changes again (one tracker call per reply). Up to 50 turns per
chat, until the page reloads; sending a new turn clears what can be redone. Tools › Undo last turn /
Redo turn, Ctrl/⌘+Z and Ctrl/⌘+Shift+Z (Ctrl+Y) outside text fields, and a Redo button on the
"Turn undone" notice.

## Continue with ChatGPT

Researched on 2026-10-09 (sources in the decisions doc). OpenAI now offers **Sign in with ChatGPT**
with **ChatGPT plan usage** (announced at DevDay, 2026-09-29, in preview): open-source and locally
run apps may use it without approval; each user's installation gets its own client id through
dynamic registration, so no other product's client id or credentials are involved. Inference goes
through the public Responses API. Hosted or commercial apps need OpenAI's approval.

Not built yet, because:

- the sign-in must return to `127.0.0.1` on the machine running the browser, while Everloom usually
  runs on a VPS and is used from a phone; OpenAI's documented route for a remote server is to sign in
  on a computer and copy a credentials file to the server, which needs its own careful design;
- it is a preview with usage limits and errors of its own, and it can't be tested from here without
  a ChatGPT Plus or Pro account;
- the Windows app is the natural first home for it (Everloom runs on the same machine as the browser).

Reusing another product's client id (for example the Codex CLI's) was ruled out, as the prompt and
OpenAI's documentation require.
