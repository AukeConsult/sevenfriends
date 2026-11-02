import { beforeEach, describe, expect, it } from "vitest";
import { MAX_NAME_LENGTH } from "../src/constants";
import { User, assertConsistent, connect, seedPool } from "./helpers";

/** The profile page: name, phone and social accounts. The page autosaves, so PUT gets the whole form again and again. */
let pool: User[];
let u: (n: number) => User;

beforeEach(async () => {
  pool = await seedPool();
  u = (n) => pool[n];
});

const profile = async (user: User) => (await user.raw("get", "/profile").expect(200)).body;

describe("the name", () => {
  it("starts as the name from the login, and can be changed", async () => {
    expect((await profile(u(0))).name).toBe("Person 00");

    const res = await u(0).raw("put", "/profile", { name: "  Alice Anderson  " });
    expect(res.status).toBe(200);
    expect(res.body.name).toBe("Alice Anderson"); // trimmed
    expect((await profile(u(0))).name).toBe("Alice Anderson");
    expect((await profile(u(1))).name).toBe("Person 01"); // only mine
  });

  it("stays after the next login (the login name is only the starting point)", async () => {
    await u(0).raw("put", "/profile", { name: "Alice" });
    await u(0).raw("post", "/users/sync").expect(200); // logging in again
    await u(0).raw("post", "/users/sync").expect(200);
    expect((await profile(u(0))).name).toBe("Alice");
  });

  it.each([
    ["empty", ""],
    ["only spaces", "    "],
    ["longer than 100 characters", "x".repeat(MAX_NAME_LENGTH + 1)],
  ])("cannot be %s, and the old name stays", async (_label, name) => {
    const res = await u(0).raw("put", "/profile", { name });
    expect(res.status).toBe(400);
    expect((await profile(u(0))).name).toBe("Person 00");
  });

  it("can be exactly 100 characters", async () => {
    const name = "y".repeat(MAX_NAME_LENGTH);
    expect((await u(0).raw("put", "/profile", { name })).body.name).toBe(name);
  });

  it("is left alone when a save does not mention it", async () => {
    await u(0).raw("put", "/profile", { name: "Alice" });
    const res = await u(0).raw("put", "/profile", { phone: u(0).p.phone });
    expect(res.body.name).toBe("Alice");
  });

  it("is what other people see: in requests, in their list and in messages", async () => {
    await u(0).raw("put", "/profile", { name: "Alice" });

    const mine = await u(0).add(u(1).p);
    const { requests } = await u(1).check();
    expect(requests).toEqual([expect.objectContaining({ id: mine.id, fromName: "Alice" })]); // the request
    expect((await u(1).friends())[0].name).toBe("Alice"); // the pending seat

    await u(1).confirm(mine.id);
    await u(0).send(mine.id, "hello");
    expect((await u(1).check()).messages[0].fromName).toBe("Alice"); // the message
    await assertConsistent();
  });

  it("changing it later does not rewrite what others already have (their copy keeps the old name)", async () => {
    const id = await connect(u(0), u(1));
    await u(0).raw("put", "/profile", { name: "Alice" });
    expect((await u(1).friends()).find((f) => f.id === id)?.name).toBe("Person 00");
    await u(0).send(id, "new name, new messages");
    expect((await u(1).check()).messages[0].fromName).toBe("Alice"); // from now on
  });
});

describe("autosave: the whole form is sent again and again", () => {
  const form = (user: User, extra: Record<string, unknown> = {}) => ({
    name: user.p.name,
    phone: user.p.phone,
    instagram: user.p.instagram,
    tiktok: user.p.tiktok,
    linkedin: user.p.linkedin,
    ...extra,
  });

  it("saving the same form twice changes nothing", async () => {
    const first = (await u(0).raw("put", "/profile", form(u(0), { telegram: "tg_zero" }))).body;
    const second = (await u(0).raw("put", "/profile", form(u(0), { telegram: "tg_zero" }))).body;
    expect(second).toEqual(first);
    expect(second).toMatchObject({ name: "Person 00", phone: u(0).p.phone, telegram: "tg_zero", facebook: null });
  });

  it("every field can be saved one after the other while typing", async () => {
    let last: Record<string, unknown> = {};
    for (const typed of ["A", "Al", "Ali", "Alic", "Alice"]) {
      last = (await u(0).raw("put", "/profile", form(u(0), { name: typed }))).body;
    }
    expect(last.name).toBe("Alice");
    expect((await profile(u(0))).name).toBe("Alice");
  });

  it("an invalid value is refused without touching the rest", async () => {
    await u(0).raw("put", "/profile", form(u(0), { name: "Alice" })).expect(200);
    expect((await u(0).raw("put", "/profile", form(u(0), { name: "Bob", phone: "abc" }))).status).toBe(400);
    const saved = await profile(u(0));
    expect(saved).toMatchObject({ name: "Alice", phone: u(0).p.phone }); // nothing half-saved
  });

  it("a cleared field is removed (and a social account was never used to find people anyway)", async () => {
    await u(0).raw("put", "/profile", form(u(0), { instagram: "" })).expect(200);
    expect((await profile(u(0))).instagram).toBeNull();
    await u(0).raw("put", "/profile", form(u(0), { instagram: u(0).p.instagram })).expect(200);
    expect((await profile(u(0))).instagram).toBe(u(0).p.instagram);
    await assertConsistent();
  });

});
