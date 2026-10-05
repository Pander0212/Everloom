/** What the status bar can show (kept apart so settings screens don't load the status bar itself). */
export const HUD_OPTIONS = [
  ['time', 'Time'],
  ['date', 'Date'],
  ['weather', 'Weather'],
  ['location', 'Location'],
  ['currency', 'Money'],
  ['hp', 'HP'],
  ['mp', 'MP'],
  ['ap', 'AP'],
  ['xp', 'XP'],
  ['hunger', 'Hunger'],
  ['energy', 'Energy'],
  ['hygiene', 'Hygiene'],
  ['status', 'Status'],
] as const;
