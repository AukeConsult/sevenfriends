import { webcrypto, randomBytes } from "node:crypto";
import { getFirestore } from "firebase-admin/firestore";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { User, connect, seedPool } from "./helpers";

/** The keys of a group (docs/design/groups.md): a message or item is locked for every key in use of every member, and the server checks that. */
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

const base = (id: string) => `/circles/default/friends/${id}`;
const publish = async (user: User, jwk: JsonWebKey) => (await user.raw("post", "/keys", { publicKey: jwk }).expect(201)).body.id as string;
const b64 = (n: number) => randomBytes(n).toString("base64");
const wrap = (uid: string, keyId: string) => ({ uid, keyId, wrappedKey: b64(384) });
const locked = (wraps: ReturnType<typeof wrap>[]) => ({ text: b64(40), enc: { v: 1, iv: b64(12), wraps } });

/** a group of three (pool 0 made it), everybody with a key */
async function groupOfThree() {
  const made = (await pool[0].raw("post", "/circles/default/friends/group", { name: "Three" }).expect(201)).body.id as string;
  const ids: string[] = [];
  for (const n of [1, 2]) {
    const friendId = await connect(pool[0], pool[n]);
    await pool[0].raw("post", `${base(made)}/group/members`, { friendId }).expect(200);
    ids.push(friendId);
  }
  const keyIds = [];
  for (let n = 0; n < 3; n++) keyIds.push(await publish(pool[n], keys[n]));
  const wraps = [0, 1, 2].map((n) => wrap(pool[n].p.uid, keyIds[n]));
  return { id: made, keyIds, wraps };
}

describe("the keys of a group", () => {
  it("lists every other member with their keys and name; no friend", async () => {
    const { id, keyIds } = await groupOfThree();
    const box = (await pool[0].raw("get", `${base(id)}/safebox/keys`).expect(200)).body;
    expect(box.friendUid).toBe("");
    expect(box.friend).toEqual([]);
    expect(box.mine.map((k: { id: string }) => k.id)).toEqual([keyIds[0]]);
    expect(box.others.map((o: { uid: string }) => o.uid).sort()).toEqual([pool[1].p.uid, pool[2].p.uid].sort());
    const second = box.others.find((o: { uid: string }) => o.uid === pool[1].p.uid);
    expect(second.keys.map((k: { id: string }) => k.id)).toEqual([keyIds[1]]);
    expect(typeof second.name).toBe("string");
  });

  it("a friendship lists its one friend as `others` too (and as `friend`, as before)", async () => {
    const id = await connect(pool[0], pool[1]);
    const theirs = await publish(pool[1], keys[1]);
    const box = (await pool[0].raw("get", `${base(id)}/safebox/keys`).expect(200)).body;
    expect(box.friendUid).toBe(pool[1].p.uid);
    expect(box.friend.map((k: { id: string }) => k.id)).toEqual([theirs]);
    expect(box.others).toHaveLength(1);
    expect(box.others[0]).toMatchObject({ uid: pool[1].p.uid });
  });

  it("a group of only me has nobody else to wait for", async () => {
    const id = (await pool[0].raw("post", "/circles/default/friends/group", { name: "Solo" }).expect(201)).body.id as string;
    const mine = await publish(pool[0], keys[0]);
    expect((await pool[0].raw("get", `${base(id)}/safebox/keys`).expect(200)).body.others).toEqual([]);
    await pool[0].raw("post", `${base(id)}/messages`, locked([wrap(pool[0].p.uid, mine)])).expect(201);
  });

  it("a locked message needs a copy of the key for every key of every member, and each member sees only their own copy", async () => {
    const { id, keyIds, wraps } = await groupOfThree();
    await pool[0].raw("post", `${base(id)}/messages`, locked(wraps.slice(0, 2))).expect(409); // the third member is missing
    await pool[0].raw("post", `${base(id)}/messages`, locked([...wraps, wrap(pool[2].p.uid, "0123456789abcdef0123456789abcdef")])).expect(409); // a copy for a key nobody has
    const sent = (await pool[0].raw("post", `${base(id)}/messages`, locked(wraps)).expect(201)).body;
    expect(sent.enc.wraps).toEqual([expect.objectContaining({ uid: pool[0].p.uid, keyId: keyIds[0] })]);
    for (const n of [1, 2]) {
      const feed = (await pool[n].feed(id)).body.messages;
      expect(feed).toHaveLength(1);
      expect(feed[0].enc.wraps).toEqual([expect.objectContaining({ uid: pool[n].p.uid, keyId: keyIds[n] })]);
    }
  });

  it("a member who joins later must be locked for too, and one who left no longer is", async () => {
    const { id, wraps } = await groupOfThree();
    const friendId = await connect(pool[0], pool[3]);
    await pool[0].raw("post", `${base(id)}/group/members`, { friendId }).expect(200);
    const fourth = await publish(pool[3], keys[0]); // a key for the new member (the same bytes as another person's key is fine: ids are per person)
    await pool[0].raw("post", `${base(id)}/messages`, locked(wraps)).expect(409); // the old copies miss the new member
    const all = [...wraps, wrap(pool[3].p.uid, fourth)];
    await pool[0].raw("post", `${base(id)}/messages`, locked(all)).expect(201);
    await pool[0].raw("delete", `${base(id)}/group/members/${pool[3].p.uid}`).expect(204);
    await pool[0].raw("post", `${base(id)}/messages`, locked(all)).expect(409); // a copy for somebody who is gone
    await pool[0].raw("post", `${base(id)}/messages`, locked(wraps)).expect(201);
  });
});

describe("the items of a member in the safebox of a group", () => {
  const note = (wraps: ReturnType<typeof wrap>[]) => {
    const iv = b64(12);
    return { type: "note", enc: { v: 1, iv, metaIv: iv, meta: b64(200), thumbIv: null, wraps } };
  };
  const items = async (user: User, id: string) => (await user.raw("get", `${base(id)}/safebox`).expect(200)).body.items as { id: string; ownerId: string }[];

  it("every item has the member who saved it as its owner, and goes with them when they are removed or leave", async () => {
    const { id, wraps } = await groupOfThree();
    const mineNote = (await pool[0].raw("post", `${base(id)}/safebox/items`, note(wraps)).expect(201)).body.id as string;
    await pool[1].raw("post", `${base(id)}/safebox/items`, note(wraps)).expect(201);
    await pool[1].raw("post", `${base(id)}/safebox/items`, note(wraps)).expect(201);
    const third = (await pool[2].raw("post", `${base(id)}/safebox/items`, note(wraps)).expect(201)).body.id as string;
    const before = await items(pool[0], id);
    expect(before.map((i) => i.ownerId).sort()).toEqual([pool[0].p.uid, pool[1].p.uid, pool[1].p.uid, pool[2].p.uid].sort());

    await pool[0].raw("delete", `${base(id)}/group/members/${pool[1].p.uid}`).expect(204); // removed
    expect((await items(pool[0], id)).map((i) => i.id).sort()).toEqual([mineNote, third].sort());

    await pool[2].raw("delete", `${base(id)}/group/members/${pool[2].p.uid}`).expect(204); // leaves
    expect((await items(pool[0], id)).map((i) => i.id)).toEqual([mineNote]);
  });

  it("the attachments of an item of the removed member go with it", async () => {
    const { id, wraps } = await groupOfThree();
    const parent = (await pool[1].raw("post", `${base(id)}/safebox/items`, note(wraps)).expect(201)).body.id as string;
    const child = (await pool[2].raw("post", `${base(id)}/safebox/items`, note(wraps)).expect(201)).body;
    await getFirestore().collection("safebox").doc(id).collection("items").doc(child.id).update({ parentId: parent }); // an attachment is an item with a parent (made by the upload route, with a file)
    await pool[0].raw("delete", `${base(id)}/group/members/${pool[1].p.uid}`).expect(204);
    const left = (await items(pool[0], id)).map((i) => i.id);
    expect(left).not.toContain(parent);
    expect(left).not.toContain(child.id); // an attachment of that item
  });
});

describe("sharing the box of a group with a new member", () => {
  const note = (wraps: ReturnType<typeof wrap>[]) => {
    const iv = b64(12);
    return { type: "note", enc: { v: 1, iv, metaIv: iv, meta: b64(200), thumbIv: null, wraps } };
  };
  const share = (user: User, id: string, items: unknown) => user.raw("post", `${base(id)}/safebox/share`, { items });
  const wrapsOf = async (user: User, id: string) => (await user.raw("get", `${base(id)}/safebox`).expect(200)).body.items.flatMap((i: { enc: { wraps: unknown[] } }) => i.enc.wraps) as { uid: string; keyId: string }[];

  it("lists what lacks a copy for a member's key, with my own copies; accepts new copies only for members' keys; the new member then sees theirs", async () => {
    const { id, keyIds, wraps } = await groupOfThree();
    const item = (await pool[0].raw("post", `${base(id)}/safebox/items`, note(wraps)).expect(201)).body.id as string;
    expect((await pool[1].raw("get", `${base(id)}/safebox/share-todo`).expect(200)).body.items).toEqual([]); // everybody has a copy

    const friendId = await connect(pool[0], pool[3]);
    await pool[0].raw("post", `${base(id)}/group/members`, { friendId }).expect(200);
    const fourth = await publish(pool[3], keys[0]);
    const todo = (await pool[1].raw("get", `${base(id)}/safebox/share-todo`).expect(200)).body.items;
    expect(todo).toEqual([{ id: item, wraps: [expect.objectContaining({ uid: pool[1].p.uid, keyId: keyIds[1] })], missing: [{ uid: pool[3].p.uid, keyId: fourth }] }]);

    expect((await share(pool[1], id, [{ id: item, wraps: [wrap(pool[3].p.uid, "0123456789abcdef0123456789abcdef")] }])).status).toBe(400); // not a key of theirs
    expect((await share(pool[1], id, [{ id: item, wraps: [wrap(pool[5].p.uid, fourth)] }])).status).toBe(400); // not a member
    expect((await share(pool[1], id, [])).status).toBe(400);
    expect((await share(pool[1], id, [{ id: item, wraps: [wrap(pool[3].p.uid, fourth)] }]).expect(200)).body).toEqual({ added: 1 });
    expect((await share(pool[2], id, [{ id: item, wraps: [wrap(pool[3].p.uid, fourth)] }]).expect(200)).body).toEqual({ added: 0 }); // already there
    expect(await wrapsOf(pool[3], id)).toEqual([expect.objectContaining({ uid: pool[3].p.uid, keyId: fourth })]); // the new member sees only their own copy
    expect((await pool[2].raw("get", `${base(id)}/safebox/share-todo`).expect(200)).body.items).toEqual([]);
  });

  it("is only for a group, and not for somebody outside it", async () => {
    const friendship = await connect(pool[0], pool[4]);
    expect((await pool[0].raw("get", `${base(friendship)}/safebox/share-todo`)).status).toBe(404);
    const { id } = await groupOfThree();
    expect((await pool[5].raw("get", `${base(id)}/safebox/share-todo`)).status).toBe(404);
  });
});

