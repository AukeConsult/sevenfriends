import { beforeEach, describe, expect, it } from "vitest";
import { MAX_FRIENDS } from "../src/constants";
import { POOL_SIZE, User, assertConsistent, forEachUser, seedPool } from "./helpers";
import type { Via } from "./types";

/**
 * Everybody in the pool at once: busy networks, a very popular person, and a long randomised
 * sequence of mixed actions. The global invariants are checked from the database at every stage.
 */
let pool: User[];

beforeEach(async () => {
  pool = await seedPool();
});

const VIAS: Via[] = ["email", "emailUpper", "phone", "phoneSpaced", "phoneNoPrefix"]; // the ways that can find a person

/** Run `fn` for every person at the same time (like a busy evening), see forEachUser. */
const everyone = <T>(fn: (user: User, i: number) => Promise<T>) => forEachUser(pool, fn);

describe("everyone in a ring", () => {
  it("each person adds the next three, everybody checks and confirms: 180 confirmed connections", async () => {
    expect(pool.length).toBe(POOL_SIZE);

    // 1. everybody adds the next three people, each one identified differently
    await everyone(async (user, i) => {
      for (const k of [1, 2, 3]) await user.add(pool[(i + k) % pool.length].p, VIAS[(i + k) % VIAS.length]);
    });
    let summary = await assertConsistent();
    expect(summary).toMatchObject({ entries: 180, requests: 0 }); // nothing on the other side yet

    // 2. everybody checks at the same time: each now has 3 incoming pending seats
    await everyone((user) => user.check());
    summary = await assertConsistent();
    expect(summary.requests).toBe(180);
    expect(summary.entries).toBe(360);
    for (const user of pool) {
      const friends = await user.friends();
      expect(friends).toHaveLength(6);
      expect(friends.filter((f) => f.incoming)).toHaveLength(3);
      expect(friends.every((f) => !f.waiting)).toBe(true);
    }

    // 3. everybody confirms all their incoming requests at the same time
    await everyone(async (user) => {
      const incoming = (await user.check()).requests.filter((r) => r.seated);
      expect(incoming).toHaveLength(3);
      for (const r of incoming) expect((await user.confirm(r.id)).body.result).toBe("confirmed");
    });
    summary = await assertConsistent();
    expect(summary.confirmed).toBe(360);

    // 4. nothing is left pending, and checking again changes nothing
    const before = summary.entries;
    await everyone((user) => user.check());
    for (const user of pool) {
      const friends = await user.friends();
      expect(friends).toHaveLength(6);
      expect(friends.every((f) => f.status === "confirmed")).toBe(true);
    }
    expect((await assertConsistent()).entries).toBe(before);
  });
});

describe("everyone chats", () => {
  it("in the ring, every person writes to all 6 friends: 360 messages, 720 copies, nothing mixed up", async () => {
    // a confirmed ring: 180 connections, each person has 6 friends
    await everyone(async (user, i) => {
      for (const k of [1, 2, 3]) await user.add(pool[(i + k) % pool.length].p, VIAS[(i + k) % VIAS.length]);
    });
    await everyone((user) => user.check());
    await everyone(async (user) => {
      for (const r of (await user.check()).requests.filter((x) => x.seated)) await user.confirm(r.id);
    });

    // everybody writes one message to each friend
    await everyone(async (user) => {
      for (const friend of await user.friends()) {
        expect((await user.send(friend.id, `hi from ${user.p.n}`)).status).toBe(201);
      }
    });
    expect((await assertConsistent()).messages).toBe(720);

    // every person has exactly one unread message from each of the 6 friends
    await everyone(async (user) => {
      const { messages } = await user.check();
      expect(messages).toHaveLength(6);
      expect(new Set(messages.map((m) => m.fromName)).size).toBe(6);
    });

    // every feed holds exactly 2 messages: one each way, the right ones
    await everyone(async (user) => {
      for (const friend of await user.friends()) {
        const feed = (await user.feed(friend.id)).body.messages as { text: string; mine: boolean }[];
        expect(feed).toHaveLength(2);
        expect(feed.filter((m) => m.mine).map((m) => m.text)).toEqual([`hi from ${user.p.n}`]);
        expect(feed.filter((m) => !m.mine)[0].text).toMatch(/^hi from \d+$/);
        expect((await user.markFeedRead(friend.id)).status).toBe(200);
      }
    });
    await everyone(async (user) => expect((await user.check()).messages).toEqual([]));
    await assertConsistent();
  });
});

describe("one very popular person (49 people ask the same person)", () => {
  it("7 get a seat, 42 wait and know it; then confirm, reject, delete and promotion work", async () => {
    const star = pool[0];
    const fans = pool.slice(1, 50);

    // everybody asks the star at the same time, each identifying them differently
    await Promise.all(fans.map((fan, i) => fan.add(star.p, VIAS[i % VIAS.length])));
    const waitingFans = async () => (await Promise.all(fans.map((f) => f.friends()))).flat().filter((e) => e.waiting).length;
    expect(await star.friends()).toEqual([]); // nothing until the star checks

    // the star checks: only 7 seats exist
    const first = await star.check();
    expect(first.requests).toHaveLength(49);
    const seated = first.requests.filter((r) => r.seated);
    const waiting = first.requests.filter((r) => !r.seated);
    expect(seated).toHaveLength(MAX_FRIENDS);
    expect(waiting).toHaveLength(42);
    expect(await star.friends()).toHaveLength(MAX_FRIENDS);
    expect(await waitingFans()).toBe(42); // the 42 requesters were informed
    await assertConsistent();

    // the star confirms the 7 seated ones
    for (const r of seated) expect((await star.confirm(r.id)).body.result).toBe("confirmed");
    expect((await assertConsistent()).confirmed).toBe(14);

    // the star rejects 5 of the waiting ones: their entries are deleted (they are told by a notice), nobody waits for them any more
    const rejected = waiting.slice(0, 5);
    for (const r of rejected) expect((await star.reject(r.id)).status).toBe(200);
    expect((await star.check()).requests.filter((r) => !r.seated)).toHaveLength(37);
    const fansEntries = (await Promise.all(fans.map((f) => f.friends()))).flat();
    expect(fansEntries.filter((e) => e.status === "rejected")).toEqual([]); // a rejection leaves no entry
    for (const r of rejected) expect(fansEntries.some((e) => e.id === r.id)).toBe(false);
    expect(await waitingFans()).toBe(37);
    await assertConsistent();

    // the star deletes 2 confirmed friends: 2 waiting ones move into the freed seats
    const confirmed = (await star.friends()).filter((f) => f.status === "confirmed");
    await star.remove(confirmed[0].id);
    await star.remove(confirmed[1].id);
    const after = await star.check();
    expect(after.requests.filter((r) => r.seated && !seated.some((s) => s.id === r.id))).toHaveLength(2);
    expect(after.requests.filter((r) => !r.seated)).toHaveLength(35);
    expect(await star.friends()).toHaveLength(MAX_FRIENDS);
    expect(await waitingFans()).toBe(35);
    await assertConsistent();

    // everyone who still waits gives up: the star's waiting list empties
    const stillWaiting = new Set(after.requests.filter((r) => !r.seated).map((r) => r.id));
    for (const fan of fans) {
      for (const entry of await fan.friends()) if (stillWaiting.has(entry.id)) await fan.remove(entry.id);
    }
    expect((await star.check()).requests.filter((r) => !r.seated)).toEqual([]);
    expect(await star.friends()).toHaveLength(MAX_FRIENDS);

    // what is left: 5 confirmed + 2 pending seats for the star (a rejection leaves nothing behind)
    const summary = await assertConsistent();
    expect(summary.requests).toBe(7); // 5 accepted + 2 pending
  });
});

// ------------------------------------------------------------------ randomised stress

/** Small seeded random generator, so a failing run can be replayed. */
function mulberry32(seed: number) {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** STRESS_SEEDS=1,2,3,...,50 npm test  runs many more random sequences. */
const SEEDS = (process.env.STRESS_SEEDS ?? "1,2,3,4").split(",").map(Number);

describe("randomised stress: 60 people, 500 mixed actions (incl. messages)", () => {
  it.each(SEEDS)("seed %i keeps every rule true", async (seed) => {
    const random = mulberry32(seed);
    const pick = <T>(list: T[]) => list[Math.floor(random() * list.length)];
    const tally = { add: 0, full: 0, check: 0, confirm: 0, reject: 0, remove: 0, message: 0, read: 0 };
    const addedBefore = new Set<string>(); // nobody adds the same person twice

    for (let step = 1; step <= 500; step++) {
      const actor = pick(pool);
      const roll = random();

      if (roll < 0.32) {
        const target = pick(pool.filter((p) => p !== actor));
        const pair = `${actor.p.n}>${target.p.n}`;
        if (addedBefore.has(pair)) continue;
        const res = await actor.addRaw(target.p, pick(VIAS));
        expect([201, 409], `add ${pair}: ${res.status} ${JSON.stringify(res.body)}`).toContain(res.status);
        if (res.status === 201) { addedBefore.add(pair); tally.add++; } else tally.full++;
      } else if (roll < 0.52) {
        await actor.check();
        tally.check++;
      } else if (roll < 0.62) {
        const seated = (await actor.check()).requests.filter((r) => r.seated);
        if (!seated.length) continue;
        const res = await actor.confirm(pick(seated).id);
        expect(res.status, `confirm: ${JSON.stringify(res.body)}`).toBe(200);
        tally.confirm++;
      } else if (roll < 0.67) {
        const requests = (await actor.check()).requests;
        if (!requests.length) continue;
        const res = await actor.reject(pick(requests).id);
        expect(res.status, `reject: ${JSON.stringify(res.body)}`).toBe(200);
        tally.reject++;
      } else if (roll < 0.75) {
        const friends = await actor.friends();
        if (!friends.length) continue;
        const res = await actor.remove(pick(friends).id);
        expect(res.status).toBe(204);
        tally.remove++;
      } else {
        const confirmed = (await actor.friends()).filter((f) => f.status === "confirmed");
        if (!confirmed.length) continue;
        const friend = pick(confirmed);
        if (roll < 0.93) {
          const res = await actor.send(friend.id, `message ${step} from ${actor.p.n}`);
          expect(res.status, `send: ${JSON.stringify(res.body)}`).toBe(201);
          tally.message++;
        } else {
          expect((await actor.feed(friend.id)).status).toBe(200);
          expect((await actor.markFeedRead(friend.id)).status).toBe(200);
          tally.read++;
        }
      }

      if (step % 50 === 0) await assertConsistent();
    }

    // settle: everybody checks twice (waiting lists get their seats), then the rules must still hold
    await everyone((user) => user.check());
    await everyone((user) => user.check());
    const summary = await assertConsistent();
    for (const [circle, count] of summary.perCircle) expect(count, circle).toBeLessThanOrEqual(MAX_FRIENDS);

    // the run really exercised every kind of action
    expect(tally.add).toBeGreaterThan(60);
    expect(tally.check).toBeGreaterThan(40);
    expect(tally.confirm).toBeGreaterThan(4);
    expect(tally.reject).toBeGreaterThan(2);
    expect(tally.remove).toBeGreaterThan(8);
    expect(tally.message).toBeGreaterThan(10);
    console.log(`seed ${seed}:`, tally, `entries=${summary.entries} requests=${summary.requests} confirmed=${summary.confirmed}`);
  });
});
