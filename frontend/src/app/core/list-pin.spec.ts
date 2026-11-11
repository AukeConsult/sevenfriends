import { dropLinkPin, keepLinkPin, linkPinOf, parsePinFragment, pinFragment } from './list-pin';

describe('the pin in a friend link', () => {
  const hash = 'a1b2c3d4'.repeat(8); // 64 hex characters
  afterEach(() => dropLinkPin('uid-1'));

  it('is written after the # and read back', () => {
    const fragment = pinFragment('uid-1', 3, hash);
    expect(fragment.startsWith('#u=uid-1&v=3&h=')).toBeTrue();
    expect(parsePinFragment(fragment)).toEqual({ uid: 'uid-1', version: 3, hash: hash.slice(0, 32) });
  });

  it('is refused when anything in it is not valid', () => {
    for (const bad of ['', '#', '#u=a&v=0&h=' + hash.slice(0, 32), '#u=a&v=x&h=' + hash.slice(0, 32), '#u=a&v=1&h=short', '#u=a b&v=1&h=' + hash.slice(0, 32), '#v=1&h=' + hash.slice(0, 32)]) {
      expect(parsePinFragment(bad)).withContext(bad).toBeNull();
    }
  });

  it('is kept per person (a newer one replaces an older one) until it is dropped', () => {
    keepLinkPin({ uid: 'uid-1', version: 1, hash: hash.slice(0, 32) });
    keepLinkPin({ uid: 'uid-1', version: 2, hash: hash.slice(0, 32) });
    expect(linkPinOf('uid-1')?.version).toBe(2);
    dropLinkPin('uid-1');
    expect(linkPinOf('uid-1')).toBeNull();
  });
});
