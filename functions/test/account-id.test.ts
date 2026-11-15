import { webcrypto } from "node:crypto";
import { getFirestore } from "firebase-admin/firestore";
import request from "supertest";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { resetCheckLimit } from "../src/accounts";
import { fingerprintOf } from "../src/models";
import { User, person, seedPool, server } from "./helpers";
import { authBreaks, deletedLogins } from "./setup";

/**
 * The stamp of an account (`accountId`): made once when the account is created, never changed, put on accounts and keys from before it existed,
 * gone with the account, and asked about by a device that holds data of an account. Also: a login that was deleted must not be able to make
 * anything again (docs/design/default-key.md, "Delete and create an account").
 */
let pool: User[];
let jwk: JsonWebKey;
let jwk2: JsonWebKey;

const makeKey = async () => {
  const pair = await webcrypto.subtle.generateKey({ name: "RSA-OAEP", modulusLength: 3072, publicExponent: new Uint8Array([1, 0, 1]), hash: "SHA-256" }, true, ["encrypt", "decrypt"]);
  return (await webcrypto.subtle.exportKey("jwk", pair.publicKey)) as JsonWebKey;
};

beforeAll(async () => {
  [jwk, jwk2] = await Promise.all([makeKey(), makeKey()]);
}, 120000);

beforeEach(async () => {
  resetCheckLimit();
  pool = await seedPool();
  deletedLogins.clear();
  authBreaks.on = false;
});

afterEach(() => {
  vi.useRealTimers();
  authBreaks.on = false;
});

const STAMP = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const db = () => getFirestore();
const accountRef = (uid: string) => db().collection("user-account").doc(uid);
const account = async (uid: string) => (await accountRef(uid).get()).data();
const keyDocs = async (uid: string) => (await accountRef(uid).collection("keys").get()).docs;
/** no sign-in at all: the way a device asks about an account it can no longer sign in to */
const check = (body: unknown) => request(server()).post("/api/accounts/check").send(body as object);
const erase = (user: User) => user.raw("delete", "/users/me", { confirm: "DELETE" });
const sync = async (user: User) => (await user.raw("post", "/users/sync").expect(200)).body.accountId as string;
const stampOfKeys = async (user: User) => (await user.raw("get", "/keys").expect(200)).body.accountId as string;

/** An account from before the stamp existed: its document has none, and neither do its keys. */
async function oldAccount(n: number, keys = 0): Promise<User> {
  const p = person(n);
  await accountRef(p.uid).set({ uid: p.uid, email: p.email, emailLower: p.email.toLowerCase(), displayName: p.name, emailVerified: true });
  const fingerprint = (await fingerprintOf(jwk))!;
  for (let i = 0; i < keys; i++) {
    await accountRef(p.uid).collection("keys").doc(`old-key-${i}`).set({ publicKey: jwk, fingerprint, label: `old ${i}`, revoked: i % 2 === 1, createdAt: new Date(2020, 0, i + 1) });
  }
  return new User(p);
}

describe("the stamp is made with the account, in the same step, and never changes", () => {
  it("a new account has its stamp from the first sign-in on: the document has it at once, and every way of asking gives the same", async () => {
    const fresh = new User(person(40));
    const first = (await fresh.raw("post", "/users/sync").expect(200)).body;
    expect(first.accountId).toMatch(STAMP);
    const doc = await account(fresh.p.uid);
    expect(doc?.accountId).toBe(first.accountId);
    expect(doc?.createdAt).toBeTruthy();
    expect(first.user.accountId).toBe(first.accountId);
    expect(await stampOfKeys(fresh)).toBe(first.accountId);
    expect((await fresh.raw("post", "/home").expect(200)).body.keys.accountId).toBe(first.accountId);
  });

  it("many sign-ins, profile saves, key changes and circle reads keep it", async () => {
    const fresh = new User(person(41));
    const stamp = await sync(fresh);
    for (let i = 0; i < 4; i++) expect(await sync(fresh)).toBe(stamp);
    await fresh.raw("put", "/profile", { name: "Another name", country: "NO", language: "nb" }).expect(200);
    await fresh.raw("put", "/profile/mood", { mood: 2, moodMessage: "ok" }).expect(200);
    await fresh.raw("post", "/keys", { publicKey: jwk, label: "Phone" }).expect(201);
    await fresh.raw("get", "/circles").expect(200);
    await fresh.raw("post", "/notifications/check").expect(200);
    expect(await stampOfKeys(fresh)).toBe(stamp);
    expect((await account(fresh.p.uid))?.accountId).toBe(stamp);
  });

  it("twenty new accounts, all at once, all have different stamps", async () => {
    const stamps = await Promise.all(Array.from({ length: 20 }, (_, i) => sync(new User(person(100 + i)))));
    expect(new Set(stamps).size).toBe(20);
    stamps.forEach((s) => expect(s).toMatch(STAMP));
  });

  it("the same new account signing in five times at once still has ONE stamp", async () => {
    const fresh = new User(person(42));
    const stamps = await Promise.all(Array.from({ length: 5 }, () => sync(fresh)));
    expect(new Set(stamps).size).toBe(1);
    expect((await account(fresh.p.uid))?.accountId).toBe(stamps[0]);
  });

  it("nothing from outside can set or change it", async () => {
    const before = await stampOfKeys(pool[0]);
    await pool[0].raw("put", "/profile", { name: "N", accountId: "hacked" }).expect(200);
    await pool[0].raw("post", "/users/sync", { accountId: "hacked" }).expect(200);
    await pool[0].raw("put", "/preferences", { accountId: "hacked" });
    await pool[0].raw("put", "/circles/default/settings", { accountId: "hacked" }); // refused: not a setting
    expect(await stampOfKeys(pool[0])).toBe(before);
    expect((await account(pool[0].p.uid))?.accountId).toBe(before);
    // and another person cannot read mine
    expect(JSON.stringify((await pool[1].raw("get", "/keys").expect(200)).body)).not.toContain(before);
  });
});

describe("an account and its keys from before the stamp existed get it", () => {
  it("the first look at the keys stamps the account and EVERY key of it (also retired ones), once", async () => {
    const old = await oldAccount(50, 5);
    expect((await account(old.p.uid))?.accountId).toBeUndefined();
    for (const d of await keyDocs(old.p.uid)) expect(d.data().accountId).toBeUndefined();

    const stamped = await stampOfKeys(old);
    expect(stamped).toMatch(STAMP);
    expect((await account(old.p.uid))?.accountId).toBe(stamped);
    const docs = await keyDocs(old.p.uid);
    expect(docs).toHaveLength(5);
    for (const d of docs) expect(d.data().accountId).toBe(stamped);

    expect(await stampOfKeys(old)).toBe(stamped);
    expect(await sync(old)).toBe(stamped);
    expect((await account(old.p.uid))?.accountId).toBe(stamped);
  });

  it("every first contact stamps an old account: sync, keys, home and publishing a key", async () => {
    const calls: [string, (u: User) => Promise<string>][] = [
      ["sync", sync],
      ["keys", stampOfKeys],
      ["home", async (u) => (await u.raw("post", "/home").expect(200)).body.keys.accountId],
      ["publish", async (u) => { await u.raw("post", "/keys", { publicKey: jwk2, label: "New" }).expect(201); return stampOfKeys(u); }],
    ];
    for (const [i, [name, call]] of calls.entries()) {
      const old = await oldAccount(60 + i, 2);
      const stamp = await call(old);
      expect(stamp, name).toMatch(STAMP);
      expect((await account(old.p.uid))?.accountId, name).toBe(stamp);
      for (const d of await keyDocs(old.p.uid)) expect(d.data().accountId, name).toBe(stamp);
    }
  });

  it("an old account read by many requests at once gets ONE stamp", async () => {
    const old = await oldAccount(70, 3);
    const stamps = await Promise.all(Array.from({ length: 15 }, (_, i) => (i % 3 === 0 ? sync(old) : stampOfKeys(old))));
    expect(new Set(stamps).size).toBe(1);
    expect((await account(old.p.uid))?.accountId).toBe(stamps[0]);
    for (const d of await keyDocs(old.p.uid)) expect(d.data().accountId).toBe(stamps[0]);
  });

  it("a key that carries some other stamp is brought back to the stamp of its account", async () => {
    const old = await oldAccount(71, 2);
    const stamp = await stampOfKeys(old);
    const docs = await keyDocs(old.p.uid);
    await docs[0].ref.update({ accountId: "from-another-life" });
    expect(await stampOfKeys(old)).toBe(stamp);
    for (const d of await keyDocs(old.p.uid)) expect(d.data().accountId).toBe(stamp);
  });

  it("stamping again changes nothing: the stamp stays", async () => {
    const old = await oldAccount(72, 1);
    const stamp = await stampOfKeys(old);
    for (let i = 0; i < 3; i++) await stampOfKeys(old);
    expect((await account(old.p.uid))?.accountId).toBe(stamp);
  });

  it("a key published now carries the stamp; a key published twice keeps it; the stamp is never shown to friends or in the key lists", async () => {
    const stamp = await stampOfKeys(pool[0]);
    const published = (await pool[0].raw("post", "/keys", { publicKey: jwk, label: "Phone" }).expect(201)).body;
    await pool[0].raw("post", "/keys", { publicKey: jwk, label: "Phone, renamed" }).expect(200);
    for (const d of await keyDocs(pool[0].p.uid)) expect(d.data().accountId).toBe(stamp);
    expect(JSON.stringify(published)).not.toContain(stamp);
    expect(JSON.stringify((await pool[0].raw("get", "/keys").expect(200)).body.keys)).not.toContain(stamp); // only the account level field carries it
    const friend = await pool[0].add(pool[1].p);
    await pool[1].check();
    await pool[1].confirm(friend.id).expect(200);
    expect(JSON.stringify((await pool[1].friends()))).not.toContain(stamp);
    expect(JSON.stringify((await pool[0].friends()))).not.toContain(stamp);
  });

  it("an account that does not exist is never made by looking for its stamp", async () => {
    const { ensureAccountId } = await import("../src/accounts");
    expect(await ensureAccountId("nobody-here")).toBe("");
    expect((await accountRef("nobody-here").get()).exists).toBe(false);
    const { stampKeys } = await import("../src/accounts");
    await stampKeys("", []); // nothing to stamp with: nothing happens
  });
});

describe("a device asks whether its account is still there", () => {
  it("active for the right user id and stamp, with no sign-in (even with a broken sign-in header)", async () => {
    const stamp = await sync(pool[0]);
    expect((await check({ uid: pool[0].p.uid, accountId: stamp }).expect(200)).body).toEqual({ status: "active" });
    expect((await request(server()).post("/api/accounts/check").set("Authorization", "Bearer garbage").send({ uid: pool[0].p.uid, accountId: stamp }).expect(200)).body).toEqual({ status: "active" });
  });

  it("gone for everything else: wrong stamp, another account's stamp, unknown account, near misses and bad input", async () => {
    const mine = await sync(pool[0]);
    const theirs = await sync(pool[1]);
    const cases: unknown[] = [
      { uid: pool[0].p.uid, accountId: "wrong" },
      { uid: pool[0].p.uid, accountId: theirs },
      { uid: pool[1].p.uid, accountId: mine },
      { uid: "no-such-user", accountId: mine },
      { uid: ` ${pool[0].p.uid}`, accountId: mine },
      { uid: pool[0].p.uid, accountId: `${mine} ` },
      { uid: pool[0].p.uid, accountId: mine.toUpperCase() },
      { uid: pool[0].p.uid, accountId: mine.slice(0, -1) },
      { uid: pool[0].p.uid, accountId: "" },
      { uid: "", accountId: mine },
      { uid: pool[0].p.uid },
      { accountId: mine },
      {},
      { uid: 5, accountId: 7 },
      { uid: [pool[0].p.uid], accountId: [mine] },
      { uid: { a: 1 }, accountId: { b: 2 } },
      { uid: null, accountId: null },
      { uid: pool[0].p.uid, accountId: "x".repeat(500) },
      { uid: "x".repeat(500), accountId: mine },
    ];
    for (const body of cases) expect((await check(body).expect(200)).body, JSON.stringify(body).slice(0, 80)).toEqual({ status: "gone" });
    expect((await request(server()).post("/api/accounts/check").expect(200)).body).toEqual({ status: "gone" });
    expect((await request(server()).post("/api/accounts/check").set("Content-Type", "text/plain").send("hello").expect(200)).body).toEqual({ status: "gone" });
  });

  it("an old account that has no stamp yet is 'gone' for any stamp (a device only learns a stamp from the server)", async () => {
    const old = await oldAccount(80);
    expect((await check({ uid: old.p.uid, accountId: "anything" }).expect(200)).body).toEqual({ status: "gone" });
    const stamp = await sync(old);
    expect((await check({ uid: old.p.uid, accountId: stamp }).expect(200)).body).toEqual({ status: "active" });
  });

  it("the check only answers; it changes nothing and makes nothing", async () => {
    const before = (await db().collection("user-account").get()).size;
    await check({ uid: "ghost", accountId: "x" }).expect(200);
    await check({ uid: pool[0].p.uid, accountId: "x" }).expect(200);
    expect((await db().collection("user-account").get()).size).toBe(before);
    expect((await account("ghost"))).toBeUndefined();
  });

  it("only POST answers", async () => {
    await request(server()).get("/api/accounts/check").expect(404);
    await request(server()).put("/api/accounts/check").send({}).expect(404);
    await request(server()).delete("/api/accounts/check").expect(404);
  });

  it("gone as soon as the account is deleted; the same person signing up again has another stamp, and the old stamp stays gone", async () => {
    const stamp = await sync(pool[0]);
    await erase(pool[0]).expect(204);
    expect((await check({ uid: pool[0].p.uid, accountId: stamp }).expect(200)).body).toEqual({ status: "gone" });
    expect(await account(pool[0].p.uid)).toBeUndefined();

    deletedLogins.clear(); // a new login for the same person
    const again = await sync(new User(pool[0].p));
    expect(again).toMatch(STAMP);
    expect(again).not.toBe(stamp);
    expect((await check({ uid: pool[0].p.uid, accountId: stamp }).expect(200)).body).toEqual({ status: "gone" });
    expect((await check({ uid: pool[0].p.uid, accountId: again }).expect(200)).body).toEqual({ status: "active" });
  });

  it("deleting one account does not touch another: not its stamp, not its keys", async () => {
    const a = await sync(pool[0]);
    const b = await sync(pool[1]);
    await pool[1].raw("post", "/keys", { publicKey: jwk, label: "Phone" }).expect(201);
    await erase(pool[0]).expect(204);
    expect((await check({ uid: pool[1].p.uid, accountId: b }).expect(200)).body).toEqual({ status: "active" });
    expect((await check({ uid: pool[0].p.uid, accountId: a }).expect(200)).body).toEqual({ status: "gone" });
    expect(await stampOfKeys(pool[1])).toBe(b);
    expect((await keyDocs(pool[1].p.uid))[0].data().accountId).toBe(b);
  });

  it("many accounts deleted one after another: each is gone, the rest stay active", async () => {
    const stamps = await Promise.all(pool.slice(0, 6).map(sync));
    for (let i = 0; i < 3; i++) await erase(pool[i]).expect(204);
    for (let i = 0; i < 6; i++) {
      const status = (await check({ uid: pool[i].p.uid, accountId: stamps[i] }).expect(200)).body.status;
      expect(status, `account ${i}`).toBe(i < 3 ? "gone" : "active");
    }
  });
});

describe("a deleted account leaves nothing, and its login cannot make anything again", () => {
  it("the keys, the backups, the lists and the stamp are all gone", async () => {
    await pool[0].raw("post", "/keys", { publicKey: jwk, label: "Phone" }).expect(201);
    await pool[0].raw("post", "/keys", { publicKey: jwk2, label: "Tablet" }).expect(201);
    await erase(pool[0]).expect(204);
    expect(await keyDocs(pool[0].p.uid)).toEqual([]);
    expect(await account(pool[0].p.uid)).toBeUndefined();
  });

  it("the old login token is refused at once on every kind of request, and nothing is made", async () => {
    await sync(pool[0]);
    await erase(pool[0]).expect(204);
    for (const [method, path, body] of [
      ["post", "/users/sync", undefined],
      ["get", "/keys", undefined],
      ["post", "/keys", { publicKey: jwk, label: "Ghost" }],
      ["post", "/home", undefined],
      ["get", "/profile", undefined],
      ["put", "/profile", { name: "Ghost" }],
      ["post", "/notifications/check", undefined],
      ["get", "/circles", undefined],
      ["post", "/own-recovery/ask", { key: "x" }],
    ] as const) {
      expect((await pool[0].raw(method, path, body as object | undefined)).status, `${method} ${path}`).toBe(401);
    }
    expect(await account(pool[0].p.uid)).toBeUndefined();
    expect(await keyDocs(pool[0].p.uid)).toEqual([]);
    expect((await db().collection("user-account").doc(pool[0].p.uid).collection("friend-circle").get()).size).toBe(0);
  });

  it("a login that Firebase deleted by another way is noticed within 15 seconds", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    await sync(pool[0]); // seen now
    deletedLogins.add(pool[0].p.uid); // deleted at Firebase, not by our erase route
    await pool[0].raw("get", "/keys").expect(200); // inside the 15 seconds the last look is trusted
    vi.setSystemTime(Date.now() + 16_000);
    await pool[0].raw("get", "/keys").expect(401);
    await pool[0].raw("post", "/users/sync").expect(401);
  });

  it("other people are not affected by a deleted login", async () => {
    await erase(pool[0]).expect(204);
    await pool[1].raw("get", "/keys").expect(200);
    await pool[2].raw("post", "/home").expect(200);
  });

  it("when Firebase cannot be asked (it is down), nobody is locked out", async () => {
    authBreaks.on = true;
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(Date.now() + 3_600_000); // no earlier look is trusted any more
    await pool[3].raw("get", "/keys").expect(200);
    await pool[3].raw("post", "/home").expect(200);
  });

  it("erasing twice is harmless, and the second time the login is already gone", async () => {
    await erase(pool[0]).expect(204);
    deletedLogins.clear();
    await erase(pool[0]).expect(204);
    expect(await account(pool[0].p.uid)).toBeUndefined();
  });

  it("a friend of the deleted account keeps their own stamp and keys", async () => {
    const friend = await pool[0].add(pool[1].p);
    await pool[1].check();
    await pool[1].confirm(friend.id).expect(200);
    const mine = await stampOfKeys(pool[1]);
    await pool[1].raw("post", "/keys", { publicKey: jwk, label: "Phone" }).expect(201);
    await erase(pool[0]).expect(204);
    expect(await stampOfKeys(pool[1])).toBe(mine);
    expect((await keyDocs(pool[1].p.uid))[0].data().accountId).toBe(mine);
    expect((await pool[1].friends()).find((f) => f.id === friend.id)).toBeUndefined();
  });

  it("a new life: after delete and a new sign-up, the new keys carry the new stamp and nothing of the old one", async () => {
    const first = await sync(pool[0]);
    await pool[0].raw("post", "/keys", { publicKey: jwk, label: "Old phone" }).expect(201);
    await erase(pool[0]).expect(204);
    deletedLogins.clear();
    const reborn = new User(pool[0].p);
    const second = await sync(reborn);
    expect(second).not.toBe(first);
    await reborn.raw("post", "/keys", { publicKey: jwk2, label: "New phone" }).expect(201);
    const docs = await keyDocs(reborn.p.uid);
    expect(docs).toHaveLength(1); // the old key did not come back
    expect(docs[0].data().accountId).toBe(second);
    expect(JSON.stringify(docs.map((d) => d.data()))).not.toContain(first);
  });
});

describe("the check cannot be used to drive up the load", () => {
  it("after a lot of questions from one caller the answer is 429, which is not an answer about any account; a minute later it answers again", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    const stamp = await sync(pool[0]);
    let refused = 0;
    for (let i = 0; i < 300; i++) {
      const res = await check({ uid: pool[0].p.uid, accountId: stamp });
      if (res.status === 429) refused++;
      else expect(res.body).toEqual({ status: "active" });
    }
    expect(refused).toBeGreaterThan(0);
    expect(refused).toBeLessThan(300);
    vi.setSystemTime(Date.now() + 61_000);
    expect((await check({ uid: pool[0].p.uid, accountId: stamp }).expect(200)).body).toEqual({ status: "active" });
  });
});
