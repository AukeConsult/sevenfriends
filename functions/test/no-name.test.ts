import { getFirestore } from "firebase-admin/firestore";
import request from "supertest";
import { beforeEach, describe, expect, it } from "vitest";
import { User, connect, person, seedPool, server } from "./helpers";
import { sentPushes } from "./setup";

/**
 * A missing name is never a show stopper: an account with no name (the login gave none, the name is empty or only spaces, there is no email either) can do everything,
 * and what others see falls back to something real (the email, then "Someone"), never to an empty text.
 */
let pool: User[];
let u: (n: number) => User;

beforeEach(async () => {
  pool = await seedPool();
  u = (n) => pool[n];
});

/** the people without a name: an empty name, a name of spaces, no name at all in the login, and no name and no email */
const nameless = (n: number): [string, User][] => [
  ["an empty name", new User({ ...person(n), name: "" })],
  ["a name of spaces", new User({ ...person(n + 1), name: "   " })],
  ["no name in the login", new User({ ...person(n + 2), name: undefined as unknown as string })],
  ["no name and no email", new User({ ...person(n + 3), name: "", email: "" })],
];

const doc = async (user: User) => (await getFirestore().collection("user-account").doc(user.p.uid).get()).data();
const entryOf = async (owner: User, id: string) => (await owner.raw("get", "/circles/default/friends").expect(200)).body.friends.find((f: { id: string }) => f.id === id);
const readable = (text: unknown) => typeof text === "string" && text.trim().length > 0 && !/undefined|null/.test(text);

describe("an account with no name", () => {
  for (const [label, who] of nameless(70)) {
    describe(label, () => {
      it("signs in, and the account has no name (never an empty one)", async () => {
        await who.raw("post", "/users/sync").expect(200);
        const account = await doc(who);
        expect(account?.displayName === null || account?.displayName === undefined).toBe(true);
        expect((await who.raw("get", "/profile").expect(200)).body.name).toBeNull();
      });

      it("saves the rest of its profile without a name", async () => {
        await who.raw("post", "/users/sync").expect(200);
        const saved = await who.raw("put", "/profile", { pronoun: "she", country: "NO", language: "nb", visibility: "private", icon: 3 }).expect(200);
        expect(saved.body).toMatchObject({ pronoun: "she", country: "NO", visibility: "private", icon: 3, name: null });
        await who.raw("put", "/profile/mood", { mood: 2, moodMessage: "fine" }).expect(200);
        await who.raw("post", "/home").expect(200);
        await who.raw("get", "/keys").expect(200);
      });

      it("asks a friend, and the friend sees a real name on the request and in the push", async () => {
        await who.raw("post", "/users/sync").expect(200);
        sentPushes.length = 0;
        const entry = await who.add(u(5).p);
        const request = (await u(5).check()).requests.find((r) => r.id === entry.id);
        expect(request, "the request arrived").toBeTruthy();
        expect(readable(request!.fromName)).toBe(true);
        const push = sentPushes.find((p) => p.data.id === `request-${entry.id}`);
        if (push) expect(readable(push.data.title)).toBe(true);
      });

      it("is asked by a friend, answers, and both lists show a real name", async () => {
        await who.raw("post", "/users/sync").expect(200);
        const entry = await u(6).add(who.p, who.p.email ? "email" : "phone"); // somebody without an email is found by the phone number
        const mine = (await who.check()).requests;
        expect(mine.map((r) => r.id)).toContain(entry.id);
        expect(readable(mine.find((r) => r.id === entry.id)!.fromName)).toBe(true); // the friend has a name
        await who.confirm(entry.id).expect(200);
        const theirView = await entryOf(u(6), entry.id);
        expect(readable(theirView.name)).toBe(true);
        const myView = await entryOf(who, entry.id);
        expect(readable(myView.name)).toBe(true);
      });

      it("sends and receives messages (and the unread note on the other side has a sender)", async () => {
        await who.raw("post", "/users/sync").expect(200);
        const id = await connect(u(7), who, who.p.email ? "email" : "phone");
        sentPushes.length = 0;
        await who.send(id, "hei, jeg er ny").expect(201);
        await u(7).send(id, "velkommen").expect(201);
        const theirs = (await u(7).feed(id).expect(200)).body.messages;
        expect(theirs.map((m: { text: string }) => m.text)).toContain("hei, jeg er ny");
        const mine = (await who.feed(id).expect(200)).body.messages;
        expect(mine.map((m: { text: string }) => m.text)).toContain("velkommen");
        const pushes = sentPushes.filter((p) => String(p.data.id ?? "").startsWith("message-"));
        for (const p of pushes) expect(readable(p.data.title)).toBe(true);
      });

      it("makes a group, adds a friend, writes in it, and the others see a real name on its messages", async () => {
        await who.raw("post", "/users/sync").expect(200);
        const friendId = await connect(who, u(8));
        const group = (await who.raw("post", "/circles/default/friends/group", { name: "Book club" }).expect(201)).body;
        await who.raw("post", `/circles/default/friends/${group.id}/group/members`, { friendId }).expect(200);
        await who.send(group.id, "first in the group").expect(201);
        const seen = (await u(8).feed(group.id).expect(200)).body.messages as { text: string; fromName?: string }[];
        const mine = seen.find((m) => m.text === "first in the group");
        expect(mine, "the message arrived").toBeTruthy();
        expect(readable(mine!.fromName)).toBe(true);
        const members = (await who.raw("get", `/circles/default/friends/${group.id}/group/members`).expect(200)).body as { name: string }[];
        for (const m of members) expect(readable(m.name)).toBe(true);
      });

      it("gives a friend link that works (the page that opens it says who invites, or nothing, never an error)", async () => {
        await who.raw("post", "/users/sync").expect(200);
        const code = (await who.raw("get", "/invite/code").expect(200)).body.code as string;
        const found = await request(server()).get(`/api/invite-public/${code}`);
        expect(found.status).toBe(200);
        expect(found.body.name === null || readable(found.body.name)).toBe(true);
        const asked = await u(9).raw("get", `/invite/lookup/${code}`).expect(200);
        expect(asked.body.name === null || readable(asked.body.name)).toBe(true);
      });

      it("can be deleted", async () => {
        await who.raw("post", "/users/sync").expect(200);
        await who.raw("delete", "/users/me", { confirm: "DELETE" }).expect(204);
      });
    });
  }

  it("a name that is only given later shows from then on, and an empty one is still refused when it is sent on purpose", async () => {
    const who = new User({ ...person(80), name: "" });
    await who.raw("post", "/users/sync").expect(200);
    expect((await who.raw("get", "/profile").expect(200)).body.name).toBeNull();
    await who.raw("put", "/profile", { name: "   " }).expect(400); // sent on purpose as empty: refused (nothing else is lost: the page never sends it)
    expect((await who.raw("put", "/profile", { name: "Kari" }).expect(200)).body.name).toBe("Kari");
    expect((await who.raw("post", "/users/sync").expect(200)).body.user.displayName).toBe("Kari"); // a sign-in never takes it away
  });

  it("the name of the login is used when there is one, and a real name on the profile wins", async () => {
    const withName = new User({ ...person(81), name: "Login Name" });
    await withName.raw("post", "/users/sync").expect(200);
    expect((await withName.raw("get", "/profile").expect(200)).body.name).toBe("Login Name");
    await withName.raw("put", "/profile", { name: "Own Name" }).expect(200);
    await withName.raw("post", "/users/sync").expect(200);
    expect((await withName.raw("get", "/profile").expect(200)).body.name).toBe("Own Name");
  });
});
