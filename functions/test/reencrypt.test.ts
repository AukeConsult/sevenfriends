import { webcrypto, randomBytes } from "node:crypto";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { User, connect, seedPool } from "./helpers";

/** Locking old items anew after a key was retired (docs/design/default-key.md, step 5b). The locked content is random bytes here: the server cannot tell. */
let pool: User[];
const keys: JsonWebKey[] = [];

const makeKey = async () => {
  const pair = await webcrypto.subtle.generateKey({ name: "RSA-OAEP", modulusLength: 3072, publicExponent: new Uint8Array([1, 0, 1]), hash: "SHA-256" }, true, ["encrypt", "decrypt"]);
  return (await webcrypto.subtle.exportKey("jwk", pair.publicKey)) as JsonWebKey;
};
beforeAll(async () => {
  for (let i = 0; i < 3; i++) keys.push(await makeKey());
}, 90000);
beforeEach(async () => {
  pool = await seedPool();
});

const messages = (id: string) => `/circles/default/friends/${id}/messages`;
const box = (id: string, rest = "") => `/circles/default/friends/${id}/safebox${rest}`;
const publish = async (user: User, jwk: JsonWebKey) => (await user.raw("post", "/keys", { publicKey: jwk }).expect(201)).body.id as string;
const b64 = (n: number) => randomBytes(n).toString("base64");
const wrap = (uid: string, keyId: string) => ({ uid, keyId, wrappedKey: b64(384) });
const todo = async (user: User, part: string, after = "") => (await user.raw("get", `/reencrypt/todo?part=${part}${after ? `&after=${after}` : ""}`).expect(200)).body;

/** two friends with a key each, a locked message and a note sent, then the first friend gets a new key and retires the old one */
async function setup() {
  const id = await connect(pool[0], pool[1]);
  const mine = await publish(pool[0], keys[0]);
  const theirs = await publish(pool[1], keys[1]);
  const wraps = [wrap(pool[0].p.uid, mine), wrap(pool[1].p.uid, theirs)];
  const message = (await pool[0].raw("post", messages(id), { text: b64(40), enc: { v: 1, iv: b64(12), wraps } }).expect(201)).body;
  const iv = b64(12);
  const item = (await pool[0].raw("post", box(id, "/items"), { type: "note", enc: { v: 1, iv, metaIv: iv, meta: b64(200), thumbIv: null, wraps } }).expect(201)).body;
  const fresh = await publish(pool[0], keys[2]);
  await pool[0].raw("post", `/keys/${mine}/revoke`).expect(200);
  return { id, mine, theirs, fresh, message, item };
}

describe("the items still locked for a retired key", () => {
  it("lists nothing while no key was retired", async () => {
    const id = await connect(pool[0], pool[1]);
    const mine = await publish(pool[0], keys[0]);
    const theirs = await publish(pool[1], keys[1]);
    await pool[0].raw("post", messages(id), { text: b64(40), enc: { v: 1, iv: b64(12), wraps: [wrap(pool[0].p.uid, mine), wrap(pool[1].p.uid, theirs)] } }).expect(201);
    expect((await todo(pool[0], "messages")).items).toEqual([]);
  });

  it("lists my copy of a message and an object, only mine, and not the friend's", async () => {
    const { id, message, item, mine } = await setup();
    const m = await todo(pool[0], "messages");
    expect(m.items).toHaveLength(1);
    expect(m.items[0]).toMatchObject({ id: message.id, text: message.text });
    expect(m.items[0].enc.wraps).toEqual([expect.objectContaining({ uid: pool[0].p.uid, keyId: mine })]);
    const b = await todo(pool[0], "box");
    expect(b.items).toEqual([expect.objectContaining({ id: item.id, connectionId: id, revision: 1 })]);
    expect((await todo(pool[1], "messages")).items).toEqual([]);
    expect((await todo(pool[1], "box")).items).toEqual([]);
    expect((await pool[0].raw("get", "/reencrypt/todo?part=nothing")).status).toBe(400);
  });
});

describe("locking a message anew", () => {
  it("replaces my copy, and it drops off the list", async () => {
    const { id, fresh, message } = await setup();
    const was = (await todo(pool[0], "messages")).items[0].enc.iv as string;
    const text = b64(60);
    const enc = { v: 1, iv: b64(12), wraps: [wrap(pool[0].p.uid, fresh)] };
    await pool[0].raw("put", `/reencrypt/messages/${message.id}`, { was, text, enc }).expect(204);
    expect((await todo(pool[0], "messages")).items).toEqual([]);
    const mine = (await pool[0].feed(id)).body.messages[0];
    expect(mine).toMatchObject({ text, enc: { iv: enc.iv } });
    expect((await pool[1].feed(id)).body.messages[0].text).not.toBe(text); // the friend's copy is untouched
  });

  it("is refused for copies that do not fit, a message that changed, or one that is not there", async () => {
    const { mine, theirs, fresh, message } = await setup();
    const was = (await todo(pool[0], "messages")).items[0].enc.iv as string;
    const put = async (user: User, body: Record<string, unknown>) => (await user.raw("put", `/reencrypt/messages/${message.id}`, body)).status;
    const enc = (wraps: ReturnType<typeof wrap>[]) => ({ v: 1, iv: b64(12), wraps });
    expect(await put(pool[0], { was, text: b64(60), enc: enc([wrap(pool[0].p.uid, mine)]) })).toBe(409); // for the retired key
    expect(await put(pool[0], { was, text: b64(60), enc: enc([wrap(pool[0].p.uid, fresh), wrap(pool[1].p.uid, theirs)]) })).toBe(409); // copies of somebody else
    expect(await put(pool[0], { was: b64(12), text: b64(60), enc: enc([wrap(pool[0].p.uid, fresh)]) })).toBe(409); // not the one it started from
    expect((await pool[0].raw("put", `/reencrypt/messages/${message.id.replace(/./, (c) => (c === "a" ? "b" : "a"))}`, { was, text: b64(60), enc: enc([wrap(pool[0].p.uid, fresh)]) })).status).toBe(409); // not a message of mine
    expect(await put(pool[0], { was, text: "nope", enc: enc([wrap(pool[0].p.uid, fresh)]) })).toBe(400);
  });
});

describe("locking an object anew", () => {
  it("replaces the lock for everybody in the friendship and raises the revision", async () => {
    const { id, theirs, fresh, item } = await setup();
    const iv = b64(12);
    const enc = { v: 1, iv, metaIv: iv, meta: b64(250), thumbIv: null, wraps: [wrap(pool[0].p.uid, fresh), wrap(pool[1].p.uid, theirs)] };
    await pool[0].raw("put", box(id, `/items/${item.id}/reencrypt`), { revision: 1, enc }).expect(204);
    expect((await todo(pool[0], "box")).items).toEqual([]);
    const seen = (await pool[1].raw("get", box(id, `/items/${item.id}`)).expect(200)).body;
    expect(seen).toMatchObject({ revision: 2, enc: { meta: enc.meta } });
    // an edit that started with the old lock is refused
    expect((await pool[1].raw("put", box(id, `/items/${item.id}`), { revision: 1, metaIv: b64(12), meta: b64(300) })).status).toBe(409);
  });

  it("is refused when the copies do not cover every key in use, or the revision is old", async () => {
    const { id, theirs, fresh, item, mine } = await setup();
    const iv = b64(12);
    const lock = (wraps: ReturnType<typeof wrap>[]) => ({ v: 1, iv, metaIv: iv, meta: b64(250), thumbIv: null, wraps });
    const put = async (revision: number, wraps: ReturnType<typeof wrap>[]) => (await pool[0].raw("put", box(id, `/items/${item.id}/reencrypt`), { revision, enc: lock(wraps) })).status;
    expect(await put(1, [wrap(pool[0].p.uid, fresh)])).toBe(409); // my friend's copy is missing
    expect(await put(1, [wrap(pool[0].p.uid, mine), wrap(pool[1].p.uid, theirs)])).toBe(409); // the retired key
    expect(await put(5, [wrap(pool[0].p.uid, fresh), wrap(pool[1].p.uid, theirs)])).toBe(409); // an old revision
    expect(await put(1, [wrap(pool[0].p.uid, fresh), wrap(pool[1].p.uid, theirs)])).toBe(204);
  });
});
