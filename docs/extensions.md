# Extensions

An extension is a folder (or a zip, or a Git repository) with an `everloom-extension.json`
manifest. Install from **Settings › Extensions**: from a zip (works from a phone too), a GitHub,
GitLab or Codeberg address, or, while developing, a folder on the server that reloads as you save.

Everloom shows what an extension asks for before anything is saved, and again when an update asks
for more. Extensions run in the same sandbox as scripts ([scripting.md](scripting.md)) with the same
permission bridge.

## Start one

```sh
node tools/create-everloom-extension my-extension --name "My extension"
```

Then Settings › Extensions › Developing an extension › enter the folder (it must be inside
`EVERLOOM_IMPORT_ROOTS`, your home folder by default). Everloom reloads it whenever a file changes.
Types for editors: `packages/script-types` (`/// <reference types="@everloom/script-types" />`).

Three examples are in `examples/extensions`:

- **dice-roller**: a panel, a `/dice` command with keep-highest/lowest and exploding dice, and a
  composer button.
- **relationship-chart**: a screen (and panel) that charts relationships from the game state.
- **town-reputation**: a custom game op with rollback, a panel, `/rep`, and a prompt block.

## The manifest

```json
{
  "id": "town-reputation",
  "name": "Town reputation",
  "version": "1.0.0",
  "author": "You",
  "homepage": "https://example.com",
  "description": "One sentence.",
  "minEverloom": "0.1.0",
  "changelog": "What changed in this version.",
  "permissions": ["state.read", "state.ops", "ui.panel", "variables"],
  "domains": [],
  "entries": {
    "background": "background.js",
    "panels": [{ "id": "towns", "title": "Town reputation", "file": "panel.html", "icon": "landmark", "tile": true }],
    "screens": [{ "id": "chart", "title": "Relationships", "file": "chart.html" }],
    "settings": "settings.html",
    "composerButtons": [{ "id": "d20", "label": "Roll d20" }],
    "slashCommands": [{ "name": "rep", "help": "Change your reputation", "usage": "/rep Eastport +5" }],
    "promptBlocks": [{ "id": "standing", "text": "[Town reputation: {{script::townrep}}]", "position": "depth", "depth": 2, "role": "system" }],
    "messageRenderers": [{ "tag": "dice", "file": "render.html" }],
    "macros": ["townrep"],
    "ops": [ … ],
    "regex": [ … ]
  },
  "server": { "main": "server.js" }
}
```

### Entry points

| Entry | What it does |
|---|---|
| `background` | A `.js` or `.html` file that runs hidden in each chat while the extension is on. Event hooks (`everloom.on`), slash commands (`everloom.slash.register`), composer buttons (the `button` event with the button's id), macro values (`everloom.macros.set`). |
| `panels` | Pages opened in a side sheet. With `tile` (the default) they appear in the chat's actions menu. |
| `screens` | Full pages at `/x/<id>/<screen>`, also listed in the actions menu. |
| `settings` | A page under Settings › Extensions › the extension's gear button. |
| `composerButtons` | Buttons above the message box; pressing one sends `button` to the background. |
| `slashCommands` | Listed for documentation; the background registers them. |
| `promptBlocks` | Text added to every prompt: at the top (`before`), at the end (`after`) or at a `depth`. Macros work, including `{{script::name}}`. |
| `messageRenderers` | `<tag>…</tag>` in messages is drawn by the page, which reads the text from `everloom.context.content`. |
| `macros` | Names the extension publishes with `everloom.macros.set` (documentation). |
| `ops` | Custom game ops (below). |
| `regex` | SillyTavern-format regex rules. |

HTML pages can reference their own `.js`, `.css` and pictures with relative paths; Everloom inlines
them, since a sandboxed frame can't load anything by address. Everything else in the page is as you
wrote it, styled with the injected design tokens and the `ev-*` classes listed in scripting.md.

### Custom game ops

Ops are **declarative**, so no extension code runs inside the game's reducer and every op rolls back
like a built-in one (the reducer records the inverse as it applies the steps):

```json
{
  "name": "change",
  "label": "Town reputation",
  "description": "Change how a town sees the player",
  "params": { "town": { "type": "string", "maxLength": 60 }, "amount": { "type": "integer", "min": -20, "max": 20 } },
  "steps": [
    { "do": "add", "path": "/towns/{town}", "value": "{amount}", "min": -100, "max": 100 },
    { "do": "push", "path": "/history", "value": "{town} {amount}", "limit": 30 }
  ],
  "summary": "Reputation in {town} {amount:+}",
  "ai": true
}
```

- `params` are checked like any op's arguments (types, ranges, lengths, enum values); unknown
  arguments are refused.
- `steps` work on `state.ext["<extension id>"]` only: `set`, `add` (with optional clamping), `push`
  (with an optional `limit`), `delete`, and `require` (checks run first; if one fails the op is
  refused and nothing changes). Paths use `{param}` placeholders, which can't climb out of the
  extension's corner (`__proto__` and friends are refused).
- `summary` is the change notice; `{param:+}` shows a sign.
- `ai: true` adds the op to the story AI's op list; without it only the player and scripts can use
  it.

Use one as `{ "type": "ext.op", "ext": "town-reputation", "name": "change", "args": { … } }` from
`everloom.state.propose`, the `/api/campaigns/:id/ops` route, or the AI's tracker. Ops from scripts
are tied to the newest message and its swipe, and go away with them.

## Updating, turning off, uninstalling

- **Update**: extensions installed from a Git address have a refresh button; zips are updated by
  installing the new zip. The dialog shows the version change, any new permissions or sites, and
  the changelog.
- **Changed files** (a dev folder aside) need approval again before the extension runs.
- **Off** stops it everywhere; its data stays.
- **Uninstall** removes its files and, unless you keep it, its stored data. Game changes it already
  made stay in your stories: Everloom keeps its op definitions so those stories still replay and
  roll back exactly, but nothing new can use them (and the AI isn't offered them). The same goes for
  an extension that is turned off.
- Each extension has an error log (its frames' errors and its server part's).

## Server extensions (power users)

An extension can include a Node module (`server.main`): API routes at `/api/ext/<id>/…` and timed
jobs. It runs with full server privileges, so:

- the server must be started with `EVERLOOM_SERVER_EXTENSIONS=1`;
- only the server's first account can install one, after a warning that shows the code;
- each runs in its own Node process with no database handle, keys or session; a crash restarts it
  (three crashes in ten minutes stop it);
- the main file must be a single bundled ES module:

```js
export default function (api) {
  api.route('GET', '/hello/:name', ({ params }) => ({ hello: params.name }));
  api.every(60_000, () => api.log('still here'));
}
```

## SillyTavern extensions

SillyTavern UI extensions depend on SillyTavern's page, its jQuery globals and its internals, so they
can't run in Everloom. Cards written for Tavern Helper work through the compatibility layer
([scripting.md](scripting.md#tavern-helper-compatibility)); for extensions, port them to the API above
(most UI code maps onto a panel plus `everloom.on`).
