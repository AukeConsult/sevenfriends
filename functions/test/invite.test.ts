import { beforeEach, describe, expect, it } from "vitest";
import { CODE_LENGTH, newCode } from "../src/invite";
import { User, seedPool } from "./helpers";

/** The invite link: a code of mine that lets somebody else send me a friend request. */
let pool: User[];
let u: (n: number) => User;

beforeEach(async () => {
  pool = await seedPool();
  u = (n) => pool[n];
});

const codeOf = async (user: User) => (await user.raw("get", "/invite/code").expect(200)).body.code as string;

describe("the code", () => {
  it("is long, from easy letters and digits, and different every time", () => {
    const codes = new Set(Array.from({ length: 200 }, newCode));
    expect(codes.size).toBe(200);
    for (const code of codes) expect(code).toMatch(new RegExp(`^[a-hj-km-np-z2-9]{${CODE_LENGTH}}$`));
  });

  it("is made the first time and then stays the same", async () => {
    const first = await codeOf(u(0));
    expect(await codeOf(u(0))).toBe(first);
    expect(await codeOf(u(1))).not.toBe(first); // everybody has their own
  });

  it("can be replaced: the old one stops working", async () => {
    const old = await codeOf(u(0));
    const fresh = (await u(0).raw("post", "/invite/code/reset").expect(200)).body.code;
    expect(fresh).not.toBe(old);
    expect(await codeOf(u(0))).toBe(fresh);
    await u(1).raw("get", `/invite/lookup/${old}`).expect(404);
    await u(1).raw("get", `/invite/lookup/${fresh}`).expect(200);
  });
});

describe("a request I receive", () => {
  it("shows the name the sender has now in that circle, not the one at the time it was sent", async () => {
    await u(0).add(u(1).p); // 0 asks 1 in friends
    expect((await u(1).waitingList()).concat(await u(1).seated())[0].fromName).toBe("Person 00");
    await u(0).raw("put", "/profile", { name: "Zero Renamed" }).expect(200);
    const after = (await u(1).waitingList()).concat(await u(1).seated());
    expect(after[0].fromName).toBe("Zero Renamed");
  });
});

describe("looking a code up", () => {
  it("gives the name and the contact details of the owner", async () => {
    const code = await codeOf(u(0));
    const res = await u(1).raw("get", `/invite/lookup/${code}`).expect(200);
    expect(res.body).toMatchObject({ self: false, name: "Person 00", email: "person00@test.dev" });
  });

  it("gives the name the owner has in the circle the link is opened in", async () => {
    const code = await codeOf(u(0));
    await u(0).raw("post", "/circles", { type: "buddies" }).expect(201);
    await u(0).raw("put", "/circles/buddies/profile", { name: "Buddy Zero" }).expect(200);
    const inBuddies = await u(1).raw("get", `/invite/lookup/${code}`).set("X-Circle", "buddies").expect(200);
    expect(inBuddies.body.name).toBe("Buddy Zero");
    const inFriends = await u(1).raw("get", `/invite/lookup/${code}`).expect(200);
    expect(inFriends.body.name).toBe("Person 00"); // the account name in friends
  });

  it("says when the owner has already sent ME a request, until I have answered it", async () => {
    const code = await codeOf(u(0));
    const lookup = async (user: User) => (await user.raw("get", `/invite/lookup/${code}`).expect(200)).body;
    expect((await lookup(u(1))).requestId).toBeNull(); // nobody has asked anybody

    await u(0).add(u(1).p); // 0 asks 1
    const [request] = (await u(1).check()).requests; // what happens when 1 opens the app
    expect((await lookup(u(1))).requestId).toBe(request.id);
    expect((await lookup(u(2))).requestId).toBeNull(); // a third person has no request from 0

    await u(1).raw("post", `/friend-requests/${request.id}/accept`).expect(200);
    expect((await lookup(u(1))).requestId).toBeNull(); // answered
  });

  it("only says 'self' for my own code", async () => {
    const code = await codeOf(u(0));
    const res = await u(0).raw("get", `/invite/lookup/${code}`).expect(200);
    expect(res.body).toEqual({ self: true });
  });

  it.each(["", "short", "ABCDEFGHJK", "0000000000", "abcdefghjkm", "abcdefghj!"])("refuses '%s'", async (bad) => {
    const res = await u(1).raw("get", `/invite/lookup/${bad || "x"}`);
    expect(res.status).toBe(404);
  });

  it("does not know a code nobody has", async () => {
    await u(1).raw("get", "/invite/lookup/abcdefghjk").expect(404);
  });

  it("needs a login", async () => {
    const res = await (await import("supertest")).default((await import("./helpers")).app).get("/api/invite/lookup/abcdefghjk");
    expect(res.status).toBe(401);
  });
});
