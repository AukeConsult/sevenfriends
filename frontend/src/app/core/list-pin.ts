/**
 * The pin that travels in a friend link (docs/design/default-key.md, step 3): after the `#` of the link, which a browser never sends to a server, come the id of the
 * person who made the link and the version and hash of their newest device list: `#u=<uid>&v=<version>&h=<first 32 hex of the list hash>`. Whoever follows the link
 * pins that list from the first moment, so the server cannot hand them a different list of that person at the first meeting.
 */
export interface LinkPin {
  uid: string;
  version: number;
  /** the first 32 hex characters of the hash of that version of the list */
  hash: string;
}

const STORE = 'sf-link-pins';
const MAX_PINS = 50;

/** The text after the `#` of a link for this list, or '' when there is none. */
export const pinFragment = (uid: string, version: number, hash: string): string => `#u=${encodeURIComponent(uid)}&v=${version}&h=${hash.slice(0, 32)}`;

/** The pin in the fragment of a link (with or without the `#`), or null when it is not one. */
export function parsePinFragment(fragment: string): LinkPin | null {
  const params = new URLSearchParams(fragment.replace(/^#/, ''));
  const uid = params.get('u') ?? '';
  const version = Number(params.get('v'));
  const hash = (params.get('h') ?? '').toLowerCase();
  return /^[A-Za-z0-9_-]{1,128}$/.test(uid) && Number.isInteger(version) && version >= 1 && version <= 1000 && /^[0-9a-f]{32}$/.test(hash) ? { uid, version, hash } : null;
}

const readAll = (): LinkPin[] => {
  try {
    const list = JSON.parse(localStorage.getItem(STORE) ?? '[]') as unknown;
    return Array.isArray(list) ? list.map((p) => parsePinFragment(`u=${p?.uid}&v=${p?.version}&h=${p?.hash}`)).filter((p): p is LinkPin => !!p) : [];
  } catch {
    return [];
  }
};

/** Keeps the pin of a link on this device until the list it names has been seen (a newer pin of the same person replaces an older one). */
export function keepLinkPin(pin: LinkPin): void {
  try {
    localStorage.setItem(STORE, JSON.stringify([...readAll().filter((p) => p.uid !== pin.uid), pin].slice(-MAX_PINS)));
  } catch {
    /* no storage: the link still works, without the pin */
  }
}

export const linkPinOf = (uid: string): LinkPin | null => readAll().find((p) => p.uid === uid) ?? null;

/** The pin has been checked against the lists (or replaced by the ordinary pin): it is not needed any more. */
export function dropLinkPin(uid: string): void {
  try {
    localStorage.setItem(STORE, JSON.stringify(readAll().filter((p) => p.uid !== uid)));
  } catch {
    /* nothing to drop */
  }
}
