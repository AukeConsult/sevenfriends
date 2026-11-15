import { getFirestore } from "firebase-admin/firestore";
import request from "supertest";
import { beforeEach, describe, expect, it } from "vitest";
import { User, assertConsistent, contactOf, person, seedPool, server, signalsOf } from "./helpers";

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

describe("accepting friend requests automatically (off by default; only for people with a verified email or phone)", () => {
  const on = (user: User) => user.raw("put", "/circles/default/settings", { autoAccept: true }).expect(200);

  it("off: a request waits for me, whoever it is from", async () => {
    const entry = await u(0).add(person(1), "email");
    const mine = (await u(1).check()).requests;
    expect(mine.map((r) => r.id)).toEqual([entry.id]);
    expect((await u(1).friends()).find((f) => f.id === entry.id)?.status).not.toBe("confirmed");
  });

  it("on: a person with a verified email or phone becomes a friend at once, and the sender sees it confirmed", async () => {
    await on(u(1));
    const entry = await u(0).add(person(1), "email");
    const answer = await u(1).check();
    expect(answer.requests).toEqual([]); // nothing left to confirm
    expect((await u(1).friends()).find((f) => f.id === entry.id)).toMatchObject({ status: "confirmed", asleep: false });
    expect((await u(0).friends()).find((f) => f.id === entry.id)?.status).toBe("confirmed");
    await assertConsistent();
  });

  it("on: a person with nothing verified still waits for me", async () => {
    await on(u(1));
    const stranger = await loginAs(10, { emailVerified: false, phoneVerified: false });
    const entry = await stranger.add(person(1), "email");
    const answer = await u(1).check();
    expect(answer.requests.map((r) => r.id)).toEqual([entry.id]);
    expect((await u(1).friends()).find((f) => f.id === entry.id)?.status).not.toBe("confirmed");
  });

  it("on with every seat taken: the friend goes on the sleep list, or waits when there is no sleep list", async () => {
    const { fillCircle } = await import("./helpers");
    await on(u(1));
    await fillCircle(u(1));
    const entry = await u(0).add(person(1), "email");
    await u(1).check();
    expect((await u(1).friends()).find((f) => f.id === entry.id)).toMatchObject({ status: "confirmed", asleep: true });
  });

  it("on with every seat taken and no sleep list: the request waits for a free seat", async () => {
    const { fillCircle } = await import("./helpers");
    await on(u(1));
    await u(1).raw("put", "/circles/default/settings", { sleepList: false }).expect(200);
    await fillCircle(u(1));
    const entry = await u(0).add(person(1), "email");
    const answer = await u(1).check();
    expect(answer.requests.map((r) => r.id)).toEqual([entry.id]);
    expect((await u(1).friends()).find((f) => f.id === entry.id)?.status).not.toBe("confirmed");
  });
});

describe("who can find me: public, searchable (the default) or private", () => {
  const set = (user: User, visibility: unknown) => user.raw("put", "/profile", { visibility });

  it("searchable is the default, and a wrong value is refused", async () => {
    expect((await u(1).raw("get", "/profile").expect(200)).body.visibility).toBe("searchable");
    await set(u(1), "everyone").expect(400);
    expect((await set(u(1), "public").expect(200)).body.visibility).toBe("public");
    expect((await u(1).raw("get", "/profile").expect(200)).body.visibility).toBe("public");
  });

  it("searchable and public: somebody who knows my email gets the ping and the request", async () => {
    for (const visibility of ["searchable", "public"]) {
      await set(u(1), visibility).expect(200);
      const entry = await u(0).add(person(1), "email");
      expect((await signalsOf(person(1).uid)).map((s) => s.id)).toContain(entry.id);
      expect((await u(1).check()).requests.map((r) => r.id)).toContain(entry.id);
      await u(0).remove(entry.id).expect(204);
    }
  });

  it("private: nobody finds me by email or phone, no ping and no request, and the adder sees nothing different from an unknown person", async () => {
    await set(u(1), "private").expect(200);
    const entry = await u(0).add(person(1), "email");
    expect((await signalsOf(person(1).uid)).map((s) => s.id)).not.toContain(entry.id);
    expect((await u(1).check()).requests).toEqual([]);
    const listed = (await u(0).friends()).find((f) => f.id === entry.id)!;
    expect(listed.status).not.toBe("confirmed");
    const byPhone = await u(0).add(person(1), "phone");
    expect((await u(1).check()).requests.map((r) => r.id)).not.toContain(byPhone.id);
  });

  it("private: an entry that was added before I switched it on does not reach me either", async () => {
    const entry = await u(0).add(person(1), "email");
    await set(u(1), "private").expect(200);
    expect((await u(1).check()).requests.map((r) => r.id)).not.toContain(entry.id);
  });
});

describe("telling whether somebody is on the app while an email or phone number is typed", () => {
  const look = (user: User, body: object) => user.raw("post", "/circles/default/friends/lookup", body);
  const status = async (user: User, body: object) => (await look(user, body).expect(200)).body.status;

  it("found by email and by phone, in any way of writing the number; the answer holds nothing but the status", async () => {
    expect(await status(u(0), { email: u(5).p.email })).toBe("found");
    expect(await status(u(0), { email: u(5).p.email.toUpperCase() })).toBe("found");
    expect(await status(u(0), { phone: u(5).p.phone })).toBe("found");
    expect(await status(u(0), { phone: u(5).p.phone.replace("+47", "") })).toBe("found"); // without the country code
    expect((await look(u(0), { email: u(5).p.email }).expect(200)).body).toEqual({ status: "found" }); // no name, no id, nothing else
  });

  it("none for an address nobody has, and for an account that was deleted", async () => {
    expect(await status(u(0), { email: "nobody-here@test.dev" })).toBe("none");
    expect(await status(u(0), { phone: "+4790099999" })).toBe("none");
    await u(6).raw("delete", "/users/me", { confirm: "DELETE" }).expect(204);
    expect(await status(u(0), { email: u(6).p.email })).toBe("none");
  });

  it("invalid while the address is not complete, and for nothing", async () => {
    for (const body of [{}, { email: "" }, { email: "abc" }, { email: "abc@" }, { email: "a@b" }, { phone: "12" }, { phone: "abc" }, { email: 5 }, { phone: [1] }, { email: { a: 1 } }]) {
      expect(await status(u(0), body), JSON.stringify(body)).toBe("invalid");
    }
  });

  it("self for my own email and my own phone number", async () => {
    expect(await status(u(7), { email: u(7).p.email })).toBe("self");
    expect(await status(u(7), { phone: u(7).p.phone })).toBe("self");
  });

  it("a person who made themselves private is not found, and looks the same as nobody; public and searchable are found", async () => {
    await u(8).raw("put", "/profile", { visibility: "private" }).expect(200);
    expect(await status(u(0), { email: u(8).p.email })).toBe("none");
    expect(await status(u(0), { phone: u(8).p.phone })).toBe("none");
    for (const visibility of ["public", "searchable"]) {
      await u(8).raw("put", "/profile", { visibility }).expect(200);
      expect(await status(u(0), { email: u(8).p.email })).toBe("found");
    }
  });

  it("the answer is the same as what sending a request would find", async () => {
    await u(9).raw("put", "/profile", { visibility: "private" }).expect(200);
    for (const [target, expected] of [[u(5), "found"], [u(9), "none"]] as const) {
      expect(await status(u(1), { email: target.p.email })).toBe(expected);
      const sent = await u(1).raw("post", "/circles/default/friends", { ...contactOf(target.p, "email"), onlyIfOnApp: true });
      expect(expected === "found" ? sent.status === 201 : sent.status === 422).toBe(true);
    }
  });

  it("needs a sign-in", async () => {
    await request(server()).post("/api/circles/default/friends/lookup").send({ email: u(5).p.email }).expect(401);
  });

  it("counts against the same searches an hour as sending a request: over the limit it is 429, and it never says who is there", async () => {
    const searcher = u(30);
    let refused = 0;
    for (let i = 0; i < 40; i++) {
      const res = await look(searcher, { email: i % 2 ? u(5).p.email : `nobody${i}@test.dev` });
      if (res.status === 429) {
        refused++;
        expect(res.body).toEqual({ error: expect.any(String) });
      } else expect(res.body.status).toMatch(/found|none/);
    }
    expect(refused).toBeGreaterThan(0);
    expect(refused).toBeLessThan(40);
    const sent = await searcher.raw("post", "/circles/default/friends", { ...contactOf(u(5).p, "email"), onlyIfOnApp: true });
    expect(sent.status).toBe(429); // the quota is shared
  });

  it("looking does not save, send or change anything", async () => {
    const before = (await u(2).friends()).length;
    await look(u(2), { email: u(5).p.email }).expect(200);
    await look(u(2), { email: "nobody-here@test.dev" }).expect(200);
    expect(await u(2).friends()).toHaveLength(before);
    expect((await u(5).check()).requests).toEqual([]); // the other person was not told anything
  });
});
