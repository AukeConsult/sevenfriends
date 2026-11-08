import { beforeEach, describe, expect, it } from "vitest";
import { MAX_FRIENDS } from "../src/constants";
import { User, assertConsistent, connect, fillCircle, seedPool } from "./helpers";

/** The message feed of a connection, in a pool of 60 people. */
let pool: User[];
let u: (n: number) => User;

beforeEach(async () => {
  pool = await seedPool();
  u = (n) => pool[n];
});

describe("who can message", () => {
  it("only confirmed connections: pending, waiting, rejected and unknown friends are refused", async () => {
    // pending, as the requester
    const pending = await u(0).add(u(1).p);
    expect((await u(0).send(pending.id, "hi")).status).toBe(403);
    expect((await u(0).feed(pending.id)).status).toBe(403);

    // pending, as the one who was asked
    await u(1).check();
    expect((await u(1).send(pending.id, "hi")).status).toBe(403);

    // rejected
    const rejected = await u(2).add(u(3).p);
    await u(3).check();
    await u(3).reject(rejected.id);
    expect((await u(2).send(rejected.id, "hi")).status).toBe(403);

    // waiting for a seat
    await fillCircle(u(5), MAX_FRIENDS);
    const waiting = await u(4).add(u(5).p);
    await u(5).check();
    expect((await u(4).send(waiting.id, "hi")).status).toBe(403);

    // not a friend at all
    expect((await u(0).send("nobody", "hi")).status).toBe(404);
    expect((await assertConsistent()).messages).toBe(0);
  });

  it("works for both people once the connection is confirmed", async () => {
    const id = await connect(u(0), u(1));
    expect((await u(0).send(id, "hello from 0")).status).toBe(201);
    expect((await u(1).send(id, "hello from 1")).status).toBe(201);
    await assertConsistent();
  });

  it("is private: nobody else can read or write the feed", async () => {
    const id = await connect(u(0), u(1));
    await u(0).send(id, "secret");
    expect((await u(2).feed(id)).status).toBe(404);
    expect((await u(2).send(id, "intruder")).status).toBe(404);
    expect((await u(1).feed(id)).body.messages).toHaveLength(1);
    expect((await assertConsistent()).messages).toBe(2); // one message = two copies
  });
});

describe("the feed", () => {
  it("shows the same conversation to both, oldest first, with mine / theirs mirrored", async () => {
    const id = await connect(u(0), u(1));
    for (const [who, text] of [[0, "one"], [1, "two"], [0, "three"], [1, "four"]] as const) {
      expect((await u(who).send(id, text)).status).toBe(201);
    }

    const a = (await u(0).feed(id)).body;
    const b = (await u(1).feed(id)).body;
    expect(a.friend).toEqual({ id, name: u(1).p.name }); // their own name, not the one typed when adding them
    expect(a.messages.map((m: { text: string }) => m.text)).toEqual(["one", "two", "three", "four"]);
    expect(b.messages.map((m: { text: string }) => m.text)).toEqual(["one", "two", "three", "four"]);
    expect(a.messages.map((m: { mine: boolean }) => m.mine)).toEqual([true, false, true, false]);
    expect(b.messages.map((m: { mine: boolean }) => m.mine)).toEqual([false, true, false, true]);
    expect(a.messages.map((m: { id: string }) => m.id)).toEqual(b.messages.map((m: { id: string }) => m.id)); // same message ids
    await assertConsistent();
  });

  it("keeps every connection's feed apart", async () => {
    const withOne = await connect(u(0), u(1));
    const withTwo = await connect(u(0), u(2), "phone");
    await u(0).send(withOne, "to one");
    await u(0).send(withTwo, "to two");
    await u(2).send(withTwo, "from two");

    expect((await u(0).feed(withOne)).body.messages.map((m: { text: string }) => m.text)).toEqual(["to one"]);
    expect((await u(0).feed(withTwo)).body.messages.map((m: { text: string }) => m.text)).toEqual(["to two", "from two"]);
    expect((await u(1).feed(withOne)).body.messages).toHaveLength(1);
    await assertConsistent();
  });

  it("shows only the latest 200 messages", async () => {
    const id = await connect(u(0), u(1));
    for (let i = 1; i <= 205; i++) await u(i % 2 ? 0 : 1).send(id, `message ${i}`);
    const { messages } = (await u(0).feed(id)).body;
    expect(messages).toHaveLength(200);
    expect(messages[0].text).toBe("message 6");
    expect(messages[199].text).toBe("message 205");
    await assertConsistent();
  });
});

describe("writing a message", () => {
  it.each([
    ["nothing", ""],
    ["only spaces", "   \n  "],
    ["more than 2000 characters", "x".repeat(2001)],
  ])("refuses %s", async (_label, text) => {
    const id = await connect(u(0), u(1));
    expect((await u(0).send(id, text)).status).toBe(400);
    expect((await u(0).feed(id)).body.messages).toEqual([]);
  });

  it("accepts exactly 2000 characters and trims the ends", async () => {
    const id = await connect(u(0), u(1));
    expect((await u(0).send(id, "y".repeat(2000))).status).toBe(201);
    const sent = await u(0).send(id, "  hello  ");
    expect(sent.body.text).toBe("hello");
  });
});

describe("unread messages", () => {
  it("reach the other person's Home check with the connection id; my own are never unread", async () => {
    const id = await connect(u(0), u(1));
    await u(0).send(id, "are you there?");

    const { messages } = await u(1).check();
    expect(messages).toEqual([expect.objectContaining({ text: "are you there?", fromName: "Person 00", connectionId: id })]);
    expect((await u(0).check()).messages).toEqual([]); // the sender has nothing unread
  });

  it("opening the feed marks the other person's messages as read", async () => {
    const id = await connect(u(0), u(1));
    await u(0).send(id, "one");
    await u(0).send(id, "two");
    await u(1).send(id, "an answer");
    expect((await u(1).check()).messages).toHaveLength(2);
    expect((await u(0).check()).messages).toHaveLength(1);

    const res = await u(1).markFeedRead(id);
    expect(res.body).toMatchObject({ ok: true, marked: 2 });
    expect((await u(1).check()).messages).toEqual([]);
    expect((await u(0).check()).messages).toHaveLength(1); // their own unread is untouched
    expect((await u(1).markFeedRead(id)).body.marked).toBe(0); // nothing left to mark
  });

  it("only affects that connection", async () => {
    const withOne = await connect(u(0), u(1));
    const withTwo = await connect(u(0), u(2));
    await u(1).send(withOne, "from one");
    await u(2).send(withTwo, "from two");
    await u(0).markFeedRead(withOne);
    expect((await u(0).check()).messages.map((m) => m.text)).toEqual(["from two"]);
  });
});

describe("deleting the connection", () => {
  it.each([
    ["the requester", 0],
    ["the other person", 1],
  ])("deleted by %s removes the whole feed on both sides, and leaves other feeds alone", async (_who, deleter) => {
    const gone = await connect(u(0), u(1));
    const kept = await connect(u(0), u(2));
    await u(0).send(gone, "to 1");
    await u(1).send(gone, "to 0");
    await u(0).send(kept, "stays");

    expect((await u(deleter).remove(gone)).status).toBe(204);
    expect((await u(0).send(gone, "anyone?")).status).toBe(404); // the connection is gone for both
    expect((await u(1).feed(gone)).status).toBe(404);

    expect((await u(0).feed(kept)).body.messages.map((m: { text: string }) => m.text)).toEqual(["stays"]);
    expect((await assertConsistent()).messages).toBe(2); // only "stays" (2 copies) is left
  });
});
