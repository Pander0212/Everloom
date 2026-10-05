# Scripting

Everloom runs JavaScript from you and from creators: scripts in character cards, presets and
lorebooks, your own scripts, interactive HTML inside messages, and extensions
([extensions.md](extensions.md)). This page covers how scripts run, what they can do, and how to
write one.

## How a script runs

Every script runs in its own **sandboxed frame**: an `<iframe sandbox="allow-scripts">` loading
`/api/sandbox/frame`. Without `allow-same-origin` the frame has an opaque origin, so it has no
cookies, no browser storage and no access to the Everloom page around it. Its Content-Security-Policy
forbids every network request (`connect-src 'none'`, pictures and media only as `data:`/`blob:`), so
it can't send anything anywhere on its own.

The only way out is `postMessage` to Everloom. Everloom checks each call against the permissions the
owner approved before doing anything. Model calls, internet access and the script's own storage are
checked a second time on the server, against the script's current approval.

Scripts never see API keys, settings, accounts, sessions, backups, other users' data, the extension
manager or the database.

### Approval

A card, preset or lorebook that brings scripts, SillyTavern regex rules or scripts in its messages
**imports with them off**. The chat shows "… has scripts that are off — Review", and the review
sheet shows each script's code (with highlighting), the permissions it asks for in plain words,
when it runs, and three choices:

- **Enable**: approved until the code or its permissions change. A changed script asks again.
- **Enable once**: until you sign out or the server restarts.
- **Keep disabled**.

You can also trust a creator, so their characters' scripts are approved on import.

Scripts you write yourself (Settings › Scripts, or the character editor's Scripts tab) are approved
as you save them. Imported script files wait for review like scripts from cards.

### Safeguards

- **Kill switch:** Settings › Scripts › Allow scripts. Off, nothing runs anywhere.
- **Safe mode:** add `?safe=1` (or `?safe-mode`) to the address. Scripts, extensions, message
  scripts and custom CSS are all off for the session.
- **Loop guard:** every loop gets a time check; a task running longer than its budget (1.5 s by
  default) is stopped with an error, even if the script catches errors inside the loop.
- **Watchdog:** frames answer a ping every two seconds. A frame that stops answering for 8 s is
  removed and its console says so.
- **How many at once:** six script frames per chat by default. Message frames mount only when you
  scroll near them.
- **Model calls:** six per minute per script by default, 500 a day for all scripts. They show in the
  call log as `script: <name>`.
- **Console:** chat menu › Scripts shows each script's console and errors, with Stop and Restart.

**Honest limits.** The loop guard catches loops, not deep recursion or a deliberately hostile
script; in browsers that run sandboxed frames on the page's own thread, such a script can freeze
the tab until the watchdog removes it, and a hostile one can do so again. Reload with `?safe=1` to
get out. Permissions decide what a script can reach, not what it shows: an approved script could
draw a convincing fake dialog inside its own frame, so only approve scripts you trust. A frame can
always use the CPU and memory your browser gives it.

## Where scripts live

| Where | Stored in | Notes |
|---|---|---|
| Your scripts | Settings › Scripts | Approved when you save. Can run "when Everloom opens". |
| A character | The card, `extensions.everloom_scripts.scripts` | Travels with exports. Edit in the character editor › Scripts. |
| A preset | The preset, `extensions.everloom_scripts` | Runs in chats using that preset. |
| A lorebook | The book, `extensions.everloom_scripts` | Can run when one of its entries activates (`entryActivated` with `entries: ["12"]`). |
| Messages | The message text | ```` ```html ```` blocks, `<everloom-html>…</everloom-html>` (tag configurable), or a whole `<html>` document. |
| Extensions | Installed packages | See [extensions.md](extensions.md). |

Cards made for **Tavern Helper** keep their scripts in `extensions.TavernHelper_scripts`; Everloom
reads those as compatibility scripts (see below) and works out the permissions they need from the
functions they call.

### A script's fields

```json
{
  "id": "status",
  "name": "Status bar",
  "description": "Shows HP above the message box",
  "code": "everloom.on('message', async () => { … });",
  "permissions": ["chat.read", "variables", "ui.panel"],
  "domains": [],
  "triggers": ["chatOpen", "button"],
  "intervalSeconds": 60,
  "entries": ["12"],
  "buttons": [{ "id": "b0", "label": "Status" }],
  "enabled": true,
  "compat": false
}
```

Every script in a chat starts when the chat opens (scripts with only `load` run app-wide instead).
`triggers` say which events it is there for: `button` puts its buttons above the message box,
`timer` sends a `timer` event every `intervalSeconds`, `entryActivated` delivers the activated
entries of its own lorebook. Scripts are exported and imported as JSON.

## Permissions

| Permission | Allows |
|---|---|
| `chat.read` | Messages, the character and your persona; message text in events |
| `chat.write` | Send (runs a normal reply), add, edit, hide, delete messages; swipe |
| `variables` | Chat, character, message and global variables; `{{script::…}}` values |
| `lorebook.read` / `lorebook.write` | Lorebooks and their entries |
| `state.read` | The game state |
| `state.ops` | Propose game changes (checked like the AI's, rolled back with their message) |
| `generate` | Model calls on your connection (costs money; rate-limited; logged) |
| `ui.panel` | Notices, panels, dialogs, buttons |
| `audio` | Play `data:` audio or Everloom media |
| `storage` | A private key-value store (64 KB per value, 1 MB per script) |
| `network` | `https` only, to the listed domains, fetched by the server (1 MB) |

## The `everloom` API

Types: `packages/script-types/index.d.ts`. Everything is promise based.

```js
everloom.context            // { chatId, characterId, messageId, messageIndex, scriptName, kind, permissions }
everloom.on('message', (e) => …)      // also: chatOpen, beforeGeneration, generationStart, generationEnd,
                                      // messageSent, swipe, edit, delete, button, timer, entryActivated, vars
await everloom.chat.messages({ last: 10 })
await everloom.chat.send('I open the door.')          // a normal turn, reply included
await everloom.chat.add({ role: 'system', text: 'Night falls.' })
await everloom.generate({ prompt: 'Name a tavern', model: 'utility' })
await everloom.generate({ userInput: 'What happens next?', onToken: (piece, full) => … })
await everloom.vars.set('hp', 9, { scope: 'message' })   // chat (default), character, global, message, script
await everloom.lore.entries('World of Ash')
await everloom.state.propose({ type: 'item.add', name: 'Rope', qty: 1 })
await everloom.ui.toast('Saved')
const r = await everloom.ui.modal({ title: 'Pick', fields: [{ id: 'n', label: 'Name' }], buttons: [{ id: 'ok', label: 'OK', tone: 'primary' }] })
await everloom.ui.panel({ title: 'Map', html: '<div class="ev-card">…</div>' })
await everloom.storage.set('seen', true)
await everloom.net.fetch('https://api.example.com/x')
await everloom.slash.register('heal', { help: 'Heal 5' }, async (call) => …)
await everloom.macros.set('weather', 'storm')            // {{script::weather}} in prompts
```

`beforeGeneration` handlers may return a promise; Everloom waits up to 3 s before sending the turn,
so a script can update variables the prompt uses.

### Variables

| Scope | Lives in | Macro |
|---|---|---|
| chat | the chat | `{{getvar::x}}`, `{{setvar::x::v}}` |
| character | the server, per character | `{{getcharvar::x}}`, `{{setcharvar::x::v}}` |
| global | the server | `{{getglobalvar::x}}`, `{{setglobalvar::x::v}}` |
| message | the message's current swipe | `{{getmesvar::x}}` (read-only in macros) |
| script | the script's storage | — |

Message variables are stored on the swipe that set them, and a message's value is everything set
up to it along each message's current swipe, so they follow swipes, edits and deletions with no
extra bookkeeping.

### Interactive messages

HTML blocks render in sandboxed frames inside the message, with the design tokens passed in (the
`ev-card`, `ev-btn`, `ev-input`, `ev-chip`, `ev-row`, `ev-stack`, `ev-muted`, `ev-bar` classes look
native). Frames size themselves to their content and mount when scrolled near. Pictures from the
web in the HTML are fetched through Everloom's image proxy and inlined; pictures a script adds
later can't load (the frame can't reach the network).

Scripts inside messages run with the **message permissions** of the character (declared as
`extensions.everloom_scripts.messagePermissions`, or worked out from the code for imported cards),
once approved. Settings › Scripts › Scripts inside messages can also be "always" (no permissions
unless approved) or "never". Each block has a **Show as code** toggle, and Settings › Scripts ›
Show HTML in messages turns rendering off everywhere.

### Regex rules

SillyTavern-format find/replace rules (`scriptName`, `findRegex`, `replaceString`, `trimStrings`,
`placement` 1 = your input, 2 = AI output, 5 = world info, `markdownOnly`, `promptOnly`,
`minDepth`/`maxDepth`, `substituteRegex`, `runOnEdit`). Scopes: yours (Settings › Scripts), a
character's (`extensions.regex_scripts`), a preset's, an extension's. Rules change the stored text,
only what is shown, or only what is sent. `$1`, `$<name>` and `{{match}}` insert what was found;
macros work in the replacement. Rules from cards and presets need approval like scripts.

### Slash commands

Type `/` in the message box for the list. `|` chains commands; each result is `{{pipe}}` for the
next (and its text when it has none). `//text` sends text that starts with a slash.

`/roll 2d6+1`, `/sys`, `/send`, `/sendas name=…`, `/trigger`, `/continue`, `/swipe`, `/impersonate`,
`/stop`, `/gen`, `/setvar key=… value`, `/getvar`, `/addvar`, `/incvar`, `/decvar`, `/flushvar`,
`/setglobalvar`, `/getglobalvar`, `/travel`, `/give qty=2 …`, `/take`, `/money`, `/wait`,
`/qr <label>`, `/run <button>`, `/echo`, `/len`, `/help`. Scripts and extensions add their own. A
command a script runs is checked against the script's permissions.

This is deliberately smaller than STscript: no closures, loops, scopes or `/if`.

### Quick replies

Sets of buttons above the message box that send text or run a command (start it with `/`), or only
fill the box. Yours are in Settings › Scripts; a character can bring its own
(`extensions.everloom_scripts.quickReplies`).

## Tavern Helper compatibility

For cards written against Tavern Helper's documented global functions, Everloom provides its own
implementation of the most used ones, written from the public documentation (no code from that
project, which is under the PolyForm Noncommercial licence). It runs under the same sandbox and
permission rules as everything else, with no exceptions. Turn it off in Settings › Scripts.

Supported:

- **Variables:** `getVariables`, `replaceVariables`, `insertOrAssignVariables`, `insertVariables`,
  `updateVariablesWith`, `deleteVariable` (types `chat`, `global`, `character`, `message` with
  `message_id`, `script`).
- **Messages:** `getChatMessages` (ranges like `0-5`, `-1`, `{{lastMessageId}}`; `role`,
  `hide_state`, `include_swipes`), `setChatMessages`, `setChatMessage`, `createChatMessages`,
  `deleteChatMessages`, `getCurrentMessageId`, `getLastMessageId`, `getMessageId`.
- **Events:** `eventOn`, `eventOnce`, `eventMakeFirst`, `eventMakeLast`, `eventEmit` (within the
  frame), `eventRemoveListener`, `eventClearEvent`, `eventClearListener`, `eventClearAll`;
  `tavern_events` (message received/sent/swiped/edited/deleted, chat changed, generation
  started/ended, message rendered) and `iframe_events` (stream tokens, generation start/end).
- **Generation:** `generate` (`user_input`, `should_stream`), `generateRaw` (`ordered_prompts` with
  `user_input`, `chat_history` and literal `{role, content}` items).
- **Lorebooks:** `getLorebooks`, `getCharLorebooks`, `getCurrentCharPrimaryLorebook`,
  `getLorebookEntries`, `setLorebookEntries`, `createLorebookEntries`, `deleteLorebookEntries`.
- **Other:** `triggerSlash` (Everloom's commands, not STscript), `substitudeMacros` (user, char,
  getvar, getglobalvar, lastMessageId), `errorCatched`, `getIframeName`, `getScriptId`,
  `toastr.success/info/warning/error`, a minimal `SillyTavern.getContext()` (chat, names).
- **Libraries:** a small `$`/`jQuery` (selectors, events, text/html/val/attr/css, classes,
  append/prepend/find/remove, show/hide, data, closest/parent/children) and a small `_` (get, set,
  has, unset, cloneDeep, isEqual, merge, clamp, isPlainObject, isEmpty, debounce, uniq, sum). They
  are subsets, not the real libraries.

Reads that Tavern Helper answers synchronously (variables, `getChatMessages`) come from a snapshot
taken when the frame starts and kept up to date by events; writes go through the bridge.

Not supported: STscript itself, `SillyTavern` internals beyond the minimal context, presets and
character editing APIs, audio APIs, `importRawCharacter` and the other import functions, raw
`jQuery` plugins, network requests outside `everloom.net.fetch`, script buttons' dynamic
`replaceScriptButtons`. A card relying on those shows its errors in the script console.

Tested against card scripts written for the tests in the style of public cards (variables,
`eventOn(tavern_events.MESSAGE_RECEIVED, …)`, jQuery-style DOM, `toastr`, `_.get`/`_.set`); the
build environment can't download real cards, so check yours in the console.
