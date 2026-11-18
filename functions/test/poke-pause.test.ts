import { getFirestore } from "firebase-admin/firestore";
import { beforeEach, describe, expect, it } from "vitest";
import { MOOD_SILENT } from "../src/models";
import { User, connect, seedPool } from "./helpers";

/** Pause pokes: a limited time in which my pokes do not ring (docs/design/poke-alarm.md). */
let pool: User[];
beforeEach(async () => {
  pool = await seedPool();
});

const messages = async (uid: string) => (await getFirestore().collection("user-account").doc(uid).collection("messages").get()).docs.map((d) => ({ id: d.id, ...d.data() }) as Record<string, unknown>);
const pause = (user: User, minutes: number | null) => user.raw("put", "/profile/poke-pause", { minutes });
const friendOf = async (user: User, id: string) => (await user.friends()).find((f) => f.id === id)!;

describe("pause pokes", () => {
  it("is off at first; set for a limited time, and ended", async () => {
    expect((await pool[0].raw("get", "/profile/poke-pause").expect(200)).body).toEqual({ until: null });
    const set = (await pause(pool[0], 60).expect(200)).body;
    const wait = new Date(set.until).getTime() - Date.now();
    expect(wait).toBeGreaterThan(59 * 60_000);
    expect(wait).toBeLessThanOrEqual(60 * 60_000);
    expect((await pool[0].raw("get", "/profile/poke-pause").expect(200)).body.until).toBe(set.until);
    expect((await pause(pool[0], null).expect(200)).body).toEqual({ until: null });
  });

  it("is never longer than 24 hours, and only whole minutes", async () => {
    await pause(pool[0], 1440).expect(200);
    await pause(pool[0], 1441).expect(400);
    await pause(pool[0], 0).expect(400);
    await pause(pool[0], 1.5).expect(400);
    await pool[0].raw("put", "/profile/poke-pause", {}).expect(400);
  });

  it("a poke to a person who paused arrives as an ordinary message, not as a poke", async () => {
    const id = await connect(pool[0], pool[1]);
    await pause(pool[1], 60).expect(200);
    expect((await pool[0].raw("post", `/circles/default/friends/${id}/messages`, { text: "hey", poke: true })).status).toBe(201);
    const stored = (await messages(pool[1].p.uid)).filter((m) => m.connectionId === id);
    expect(stored).toHaveLength(1);
    expect(stored[0].poke).toBeUndefined();
    // after the pause is ended a poke is a poke again
    await pause(pool[1], null).expect(200);
    expect((await pool[0].raw("post", `/circles/default/friends/${id}/messages`, { text: "hey again", poke: true })).status).toBe(201);
    expect((await messages(pool[1].p.uid)).filter((m) => m.poke === true)).toHaveLength(1);
  });

  it("friends see the mood Silent while it lasts, and the mood comes back after", async () => {
    const id = await connect(pool[0], pool[1]);
    await pool[1].raw("put", "/profile/mood", { mood: 2 }).expect(200);
    expect((await friendOf(pool[0], id)).mood).toBe(2);
    await pause(pool[1], 240).expect(200);
    expect((await friendOf(pool[0], id)).mood).toBe(MOOD_SILENT);
    await pause(pool[1], null).expect(200);
    expect((await friendOf(pool[0], id)).mood).toBe(2); // the person's own mood was never changed
  });

  it("a pause that is over counts as none", async () => {
    const id = await connect(pool[0], pool[1]);
    await getFirestore().collection("user-account").doc(pool[1].p.uid).set({ pokePausedUntil: new Date(Date.now() - 1000) }, { merge: true });
    expect((await pool[1].raw("get", "/profile/poke-pause").expect(200)).body).toEqual({ until: null });
    expect((await friendOf(pool[0], id)).mood).not.toBe(MOOD_SILENT);
  });
});
