import { beforeEach, describe, expect, it } from "vitest";
import { getFirestore } from "firebase-admin/firestore";
import { MAX_FRIENDS } from "../src/constants";
import { User, assertConsistent, connect, fillCircle, seedPool } from "./helpers";

/** A group made as a friend: it sits in a seat of my list, has its own conversation, and deleting it is leaving it. */
let pool: User[];
let u: (n: number) => User;

beforeEach(async () => {
  pool = await seedPool();
  u = (n) => pool[n];
});

const makeGroup = (user: User, name: string) => user.raw("post", "/circles/default/friends/group", { name });
const entryOf = async (user: User, id: string) => (await user.raw("get", "/circles/default/friends").expect(200)).body.friends.find((f: { id: string }) => f.id === id);
const groupDocOf = async (id: string) => (await getFirestore().collection("friend-group").doc(id).get()).data();

describe("making a group", () => {
  it("makes a friend entry with the id of the group, in a seat, with me as its only member", async () => {
    const made = (await makeGroup(u(0), "Book club").expect(201)).body;
    const entry = await entryOf(u(0), made.id);
    expect(entry).toMatchObject({ id: made.id, name: "Book club", status: "confirmed", group: true, members: 1, seat: 1, asleep: false, incoming: false });
    expect(await groupDocOf(made.id)).toMatchObject({ name: "Book club", createdBy: u(0).p.uid, members: { [u(0).p.uid]: "default" } });
  });

  it("needs a name", async () => {
    expect((await makeGroup(u(0), "")).status).toBe(400);
    expect((await u(0).raw("post", "/circles/default/friends/group", {})).status).toBe(400);
    const list = (await u(0).raw("get", "/circles/default/friends").expect(200)).body.friends;
    expect(list).toHaveLength(0);
  });

  it("takes a seat like a friend: refused when all seven are taken, possible after one goes to the sleep list", async () => {
    await fillCircle(u(0), MAX_FRIENDS);
    expect((await makeGroup(u(0), "Too many")).status).toBe(409);
    const first = (await u(0).raw("get", "/circles/default/friends").expect(200)).body.friends[0];
    await u(0).raw("post", `/circles/default/friends/${first.id}/sleep`, { asleep: true }).expect(200);
    const made = await makeGroup(u(0), "Now it fits").expect(201);
    expect((await entryOf(u(0), made.body.id)).seat).not.toBeNull();
    // and one more is refused again
    expect((await makeGroup(u(0), "Full again")).status).toBe(409);
  });

  it("sits beside friends: a friendship and a group in the same list, the friendship unchanged", async () => {
    const friendId = await connect(u(0), u(1));
    const made = (await makeGroup(u(0), "Group").expect(201)).body;
    const list = (await u(0).raw("get", "/circles/default/friends").expect(200)).body.friends;
    expect(list.map((f: { id: string }) => f.id).sort()).toEqual([friendId, made.id].sort());
    expect(list.find((f: { id: string }) => f.id === friendId).group).toBeUndefined();
    expect((await u(0).send(friendId, "still works")).status).toBe(201);
    expect((await assertConsistent()).messages).toBe(2); // the two copies of one message
  });

  it("can be put to sleep and woken up like a friend", async () => {
    const made = (await makeGroup(u(0), "Sleepy").expect(201)).body;
    await u(0).raw("post", `/circles/default/friends/${made.id}/sleep`, { asleep: true }).expect(200);
    expect(await entryOf(u(0), made.id)).toMatchObject({ asleep: true, seat: null });
    await u(0).raw("post", `/circles/default/friends/${made.id}/sleep`, { asleep: false }).expect(200);
    expect((await entryOf(u(0), made.id)).asleep).toBe(false);
  });
});

describe("the conversation of a group", () => {
  it("has its own feed: I can write, and read it back", async () => {
    const made = (await makeGroup(u(0), "Talk").expect(201)).body;
    const sent = (await u(0).send(made.id, "hello group")).body;
    expect(sent).toMatchObject({ text: "hello group", mine: true });
    const feed = (await u(0).feed(made.id).expect(200)).body;
    expect((Array.isArray(feed) ? feed : feed.messages).map((m: { text: string }) => m.text)).toEqual(["hello group"]);
    const mine = await getFirestore().collection("user-account").doc(u(0).p.uid).collection("messages").get();
    expect(mine.docs[0].data()).toMatchObject({ connectionId: made.id, fromUid: u(0).p.uid, text: "hello group" });
    expect(mine.docs[0].data().toUid).toBeUndefined(); // a group has no single receiver
  });

  it("is not reachable for somebody who is not in it", async () => {
    const made = (await makeGroup(u(0), "Private").expect(201)).body;
    expect((await u(1).send(made.id, "let me in")).status).toBe(404);
    expect((await u(1).feed(made.id)).status).toBe(404);
  });

  it("has no recovery by a friend", async () => {
    const made = (await makeGroup(u(0), "No recovery").expect(201)).body;
    expect((await u(0).raw("get", `/circles/default/friends/${made.id}/recovery`)).status).toBe(403);
  });

  it("has a safebox of its own, with the keys of its other members (none yet)", async () => {
    const made = (await makeGroup(u(0), "Box").expect(201)).body;
    const keys = (await u(0).raw("get", `/circles/default/friends/${made.id}/safebox/keys`).expect(200)).body;
    expect(keys.friend).toEqual([]);
    expect((await u(0).raw("get", `/circles/default/friends/${made.id}/safebox`)).status).toBe(200);
  });
});

describe("leaving a group (deleting it from my list)", () => {
  it("as the last member wipes the group, its messages and its safebox", async () => {
    const made = (await makeGroup(u(0), "Gone").expect(201)).body;
    await u(0).send(made.id, "bye");
    await u(0).remove(made.id).expect(204);
    expect(await entryOf(u(0), made.id)).toBeUndefined();
    expect(await groupDocOf(made.id)).toBeUndefined();
    const mine = await getFirestore().collection("user-account").doc(u(0).p.uid).collection("messages").get();
    expect(mine.size).toBe(0);
    expect((await getFirestore().collection("safebox").doc(made.id).collection("items").get()).size).toBe(0);
    await assertConsistent();
  });

  it("frees the seat", async () => {
    await fillCircle(u(0), MAX_FRIENDS - 1);
    const made = (await makeGroup(u(0), "Seat")).body;
    expect((await makeGroup(u(0), "Second")).status).toBe(409);
    await u(0).remove(made.id).expect(204);
    expect((await makeGroup(u(0), "Second")).status).toBe(201);
  });

  it("a person who does not have it cannot delete it (it is simply not found)", async () => {
    const made = (await makeGroup(u(0), "Mine")).body;
    await u(1).remove(made.id).expect(204); // nothing of theirs is touched
    expect(await groupDocOf(made.id)).toBeDefined();
    expect(await entryOf(u(0), made.id)).toBeDefined();
  });
});

describe("erasing the account of the one who made it", () => {
  it("takes the group with it", async () => {
    const made = (await makeGroup(u(0), "Erase me")).body;
    await u(0).send(made.id, "last words");
    await u(0).raw("delete", "/users/me", { confirm: "DELETE" }).expect(204);
    expect(await groupDocOf(made.id)).toBeUndefined();
  });
});

describe("the profile of a group and its members", () => {
  it("any member can change the name and the description; every member's entry follows", async () => {
    const friendId = await connect(u(0), u(1));
    const made = (await makeGroup(u(0), "Old name").expect(201)).body;
    await u(0).raw("post", `/circles/default/friends/${made.id}/group/members`, { friendId }).expect(204);
    await u(1).raw("patch", `/circles/default/friends/${made.id}/group`, { name: "New name", description: "Books and tea" }).expect(204);
    for (const user of [u(0), u(1)]) expect(await entryOf(user, made.id)).toMatchObject({ name: "New name", description: "Books and tea" });
    expect((await u(0).raw("patch", `/circles/default/friends/${made.id}/group`, { name: "" })).status).toBe(400);
    expect((await u(2).raw("patch", `/circles/default/friends/${made.id}/group`, { name: "Not mine" })).status).toBe(404);
    expect((await groupDocOf(made.id))?.name).toBe("New name");
  });

  it("adds one of my friends: they get the group in a seat, everybody's count follows", async () => {
    const friendId = await connect(u(0), u(1));
    const made = (await makeGroup(u(0), "Club").expect(201)).body;
    await u(0).raw("post", `/circles/default/friends/${made.id}/group/members`, { friendId }).expect(204);
    expect(await entryOf(u(1), made.id)).toMatchObject({ group: true, name: "Club", members: 2, status: "confirmed", asleep: false });
    expect((await entryOf(u(1), made.id)).seat).not.toBeNull();
    expect((await entryOf(u(0), made.id)).members).toBe(2);
    const members = (await u(0).raw("get", `/circles/default/friends/${made.id}/group/members`).expect(200)).body;
    expect(members).toHaveLength(2);
    expect(members.find((m: { you: boolean }) => m.you)).toMatchObject({ uid: u(0).p.uid, creator: true, friendId: null });
    expect(members.find((m: { you: boolean }) => !m.you)).toMatchObject({ uid: u(1).p.uid, creator: false, friendId });
    expect((await u(0).raw("post", `/circles/default/friends/${made.id}/group/members`, { friendId })).status).toBe(409); // already in
  });

  it("a person I add has the group in their list at once and takes part: they read what is said after they joined, and what they say reaches the others", async () => {
    const friendId = await connect(u(0), u(1));
    const made = (await makeGroup(u(0), "Club").expect(201)).body;
    await u(0).send(made.id, "before");
    await u(0).raw("post", `/circles/default/friends/${made.id}/group/members`, { friendId }).expect(204);
    expect((await u(1).raw("get", "/circles/default/friends").expect(200)).body.friends.map((f: { id: string }) => f.id)).toContain(made.id);
    await u(0).send(made.id, "after");
    expect((await u(1).send(made.id, "hi from the new one")).status).toBe(201);
    const text = async (user: User) => {
      const body = (await user.feed(made.id).expect(200)).body;
      return (Array.isArray(body) ? body : body.messages).map((m: { text: string }) => m.text);
    };
    expect(await text(u(1))).toEqual(["after", "hi from the new one"]);
    expect(await text(u(0))).toEqual(["before", "after", "hi from the new one"]);
  });

  it("only adds a confirmed friend, and not when their list is full", async () => {
    const friendId = await connect(u(0), u(1));
    const made = (await makeGroup(u(0), "Club").expect(201)).body;
    expect((await u(0).raw("post", `/circles/default/friends/${made.id}/group/members`, { friendId: "nobody" })).status).toBe(400);
    expect((await u(0).raw("post", `/circles/default/friends/${made.id}/group/members`, { friendId: made.id })).status).toBe(400); // a group is no friend
    await fillCircle(u(1), MAX_FRIENDS - 1); // u(1) has u(0) and six more: all seven taken
    expect((await u(0).raw("post", `/circles/default/friends/${made.id}/group/members`, { friendId })).status).toBe(409);
    expect((await groupDocOf(made.id))?.members).toEqual({ [u(0).p.uid]: "default" });
  });

  it("is at most seven people", async () => {
    const made = (await makeGroup(u(0), "Seven").expect(201)).body;
    for (let n = 1; n <= 6; n++) {
      const f = await connect(u(0), u(n));
      await u(0).raw("post", `/circles/default/friends/${made.id}/group/members`, { friendId: f }).expect(204);
    }
    const eighth = await connect(u(1), u(7)); // u(0) has no seat left for another friend, so a member brings the eighth
    expect((await u(1).raw("post", `/circles/default/friends/${made.id}/group/members`, { friendId: eighth })).status).toBe(409);
    expect((await entryOf(u(0), made.id)).members).toBe(7);
  });

  it("removes a member: only the maker removes others, anyone leaves; the seat is freed and the count falls", async () => {
    const f1 = await connect(u(0), u(1));
    const f2 = await connect(u(0), u(2));
    const made = (await makeGroup(u(0), "Club").expect(201)).body;
    for (const f of [f1, f2]) await u(0).raw("post", `/circles/default/friends/${made.id}/group/members`, { friendId: f }).expect(204);
    expect((await u(1).raw("delete", `/circles/default/friends/${made.id}/group/members/${u(2).p.uid}`)).status).toBe(403);
    await u(0).raw("delete", `/circles/default/friends/${made.id}/group/members/${u(1).p.uid}`).expect(204);
    expect(await entryOf(u(1), made.id)).toBeUndefined();
    expect((await entryOf(u(0), made.id)).members).toBe(2);
    await u(2).raw("delete", `/circles/default/friends/${made.id}/group/members/${u(2).p.uid}`).expect(204);
    expect((await entryOf(u(0), made.id)).members).toBe(1);
    expect(Object.keys((await groupDocOf(made.id))?.members)).toEqual([u(0).p.uid]);
  });
});
