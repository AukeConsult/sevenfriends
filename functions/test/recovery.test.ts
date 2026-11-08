import { webcrypto, randomBytes } from "node:crypto";
import { getFirestore } from "firebase-admin/firestore";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { User, connect, seedPool } from "./helpers";

/** Recovery: somebody with a new key asks the friend to lock the keys of the old messages and files again for it (docs/design/message-encryption.md). */
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

const b64 = (n: number) => randomBytes(n).toString("base64");
const wrap = (uid: string, keyId: string) => ({ uid, keyId, wrappedKey: b64(384) });
const publish = async (user: User, jwk: JsonWebKey) => (await user.raw("post", "/keys", { publicKey: jwk }).expect(201)).body.id as string;
const messages = (id: string) => `/circles/default/friends/${id}/messages`;
const recovery = (id: string, rest = "") => `/circles/default/friends/${id}/recovery${rest}`;

/** 0 and 1 are friends with a key each; one locked message each way. Then 0 loses the key and gets a new one. */
async function story() {
  const id = await connect(pool[0], pool[1]);
  const [u0, u1] = [pool[0].p.uid, pool[1].p.uid];
  const oldKey = await publish(pool[0], keys[0]);
  const key1 = await publish(pool[1], keys[1]);
  const locked = (wraps: ReturnType<typeof wrap>[]) => ({ text: b64(40), enc: { v: 1, iv: b64(12), wraps } });
  const first = (await pool[0].raw("post", messages(id), locked([wrap(u0, oldKey), wrap(u1, key1)])).expect(201)).body.id as string;
  const second = (await pool[1].raw("post", messages(id), locked([wrap(u0, oldKey), wrap(u1, key1)])).expect(201)).body.id as string;
  await pool[0].raw("post", `/keys/${oldKey}/revoke`).expect(200);
  const newKey = await publish(pool[0], keys[2]);
  return { id, u0, u1, oldKey, key1, newKey, first, second };
}

describe("recovery of the old messages", () => {
  it("is asked for, approved, done by the friend's wraps, and the old messages then have a copy for the new key", async () => {
    const s = await story();
    expect((await pool[0].raw("get", recovery(s.id)).expect(200)).body).toMatchObject({ role: "none", status: "none" });

    const asked = (await pool[0].raw("post", recovery(s.id)).expect(201)).body;
    expect(asked).toMatchObject({ role: "requester", status: "asked", keyId: s.newKey });
    expect((await pool[1].raw("get", recovery(s.id)).expect(200)).body).toMatchObject({ role: "helper", status: "asked", keyId: s.newKey });

    await pool[1].raw("get", recovery(s.id, "/todo?part=messages")).expect(409); // not approved yet
    const approved = (await pool[1].raw("post", recovery(s.id, "/approve")).expect(200)).body;
    expect(approved).toMatchObject({ status: "approved", total: 2 });

    const todo = (await pool[1].raw("get", recovery(s.id, "/todo?part=messages")).expect(200)).body;
    expect(todo.next).toBeNull();
    expect(todo.items.map((i: { id: string }) => i.id).sort()).toEqual([s.first, s.second].sort());
    for (const item of todo.items) expect(item.wraps).toEqual([expect.objectContaining({ uid: s.u1, keyId: s.key1 })]); // the helper's own copies

    const items = todo.items.map((i: { id: string }) => ({ id: i.id, wraps: [wrap(s.u0, s.newKey)] }));
    expect((await pool[1].raw("post", recovery(s.id, "/wraps"), { part: "messages", items }).expect(200)).body.added).toBe(2);
    expect((await pool[1].raw("post", recovery(s.id, "/wraps"), { part: "messages", items }).expect(200)).body.added).toBe(0); // again: nothing new

    for (const m of (await pool[0].feed(s.id)).body.messages) {
      expect(m.enc.wraps.map((w: { keyId: string }) => w.keyId).sort()).toEqual([s.newKey, s.oldKey].sort());
    }
    expect((await pool[1].raw("get", recovery(s.id, "/todo?part=messages")).expect(200)).body.items).toEqual([]);

    expect((await pool[1].raw("post", recovery(s.id, "/finish")).expect(200)).body).toMatchObject({ status: "done", added: 2 });
    expect((await pool[0].raw("get", recovery(s.id)).expect(200)).body).toMatchObject({ role: "requester", status: "done", added: 2, total: 2 });
  });

  it("lists the safebox files that need a copy and files the new copy in the shared item", async () => {
    const s = await story();
    await getFirestore().collection("safebox").doc(s.id).collection("items").doc("file1").set({ enc: { v: 1, wraps: [wrap(s.u0, s.oldKey), wrap(s.u1, s.key1)] } });
    await pool[0].raw("post", recovery(s.id)).expect(201);
    await pool[1].raw("post", recovery(s.id, "/approve")).expect(200);
    const todo = (await pool[1].raw("get", recovery(s.id, "/todo?part=box")).expect(200)).body;
    expect(todo.items).toEqual([{ id: "file1", wraps: [expect.objectContaining({ uid: s.u1, keyId: s.key1 })], missing: [s.newKey] }]);
    await pool[1].raw("post", recovery(s.id, "/wraps"), { part: "box", items: [{ id: "file1", wraps: [wrap(s.u0, s.newKey)] }] }).expect(200);
    const item = (await getFirestore().collection("safebox").doc(s.id).collection("items").doc("file1").get()).data();
    expect(item?.enc.wraps).toHaveLength(3);
  });

  it("refuses what is not meant: no key, a stranger, a copy for the wrong person or key, the asker as helper", async () => {
    const other = await connect(pool[3], pool[4]);
    await pool[3].raw("post", recovery(other)).expect(409); // no key yet

    const s = await story();
    await pool[0].raw("post", recovery(s.id)).expect(201);
    await pool[0].raw("post", recovery(s.id, "/approve")).expect(404); // the asker cannot approve
    await pool[1].raw("post", recovery(s.id, "/approve")).expect(200);
    await pool[0].raw("get", recovery(s.id, "/todo?part=messages")).expect(404); // nor do the work
    const bad = [
      { id: s.first, wraps: [wrap(s.u1, s.newKey)] }, // for the helper, not for the asker
      { id: s.first, wraps: [wrap(s.u0, "f".repeat(32))] }, // for a key the asker does not have in use
    ];
    for (const item of bad) await pool[1].raw("post", recovery(s.id, "/wraps"), { part: "messages", items: [item] }).expect(400);
    await pool[2].raw("get", recovery(s.id)).expect(404); // a third person has nothing to do with it
  });

  it("opens the old messages for EVERY key in use of the asker (a second device), not only the newest", async () => {
    const s = await story();
    const second = await publish(pool[0], keys[3]); // another device of the same person, with a key of its own
    await pool[0].raw("post", recovery(s.id)).expect(201);
    expect((await pool[1].raw("post", recovery(s.id, "/approve")).expect(200)).body.total).toBe(2);
    const todo = (await pool[1].raw("get", recovery(s.id, "/todo?part=messages")).expect(200)).body;
    for (const item of todo.items) expect([...item.missing].sort()).toEqual([s.newKey, second].sort());
    const items = todo.items.map((i: { id: string }) => ({ id: i.id, wraps: [wrap(s.u0, s.newKey), wrap(s.u0, second)] }));
    expect((await pool[1].raw("post", recovery(s.id, "/wraps"), { part: "messages", items }).expect(200)).body.added).toBe(2);
    for (const m of (await pool[0].feed(s.id)).body.messages) {
      expect(m.enc.wraps.map((w: { keyId: string }) => w.keyId).sort()).toEqual([s.newKey, s.oldKey, second].sort());
    }
    expect((await pool[1].raw("get", recovery(s.id, "/todo?part=messages")).expect(200)).body.items).toEqual([]);
  });

  it("stops working when the asker has no key in use any more, and can be cancelled", async () => {
    const s = await story();
    await pool[0].raw("post", recovery(s.id)).expect(201);
    await pool[1].raw("post", recovery(s.id, "/approve")).expect(200);
    await pool[0].raw("post", `/keys/${s.newKey}/revoke`).expect(200);
    await pool[1].raw("get", recovery(s.id, "/todo?part=messages")).expect(409);
    await pool[1].raw("delete", recovery(s.id)).expect(200);
    expect((await pool[0].raw("get", recovery(s.id)).expect(200)).body.status).toBe("none");
  });
});
