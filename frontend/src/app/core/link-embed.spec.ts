import { firstUrl, localLink, playerUrl } from './link-embed';

describe('the link of a locked message', () => {
  it('finds the first web address and leaves the punctuation of the sentence out', () => {
    expect(firstUrl('see https://example.com/a?b=1, ok')).toBe('https://example.com/a?b=1');
    expect(firstUrl('no link here')).toBeNull();
    expect(firstUrl('ftp://example.com')).toBeNull();
    expect(firstUrl('https://user:pass@example.com/')).toBeNull();
  });

  it('gives the official player for YouTube, Vimeo and Spotify, like the server', () => {
    const player = (u: string) => playerUrl(new URL(u));
    expect(player('https://youtu.be/dQw4w9WgXcQ')).toBe('https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ');
    expect(player('https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=3')).toBe('https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ');
    expect(player('https://m.youtube.com/shorts/abcdefghijk')).toBe('https://www.youtube-nocookie.com/embed/abcdefghijk');
    expect(player('https://vimeo.com/123456789')).toBe('https://player.vimeo.com/video/123456789');
    expect(player('https://open.spotify.com/track/4uLU6hMCjMI75M1A2tKUQC?si=x')).toBe('https://open.spotify.com/embed/track/4uLU6hMCjMI75M1A2tKUQC');
    expect(player('https://example.com/watch?v=dQw4w9WgXcQ')).toBeNull();
    expect(player('https://www.youtube.com/watch?v=<script>')).toBeNull();
  });

  it('a known player is checked by its nature, any other page is offered as unchecked', () => {
    expect(localLink('look https://youtu.be/dQw4w9WgXcQ')).toEqual({ url: 'https://youtu.be/dQw4w9WgXcQ', embedUrl: 'https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ' });
    expect(localLink('read https://example.com/news')).toEqual({ url: 'https://example.com/news', embedUrl: 'https://example.com/news', unchecked: true });
    expect(localLink('just words')).toBeNull();
  });
});
