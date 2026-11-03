import { getFirestore, Timestamp } from "firebase-admin/firestore";
import { beforeEach, describe, expect, it } from "vitest";
import { User, connect, seedPool } from "./helpers";

/** What a confirmed friend shows on the Friends page: when you last spoke, and their country. */
let pool: User[];
let u: (n: number) => User;
beforeEach(async () => {
  pool = await seedPool();
  u = (n) => pool[n];
});

const friendOf = async (user: User, id: string) => (await user.friends()).find((f) => f.id === id)!;

describe("last spoken to", () => {
  it("never at first; a message in either direction sets it for both", async () => {
    const id = await connect(u(0), u(1));
    expect((await friendOf(u(0), id)).lastSpokenAt).toBeNull();
    expect((await friendOf(u(1), id)).lastSpokenAt).toBeNull();

    await u(0).send(id, "hello").expect(201);
    const a = (await friendOf(u(0), id)).lastSpokenAt;
    const b = (await friendOf(u(1), id)).lastSpokenAt;
    expect(a).toBeTruthy();
    expect(Math.abs(new Date(b!).getTime() - new Date(a!).getTime())).toBeLessThan(50); // the same moment (the test database stamps each write on its own)

    await new Promise((r) => setTimeout(r, 10));
    await u(1).send(id, "hi back").expect(201); // the other direction moves it on
    expect(new Date((await friendOf(u(0), id)).lastSpokenAt!).getTime()).toBeGreaterThan(new Date(a!).getTime());
  });

  it("each friend has their own", async () => {
    const one = await connect(u(0), u(1));
    const two = await connect(u(0), u(2));
    await u(0).send(one, "to one").expect(201);
    expect((await friendOf(u(0), two)).lastSpokenAt).toBeNull();
    expect((await friendOf(u(0), one)).lastSpokenAt).toBeTruthy();
  });

  it("a conversation from before it was remembered is found from its messages", async () => {
    const id = await connect(u(0), u(1));
    const db = getFirestore();
    const older = Timestamp.fromMillis(Date.now() - 3 * 24 * 3600 * 1000);
    const newer = Timestamp.fromMillis(Date.now() - 2 * 24 * 3600 * 1000);
    for (const [msg, time] of [["m1", older], ["m2", newer]] as const) {
      await db.collection("user-account").doc("uid00").collection("messages").doc(msg).set({ connectionId: id, fromUid: "uid01", toUid: "uid00", text: msg, time, read: true });
    }
    expect((await friendOf(u(0), id)).lastSpokenAt).toBe(newer.toDate().toISOString());
  });

  it("not for somebody who is not a friend yet", async () => {
    const entry = await u(0).add(u(1).p);
    expect((await friendOf(u(0), entry.id)).lastSpokenAt).toBeNull();
  });
});

describe("the friend's country", () => {
  it("a confirmed friend shows it, a waiting one does not", async () => {
    const id = await connect(u(0), u(1));
    await u(1).raw("put", "/profile", { country: "SE" }).expect(200);
    expect(await friendOf(u(0), id)).toMatchObject({ country: "SE" });
    await u(1).raw("put", "/profile", { country: null }).expect(200);
    expect(await friendOf(u(0), id)).toMatchObject({ country: null });

    const pending = await u(0).add(u(2).p);
    await u(2).raw("put", "/profile", { country: "NO" }).expect(200);
    expect(await friendOf(u(0), pending.id)).toMatchObject({ country: null });
  });
});

describe("adding a friend without a name", () => {
  it("is fine with an email or a phone number: that is shown instead", async () => {
    const byEmail = await u(0).call("post", "/circles/default/friends", { email: "nobody@nowhere.test" }).expect(201);
    expect(byEmail.body.name).toBe("nobody@nowhere.test");
    const byPhone = await u(0).call("post", "/circles/default/friends", { phone: "+4790012345" }).expect(201);
    expect(byPhone.body.name).toBe("+4790012345");
  });

  it("still needs an email or a phone number", async () => {
    await u(0).call("post", "/circles/default/friends", { name: "Only a name" }).expect(400);
    await u(0).call("post", "/circles/default/friends", {}).expect(400);
  });

  it("a confirmed friend added without a name is shown by their own name", async () => {
    const entry = (await u(0).call("post", "/circles/default/friends", { email: u(1).p.email }).expect(201)).body;
    expect(entry.name).toBe(u(1).p.email);
    await u(1).check();
    await u(1).confirm(entry.id).expect(200);
    expect((await friendOf(u(0), entry.id)).name).toBe(u(1).p.name);
  });

  it("a name that was typed is kept", async () => {
    const entry = (await u(0).call("post", "/circles/default/friends", { name: "My pal", email: u(1).p.email }).expect(201)).body;
    await u(1).check();
    await u(1).confirm(entry.id).expect(200);
    expect((await friendOf(u(0), entry.id)).name).toBe("My pal");
  });
});
