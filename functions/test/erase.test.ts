import { getFirestore } from "firebase-admin/firestore";
import { beforeEach, describe, expect, it } from "vitest";
import { User, assertConsistent, connect, person, seedPool, signalsOf } from "./helpers";
import { deletedLogins } from "./setup";

/** Erasing yourself removes you everywhere: account, entries and requests on both sides, messages, pings, login. */
let pool: User[];
let u: (n: number) => User;

beforeEach(async () => {
  pool = await seedPool();
  u = (n) => pool[n];
  deletedLogins.clear();
});

const erase = (user: User, confirm: string | null = "DELETE") =>
  user.raw("delete", "/users/me", confirm === null ? {} : { confirm });

/** every document that mentions the person: under their account, or an entry / request / message that names them */
async function traces(uid: string): Promise<string[]> {
  const db = getFirestore();
  const found: string[] = [];
  for (const group of ["user-account", "friend-circle", "friends", "friend-request", "messages", "incoming-signal"]) {
    for (const d of (await db.collectionGroup(group).get()).docs) {
      const data = d.data();
      if (d.ref.path.includes(`user-account/${uid}`) || [data.linkedUid, data.fromUid, data.toUid, data.uid].includes(uid)) {
        found.push(d.ref.path);
      }
    }
  }
  return found;
}

describe("erase my account", () => {
  it("needs the confirmation word; without it nothing is touched", async () => {
    await connect(u(0), u(1));
    await erase(u(0), null).expect(400);
    await erase(u(0), "yes").expect(400);
    expect((await traces("uid00")).length).toBeGreaterThan(0);
    expect(deletedLogins.size).toBe(0);
  });

  it("removes the account, the connections on both sides, the messages, the pings and the login", async () => {
    const id = await connect(u(0), u(1)); // confirmed + chat
    await u(0).send(id, "hello");
    await u(1).send(id, "hi back");
    const waiting = await u(0).add(person(2)); // never checked by 2: a ping is waiting
    expect(await signalsOf("uid02")).not.toEqual([]);
    const incoming = await u(3).add(person(0)); // 3 added me, I never checked
    await connect(u(1), u(2)); // an unrelated connection, which must survive

    await erase(u(0)).expect(204);

    expect(await traces("uid00")).toEqual([]);
    expect((await getFirestore().collection("user-account").doc("uid00").get()).exists).toBe(false);
    expect(deletedLogins.has("uid00")).toBe(true);
    expect(await signalsOf("uid02")).toEqual([]); // my ping to 2 is gone
    expect((await u(1).friends()).map((f) => f.id)).not.toContain(id);
    expect((await u(3).friends()).map((f) => f.id)).not.toContain(incoming.id); // 3's request to me was about me
    expect(waiting.id).toBeTruthy();
    expect((await u(1).check()).messages).toEqual([]);
    expect((await u(1).friends()).length).toBe(1); // 1 still has 2
    await assertConsistent();
  });

  it("another person who later signs up with my email does not receive old requests", async () => {
    await u(3).add(person(0));
    await erase(u(0)).expect(204);
    const newcomer = new User(person(0), {});
    const { requests } = await newcomer.check();
    expect(requests).toEqual([]);
  });

  it("running it twice is harmless", async () => {
    await connect(u(0), u(1));
    await erase(u(0)).expect(204);
    await erase(u(0)).expect(204);
    expect(await traces("uid00")).toEqual([]);
  });

  it("erasing while others act on the same connections leaves a consistent database (one transaction)", async () => {
    const a = await connect(u(0), u(1));
    const b = await connect(u(2), u(0));
    await Promise.all([
      erase(u(0)).expect(204),
      u(1).remove(a),
      u(2).send(b, "are you there?"),
      u(1).send(a, "hello?"),
      u(3).add(person(1)),
    ]);
    expect(await traces("uid00")).toEqual([]);
    await assertConsistent();
  });

  it("everybody erased: the database is empty", async () => {
    for (let i = 0; i < 12; i++) await connect(u(i), u((i + 1) % 12));
    for (let i = 0; i < 12; i++) await erase(u(i)).expect(204);
    for (let i = 0; i < 12; i++) expect(await traces(`uid${String(i).padStart(2, "0")}`)).toEqual([]);
    await assertConsistent();
  });
});

describe("closing a friendship wipes everything the two share", () => {
  it("both entries, the request, the pings and the whole conversation are gone, for both people", async () => {
    const id = await connect(u(0), u(1));
    await u(0).send(id, "hello");
    await u(1).send(id, "hi back");
    const other = await connect(u(0), u(2)); // another friendship of 0 must stay
    await u(2).send(other, "still here");

    await u(1).remove(id).expect(204); // the OTHER person closes it

    const db = getFirestore();
    const left = (await db.collectionGroup("messages").get()).docs.filter((d) => d.data().connectionId === id);
    expect(left).toEqual([]); // no message of that conversation, on either side
    for (const who of [0, 1]) expect((await u(who).friends()).map((f) => f.id)).not.toContain(id);
    for (const group of ["friends", "friend-request", "incoming-signal"]) {
      const docs = (await db.collectionGroup(group).get()).docs.filter((d) => d.id === id);
      expect(docs).toEqual([]);
    }
    expect((await u(0).friends()).map((f) => f.id)).toContain(other); // the other friendship is untouched
    expect((await u(0).feed(other).expect(200)).body.messages).toHaveLength(1);
    await assertConsistent();
  });

  it("closing it is the same from either side", async () => {
    const id = await connect(u(0), u(1));
    await u(0).send(id, "hello");
    await u(0).remove(id).expect(204);
    expect((await u(1).feed(id)).status).toBe(404);
    expect((await u(1).friends()).map((f) => f.id)).not.toContain(id);
  });
});
