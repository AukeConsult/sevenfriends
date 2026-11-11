/**
 * A signed text (docs/design/default-key.md, step 2). The text of a locked message is written inside the lock as SIGNED_MARK followed by this
 * envelope as JSON, so the signature is as secret as the text (a signature next to the lock would let anyone with a guess check it). A text without the mark is an
 * older, unsigned one and is read as it is. The signature is made by the signing key of the writer's device over `signedTextBytes`.
 */
export const SIGNED_MARK = "\u0001";

export interface SignedText {
  v: 1;
  /** the user id of the writer */
  a: string;
  /** the id of the connection (friend or group) the text was written in */
  c: string;
  /** when it was written (ISO), so the same text sent twice is not the same signature */
  t: string;
  /** the key ID of the writer's device (it must be in the writer's device list) */
  k: string;
  /** the text itself */
  x: string;
  /** the signature over `signedTextBytes`, base64 */
  s: string;
}

/** What is signed: a fixed list, tied to this use and to the connection, so a signature cannot be moved to another place. */
export const signedTextBytes = (p: Pick<SignedText, "a" | "c" | "t" | "k" | "x">): string => JSON.stringify(["sf-text-v1", p.a, p.c, p.t, p.k, p.x]);

export const packSignedText = (p: SignedText): string => SIGNED_MARK + JSON.stringify(p);

/** The envelope of a text, "plain" when the text has no mark (an older, unsigned one), or null when it has the mark but is not a valid envelope. */
export function unpackSignedText(text: string): SignedText | "plain" | null {
  if (!text.startsWith(SIGNED_MARK)) return "plain";
  try {
    const p = JSON.parse(text.slice(SIGNED_MARK.length)) as Partial<SignedText>;
    const ok = p.v === 1 && [p.a, p.c, p.t, p.k, p.x, p.s].every((f) => typeof f === "string");
    return ok ? (p as SignedText) : null;
  } catch {
    return null;
  }
}
