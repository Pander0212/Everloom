# Acceptance checklist: evidence

The nine items from the Design/UX prompt, each with where its evidence is and how it was checked.
Everything was checked in Chromium through Playwright on the built app (phone 390×844 and 360×800
touch, landscape 844×390, desktop 1280×800; light and dark).

| # | Item | Result | Evidence |
|---|---|---|---|
| 1 | Audit and before/after navigation maps; fewer controls on a phone's play screen | ✅ **20 → 16** visible controls (15 before Part 3 added the input-mode switch) | [audit.md](../audit.md), [navigation.md](../navigation.md), [controls-before.json](controls-before.json), [controls-after.json](controls-after.json), screens in [../screens/before](../screens/before) and [../screens/after](../screens/after) |
| 2 | Task tests show fewer taps, numbers reported | ✅ nine tasks: **32 → 25 taps, 2 → 0 scrolls**; seven tasks shorter, none longer | [task-tests.md](../task-tests.md), [tasks-before.json](tasks-before.json), [tasks-after.json](tasks-after.json) (`tests/ux/tasks.spec.ts`) |
| 3 | Every tool has a plain description and is reachable through the palette; reachability test passes | ✅ | `apps/web/test/reachability.test.ts`: every tool, sheet, page and settings page has an entry with a description (≤ 70 characters) and a way in; names are unique; switched-off modules hide their entries |
| 4 | Simple and Advanced settings; Classic chat shows no game entries | ✅ Simple: 9 pages in 4 groups; Advanced: all 21 | screens `07-settings` and `13-settings-advanced` in [../screens/after](../screens/after); `reachability.test.ts` ("Classic chat offers no game entries"); `tests/ux/presets.spec.ts` in Classic: no status bar, no game tool in Tools, no game settings page ([presets/classic-*](presets)) |
| 5 | Gallery with 8–10 live-previewed themes; contrast; story, menus, settings, stage; scenery pauses under reduced motion and when hidden | ✅ 10 themes plus Everloom's own | [themes.md](../themes.md); [themes/](themes) (each theme on story, Tools, settings and the stage, and the gallery, phone and desktop); `apps/web/test/looks.test.ts` (WCAG AA for every theme in light and dark); `tests/ux/themes.spec.ts` ("scenery pauses under reduced motion and while hidden": no frames drawn) |
| 6 | Per-world theme | ✅ | `tests/ux/themes.spec.ts` ("the gallery applies a theme at once; a world keeps its own"); This chat › Theme for this world, and the story panel's Display tab |
| 7 | Scenery CPU on the phone profile measured and small | ✅ scene script **0.5–1.0%** of a 4× slowed core, all main-thread work **2.8–6.4%** | [scenery-cpu-phone.json](scenery-cpu-phone.json), [scenery-cpu-desktop.json](scenery-cpu-desktop.json), table in [themes.md › Performance](../themes.md#performance); the test fails over 2% / 10% |
| 8 | Input modes, scenario questions, Quickstart with cancel, scenarios, story cards with generation, story panel, in-place editing with undo/redo, thinking levels | ✅ all adopted (see [hakawati.md](../hakawati.md)) | `tests/e2e/hakawati.spec.ts` (all eight projects); engine tests `questions.test.ts`, `inputModes.test.ts`; server tests `scenarios.test.ts`, `migrate-failure.test.ts` |
| 9 | The full existing test suite passes in every preset | ✅ see below | below |

## Item 9: the test suites

Run on the final build (a snapshot of `apps/web/dist`, so a rebuild can't change it mid-run).

| Suite | Result |
|---|---|
| `npm run typecheck` | clean |
| Vitest (engine, server, web) | 106 files, **780 passed**, 5 skipped (need Blender) |
| Playwright e2e, all eight projects (`npx playwright test`) | **499 passed**, 60 skipped (heavy 3D checks run on two of the eight projects, desktop-only cases, measuring runs), 2 failed in the full run; both were fixed (a closing sheet, a reload race) and their specs re-run in all eight projects with the Hakawati spec: **121 passed** |
| Presets (`tests/ux/presets.spec.ts`, `UX_PRESET=classic`, `story`, `full`) | Classic, Story and Full RPG: passed (screens in [presets/](presets)) |

"Every preset": the e2e suite starts as Full RPG (set at first run) and runs its chats in the preset
each test needs, Classic chat in 10 of them, Full RPG in the rest; Story (memory, light
tracking and the stage; no economy, battles or map) is covered by the presets test and the
reachability test. The
suite as a whole can't be run with Classic as the account's default: most of it tests game
systems, which Classic switches off by design.

Before the redesign the baseline was 618 unit tests and 446 e2e passes ([baseline.md](baseline.md));
the redesign changed names and paths the old specs used, and those specs were updated to the new
names. No e2e test was removed and none newly skipped (6 conditional skips before and after); the
new ones are in `hakawati.spec.ts`.
