import { MessageLink } from '../models';

/**
 * The link of a LOCKED message, found on this device: the server cannot read a locked text, so it makes no preview (design: docs/design/message-encryption.md).
 *  - YouTube, Vimeo and Spotify links get the official player (their players are made for frames), the same as the server does for a plain message.
 *  - Any other address is offered as a page that was NOT checked (`unchecked`): the person taps "Show preview" and the page is tried in a frame,
 *    and stays blank when the site does not allow it. The browser cannot find that out beforehand, only the server can, and it must not see the address.
 */
export type LocalLink = MessageLink & { unchecked?: boolean };

const URL_PATTERN = /https?:\/\/[^\s<>"']+/i;

/** The first web address in a text, without the punctuation that ends a sentence, or null. */
export function firstUrl(text: string): string | null {
  const found = URL_PATTERN.exec(text)?.[0];
  if (!found) return null;
  try {
    const url = new URL(found.replace(/[.,;:!?)\]}]+$/, ''));
    return (url.protocol === 'http:' || url.protocol === 'https:') && !url.username && !url.password ? url.href : null;
  } catch {
    return null;
  }
}

/** The address of the official player for a link to a video or a song, or null (the same rules as the server's `playerUrl`). */
export function playerUrl(url: URL): string | null {
  const host = url.hostname.replace(/^(www|m|music)\./, '');
  const id = /^[\w-]{6,20}$/;
  if (host === 'youtu.be') {
    const v = url.pathname.slice(1).split('/')[0];
    return id.test(v) ? `https://www.youtube-nocookie.com/embed/${v}` : null;
  }
  if (host === 'youtube.com') {
    const v = url.pathname === '/watch' ? url.searchParams.get('v') : /^\/(shorts|embed|live)\/([\w-]{6,20})/.exec(url.pathname)?.[2];
    return v && id.test(v) ? `https://www.youtube-nocookie.com/embed/${v}` : null;
  }
  if (host === 'vimeo.com') {
    const v = /^\/(\d{5,12})(?:\/|$)/.exec(url.pathname)?.[1];
    return v ? `https://player.vimeo.com/video/${v}` : null;
  }
  if (host === 'open.spotify.com') {
    const m = /^\/(track|album|playlist|episode|show|artist)\/([A-Za-z0-9]{10,30})/.exec(url.pathname);
    return m ? `https://open.spotify.com/embed/${m[1]}/${m[2]}` : null;
  }
  return null;
}

/** The link of a text and what can be framed: a known player, or the page itself as `unchecked`. null when the text has no web address. */
export function localLink(text: string): LocalLink | null {
  const href = firstUrl(text);
  if (!href) return null;
  const player = playerUrl(new URL(href));
  return player ? { url: href, embedUrl: player } : { url: href, embedUrl: href, unchecked: true };
}
