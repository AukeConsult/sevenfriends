import { getFirestore } from "firebase-admin/firestore";
import { beforeEach, describe, expect, it } from "vitest";
import { User, assertConsistent, person, seedPool, signalsOf } from "./helpers";

/**
 * Everybody is reachable by their email or phone number, verified or not. But whoever is connected to a person who
 * has verified nothing (no verified email, no SMS-confirmed phone) is TOLD: the friend entry carries `unverified`, and
 * a request shows `fromUnverified`.
 * (The test token carries `email_verified` and `phone_number`, like the real one.)
 */
let pool: User[];
let u: (n: number) => User;

beforeEach(async () => {
  pool = await seedPool();
  u = (n) => pool[n];
});

/** The same person, logging in with a different proof (a re-login writes the new proof to the account). */
const loginAs = async (n: number, claims: ConstructorParameters<typeof User>[1], overrides: Partial<ReturnType<typeof person>> = {}) => {
  const user = new User({ ...person(n), ...overrides }, claims);
  await user.raw("post", "/users/sync").expect(200);
  return user;
};

const account = async (uid: string) => (await getFirestore().collection("user-account").doc(uid).get()).data()!;

describe("an unverified person is still reachable, and their friends are told", () => {
  it("unverified email: they get the ping and the request, and the requester sees that the email is not verified", async () => {
    await loginAs(10, { emailVerified: false, phoneVerified: false });
    const entry = await u(0).add(person(10), "email");
    expect((await signalsOf("uid10")).map((s) => s.id)).toEqual([entry.id]); // pinged

    const unverified = new User(person(10), { emailVerified: false, phoneVerified: false });
    expect((await unverified.check()).requests.map((r) => r.id)).toEqual([entry.id]); // the request arrives
    const listed = (await u(0).friends()).find((f) => f.id === entry.id)!;
    expect(listed.unverified).toEqual(["email", "phone"]);
    expect(listed.invite).toBeNull(); // they are a user: no invitation
    await assertConsistent();
  });

  it("the warning follows the account: gone as soon as the email is verified", async () => {
    await loginAs(11, { emailVerified: false, phoneVerified: false });
    const entry = await u(0).add(person(11), "email");
    expect(entry.unverified).toEqual(["email", "phone"]);
    await loginAs(11, {}); // verifies, logs in again
    expect((await u(0).friends()).find((f) => f.id === entry.id)!.unverified).toEqual([]);
  });

  it("one verified detail is enough: no warning", async () => {
    await loginAs(12, { emailVerified: false }); // email unverified, phone confirmed
    expect((await u(0).add(person(12), "email")).unverified).toEqual([]);
    await loginAs(13, { phoneVerified: false }); // phone typed only, email verified
    expect((await u(0).add(person(13), "phone")).unverified).toEqual([]);
  });

  it("somebody who signs up with YOUR email without verifying it receives the request, but your side is told", async () => {
    const victim = u(20);
    const claimant = await loginAs(21, { emailVerified: false, phoneVerified: false }, { email: victim.p.email });
    const entry = await u(0).add(victim.p, "email");
    expect((await claimant.check()).requests.map((r) => r.id)).toEqual([entry.id]); // reachable
    expect((await u(0).friends()).find((f) => f.id === entry.id)!.unverified).toEqual(["email", "phone"]); // the requester is warned
    await assertConsistent();
  });

  it("an unverified phone number typed on the profile is reachable too, and flagged", async () => {
    const typist = await loginAs(30, { emailVerified: false, phoneVerified: false });
    await typist.raw("put", "/profile", { phone: person(30).phone }).expect(200);
    expect((await account("uid30")).phoneKey).toBeTruthy();
    const entry = await u(0).add(person(30), "phone");
    expect(entry.unverified).toEqual(["email", "phone"]);
    expect((await typist.check()).requests.map((r) => r.id)).toEqual([entry.id]);
  });

  it("clearing the typed number makes the person unreachable by it again", async () => {
    const typist = await loginAs(31, { emailVerified: false, phoneVerified: false });
    await typist.raw("put", "/profile", { phone: person(31).phone }).expect(200);
    await typist.raw("put", "/profile", { phone: "" }).expect(200);
    expect((await account("uid31")).phoneKey).toBeNull();
    await u(0).add(person(31), "phone");
    expect(await signalsOf("uid31")).toEqual([]);
  });

  it("the other direction: a request FROM somebody who has verified nothing is marked", async () => {
    const entry = await u(5).add(u(6).p);
    // the sender's proof is gone (as for an old account): the receiver is told
    await getFirestore().collection("user-account").doc("uid05").update({ emailVerified: false, verifiedPhone: null });
    const { requests } = await u(6).check();
    expect(requests.map((r) => [r.id, r.fromUnverified])).toEqual([[entry.id, ["email", "phone"]]]);
  });

  it("an unverified person who confirms becomes a friend; the verified side is not marked, the unverified one is", async () => {
    const newcomer = await loginAs(14, { emailVerified: false, phoneVerified: false });
    const entry = await u(0).add(person(14), "email");
    await newcomer.check();
    await newcomer.confirm(entry.id).expect(200);
    expect((await u(0).friends()).find((f) => f.id === entry.id)!.unverified).toEqual(["email", "phone"]);
    expect((await newcomer.friends())[0].unverified).toEqual([]); // u(0) is verified
  });
});

describe("a phone number confirmed with an SMS code", () => {
  it("reachable by the typed number before it is confirmed; confirming it removes the warning", async () => {
    await loginAs(40, { emailVerified: false, phoneVerified: false });
    const entry = await u(0).add(person(40), "phone"); // the seeded profile has this number typed in
    expect((await signalsOf("uid40")).map((s) => s.id)).toEqual([entry.id]);
    expect(entry.unverified).toEqual(["email", "phone"]);

    const verified = await loginAs(40, { emailVerified: false }); // confirms the number: the login now carries it
    expect(await account("uid40")).toMatchObject({ verifiedPhone: person(40).phone });
    expect((await u(0).friends()).find((f) => f.id === entry.id)!.unverified).toEqual([]);
    expect((await verified.check()).requests.map((r) => r.id)).toEqual([entry.id]);
    await assertConsistent();
  });

  it("the verified number is the contact number: it cannot be edited on the profile", async () => {
    const res = await u(0).raw("put", "/profile", { phone: "+47 111 11 111" });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ phone: u(0).p.phone, phoneVerified: true });
    expect((await u(0).raw("get", "/profile").expect(200)).body.phone).toBe(u(0).p.phone);

    // and it is the number a friend sees on their list
    await u(0).add(u(1).p);
    await u(1).check();
    expect((await u(1).friends())[0].phone).toBe(u(0).p.phone);
  });

  it("an unverified number is only a contact number: it can be edited and cleared", async () => {
    const user = await loginAs(41, { phoneVerified: false });
    expect((await user.raw("put", "/profile", { phone: "+47 123 45 678" })).body).toMatchObject({ phone: "+47 123 45 678", phoneVerified: false });
    expect((await user.raw("put", "/profile", { phone: "" })).body).toMatchObject({ phone: null, phoneVerified: false });
  });

  it("a login with a verified number fills in the contact number", async () => {
    const fresh = await loginAs(42, { phoneVerified: true });
    expect((await fresh.raw("get", "/profile").expect(200)).body).toMatchObject({ phone: person(42).phone, phoneVerified: true });
  });
});

describe("anybody can add a friend, verified or not", () => {
  const adder = (claims: ConstructorParameters<typeof User>[1]) => new User(person(20), claims);

  it("nothing verified: the request is created", async () => {
    await adder({ emailVerified: false, phoneVerified: false }).addRaw(person(21), "email").expect(201);
  });

  it("only the email verified, or only the phone verified", async () => {
    await adder({ phoneVerified: false }).addRaw(person(21), "email").expect(201);
    await adder({ emailVerified: false }).addRaw(person(22), "phone").expect(201);
  });
});
