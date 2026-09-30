import { Section } from '../common';

export default function AboutSection() {
  return (
    <>
      <Section title="Everloom" description={`Version 0.1.0 · build ${__EVERLOOM_BUILD__.commit} (${__EVERLOOM_BUILD__.date} UTC) · Free software, MIT licensed.`}>
        <p className="text-sm text-fg-2">A self-hosted roleplay frontend with a built-in RPG layer. Your data stays on your server.</p>
      </Section>
      <Section title="Credits">
        <ul className="flex flex-col gap-2 text-sm text-fg-2">
          <li>
            Game-feature inspiration from{' '}
            <a className="text-accent-text underline" href="https://github.com/GetfroggyHoe/Universal-Immersion-Engine-Fugue" target="_blank" rel="noreferrer">
              GetfroggyHoe's reference project
            </a>
            . Everloom is a separate, free implementation.
          </li>
          <li>Memory and living-world ideas from World Engine, the owner's own extension, rebuilt here; no code copied.</li>
          <li>
            Character library ideas from{' '}
            <a className="text-accent-text underline" href="https://github.com/Sillyanonymous/SillyTavern-CharacterLibrary" target="_blank" rel="noreferrer">
              SillyTavern Character Library
            </a>
            , rebuilt here; no code copied.
          </li>
          <li>File formats compatible with SillyTavern character cards, World Info and chats.</li>
          <li>Interface details adapted from uiverse.io (MIT) — see CREDITS.md for each author.</li>
          <li>Icons: Lucide (ISC). Fonts: Inter and Source Serif 4 (SIL OFL).</li>
        </ul>
      </Section>
    </>
  );
}
