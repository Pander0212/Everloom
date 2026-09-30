import { describe, expect, it } from 'vitest';
import { findRemoteMedia, replaceMediaUrls } from '../src/library/media.js';

describe('remote media in cards', () => {
  const text = `<p><img src="https://cdn.example.com/a.png?w=1&amp;h=2" alt="a"></p>
![banner](https://img.example.org/banner.webp "title")
<div style="background: url('https://img.example.org/bg.jpg')"></div>
Plain link https://files.example.net/art/pic.GIF, and a page https://example.com/about (not an image).
<video src="https://cdn.example.com/clip.mp4"></video>
Local /media/m_abcdefghijkl stays. A data:image/png;base64,AAAA stays too.`;

  it('finds image links in markdown, HTML, CSS and bare links, once each', () => {
    expect(findRemoteMedia(text).sort()).toEqual(
      ['https://cdn.example.com/a.png?w=1&h=2', 'https://img.example.org/banner.webp', 'https://img.example.org/bg.jpg', 'https://files.example.net/art/pic.GIF', 'https://cdn.example.com/clip.mp4'].sort(),
    );
    expect(findRemoteMedia('no links here')).toEqual([]);
    expect(findRemoteMedia('see https://example.com/page')).toEqual([]);
  });

  it('points every occurrence at the local copy, including the &amp; form', () => {
    const out = replaceMediaUrls(text, { 'https://cdn.example.com/a.png?w=1&h=2': '/media/m_000000000001', 'https://img.example.org/bg.jpg': '/media/m_000000000002' });
    expect(out).toContain('<img src="/media/m_000000000001"');
    expect(out).toContain("url('/media/m_000000000002')");
    expect(out).not.toContain('cdn.example.com/a.png');
    expect(out).toContain('https://img.example.org/banner.webp'); // not mapped: untouched
  });
});
