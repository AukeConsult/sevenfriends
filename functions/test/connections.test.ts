import { Timestamp, getFirestore } from "firebase-admin/firestore";
import request from "supertest";
import { beforeEach, describe, expect, it } from "vitest";
import { MAX_FRIENDS } from "../src/constants";
import { POOL_SIZE, User, app, assertConsistent, fillCircle, seedPool, sleep } from "./helpers";
import type { Via } from "./types";

/**
 * The friend-request rules (see "Connection rules" in CLAUDE.md), played out in a pool of 60 people.
 * Every test starts from a fresh database with all 60 signed up, and ends by checking the global
 * invariants (seats, shared ids, symmetry, statuses, no orphans) straight from the database.
 */
let pool: User[];
let u: (n: number) => User;

beforeEach(async () => {
  pool = await seedPool();
  u = (n) => pool[n];
});

const MATCH_VIAS: Via[] = ["email", "emailUpper", "phone", "phoneSpaced", "phoneNoPrefix"]; // the ways that can find a person
const SOCIAL_HANDLES = ["instagram", "tiktok", "twitter", "linkedin", "snapchat", "telegram", "facebook"] as const;

describe("the pool", () => {
  it("has at least 50 people, all signed up and with an empty circle", async () => {
    expect(POOL_SIZE).toBeGreaterThanOrEqual(50);
    expect(pool.length).toBeGreaterThanOrEqual(50);
    for (const person of pool.slice(0, 5)) expect(await person.friends()).toEqual([]);
    expect((await assertConsistent()).entries).toBe(0);
  });
});

describe("adding a friend", () => {
  it("only writes a pending entry in MY list; the other side gets a ping, but no request and no seat", async () => {
    const entry = await u(0).add(u(1).p);
    expect(entry).toMatchObject({ status: "pending", waiting: false, incoming: false });

    expect(await u(1).friends()).toEqual([]); // nothing in their circle
    const summary = await assertConsistent();
    expect(summary.entries).toBe(1);
    expect(summary.requests).toBe(0); // no request anywhere
  });

  it.each([
    ["no contact at all", { name: "Nobody" }],
    ["only a social account (it cannot find anybody)", { name: "X", instagram: "x.person" }],
    ["a bad email", { name: "X", email: "not-an-email" }],
    ["a bad phone number", { name: "X", phone: "abc" }],
  ])("refuses %s", async (_label, body) => {
    const res = await u(0).raw("post", "/circles/default/friends", body);
    expect(res.status).toBe(400);
    expect(await u(0).friends()).toEqual([]);
  });

  it("stores every social media account", async () => {
    const res = await u(0).raw("post", "/circles/default/friends", {
      name: "Social",
      email: "social.person@nowhere.test",
      facebook: "fb.person",
      instagram: "@insta.person",
      tiktok: "tt.person",
      snapchat: "snap.person",
      twitter: "@x.person",
      linkedin: "https://linkedin.com/in/lin-person",
      telegram: "tg.person",
    });
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({
      facebook: "fb.person",
      instagram: "insta.person", // a leading @ is dropped
      tiktok: "tt.person",
      snapchat: "snap.person",
      twitter: "x.person",
      linkedin: "https://linkedin.com/in/lin-person",
      telegram: "tg.person",
    });
  });

  it("refuses the 8th friend (7 seats)", async () => {
    await fillCircle(u(0), MAX_FRIENDS);
    const res = await u(0).addRaw(u(1).p);
    expect(res.status).toBe(409);
    expect(res.body.error).toMatch(/full/i);
    expect(await u(0).friends()).toHaveLength(MAX_FRIENDS);
  });

  it("asks for a login and a real circle", async () => {
    expect((await request(app).post("/api/notifications/check")).status).toBe(401);
    expect((await request(app).post("/api/notifications/check").set("Authorization", "Bearer garbage")).status).toBe(401);
    expect((await u(0).raw("post", "/circles/nope/friends", { name: "X", email: "x@y.test" })).status).toBe(404);
  });
});

describe("how the other person finds the request (the check)", () => {
  it("shows up in their list once THEY check, with the same id on both sides", async () => {
    const mine = await u(0).add(u(1).p);

    const { requests } = await u(1).check();
    expect(requests).toEqual([expect.objectContaining({ id: mine.id, seated: true, fromName: "Person 00" })]);

    const theirs = await u(1).friends();
    expect(theirs).toHaveLength(1);
    expect(theirs[0]).toMatchObject({ id: mine.id, status: "pending", incoming: true, requestId: mine.id });
    expect((await u(0).friends())[0]).toMatchObject({ id: mine.id, invited: true }); // now linked to them
    await assertConsistent();
  });

  it.each(MATCH_VIAS)("finds me by %s", async (via) => {
    const mine = await u(7).add(u(8).p, via);
    const { requests } = await u(8).check();
    expect(requests.map((r) => r.id)).toEqual([mine.id]);
    expect((await u(8).friends())[0].id).toBe(mine.id);
    await assertConsistent();
  });

  it("does not find the wrong people: nobody else gets a request", async () => {
    await u(0).raw("post", "/circles/default/friends", { name: "Stranger", email: "stranger@nowhere.test" });
    for (const person of pool) expect((await person.check()).requests).toEqual([]);
    await assertConsistent();
  });

  it("ignores my own entries", async () => {
    await u(0).add(u(0).p);
    expect((await u(0).check()).requests).toEqual([]);
    expect(await u(0).friends()).toHaveLength(1);
    await assertConsistent();
  });

  it("does not hijack an entry that is already linked to another person", async () => {
    // one entry that points at person 1 (email) AND person 2 (phone)
    const res = await u(0).raw("post", "/circles/default/friends", { name: "Both", email: u(1).p.email, phone: u(2).p.phone });
    expect(res.status).toBe(201);
    expect((await u(1).check()).requests).toHaveLength(1); // 1 got there first and is now linked
    expect((await u(2).check()).requests).toEqual([]);
    await assertConsistent();
  });

  it("is safe to repeat: checking again never duplicates requests or seats", async () => {
    await u(0).add(u(1).p);
    for (let i = 0; i < 5; i++) expect((await u(1).check()).requests).toHaveLength(1);
    expect(await u(1).friends()).toHaveLength(1);
    expect((await assertConsistent()).requests).toBe(1);
  });
});

describe("confirming", () => {
  it("makes both sides confirmed, with the same id, and the request accepted", async () => {
    const mine = await u(0).add(u(1).p);
    await u(1).check();

    const res = await u(1).confirm(mine.id);
    expect(res.status).toBe(200);
    expect(res.body.result).toBe("confirmed");

    expect((await u(0).friends())[0]).toMatchObject({ id: mine.id, status: "confirmed" });
    expect((await u(1).friends())[0]).toMatchObject({ id: mine.id, status: "confirmed" });
    expect((await u(1).check()).requests).toEqual([]); // nothing pending any more
    expect((await assertConsistent()).confirmed).toBe(2);
  });

  it("is idempotent, and 404 for a request that does not exist or belongs to someone else", async () => {
    const mine = await u(0).add(u(1).p);
    await u(1).check();
    expect((await u(1).confirm(mine.id)).status).toBe(200);
    expect((await u(1).confirm(mine.id)).body.result).toBe("confirmed"); // again: no change
    expect((await u(2).confirm(mine.id)).status).toBe(404); // not their request
    expect((await u(1).confirm("does-not-exist")).status).toBe(404);
    await assertConsistent();
  });
});

describe("rejecting", () => {
  it("tells the requester (Rejected), frees my seat, and is never recreated", async () => {
    const mine = await u(0).add(u(1).p);
    await u(1).check();

    expect((await u(1).reject(mine.id)).status).toBe(200);
    expect(await u(1).friends()).toEqual([]); // seat freed
    expect((await u(0).friends())[0]).toMatchObject({ id: mine.id, status: "rejected", waiting: false });

    for (let i = 0; i < 3; i++) expect((await u(1).check()).requests).toEqual([]); // not recreated
    expect(await u(1).friends()).toEqual([]);
    await assertConsistent();
  });

  it("lets the requester delete a rejected request; then it is gone everywhere, and can be asked again", async () => {
    const first = await u(0).add(u(1).p);
    await u(1).check();
    await u(1).reject(first.id);

    expect((await u(0).remove(first.id)).status).toBe(204);
    expect(await u(0).friends()).toEqual([]);
    expect((await assertConsistent()).requests).toBe(0);

    const again = await u(0).add(u(1).p); // rejection is not a permanent block
    expect(again.id).not.toBe(first.id);
    expect((await u(1).check()).requests.map((r) => r.id)).toEqual([again.id]);
    await assertConsistent();
  });

  it("cannot reject something already confirmed, and 404 for unknown requests", async () => {
    const mine = await u(0).add(u(1).p);
    await u(1).check();
    await u(1).confirm(mine.id);
    expect((await u(1).reject(mine.id)).status).toBe(409);
    expect((await u(1).reject("does-not-exist")).status).toBe(404);
    expect((await u(0).friends())[0].status).toBe("confirmed");
    await assertConsistent();
  });
});

describe("deleting removes the connection from BOTH lists", () => {
  it("requester deletes before the other person has checked: they never see it", async () => {
    const mine = await u(0).add(u(1).p);
    expect((await u(0).remove(mine.id)).status).toBe(204);
    expect((await u(1).check()).requests).toEqual([]);
    expect((await assertConsistent()).entries).toBe(0);
  });

  it("requester deletes a pending request that already sits in their circle", async () => {
    const mine = await u(0).add(u(1).p);
    await u(1).check();
    await u(0).remove(mine.id);
    expect(await u(1).friends()).toEqual([]);
    expect((await u(1).check()).requests).toEqual([]);
    expect((await assertConsistent()).entries).toBe(0);
  });

  it("the other person deletes the pending seat: gone on both sides", async () => {
    const mine = await u(0).add(u(1).p);
    await u(1).check();
    await u(1).remove(mine.id);
    expect(await u(0).friends()).toEqual([]);
    expect((await assertConsistent()).entries).toBe(0);
  });

  it.each([
    ["the requester", 0, 1],
    ["the other person", 1, 0],
  ])("a confirmed friendship deleted by %s disappears for both", async (_who, deleter, other) => {
    const mine = await u(0).add(u(1).p);
    await u(1).check();
    await u(1).confirm(mine.id);

    expect((await u(deleter).remove(mine.id)).status).toBe(204);
    expect(await u(deleter).friends()).toEqual([]);
    expect(await u(other).friends()).toEqual([]);
    const summary = await assertConsistent();
    expect(summary).toMatchObject({ entries: 0, requests: 0 });
  });

  it("only removes that connection and leaves the others alone", async () => {
    const [a, b, c] = [await u(0).add(u(1).p), await u(0).add(u(2).p, "phone"), await u(0).add(u(3).p, "phoneSpaced")];
    for (const n of [1, 2, 3]) await u(n).check();
    await u(0).remove(b.id);

    expect((await u(0).friends()).map((f) => f.id).sort()).toEqual([a.id, c.id].sort());
    expect(await u(2).friends()).toEqual([]);
    expect(await u(1).friends()).toHaveLength(1);
    expect(await u(3).friends()).toHaveLength(1);
    await assertConsistent();
  });

  it("deleting something that is not there is harmless", async () => {
    expect((await u(0).remove("nothing-here")).status).toBe(204);
    await assertConsistent();
  });
});

describe("no free seat: the waiting list", () => {
  /** Person 1 has a full list (7 seats used); person 0 asks them. */
  async function fullRecipientAskedBy(asker = 0, full = 1) {
    await fillCircle(u(full), MAX_FRIENDS);
    return u(asker).add(u(full).p);
  }

  it("goes on the waiting list only, and the requester is told", async () => {
    const mine = await fullRecipientAskedBy();

    const { requests } = await u(1).check();
    expect(requests).toEqual([expect.objectContaining({ id: mine.id, seated: false })]);
    const theirs = await u(1).friends();
    expect(theirs).toHaveLength(MAX_FRIENDS); // not in their regular list
    expect(theirs.find((f) => f.id === mine.id)).toBeUndefined();

    expect((await u(0).friends())[0]).toMatchObject({ id: mine.id, status: "pending", waiting: true, invited: true });
    await assertConsistent();
  });

  it("gets a seat as soon as one is free (and the Waiting flag clears)", async () => {
    const mine = await fullRecipientAskedBy();
    await u(1).check();

    const filler = (await u(1).friends())[0];
    await u(1).remove(filler.id);
    const { requests } = await u(1).check();

    expect(requests).toEqual([expect.objectContaining({ id: mine.id, seated: true })]);
    expect((await u(1).friends()).find((f) => f.id === mine.id)).toMatchObject({ incoming: true, status: "pending" });
    expect((await u(0).friends())[0]).toMatchObject({ waiting: false, status: "pending" });
    await assertConsistent();

    expect((await u(1).confirm(mine.id)).body.result).toBe("confirmed"); // and it can be confirmed
    expect((await u(0).friends())[0].status).toBe("confirmed");
    await assertConsistent();
  });

  it("is removed from the waiting list when the requester deletes it", async () => {
    const mine = await fullRecipientAskedBy();
    await u(1).check();
    await u(0).remove(mine.id);

    expect((await u(1).check()).requests).toEqual([]);
    expect(await u(1).friends()).toHaveLength(MAX_FRIENDS);
    const summary = await assertConsistent();
    expect(summary.requests).toBe(0);
  });

  it("can be rejected from the waiting list, and the requester sees Rejected", async () => {
    const mine = await fullRecipientAskedBy();
    await u(1).check();
    expect((await u(1).reject(mine.id)).status).toBe(200);

    expect((await u(0).friends())[0]).toMatchObject({ status: "rejected", waiting: false });
    expect((await u(1).check()).requests).toEqual([]);
    expect(await u(1).friends()).toHaveLength(MAX_FRIENDS);
    await assertConsistent();
  });

  it("a pending seat also uses a seat: with 6 friends + 1 pending seat the next request waits", async () => {
    await fillCircle(u(1), MAX_FRIENDS - 1);
    const first = await u(2).add(u(1).p);
    const second = await u(3).add(u(1).p);
    const { requests } = await u(1).check();

    expect(requests.find((r) => r.id === first.id)?.seated).toBe(true);
    expect(requests.find((r) => r.id === second.id)?.seated).toBe(false);
    await assertConsistent();
  });

  it("gives freed seats to the OLDEST waiting request first", async () => {
    await fillCircle(u(1), MAX_FRIENDS);
    const asked: string[] = [];
    for (const n of [2, 3, 4]) {
      asked.push((await u(n).add(u(1).p)).id);
      await u(1).check(); // discovered one after the other: 2, then 3, then 4
      await sleep(5);
    }

    const seatedIds = async () => (await u(1).check()).requests.filter((r) => r.seated).map((r) => r.id);
    expect(await seatedIds()).toEqual([]);

    await u(1).remove((await u(1).friends())[0].id);
    expect(await seatedIds()).toEqual([asked[0]]);
    await u(1).remove((await u(1).friends()).find((f) => !f.incoming)!.id);
    expect((await seatedIds()).sort()).toEqual([asked[0], asked[1]].sort());

    expect((await u(4).friends())[0]).toMatchObject({ id: asked[2], waiting: true }); // last one still waits
    expect((await u(2).friends())[0].waiting).toBe(false);
    await assertConsistent();
  });
});

describe("both people added each other", () => {
  it.each([
    ["0 checks first", 0, 1],
    ["1 checks first", 1, 0],
  ])("becomes ONE connection with a shared id (%s)", async (_label, first, second) => {
    const a = await u(0).add(u(1).p);
    const b = await u(1).add(u(0).p, "phone");

    await u(first).check();
    expect(await u(0).friends()).toHaveLength(1); // no duplicate
    expect(await u(1).friends()).toHaveLength(1);
    expect((await u(0).friends())[0].id).toBe((await u(1).friends())[0].id);
    expect([a.id, b.id]).toContain((await u(0).friends())[0].id);

    await u(second).check(); // the second check changes nothing
    expect(await u(0).friends()).toHaveLength(1);
    expect(await u(1).friends()).toHaveLength(1);
    await assertConsistent();

    // the one who was asked confirms; both are then confirmed
    const asked = (await u(0).friends())[0].incoming ? u(0) : u(1);
    const connectionId = (await asked.friends())[0].id;
    expect((await asked.confirm(connectionId)).status).toBe(200);
    expect((await u(0).friends())[0].status).toBe("confirmed");
    expect((await u(1).friends())[0].status).toBe("confirmed");
    await assertConsistent();
  });
});

describe("profile matching details", () => {
  it.each(SOCIAL_HANDLES)("a %s account never finds anybody: it is contact info only", async (network) => {
    // person 1 has this account on their profile, but nothing is ever matched on it
    await u(1).raw("put", "/profile", { [network]: `handle_${network}` }).expect(200);
    const res = await u(0).raw("post", "/circles/default/friends", { name: "By handle", email: "nobody@nowhere.test", [network]: `handle_${network}` });
    expect(res.status).toBe(201);

    expect((await u(1).check()).requests).toEqual([]);
    const summary = await assertConsistent();
    expect(summary.signals).toBe(0);
    expect((await u(0).friends())[0]).toMatchObject({ [network]: `handle_${network}`, invited: false }); // shown, never linked
  });

  it("rejects an invalid phone on the profile and returns what was saved", async () => {
    expect((await u(0).raw("put", "/profile", { phone: "abc" })).status).toBe(400);
    const saved = await u(0).raw("get", "/profile").expect(200);
    expect(saved.body).toMatchObject({ phone: u(0).p.phone, instagram: u(0).p.instagram, linkedin: u(0).p.linkedin, snapchat: null });
  });
});

describe("messages", () => {
  const messages = (uid: string) => getFirestore().collection("user-account").doc(uid).collection("messages");

  it("returns my unread messages newest first, and marks them read", async () => {
    const base = Date.now() - 100_000;
    await messages("uid00").doc("old").set({ fromUid: "uid05", fromName: "Person 05", text: "first", read: false, time: Timestamp.fromMillis(base) });
    await messages("uid00").doc("new").set({ fromUid: "uid06", fromName: "Person 06", text: "second", read: false, time: Timestamp.fromMillis(base + 5000) });
    await messages("uid00").doc("seen").set({ fromUid: "uid07", fromName: "Person 07", text: "already read", read: true, time: Timestamp.fromMillis(base + 9000) });

    const { messages: unread } = await u(0).check();
    expect(unread.map((m) => m.id)).toEqual(["new", "old"]);
    expect(unread[0]).toMatchObject({ fromName: "Person 06", text: "second" });

    expect((await u(1).check()).messages).toEqual([]); // not visible to anyone else
    expect((await u(1).raw("post", "/messages/new/read")).status).toBe(404);

    expect((await u(0).raw("post", "/messages/new/read")).status).toBe(200);
    expect((await u(0).check()).messages.map((m) => m.id)).toEqual(["old"]);
    expect((await u(0).raw("post", "/messages/nope/read")).status).toBe(404);
  });
});

describe("one connection per pair of people", () => {
  it("adding someone you are already connected to does not create a second connection", async () => {
    const first = await u(0).add(u(1).p);
    await u(1).check();
    await u(1).confirm(first.id);

    await u(0).add(u(1).p, "phone"); // the same person again
    expect((await u(1).check()).requests).toEqual([]);
    expect((await u(0).friends()).map((f) => f.id)).toEqual([first.id]); // the duplicate was dropped
    expect((await u(1).friends()).map((f) => f.id)).toEqual([first.id]);
    expect((await assertConsistent()).confirmed).toBe(2);
  });

  it("adding the same person twice (even with different details) leaves ONE connection", async () => {
    await u(0).add(u(1).p, "email");
    await u(0).add(u(1).p, "phone");
    expect(await u(0).friends()).toHaveLength(2); // until they check

    expect((await u(1).check()).requests).toHaveLength(1);
    expect(await u(0).friends()).toHaveLength(1);
    expect(await u(1).friends()).toHaveLength(1);
    await assertConsistent();
  });

  it("the other person adding me back after we are friends is dropped too", async () => {
    const first = await u(0).add(u(1).p);
    await u(1).check();
    await u(1).confirm(first.id);

    await u(1).add(u(0).p);
    expect((await u(0).check()).requests).toEqual([]);
    expect((await u(1).friends()).map((f) => f.id)).toEqual([first.id]);
    await assertConsistent();
  });

  it("asking again after a rejection needs a delete first", async () => {
    const first = await u(0).add(u(1).p);
    await u(1).check();
    await u(1).reject(first.id);

    await u(0).add(u(1).p, "phone"); // asks again without deleting the rejected entry
    expect((await u(1).check()).requests).toEqual([]);
    expect((await u(0).friends()).map((f) => [f.id, f.status])).toEqual([[first.id, "rejected"]]);

    await u(0).remove(first.id); // delete, then ask again
    const again = await u(0).add(u(1).p);
    expect((await u(1).check()).requests.map((r) => r.id)).toEqual([again.id]);
    await assertConsistent();
  });

  it("when they rejected me and now add me, their new request replaces the old rejection", async () => {
    const mine = await u(0).add(u(1).p);
    await u(1).check();
    await u(1).reject(mine.id);
    expect((await u(0).friends())[0].status).toBe("rejected");

    const theirs = await u(1).add(u(0).p); // person 1 changed their mind
    const { requests } = await u(0).check();
    expect(requests.map((r) => r.id)).toEqual([theirs.id]);

    expect(await u(0).friends()).toEqual([expect.objectContaining({ id: theirs.id, status: "pending", incoming: true })]);
    expect(await u(1).friends()).toEqual([expect.objectContaining({ id: theirs.id, status: "pending" })]);
    expect((await u(0).confirm(theirs.id)).status).toBe(200);
    expect((await assertConsistent()).confirmed).toBe(2);
  });
});
