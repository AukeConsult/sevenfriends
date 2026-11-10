import { beforeEach, describe, expect, it } from "vitest";
import { FieldValue, getFirestore } from "firebase-admin/firestore";
import { User, seedPool } from "./helpers";

/** Every friend sits in a numbered seat (1-7) that stays when other seats become free. */
let pool: User[];
beforeEach(async () => {
  pool = await seedPool();
});

const seats = async (user: User) => Object.fromEntries((await user.friends()).map((f) => [f.name, f.seat]));

describe("the seat numbers", () => {
  it("are given 1, 2, 3 ... in the order friends are added", async () => {
    for (const n of [1, 2, 3]) await pool[0].add(pool[n].p);
    expect(Object.values(await seats(pool[0]))).toEqual([1, 2, 3]);
  });

  it("stay when a friend in the middle is removed, and the new friend takes the free number", async () => {
    const [a, b, c] = [await pool[0].add(pool[1].p), await pool[0].add(pool[2].p), await pool[0].add(pool[3].p)];
    expect([a.seat, b.seat, c.seat]).toEqual([1, 2, 3]);
    await pool[0].remove(b.id).expect(204);
    const left = await pool[0].friends();
    expect(left.map((f) => f.seat)).toEqual([1, 3]); // seat 2 is empty, 3 did not move up
    const d = await pool[0].add(pool[4].p);
    expect(d.seat).toBe(2);
  });

  it("are given up when a friend goes to sleep, and a woken friend takes the lowest free one", async () => {
    const a = await pool[0].add(pool[1].p);
    const b = await pool[0].add(pool[2].p);
    await pool[0].raw("post", `/circles/default/friends/${a.id}/sleep`, { asleep: true }).expect(200);
    expect((await pool[0].friends()).find((f) => f.id === a.id)?.seat).toBeNull();
    expect((await pool[0].friends()).find((f) => f.id === b.id)?.seat).toBe(2);
    const c = await pool[0].add(pool[3].p);
    expect(c.seat).toBe(1); // the free seat goes to the next friend
    const woken = await pool[0].raw("post", `/circles/default/friends/${a.id}/sleep`, { asleep: false }).expect(200);
    expect(woken.body.seat).toBe(3);
  });

  it("can be changed: a free seat is taken, a taken seat is swapped", async () => {
    const a = await pool[0].add(pool[1].p);
    const b = await pool[0].add(pool[2].p);
    await pool[0].raw("post", `/circles/default/friends/${a.id}/seat`, { seat: 5 }).expect(200); // a free seat
    expect(Object.values(await seats(pool[0])).sort()).toEqual([2, 5]);
    await pool[0].raw("post", `/circles/default/friends/${a.id}/seat`, { seat: 2 }).expect(200); // b's seat: swapped
    const now = await pool[0].friends();
    expect(now.find((f) => f.id === a.id)?.seat).toBe(2);
    expect(now.find((f) => f.id === b.id)?.seat).toBe(5);
  });

  it("cannot be changed to a seat that does not exist, for a sleeping friend or a stranger", async () => {
    const a = await pool[0].add(pool[1].p);
    for (const seat of [0, 8, 1.5, "2", null]) {
      expect((await pool[0].raw("post", `/circles/default/friends/${a.id}/seat`, { seat })).status).toBe(400);
    }
    expect((await pool[0].raw("post", `/circles/default/friends/nobody/seat`, { seat: 3 })).status).toBe(404);
    await pool[0].raw("post", `/circles/default/friends/${a.id}/sleep`, { asleep: true }).expect(200);
    expect((await pool[0].raw("post", `/circles/default/friends/${a.id}/seat`, { seat: 3 })).status).toBe(409);
    expect((await pool[1].raw("post", `/circles/default/friends/${a.id}/seat`, { seat: 3 })).status).toBe(404); // not their friend entry
  });

  it("are given to friends from before the numbers existed, stored, and a new friend then takes a really free seat", async () => {
    const a = await pool[0].add(pool[1].p);
    const b = await pool[0].add(pool[2].p);
    // make them look old: no seat number stored
    for (const entry of (await getFirestore().collectionGroup("friends").get()).docs) {
      if ([a.id, b.id].includes(entry.id)) await entry.ref.update({ seat: FieldValue.delete() });
    }
    const c = await pool[0].add(pool[3].p); // before the list is read: the old friends still get 1 and 2
    expect(c.seat).toBe(3);
    const now = await pool[0].friends();
    expect(now.map((f) => f.seat)).toEqual([1, 2, 3]);
    // and it is stored
    const stored = (await getFirestore().collectionGroup("friends").get()).docs.filter((d) => [a.id, b.id, c.id].includes(d.id) && d.ref.path.includes(pool[0].p.uid));
    expect(stored.map((d) => d.data().seat).sort()).toEqual([1, 2, 3]);
  });

  it("a friend confirmed when every seat is taken goes on the sleep list, and the other side is told", async () => {
    const { fillCircle } = await import("./helpers");
    const entry = await pool[0].add(pool[1].p);
    await fillCircle(pool[1]);
    await pool[1].check();
    await pool[1].confirm(entry.id).expect(200);
    const mine = (await pool[1].friends()).find((f) => f.id === entry.id);
    expect(mine).toMatchObject({ status: "confirmed", asleep: true, seat: null });
    expect((await pool[1].friends()).filter((f) => !f.asleep)).toHaveLength(7); // the seven seats are unchanged
    expect((await pool[0].friends()).find((f) => f.id === entry.id)).toMatchObject({ status: "confirmed", sleepsMe: true });
  });
});

describe("ownerUid on the entries (the app listens to all of a person's circles with one query on it)", () => {
  it("is on the entries of both sides, and an old entry without it gets it when its owner reads the list", async () => {
    const a = await pool[0].add(pool[1].p);
    await pool[1].check(); // the other side finds the request
    const entryOf = (uid: string) => getFirestore().collection("user-account").doc(uid).collection("friend-circle").doc("default").collection("friends").doc(a.id);
    const mine = entryOf(pool[0].p.uid);
    expect((await mine.get()).data()?.ownerUid).toBe(pool[0].p.uid);
    const theirs = entryOf(pool[1].p.uid);
    await pool[1].confirm(a.id);
    expect((await theirs.get()).data()?.ownerUid).toBe(pool[1].p.uid);

    await mine.update({ ownerUid: FieldValue.delete() }); // an entry made before the field existed
    await pool[0].friends();
    expect((await mine.get()).data()?.ownerUid).toBe(pool[0].p.uid);
  });
});
