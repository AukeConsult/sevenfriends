import { ENC_HEADER_MAX, EncryptedUploadHeader, PublishedKey, SafeboxEnc, SafeboxKind } from "./models";

/** The server cannot look inside an encrypted file: it checks the shape of what it is sent and that every key of both friends has its copy of the file key. */

const KINDS: readonly SafeboxKind[] = ["image", "video", "audio", "document"];
const BASE64 = /^[A-Za-z0-9+/]+={0,2}$/;
const KEY_ID = /^[0-9a-f]{32}$/;
/** an AES-GCM iv: 12 bytes */
const IV_LENGTH = 16;
/** an RSA-3072 wrapped key: 384 bytes */
const WRAP_LENGTH = 512;
const MAX_META_LENGTH = 1500;
const MAX_WRAPS = 40;

export interface EncryptedUpload {
  header: EncryptedUploadHeader;
  file: Buffer;
  thumb: Buffer | null;
}

export type Refused = { status: number; error: string };
const bad = (error: string, status = 400): Refused => ({ status, error });

const isBase64 = (v: unknown, length?: number): v is string => typeof v === "string" && BASE64.test(v) && (length === undefined || v.length === length);

/** Cuts the request body into header, file and preview, and checks the header's shape. */
export function parseEncryptedUpload(body: Buffer, maxFileBytes: number): EncryptedUpload | Refused {
  if (body.length < 4) return bad("Send the encrypted file as the request body");
  const headerLength = body.readUInt32BE(0);
  if (headerLength === 0 || headerLength > ENC_HEADER_MAX || 4 + headerLength > body.length) return bad("The upload is not valid");
  let json: unknown;
  try {
    json = JSON.parse(body.toString("utf8", 4, 4 + headerLength));
  } catch {
    return bad("The upload is not valid");
  }
  const h = json as Partial<EncryptedUploadHeader> | null;
  const enc = h?.enc as Partial<SafeboxEnc> | undefined;
  if (!h || h.v !== 1 || !enc || enc.v !== 1 || !KINDS.includes(h.kind as SafeboxKind)) return bad("The upload is not valid");
  const { fileLength, thumbLength } = h;
  if (!Number.isInteger(fileLength) || !Number.isInteger(thumbLength) || (fileLength as number) < 16 || (thumbLength as number) < 0) return bad("The upload is not valid");
  if (4 + headerLength + (fileLength as number) + (thumbLength as number) !== body.length) return bad("The upload is not valid");
  if ((fileLength as number) - 16 > maxFileBytes) return bad(`That file is too big (at most ${Math.round(maxFileBytes / 1024 / 1024)} MB)`, 413);
  if (thumbLength && (thumbLength as number) < 16) return bad("The upload is not valid");
  if (!isBase64(enc.iv, IV_LENGTH) || !isBase64(enc.metaIv, IV_LENGTH) || !isBase64(enc.meta) || enc.meta.length > MAX_META_LENGTH) return bad("The upload is not valid");
  if (thumbLength ? !isBase64(enc.thumbIv, IV_LENGTH) : enc.thumbIv !== null) return bad("The upload is not valid");
  if (!Array.isArray(enc.wraps) || !enc.wraps.length || enc.wraps.length > MAX_WRAPS) return bad("The upload is not valid");
  for (const w of enc.wraps) {
    if (!w || typeof w.uid !== "string" || !w.uid || !KEY_ID.test(w.keyId) || !isBase64(w.wrappedKey, WRAP_LENGTH)) return bad("The upload is not valid");
  }
  const start = 4 + headerLength;
  const file = body.subarray(start, start + (fileLength as number));
  const thumb = thumbLength ? body.subarray(start + (fileLength as number)) : null;
  // keep only the known parts of the header (nothing else is stored)
  const clean: EncryptedUploadHeader = {
    v: 1,
    kind: h.kind as SafeboxKind,
    fileLength: fileLength as number,
    thumbLength: thumbLength as number,
    enc: { v: 1, iv: enc.iv, metaIv: enc.metaIv, meta: enc.meta, thumbIv: thumbLength ? (enc.thumbIv as string) : null, wraps: enc.wraps.map((w) => ({ uid: w.uid, keyId: w.keyId, wrappedKey: w.wrappedKey })) },
  };
  return { header: clean, file, thumb };
}

/**
 * Every key in use of me and of my friend must have exactly one copy of the file key, and nothing else may be there. If a key was added or
 * retired while the person was sending, the copies do not fit any more: the app asks again for the keys and locks the file anew.
 */
export function wrapsCover(enc: SafeboxEnc, people: { uid: string; keys: PublishedKey[] }[]): boolean {
  const expected = people.flatMap((p) => p.keys.map((k) => `${p.uid}/${k.id}`));
  const given = enc.wraps.map((w) => `${w.uid}/${w.keyId}`);
  if (!expected.length || new Set(given).size !== given.length || given.length !== expected.length) return false;
  return expected.every((e) => given.includes(e));
}

/** The copies of the file key that a person may see: their own (the others stay on the server). */
export const wrapsFor = (enc: SafeboxEnc, uid: string): SafeboxEnc => ({ ...enc, wraps: enc.wraps.filter((w) => w.uid === uid) });
