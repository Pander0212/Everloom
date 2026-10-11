import { describe, expect, it } from 'vitest';
import { fillQuestions, findQuestions, validAnswer } from '../src/questions.js';

describe('scenario questions', () => {
  const card = 'You are ${What is your name?}, captain of ${Your ship\'s name? | options: The Skipper, Nebula}. ${what is your  NAME?} writes with the ${Which hand? | choices: Left, Right} hand. Cost: \\${price}.';

  it('finds each question once, with its suggestions or fixed choices', () => {
    const qs = findQuestions([card, null, 'Again: ${Your ship\'s name? | options: Dawn}']);
    expect(qs.map((q) => q.text)).toEqual(['What is your name?', "Your ship's name?", 'Which hand?']);
    expect(qs[1]!.options).toEqual(['The Skipper', 'Nebula', 'Dawn']);
    expect(qs[1]!.fixed).toBe(false);
    expect(qs[2]!.fixed).toBe(true);
  });

  it('fills answers everywhere a question appears, keeps escapes, leaves the original alone', () => {
    const qs = findQuestions([card]);
    const answers = Object.fromEntries(qs.map((q, i) => [q.key, ['Mira', 'Nebula', 'Left'][i]!]));
    const out = fillQuestions(card, answers);
    expect(out).toBe("You are Mira, captain of Nebula. Mira writes with the Left hand. Cost: ${price}.");
    expect(card).toContain('${What is your name?}');
  });

  it('leaves unanswered questions as written and checks fixed choices', () => {
    expect(fillQuestions('Hi ${Name?}', {})).toBe('Hi ${Name?}');
    const [hand] = findQuestions(['${Hand? | choices: Left, Right}']);
    expect(validAnswer(hand!, 'left')).toBe(true);
    expect(validAnswer(hand!, 'Both')).toBe(false);
    expect(validAnswer(hand!, ' ')).toBe(false);
  });

  it('is text only: nothing inside a placeholder is evaluated', () => {
    const t = '${constructor.constructor("return 1")()}';
    expect(findQuestions([t])[0]!.text).toBe('constructor.constructor("return 1")()');
    expect(fillQuestions(t, {})).toBe(t);
  });
});
