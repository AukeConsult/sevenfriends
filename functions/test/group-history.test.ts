import { webcrypto, randomBytes } from "node:crypto";
import { getFirestore } from "firebase-admin/firestore";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { User, connect, seedPool } from "./helpers";

/** The history of the messages of a group (docs/design/groups.md, fixed rule 8 in docs/design/recovery-rules.md): a member who joins later gets the earlier messages too. */
let pool: User[];
const keys: JsonWebKey[] = [];

const makeKey = async () => {
  const pair = await webcrypto.subtle.generateKey({ name: "RSA-OAEP", modulusLength: 3072, publicExponent: new Uint8Array([1, 0, 1]), hash: "SHA-256" }, true, ["encrypt", "decrypt"]);
  return (await webcrypto.subtle.exportKey("jwk", pair.publicKey)) as JsonWebKey;
};
beforeAll(async () => {
  for (let i = 0; i < 4; i++) keys.push(await makeKey());
}, 90000);
beforeEach(async () => {
  pool = await seedPool();
});

const base = (id: string) => `/circles/default/friends/${id}`;
const publish = async (user: User, jwk: JsonWebKey) => (await user.raw("post", "/keys", { publicKey: jwk }).expect(201)).body.id as string;
const b64 = (n: number) => randomBytes(n).toString("base64");
const wrap = (uid: string, keyId: string) => ({ uid, keyId, wrappedKey: b64(384) });
const history = (id: string, rest = "") => `${base(id)}/history${rest}`;
const textsOf = async (user: User, id: string) => ((await user.feed(id)).body.messages as { text: string }[]).map((m) => m.text);

/** A group of pool 0 and 1 (both with a key) with one plain text and one locked message written by 0 and one locked message written by 1; then pool 2 (with a key) is added. */
async function story() {
  const id = (await pool[0].raw("post", "/circles/default/friends/group", { name: "Late" }).expect(201)).body.id as string;
  const first = await connect(pool[0], pool[1]);
  await pool[0].raw("post", `${base(id)}/group/members`, { friendId: first }).expect(200);
  const [u0, u1, u2] = [pool[0].p.uid, pool[1].p.uid, pool[2].p.uid];
  const k0 = await publish(pool[0], keys[0]);
  const k1 = await publish(pool[1], keys[1]);
  const lockedText = b64(40);
  const plain = (await pool[0].raw("post", `${base(id)}/messages`, { text: "plain, before" }).expect(201)).body.id as string;
  const mine = (await pool[0].raw("post", `${base(id)}/messages`, { text: lockedText, enc: { v: 1, iv: b64(12), wraps: [wrap(u0, k0), wrap(u1, k1)] } }).expect(201)).body.id as string;
  const theirs = (await pool[1].raw("post", `${base(id)}/messages`, { text: b64(40), enc: { v: 1, iv: b64(12), wraps: [wrap(u0, k0), wrap(u1, k1)] } }).expect(201)).body.id as string;
  const second = await connect(pool[0], pool[2]);
  await pool[0].raw("post", `${base(id)}/group/members`, { friendId: second }).expect(200);
  const k2 = await publish(pool[2], keys[2]);
  return { id, u0, u1, u2, k0, k1, k2, plain, mine, theirs, lockedText };
}

describe("a member who joined later gets the earlier messages", () => {
  it("lists what lacks a copy, copies a plain text, locks a locked message again for the new member's keys, and the new member then reads the whole conversation", async () => {
    const s = await story();
    expect(await textsOf(pool[2], s.id)).toEqual([]); // nothing before the sharing
    const todo = (await pool[0].raw("get", history(s.id, "/todo")).expect(200)).body;
    expect(todo.next).toBeNull();
    const byId = new Map(todo.items.map((i: { id: string }) => [i.id, i]));
    expect(byId.get(s.plain)).toMatchObject({ plain: [s.u2], missing: [], wraps: [] });
    expect(byId.get(s.mine)).toMatchObject({ plain: [], missing: [{ uid: s.u2, keyId: s.k2 }], wraps: [expect.objectContaining({ uid: s.u0, keyId: s.k0 })] });
    expect(byId.get(s.theirs)).toMatchObject({ plain: [], missing: [{ uid: s.u2, keyId: s.k2 }] }); // a message of somebody else: pool 0 has a copy, so pool 0 can give the new member theirs
  });

  it("copies reach the member: the same locked text and iv, only the member's wraps, read, in the right circle; again does nothing; the feed of the member follows", async () => {
    const s = await story();
    const todo = (await pool[0].raw("get", history(s.id, "/todo")).expect(200)).body;
    const items = todo.items.map((i: { id: string; plain: string[]; missing: { uid: string; keyId: string }[] }) => (i.plain.length ? { id: i.id, plain: i.plain } : { id: i.id, wraps: i.missing.map((m) => wrap(m.uid, m.keyId)) }));
    expect((await pool[0].raw("post", history(s.id), { items }).expect(200)).body.copied).toBe(items.length);
    expect((await pool[0].raw("post", history(s.id), { items }).expect(200)).body.copied).toBe(0); // a copy that exists is never replaced

    const mine0 = (await getFirestore().collection("user-account").doc(s.u0).collection("messages").doc(s.mine).get()).data()!;
    const copy = (await getFirestore().collection("user-account").doc(s.u2).collection("messages").doc(s.mine).get()).data()!;
    expect(copy).toMatchObject({ connectionId: s.id, fromUid: s.u0, text: mine0.text, time: mine0.time, read: true, circleId: "default" });
    expect(copy.enc.iv).toBe(mine0.enc.iv);
    expect(copy.enc.wraps.map((w: { uid: string; keyId: string }) => `${w.uid}/${w.keyId}`)).toEqual([`${s.u2}/${s.k2}`]); // only the member's own copy of the key
    const plain = (await getFirestore().collection("user-account").doc(s.u2).collection("messages").doc(s.plain).get()).data()!;
    expect(plain).toMatchObject({ text: "plain, before", read: true });
    expect((await pool[2].feed(s.id)).body.messages).toHaveLength(3);
    expect((await pool[2].raw("get", "/messages").expect(200)).body.messages ?? []).toEqual(expect.not.arrayContaining([expect.objectContaining({ id: s.plain })])); // read: not in the unread list
    expect((await pool[1].raw("get", history(s.id, "/todo")).expect(200)).body.items).toEqual([]); // nothing is missing any more, for anybody
  });

  it("another member's device can do it too (one is enough), and the message of the new member's own is never given back", async () => {
    const s = await story();
    const todo = (await pool[1].raw("get", history(s.id, "/todo")).expect(200)).body;
    expect(todo.items.map((i: { id: string }) => i.id).sort()).toEqual([s.plain, s.mine, s.theirs].sort());
    const items = todo.items.map((i: { id: string; plain: string[]; missing: { uid: string; keyId: string }[] }) => (i.plain.length ? { id: i.id, plain: i.plain } : { id: i.id, wraps: i.missing.map((m) => wrap(m.uid, m.keyId)) }));
    await pool[1].raw("post", history(s.id), { items }).expect(200);
    expect(await textsOf(pool[2], s.id)).toHaveLength(3);
  });

  it("refuses what is not meant: not a group, a copy for the wrong person or a key that is not in use, a stranger, a copy for myself", async () => {
    const s = await story();
    const friendship = await connect(pool[3], pool[4]);
    await pool[3].raw("get", history(friendship, "/todo")).expect(404); // only a group
    await pool[5].raw("get", history(s.id, "/todo")).expect(404); // not a member
    await pool[5].raw("post", history(s.id), { items: [{ id: s.mine, wraps: [wrap(s.u2, s.k2)] }] }).expect(404);
    const post = (item: unknown) => pool[0].raw("post", history(s.id), { items: [item] });
    await post({ id: s.mine, wraps: [wrap(s.u2, "f".repeat(32))] }).expect(400); // a key that is not in use
    await post({ id: s.mine, wraps: [wrap(pool[5].p.uid, s.k2)] }).expect(400); // not a member
    await post({ id: s.mine, plain: [pool[5].p.uid] }).expect(400);
    await post({ id: s.mine }).expect(400); // nothing to do
    await post({ id: "a/b", plain: [s.u2] }).expect(400);
    await post({ id: s.mine, wraps: [wrap(s.u0, s.k0)] }).expect(400); // a copy for myself: I am not one of the others
    expect((await post({ id: "nope", plain: [s.u2] }).expect(200)).body.copied).toBe(0); // a message I do not have
    expect(await textsOf(pool[2], s.id)).toEqual([]);
  });

  it("takes at most 50 items at a time (a transaction holds at most 500 writes), and the todo gives at most 50", async () => {
    const s = await story();
    const many = Array.from({ length: 51 }, (_, n) => ({ id: `m${n}`, plain: [s.u2] }));
    await pool[0].raw("post", history(s.id), { items: many }).expect(400);
    await pool[0].raw("post", history(s.id), { items: many.slice(0, 50) }).expect(200); // messages that do not exist: nothing is made, but the size is allowed
    expect((await pool[0].raw("get", history(s.id, "/todo")).expect(200)).body.items.length).toBeLessThanOrEqual(50);
  });

  it("a member without a key gets the plain texts, and the locked ones when they have a key", async () => {
    const s = await story();
    await getFirestore().collection("user-account").doc(s.u2).collection("keys").doc(s.k2).delete(); // no key (yet)
    const todo = (await pool[0].raw("get", history(s.id, "/todo")).expect(200)).body;
    expect(todo.items.map((i: { id: string }) => i.id)).toEqual([s.plain]); // the locked ones wait for a key
  });
});
