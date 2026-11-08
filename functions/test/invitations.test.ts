import { getFirestore } from "firebase-admin/firestore";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { User, assertConsistent, person, seedPool } from "./helpers";

/**
 * A friend request to somebody who has no account yet: the person is offered an invitation by email, confirms the
 * address on a page first, and then it goes to the outbox. (There is no SMS invitation: texts are only for login codes.)
 * A request can carry a message, which the friend sees with the request and in the invitation.
 */
let pool: User[];
let u: (n: number) => User;
const stranger = person(70); // nobody in the pool: no account

beforeEach(async () => {
  pool = await seedPool();
  u = (n) => pool[n];
});

const docs = async (collection: string) => (await getFirestore().collection(collection).get()).docs.map((d) => d.data());
const invite = (user: User, id: string) => user.raw("post", `/circles/default/friends/${id}/invite`);
const addByPhone = (user: User, p = stranger, message?: string) =>
  user.raw("post", "/circles/default/friends", { name: "Newcomer", phone: p.phone, ...(message ? { message } : {}) });

describe("the message with a request", () => {
  it("is saved with the friend and reaches the other person with the request", async () => {
    const entry = (await u(0).raw("post", "/circles/default/friends", { name: "One", email: person(1).email, message: "  Hi! It's me  " }).expect(201)).body;
    expect(entry.message).toBe("Hi! It's me");
    const { requests } = await u(1).check();
    expect(requests.map((r) => r.message)).toEqual(["Hi! It's me"]);
  });

  it("is optional, and at most 500 characters", async () => {
    expect((await u(0).add(person(1))).message).toBeNull();
    await u(0).raw("post", "/circles/default/friends", { name: "Two", email: person(2).email, message: "x".repeat(501) }).expect(400);
    await u(0).raw("post", "/circles/default/friends", { name: "Two", email: person(2).email, message: "x".repeat(500) }).expect(201);
  });
});

describe("who is offered an invitation", () => {
  it("nobody with an account: an invitation by email is offered, not sent yet", async () => {
    const entry = await u(0).add(stranger, "email");
    expect(entry.invite).toEqual({ to: stranger.email, sentAt: null });
    expect(await docs("mail")).toEqual([]); // nothing is sent before the address is confirmed
  });

  it("only a phone number: no invitation (there is no SMS invitation), and nothing can be sent", async () => {
    const entry = (await addByPhone(u(0)).expect(201)).body;
    expect(entry.invite).toBeNull();
    await invite(u(0), entry.id).expect(409);
    expect(await docs("mail")).toEqual([]);
  });

  it("both an email and a phone number: by email", async () => {
    const entry = (await u(0).raw("post", "/circles/default/friends", { name: "Both", email: stranger.email, phone: stranger.phone }).expect(201)).body;
    expect(entry.invite).toEqual({ to: stranger.email, sentAt: null });
  });

  it("somebody who has an account gets the request in the app: no invitation", async () => {
    expect((await u(0).add(person(1))).invite).toBeNull();
    expect((await invite(u(0), (await u(0).friends())[0].id).expect(409)).body.error).toMatch(/does not need/);
  });
});

describe("sending the invitation", () => {
  it("email: one mail in the outbox with my name, the message and where to sign up; only once", async () => {
    const entry = (await u(0).raw("post", "/circles/default/friends", { name: "New", email: stranger.email, message: "Join me!" }).expect(201)).body;
    const sent = (await invite(u(0), entry.id).expect(200)).body;
    expect(sent.invite.sentAt).toBeTruthy();

    const mail = await docs("mail");
    expect(mail).toHaveLength(1);
    expect(mail[0].to).toEqual([stranger.email]);
    expect(mail[0].fromUid).toBe("uid00");
    expect(mail[0].message.subject).toContain("Person 00");
    expect(mail[0].message.text).toContain("Join me!");
    expect(mail[0].message.text).toContain(stranger.email);

    await invite(u(0), entry.id).expect(409); // never twice
    expect(await docs("mail")).toHaveLength(1);
  });

  it("only the owner can send it", async () => {
    const entry = await u(0).add(stranger);
    await invite(u(1), entry.id).expect(404);
    expect(await docs("mail")).toEqual([]);
  });

  it("not when the friend has signed up in the meantime: they get the request in the app", async () => {
    const entry = await u(0).add(stranger);
    await new User(stranger, {}).raw("post", "/users/sync").expect(200);
    await invite(u(0), entry.id).expect(409);
    expect(await docs("mail")).toEqual([]);
  });

  it("is limited per person per day", async () => {
    const entry = await u(0).add(stranger);
    const db = getFirestore();
    for (let i = 0; i < 20; i++) await db.collection("mail").doc(`old${i}`).set({ fromUid: "uid00", to: ["x@y.z"], createdAt: new Date() });
    await invite(u(0), entry.id).expect(429);
  });

  it("is erased with the sender", async () => {
    const entry = await u(0).add(stranger);
    await invite(u(0), entry.id).expect(200);
    const other = await u(1).add(person(71));
    await invite(u(1), other.id).expect(200);
    await u(0).raw("delete", "/users/me", { confirm: "DELETE" }).expect(204);
    expect((await docs("mail")).filter((m) => m.fromUid === "uid00")).toEqual([]);
    expect((await docs("mail")).filter((m) => m.fromUid === "uid01")).toHaveLength(1); // somebody else's invitation stays
    await assertConsistent();
  });
});

describe("a friend who is a user but has verified nothing", () => {
  /** signs up like the real app, with the email NOT verified (and the typed phone not confirmed either) */
  const unverifiedUser = async (n: number) => new User(person(n), { emailVerified: false, phoneVerified: false }).signUp();

  it("they are reachable (no invitation), and the requester is told what is not verified", async () => {
    await unverifiedUser(40);
    const entry = await u(0).add(person(40), "email");
    expect(entry.unverified).toEqual(["email", "phone"]); // signUp types their phone, unconfirmed
    expect(entry.invite).toBeNull();
    await invite(u(0), entry.id).expect(409); // they are a user already
    expect(await docs("mail")).toEqual([]);
  });

  it("nobody is flagged for a stranger or for a verified user", async () => {
    expect((await u(0).add(stranger)).unverified).toEqual([]);
    expect((await u(0).add(person(1))).unverified).toEqual([]);
  });
});

describe("the invitation text comes from the settings (environment)", () => {
  const keys = ["APP_URL", "INVITE_EMAIL_SUBJECT", "INVITE_EMAIL_TEXT"];
  const saved: Record<string, string | undefined> = {};
  beforeEach(() => keys.forEach((k) => { saved[k] = process.env[k]; delete process.env[k]; }));
  afterEach(() => keys.forEach((k) => { if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k]; }));

  it("the defaults: the real site link, and no hole when there is no message", async () => {
    const entry = await u(0).add(stranger);
    await invite(u(0), entry.id).expect(200);
    const [mail] = await docs("mail");
    expect(mail.message.text).toMatch(
      new RegExp(`^Person 00 wants you as one of their 7 closest friends on Seven Friends\\.\\n\\nSign up with this email address \\(${stranger.email.replace(/[.+]/g, "\\$&")}\\) to see the request: https://sevenfriends\\.io/welcome/friends\\?invite=[a-z0-9]{10}$`),
    );
    expect(mail.message.text).not.toContain("from="); // the link never carries an email address or a phone number
    expect(mail.message.subject).toBe("Person 00 invited you to Seven Friends");
  });

  it("APP_URL, the subject and the text can be changed", async () => {
    process.env.APP_URL = "https://example.test/join";
    process.env.INVITE_EMAIL_SUBJECT = "Join {fromName}!";
    process.env.INVITE_EMAIL_TEXT = "Hi from {fromName}.\\n{message}\\nJoin with {to}: {appUrl}";
    const email = (await u(0).raw("post", "/circles/default/friends", { name: "E", email: stranger.email, message: "Come!" }).expect(201)).body;
    await invite(u(0), email.id).expect(200);

    const [mail] = await docs("mail");
    expect(mail.message.subject).toBe("Join Person 00!");
    expect(mail.message.text).toBe(`Hi from Person 00.\n"Come!"\nJoin with ${stranger.email}: https://example.test/join`);
  });

  it("an empty setting falls back to the default", async () => {
    process.env.APP_URL = "  ";
    const entry = await u(0).add(stranger);
    await invite(u(0), entry.id).expect(200);
    expect((await docs("mail"))[0].message.text).toContain("https://sevenfriends.io/");
  });
});
