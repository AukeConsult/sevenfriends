import { getFirestore } from "firebase-admin/firestore";
import { beforeEach, describe, expect, it } from "vitest";
import { User, connect, seedPool } from "./helpers";

/** A mood (one of 4 icons) and a short mood message on the profile, which CONFIRMED friends see. */
let pool: User[];
let u: (n: number) => User;
beforeEach(async () => {
  pool = await seedPool();
  u = (n) => pool[n];
});

const profile = async (user: User) => (await user.raw("get", "/profile").expect(200)).body;
const put = (user: User, body: object) => user.raw("put", "/profile/mood", body);
const friendOf = async (user: User, id: string) => (await user.friends()).find((f) => f.id === id)!;
const entry = async (uid: string, id: string) => (await getFirestore().collection("user-account").doc(uid).collection("friend-circle").doc("default").collection("friends").doc(id).get()).data()!;

describe("my mood", () => {
  it("none at first; set, changed, kept when left out, and removed", async () => {
    expect(await profile(u(0))).toMatchObject({ mood: null, moodMessage: null });
    expect((await put(u(0), { mood: 2, moodMessage: "  Out for a walk  " }).expect(200)).body).toMatchObject({ mood: 2, moodMessage: "Out for a walk" });
    expect((await put(u(0), {}).expect(200)).body).toMatchObject({ mood: 2, moodMessage: "Out for a walk" }); // left out = unchanged
    expect((await put(u(0), { mood: 4 }).expect(200)).body).toMatchObject({ mood: 4, moodMessage: "Out for a walk" });
    expect((await put(u(0), { moodMessage: "" }).expect(200)).body).toMatchObject({ mood: 4, moodMessage: null });
    expect((await put(u(0), { mood: null }).expect(200)).body).toMatchObject({ mood: null, moodMessage: null });
  });

  it("the message can be 60 characters", async () => {
    await put(u(0), { moodMessage: "x".repeat(60) }).expect(200);
    expect((await profile(u(0))).moodMessage).toHaveLength(60);
  });

  it.each([
    ["a mood of 0", { mood: 0 }],
    ["a mood of 5", { mood: 5 }],
    ["a mood with decimals", { mood: 2.5 }],
    ["a mood as text", { mood: "2" }],
    ["a message over 60 characters", { moodMessage: "x".repeat(61) }],
    ["a message that is a number", { moodMessage: 7 }],
  ])("refuses %s, and keeps the old mood", async (_label, bad) => {
    await put(u(0), { mood: 1, moodMessage: "Fine" }).expect(200);
    await put(u(0), bad).expect(400);
    expect(await profile(u(0))).toMatchObject({ mood: 1, moodMessage: "Fine" });
  });
});

describe("the mood does not touch the rest of the profile (the Home page saves it alone)", () => {
  it("phone, name, country and icon stay as they are", async () => {
    await u(0).raw("put", "/profile", { name: "Kept Name", phone: u(0).p.phone, country: "NO", icon: 4 }).expect(200);
    await put(u(0), { mood: 1, moodMessage: "Hello" }).expect(200);
    expect(await profile(u(0))).toMatchObject({ name: "Kept Name", phone: u(0).p.phone, country: "NO", icon: 4, mood: 1 });
  });

  it("saving the rest of the profile does not touch the mood", async () => {
    await put(u(0), { mood: 3, moodMessage: "Tired" }).expect(200);
    await u(0).raw("put", "/profile", { name: "Another Name", phone: "+4790000002" }).expect(200);
    expect(await profile(u(0))).toMatchObject({ mood: 3, moodMessage: "Tired", name: "Another Name" });
  });
});

describe("who sees it", () => {
  it("a confirmed friend sees the mood and the message", async () => {
    const id = await connect(u(0), u(1));
    await put(u(1), { mood: 3, moodMessage: "Sleepy today" }).expect(200);
    expect(await friendOf(u(0), id)).toMatchObject({ mood: 3, moodMessage: "Sleepy today" });
    await put(u(1), { mood: null, moodMessage: null }).expect(200);
    expect(await friendOf(u(0), id)).toMatchObject({ mood: null, moodMessage: null });
  });

  it("both see each other's", async () => {
    const id = await connect(u(0), u(1));
    await put(u(0), { mood: 1, moodMessage: "On top of the world" }).expect(200);
    await put(u(1), { mood: 4 }).expect(200);
    expect(await friendOf(u(1), id)).toMatchObject({ mood: 1, moodMessage: "On top of the world" });
    expect(await friendOf(u(0), id)).toMatchObject({ mood: 4, moodMessage: null });
  });

  it("not somebody whose request is still waiting, and not a stranger", async () => {
    const pending = await u(0).add(u(1).p); // 1 has not confirmed
    await put(u(1), { mood: 1, moodMessage: "Hello" }).expect(200);
    expect(await friendOf(u(0), pending.id)).toMatchObject({ mood: null, moodMessage: null });
    const id = await connect(u(2), u(3));
    await put(u(3), { mood: 2 }).expect(200);
    expect((await u(4).friends()).length).toBe(0);
    expect(await friendOf(u(2), id)).toMatchObject({ mood: 2 });
  });

  it("a change tells the friends' apps: their copy of the friendship is touched (they listen to it), only when it really changed", async () => {
    const id = await connect(u(0), u(1));
    expect((await entry("uid00", id)).moodChangedAt).toBeUndefined();
    await put(u(1), { mood: 2 }).expect(200);
    const first = (await entry("uid00", id)).moodChangedAt;
    expect(first).toBeTruthy();
    await new Promise((r) => setTimeout(r, 5));
    await put(u(1), { mood: 2 }).expect(200); // the same again
    expect((await entry("uid00", id)).moodChangedAt.toMillis()).toBe(first.toMillis());
    await put(u(1), { moodMessage: "New" }).expect(200);
    expect((await entry("uid00", id)).moodChangedAt.toMillis()).toBeGreaterThanOrEqual(first.toMillis());
  });

  it("an erased friend leaves nothing behind", async () => {
    await put(u(0), { mood: 1, moodMessage: "Bye" }).expect(200);
    await u(0).raw("delete", "/users/me", { confirm: "DELETE" }).expect(204);
    expect((await getFirestore().collection("user-account").doc("uid00").get()).exists).toBe(false);
  });
});
