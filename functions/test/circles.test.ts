import { FieldValue, getFirestore } from "firebase-admin/firestore";
import { beforeEach, describe, expect, it } from "vitest";
import { User, connect, contactOf, seedPool } from "./helpers";

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

describe("more circles: one of each type, each with my own name, colour and mood", () => {
  const circles = async (user: User) => (await user.raw("get", "/circles").expect(200)).body.circles as { id: string; type: string; profile: { name: string | null; color: string | null; mood: number | null; moodMessage: string | null } }[];

  it("makes the circle of a type once, with my name and colour and no mood", async () => {
    await pool[0].raw("put", "/profile", { name: "Leif", color: "blue" }).expect(200);
    const made = await pool[0].raw("post", "/circles", { type: "work" }).expect(201);
    expect(made.body).toMatchObject({ id: "work", type: "work", name: "My work contacts", profile: { name: "Leif", color: "blue", mood: null, moodMessage: null } });
    await pool[0].raw("post", "/circles", { type: "work" }).expect(409);
    expect((await circles(pool[0])).map((c) => c.id).sort()).toEqual(["default", "work"]);
    expect((await circles(pool[1])).map((c) => c.id)).toEqual(["default"]); // only mine
  });

  it("refuses a type that does not exist", async () => {
    await pool[0].raw("post", "/circles", { type: "colleagues" }).expect(400);
    await pool[0].raw("post", "/circles", {}).expect(400);
  });

  it("keeps the profile of each circle apart", async () => {
    await pool[0].raw("put", "/profile", { name: "Leif" }).expect(200);
    await pool[0].raw("post", "/circles", { type: "family" }).expect(201);
    await pool[0].raw("put", "/circles/family/profile", { name: "Dad", color: "orange", mood: 2, moodMessage: "At home" }).expect(200);
    const all = await circles(pool[0]);
    expect(all.find((c) => c.id === "family")!.profile).toEqual({ name: "Dad", color: "orange", mood: 2, moodMessage: "At home", icon: null });
    expect(all.find((c) => c.id === "default")!.profile).toMatchObject({ name: "Leif", mood: null }); // the friends circle is not touched
  });

  it("the friends circle profile is the account profile", async () => {
    await pool[0].raw("put", "/circles/default/profile", { name: "Leif A", mood: 1 }).expect(200);
    expect((await pool[0].raw("get", "/profile").expect(200)).body).toMatchObject({ name: "Leif A", mood: 1 });
    expect((await circles(pool[0])).find((c) => c.id === "default")!.profile).toMatchObject({ name: "Leif A", mood: 1 });
  });

  it("refuses wrong values and saves nothing", async () => {
    await pool[0].raw("post", "/circles", { type: "buddies" }).expect(201);
    await pool[0].raw("put", "/circles/buddies/profile", { name: "", mood: 2 }).expect(400);
    await pool[0].raw("put", "/circles/buddies/profile", { mood: 9 }).expect(400);
    await pool[0].raw("put", "/circles/buddies/profile", { color: "plaid" }).expect(400);
    await pool[0].raw("put", "/circles/nothing/profile", { mood: 2 }).expect(404);
    expect((await circles(pool[0])).find((c) => c.id === "buddies")!.profile.mood).toBeNull();
  });
});

describe("a friend sees how I show in the circle we share", () => {
  /** pool[1]'s side of the friendship says that pool[0]'s side lives in the circle `circle` (what an invitation into that circle will write) */
  const livesIn = async (viewer: User, id: string, circle: string) =>
    getFirestore().collection("user-account").doc(viewer.p.uid).collection("friend-circle").doc("default").collection("friends").doc(id).update({ peerCircleId: circle });

  it("the mood and colour of that circle, not the ones of my account", async () => {
    const id = await connect(pool[0], pool[1]);
    await pool[0].raw("put", "/profile", { color: "blue" }).expect(200);
    await pool[0].raw("put", "/profile/mood", { mood: 1, moodMessage: "Friends mood" }).expect(200);
    await pool[0].raw("post", "/circles", { type: "work" }).expect(201);
    await pool[0].raw("put", "/circles/work/profile", { color: "purple", mood: 3, moodMessage: "In a meeting" }).expect(200);

    let seen = (await pool[1].friends()).find((f) => f.id === id)!;
    expect(seen).toMatchObject({ mood: 1, moodMessage: "Friends mood", color: "blue" }); // the friends circle: the account, as before

    await livesIn(pool[1], id, "work");
    seen = (await pool[1].friends()).find((f) => f.id === id)!;
    expect(seen).toMatchObject({ mood: 3, moodMessage: "In a meeting", color: "purple" });
  });

  it("a change in that circle makes the friend's copy of the friendship change, so their app reloads", async () => {
    const id = await connect(pool[0], pool[1]);
    await pool[0].raw("post", "/circles", { type: "work" }).expect(201);
    const copy = getFirestore().collection("user-account").doc(pool[0].p.uid).collection("friend-circle").doc("default").collection("friends").doc(id);
    await copy.update({ moodChangedAt: FieldValue.delete() }); // the touch goes to the peer entry: pool[1]'s copy
    const theirs = getFirestore().collection("user-account").doc(pool[1].p.uid).collection("friend-circle").doc("default").collection("friends").doc(id);
    await theirs.update({ moodChangedAt: FieldValue.delete() });
    await pool[0].raw("put", "/circles/default/profile", { mood: 2 }).expect(200);
    expect((await theirs.get()).data()?.moodChangedAt).toBeDefined();
  });
});

describe("the name of a friend who asked me", () => {
  it("is the name they have in that circle (not the one of their account), and follows when they change it", async () => {
    await pool[0].raw("put", "/profile", { name: "Alex" }).expect(200);
    await pool[0].raw("post", "/circles", { type: "work" }).expect(201);
    await pool[0].raw("put", "/circles/work/profile", { name: "Alex Berg" }).expect(200);
    await pool[0].raw("post", "/circles/work/friends", contactOf(pool[1].p, "email")).expect(201);
    await pool[1].raw("post", "/notifications/check").set("X-Circle", "work").expect(200);

    const list = async () => (await pool[1].raw("get", "/circles/work/friends").expect(200)).body.friends as { name: string }[];
    expect((await list()).map((f) => f.name)).toEqual(["Alex Berg"]);

    await pool[0].raw("put", "/circles/work/profile", { name: "Alex B" }).expect(200);
    expect((await list()).map((f) => f.name)).toEqual(["Alex B"]);
  });
});

describe("the profile page is the profile of the circle the app is in", () => {
  it("name, colour, icon and mood are kept per circle (the X-Circle header says which), the rest is shared", async () => {
    await pool[0].raw("put", "/profile", { name: "Alex", color: "blue", icon: 2 }).expect(200);
    await pool[0].raw("put", "/profile/mood", { mood: 1, moodMessage: "Friends mood" }).expect(200);
    await pool[0].raw("post", "/circles", { type: "work" }).expect(201);

    const inWork = async (method: "get" | "put", path: string, body?: object) => pool[0].raw(method, path, body).set("X-Circle", "work");
    await (await inWork("put", "/profile", { name: "Alex Berg", color: "purple", icon: 5 })).body;
    await inWork("put", "/profile/mood", { mood: 3, moodMessage: "In a meeting" }).then((r) => expect(r.status).toBe(200));

    const work = (await inWork("get", "/profile")).body;
    expect(work).toMatchObject({ name: "Alex Berg", color: "purple", icon: 5, mood: 3, moodMessage: "In a meeting" });
    const friends = (await pool[0].raw("get", "/profile").expect(200)).body; // no header: the first circle, as before
    expect(friends).toMatchObject({ name: "Alex", color: "blue", icon: 2, mood: 1, moodMessage: "Friends mood" });
  });
});
