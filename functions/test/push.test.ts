import { getFirestore } from "firebase-admin/firestore";
import { beforeEach, describe, expect, it } from "vitest";
import { User, assertConsistent, connect, person, seedPool } from "./helpers";
import { deadPushTokens, pushBreaks, sentPushes } from "./setup";

/** Push: devices register, and a message / request / answer / removal reaches the other person's devices. */
let pool: User[];
let u: (n: number) => User;

const token = (n: number, device = "a") => `token-${String(n).padStart(2, "0")}-${device}`.padEnd(30, "x");

beforeEach(async () => {
  pool = await seedPool();
  u = (n) => pool[n];
  sentPushes.length = 0;
  deadPushTokens.clear();
  pushBreaks.on = false;
});

const register = (user: User, t: string) => user.raw("post", "/push/devices", { token: t });
const unregister = (user: User, t: string) => user.raw("delete", "/push/devices", { token: t });
const devices = async (uid: string) => (await getFirestore().collection("user-account").doc(uid).collection("push-device").get()).docs.map((d) => d.data().token);
const lastPush = () => sentPushes[sentPushes.length - 1];

describe("devices", () => {
  it("a device registers, once (registering again changes nothing), and can be removed", async () => {
    await register(u(1), token(1)).expect(204);
    await register(u(1), token(1)).expect(204);
    expect(await devices("uid01")).toEqual([token(1)]);
    await unregister(u(1), token(1)).expect(204);
    expect(await devices("uid01")).toEqual([]);
  });

  it("refuses a missing or silly token", async () => {
    await u(1).raw("post", "/push/devices", {}).expect(400);
    await register(u(1), "short").expect(400);
    await u(1).raw("delete", "/push/devices", {}).expect(400);
  });

  it("a token belongs to one account: a new login on the same phone takes it over", async () => {
    await register(u(1), token(1)).expect(204);
    await register(u(2), token(1)).expect(204);
    expect(await devices("uid01")).toEqual([]);
    expect(await devices("uid02")).toEqual([token(1)]);
  });

  it("several devices per person", async () => {
    await register(u(1), token(1, "phone")).expect(204);
    await register(u(1), token(1, "laptop")).expect(204);
    expect((await devices("uid01")).sort()).toEqual([token(1, "laptop"), token(1, "phone")].sort());
  });

  it("needs a login", async () => {
    const request = (await import("supertest")).default;
    const { app } = await import("./helpers");
    await request(app).post("/api/push/devices").send({ token: token(1) }).expect(401);
  });
});

describe("what is pushed", () => {
  it("a message goes to the receiver's devices, with the event id, the sender and the page; not to the sender", async () => {
    const id = await connect(u(0), u(1));
    await register(u(1), token(1, "phone"));
    await register(u(1), token(1, "laptop"));
    await register(u(0), token(0));
    sentPushes.length = 0;

    const message = (await u(0).send(id, "Are you coming tonight?").expect(201)).body;
    expect(sentPushes).toHaveLength(1);
    expect(sentPushes[0].tokens.sort()).toEqual([token(1, "laptop"), token(1, "phone")].sort());
    expect(sentPushes[0].data).toEqual({ id: `message-${message.id}`, title: "Person 00", body: "Are you coming tonight?", url: `/friends/${id}` });
  });

  it("a long message is cut", async () => {
    const id = await connect(u(0), u(1));
    await register(u(1), token(1));
    await u(0).send(id, "x".repeat(500)).expect(201);
    expect(lastPush().data.body.length).toBeLessThanOrEqual(120);
  });

  it("nobody with a device: nothing is sent", async () => {
    const id = await connect(u(0), u(1));
    await u(0).send(id, "hello").expect(201);
    expect(sentPushes).toEqual([]);
  });

  it("a friend request goes to the devices of the person who has an account, with the message", async () => {
    await register(u(1), token(1));
    const entry = (await u(0).raw("post", "/circles/default/friends", { name: "One", email: person(1).email, message: "Be my friend!" }).expect(201)).body;
    expect(sentPushes).toHaveLength(1);
    expect(sentPushes[0].data).toEqual({ id: `request-${entry.id}`, title: "Person 00 wants to be your friend", body: "Be my friend!", url: "/" });
  });

  it("a request to somebody without an account sends nothing", async () => {
    await u(0).add(person(70));
    expect(sentPushes).toEqual([]);
  });

  it("confirming and rejecting are pushed to the requester, with their own ids", async () => {
    await register(u(0), token(0));
    const a = await u(0).add(u(1).p);
    const b = await u(0).add(u(2).p);
    sentPushes.length = 0;
    await u(1).check();
    await u(1).confirm(a.id).expect(200);
    expect(lastPush().tokens).toEqual([token(0)]);
    expect(lastPush().data).toMatchObject({ id: `answer-${a.id}-confirmed`, title: "Person 01 accepted your friend request", url: "/friends" });

    await u(2).check();
    await u(2).reject(b.id).expect(200);
    expect(lastPush().data).toMatchObject({ id: `answer-${b.id}-rejected`, title: "Person 02 rejected your friend request" });
  });

  it("confirming with no free seat pushes nothing (nothing changed)", async () => {
    await register(u(0), token(0));
    const entry = await u(0).add(u(1).p);
    const { fillCircle } = await import("./helpers");
    await fillCircle(u(1)); // 1 has no free seat
    await u(1).check();
    sentPushes.length = 0;
    const res = await u(1).confirm(entry.id);
    expect(res.body.result).toBe("no-seats");
    expect(sentPushes).toEqual([]);
  });

  it("ending a confirmed friendship is pushed to the other person; a pending one is not", async () => {
    const id = await connect(u(0), u(1));
    await register(u(1), token(1));
    await u(0).remove(id).expect(204);
    expect(lastPush().data).toMatchObject({ id: `removed-${id}`, title: "Person 00 removed the friendship", url: "/friends" });

    sentPushes.length = 0;
    const pending = await u(0).add(u(2).p);
    await register(u(2), token(2));
    sentPushes.length = 0;
    await u(0).remove(pending.id).expect(204);
    expect(sentPushes).toEqual([]);
  });
});

describe("when sending goes wrong", () => {
  it("a token that is no longer registered is removed", async () => {
    const id = await connect(u(0), u(1));
    await register(u(1), token(1, "old"));
    await register(u(1), token(1, "new"));
    deadPushTokens.add(token(1, "old"));
    await u(0).send(id, "hello").expect(201);
    expect(await devices("uid01")).toEqual([token(1, "new")]);
  });

  it("a push that fails never fails the request", async () => {
    const id = await connect(u(0), u(1));
    await register(u(1), token(1));
    pushBreaks.on = true;
    await u(0).send(id, "hello").expect(201);
    await u(0).add(u(2).p);
    await assertConsistent();
  });
});

describe("deleting an account", () => {
  it("removes its devices, and its friends hear nothing about a push for it", async () => {
    await register(u(1), token(1));
    await u(1).raw("delete", "/users/me", { confirm: "DELETE" }).expect(204);
    expect(await devices("uid01")).toEqual([]);
    expect((await getFirestore().collectionGroup("push-device").get()).docs).toEqual([]);
  });
});
