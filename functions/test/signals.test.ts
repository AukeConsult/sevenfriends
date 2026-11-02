import { Timestamp } from "firebase-admin/firestore";
import { beforeEach, describe, expect, it } from "vitest";
import { MAX_FRIENDS } from "../src/constants";
import { deleteRefs, readSignals } from "../src/signals";
import { User, assertConsistent, connect, fillCircle, forEachUser, seedPool, signalsOf } from "./helpers";
import type { Via } from "./types";

/**
 * Adding a friend who has an account writes a ping (an "incoming signal") under THEIR account.
 * Their frontend listens to that collection and, when a ping arrives, runs the ordinary search
 * (the check). The check handles the pings it has seen and deletes them.
 */
let pool: User[];
let u: (n: number) => User;

beforeEach(async () => {
  pool = await seedPool();
  u = (n) => pool[n];
});

const ALL_VIAS: Via[] = ["email", "emailUpper", "phone", "phoneSpaced", "phoneNoPrefix"]; // the ways that can find a person

describe("a ping when somebody is added", () => {
  it("goes to the other person's account: the connection id and the time, nothing else", async () => {
    const entry = await u(0).add(u(1).p);

    const pings = await signalsOf("uid01");
    expect(pings).toHaveLength(1);
    expect(pings[0].id).toBe(entry.id);
    expect(Object.keys(pings[0]).sort()).toEqual(["connectionId", "id", "time"]); // no names, no details
    expect(pings[0].connectionId).toBe(entry.id);
    expect(pings[0].time).toBeInstanceOf(Timestamp);

    expect(await signalsOf("uid00")).toEqual([]); // the one who added gets nothing
    expect((await u(1).friends())).toEqual([]); // still no request and no seat: only the ping
    const summary = await assertConsistent();
    expect(summary).toMatchObject({ signals: 1, requests: 0 });
  });

  it.each(ALL_VIAS)("is sent when the friend is identified by %s", async (via) => {
    const entry = await u(7).add(u(8).p, via);
    expect((await signalsOf("uid08")).map((s) => s.id)).toEqual([entry.id]);
    await assertConsistent();
  });

  it("is not sent for a social account: that is contact info, it cannot find anybody", async () => {
    const res = await u(0).raw("post", "/circles/default/friends", { name: "By handle", email: "nobody@nowhere.test", instagram: u(1).p.instagram });
    expect(res.status).toBe(201);
    expect((await assertConsistent()).signals).toBe(0);
  });

  it("is not sent when nobody has that account", async () => {
    await u(0).raw("post", "/circles/default/friends", { name: "Stranger", email: "stranger@nowhere.test", phone: "+47 5555 5555" });
    expect((await assertConsistent()).signals).toBe(0);
  });

  it("is never sent to yourself", async () => {
    await u(0).add(u(0).p);
    expect((await assertConsistent()).signals).toBe(0);
  });

  it("goes to every account an entry points at (email of one person, phone of another)", async () => {
    const res = await u(0).raw("post", "/circles/default/friends", { name: "Both", email: u(1).p.email, phone: u(2).p.phone });
    expect(res.status).toBe(201);
    expect((await signalsOf("uid01")).map((s) => s.id)).toEqual([res.body.id]);
    expect((await signalsOf("uid02")).map((s) => s.id)).toEqual([res.body.id]);

    expect((await u(1).check()).requests).toHaveLength(1); // person 1 gets the request ...
    expect((await u(2).check()).requests).toEqual([]); // ... person 2 only had a ping
    expect((await assertConsistent()).signals).toBe(0); // both pings are gone
  });

  it("is also sent when the friend's list is full (the request will wait)", async () => {
    await fillCircle(u(1), MAX_FRIENDS);
    const entry = await u(0).add(u(1).p);
    expect((await signalsOf("uid01")).map((s) => s.id)).toEqual([entry.id]);
    expect((await u(1).check()).requests).toEqual([expect.objectContaining({ id: entry.id, seated: false })]);
    expect(await signalsOf("uid01")).toEqual([]);
    await assertConsistent();
  });

  it("is not sent when the add is refused (the list is full)", async () => {
    await fillCircle(u(0), MAX_FRIENDS);
    expect((await u(0).addRaw(u(1).p)).status).toBe(409);
    expect(await signalsOf("uid01")).toEqual([]);
  });
});

describe("the check handles the pings", () => {
  it("creates the request and deletes the ping", async () => {
    const entry = await u(0).add(u(1).p);
    expect(await signalsOf("uid01")).toHaveLength(1);

    expect((await u(1).check()).requests.map((r) => r.id)).toEqual([entry.id]);
    expect(await signalsOf("uid01")).toEqual([]);
    expect((await u(1).check()).requests).toHaveLength(1); // checking again: still one request
    await assertConsistent();
  });

  it("deletes pings even when they lead to nothing (a duplicate entry is dropped)", async () => {
    const first = await connect(u(0), u(1));
    await u(0).add(u(1).p, "phone"); // the same person again
    expect(await signalsOf("uid01")).toHaveLength(1);

    expect((await u(1).check()).requests).toEqual([]);
    expect(await signalsOf("uid01")).toEqual([]);
    expect((await u(0).friends()).map((f) => f.id)).toEqual([first]);
    await assertConsistent();
  });

  it("only deletes the pings it has seen: one that arrives later stays for the next check", async () => {
    await u(0).add(u(1).p);
    const seen = await readSignals("uid01"); // what a check reads at its start
    const later = await u(2).add(u(1).p); // arrives while that check is running
    await deleteRefs(seen); // the check ends

    expect((await signalsOf("uid01")).map((s) => s.id)).toEqual([later.id]);
    expect((await u(1).check()).requests).toHaveLength(2);
    expect(await signalsOf("uid01")).toEqual([]);
  });

  it("answers anything that is in the collection, even if it is old", async () => {
    await u(0).add(u(1).p);
    await u(2).add(u(1).p);
    await u(3).add(u(1).p);
    expect(await signalsOf("uid01")).toHaveLength(3);
    expect((await u(1).check()).requests).toHaveLength(3);
    expect(await signalsOf("uid01")).toEqual([]);
  });
});

describe("a ping goes away with its entry", () => {
  it("when the requester deletes the entry before the other person checks", async () => {
    const entry = await u(0).add(u(1).p);
    await u(0).remove(entry.id);
    expect(await signalsOf("uid01")).toEqual([]);
    expect((await assertConsistent()).entries).toBe(0);
  });

  it("when both added each other and the entries are merged into one connection", async () => {
    await u(0).add(u(1).p); // ping for person 1
    await u(1).add(u(0).p, "phone"); // ping for person 0
    expect(await signalsOf("uid00")).toHaveLength(1);
    expect(await signalsOf("uid01")).toHaveLength(1);

    await u(0).check(); // merges person 0's entry into person 1's: its ping goes with it
    expect(await signalsOf("uid00")).toEqual([]);
    expect(await signalsOf("uid01")).toEqual([]);
    expect(await u(0).friends()).toHaveLength(1);
    await assertConsistent();
  });

  it("an entry that pointed at two accounts takes both pings with it", async () => {
    const res = await u(0).raw("post", "/circles/default/friends", { name: "Both", email: u(1).p.email, phone: u(2).p.phone });
    await u(0).remove(res.body.id);
    expect((await assertConsistent()).signals).toBe(0);
  });
});

describe("in the whole pool", () => {
  it("ring: everybody adds the next 3 people, so everybody gets 3 pings; one check each empties them", async () => {
    await forEachUser(pool, async (user, i) => {
      for (const k of [1, 2, 3]) await user.add(pool[(i + k) % pool.length].p, ALL_VIAS[(i + k) % ALL_VIAS.length]);
    });

    for (const person of pool) expect(await signalsOf(person.p.uid), person.p.uid).toHaveLength(3);
    expect((await assertConsistent()).signals).toBe(180);

    await forEachUser(pool, (user) => user.check());
    expect((await assertConsistent()).signals).toBe(0);
    for (const person of pool) expect((await person.friends()).filter((f) => f.incoming)).toHaveLength(3);
  });

  it("one popular person: 49 pings arrive and one check answers them all", async () => {
    await Promise.all(pool.slice(1, 50).map((fan, i) => fan.add(u(0).p, ALL_VIAS[i % ALL_VIAS.length])));
    expect(await signalsOf("uid00")).toHaveLength(49);

    const { requests } = await u(0).check();
    expect(requests).toHaveLength(49);
    expect(await signalsOf("uid00")).toEqual([]);
    await assertConsistent();
  });

  it("a third withdrawn, half of the receivers checked: exactly the pings of the unchecked, un-withdrawn entries are left", async () => {
    const entries = await Promise.all(pool.slice(0, 30).map((p, i) => p.add(pool[30 + i].p))); // person i adds person 30+i
    const withdrawn = entries.map((e, i) => ({ e, i })).filter(({ i }) => i % 3 === 0);
    await Promise.all(withdrawn.map(({ e, i }) => pool[i].remove(e.id)));
    await forEachUser(pool.slice(30, 45), (user) => user.check()); // receivers 30..44 check

    // left: receivers 45..59 (i = 15..29) whose entry was not withdrawn (i % 3 !== 0): 10 pings
    const summary = await assertConsistent();
    expect(summary.signals).toBe(10);
    for (let i = 15; i < 30; i++) {
      const left = await signalsOf(`uid${30 + i}`);
      expect(left.length, `receiver ${30 + i}`).toBe(i % 3 === 0 ? 0 : 1);
    }
  });
});
