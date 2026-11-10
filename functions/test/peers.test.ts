import { beforeEach, describe, expect, it } from "vitest";
import { getFirestore } from "firebase-admin/firestore";
import { User, assertConsistent, connect, seedPool } from "./helpers";

/**
 * A connection goes over the list of "the other people" (`peers`): a friendship is a list of one. These tests pin what a friendship writes, so the
 * change to the list (the step before groups) can be seen to leave it exactly as it was: the same copies, the same ids, the same fields.
 */
let pool: User[];
beforeEach(async () => {
  pool = await seedPool();
});

const messages = async (uid: string) => (await getFirestore().collection("user-account").doc(uid).collection("messages").get()).docs.map((d) => ({ id: d.id, ...d.data() }) as Record<string, unknown>);
const entry = async (uid: string, id: string) => (await getFirestore().collection("user-account").doc(uid).collection("friend-circle").doc("default").collection("friends").doc(id).get()).data();

describe("a friendship goes over a list of one other person", () => {
  it("writes one copy for each person with the same id, each in its owner's circle, unread only for the receiver", async () => {
    const id = await connect(pool[0], pool[1]);
    const sent = (await pool[0].send(id, "hello")).body;
    const mine = (await messages(pool[0].p.uid)).filter((m) => m.id === sent.id);
    const theirs = (await messages(pool[1].p.uid)).filter((m) => m.id === sent.id);
    expect(mine).toHaveLength(1);
    expect(theirs).toHaveLength(1);
    expect(mine[0]).toMatchObject({ connectionId: id, fromUid: pool[0].p.uid, toUid: pool[1].p.uid, text: "hello", circleId: "default", read: true });
    expect(theirs[0]).toMatchObject({ connectionId: id, fromUid: pool[0].p.uid, toUid: pool[1].p.uid, text: "hello", circleId: "default", read: false });
    expect((await entry(pool[0].p.uid, id))?.lastMessageAt).toBeTruthy();
    expect((await entry(pool[1].p.uid, id))?.lastMessageAt).toBeTruthy();
  });

  it("edits and deletes both copies", async () => {
    const id = await connect(pool[0], pool[1]);
    const sent = (await pool[0].send(id, "first")).body;
    await pool[0].raw("put", `/circles/default/friends/${id}/messages/${sent.id}`, { text: "second" }).expect(200);
    expect((await messages(pool[1].p.uid)).find((m) => m.id === sent.id)).toMatchObject({ text: "second" });
    await pool[0].raw("delete", `/circles/default/friends/${id}/messages/${sent.id}`).expect(204);
    expect((await messages(pool[0].p.uid)).some((m) => m.id === sent.id)).toBe(false);
    expect((await messages(pool[1].p.uid)).some((m) => m.id === sent.id)).toBe(false);
    await assertConsistent();
  });

  it("deletes several messages from both sides at once", async () => {
    const id = await connect(pool[0], pool[1]);
    for (const text of ["a", "b", "c"]) await pool[0].send(id, text);
    const result = (await pool[0].raw("post", `/circles/default/friends/${id}/messages/delete`, {}).expect(200)).body;
    expect(result).toMatchObject({ matched: 3, deleted: 3 });
    expect(await messages(pool[0].p.uid)).toHaveLength(0);
    expect(await messages(pool[1].p.uid)).toHaveLength(0);
  });

  it("is silent on the sleep list, and a poke rings anyway (the sleep check is made for each other person)", async () => {
    const id = await connect(pool[0], pool[1]);
    await getFirestore().collection("user-account").doc(pool[1].p.uid).collection("friend-circle").doc("default").collection("friends").doc(id).update({ asleep: true });
    expect((await pool[0].send(id, "shh")).status).toBe(201);
    expect((await pool[0].raw("post", `/circles/default/friends/${id}/messages`, { text: "wake up", poke: true })).status).toBe(201);
    expect((await messages(pool[1].p.uid)).filter((m) => m.connectionId === id)).toHaveLength(2);
  });
});
