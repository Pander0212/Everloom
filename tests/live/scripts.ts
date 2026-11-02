/**
 * Scripted sessions for the live ECHO tests. Each plants things ECHO must handle (a promise, a
 * whispered secret, a lie, a hidden object), then plays on long enough that they leave the
 * recent window, then probes them.
 *
 * Probe checks on the reply are about the WRITER's behavior (a real model), so they are reported,
 * not asserted. Packet checks are about ECHO itself.
 */
export interface Probe {
  tag: string;
  kind: 'recall' | 'secret' | 'lie' | 'hidden' | 'far';
  note: string;
  replyMentions?: string[];
  replyAvoids?: string[];
  packetMentions?: string[];
  packetAvoids?: string[];
}
export interface Script {
  persona: { name: string; description: string };
  narration: 'character' | 'persona' | 'omniscient';
  turns: Array<{ text: string; tag?: string }>;
  probes: Probe[];
}

const filler = (lines: string[]) => lines.map((text) => ({ text }));

export const SCRIPTS: Record<string, Script> = {
  guildbound: {
    persona: { name: 'Rin Ashford', description: 'Rin Ashford, 24, a lanky half-elf woman with silver hair in a braid and green eyes. Dry humor, curious, cautious with strangers. Reincarnated from Earth, where she was a librarian.' },
    narration: 'persona',
    turns: [
      { text: 'I step up to the counter. "I\'d like to register as a Ranger, please."', tag: 'register' },
      { text: 'I ask Miki which quest on the board is the most urgent, and who posted it.' },
      { text: 'I look Miki in the eye. "I promise you I\'ll bring back three wolf pelts before the harvest festival. You have my word."', tag: 'promise' },
      { text: 'I climb to the balcony, lean close to the one-armed dwarf and whisper so quietly that nobody else can hear: "I\'m not from this world. I died on Earth and woke up here."', tag: 'secret' },
      { text: 'Back downstairs, Miki asks where I\'m from for the registry. I smile and lie: "A little fishing village called Lowmere, far in the south."', tag: 'lie' },
      { text: 'While nobody is looking, I slip the strange black iron key I found in my pocket this morning into my left boot.', tag: 'hide' },
      ...filler([
        'I head to the market and look for a cheap but decent bow.',
        'I haggle with the merchant and try to get the price down.',
        'With my new bow, I walk out of Helm toward the Whisperwood where the wolves were seen.',
        'I search the forest edge for tracks and signs of the pack.',
        'I find a good spot downwind and wait for the wolves.',
        'When the wolves come, I fight them with my bow, staying at range.',
        'After the fight I skin the wolves carefully and pack the pelts.',
        'I make camp for the night by a stream and check my status window.',
        'In the morning I walk back to Helm, keeping an eye on the road.',
      ]),
      { text: 'Back at the guild, I put three wolf pelts on Miki\'s counter. "As promised."', tag: 'kept' },
      { text: 'I ask Miki: "Be honest — has anyone told you anything about where I really come from?"', tag: 'probe-secret' },
      { text: '"Miki, for the registry — where did I tell you I was from again?"', tag: 'probe-lie' },
      { text: 'I go up to the one-armed dwarf and ask him quietly if he noticed what I put in my boot the other day.', tag: 'probe-hidden' },
      { text: 'I sit down with a mug of ale and think back to my very first moment in this hall. What class did I register as, and what did I promise Miki that day?', tag: 'probe-far' },
    ],
    probes: [
      { tag: 'kept', kind: 'recall', note: 'The promise is remembered when it is kept', replyMentions: ['pelt'], packetMentions: ['pelt'] },
      { tag: 'probe-secret', kind: 'secret', note: 'Miki was not there for the whisper: she must not know about Earth', replyAvoids: ['earth', 'another world', 'died'] },
      { tag: 'probe-lie', kind: 'lie', note: 'Miki believes the lie', replyMentions: ['lowmere'] },
      { tag: 'probe-hidden', kind: 'hidden', note: 'Nobody saw the key go into the boot', replyAvoids: ['iron key', 'black key', 'black iron', 'i noticed', 'i saw', 'saw you'] },
      { tag: 'probe-far', kind: 'far', note: 'Far recall of class and promise', replyMentions: ['ranger', 'pelt'], packetMentions: ['ranger'] },
    ],
  },
  korra: {
    persona: { name: 'Tamsin Wu', description: 'Tamsin Wu, 22, a non-bender mechanic from the Dragon Flat borough of Republic City. Short black hair, grease on her hands, quick wit, distrusts politicians. Works on Satomobiles.' },
    narration: 'persona',
    turns: [
      { text: 'I\'m fixing a stalled Satomobile outside the Pro-bending Arena when Bolin walks by. I wave him over and introduce myself.', tag: 'meet' },
      { text: 'I tell Bolin: "I promise I\'ll fix the Fire Ferrets\' broken equipment cart before Saturday\'s match. Free of charge."', tag: 'promise' },
      { text: 'That night I sneak into an abandoned cannery and hide behind crates. Nobody knows I\'m there. I overhear masked Equalists planning to sabotage the arena\'s lights during Saturday\'s match.', tag: 'secret' },
      { text: 'Next morning Mako asks me where I was last night. I lie: "Just at home, sleeping early. Long week."', tag: 'lie' },
      { text: 'When no one is watching, I hide the Equalist pamphlet I picked up at the cannery inside my toolbox, under the false bottom.', tag: 'hide' },
      ...filler([
        'I spend the morning repairing the Fire Ferrets\' equipment cart in my garage.',
        'I take a tram across Republic City to buy spare parts.',
        'At the market I run into Korra and we talk about the city.',
        'I watch Korra practise airbending in the park and tease her a little.',
        'I go back to my garage and finish the cart.',
        'In the evening I eat noodles at Narook\'s with Bolin and Pabu.',
        'I walk home along the bay, thinking about the city.',
        'On Saturday morning I deliver the repaired cart to the arena.',
      ]),
      { text: 'Before the match, I find Mako in the locker room. "Hey — do you still think I was home last night, that night you asked?"', tag: 'probe-lie' },
      { text: 'I ask Bolin: "Did anyone tell you about any trouble planned for tonight\'s match?"', tag: 'probe-secret' },
      { text: 'Bolin asks what I keep in my toolbox. I just shrug and look at him.', tag: 'probe-hidden' },
      { text: 'I remind Bolin of what I promised him the day we met, and ask if he remembers.', tag: 'probe-far' },
    ],
    probes: [
      { tag: 'probe-lie', kind: 'lie', note: 'Mako still believes she was home', replyMentions: ['home'] },
      { tag: 'probe-secret', kind: 'secret', note: 'Bolin was not at the cannery: he must not know about the sabotage', replyAvoids: ['sabotage', 'equalist', 'lights'] },
      { tag: 'probe-hidden', kind: 'hidden', note: 'Nobody saw the pamphlet go into the toolbox', replyAvoids: ['pamphlet', 'equalist', 'i saw', 'saw you'] },
      { tag: 'probe-far', kind: 'far', note: 'Far recall of the promise', replyMentions: ['cart'], packetMentions: ['cart'] },
    ],
  },
};
