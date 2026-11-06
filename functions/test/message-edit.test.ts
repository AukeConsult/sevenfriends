import { Timestamp, getFirestore } from "firebase-admin/firestore";
import { beforeEach, describe, expect, it } from "vitest";
import { MAX_MESSAGE_LENGTH } from "../src/conversation";
import { User, connect, seedPool } from "./helpers";

/** Edit and delete one of my own messages. */
let pool: User[];
let u: (n: number) => User;
beforeEach(async () => {
  pool = await seedPool();
  u = (n) => pool[n];
});

const url = (id: string, messageId: string) => `/circles/default/friends/${id}/messages/${messageId}`;
const feedOf = async (user: User, id: string) => (await user.feed(id).expect(200)).body.messages as { id: string; text: string; edited: boolean; mine: boolean }[];
const sendOne = async (user: User, id: string, text: string) => (await user.send(id, text).expect(201)).body.id as string;

describe("edit a message", () => {
  it("changes the text for both people and marks it as edited", async () => {
    const id = await connect(u(0), u(1));
    const m = await sendOne(u(0), id, "helo");
    const res = await u(0).call("put", url(id, m), { text: "hello" }).expect(200);
    expect(res.body).toMatchObject({ id: m, text: "hello", edited: true, mine: true });
    expect((await feedOf(u(0), id))[0]).toMatchObject({ text: "hello", edited: true });
    expect((await feedOf(u(1), id))[0]).toMatchObject({ text: "hello", edited: true, mine: false });
  });

  it("a message that was never edited is not marked", async () => {
    const id = await connect(u(0), u(1));
    await sendOne(u(0), id, "plain");
    expect((await feedOf(u(1), id))[0].edited).toBe(false);
  });

  it("only my own: the friend's message is refused, an unknown one is not found", async () => {
    const id = await connect(u(0), u(1));
    const theirs = await sendOne(u(1), id, "from them");
    await u(0).call("put", url(id, theirs), { text: "mine now" }).expect(403);
    await u(0).call("delete", url(id, theirs)).expect(403);
    await u(0).call("put", url(id, "nope"), { text: "x" }).expect(404);
    expect((await feedOf(u(1), id))[0].text).toBe("from them");
  });

  it("the same rules as sending: not empty, not too long", async () => {
    const id = await connect(u(0), u(1));
    const m = await sendOne(u(0), id, "ok");
    await u(0).call("put", url(id, m), { text: "   " }).expect(400);
    await u(0).call("put", url(id, m), { text: "x".repeat(MAX_MESSAGE_LENGTH + 1) }).expect(400);
    expect((await feedOf(u(0), id))[0].text).toBe("ok");
  });

  it("an outsider cannot touch it (the connection is not even found for them)", async () => {
    const id = await connect(u(0), u(1));
    const m = await sendOne(u(0), id, "private");
    await u(2).call("put", url(id, m), { text: "hacked" }).expect(404);
    await u(2).call("delete", url(id, m)).expect(404);
  });
});

describe("delete a message", () => {
  it("it is gone for both people, and the others stay", async () => {
    const id = await connect(u(0), u(1));
    const keep = await sendOne(u(0), id, "keep");
    const gone = await sendOne(u(0), id, "gone");
    await u(0).call("delete", url(id, gone)).expect(204);
    expect((await feedOf(u(0), id)).map((m) => m.id)).toEqual([keep]);
    expect((await feedOf(u(1), id)).map((m) => m.id)).toEqual([keep]);
    await u(0).call("delete", url(id, gone)).expect(404); // already gone
  });

  it("an unread message leaves the friend's unread list", async () => {
    const id = await connect(u(0), u(1));
    const m = await sendOne(u(0), id, "oops");
    expect((await u(1).check()).messages).toHaveLength(1);
    await u(0).call("delete", url(id, m)).expect(204);
    expect((await u(1).check()).messages).toHaveLength(0);
  });
});

describe("the friend's app is told", () => {
  it("an edit or a delete touches the friend's copy of the friendship, so their open feed reloads", async () => {
    const id = await connect(u(0), u(1));
    const m = await sendOne(u(0), id, "first");
    const touched = async () => (await getFirestore().collection("user-account").doc(u(1).p.uid).collection("friend-circle").doc("default").collection("friends").doc(id).get()).data()?.messagesChangedAt;
    expect(await touched()).toBeUndefined(); // a new message is announced by its own copy, not by this
    await u(0).call("put", url(id, m), { text: "second" }).expect(200);
    const afterEdit = await touched();
    expect(afterEdit).toBeTruthy();
    await new Promise((r) => setTimeout(r, 10));
    await u(0).call("delete", url(id, m)).expect(204);
    expect((await touched()).toMillis()).toBeGreaterThan(afterEdit.toMillis());
  });
});

describe("delete several messages", () => {
  const bulk = (user: User, id: string, body: Record<string, unknown>) => user.call("post", `/circles/default/friends/${id}/messages/delete`, body);
  const age = async (user: User, other: User, messageId: string, days: number) => {
    const time = Timestamp.fromMillis(Date.now() - days * 86_400_000);
    for (const owner of [user, other]) await getFirestore().collection("user-account").doc(owner.p.uid).collection("messages").doc(messageId).update({ time });
  };

  it("counts without deleting (dry run), then deletes the matching ones for both people", async () => {
    const id = await connect(u(0), u(1));
    const old1 = await sendOne(u(0), id, "old one");
    const old2 = await sendOne(u(0), id, "old two");
    const fresh = await sendOne(u(0), id, "fresh");
    await age(u(0), u(1), old1, 40);
    await age(u(0), u(1), old2, 10);

    expect((await bulk(u(0), id, { olderThanDays: 30, dryRun: true }).expect(200)).body).toEqual({ matched: 1, deleted: 0 });
    expect((await feedOf(u(0), id)).length).toBe(3); // nothing happened

    expect((await bulk(u(0), id, { olderThanDays: 7 }).expect(200)).body).toEqual({ matched: 2, deleted: 2 });
    expect((await feedOf(u(0), id)).map((m) => m.id)).toEqual([fresh]);
    expect((await feedOf(u(1), id)).map((m) => m.id)).toEqual([fresh]);
  });

  it("by text (any capitals), and with nothing given it is all of my messages", async () => {
    const id = await connect(u(0), u(1));
    await sendOne(u(0), id, "Pizza tonight?");
    await sendOne(u(0), id, "see you");
    expect((await bulk(u(0), id, { contains: "PIZZA", dryRun: true }).expect(200)).body.matched).toBe(1);
    expect((await bulk(u(0), id, { contains: "pizza" }).expect(200)).body.deleted).toBe(1);
    expect((await feedOf(u(0), id)).map((m) => m.text)).toEqual(["see you"]);
    expect((await bulk(u(0), id, {}).expect(200)).body.deleted).toBe(1);
    expect(await feedOf(u(0), id)).toEqual([]);
  });

  it("whose: mine is the default, both is the whole conversation (never the friend's alone); always on both sides", async () => {
    const id = await connect(u(0), u(1));
    const mine = await sendOne(u(0), id, "mine");
    await sendOne(u(1), id, "theirs");
    expect((await bulk(u(0), id, { dryRun: true }).expect(200)).body.matched).toBe(1); // no choice = mine
    expect((await bulk(u(0), id, { whose: "both", dryRun: true }).expect(200)).body.matched).toBe(2);
    await bulk(u(0), id, { whose: "theirs" }).expect(400); // the friend's messages alone cannot be chosen
    expect((await bulk(u(0), id, { whose: "both", contains: "THEIRS" }).expect(200)).body.deleted).toBe(1);
    expect((await feedOf(u(0), id)).map((m) => m.id)).toEqual([mine]);
    expect((await feedOf(u(1), id)).map((m) => m.id)).toEqual([mine]); // gone for the friend too
    expect((await bulk(u(0), id, { whose: "both" }).expect(200)).body.deleted).toBe(1);
    expect(await feedOf(u(1), id)).toEqual([]);
  });

  it("only my own messages go by default: the friend's stay", async () => {
    const id = await connect(u(0), u(1));
    await sendOne(u(0), id, "mine");
    const theirs = await sendOne(u(1), id, "theirs");
    expect((await bulk(u(0), id, {}).expect(200)).body.deleted).toBe(1);
    expect((await feedOf(u(1), id)).map((m) => m.id)).toEqual([theirs]);
  });

  it("many messages are deleted in chunks", async () => {
    const id = await connect(u(0), u(1));
    for (let i = 0; i < 230; i++) await sendOne(u(0), id, `message ${i}`);
    expect((await bulk(u(0), id, {}).expect(200)).body).toEqual({ matched: 230, deleted: 230 });
    expect(await feedOf(u(1), id)).toEqual([]);
  }, 60_000);

  it("refuses bad criteria, and an outsider does not find the connection", async () => {
    const id = await connect(u(0), u(1));
    await bulk(u(0), id, { olderThanDays: 0 }).expect(400);
    await bulk(u(0), id, { olderThanDays: 1.5 }).expect(400);
    await bulk(u(0), id, { olderThanDays: "7" }).expect(400);
    await bulk(u(0), id, { whose: "everyone" }).expect(400);
    await bulk(u(2), id, {}).expect(404);
  });

  it("tells the friend's app once, so an open feed reloads", async () => {
    const id = await connect(u(0), u(1));
    await sendOne(u(0), id, "a");
    await bulk(u(0), id, {}).expect(200);
    const entry = (await getFirestore().collection("user-account").doc(u(1).p.uid).collection("friend-circle").doc("default").collection("friends").doc(id).get()).data();
    expect(entry?.messagesChangedAt).toBeTruthy();
  });
});

describe("hide a picture or video", () => {
  const hiddenOf = async (user: User, id: string) => (await user.feed(id).expect(200)).body.messages[0].hidden as boolean;

  it("is kept on my copy only: the friend's feed is not affected, and it can be shown again", async () => {
    const id = await connect(u(0), u(1));
    const m = await sendOne(u(0), id, "look");
    expect(await hiddenOf(u(1), id)).toBe(false);
    await u(1).call("put", `${url(id, m)}/hidden`, { hidden: true }).expect(200);
    expect(await hiddenOf(u(1), id)).toBe(true);
    expect(await hiddenOf(u(0), id)).toBe(false);
    await u(1).call("put", `${url(id, m)}/hidden`, { hidden: false }).expect(200);
    expect(await hiddenOf(u(1), id)).toBe(false);
  });

  it("needs true or false, and an existing message", async () => {
    const id = await connect(u(0), u(1));
    const m = await sendOne(u(0), id, "look");
    await u(0).call("put", `${url(id, m)}/hidden`, { hidden: "yes" }).expect(400);
    await u(0).call("put", `${url(id, "nope")}/hidden`, { hidden: true }).expect(404);
  });
});
