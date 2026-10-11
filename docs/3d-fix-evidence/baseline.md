# Original archive baseline

Archive and remote source: 1c88e8aa5e90aed2b34aab9d48768372364e6354.

Untouched archive copy, isolated engine dependency, Chromium, eight viewport/theme projects, one worker. 449 tests: 398 passed, 45 failed, 6 skipped; 2.5 hours. No rebuild took place during this run.

The earlier overlapping run (383 passes, 60 failures, 6 skips) is not used as the clean baseline.

Failures:

  1) [phone-390-dark] › tests\e2e\avatars.spec.ts:81:3 › 3D characters › import through the wizard: checks, settings, picture 
  2) [phone-390-dark] › tests\e2e\avatars.spec.ts:134:3 › 3D characters › a character with an avatar is 3D on the stage; emotes play; pictures when 3D is off here 
  3) [phone-390-dark] › tests\e2e\avatars.spec.ts:233:3 › 3D characters › code-made: make one, edit it, and pictureless characters appear as code-made figures 
  4) [phone-390-dark] › tests\e2e\avatars.spec.ts:329:3 › 3D characters › parts maker on a phone: build, save, use on the stage, and an equipped item swaps a part 
  5) [phone-390-dark] › tests\e2e\avatars.spec.ts:442:3 › 3D characters › the story changes the outfit and a swipe takes it back; a dance keeps time with the music; the dressing room 
  6) [phone-390-dark] › tests\e2e\avatars.spec.ts:635:3 › 3D characters › nothing 3D downloads on screens without 3D 
  7) [phone-390-dark] › tests\e2e\economy.spec.ts:126:3 › economy and home › shopping → crafting at home → paying rent 
  8) [phone-390-dark] › tests\e2e\lore-ai.spec.ts:8:3 › lorebook AI › generate entries, pick some, add them; write one entry with AI and undo 
  9) [phone-390-dark] › tests\e2e\party.spec.ts:102:3 › party and battle › formation, tactics, level-up, skills → battle with a reserve swap, a break and a summary 
  10) [phone-390-dark] › tests\e2e\roleplay.spec.ts:19:3 › roleplay core › import a card, chat with streaming, swipe, edit, branch and delete with state rollback 
  11) [phone-390-dark] › tests\e2e\roleplay.spec.ts:121:3 › roleplay core › prompt inspector, author note, search and export 
  12) [phone-390-light] › tests\e2e\art.spec.ts:149:3 › Everloom art › the asset library adds Everloom's backgrounds once; the demo character comes with expressions 
  13) [phone-390-light] › tests\e2e\avatars.spec.ts:134:3 › 3D characters › a character with an avatar is 3D on the stage; emotes play; pictures when 3D is off here 
  14) [phone-390-light] › tests\e2e\game.spec.ts:46:3 › game core › tracker updates the HUD, inventory use, NPCs, journal, calendar and stage mode 
  15) [phone-390-light] › tests\e2e\scripting.spec.ts:110:3 › scripting › slash commands, quick replies, a script button, and the loop guard 
  16) [phone-390-light] › tests\e2e\scripting.spec.ts:249:3 › scripting › a lorebook script runs when its entry activates 
  17) [phone-390-light] › tests\e2e\stage.spec.ts:351:3 › stage and sound › asset library: import a zip, give an expression set to a character, set a background 
  18) [phone-390-light] › tests\e2e\travel.spec.ts:128:3 › travel › transit with a ticket → arrival → a blocked route explains the fix 
  19) [phone-390-light] › tests\e2e\update-recovery.spec.ts:15:3 › recovering from an update › a part of the app that fails to load reloads once, then offers Reload and Reset instead of spinning 
  20) [phone-390-light] › tests\e2e\vault.spec.ts:12:3 › vault › turn it on, keep the recovery key, lock now, unlock with the passphrase 
  21) [phone-360-dark] › tests\e2e\avatars.spec.ts:134:3 › 3D characters › a character with an avatar is 3D on the stage; emotes play; pictures when 3D is off here 
  22) [phone-360-dark] › tests\e2e\avatars.spec.ts:233:3 › 3D characters › code-made: make one, edit it, and pictureless characters appear as code-made figures 
  23) [phone-360-dark] › tests\e2e\avatars.spec.ts:329:3 › 3D characters › parts maker on a phone: build, save, use on the stage, and an equipped item swaps a part 
  24) [phone-360-dark] › tests\e2e\avatars.spec.ts:442:3 › 3D characters › the story changes the outfit and a swipe takes it back; a dance keeps time with the music; the dressing room 
  25) [phone-360-dark] › tests\e2e\scripting.spec.ts:249:3 › scripting › a lorebook script runs when its entry activates 
  26) [phone-360-light] › tests\e2e\avatars.spec.ts:81:3 › 3D characters › import through the wizard: checks, settings, picture 
  27) [phone-360-light] › tests\e2e\avatars.spec.ts:134:3 › 3D characters › a character with an avatar is 3D on the stage; emotes play; pictures when 3D is off here 
  28) [phone-360-light] › tests\e2e\avatars.spec.ts:233:3 › 3D characters › code-made: make one, edit it, and pictureless characters appear as code-made figures 
  29) [phone-360-light] › tests\e2e\avatars.spec.ts:329:3 › 3D characters › parts maker on a phone: build, save, use on the stage, and an equipped item swaps a part 
  30) [phone-360-light] › tests\e2e\avatars.spec.ts:442:3 › 3D characters › the story changes the outfit and a swipe takes it back; a dance keeps time with the music; the dressing room 
  31) [phone-360-light] › tests\e2e\avatars.spec.ts:578:3 › 3D characters › 3D on the character sheet and in the asset library 
  32) [phone-360-light] › tests\e2e\scripting.spec.ts:249:3 › scripting › a lorebook script runs when its entry activates 
  33) [landscape-844-dark] › tests\e2e\art.spec.ts:149:3 › Everloom art › the asset library adds Everloom's backgrounds once; the demo character comes with expressions 
  34) [landscape-844-dark] › tests\e2e\library.spec.ts:93:3 › character library › select several, delete, undo; import a bundle with a preview 
  35) [landscape-844-dark] › tests\e2e\library.spec.ts:170:3 › character library › what should I play: three picks with reasons; a pick opens the character 
  36) [landscape-844-dark] › tests\e2e\scripting.spec.ts:249:3 › scripting › a lorebook script runs when its entry activates 
  37) [landscape-844-dark] › tests\e2e\scripting.spec.ts:315:3 › scripting › 50 interactive messages: frames mount near the screen only 
  38) [landscape-844-light] › tests\e2e\scripting.spec.ts:249:3 › scripting › a lorebook script runs when its entry activates 
  39) [desktop-1280-dark] › tests\e2e\avatars.spec.ts:134:3 › 3D characters › a character with an avatar is 3D on the stage; emotes play; pictures when 3D is off here 
  40) [desktop-1280-dark] › tests\e2e\avatars.spec.ts:233:3 › 3D characters › code-made: make one, edit it, and pictureless characters appear as code-made figures 
  41) [desktop-1280-dark] › tests\e2e\avatars.spec.ts:442:3 › 3D characters › the story changes the outfit and a swipe takes it back; a dance keeps time with the music; the dressing room 
  42) [desktop-1280-dark] › tests\e2e\scripting.spec.ts:249:3 › scripting › a lorebook script runs when its entry activates 
  43) [desktop-1280-light] › tests\e2e\avatars.spec.ts:233:3 › 3D characters › code-made: make one, edit it, and pictureless characters appear as code-made figures 
  44) [desktop-1280-light] › tests\e2e\extensions.spec.ts:95:3 › extensions › town reputation: a custom game op that rolls back with its message 
  45) [desktop-1280-light] › tests\e2e\scripting.spec.ts:249:3 › scripting › a lorebook script runs when its entry activates 
