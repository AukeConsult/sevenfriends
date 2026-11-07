import { FieldValue, getFirestore } from "firebase-admin/firestore";
import { beforeEach, describe, expect, it } from "vitest";
import { User, connect, seedPool } from "./helpers";

/**
 * Everything happens in the default circle for now, but the stored data already says which circle each thing belongs to, so more circles
 * can come without changing it (docs/design/circles.md).
 */
let pool: User[];
beforeEach(async () => {
  pool = await seedPool();
});

const messagesOf = async (uid: string) => (await getFirestore().collection("user-account").doc(uid).collection("messages").get()).docs.map((d) => d.data());

describe("the circle is written down", () => {
  it("on every friend entry, on both sides", async () => {
    const id = await connect(pool[0], pool[1]);
    for (const user of [pool[0], pool[1]]) {
      const entry = (await user.friends()).find((f) => f.id === id)!;
      expect(entry.circleId).toBe("default");
    }
    const stored = (await getFirestore().collectionGroup("friends").get()).docs.filter((d) => d.id === id);
    expect(stored).toHaveLength(2);
    for (const d of stored) expect(d.data().circleId).toBe("default");
  });

  it("on both copies of every message, and in the list of unread ones", async () => {
    const id = await connect(pool[0], pool[1]);
    await pool[0].send(id, "Hello").expect(201);
    for (const user of [pool[0], pool[1]]) {
      const copies = await messagesOf(user.p.uid);
      expect(copies).toHaveLength(1);
      expect(copies[0].circleId).toBe("default");
    }
    const unread = (await pool[1].check()).messages as { circleId: string }[];
    expect(unread).toHaveLength(1);
    expect(unread[0].circleId).toBe("default");
  });

  it("older data without it counts as the default circle", async () => {
    const id = await connect(pool[0], pool[1]);
    await pool[0].send(id, "Old message").expect(201);
    for (const d of (await getFirestore().collectionGroup("friends").get()).docs) await d.ref.update({ circleId: FieldValue.delete() });
    for (const d of (await getFirestore().collectionGroup("messages").get()).docs) await d.ref.update({ circleId: FieldValue.delete() });
    expect((await pool[0].friends())[0].circleId).toBe("default");
    expect(((await pool[1].check()).messages as { circleId: string }[])[0].circleId).toBe("default");
  });
});

describe("the choices of a circle (theme, text size, order, ...)", () => {
  const settings = async (user: User) => (await user.raw("get", "/circles").expect(200)).body.circles[0].settings;
  const save = (user: User, body: object) => user.raw("put", "/circles/default/settings", body);

  it("start as none chosen, and are kept on the circle", async () => {
    expect(await settings(pool[0])).toEqual({});
    await save(pool[0], { theme: "ocean", textSize: "big", quickMessages: ["  On my way  ", "", "Call me"] }).expect(200);
    expect(await settings(pool[0])).toEqual({ theme: "ocean", textSize: "big", quickMessages: ["On my way", "Call me"] });
    expect(await settings(pool[1])).toEqual({}); // only mine
  });

  it("are stored on the circle's own document, not on the account", async () => {
    await save(pool[0], { theme: "dark" }).expect(200);
    const db = getFirestore();
    const circle = (await db.collection("user-account").doc(pool[0].p.uid).collection("friend-circle").doc("default").get()).data();
    expect(circle?.settings).toEqual({ theme: "dark" });
    expect((await db.collection("user-account").doc(pool[0].p.uid).get()).data()?.settings).toBeUndefined();
    expect((await pool[0].raw("get", "/profile")).body.settings).toBeUndefined();
  });

  it("change only what the request carries, and saving the profile leaves them", async () => {
    await save(pool[0], { theme: "dark", sleepList: false }).expect(200);
    await save(pool[0], { chatOrder: "newest" }).expect(200);
    await pool[0].raw("put", "/profile", { name: "Alice" }).expect(200);
    expect(await settings(pool[0])).toEqual({ theme: "dark", sleepList: false, chatOrder: "newest" });
  });

  it.each([
    ["an unknown theme", { theme: "neon" }],
    ["an unknown text size", { textSize: "gigantic" }],
    ["a wrong order", { chatOrder: "random" }],
    ["a switch that is not true or false", { enterSends: "yes" }],
    ["an unknown setting", { favouriteFood: "pizza" }],
    ["more than 10 quick messages", { quickMessages: Array.from({ length: 11 }, (_, i) => `m${i}`) }],
    ["a quick message longer than 200 characters", { quickMessages: ["x".repeat(201)] }],
  ])("refuse %s, and keep what was there", async (_label, bad) => {
    await save(pool[0], { theme: "forest" }).expect(200);
    expect((await save(pool[0], { textSize: "small", ...bad })).status).toBe(400);
    expect(await settings(pool[0])).toEqual({ theme: "forest" }); // nothing of the refused request was saved
  });

  it("belong to a circle that exists: another circle id is not found", async () => {
    expect((await save(pool[0], { theme: "dark" }).expect(200)).status).toBe(200);
    expect((await pool[0].raw("put", "/circles/nothing/settings", { theme: "dark" })).status).toBe(404);
  });
});

describe("settings that were still on the account move to the circle", () => {
  const account = (user: User) => getFirestore().collection("user-account").doc(user.p.uid);
  const circles = async (user: User) => (await user.raw("get", "/circles").expect(200)).body.circles;

  it("the old `settings` field is moved into the default circle and deleted from the account", async () => {
    await account(pool[0]).set({ settings: { theme: "dark", chatOrder: "newest", sleepList: false } }, { merge: true });
    expect((await circles(pool[0]))[0].settings).toEqual({ theme: "dark", chatOrder: "newest", sleepList: false });
    expect((await account(pool[0]).get()).data()?.settings).toBeUndefined();
    const circle = (await account(pool[0]).collection("friend-circle").doc("default").get()).data();
    expect(circle?.settings).toEqual({ theme: "dark", chatOrder: "newest", sleepList: false });
  });

  it("the even older `theme` and `textSize` fields are moved too", async () => {
    await account(pool[0]).set({ theme: "ocean", textSize: "big" }, { merge: true });
    expect((await circles(pool[0]))[0].settings).toEqual({ theme: "ocean", textSize: "big" });
    const data = (await account(pool[0]).get()).data();
    expect(data?.theme).toBeUndefined();
    expect(data?.textSize).toBeUndefined();
  });

  it("what the circle already has wins over the old value", async () => {
    await pool[0].raw("put", "/circles/default/settings", { theme: "forest" }).expect(200);
    await account(pool[0]).set({ settings: { theme: "dark", textSize: "small" } }, { merge: true });
    expect((await circles(pool[0]))[0].settings).toEqual({ theme: "forest", textSize: "small" });
    expect((await account(pool[0]).get()).data()?.settings).toBeUndefined();
  });

  it("old values that are not valid are dropped, and the fields are still deleted", async () => {
    await account(pool[0]).set({ settings: { theme: "neon", enterSends: "yes" }, textSize: "gigantic" }, { merge: true });
    expect((await circles(pool[0]))[0].settings).toEqual({});
    const data = (await account(pool[0]).get()).data();
    expect(data?.settings).toBeUndefined();
    expect(data?.textSize).toBeUndefined();
  });

  it("is safe to repeat, and leaves another person's account alone", async () => {
    await account(pool[0]).set({ settings: { theme: "rose" } }, { merge: true });
    await account(pool[1]).set({ settings: { theme: "dark" } }, { merge: true });
    await circles(pool[0]);
    await circles(pool[0]);
    expect((await circles(pool[0]))[0].settings).toEqual({ theme: "rose" });
    expect((await account(pool[1]).get()).data()?.settings).toEqual({ theme: "dark" }); // not read yet: still there
  });
});
