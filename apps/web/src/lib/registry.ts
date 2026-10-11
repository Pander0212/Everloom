/**
 * Every tool, screen, action and settings page a player can reach, in one place (docs/ux/navigation.md).
 *
 * The palette (Ctrl/⌘K, the Tools button), the help on each screen, the settings index and the
 * reachability test all read this list, so a tool can't exist without a name, a group, a one-line
 * description and a plain "What is this?". Names follow docs/ux/glossary.md.
 */
import type { FeatureId, FeatureSet } from '@everloom/engine';
import type { LucideIcon } from 'lucide-react';
import {
  ArrowLeftRight, Backpack, Bot, BookMarked, BookOpen, Box, Brain, Brush, CalendarDays, Cat, Clapperboard, CloudSun, Code, Code2, Compass, Contact, Database, Dumbbell, Eye, FileCode2,
  FlaskConical, Flag, Gamepad2, Globe, Hammer, Heart, HelpCircle, History, House, Image, Info, KeyRound, Lightbulb, Map, MessageSquare, MessageSquarePlus, NotebookPen, Palette,
  PersonStanding, Phone, Plug, Puzzle, Save, ScrollText, Search, Shirt, ShieldCheck, Sparkles, Stethoscope, Store, Swords, Telescope, ToggleRight, UserRound, UserRoundPen,
  Users, UsersRound, Volume2, Wallet, FastForward, Activity, BookText, Undo2, Wand2, PanelRight, Redo2,
} from 'lucide-react';

export type GroupId = 'scene' | 'me' | 'world' | 'story' | 'create' | 'settings' | 'advanced';

export const GROUPS: Array<{ id: GroupId; label: string; description: string }> = [
  { id: 'scene', label: 'This scene', description: 'What is happening right now' },
  { id: 'me', label: 'My character', description: 'You: status, things, money, party' },
  { id: 'world', label: 'The world', description: 'Places, people and what goes on' },
  { id: 'story', label: 'Story tools', description: 'Quests, notes, memory and saves' },
  { id: 'create', label: 'Create', description: 'Characters, personas, lorebooks and more' },
  { id: 'settings', label: 'Settings', description: 'Models, features, looks and your data' },
  { id: 'advanced', label: 'Advanced', description: 'What the AI sees, scripts and diagnostics' },
];

/**
 * How an entry opens. `tool`: a game tool sheet (features/game/tools). `sheet`: a sheet of the play
 * screen (StoryView). `action`: something the play screen does. `route`: a page.
 */
export type Target = { kind: 'tool'; tool: string; arg?: string } | { kind: 'sheet'; sheet: string; tab?: string } | { kind: 'action'; action: string } | { kind: 'route'; to: string };

export interface Entry {
  id: string;
  label: string;
  group: GroupId;
  icon: LucideIcon;
  /** One line under the name, in menus and search results. */
  description: string;
  /** "What is this?": plain words and an example. */
  help: string;
  keywords?: string;
  /** Hidden (entirely) unless every listed switch is on. */
  features?: FeatureId[];
  /** Needs a story with a game (the play screen of a game chat). */
  game?: boolean;
  /** Only inside a chat (the play screen). */
  chat?: boolean;
  /** Needs a memory mode other than off. */
  memory?: boolean;
  /** Shown only in search results, not in the browsing list. */
  searchOnly?: boolean;
  /** Only with Settings › Advanced › Experimental on. */
  experimental?: boolean;
  target: Target;
}

const tool = (t: string, arg?: string): Target => ({ kind: 'tool', tool: t, arg });
const sheet = (s: string, tab?: string): Target => ({ kind: 'sheet', sheet: s, tab });
const action = (a: string): Target => ({ kind: 'action', action: a });
const route = (to: string): Target => ({ kind: 'route', to });

export const ENTRIES: Entry[] = [
  // ------------------------------------------------------------------ This scene
  { id: 'longer', label: 'Make the reply longer', group: 'scene', icon: FastForward, chat: true, target: action('continue'), keywords: 'continue more go on', description: 'The narrator keeps writing the last reply.', help: 'Adds to the last reply instead of starting a new one. Use it when a reply stops too early, for example in the middle of a fight.' },
  { id: 'write-for-me', label: 'Write my next line', group: 'scene', icon: UserRoundPen, chat: true, target: action('impersonate'), keywords: 'impersonate draft suggest', description: 'The AI drafts your next message in the box.', help: 'The AI writes a message for you and puts it in the message box. Nothing is sent: change it, then send it yourself.' },
  { id: 'undo-turn', label: 'Undo last turn', group: 'scene', icon: Undo2, chat: true, target: action('undo'), keywords: 'undo take back revert ctrl z', description: 'Take back your last message and its reply.', help: 'Takes the last turn away (your message and the reply to it) and rolls back what it changed in the story. Redo turn puts it back. Also Ctrl/⌘+Z and Ctrl/⌘+Shift+Z.' },
  { id: 'redo-turn', label: 'Redo turn', group: 'scene', icon: Redo2, chat: true, target: action('redo'), keywords: 'redo again put back ctrl y', description: 'Put back the turn you took back.', help: 'Puts back the last turn you undid, as it was; its story changes are read again.' },
  { id: 'find', label: 'Find in chat', group: 'scene', icon: Search, chat: true, target: sheet('search'), keywords: 'search bookmarks', description: 'Search this chat and its bookmarks.', help: 'Finds words anywhere in this chat, and lists the messages you bookmarked. Tap a result to jump there.' },
  { id: 'new-chat-same', label: 'New chat with this character', group: 'scene', icon: MessageSquarePlus, chat: true, target: action('new-chat-same'), keywords: 'start over restart new story', description: 'Start a fresh chat; this one stays as it is.', help: 'Starts a new chat with the same character (or group). This chat is kept in your list.' },
  { id: 'stage-view', label: 'Stage view', group: 'scene', icon: BookText, chat: true, features: ['stage'], target: action('stage'), keywords: 'visual novel vn chat view mode', description: 'Show the scene as a visual novel, or back as a chat.', help: 'Stage view shows the characters in the scene with one line at a time, like a visual novel. Tap the dialogue box to go on. Switch back to see the chat.' },
  { id: 'stage', label: 'Stage & sound', group: 'scene', icon: Clapperboard, game: true, features: ['stage'], target: tool('stage'), keywords: 'cutscene music ambience sprites voices live2d effects background', description: 'Cutscenes, music, ambience, pictures and voices.', help: 'Everything the stage shows and plays: the background, who is on stage, music and ambience, scene effects like rain, and short cutscenes you can write, for example "Mara: Stay close {wave}".' },
  { id: 'atmosphere', label: 'Weather & mood', group: 'scene', icon: CloudSun, game: true, features: ['weather'], target: tool('atmosphere'), keywords: 'weather overlay particles rain snow time of day tint atmosphere effects', description: 'Weather, the time-of-day tint and particles.', help: 'Sets the weather and how it looks: a tint for the time of day, and rain or snow over the story. The story changes the weather too, for example "a storm rolls in".' },
  { id: 'battle', label: 'Battle', group: 'scene', icon: Swords, game: true, features: ['battle'], target: tool('battle'), keywords: 'fight combat', description: 'Turn-based fights with your party.', help: 'When the story starts a fight, it happens here, turn by turn: pick an attack, a skill or an item for each party member. You can also start one yourself.' },
  { id: 'cinematic', label: 'Cinematic mode', group: 'scene', icon: Clapperboard, chat: true, target: action('cinematic'), keywords: 'focus fullscreen immersive hide reading', description: 'Only the story, nothing else. Esc to leave.', help: 'Hides the menus, the status bar and the message box so you can just read. Press Esc or tap Exit to come back.' },

  // ------------------------------------------------------------------ My character
  { id: 'status', label: 'Status', group: 'me', icon: Activity, game: true, features: ['trackers'], target: tool('status'), keywords: 'health hp hunger energy mood conditions needs', description: 'Health, needs, mood and conditions.', help: 'Your bars (like health and energy), how you feel and anything affecting you, such as "soaked" or "poisoned". The status bar at the top shows a few of these; tap it to come here.' },
  { id: 'outfits', label: 'Outfits', group: 'me', icon: Shirt, game: true, features: ['inventory'], target: tool('inventory', 'wear'), keywords: 'clothes wear dress change outfit wardrobe equip', description: 'Change what you wear.', help: 'The clothes and accessories you own. Tap Wear to put one on; the story and the stage follow. Add new clothes in Inventory.' },
  { id: 'inventory', label: 'Inventory', group: 'me', icon: Backpack, game: true, features: ['inventory'], target: tool('inventory'), keywords: 'items bag equipment storage use equip', description: 'What you carry; use, equip or give things.', help: 'Everything you carry. Tap an item to use, equip, give or move it. The story adds and removes items as you play, for example "+1 Iced Lemon Tea".' },
  { id: 'money', label: 'Money', group: 'me', icon: Wallet, game: true, features: ['inventory'], target: tool('money'), keywords: 'wallet bank bills rent loans assets currency exchange', description: 'Wallet, bank, bills and loans.', help: 'How much money you have and where: your wallet, bank accounts, bills that are due, loans. The story spends and earns for you.' },
  { id: 'persona', label: 'Persona', group: 'me', icon: UserRound, game: true, target: tool('persona'), keywords: 'me lineage family appearance who i play', description: 'Who you play: name, looks, family.', help: 'The character you play in this story: name, appearance, background and family. The AI reads this every turn.' },
  { id: 'party', label: 'Party', group: 'me', icon: UsersRound, game: true, features: ['party'], target: tool('party'), keywords: 'companions team level skills class', description: 'Companions, levels, skills and classes.', help: 'The people travelling with you, with their levels and skills. Spend points here when someone levels up.' },
  { id: 'crafting', label: 'Crafting', group: 'me', icon: Hammer, game: true, features: ['crafting'], target: tool('crafting'), keywords: 'cook alchemy forge enchant recipes make', description: 'Make things from recipes.', help: 'Turn materials into things using recipes and stations, for example cook a stew at a kitchen.' },
  { id: 'home', label: 'Home', group: 'me', icon: House, game: true, features: ['home'], target: tool('home'), keywords: 'house rooms household storage family sleep', description: 'Your homes, rooms, storage and household.', help: 'Places you live: their rooms, what is stored there and who lives with you.' },
  { id: 'activities', label: 'Activities', group: 'me', icon: Dumbbell, game: true, features: ['time'], target: tool('activities'), keywords: 'sleep work train cook rest wait pass time', description: 'Sleep, work, train: things that take time.', help: 'Spend time doing something, for example sleep until morning or work a shift. Time moves on and the world goes on without you.' },

  // ------------------------------------------------------------------ The world
  { id: 'map', label: 'Map', group: 'world', icon: Map, game: true, features: ['map'], target: tool('map'), keywords: 'travel places locations go journeys transit route', description: 'Where everything is; travel somewhere.', help: 'Places you know and where people are. Tap a place, then Travel here. Journeys shows trains and routes, for example "Ride the Coast Line to Eastport".' },
  { id: 'people', label: 'People', group: 'world', icon: Users, game: true, features: ['npcs'], target: tool('npcs'), keywords: 'npcs characters who met', description: 'Everyone you have met, and where they are.', help: 'The people in this story: who they are, where they are now and what they are doing. They appear as the story meets them; you can add or edit them.' },
  { id: 'relationships', label: 'Relationships', group: 'world', icon: Heart, game: true, features: ['npcs'], target: tool('social'), keywords: 'social affection trust bonds feelings', description: 'How people feel about you.', help: 'Affection, trust and other feelings between you and the people you know, and how they changed over the story.' },
  { id: 'calendar', label: 'Calendar', group: 'world', icon: CalendarDays, game: true, features: ['time'], target: tool('calendar'), keywords: 'time events schedules date day', description: 'Dates, events and schedules.', help: 'The story\'s calendar: today, upcoming events and people\'s schedules. Add your own events, for example "Rehearsal on Friday".' },
  { id: 'phone', label: 'Phone', group: 'world', icon: Phone, game: true, features: ['phone'], target: tool('phone'), keywords: 'texts messages contacts calls email feed', description: 'Texts, calls, letters and the feed.', help: 'Messages from people in the story, and your own. Text someone and they answer in their own time.' },
  { id: 'shops', label: 'Shops', group: 'world', icon: Store, game: true, features: ['inventory'], target: tool('shop'), keywords: 'buy sell haggle store market', description: 'Buy and sell where you are.', help: 'The shops at your location: buy, sell and haggle.' },
  { id: 'trade', label: 'Trade', group: 'world', icon: ArrowLeftRight, game: true, features: ['inventory'], target: tool('trade'), keywords: 'barter exchange swap', description: 'Swap things with someone.', help: 'Offer items or money to someone nearby for something of theirs.' },
  { id: 'orgs', label: 'Organizations', group: 'world', icon: Flag, game: true, features: ['orgs'], target: tool('orgs'), keywords: 'factions groups standing guild', description: 'Factions and your standing with them.', help: 'Groups in the world, like a guild or a gang, and how they see you.' },
  { id: 'meanwhile', label: 'Meanwhile', group: 'world', icon: History, game: true, target: tool('log'), keywords: 'world log events news digest offscreen', description: 'What happened elsewhere.', help: 'News from the rest of the world: what people did off-screen while you were busy.' },
  { id: 'cast', label: 'Story cast', group: 'world', icon: Contact, game: true, target: tool('characters'), keywords: 'cards characters cast', description: 'The character cards in this story.', help: 'The character cards this chat uses. Track one as a person in the world so the story keeps their place and feelings.' },
  { id: 'helper', label: 'Helper', group: 'world', icon: Cat, game: true, features: ['helper'], target: tool('helper'), keywords: 'assistant pet ask pip', description: 'A small companion you can ask about the game.', help: 'Ask the helper anything about your story or how Everloom works, for example "Where did I leave the key?".' },

  // ------------------------------------------------------------------ Story tools
  { id: 'journal', label: 'Journal', group: 'story', icon: BookMarked, game: true, features: ['journal'], target: tool('journal'), keywords: 'quests objectives tasks goals', description: 'Quests and what to do next.', help: 'Your quests and their steps. The story adds them; you can add your own, for example "Find a singer: ask Iris, visit the Ravens".' },
  { id: 'diary', label: 'Diary', group: 'story', icon: NotebookPen, game: true, features: ['diary'], target: tool('diary'), keywords: 'notes photos stickers', description: 'Your own notes and pictures.', help: 'A private diary for your character: write entries, add pictures. The AI doesn\'t read it unless you share an entry.' },
  { id: 'facts', label: 'Facts', group: 'story', icon: Database, game: true, features: ['databank'], target: tool('databank'), keywords: 'databank knowledge established canon', description: 'What the story has established.', help: 'Facts the story settled, for example "The café opens at eight". The AI keeps to them; you can fix or add facts.' },
  { id: 'story-panel', label: 'Story panel', group: 'story', icon: PanelRight, chat: true, target: action('panel'), keywords: 'cards note model thinking display side panel', description: 'Note, cards, characters, model and display in one place.', help: 'A panel beside the story (a sheet on a phone) with five tabs: Story (the note to the AI and the memory), Cards (story cards), Character, AI (the model and how hard it thinks) and Display (theme and reading).' },
  { id: 'cards', label: 'Story cards', group: 'story', icon: BookOpen, chat: true, target: action('panel-cards'), keywords: 'lorebook world info entries cards generate', description: 'People, places and things the narrator should know.', help: 'Short notes the narrator reads when their words come up, like a card for "the Ravens" whenever they are mentioned. Pin a card to have it read every time. The AI can make cards from the story so far. They are this chat\'s own lorebook.' },
  { id: 'memory', label: 'Memory', group: 'story', icon: Brain, chat: true, memory: true, target: sheet('memory'), keywords: 'summary remember recall', description: 'What the AI remembers from earlier.', help: 'A summary of the story so far that the AI reads every turn, so it remembers what happened long ago. You can edit and pin it.' },
  { id: 'note', label: 'Note to the AI', group: 'story', icon: NotebookPen, chat: true, target: sheet('note'), keywords: "author's note authors note instruction", description: 'A standing instruction the AI reads every reply.', help: 'A short instruction kept close to the end of what the AI reads, for example "Keep replies under 150 words" or "It is raining all day". (SillyTavern calls this the Author\'s note.)' },
  { id: 'saves', label: 'Saves', group: 'story', icon: Save, chat: true, target: sheet('saves'), keywords: 'save load slot checkpoint', description: 'Save the story and go back to a save.', help: 'Save this point of the story and load it later. Loading makes a new branch, so nothing is lost.' },
  { id: 'changes', label: 'Story changes', group: 'story', icon: Undo2, game: true, chat: true, target: sheet('world', 'changes'), keywords: 'undo changes wrong fix state history tracker', description: 'Every change the story made, with undo.', help: 'Each thing the story changed (an item gained, a place moved to, a feeling raised) with where it came from. If the story got something wrong, undo that one change.' },
  { id: 'problems', label: 'Story problems', group: 'story', icon: Lightbulb, game: true, chat: true, target: sheet('world', 'health'), keywords: 'health problems fix names unknown', description: 'Things in the story state that look wrong, with fixes.', help: 'Lists names the story used that match nobody, and other problems, each with a fix, for example "Create Tobias as a person".' },
  { id: 'newgame', label: 'New game setup', group: 'story', icon: Sparkles, game: true, chat: true, target: tool('newgame'), keywords: 'wizard start campaign world setup', description: 'Set up the world, your character and the start.', help: 'A short setup for a new game: the world, who you play, what you start with and where. You can do it any time; it starts the game state over.' },
  { id: 'chat-details', label: 'This chat', group: 'story', icon: Info, chat: true, target: sheet('info'), keywords: 'chat details title mode persona branches export import duplicate delete model', description: 'Title, model, mode, persona, branches and export.', help: 'Everything about this chat: its name, the model it uses, its mode (Classic chat, Story or Full RPG), who you play, its branches, and export or delete.' },

  // ------------------------------------------------------------------ Create
  { id: 'new-chat', label: 'New chat', group: 'create', icon: MessageSquarePlus, target: route('/?new=1'), keywords: 'start chat character group', description: 'Start a chat with a character or a group.', help: 'Pick a character or a group and a mode, and start.' },
  { id: 'quickstart', label: 'Quickstart', group: 'create', icon: Sparkles, target: route('/?quickstart=1'), keywords: 'new story generate idea genre start quick random surprise', description: 'A whole new story from a short idea.', help: 'Write an idea or pick a genre; Everloom writes a character, an opening scene and, in Story or Full RPG, the world. Cancel any time without losing your idea.' },
  { id: 'scenarios', label: 'Scenarios', group: 'create', icon: Compass, target: route('/scenarios'), keywords: 'scenario starting point template adventure import export', description: 'Starting points to use again: opening, plot, cards, kit.', help: 'A scenario is a starting point you can use again: the opening, how the narrator runs it, where the plot goes, a note to the AI, a starting kit, story cards and a cover. Each story gets its own copy. Share them as JSON.' },
  { id: 'characters', label: 'Characters', group: 'create', icon: Users, target: route('/characters'), keywords: 'library cards import', description: 'Your character library: import, edit, organize.', help: 'All your characters. Import a card (PNG or JSON), make one, and sort them into collections.' },
  { id: 'studio', label: 'Character studio', group: 'create', icon: Wand2, target: route('/characters/studio'), keywords: 'create write make character ai', description: 'Write a character with the AI.', help: 'Describe a character and write their card together with the AI, field by field.' },
  { id: 'browse', label: 'Browse characters online', group: 'create', icon: Globe, features: ['sources'], target: route('/characters/browse'), keywords: 'sources chub download import', description: 'Find and import characters from sites.', help: 'Search character sites and import cards in one tap.' },
  { id: 'personas', label: 'Personas', group: 'create', icon: UserRound, target: route('/personas'), keywords: 'me player persona user', description: 'The people you play as.', help: 'Your own characters: the "you" in a chat. Pick one per chat or a default.' },
  { id: 'lorebooks', label: 'Lorebooks', group: 'create', icon: BookOpen, target: route('/lore'), keywords: 'lore world info wi entries keywords', description: 'Facts the AI looks up when words come up.', help: 'Entries the AI reads when their keywords appear in the story, for example an entry about "the Ravens" whenever they are mentioned. (Also called world info.)' },
  { id: 'avatars3d', label: '3D avatars', group: 'create', icon: Box, features: ['avatars3d'], target: route('/characters/avatars'), keywords: 'vrm glb 3d avatar model', description: 'Import, make and dress 3D characters.', help: 'Your 3D characters: import a VRM or GLB, make one, dress it, and see it on the stage.' },
  { id: 'puppets', label: 'Puppets', group: 'create', icon: PersonStanding, features: ['puppets'], target: route('/settings/puppets'), keywords: 'live2d 2d animated picture puppet', description: 'Animated 2D characters from a picture.', help: 'Turn a full-body picture into an animated 2D character that breathes, blinks and talks on the stage.' },

  // ------------------------------------------------------------------ Settings
  { id: 'settings', label: 'All settings', group: 'settings', icon: ToggleRight, target: route('/settings'), keywords: 'preferences options', description: 'Every setting, simple or advanced.', help: 'All of Everloom\'s settings. Simple shows what most people need; Advanced shows everything.' },
  { id: 'model', label: 'Change the model', group: 'settings', icon: Plug, target: route('/settings/connections'), keywords: 'model connection api key provider llm main model', description: 'Which AI writes the story.', help: 'Add an AI service with its key, and pick which model writes the story (Main model). A chat can also use its own model: open This chat.' },
  { id: 'features-page', label: 'Features', group: 'settings', icon: ToggleRight, target: route('/settings/features'), keywords: 'modules switches classic story full rpg preset turn off', description: 'Turn parts of Everloom on or off.', help: 'Classic chat, Story or Full RPG, or switch single parts on and off. Off means gone: no menus, no extra AI calls.' },
  { id: 'appearance', label: 'Appearance & themes', group: 'settings', icon: Palette, target: route('/settings/appearance'), keywords: 'theme dark light colors fonts text size motion', description: 'Themes, text size and motion.', help: 'Pick a theme from the gallery, the text size and line spacing, and how much things move.' },
  { id: 'view', label: 'View on this device', group: 'settings', icon: Eye, chat: true, target: sheet('view'), keywords: 'status bar chips avatars layout hud', description: 'What the play screen shows on this device.', help: 'Show or hide the status bar, the chips above the message box and the avatars, on this device only.' },
  { id: 'backups', label: 'Backups & import', group: 'settings', icon: Database, target: route('/settings/data'), keywords: 'backup export restore save sillytavern import', description: 'Back up, restore, and move from SillyTavern.', help: 'Make a backup now or every night, restore one, or bring over chats and characters from SillyTavern.' },
  { id: 'help', label: 'Help', group: 'settings', icon: HelpCircle, chat: true, target: tool('help'), keywords: 'how guide glossary words', description: 'How Everloom works, and what the words mean.', help: 'Short explanations of how Everloom works and a glossary of the words it uses.' },
  { id: 'tour', label: 'Take the tour', group: 'settings', icon: Compass, target: action('tour'), keywords: 'guide intro tutorial first run onboarding', description: 'A short tour of what matters.', help: 'Five or six things worth knowing, matched to how you use Everloom.' },

  // ------------------------------------------------------------------ Advanced
  { id: 'what-ai-sees', label: 'What the AI sees', group: 'advanced', icon: Telescope, game: true, chat: true, target: sheet('world', 'scene'), keywords: 'scene block story state context', description: 'The story state the AI reads with each reply.', help: 'The part of what the AI reads that describes the story right now: time, place, who is here and what each person knows. Check it when a reply forgets where you are.' },
  { id: 'sent-to-ai', label: 'Everything sent to the AI', group: 'advanced', icon: ScrollText, chat: true, target: sheet('inspector'), keywords: 'prompt inspector tokens debug context', description: 'The exact text sent for the last reply.', help: 'Everything the AI read for the last reply, piece by piece, with sizes in tokens, and a preview of the next one. Useful when a reply ignores something.' },
  { id: 'story-state', label: 'Story state', group: 'advanced', icon: Telescope, chat: true, target: sheet('world'), keywords: 'world inspector scene block model calls cost health changes undo import', description: 'The game state the AI is told, changes, calls and problems.', help: 'The story state as the AI sees it each turn, every change and its undo, the model calls and their cost, problems with fixes, and importing places and people from a lorebook.' },
  { id: 'scripts-sheet', label: 'Scripts in this chat', group: 'advanced', icon: Code2, chat: true, features: ['scripts'], target: sheet('scripts'), keywords: 'extensions console permissions script', description: 'Scripts running in this chat, and their consoles.', help: 'Scripts from cards, presets and lorebooks in this chat: turn them on or off, see what they print, review what they may do.' },
  { id: 'prompts', label: 'Prompts & presets', group: 'advanced', icon: ScrollText, target: route('/settings/prompts'), keywords: 'system prompt preset blocks format instruct', description: 'How the text sent to the AI is put together.', help: 'The blocks that make up what the AI reads (system prompt, character, history…), their order and format. Most people never need this.' },
  { id: 'extensions', label: 'Extensions', group: 'advanced', icon: Puzzle, features: ['extensions'], target: route('/settings/extensions'), keywords: 'addons plugins install', description: 'Install and manage add-ons.', help: 'Add-ons that add panels, commands or screens. Each one asks for what it may do before it runs.' },
  { id: 'diagnostics', label: 'Diagnostics', group: 'advanced', icon: Stethoscope, target: route('/settings/diagnostics'), keywords: 'errors report logs model calls test', description: 'Tests, recent model calls and errors.', help: 'Test your connections, see recent model calls and server errors, and download a report for a bug.' },
  { id: 'css', label: 'Custom CSS', group: 'advanced', icon: Code, target: route('/settings/css'), keywords: 'style css theme snippets', description: 'Your own style tweaks.', help: 'Small CSS snippets that change how Everloom looks. Safe mode turns them all off if something breaks.' },
  { id: 'design', label: 'Design system', group: 'advanced', icon: Brush, experimental: true, target: route('/design'), keywords: 'tokens components buttons', description: 'Everloom\'s components and tokens, for developers.', help: 'A page with every button, field and color token. For people changing Everloom itself.' },
  { id: 'lab3d', label: '3D lab', group: 'advanced', icon: FlaskConical, experimental: true, features: ['avatars3d'], target: route('/lab/3d'), keywords: '3d test lab', description: 'Test bench for 3D characters.', help: 'A test page for 3D characters and motions, for checking a model in detail.' },
  { id: 'labpuppets', label: 'Puppet lab', group: 'advanced', icon: FlaskConical, experimental: true, features: ['puppets'], target: route('/lab/puppets'), keywords: 'puppet test lab', description: 'Test bench for puppets.', help: 'A test page for puppets: move every parameter and play motions.' },
];

/** Settings pages: their group in the index, Simple or Advanced, and their help. */
export type SettingsGroup = 'basics' | 'story' | 'media' | 'data' | 'advanced';
export const SETTINGS_GROUPS: Array<{ id: SettingsGroup; label: string }> = [
  { id: 'basics', label: 'Basics' },
  { id: 'story', label: 'Story & game' },
  { id: 'media', label: 'Voice & pictures' },
  { id: 'data', label: 'Your data & account' },
  { id: 'advanced', label: 'Advanced' },
];

export interface SettingsPageInfo {
  id: string;
  label: string;
  icon: LucideIcon;
  group: SettingsGroup;
  /** Shown in the Simple view too. */
  simple?: boolean;
  feature?: FeatureId;
  description: string;
  help: string;
  keywords?: string;
}

export const SETTINGS_PAGES: SettingsPageInfo[] = [
  { id: 'connections', label: 'Models & connections', icon: Plug, group: 'basics', simple: true, description: 'Which AI writes the story, and your keys.', keywords: 'model api key provider openai anthropic openrouter local main utility', help: 'Add the AI services you use (with their keys or a local address), then say which model does what. The Main model writes the story; a cheaper Utility model can do small jobs like tracking. Example: add OpenRouter, pick a model as Main.' },
  { id: 'features', label: 'Features', icon: ToggleRight, group: 'basics', simple: true, description: 'Classic chat, Story or Full RPG, or switch parts on and off.', keywords: 'modules switches preset classic story full rpg memory', help: 'Choose how much of Everloom you want. Classic chat is a plain roleplay chat. Story adds memory and the stage. Full RPG adds the whole game: items, map, money, battles. Anything off is gone completely.' },
  { id: 'appearance', label: 'Appearance & themes', icon: Palette, group: 'basics', simple: true, description: 'Themes, reading settings and motion.', keywords: 'theme dark light colors fonts text size line height motion scenery', help: 'Pick a theme from the gallery (each one has its own colors, type and scenery around the story), the text size and spacing, and how much moves. Each device can have its own choice.' },
  { id: 'chat', label: 'Chat', icon: MessageSquare, group: 'basics', simple: true, description: 'Sending, reasoning, dictation and reading aloud.', keywords: 'enter send reasoning thinking dictation voice input read aloud quick actions', help: 'How the message box behaves (does Enter send?), whether to show the model\'s reasoning, and the quick actions above the message box.' },
  { id: 'game', label: 'Game & story state', icon: Gamepad2, group: 'story', feature: 'game', description: 'Auto-tracking, the status bar, world simulation and memory.', keywords: 'tracker hud status bar world simulation memory chronicle events', help: 'How the game keeps track of the story: how auto-tracking runs, what the status bar shows, how alive the world is (random events, off-screen life) and how much the story remembers. Each part says if it costs an extra AI call.' },
  { id: 'characters', label: 'Character library', icon: Users, group: 'story', description: 'How the library shows cards and keeps versions.', keywords: 'library hover versions', help: 'Small choices for the character library, like showing card details on hover and how many old versions of each character to keep.' },
  { id: 'lore', label: 'Lorebook settings', icon: BookOpen, group: 'story', description: 'When lorebook entries are read.', keywords: 'world info scan depth budget recursion semantic', help: 'How far back the story is searched for lorebook keywords, how much room entries may take, and whether entries can be found by meaning instead of exact words.' },
  { id: 'sources', label: 'Character sources', icon: Globe, group: 'story', feature: 'sources', description: 'Sites to browse, accounts and the browser bridge.', keywords: 'chub sites accounts bridge import online', help: 'Which character sites you browse, your accounts there, and the browser bridge that sends cards from a site to Everloom.' },
  { id: 'voice', label: 'Voice', icon: Volume2, group: 'media', simple: true, feature: 'voice', description: 'The voice that reads replies aloud.', keywords: 'tts speech narrator voice speed pitch', help: 'Which engine reads aloud (your browser\'s, or a voice service) and the narrator\'s voice, speed and pitch.' },
  { id: 'images', label: 'Images', icon: Image, group: 'media', feature: 'imagegen', description: 'Pictures made by your image service.', keywords: 'image generation backgrounds style portraits', help: 'Whether to suggest scene backgrounds, and the picture style, for your image service.' },
  { id: '3d', label: '3D characters', icon: Box, group: 'media', feature: 'avatars3d', description: '3D avatars, motions, packs and quality.', keywords: '3d vrm glb blender mpfb quality physics', help: 'Everything for 3D characters: avatars, part packs, motions, Blender, realistic characters and how good 3D looks on this device.' },
  { id: 'puppets', label: 'Puppets', icon: PersonStanding, group: 'media', feature: 'puppets', description: 'Animated 2D characters from a picture.', keywords: 'puppet live2d layering', help: 'Make an animated puppet from a full-body picture, or import puppets.' },
  { id: 'data', label: 'Backups & import', icon: Database, group: 'data', simple: true, description: 'Back up, restore, and move from SillyTavern.', keywords: 'backup export restore nightly sillytavern import', help: 'Back up everything now or every night, download or restore a backup, and bring over your SillyTavern data.' },
  { id: 'privacy', label: 'Privacy', icon: ShieldCheck, group: 'data', simple: true, description: 'Name shield, the vault and exports.', keywords: 'name shield vault encryption passphrase exports password', help: 'The name shield swaps real names for stand-ins before anything leaves your server. The vault encrypts everything stored. Example: protect your own name so the AI service never sees it.' },
  { id: 'account', label: 'Account & security', icon: KeyRound, group: 'data', simple: true, description: 'Password, two-step sign-in and devices.', keywords: 'password 2fa two factor devices sessions sign out', help: 'Change your password, turn on two-step sign-in, and sign out devices you don\'t use.' },
  { id: 'prompts', label: 'Prompts & presets', icon: ScrollText, group: 'advanced', description: 'How the text sent to the AI is put together.', keywords: 'system prompt preset blocks format prefill squash', help: 'The pieces that make up what the AI reads, in order, and their format. Change these only if you know you need to; presets keep your versions.' },
  { id: 'scripts', label: 'Scripts', icon: FileCode2, group: 'advanced', feature: 'scripts', description: 'Scripts, regex rules and quick replies.', keywords: 'scripts regex quick replies tavern helper html', help: 'Rules for scripts that cards, presets and lorebooks bring, your own scripts, find-and-replace rules for text, and quick-reply buttons.' },
  { id: 'extensions', label: 'Extensions', icon: Puzzle, group: 'advanced', feature: 'extensions', description: 'Install and manage add-ons.', keywords: 'addons plugins install git', help: 'Install add-ons from a file, a Git repository or a folder, update them, and see what each may do.' },
  { id: 'css', label: 'Custom CSS', icon: Code, group: 'advanced', description: 'Your own style tweaks.', keywords: 'css style snippets', help: 'Small CSS snippets that change how Everloom looks. Safe mode turns them all off.' },
  { id: 'diagnostics', label: 'Diagnostics', icon: Stethoscope, group: 'advanced', description: 'Tests, model calls and errors.', keywords: 'errors logs report test', help: 'Test connections, read recent model calls and server errors, and download a report to attach to a bug.' },
  { id: 'about', label: 'About', icon: Bot, group: 'advanced', simple: true, description: 'Version and credits.', keywords: 'version credits licenses', help: 'Which version you run, and the people and projects Everloom builds on.' },
];

export interface Scope {
  features: FeatureSet;
  /** On the play screen of a chat. */
  chat: boolean;
  /** That chat has a game. */
  game: boolean;
  experimental: boolean;
}

/** Whether an entry exists here: switched-off modules leave no trace. */
export function available(e: Entry, s: Scope): boolean {
  if (e.experimental && !s.experimental) return false;
  if (e.chat && !s.chat) return false;
  if (e.game && !(s.game && s.features.on.game)) return false;
  if (e.memory && s.features.memory === 'off') return false;
  if (e.features && !e.features.every((f) => s.features.on[f])) return false;
  return true;
}

export const entry = (id: string) => ENTRIES.find((e) => e.id === id);
export const settingsPage = (id: string) => SETTINGS_PAGES.find((p) => p.id === id);
/** The registry entry for a game tool id (for its "What is this?"). */
export const entryForTool = (toolId: string) => ENTRIES.find((e) => e.target.kind === 'tool' && e.target.tool === toolId && !e.target.arg) ?? ENTRIES.find((e) => e.target.kind === 'tool' && e.target.tool === toolId);
