import { getFirestore, Timestamp } from "firebase-admin/firestore";
import { beforeEach, describe, expect, it } from "vitest";
import { User, connect, seedPool } from "./helpers";

/** The dot on a friend: active (screen on), passive (hidden / off), offline (signed out or silent). */
let pool: User[];
let u: (n: number) => User;
beforeEach(async () => {
  pool = await seedPool();
  u = (n) => pool[n];
});

const report = (user: User, state: string) => user.call("put", "/profile/presence", { state });
const seenBy = async (viewer: User, id: string) => (await viewer.friends()).find((f) => f.id === id)!.presence;

describe("presence", () => {
  it("offline until the app reports, then active or passive, then offline when signed out", async () => {
    const id = await connect(u(0), u(1));
    expect(await seenBy(u(0), id)).toBe("offline");
    await report(u(1), "active").expect(200);
    expect(await seenBy(u(0), id)).toBe("active");
    await report(u(1), "passive").expect(200);
    expect(await seenBy(u(0), id)).toBe("passive");
    await report(u(1), "offline").expect(200);
    expect(await seenBy(u(0), id)).toBe("offline");
  });

  it("an app that stops reporting counts as offline", async () => {
    const id = await connect(u(0), u(1));
    await report(u(1), "active").expect(200);
    await getFirestore().collection("user-account").doc(u(1).p.uid).update({ lastSeenAt: Timestamp.fromMillis(Date.now() - 10 * 60_000) });
    expect(await seenBy(u(0), id)).toBe("offline");
  });

  it("only confirmed friends see it", async () => {
    const entry = await u(0).add(u(1).p);
    await report(u(1), "active").expect(200);
    expect((await u(0).friends()).find((f) => f.id === entry.id)!.presence).toBe("offline"); // still pending
  });

  it("refuses something that is not a state", async () => {
    await report(u(0), "busy").expect(400);
    await u(0).call("put", "/profile/presence", {}).expect(400);
  });

  it("a change tells the friends' apps (the friendship they listen to is touched), a repeat does not", async () => {
    const id = await connect(u(0), u(1));
    const touched = async () => (await getFirestore().collection("user-account").doc(u(0).p.uid).collection("friend-circle").doc("default").collection("friends").doc(id).get()).data()?.moodChangedAt;
    expect(await touched()).toBeUndefined();
    await report(u(1), "active").expect(200);
    const first = await touched();
    expect(first).toBeTruthy();
    await new Promise((r) => setTimeout(r, 10));
    await report(u(1), "active").expect(200);
    expect((await touched()).toMillis()).toBe(first.toMillis());
  });
});
