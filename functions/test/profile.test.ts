import { beforeEach, describe, expect, it } from "vitest";
import { MAX_NAME_LENGTH } from "../src/constants";
import { User, assertConsistent, connect, seedPool } from "./helpers";

/** The profile page: name and phone. The page autosaves, so PUT gets the whole form again and again. */
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
    ...extra,
  });

  it("saving the same form twice changes nothing", async () => {
    const first = (await u(0).raw("put", "/profile", form(u(0)))).body;
    const second = (await u(0).raw("put", "/profile", form(u(0)))).body;
    expect(second).toEqual(first);
    expect(second).toMatchObject({ name: "Person 00", phone: u(0).p.phone });
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

  it("a cleared phone number is removed, and saved again when it is typed again", async () => {
    await u(0).raw("put", "/profile", form(u(0), { phone: "" })).expect(200);
    expect((await profile(u(0))).phone).toBeNull();
    await u(0).raw("put", "/profile", form(u(0))).expect(200);
    expect((await profile(u(0))).phone).toBe(u(0).p.phone);
    await assertConsistent();
  });

});

describe("my own icon", () => {
  it("none at first; one of the seven can be chosen, changed and removed", async () => {
    const { seedPool } = await import("./helpers");
    const me = (await seedPool())[0];
    expect((await me.raw("get", "/profile").expect(200)).body.icon).toBeNull();
    expect((await me.raw("put", "/profile", { icon: 3 }).expect(200)).body.icon).toBe(3);
    expect((await me.raw("get", "/profile").expect(200)).body.icon).toBe(3);
    expect((await me.raw("put", "/profile", { phone: "+4790000000" }).expect(200)).body.icon).toBe(3); // left out = unchanged
    expect((await me.raw("put", "/profile", { icon: 7 }).expect(200)).body.icon).toBe(7);
    expect((await me.raw("put", "/profile", { icon: null }).expect(200)).body.icon).toBeNull();
  });

  it.each([[0], [8], [-1], [2.5], ["3"], [true]])("refuses %s and keeps the old icon", async (bad) => {
    const { seedPool } = await import("./helpers");
    const me = (await seedPool())[0];
    await me.raw("put", "/profile", { icon: 2 }).expect(200);
    await me.raw("put", "/profile", { icon: bad }).expect(400);
    expect((await me.raw("get", "/profile")).body.icon).toBe(2);
  });

  it("everybody has their own", async () => {
    const { seedPool } = await import("./helpers");
    const pool = await seedPool();
    await pool[0].raw("put", "/profile", { icon: 5 }).expect(200);
    expect((await pool[1].raw("get", "/profile")).body.icon).toBeNull();
  });
});

describe("my country", () => {
  it("not set at first; set, kept when left out, changed and removed", async () => {
    const { seedPool } = await import("./helpers");
    const me = (await seedPool())[0];
    expect((await me.raw("get", "/profile").expect(200)).body.country).toBeNull();
    expect((await me.raw("put", "/profile", { country: "NO" }).expect(200)).body.country).toBe("NO");
    expect((await me.raw("put", "/profile", { phone: "+4790000000" }).expect(200)).body.country).toBe("NO"); // left out = unchanged
    expect((await me.raw("put", "/profile", { country: "XK" }).expect(200)).body.country).toBe("XK");
    expect((await me.raw("put", "/profile", { country: "" }).expect(200)).body.country).toBeNull();
    await me.raw("put", "/profile", { country: "SE" }).expect(200);
    expect((await me.raw("put", "/profile", { country: null }).expect(200)).body.country).toBeNull();
  });

  it.each([["no"], ["NOR"], ["ZZ"], ["AA"], ["N1"], [" "], [7], [true]])("refuses %j, and keeps the old country", async (bad) => {
    const { seedPool } = await import("./helpers");
    const me = (await seedPool())[0];
    await me.raw("put", "/profile", { country: "DK" }).expect(200);
    const res = await me.raw("put", "/profile", { country: bad });
    // a blank string means "not set", the rest is refused
    if (typeof bad === "string" && !bad.trim()) expect(res.status).toBe(200);
    else expect(res.status).toBe(400);
    expect((await me.raw("get", "/profile")).body.country).toBe(typeof bad === "string" && !bad.trim() ? null : "DK");
  });

  it("everybody has their own", async () => {
    const { seedPool } = await import("./helpers");
    const pool = await seedPool();
    await pool[0].raw("put", "/profile", { country: "FI" }).expect(200);
    expect((await pool[1].raw("get", "/profile")).body.country).toBeNull();
  });
});

describe("a save only changes what it carries", () => {
  it("leaving the phone, the country and the icon out keeps them", async () => {
    const { User, person, seedPool } = await import("./helpers");
    await seedPool();
    const me = await new User(person(90), { emailVerified: true, phoneVerified: false }).signUp(); // typed phone, not confirmed
    await me.raw("put", "/profile", { phone: "+4790000090", country: "NO", icon: 5 }).expect(200);

    const saved = (await me.raw("put", "/profile", { name: "Only the name" }).expect(200)).body;
    expect(saved).toMatchObject({ name: "Only the name", phone: "+4790000090", country: "NO", icon: 5 });
  });

  it("a value sent as null or empty is removed, and only that one", async () => {
    const { User, person, seedPool } = await import("./helpers");
    await seedPool();
    const me = await new User(person(91), { emailVerified: true, phoneVerified: false }).signUp();
    await me.raw("put", "/profile", { phone: "+4790000091", country: "NO" }).expect(200);
    const saved = (await me.raw("put", "/profile", { country: null }).expect(200)).body;
    expect(saved).toMatchObject({ phone: "+4790000091", country: null });
    expect((await me.raw("put", "/profile", { phone: null }).expect(200)).body).toMatchObject({ phone: null, country: null });
  });
});

describe("my language", () => {
  it("not chosen at first; chosen, kept when left out, changed and removed", async () => {
    const { seedPool } = await import("./helpers");
    const me = (await seedPool())[0];
    expect((await me.raw("get", "/profile").expect(200)).body.language).toBeNull();
    expect((await me.raw("put", "/profile", { language: "nb" }).expect(200)).body.language).toBe("nb");
    expect((await me.raw("put", "/profile", { country: "NO" }).expect(200)).body.language).toBe("nb"); // left out = unchanged
    expect((await me.raw("put", "/profile", { language: "fr" }).expect(200)).body.language).toBe("fr");
    expect((await me.raw("put", "/profile", { language: "" }).expect(200)).body.language).toBeNull();
    await me.raw("put", "/profile", { language: "es" }).expect(200);
    expect((await me.raw("put", "/profile", { language: null }).expect(200)).body.language).toBeNull();
  });

  it.each([["xx"], ["NB"], ["nob"], ["en-GB"], [7], [true]])("refuses %j, and keeps the old language", async (bad) => {
    const { seedPool } = await import("./helpers");
    const me = (await seedPool())[0];
    await me.raw("put", "/profile", { language: "de" }).expect(200);
    await me.raw("put", "/profile", { language: bad }).expect(400);
    expect((await me.raw("get", "/profile")).body.language).toBe("de");
  });
});
