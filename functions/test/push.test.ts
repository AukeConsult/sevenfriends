import { getFirestore } from "firebase-admin/firestore";
import { beforeEach, describe, expect, it } from "vitest";
import { User, assertConsistent, connect, person, seedPool, server } from "./helpers";
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
    await request(server()).post("/api/push/devices").send({ token: token(1) }).expect(401);
  });
});

describe("which devices are woken for a circle", () => {
  const registerAs = (user: User, t: string, app?: string) => user.raw("post", "/push/devices", { token: t, ...(app ? { app } : {}) }).expect(204);
  const testIn = (user: User, circle: string) => user.raw("post", "/push/test").set("X-Circle", circle).expect(200);

  it("the app of every circle (the default) gets a push about any circle, and the push says which one", async () => {
    await registerAs(u(1), token(1));
    expect((await testIn(u(1), "work")).body).toEqual({ devices: 1, delivered: 1 });
    expect(lastPush().data).toMatchObject({ circle: "work", url: "/sound-and-notifications?incircle=work" });
    expect((await testIn(u(1), "family")).body).toEqual({ devices: 1, delivered: 1 });
    expect(lastPush().data).toMatchObject({ circle: "family" });
  });

  it("an app made for one circle gets only that circle", async () => {
    await registerAs(u(1), token(1), "buddies");
    expect((await testIn(u(1), "buddies")).body).toEqual({ devices: 1, delivered: 1 });
    expect((await testIn(u(1), "work")).body).toEqual({ devices: 0, delivered: 0 });
    expect((await testIn(u(1), "default")).body).toEqual({ devices: 0, delivered: 0 });
  });

  it("with both, the app made for the circle gets it and the other app does not (no double ring); other circles go to the app of every circle", async () => {
    await registerAs(u(1), token(1, "all"));
    await registerAs(u(1), token(1, "work"), "work");
    await testIn(u(1), "work");
    expect(lastPush().tokens).toEqual([token(1, "work")]);
    await testIn(u(1), "family");
    expect(lastPush().tokens).toEqual([token(1, "all")]);
  });

  it("a device from before there was a choice counts as the app of every circle, and an unknown app too", async () => {
    await getFirestore().collection("user-account").doc("uid01").collection("push-device").doc("old").set({ token: token(1, "old"), circleId: "buddies" });
    await registerAs(u(1), token(1, "odd"), "something-else");
    await testIn(u(1), "work");
    expect(lastPush().tokens.sort()).toEqual([token(1, "odd"), token(1, "old")].sort());
  });

  it("registering again as another app changes the device (the circle of an old registration is dropped)", async () => {
    await registerAs(u(1), token(1));
    await registerAs(u(1), token(1), "family");
    const docs = (await getFirestore().collection("user-account").doc("uid01").collection("push-device").get()).docs.map((d) => d.data());
    expect(docs).toHaveLength(1);
    expect(docs[0].app).toBe("family");
    expect("circleId" in docs[0]).toBe(false);
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
    expect(sentPushes[0].data).toEqual({ id: `message-${message.id}`, title: "Person 00", body: "Are you coming tonight?", url: `/friends/${id}?incircle=friends`, circle: "friends" });
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
    expect(sentPushes[0].data).toEqual({ id: `request-${entry.id}`, title: "Person 00 wants to be your friend", body: "Be my friend!", url: "/?incircle=friends", circle: "friends" });
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
    expect(lastPush().data).toMatchObject({ id: `answer-${a.id}-confirmed`, title: "Person 01 accepted your friend request", url: "/?incircle=friends" });

    await u(2).check();
    await u(2).reject(b.id).expect(200);
    expect(lastPush().data).toMatchObject({ id: `answer-${b.id}-rejected`, title: "Person 02 rejected your friend request" });
  });

  it("confirming with no free seat adds the friend on the sleep list, and the answer is pushed", async () => {
    await register(u(0), token(0));
    const entry = await u(0).add(u(1).p);
    const { fillCircle } = await import("./helpers");
    await fillCircle(u(1)); // 1 has no free seat
    await u(1).check();
    sentPushes.length = 0;
    const res = await u(1).confirm(entry.id);
    expect(res.body.result).toBe("confirmed");
    expect(lastPush().data).toMatchObject({ id: `answer-${entry.id}-confirmed` });
    const mine = (await u(1).friends()).find((f) => f.id === entry.id);
    expect(mine).toMatchObject({ status: "confirmed", asleep: true, seat: null });
  });

  it("ending a confirmed friendship is pushed to the other person; a pending one is not", async () => {
    const id = await connect(u(0), u(1));
    await register(u(1), token(1));
    await u(0).remove(id).expect(204);
    expect(lastPush().data).toMatchObject({ id: `removed-${id}`, title: "Person 00 removed the friendship", url: "/friends?incircle=friends" });

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

describe("what the receiver chose", () => {
  const notices = (user: User, changes: object) =>
    user.raw("put", "/preferences/notices", { message: true, request: true, answer: true, removed: true, hideText: false, ...changes }).expect(200);
  const sounds = (user: User, changes: object) =>
    user.raw("put", "/preferences/sounds", { message: "ding", request: "ding", answer: "ding", volume: 50, ...changes }).expect(200);

  it("a kind that is switched off is not pushed, the others are", async () => {
    const id = await connect(u(0), u(1));
    await register(u(1), token(1));
    await notices(u(1), { message: false });
    sentPushes.length = 0;
    await u(0).send(id, "hello").expect(201);
    expect(sentPushes).toEqual([]);
    await notices(u(1), { message: true, request: false });
    await u(0).send(id, "hello again").expect(201);
    expect(sentPushes).toHaveLength(1);
  });

  it("hide the text: the sender stays, the text of a message does not go out", async () => {
    const id = await connect(u(0), u(1));
    await register(u(1), token(1));
    await notices(u(1), { hideText: true });
    sentPushes.length = 0;
    await u(0).send(id, "a secret").expect(201);
    expect(lastPush().data.title).toBe("Person 00");
    expect(lastPush().data.body).toBe("New message");
    expect(JSON.stringify(lastPush())).not.toContain("a secret");
  });

  it("the channel of Android follows the chosen sound: a jingle, no sound, or the normal one", async () => {
    const id = await connect(u(0), u(1));
    await register(u(1), token(1));
    const channel = () => (lastPush().android as { notification: { channelId: string } }).notification.channelId;

    await sounds(u(1), { message: "file:SevenFriends_raw2_Hyper.mp3" });
    await u(0).send(id, "one").expect(201);
    expect(channel()).toBe("friends_message_hyper");
    expect(lastPush().data.silent).toBeUndefined();

    await sounds(u(1), { message: "none" });
    await u(0).send(id, "two").expect(201);
    expect(channel()).toBe("friends_message_silent");
    expect(lastPush().data.silent).toBe("1"); // the browser's notification is silent too

    await sounds(u(1), { message: "file:Unknown_jingle.mp3" });
    await u(0).send(id, "three").expect(201);
    expect(channel()).toBe("friends_message_default");
  });
});

describe("the test notification", () => {
  it("reaches every device of the person and says how many", async () => {
    await register(u(1), token(1, "phone"));
    await register(u(1), token(1, "laptop"));
    sentPushes.length = 0;
    const result = (await u(1).raw("post", "/push/test").expect(200)).body;
    expect(result).toEqual({ devices: 2, delivered: 2 });
    expect(lastPush().data.title).toBe("Seven Friends");
  });

  it("no device registered: it says so (0 devices)", async () => {
    expect((await u(1).raw("post", "/push/test").expect(200)).body).toEqual({ devices: 0, delivered: 0 });
  });

  it("a dead token is counted as not reached (and removed)", async () => {
    await register(u(1), token(1, "phone"));
    await register(u(1), token(1, "old"));
    deadPushTokens.add(token(1, "old"));
    expect((await u(1).raw("post", "/push/test").expect(200)).body).toEqual({ devices: 2, delivered: 1 });
    expect(await devices("uid01")).toEqual([token(1, "phone")]);
  });

  it("is sent whatever the switches say, and with the text", async () => {
    await register(u(1), token(1));
    await u(1).raw("put", "/preferences/notices", { message: false, request: false, answer: false, removed: false, hideText: true }).expect(200);
    const result = (await u(1).raw("post", "/push/test").expect(200)).body;
    expect(result.delivered).toBe(1);
    expect(lastPush().data.body).toBe("This is a test notification. It works!");
  });

  it("needs a login", async () => {
    const request = (await import("supertest")).default;
    await request(server()).post("/api/push/test").expect(401);
  });
});
