import { withSent } from './feed-list';
import { ChatItem } from './message-lock.service';

const item = (id: string, extra: Partial<ChatItem> = {}): ChatItem =>
  ({ id, text: id, media: null, mine: true, read: true, time: '2026-11-15T12:00:00.000Z', edited: false, hidden: false, link: null, ...extra }) as ChatItem;

/** A message of mine that the server already answered (an image, a video, a voice message) goes into the feed once, last. */
describe('withSent', () => {
  it('puts the sent message last', () => {
    const list = [item('a'), item('b')];
    expect(withSent(list, item('c')).map((m) => m.id)).toEqual(['a', 'b', 'c']);
  });

  it('keeps the list as it is when the feed already has the message (a refresh or the live change was faster)', () => {
    const list = [item('a'), item('b')];
    expect(withSent(list, item('b'))).toBe(list); // the same list: nothing changed, nothing is drawn again
  });

  it('works on an empty feed, and never changes the list it was given', () => {
    const empty: ChatItem[] = [];
    expect(withSent(empty, item('a')).map((m) => m.id)).toEqual(['a']);
    expect(empty).toEqual([]);
    const list = [item('a')];
    withSent(list, item('b'));
    expect(list.map((m) => m.id)).toEqual(['a']);
  });

  it('puts it after a message that is still being sent (the temporary one is replaced by the next read of the feed)', () => {
    const list = [item('a'), item('pending-1')];
    expect(withSent(list, item('c')).map((m) => m.id)).toEqual(['a', 'pending-1', 'c']);
  });

  for (const kind of ['image', 'video', 'audio']) {
    it('a ' + kind + ' message keeps its file, goes in once and last, and is not doubled by a read that was faster', () => {
      const media = { ownerId: 'u', objectId: 'o-' + kind, kind, mime: kind + '/x', name: 'f', bytes: 1, width: null, height: null, durationMs: null } as unknown as ChatItem['media'];
      const sent = item('m-' + kind, { media });
      const first = withSent([item('a')], sent);
      expect(first.map((m) => m.id)).toEqual(['a', 'm-' + kind]);
      expect(first[1].media).toBe(media);
      expect(withSent(first, sent)).toBe(first); // the feed read again already has it
    });
  }
});
