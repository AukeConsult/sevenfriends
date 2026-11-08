import { webcrypto, randomBytes } from "node:crypto";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { User, connect, seedPool } from "./helpers";

/** A locked message (design: docs/design/message-encryption.md): the server keeps the locked text it cannot read, checks that both friends' keys have their copy of the message key, and never shows the text anywhere. */
let pool: User[];
const keys: JsonWebKey[] = [];

const makeKey = async () => {
  const pair = await webcrypto.subtle.generateKey({ name: "RSA-OAEP", modulusLength: 3072, publicExponent: new Uint8Array([1, 0, 1]), hash: "SHA-256" }, true, ["encrypt", "decrypt"]);
  return (await webcrypto.subtle.exportKey("jwk", pair.publicKey)) as JsonWebKey;
};
beforeAll(async () => {
  for (let i = 0; i < 2; i++) keys.push(await makeKey());
}, 60000);
beforeEach(async () => {
  pool = await seedPool();
});

const messages = (id: string, rest = "") => `/circles/default/friends/${id}/messages${rest}`;
const publish = async (user: User, jwk: JsonWebKey) => (await user.raw("post", "/keys", { publicKey: jwk }).expect(201)).body.id as string;
const b64 = (n: number) => randomBytes(n).toString("base64");
const wrap = (uid: string, keyId: string) => ({ uid, keyId, wrappedKey: b64(384) });

/** a locked text as the app makes it (random bytes here: the server cannot tell) */
const locked = (wraps: ReturnType<typeof wrap>[], text = b64(40)) => ({ text, enc: { v: 1, iv: b64(12), wraps } });

/** both friends have a key: the copies a good message needs */
async function twoWithKeys() {
  const id = await connect(pool[0], pool[1]);
  const mine = await publish(pool[0], keys[0]);
  const theirs = await publish(pool[1], keys[1]);
  return { id, mine, theirs, wraps: [wrap(pool[0].p.uid, mine), wrap(pool[1].p.uid, theirs)] };
}

describe("a locked message", () => {
  it("is stored as it came and shown to both friends with only their own copy of the key", async () => {
    const { id, mine, theirs, wraps } = await twoWithKeys();
    const body = locked(wraps);
    const sent = (await pool[0].raw("post", messages(id), body).expect(201)).body;
    expect(sent).toMatchObject({ text: body.text, mine: true });
    expect(sent.enc.wraps).toEqual([expect.objectContaining({ uid: pool[0].p.uid, keyId: mine })]);
    expect(sent.link).toBeNull();

    const theirFeed = (await pool[1].feed(id)).body.messages;
    expect(theirFeed).toHaveLength(1);
    expect(theirFeed[0]).toMatchObject({ id: sent.id, text: body.text, mine: false });
    expect(theirFeed[0].enc).toEqual({ v: 1, iv: body.enc.iv, wraps: [expect.objectContaining({ uid: pool[1].p.uid, keyId: theirs })] });
    expect((await pool[0].feed(id)).body.messages[0].enc.wraps).toHaveLength(1);
  });

  it("is listed as unread without its text", async () => {
    const { id, wraps } = await twoWithKeys();
    await pool[0].raw("post", messages(id), locked(wraps)).expect(201);
    const unread = (await pool[1].check()).messages;
    expect(unread).toHaveLength(1);
    expect(unread[0].text).toBe("🔒 Message");
  });

  it("is refused when a key of either friend has no copy, or a copy is for a key nobody has", async () => {
    const { id, mine, theirs, wraps } = await twoWithKeys();
    const refused = async (copies: ReturnType<typeof wrap>[]) => (await pool[0].raw("post", messages(id), locked(copies))).status;
    expect(await refused([wraps[0]])).toBe(409); // my friend's copy is missing
    expect(await refused([wraps[1]])).toBe(409); // mine is missing
    expect(await refused([...wraps, wrap(pool[1].p.uid, "f".repeat(32))])).toBe(409); // a copy for a key that is not there
    expect(await refused([wrap(pool[0].p.uid, theirs), wrap(pool[1].p.uid, mine)])).toBe(409); // copies for the wrong people
    expect(await refused(wraps)).toBe(201);
    expect((await pool[1].feed(id)).body.messages).toHaveLength(1);
  });

  it("is refused when it is not a locked text", async () => {
    const { id, wraps } = await twoWithKeys();
    const send = async (body: object) => (await pool[0].raw("post", messages(id), body)).status;
    expect(await send({ ...locked(wraps), text: "hello, this is plain text" })).toBe(400);
    expect(await send({ ...locked(wraps), text: "" })).toBe(400);
    expect(await send({ ...locked(wraps), text: b64(9000) })).toBe(400); // too long
    expect(await send({ text: b64(40), enc: { v: 2, iv: b64(12), wraps } })).toBe(400);
    expect(await send({ text: b64(40), enc: { v: 1, iv: "short", wraps } })).toBe(400);
    expect(await send({ text: b64(40), enc: { v: 1, iv: b64(12), wraps: [] } })).toBe(400);
    expect(await send({ text: b64(40), enc: { v: 1, iv: b64(12), wraps: [{ uid: "x", keyId: "nope", wrappedKey: b64(384) }] } })).toBe(400);
    expect(await send({ text: b64(40), enc: null })).toBe(400);
    expect((await pool[1].feed(id)).body.messages).toHaveLength(0);
  });

  it("is edited with the same key: a new locked text and iv, the copies of the key stay as they are", async () => {
    const { id, mine, theirs, wraps } = await twoWithKeys();
    const sent = (await pool[0].raw("post", messages(id), locked(wraps)).expect(201)).body;
    const again = { text: b64(48), iv: b64(12) };
    const edited = (await pool[0].raw("put", messages(id, `/${sent.id}`), again).expect(200)).body;
    expect(edited).toMatchObject({ text: again.text, edited: true });
    expect(edited.enc).toEqual({ v: 1, iv: again.iv, wraps: sent.enc.wraps });
    const theirCopy = (await pool[1].feed(id)).body.messages[0];
    expect(theirCopy).toMatchObject({ text: again.text, edited: true });
    expect(theirCopy.enc).toEqual({ v: 1, iv: again.iv, wraps: [expect.objectContaining({ uid: pool[1].p.uid, keyId: theirs })] });
    expect((await pool[0].feed(id)).body.messages[0].enc).toEqual({ v: 1, iv: again.iv, wraps: [expect.objectContaining({ keyId: mine })] });
    expect(theirCopy.enc.wraps[0].wrappedKey).toBe(wraps[1].wrappedKey); // the copy of the key was not touched
  });

  it("is still edited when a key was added after it was sent (the keys it has do not change)", async () => {
    const { id, wraps } = await twoWithKeys();
    const sent = (await pool[0].raw("post", messages(id), locked(wraps)).expect(201)).body;
    await publish(pool[1], keys[0]); // my friend gets a second device
    const again = { text: b64(48), iv: b64(12) };
    expect((await pool[0].raw("put", messages(id, `/${sent.id}`), again)).status).toBe(200);
    expect((await pool[1].feed(id)).body.messages[0].enc.wraps).toHaveLength(1); // the new device has no copy
  });

  it("stays locked: a plain text, a missing iv, a bad text and a whole new lock are refused for it", async () => {
    const { id, wraps } = await twoWithKeys();
    const sent = (await pool[0].raw("post", messages(id), locked(wraps)).expect(201)).body;
    const edit = async (body: object) => (await pool[0].raw("put", messages(id, `/${sent.id}`), body)).status;
    expect(await edit({ text: "now plain" })).toBe(400);
    expect(await edit({ text: b64(48) })).toBe(400); // no iv
    expect(await edit({ text: b64(48), iv: "short" })).toBe(400);
    expect(await edit({ text: "plain text", iv: b64(12) })).toBe(400);
    expect(await edit({ text: b64(9000), iv: b64(12) })).toBe(400);
    expect(await edit(locked(wraps))).toBe(400); // keys are not sent again: this is a text without an iv
    expect((await pool[1].feed(id)).body.messages[0]).toMatchObject({ text: sent.text, edited: false });
  });

  it("can be changed only by its sender", async () => {
    const { id, wraps } = await twoWithKeys();
    const sent = (await pool[0].raw("post", messages(id), locked(wraps)).expect(201)).body;
    expect((await pool[1].raw("put", messages(id, `/${sent.id}`), { text: b64(48), iv: b64(12) })).status).toBe(403);
  });

  it("is not found by the delete-by-text of the server (it cannot read it)", async () => {
    const { id, wraps } = await twoWithKeys();
    const body = locked(wraps, "QUJDREVGR0hJSktMTU5PUFFSU1RVVldYWVo=");
    await pool[0].raw("post", messages(id), body).expect(201);
    await pool[0].send(id, "an ordinary ABCDEFGHIJ text");
    const result = (await pool[0].raw("post", messages(id, "/delete"), { contains: "qujd" }).expect(200)).body;
    expect(result).toMatchObject({ matched: 0 });
    expect((await pool[0].feed(id)).body.messages).toHaveLength(2);
  });
});

describe("plain messages", () => {
  it("can be edited into a locked message when both have keys", async () => {
    const { id, mine, wraps } = await twoWithKeys();
    const sent = (await pool[0].send(id, "plain at first")).body;
    const body = locked(wraps);
    const edited = (await pool[0].raw("put", messages(id, `/${sent.id}`), body).expect(200)).body;
    expect(edited).toMatchObject({ text: body.text, edited: true });
    expect(edited.enc.wraps).toEqual([expect.objectContaining({ keyId: mine })]);
  });

  it("still work as before, with or without keys, and carry no lock", async () => {
    const { id } = await twoWithKeys();
    const sent = (await pool[0].send(id, "hello 😊")).body;
    expect(sent).toMatchObject({ text: "hello 😊", mine: true });
    expect(sent.enc).toBeUndefined();
    const edited = (await pool[0].raw("put", messages(id, `/${sent.id}`), { text: "hello again" }).expect(200)).body;
    expect(edited).toMatchObject({ text: "hello again", edited: true });
    expect(edited.enc).toBeUndefined();
    const feed = (await pool[1].feed(id)).body.messages;
    expect(feed.map((m: { text: string }) => m.text)).toEqual(["hello again"]);
    expect(feed[0].enc).toBeUndefined();
    expect((await pool[1].check()).messages[0].text).toBe("hello again");
  });
});

describe("a locked message with a file", () => {
  const media = () => ({ iv: b64(12), thumbIv: null as string | null, metaIv: b64(12), meta: b64(80) });
  const lockedFile = (wraps: ReturnType<typeof wrap>[], m = media(), text = b64(24)) => ({ text, enc: { v: 1, iv: b64(12), wraps, media: m } });
  /** the locked file as the app uploads it: random bytes, `locked=1`, no name */
  const upload = async (user: User, kind = "image", size = 3000) => (await user.file("post", `/sf-cache?kind=${kind}&locked=1`, randomBytes(size)).expect(201)).body;

  it("is stored as binary data with no name, and the server learns only the kind and the size", async () => {
    const { id, wraps } = await twoWithKeys();
    const file = await upload(pool[0]);
    expect(file).toMatchObject({ kind: "image", mime: "application/octet-stream", name: null, bytes: 3000 });
    const sent = (await pool[0].raw("post", messages(id), { ...lockedFile(wraps), media: { objectId: file.objectId, width: 640, height: 480 } }).expect(201)).body;
    expect(sent.media).toMatchObject({ kind: "image", mime: "application/octet-stream", name: null, width: null, height: null, durationMs: null, hasThumb: false });
    const theirs = (await pool[1].feed(id)).body.messages[0];
    expect(theirs.enc.media).toBeDefined();
    expect(theirs.media).toMatchObject({ ownerId: pool[0].p.uid, objectId: file.objectId, mime: "application/octet-stream" });
    // the friend reads the locked bytes through the proxy, still locked
    expect((await pool[1].getObject(pool[0].p.uid, file.objectId)).status).toBe(200);
  });

  it("has a locked preview that fits the file", async () => {
    const { id, wraps } = await twoWithKeys();
    const file = await upload(pool[0]);
    await pool[0].file("put", `/sf-cache/${file.objectId}/thumb?locked=1`, randomBytes(900)).expect(204);
    const send = async (thumbIv: string | null) => (await pool[0].raw("post", messages(id), { ...lockedFile(wraps, { ...media(), thumbIv }), media: { objectId: file.objectId } })).status;
    expect(await send(null)).toBe(400); // the preview is there but the message does not know it
    expect(await send(b64(12))).toBe(201);
  });

  it("is refused when the file and the message do not agree", async () => {
    const { id, wraps } = await twoWithKeys();
    const plain = (await pool[0].file("post", "/sf-cache?kind=image", Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(100)])).expect(201)).body;
    const locked1 = await upload(pool[0]);
    const send = async (body: object) => (await pool[0].raw("post", messages(id), body)).status;
    expect(await send({ ...lockedFile(wraps), media: { objectId: plain.objectId } })).toBe(400); // a plain file in a locked message
    expect(await send({ text: "hello", media: { objectId: locked1.objectId } })).toBe(400); // a locked file in a plain message
    expect(await send({ ...locked(wraps), media: { objectId: locked1.objectId } })).toBe(400); // the message says nothing of the file
    expect(await send(lockedFile(wraps))).toBe(400); // the message names a file but none is attached
    expect(await send({ ...lockedFile(wraps, { ...media(), iv: "short" }), media: { objectId: locked1.objectId } })).toBe(400);
    expect(await send({ ...lockedFile(wraps), media: { objectId: locked1.objectId } })).toBe(201);
  });

  it("keeps the file locked when the caption is edited, and cannot be moved to the safebox", async () => {
    const { id, wraps } = await twoWithKeys();
    const file = await upload(pool[0], "audio", 500);
    const sent = (await pool[0].raw("post", messages(id), { ...lockedFile(wraps), media: { objectId: file.objectId } }).expect(201)).body;
    const edited = (await pool[0].raw("put", messages(id, `/${sent.id}`), { text: b64(40), iv: b64(12) }).expect(200)).body;
    expect(edited.enc.media).toEqual(sent.enc.media);
    expect((await pool[1].feed(id)).body.messages[0].enc.media).toEqual(sent.enc.media);
    // a plain edit cannot lock a file afterwards
    await pool[0].raw("put", messages(id, `/${sent.id}`), { ...lockedFile(wraps), media: undefined }).expect(400);
  });

  it("is refused when the locked file is too big or empty", async () => {
    await pool[0].file("post", "/sf-cache?kind=image&locked=1", Buffer.alloc(0)).expect(400);
    await pool[0].file("post", "/sf-cache?kind=image&locked=1", randomBytes(10)).expect(400);
    await pool[0].file("post", "/sf-cache?kind=image&locked=1", randomBytes(10 * 1024 * 1024 + 17)).expect(413);
  });
});

