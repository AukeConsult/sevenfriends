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

  it("is edited with a new lock, and only a locked text may replace it", async () => {
    const { id, mine, theirs, wraps } = await twoWithKeys();
    const sent = (await pool[0].raw("post", messages(id), locked(wraps)).expect(201)).body;
    expect((await pool[0].raw("put", messages(id, `/${sent.id}`), { text: "now plain" })).status).toBe(400); // a locked message stays locked
    const again = locked(wraps);
    const edited = (await pool[0].raw("put", messages(id, `/${sent.id}`), again).expect(200)).body;
    expect(edited).toMatchObject({ text: again.text, edited: true });
    const theirCopy = (await pool[1].feed(id)).body.messages[0];
    expect(theirCopy).toMatchObject({ text: again.text, edited: true });
    expect(theirCopy.enc).toEqual({ v: 1, iv: again.enc.iv, wraps: [expect.objectContaining({ uid: pool[1].p.uid, keyId: theirs })] });
    expect((await pool[0].feed(id)).body.messages[0].enc.wraps).toEqual([expect.objectContaining({ keyId: mine })]);
    expect((await pool[0].raw("put", messages(id, `/${sent.id}`), locked([wraps[0]]))).status).toBe(409); // a copy is missing
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
