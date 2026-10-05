# Everloom

A self-hosted AI roleplay app for your phone, with a game layer built in.

- **Roleplay frontend** — character cards (SillyTavern V1/V2/V3, PNG/WebP/JSON, round-trip), personas, lorebooks with SillyTavern-style World Info activation, presets with a prompt manager and inspector, macros, group chats, streaming, swipes, edit/branch/continue/impersonate, search, bookmarks, reasoning, memory summaries, voice and image generation. Works with OpenAI-compatible APIs (OpenRouter, DeepSeek, local servers…), Anthropic, Google Gemini and text-completion backends.
- **Game layer** — after each reply a small model updates the game: time, weather, needs, items, money, quests, people, places, organizations and relationships. Every change is tied to the message and swipe that caused it, so swiping, editing, deleting or branching rolls the game back exactly. Time passing simulates the world (schedules, weather, birthdays, rumors, phone texts). There's a map with travel by 22 modes, transit lines with timetables and tickets, and routes that explain what's in the way; homes with rooms, storage and a household; shops, currencies, banking, bills and owned assets; crafting (cooking, alchemy, forge, enchantment); a party with a leader, formations, tactics, classes and a skill tree; turn-based battles with enemy intents, break gauges and reserve swaps; a phone (or a fantasy codex) with texts, calls, letters, email, a feed, an in-world browser and your own apps; a journal, calendar, diary, save slots and a New Game wizard.
- **Memory and a living world** — a memory that records who saw what (and who only heard about it), keeps secrets out of the wrong mouths, tracks facts as they change and recalls the right moment when it comes up again, all of it undone exactly by swipes and edits. People keep schedules and goals, talk to each other off-screen, relationships grow at a believable pace, background storylines creep forward, and dice decide risky actions. A World inspector shows what the model saw, every change, every model call, and a health check with fixes.
- **Stage and sound** — a visual-novel stage with sprites placed by the story, scene effects (shake, rain, fog, lightning…), speech bubbles and cutscenes; music playlists that follow the mood, battles, place and time of day with crossfades; ambience (your loops, or generated); character voices including your own reference voices; optional Live2D with lip-sync.
- **Character library** — thousands of characters in a fast, filterable library with collections, batch actions, versions with diffs, duplicate finder, bundles (also SillyTavern zips), a chat history browser, a Character studio that writes and revises cards with you, AI-written lorebook entries, "What should I play?", saving linked images locally, custom CSS with an assistant, a shared asset library, and browsing/importing from Chub, Character Tavern, RisuRealm, Pygmalion, Wyvern, Botbooru, Saucepan and AI Character Cards with one filter language (or all at once), any card link (PNG, JSON, CHARX), or (for sites behind bot protection) a "Send to Everloom" browser bridge.
- **Yours** — one Linux server, your data, your API keys (encrypted on the server, never sent to the browser). Free and MIT licensed.

Everloom listens on port **8787** (so it can sit next to SillyTavern on 8000).

---

## Contents

1. [Install on a VPS](#install-on-a-vps) — or [on Windows](#install-on-windows)
2. [Put it on your home screen](#put-it-on-your-home-screen)
3. [Connect a model](#connect-a-model)
4. [Update, back up, restore](#update-back-up-restore)
5. [Move over from SillyTavern](#move-over-from-sillytavern)
6. [Voice, images, music and Live2D](#voice-images-music-and-live2d)
7. [Configuration](#configuration)
8. [Install without Docker](#install-without-docker)
9. [Development](#development)
10. [Troubleshooting](#troubleshooting)
11. [Security notes](#security-notes)

---

## Install on a VPS

You need a small Linux server (Ubuntu 22.04+/Debian 12+, 1 GB RAM is enough; 2 GB makes the first build faster) and, ideally, a domain name.

### 1. Point your domain at the server

In your DNS provider, add an **A record** for the name you want (for example `rp.example.com`) with your server's IPv4 address. Add an **AAAA** record too if the server has IPv6. Wait until `ping rp.example.com` shows your server's address (usually a few minutes).

> Using Cloudflare? Set the record to **DNS only** (grey cloud) while installing so the certificate can be issued. You can turn the proxy on afterwards with SSL mode **Full (strict)**.

No domain? Two options:

- **Free hostname (recommended):** services like [sslip.io](https://sslip.io) turn your IP into a hostname — for `203.0.113.5` enter `203-0-113-5.sslip.io` as the domain. It needs no sign-up and gets a real certificate, so there's no browser warning and home-screen install works. (These shared services sometimes hit certificate rate limits; a free [DuckDNS](https://www.duckdns.org) subdomain is a reliable alternative.)
- **IP-only mode:** leave the domain empty. You get a self-signed certificate: open `https://your-ip` (no port needed) and accept the browser warning once (Chrome: *Advanced → Proceed*; Safari: *Show Details → visit this website*). Home-screen install works less well.

### 2. Run the installer

```bash
git clone https://github.com/Pander0212/Everloom.git
cd Everloom
bash install.sh
```

The installer:

- installs Docker if it's missing,
- asks for your domain (or uses IP-only mode),
- writes `.env` with a random `EVERLOOM_SECRET_KEY` (this key encrypts your stored API keys — keep a copy),
- finds an existing SillyTavern install and makes it available read-only to the importer,
- builds and starts Everloom behind [Caddy](https://caddyserver.com), which gets and renews the HTTPS certificate automatically,
- adds a nightly host-side backup to cron.

Open `https://your-domain` and create your account. The first account is the owner; sign-up closes after that.

Ports 80 and 443 must be free and open in your firewall (`ufw allow 80,443/tcp` on Ubuntu).

## Install on Windows

Everloom can also run entirely on your PC, the way SillyTavern does: no server, Docker or command line.

1. Download **Everloom-Setup-x.y.z.exe** from the [latest release](https://github.com/pander0212/everloom/releases/latest). (Or the **portable zip**, if you'd rather unpack it anywhere, a USB stick included; it keeps its data in a `data` folder next to `Everloom.exe`.)
2. Run it. It installs for your Windows account only and doesn't need administrator rights. It adds Start-menu and desktop shortcuts.
3. **Windows SmartScreen** will probably say "Windows protected your PC", because the installer isn't code-signed (that needs a paid certificate). Click **More info**, then **Run anyway**. The installer is built by GitHub Actions from this repository's code; the workflow is in `.github/workflows/windows.yml`.
4. Everloom opens in its own window and asks you to create your account. Because it only listens on this PC, you can choose **No password on this PC**.

**Where things are.** Your data (database, pictures, backups, logs) is in `%APPDATA%\Everloom`, apart from the program, so updates and reinstalls keep it. Everloom keeps running in the tray when you close its window: right-click the tray icon for **Open**, **Open in browser**, **Lock vault**, **Use from my phone on Wi-Fi**, **Check for updates** and **Quit**. Quit closes the database cleanly.

**From your phone.** Turn on **Use from my phone on Wi-Fi** in the tray menu. It needs a password (Settings → Account & security turns "No password on this PC" off and sets one), then Everloom listens on your home network and shows its address and a QR code. Windows asks whether to allow Everloom through the firewall: allow it on **Private** networks. Turn it off again to keep Everloom on this PC only.

**Updates.** Everloom checks GitHub Releases. When there's a new version it asks first, makes a backup, downloads and installs it, and starts again; the database is updated on the first start.

**Uninstall** from Windows Settings → Apps. It asks whether to delete your data too; the default is to keep it.

## Put it on your home screen

- **iPhone / iPad (Safari):** Share → **Add to Home Screen**.
- **Android (Chrome):** menu ⋮ → **Install app** (or **Add to Home screen**).
- **Desktop (Chrome/Edge):** the install icon in the address bar.

It opens full screen like a normal app and keeps working through brief connection drops.

## Connect a model

Go to **Settings → Connections → Add connection** and pick a provider. Keys are stored encrypted on your server.

Everloom uses up to four roles (**Settings → Connections**):

- **Main** writes the story, and powers the Character studio and AI lorebook entries. Use the best model you're happy paying for.
- **Utility** (optional) does bookkeeping: updating the game after each reply, the helper, NPC texts, map expansion, the New Game wizard, the recommender and the CSS assistant. A small, cheap, fast model is ideal. Without one, Main does everything.
- **Background** (optional) runs after replies and never delays them: the memory chronicler and consolidation, off-screen life and storyline seeding. Falls back to Utility.
- **Embeddings** (optional) make memory recall and lorebooks match by meaning, not just words. Any OpenAI-compatible or Gemini embeddings model; without one, recall uses keywords and everything else still works.

### Cost presets

**Settings → Game & trackers → World engine** has three presets (or switch things individually):

| Preset | What runs | Model calls per turn (measured) |
| --- | --- | --- |
| **Cheap** | Reply + game update, memory with keyword recall, a chronicler pass every 30 turns. Dice, gossip, intent, storylines and the pulse are free (no model). | about 2.0, no embeddings |
| **Balanced** (default) | Adds meaning-based recall, memory consolidation, off-screen life every 3 turns and new storylines every 15. | about 2.5 + 1.5 small embedding calls |
| **Max** | Adds a pre-read of what you meant before each reply, and runs everything more often. | about 4.4 + 2 embedding calls |

Everything beyond the reply and the game update runs in the background after the reply. Max's pre-read is the only extra call that comes before it. Details and the full table are in [docs/PHASE2_DECISIONS.md](docs/PHASE2_DECISIONS.md#model-calls-per-turn-by-preset); every call is listed in the World inspector.

Keeping it cheap:

- **OpenRouter** gives one key for many models, including free and very cheap ones. Good for trying things.
- **DeepSeek** (direct or via OpenRouter) is inexpensive and good at roleplay.
- **Google Gemini** has a free tier in Google AI Studio; its "Flash"-class models make a good Utility model.
- Any "mini"/"flash"/"lite"-class model is usually enough for Utility.
- **Local models** (llama.cpp, KoboldCpp, Ollama, LM Studio, TabbyAPI…) work through the OpenAI-compatible or text-completion providers and cost nothing per message.

Prices and free tiers change often — check the provider's page. The per-chat **prompt inspector** (chat menu) shows the token count of what you send.

## Update, back up, restore

**Update** (backs up first, then pulls, rebuilds, migrates and restarts):

```bash
cd Everloom && bash update.sh
```

Run it as your normal user; it uses `sudo` for Docker by itself when needed (running the whole script with `sudo` works too). It ends with `Updated: Everloom is running build abc1234`, and **Settings → About** shows the same build. If it stops with an error, nothing was changed.

**Backups:**

- The app makes a nightly backup (database + images) into `data/backups/`, keeping the newest 14 by default. Change this in **Settings → Backups & import**, where you can also make a backup right now and download it.
- `bash backup.sh` writes a consistent copy to `./backups/` on the host (the installer schedules it nightly). Copy these off the server now and then.
- Also keep `.env` somewhere safe: without `EVERLOOM_SECRET_KEY` the stored API keys can't be decrypted (you'd just re-enter them).

**Restore:**

- In the app: **Settings → Backups & import → Restore**, choose a backup `.zip`. Everloom checks it, restarts and comes back with that data.
- From the host, with a `backup.sh` archive:

  ```bash
  docker compose down
  mv data data.old && mkdir data
  tar -C data -xzf backups/everloom-YYYYMMDD-HHMMSS.tar.gz
  cp data.old/.secret-key data/ 2>/dev/null || true   # only if you don't use EVERLOOM_SECRET_KEY in .env
  sudo chown -R 10001:10001 data
  docker compose up -d
  ```

## Move over from SillyTavern

**Settings → Backups & import → Import from SillyTavern.** Everloom only ever *reads* your SillyTavern files.

- If the installer found SillyTavern on the same server, it's mounted at `/import/sillytavern` — just press **Scan**.
- Otherwise zip your `SillyTavern/data/default-user` folder and upload it there.

You'll see what was found and choose what to bring over: characters (with avatars), chats (with swipes), group chats, personas, World Info books, backgrounds and chat-completion presets. Cards, lorebooks, presets and chats can also be imported one at a time from their own pages, and exported back in SillyTavern's formats.

## Voice, images, music and Live2D

### Voices

The browser's built-in voices work with no setup. For better voices add a **Voice** connection — OpenAI TTS, any OpenAI-compatible speech server (Kokoro, AllTalk, XTTS…), or ElevenLabs — and pick it in **Settings → Voice**. Each character can have its own voice (**Stage & sound → Voices** in a story).

**Your own reference voices.** Servers that clone a voice from a short sample (XTTS, F5 and similar, behind an OpenAI-compatible endpoint) can speak with a *reference voice*. Add one in **Stage & sound → Voices**, then turn on **Accepts reference audio** for that connection in **Settings → Connections**; the sample is only ever sent to connections marked that way. Reference voices are kept apart from the provider's preset voices. **Only clone a voice you have the right to use** — your own, or with the speaker's clear permission — and never to pass as someone. Everloom asks you to confirm this for each sample and keeps the confirmation with it. ElevenLabs voice IDs work as ordinary preset voices.

### Images

Add an **Images** connection — OpenAI-compatible, OpenRouter image models, Pollinations (free, no key), ComfyUI or AUTOMATIC1111/Forge. Then you can draw portraits and expression sprites for characters, NPC portraits, item icons, scene backgrounds and diary photos. Every generated image is checked and re-encoded like an upload.

**On your own GPU (ComfyUI, AUTOMATIC1111, Forge).** These run on a machine with a graphics card: the VPS itself if it has one, or a PC at home.

- **ComfyUI:** start it with `python main.py --listen 127.0.0.1 --port 8188`. In ComfyUI, build or load a text-to-image workflow, use *Save (API Format)* and paste the JSON into the connection; put `%prompt%`, `%negative_prompt%`, `%width%`, `%height%` and `%seed%` where those values go and Everloom fills them in. Without a workflow Everloom uses a minimal one with the connection's model name as the checkpoint.
- **AUTOMATIC1111 / Forge:** start it with `--api` (for example `./webui.sh --api --listen`), and set the connection's model to the checkpoint name.
- **Same machine as Everloom with Docker:** inside the container `127.0.0.1` is the container. Add `extra_hosts: ["host.docker.internal:host-gateway"]` to the `everloom` service in `docker-compose.yml` and use `http://host.docker.internal:8188` (ComfyUI) or `:7860` (A1111). Start the image server listening on the Docker bridge (`--listen 0.0.0.0`) and keep those ports closed in the firewall.
- **Another machine:** don't open ComfyUI or A1111 to the internet — they have no login. Use a private network such as Tailscale or WireGuard and put that address in the connection, or forward the port over SSH from the VPS: `ssh -N -L 8188:127.0.0.1:8188 you@gpu-pc` (run as a service so it reconnects), then point the connection at the tunnel.

### The stage

Switch a story to **stage mode** (the book icon in the chat header). The story places sprites and plays effects through the game layer, so a swipe undoes them too; you can play effects yourself from the ✦ button. **Stage & sound → Scene** has cutscenes (write one, one line per step with `Name: line` for speech, or ask the utility model for a draft from an idea), speech bubbles, and a switch for each effect (turn off any you'd rather not see — with *reduce motion* on in your system, effects are already gentle).

**Sprites** can be uploaded per expression, or kept in the **Asset library** (sprites, backgrounds, CGs and icons with tags and search). A zip of pictures imports in one go: folders become tags, folders called `backgrounds`, `cgs` or `icons` set the type, and pictures named after emotions (`happy.png`, `sad.png`, `neutral.png`…) become an expression set you can give to any character.

### Music and ambience

Nothing ships with Everloom and nothing plays until you turn it on (**Stage & sound → Sound**) and touch the page.

- **Music:** make playlists and add your own tracks (MP3, OGG, WAV, M4A). A playlist has a mood (calm, tense, battle, romantic, sad, mysterious, joyful) and optionally a place (a kind of place such as *Any building*, or a named place) and a time of day. The story picks the music: a playlist it asks for by name, the battle playlist during battles, the scene's mood, then the playlist that fits where and when you are. Tracks crossfade (2.5 s by default).
- **Ambience:** rain, storm, wind, city, crowd, forest, sea, fire and night, chosen by the scene or, on *Follow the scene*, by the weather, the place and the hour. Add your own loops per kind; without one, Everloom generates the sound in your browser. Music and ambience have separate volumes.

### Live2D (optional)

Live2D models can replace still sprites, with expressions and motions following the emotion system and the mouth following the character's voice. It's **off by default**, and it needs one file Everloom can't include:

1. Download the **Cubism SDK for Web** from Live2D's website and accept their license. The file you need is `Core/live2dcubismcore.min.js`. It is proprietary, which is why it isn't part of Everloom.
2. In a story, open **Stage & sound → Sprites**, turn on **Live2D**, and upload `live2dcubismcore.min.js`. It's stored on your server and only served to you.
3. For each character, upload a zip of their Cubism 3/4 model (the folder with the `.model3.json`, textures, motions and expressions).

Anything missing simply falls back to the ordinary sprite. Using Live2D models and the Cubism SDK is subject to Live2D's own licenses (see [CREDITS.md](CREDITS.md)).

### Classic chat, Story or Full RPG

Everloom can be a plain roleplay frontend or a full RPG. **Settings → Features** has three presets: **Classic chat** (character, persona, lorebook, examples, history and author's note, one model call per reply, no game features), **Story** (long-term memory, light tracking and the stage) and **Full RPG** (everything), plus one switch per module. A module that is off is completely off: no screens, no prompt text, no model calls, no background work, and its code isn't downloaded. Nothing is deleted; turning it back on brings everything back. A chat can have its own mode (chat menu → Chat → Mode), and a character can have a default mode for its new chats.

### Name shield

**Settings → Privacy → Name shield**: list names (yours, people you know, places) that should never reach the AI provider. Each gets a stand-in (suggested, re-rollable, or your own); the provider only ever sees the stand-in, and Everloom swaps the real name back into the reply before it's shown or saved. It covers every model call, embeddings, cloud voices and image prompts, catches possessives and capitalization, and refuses a request if a protected name would still go out. The prompt inspector shows the prompt *as stored* and *as sent*. Limits: context can still identify someone, misspellings need to be added as extra forms, and a model may shorten a stand-in (flagged on the message).

### Scripts and extensions

Characters, presets and lorebooks can carry scripts, and messages can carry interactive HTML (status panels, choice menus, mini-games). Everything runs in a sealed frame that can only do what you allowed: a card's scripts come in **off**, and a review sheet shows the code and the permissions in plain words before you choose **Enable**, **Enable once** or **Keep disabled**. Also: variables at chat, character, global and message level (message variables follow swipes), SillyTavern-format regex rules, slash commands with pipes (`/roll 2d6 | /echo {{pipe}}`), quick replies, and a Tavern Helper compatibility layer for cards written for it. **Settings → Scripts** has the off switch and limits; add `?safe=1` to the address to start with every script off. **Settings → Extensions** installs add-ons from a zip or a Git address; three examples are in `examples/extensions`. Details: [docs/scripting.md](docs/scripting.md), [docs/extensions.md](docs/extensions.md).

### Vault (encryption at rest)

**Settings → Privacy → Vault** encrypts everything Everloom keeps on the server's disk: the whole database (chats, characters, memories, search index, settings) with SQLCipher-compatible encryption, and every picture, voice, sprite and model file with AES-256-GCM. You choose a passphrase (or use your login password, so signing in unlocks it) and get a **recovery key**, shown once. While it's locked, nothing can be read; it locks when you press **Lock now**, after the idle time you choose, when you sign out and whenever the server restarts. Backups stay encrypted; exports can be protected with a password (`.evlt` files, which every import screen opens). The browser keeps no drafts or content in storage while it's on.

What it can't do: if you lose both the passphrase and the recovery key, the data is gone. While unlocked, the key is in the server's memory, so someone in control of the running server could reach it; the vault protects the disk, stopped servers and stolen backups. Old backups made before you turned it on are readable until you delete them (the page offers to), and SSDs can keep traces of deleted files. Account names, file sizes and dates aren't hidden.

### Characters from the web

**Characters → Browse** searches Chub, Character Tavern, RisuRealm, Pygmalion, Wyvern, Botbooru, Saucepan and AI Character Cards (or **All sources** at once, with duplicates marked). The search box takes filters: `elf tag:fantasy -tag:gore creator:name tokens<2000 has:lorebook sort:new time:week lang:en`, and **Filters** opens the same as a bar (tags with suggestions from the site: tap a chip to switch it between include and exclude). Filters a site can't apply itself are checked on each page, and Everloom says which. Searches can be saved. **Import from a link** takes any card file link (PNG, JSON, CHARX) or a page on those sites. Adult content stays hidden unless you turn it on in **Settings → Character sources**.

Botbooru and Saucepan ask crawlers to stay away, so Everloom shows a notice once before fetching from them, and only ever fetches what you ask for. Saucepan needs your account for free-text search and importing; sign in under **Settings → Character sources → Accounts** (stored encrypted on your server, never shown again). If a site stops working, **Diagnostics** on the same page runs a self-test and can record the site's answers for a bug report.

Some sites (JanitorAI, JannyAI, DataCat) block automated access or exist to recover hidden definitions, and Everloom won't fetch them. Use the **browser bridge** instead: in **Settings → Character sources → Browser bridge**, name your browser and press **Install and pair** (with Tampermonkey or Violentmonkey installed; on Android, Firefox or Kiwi). On a character page press **Send to Everloom**; on a search or profile page, **Send all**. Without a userscript manager, use the bookmarklet; on Android you can also **Share** a page to the installed Everloom app. What the page shows you comes across; a definition the creator hid stays hidden and the card is labelled so.

## Configuration

Set these in `.env` (Docker) or the environment:

| Variable | Default | Meaning |
| --- | --- | --- |
| `EVERLOOM_DOMAIN` | — | Domain Caddy serves and gets a certificate for |
| `EVERLOOM_TLS` | empty | `tls internal` for IP-only mode (self-signed) |
| `EVERLOOM_SECRET_KEY` | generated | 64 hex chars; encrypts stored API keys. If unset, a key is kept in `data/.secret-key` |
| `EVERLOOM_DATA_DIR` | `./data` | Database, images and backups |
| `PORT` | `8787` | HTTP port |
| `EVERLOOM_SECURE_COOKIES` | `1` in Docker | Force `Secure` cookies (keep on behind HTTPS) |
| `EVERLOOM_TRUST_PROXY` | `1` | Trust `X-Forwarded-*` from the reverse proxy |
| `EVERLOOM_IMPORT_ROOTS` | `/import` in Docker, home folder otherwise | Colon-separated folders the SillyTavern importer may read |
| `EVERLOOM_BACKUP_RETENTION` | `14` | Nightly backups to keep |
| `SILLYTAVERN_DIR` | detected | Host path of an existing SillyTavern `data` folder, mounted read-only |
| `EVERLOOM_FETCH_PRIVATE` | off | `1` lets images named in cards and online sources be fetched from private network addresses (LAN setups). Off, a card can't make the server call your network |
| `LOG_LEVEL` | `warn` | `error`, `warn`, `info`, `debug` |

## Install without Docker

Needs Node.js 22+ and build tools for native modules (`build-essential`, `python3`).

```bash
git clone https://github.com/Pander0212/Everloom.git && cd Everloom
npm ci
npm run build
EVERLOOM_DATA_DIR=/var/lib/everloom PORT=8787 npm start
```

Run it as a service (example `/etc/systemd/system/everloom.service`):

```ini
[Unit]
Description=Everloom
After=network.target

[Service]
User=everloom
WorkingDirectory=/opt/Everloom
Environment=EVERLOOM_DATA_DIR=/var/lib/everloom
Environment=EVERLOOM_SECURE_COOKIES=1
ExecStart=/usr/bin/node apps/server/dist/index.js
Restart=always

[Install]
WantedBy=multi-user.target
```

`Restart=always` matters: restoring a backup restarts the process to swap the data in.

Put it behind HTTPS. With Caddy that's two lines:

```
rp.example.com {
	reverse_proxy 127.0.0.1:8787 {
		flush_interval -1
	}
}
```

With nginx, turn buffering off for streaming (`proxy_buffering off;`) and forward `X-Forwarded-Proto`.

## Development

```bash
npm ci
npm run dev            # server on :8787 and Vite on :5173 (proxied)
npm test               # engine + server tests (Vitest)
npm run test:e2e       # Playwright: phone, small phone, landscape and desktop in light and dark
npm run mock-llm       # a fake model server for trying things without an API key
npm run bench:memory   # the memory benchmark (Phase 1 vs now), see docs/PHASE2_DECISIONS.md
npm run typecheck
```

Layout: `packages/engine` (formats, prompt assembly, World Info, the deterministic game engine — pure TypeScript), `apps/server` (Fastify + SQLite), `apps/web` (React). The game state is a log of small operations; the engine replays them, so every change can be undone exactly.

## Troubleshooting

**The site doesn't load / certificate errors.** Check the DNS record points to this server (`dig +short rp.example.com`), ports 80/443 are open, and nothing else uses them. See `docker compose logs caddy`. With Cloudflare, use DNS-only until the certificate is issued.

**`https://your-ip` doesn't load in IP-only mode.** Update (`git pull && docker compose restart caddy`) — older versions couldn't answer HTTPS requests made to a bare IP address. Also check port 443 is open (`sudo ufw allow 443/tcp`, and your provider's firewall panel). HTTPS uses the normal port, so the address is just `https://your-ip`.

**Safari says "Can't reach the server" but Chrome works (IP-only mode).** IP-only mode uses a self-signed certificate that Caddy renews about every 12 hours. Safari's "visit this website anyway" only covers the certificate you accepted, and it keeps opening Everloom from its offline copy without asking again, so every request to the server quietly fails. Open `https://your-ip/api/health` in Safari, accept the warning, and go back (the error screen links there too). To stop this for good, give the server a free hostname with a real certificate: in `.env` set `EVERLOOM_DOMAIN=203-0-113-5.sslip.io` (your IP with dashes) and `EVERLOOM_TLS=` (empty), then run `docker compose up -d`. Open the new address, sign in again and re-add it to your home screen; your data doesn't change.

**502 Bad Gateway.** Everloom isn't running or is still starting: `docker compose ps` and `docker compose logs everloom`.

**Forgot the password / locked out / lost your 2FA device.**

```bash
docker compose exec everloom node apps/server/dist/index.js --reset-password yourname
# add --disable-2fa to also turn off two-factor sign-in
```

It prints a new password, signs out every session and clears lockouts. (Without Docker: `node apps/server/dist/index.js --reset-password yourname`.)

**"Stored API key could not be decrypted."** `EVERLOOM_SECRET_KEY` changed. Put the old key back in `.env`, or re-enter your API keys.

**Replies arrive all at once instead of streaming.** A proxy in front is buffering. Caddy (as configured) doesn't; for nginx add `proxy_buffering off;`; with Cloudflare, streaming works on normal plans.

**A local model server (Ollama, ComfyUI…) can't be reached from Docker.** Inside the container `127.0.0.1` is the container itself. Use the server's LAN IP, or `http://host.docker.internal:PORT` after adding `extra_hosts: ["host.docker.internal:host-gateway"]` to the `everloom` service.

**The SillyTavern importer says the folder is outside the allowed locations.** In Docker, only `/import/sillytavern` is readable: set `SILLYTAVERN_DIR` in `.env` and `docker compose up -d`, or upload a zip instead.

**The game didn't notice something.** Open the change summary under the message to see what was recorded, add what's missing from the tools menu, or adjust how the game is tracked in **Settings → Game & trackers**.

**Disk full.** Old backups live in `data/backups/` and `./backups/`; lower the retention in **Settings → Backups & import**.

**No music or ambience.** Turn them on in **Stage & sound → Sound** and tap the page once (browsers only allow sound after you interact). Music needs a playlist with tracks that matches the scene; ambience on *Follow the scene* stays quiet in calm, clear daytime places.

**Live2D shows a still picture.** Live2D needs the Cubism Core you upload yourself and a model zip for that character (**Stage & sound → Sprites**). If either is missing or the model fails to load, Everloom falls back to the sprite on purpose.

**A reference voice is refused.** The voice connection must have **Accepts reference audio** turned on, and the server behind it must support cloning from a sample (XTTS, F5 and similar).

**The browser bridge rejects the token.** It was revoked or mistyped: press **Install and pair** again in **Settings → Character sources → Browser bridge**, or paste a new device token into the script's settings (the ⚙ next to *Send to Everloom*).

**A source says it changed.** Sites change their pages. Run the self-test in **Settings → Character sources → Diagnostics**, then **Record fixtures** and attach the zip to an issue (it contains other people's characters, so don't publish it).

## Security notes

- API keys are encrypted with AES-256-GCM on the server and never sent to the browser.
- Passwords use scrypt; sessions are httpOnly, `Secure`, `SameSite=Strict` cookies with CSRF tokens; sign-in is rate-limited with lockouts; optional TOTP two-factor sign-in.
- Strict Content-Security-Policy, HSTS (via Caddy), `nosniff`, no framing.
- Uploads are checked by content, re-encoded (dropping EXIF/GPS) and size-limited; archive extraction rejects unsafe paths.
- Everything except sign-in, first-run setup and the health check needs a session.
- Content-driven fetches (images linked in cards, online sources, the image proxy) can't reach loopback, private or link-local addresses; the address is checked when connecting and on every redirect.
- Scripts and interactive messages run in sandboxed frames with no network access and only the permissions you approved; model calls, internet access and script storage are checked again on the server. Creator notes render in a sandboxed frame that can't run scripts. Custom CSS is cleaned (no imports or remote resources) and never applies to Settings; add `?safe-mode` to any address to turn it off.
- Optional Vault: the database and media encrypted at rest, locked until the passphrase is given (see [Vault](#vault-encryption-at-rest)).
- Online-source API keys are encrypted like the others. Adult content from online sources is off until you turn it on.

## License

MIT — see [LICENSE](LICENSE). Everloom is free; please keep it that way. Credits for inspiration, formats, fonts, icons and interface details are in [CREDITS.md](CREDITS.md).
