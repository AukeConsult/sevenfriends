import { getFirestore } from "firebase-admin/firestore";
import { beforeEach, describe, expect, it } from "vitest";
import { User, assertConsistent, person, seedPool, signalsOf } from "./helpers";

/**
 * Who may receive a request? Only a person the LOGIN has proven to be the one addressed:
 *  - by a VERIFIED email (Google, an email link, a confirmed address), or
 *  - by a phone number confirmed with an SMS code.
 * What a user types on the profile (phone, social accounts) is contact info for friends and never finds anybody.
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

describe("an email counts only when it is verified", () => {
  it("an account with an unverified email gets no ping and no request; once verified, the next check finds it", async () => {
    await loginAs(10, { emailVerified: false });
    expect((await account("uid10")).emailLower).toBeNull(); // the account keeps no key for an unverified email

    const entry = await u(0).add(person(10), "email");
    expect(await signalsOf("uid10")).toEqual([]); // nobody to ping yet

    const unverified = new User(person(10), { emailVerified: false });
    expect((await unverified.check()).requests).toEqual([]); // the address is not proven: nothing found

    const verified = await loginAs(10, {}); // the person verifies the address and logs in again
    expect((await account("uid10")).emailLower).toBe(person(10).email.toLowerCase());
    expect((await verified.check()).requests.map((r) => r.id)).toEqual([entry.id]);
    await assertConsistent();
  });

  it("somebody who signs up with YOUR email but never verifies it cannot receive your requests", async () => {
    const victim = u(20);
    const attacker = await loginAs(21, { emailVerified: false }, { email: victim.p.email }); // same address, unproven
    expect((await account("uid21")).emailLower).toBeNull();

    const entry = await u(0).add(victim.p, "email"); // a friend asks the real owner
    expect((await signalsOf("uid21")).length).toBe(0); // the attacker gets no ping ...
    expect((await attacker.check()).requests).toEqual([]); // ... and finds nothing
    expect((await signalsOf("uid20")).map((s) => s.id)).toEqual([entry.id]); // the real owner does
    expect((await victim.check()).requests.map((r) => r.id)).toEqual([entry.id]);
    await assertConsistent();
  });

  it("a key left over from before the check existed is removed at the next login", async () => {
    await getFirestore().collection("user-account").doc("uid22").update({ emailLower: person(22).email.toLowerCase(), emailVerified: false });
    await loginAs(22, { emailVerified: false });
    expect((await account("uid22")).emailLower).toBeNull();
    await assertConsistent();
  });

  it("the check trusts the fresh token, not an old copy: verified now means found now", async () => {
    await loginAs(23, { emailVerified: false });
    const entry = await u(0).add(person(23), "email"); // the account copy is still unverified: no ping
    expect(await signalsOf("uid23")).toEqual([]);

    const nowVerified = new User(person(23), {}); // the token now says verified (no new login yet)
    expect((await nowVerified.check()).requests.map((r) => r.id)).toEqual([entry.id]);
  });
});

describe("a phone number counts only when it was confirmed with an SMS code", () => {
  it("typing somebody's number on the profile finds nothing", async () => {
    const victim = u(31);
    const typist = await loginAs(30, { phoneVerified: false }); // logs in without a confirmed phone number
    await typist.raw("put", "/profile", { phone: victim.p.phone }).expect(200); // types the victim's number as contact info

    const saved = (await typist.raw("get", "/profile").expect(200)).body;
    expect(saved).toMatchObject({ phone: victim.p.phone, phoneVerified: false });
    expect((await account("uid30")).phoneKey).toBeNull(); // no key from what was typed

    const entry = await u(0).add(victim.p, "phone");
    expect(await signalsOf("uid30")).toEqual([]);
    expect((await typist.check()).requests).toEqual([]);
    expect((await victim.check()).requests.map((r) => r.id)).toEqual([entry.id]); // the verified owner gets it
    await assertConsistent();
  });

  it("once the number is confirmed (SMS), the next check finds earlier requests", async () => {
    await loginAs(40, { phoneVerified: false });
    const entry = await u(0).add(person(40), "phone");
    expect(await signalsOf("uid40")).toEqual([]); // no verified number yet

    const verified = await loginAs(40, {}); // confirms the number: the login now carries it
    const stored = await account("uid40");
    expect(stored).toMatchObject({ verifiedPhone: person(40).phone });
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

describe("social accounts are contact info only", () => {
  it("claiming somebody's handle on your profile gives you none of their requests", async () => {
    const victim = u(50);
    await u(51).raw("put", "/profile", { instagram: victim.p.instagram }).expect(200); // claims the victim's handle

    const res = await u(0).raw("post", "/circles/default/friends", { name: "Victim", email: victim.p.email, instagram: victim.p.instagram });
    expect(res.status).toBe(201);

    expect((await u(51).check()).requests).toEqual([]); // the claimant gets nothing
    expect((await victim.check()).requests.map((r) => r.id)).toEqual([res.body.id]); // the owner does, by verified email
    await assertConsistent();
  });

  it("no friend entry or account ever stores a key for a social account", async () => {
    await u(0).raw("put", "/profile", { instagram: "someone", tiktok: "someone" }).expect(200);
    await u(0).raw("post", "/circles/default/friends", { name: "A", email: "a@nowhere.test", instagram: "a.person" }).expect(201);
    const doc = await account("uid00");
    expect(Object.keys(doc).filter((k) => /(facebook|instagram|tiktok|snapchat|twitter|linkedin|telegram)Key$/.test(k))).toEqual([]);
    await assertConsistent(); // checks every entry too
  });
});
