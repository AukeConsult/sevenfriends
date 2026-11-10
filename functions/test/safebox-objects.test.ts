import { webcrypto, randomBytes } from "node:crypto";
import { getFirestore } from "firebase-admin/firestore";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { SAFEBOX_PAYLOAD_MAX_BYTES } from "../src/models";
import { sendDueReminders } from "../src/safebox-reminders";
import { storedNames } from "./fake-storage";
import { User, connect, seedPool } from "./helpers";

/** The objects of the safebox (a note ...): no stored file, the content is a locked payload in `enc.meta` that the server cannot read (docs/design/safebox-objects.md). */
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

const box = (id: string, rest = "") => `/circles/default/friends/${id}/safebox${rest}`;
const recovery = (id: string, rest = "") => `/circles/default/friends/${id}/recovery${rest}`;
const publish = async (user: User, jwk: JsonWebKey) => (await user.raw("post", "/keys", { publicKey: jwk }).expect(201)).body.id as string;
const b64 = (n: number) => randomBytes(n).toString("base64");
const wrap = (uid: string, keyId: string) => ({ uid, keyId, wrappedKey: b64(384) });

/** a new note as the app sends it: the locked payload is random bytes here (the server cannot tell); `iv` is the same as `metaIv` */
function note(wraps: ReturnType<typeof wrap>[], opts: { meta?: string; type?: string; mutate?: (enc: Record<string, unknown>) => void } = {}) {
  const iv = b64(12);
  const enc: Record<string, unknown> = { v: 1, iv, metaIv: iv, meta: opts.meta ?? b64(200), thumbIv: null, wraps };
  opts.mutate?.(enc);
  return { type: opts.type ?? "note", enc };
}
const change = (revision: number, meta = b64(300)) => ({ revision, metaIv: b64(12), meta });

/** two friends with a key each */
async function twoWithKeys() {
  const id = await connect(pool[0], pool[1]);
  const mine = await publish(pool[0], keys[0]);
  const theirs = await publish(pool[1], keys[1]);
  return { id, mine, theirs, wraps: [wrap(pool[0].p.uid, mine), wrap(pool[1].p.uid, theirs)] };
}

describe("a note in the safebox", () => {
  it("is stored as an object with no file, counts in the box, and both friends see it with only their own copy of the key", async () => {
    const { id, mine, theirs, wraps } = await twoWithKeys();
    const body = note(wraps, { meta: b64(1000) });
    const item = (await pool[0].raw("post", box(id, "/items"), body).expect(201)).body;
    expect(item).toMatchObject({ type: "note", revision: 1, mine: true, hasThumb: false, name: "Encrypted item" });
    expect(item.bytes).toBe(1000);
    expect(item.enc.wraps).toEqual([expect.objectContaining({ uid: pool[0].p.uid, keyId: mine })]);
    const theirsBox = (await pool[1].raw("get", box(id)).expect(200)).body;
    expect(theirsBox.items[0]).toMatchObject({ id: item.id, type: "note", mine: false });
    expect(theirsBox.items[0].enc.wraps).toEqual([expect.objectContaining({ uid: pool[1].p.uid, keyId: theirs })]);
    expect(theirsBox.usedBytes).toBe(1000);
    expect(storedNames().filter((n) => n.startsWith(`sf-cache/box-${id}/`))).toEqual([]); // no file was stored
    await pool[1].raw("get", box(id, `/${item.id}`)).expect(404); // there is nothing to download
  });

  it("an item that is a file has the type 'file' and revision 1 (also one from before there were types)", async () => {
    const id = await connect(pool[0], pool[1]);
    await getFirestore().collection("safebox").doc(id).collection("items").doc("old").set({ name: "a.txt", kind: "document", mime: "text/plain", bytes: 5, addedBy: pool[0].p.uid, hasThumb: false });
    expect((await pool[0].raw("get", box(id)).expect(200)).body.items[0]).toMatchObject({ id: "old", type: "file", revision: 1 });
  });

  it("is refused when it is not valid: unknown type, a wrong or different iv, a thumbnail, a payload that is too big or too small, no copies of the key", async () => {
    const { id, wraps } = await twoWithKeys();
    const refuse = (body: unknown) => pool[0].raw("post", box(id, "/items"), body as object).expect(400);
    await refuse(note(wraps, { type: "recipe" })); // not a kind
    await refuse(note(wraps, { type: "file" })); // a file is not an object
    await refuse(note(wraps, { mutate: (e) => (e.iv = b64(12)) })); // iv and metaIv must be the same
    await refuse(note(wraps, { mutate: (e) => (e.metaIv = e.iv = "short") }));
    await refuse(note(wraps, { mutate: (e) => (e.thumbIv = b64(12)) }));
    await refuse(note(wraps, { meta: "not base64!" }));
    await refuse(note(wraps, { meta: b64(4) })); // smaller than the lock
    await refuse(note(wraps, { meta: randomBytes(SAFEBOX_PAYLOAD_MAX_BYTES + 100).toString("base64") }));
    await refuse(note([]));
    await refuse({ type: "note" });
    await refuse(null);
    expect((await pool[0].raw("get", box(id)).expect(200)).body.items).toEqual([]);
  });

  it("needs a copy of the key for every key of both friends, no more and no fewer", async () => {
    const { id, mine, wraps } = await twoWithKeys();
    const second = await publish(pool[0], keys[2]); // I have a second device
    expect((await pool[0].raw("post", box(id, "/items"), note(wraps)).expect(409)).body.error).toMatch(/keys changed/i);
    const all = [...wraps, wrap(pool[0].p.uid, second)];
    await pool[0].raw("post", box(id, "/items"), note(all)).expect(201);
    await pool[0].raw("post", box(id, "/items"), note(all.slice(1))).expect(409); // mine is missing
    await pool[0].raw("post", box(id, "/items"), note([...all, wrap(pool[0].p.uid, mine)])).expect(409); // twice
  });

  it("is for the two friends only: a stranger and a pending friend cannot add, change, read or delete", async () => {
    const { id, wraps } = await twoWithKeys();
    const item = (await pool[0].raw("post", box(id, "/items"), note(wraps)).expect(201)).body;
    for (const call of [
      () => pool[2].raw("post", box(id, "/items"), note(wraps)),
      () => pool[2].raw("put", box(id, `/items/${item.id}`), change(1)),
      () => pool[2].raw("get", box(id)),
      () => pool[2].raw("delete", box(id, `/${item.id}`)),
    ]) {
      expect([403, 404]).toContain((await call()).status);
    }
    expect((await pool[0].raw("get", box(id)).expect(200)).body.items).toHaveLength(1);
  });

  it("is changed with the revision it started from; the other friend can change it too; a stale change gets 409", async () => {
    const { id, wraps } = await twoWithKeys();
    const item = (await pool[0].raw("post", box(id, "/items"), note(wraps, { meta: b64(100) })).expect(201)).body;
    const first = (await pool[0].raw("put", box(id, `/items/${item.id}`), change(1, b64(500))).expect(200)).body;
    expect(first).toMatchObject({ id: item.id, revision: 2, bytes: 500, mine: true });
    expect(first.updatedAt).toBeTruthy();
    expect(first.enc.wraps).toHaveLength(1); // the copies of the key are not touched
    const second = (await pool[1].raw("put", box(id, `/items/${item.id}`), change(2, b64(40))).expect(200)).body; // my friend may change it too
    expect(second).toMatchObject({ revision: 3, bytes: 40, mine: false, type: "note" });
    expect((await pool[0].raw("put", box(id, `/items/${item.id}`), change(2)).expect(409)).body.error).toMatch(/changed by your friend/i); // stale
    const listed = (await pool[0].raw("get", box(id)).expect(200)).body;
    expect(listed.items[0]).toMatchObject({ revision: 3, bytes: 40 });
    expect(listed.usedBytes).toBe(40);
    // the server stored the new locked content, and the owner stays the one who added it
    const stored = (await getFirestore().collection("safebox").doc(id).collection("items").doc(item.id).get()).data()!;
    expect(stored.enc.meta).toBe(second.enc.meta);
    expect(stored.addedBy).toBe(pool[0].p.uid);
  });

  it("a change must be valid, and a file is not changed this way (nor an object renamed)", async () => {
    const { id, wraps } = await twoWithKeys();
    const item = (await pool[0].raw("post", box(id, "/items"), note(wraps)).expect(201)).body;
    for (const body of [{}, change(0), { ...change(1), meta: "x" }, { ...change(1), metaIv: "short" }, { revision: 1.5, metaIv: b64(12), meta: b64(50) }]) {
      await pool[0].raw("put", box(id, `/items/${item.id}`), body).expect(400);
    }
    await pool[0].raw("put", box(id, `/items/${item.id}`), change(1, randomBytes(SAFEBOX_PAYLOAD_MAX_BYTES + 100).toString("base64"))).expect(400);
    const fileRef = getFirestore().collection("safebox").doc(id).collection("items").doc();
    await fileRef.set({ name: "a.txt", kind: "document", mime: "text/plain", bytes: 5, addedBy: pool[0].p.uid, hasThumb: false });
    await pool[0].raw("put", box(id, `/items/${fileRef.id}`), change(1)).expect(400);
    await pool[0].raw("put", box(id, `/items/nope`), change(1)).expect(404);
    await pool[0].raw("put", box(id, `/${item.id}`), { name: "New name" }).expect(400); // an object has no name to change
  });

  it("can be taken out by either friend (the one who did not add it too)", async () => {
    const { id, wraps } = await twoWithKeys();
    const a = (await pool[0].raw("post", box(id, "/items"), note(wraps)).expect(201)).body;
    const b = (await pool[1].raw("post", box(id, "/items"), note(wraps)).expect(201)).body;
    await pool[1].raw("delete", box(id, `/${a.id}`)).expect(204);
    await pool[0].raw("delete", box(id, `/${b.id}`)).expect(204);
    expect((await pool[0].raw("get", box(id)).expect(200)).body).toMatchObject({ items: [], usedBytes: 0 });
    await pool[0].raw("delete", box(id, `/${a.id}`)).expect(404);
  });

  it("makes no message for the friend when it is added", async () => {
    const { id, wraps } = await twoWithKeys();
    await pool[0].raw("post", box(id, "/items"), note(wraps)).expect(201);
    const feed = (await pool[1].raw("get", `/circles/default/friends/${id}/messages`).expect(200)).body;
    const messages = Array.isArray(feed) ? feed : feed.messages;
    expect(messages.some((m: { inBox?: boolean }) => m.inBox)).toBe(false);
  });

  it("is locked again for a new key by the friend's recovery, like a file (the recovery reads only `enc`)", async () => {
    const { id, mine, theirs, wraps } = await twoWithKeys();
    const [u0, u1] = [pool[0].p.uid, pool[1].p.uid];
    const item = (await pool[0].raw("post", box(id, "/items"), note(wraps)).expect(201)).body;
    await pool[0].raw("post", `/keys/${mine}/revoke`).expect(200);
    const newKey = await publish(pool[0], keys[2]);
    await pool[0].raw("post", recovery(id)).expect(201);
    await pool[1].raw("post", recovery(id, "/approve")).expect(200);
    const todo = (await pool[1].raw("get", recovery(id, "/todo?part=box")).expect(200)).body;
    expect(todo.items).toEqual([{ id: item.id, wraps: [expect.objectContaining({ uid: u1, keyId: theirs })], missing: [newKey] }]);
    await pool[1].raw("post", recovery(id, "/wraps"), { part: "box", items: [{ id: item.id, wraps: [wrap(u0, newKey)] }] }).expect(200);
    const stored = (await getFirestore().collection("safebox").doc(id).collection("items").doc(item.id).get()).data()!;
    expect(stored.enc.wraps.map((w: { keyId: string }) => w.keyId).sort()).toEqual([mine, newKey, theirs].sort());
    expect(stored.type).toBe("note"); // still a note, and the content was not touched
  });
});

describe("every kind of object", () => {
  it.each(["note", "secret", "link", "checklist", "place", "contact", "date", "ticket", "album", "case", "relation"])("%s is stored as an object, and a made-up kind is refused", async (type) => {
    const { id, wraps } = await twoWithKeys();
    const item = (await pool[0].raw("post", box(id, "/items"), note(wraps, { type })).expect(201)).body;
    expect(item).toMatchObject({ type, revision: 1, hasThumb: false });
    await pool[1].raw("put", box(id, `/items/${item.id}`), change(1)).expect(200);
    await pool[0].raw("post", box(id, "/items"), note(wraps, { type: "recipe" })).expect(400);
  });
});

describe("a reminder on a date or a ticket", () => {
  const soon = (minutes: number) => new Date(Date.now() + minutes * 60000).toISOString();
  const reminders = async () => (await getFirestore().collection("safebox-reminders").get()).docs;

  it("is kept as a moment only, sent once when it is due, and goes with the item", async () => {
    const { id, wraps } = await twoWithKeys();
    const item = (await pool[0].raw("post", box(id, "/items"), { ...note(wraps, { type: "date" }), remind: { at: soon(30), both: true } }).expect(201)).body;
    const [waiting] = await reminders();
    expect(waiting.data()).toMatchObject({ connectionId: id, itemId: item.id, setBy: pool[0].p.uid });
    expect(waiting.data().targets).toHaveLength(2);
    expect(await sendDueReminders(new Date())).toBe(0); // not yet
    expect(await sendDueReminders(new Date(Date.now() + 60 * 60000))).toBe(1);
    expect(await reminders()).toHaveLength(0); // sent once
    // changing the item sets it again, and null takes it away; a moment that has passed is no reminder
    await pool[1].raw("put", box(id, `/items/${item.id}`), { ...change(1), remind: { at: soon(10), both: false } }).expect(200);
    expect((await reminders())[0].data().targets).toHaveLength(1);
    await pool[1].raw("put", box(id, `/items/${item.id}`), { ...change(2), remind: null }).expect(200);
    expect(await reminders()).toHaveLength(0);
    await pool[1].raw("put", box(id, `/items/${item.id}`), { ...change(3), remind: { at: soon(10), both: false } }).expect(200);
    await pool[0].raw("delete", box(id, `/${item.id}`)).expect(204);
    expect(await reminders()).toHaveLength(0);
  });

  it("is refused when it is not a moment", async () => {
    const { id, wraps } = await twoWithKeys();
    await pool[0].raw("post", box(id, "/items"), { ...note(wraps, { type: "ticket" }), remind: { at: "tomorrow", both: true } }).expect(400);
    await pool[0].raw("post", box(id, "/items"), { ...note(wraps, { type: "ticket" }), remind: { at: soon(5) } }).expect(400);
    await pool[0].raw("post", box(id, "/items"), { ...note(wraps, { type: "ticket" }), remind: { at: soon(60 * 24 * 365 * 10), both: false } }).expect(400);
  });
});

describe("attachments of an object", () => {
  const file = (wraps: ReturnType<typeof wrap>[], kind: "image" | "document" = "document", thumb = false) => {
    const data = randomBytes(300);
    const th = thumb ? randomBytes(40) : null;
    const header = { v: 1, kind, fileLength: data.length, thumbLength: th?.length ?? 0, enc: { v: 1, iv: b64(12), metaIv: b64(12), meta: b64(60), thumbIv: th ? b64(12) : null, wraps } };
    const head = Buffer.from(JSON.stringify(header));
    const len = Buffer.alloc(4);
    len.writeUInt32BE(head.length);
    return Buffer.concat([len, head, data, ...(th ? [th] : [])]);
  };
  const attach = (user: User, id: string, parent: string, body: Buffer) => user.file("post", box(id, `/encrypted?parent=${parent}`), body);

  it("belong to an object, are no news, and go with it", async () => {
    const { id, wraps } = await twoWithKeys();
    const ticket = (await pool[0].raw("post", box(id, "/items"), note(wraps, { type: "ticket" })).expect(201)).body;
    const a = (await attach(pool[1], id, ticket.id, file(wraps, "image", true)).expect(201)).body;
    expect(a).toMatchObject({ parentId: ticket.id, hasThumb: true });
    const list = (await pool[0].raw("get", box(id)).expect(200)).body.items;
    expect(list.find((i: { id: string }) => i.id === a.id).parentId).toBe(ticket.id);
    expect(list.find((i: { id: string }) => i.id === ticket.id).parentId).toBeNull();
    expect(storedNames().some((n) => n.includes(a.id))).toBe(true);
    await pool[0].raw("delete", box(id, `/${ticket.id}`)).expect(204);
    expect((await pool[0].raw("get", box(id)).expect(200)).body.items).toEqual([]);
    expect(storedNames().some((n) => n.includes(a.id))).toBe(false);
  });

  it("can be taken out one by one, and are refused on a file, too many, and a non-picture in an album", async () => {
    const { id, wraps } = await twoWithKeys();
    const doc = (await pool[0].raw("post", box(id, "/items"), note(wraps, { type: "link" })).expect(201)).body;
    const plain = (await attach(pool[0], id, doc.id, file(wraps)).expect(201)).body;
    await attach(pool[0], id, plain.id, file(wraps)).expect(400); // an attachment is a file, not an object
    await pool[1].raw("delete", box(id, `/${plain.id}`)).expect(204);
    await attach(pool[0], id, "nope", file(wraps)).expect(404);
    for (let i = 0; i < 10; i++) await attach(pool[0], id, doc.id, file(wraps)).expect(201);
    await attach(pool[0], id, doc.id, file(wraps)).expect(409); // the 11th
    const theCase = (await pool[0].raw("post", box(id, "/items"), note(wraps, { type: "case" })).expect(201)).body;
    for (let i = 0; i < 11; i++) await attach(pool[0], id, theCase.id, file(wraps)).expect(201); // a case may have more
    const album = (await pool[0].raw("post", box(id, "/items"), note(wraps, { type: "album" })).expect(201)).body;
    await attach(pool[0], id, album.id, file(wraps, "document")).expect(400);
    await attach(pool[0], id, album.id, file(wraps, "image", true)).expect(201);
  });

  it("keeps a small head in the list and the whole content apart: the list does not send the body, reading the item does, and an older change brings it back whole", async () => {
    const { id, wraps } = await twoWithKeys();
    const split = (head = 200, body = 3000) => {
      const enc = note(wraps, { meta: b64(head) }).enc as Record<string, unknown>;
      return { type: "note", enc: { ...enc, bodyIv: b64(12), body: b64(body) } };
    };
    const made = (await pool[0].raw("post", box(id, "/items"), split()).expect(201)).body;
    expect(made.bytes).toBe(3200); // the head and the body both count
    const listed = (await pool[1].raw("get", box(id)).expect(200)).body.items[0];
    expect(listed.enc.body).toBeUndefined();
    expect(listed.enc.bodyIv).toBeTruthy();
    expect(listed.enc.meta).toBeTruthy(); // the head
    const whole = (await pool[1].raw("get", box(id, `/items/${made.id}`)).expect(200)).body;
    expect(whole.enc.body).toBeTruthy();
    await pool[0].raw("post", box(id, "/items"), split(5000)).expect(400); // a head is small
    await pool[0].raw("post", box(id, "/items"), { type: "note", enc: { ...note(wraps).enc, body: b64(100) } }).expect(400); // a body needs its iv
    // changed by an app that sends the content whole in meta: the body goes away
    const change = (await pool[1].raw("put", box(id, `/items/${made.id}`), { revision: 1, metaIv: b64(12), meta: b64(500) }).expect(200)).body;
    expect(change.enc.body).toBeUndefined();
    expect(change.bytes).toBe(500);
    expect((await pool[0].raw("get", box(id)).expect(200)).body.items[0].enc.bodyIv).toBeUndefined();
  });
});
