/** Choosing the music for the moment (pure, so the browser and tests agree). */
import type { CampaignState } from './state.js';

export type Playlist = { id: string; name: string; mood: string; tracks: string[]; place?: string; time?: 'day' | 'night' };

/**
 * Which playlist fits now: one the scene asked for by name, the battle playlist during a battle,
 * one for the scene's mood, then one for this place (a location kind or name) and time of day.
 */
export function pickPlaylist(s: CampaignState, lists: Playlist[]): Playlist | null {
  const usable = lists.filter((p) => p.tracks.length);
  const lc = (x?: string | null) => (x ?? '').trim().toLowerCase();
  const music = s.stage?.music;
  const byName = music?.playlist ? usable.find((p) => lc(p.name) === lc(music.playlist)) : undefined;
  if (byName) return byName;
  if (s.battle) {
    const battle = usable.find((p) => lc(p.mood) === 'battle');
    if (battle) return battle;
  }
  const byMood = music?.mood ? usable.find((p) => lc(p.mood) === lc(music.mood)) : undefined;
  if (byMood) return byMood;
  const loc = s.currentLocationId ? s.locations[s.currentLocationId] : null;
  const hour = Math.floor((((s.time.minutes % 1440) + 1440) % 1440) / 60);
  const time = hour >= 6 && hour < 20 ? 'day' : 'night';
  const placeOk = (p: Playlist) => !p.place || (!!loc && [loc.kind, loc.name].some((x) => lc(x) === lc(p.place)));
  const timeOk = (p: Playlist) => !p.time || p.time === time;
  const contextual = usable.filter((p) => (p.place || p.time) && placeOk(p) && timeOk(p));
  // The most specific match wins: place and time, then place, then time.
  contextual.sort((x, y) => (y.place ? 2 : 0) + (y.time ? 1 : 0) - ((x.place ? 2 : 0) + (x.time ? 1 : 0)));
  return contextual[0] ?? null;
}
