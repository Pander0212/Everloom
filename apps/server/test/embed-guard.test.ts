import { describe, expect, it } from 'vitest';
import { embeddingsPaused, noteEmbeddingFailure } from '../src/services/embed-guard.js';

describe('embedding pauses', () => {
  it('pauses for a refusal, for a rate limit (as long as asked), and not for an outage', () => {
    expect(noteEmbeddingFailure('a', new Error('Upstream 429: This API key is set to subscription-only billing and cannot spend from your balance.'))).toBe(true);
    expect(embeddingsPaused('a')).toBe(true);
    expect(noteEmbeddingFailure('b', new Error('Upstream 429: Rate limit exceeded. Try again in 157 seconds.'))).toBe(true);
    expect(embeddingsPaused('b')).toBe(true);
    expect(noteEmbeddingFailure('c', new Error('Upstream 503: service unavailable'))).toBe(false);
    expect(embeddingsPaused('c')).toBe(false);
  });
});
