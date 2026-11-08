import { getFirestore } from "firebase-admin/firestore";
import { beforeEach, describe, expect, it } from "vitest";
import { User, person, seedPool, server } from "./helpers";

/** Sounds are kept on the account, so they follow the person to every device. */
let pool: User[];
let u: (n: number) => User;
beforeEach(async () => {
  pool = await seedPool();
  u = (n) => pool[n];
});

const mine = { message: "file:Happy_birthday.mp3", request: "chime", answer: "none", volume: 65 };
const allOn = { message: true, request: true, answer: true, removed: true, hideText: false };
const get = (user: User) => user.raw("get", "/preferences");
const put = (user: User, body: object) => user.raw("put", "/preferences/sounds", body);

describe("sound preferences on the account", () => {
  it("nothing chosen yet: null", async () => {
    expect((await get(u(0)).expect(200)).body).toEqual({ sounds: null, notices: allOn });
  });

  it("saved, and read back on any device", async () => {
    expect((await put(u(0), mine).expect(200)).body).toEqual({ sounds: mine });
    expect((await get(u(0)).expect(200)).body).toEqual({ sounds: mine, notices: allOn });
  });

  it("changing it replaces it", async () => {
    await put(u(0), mine).expect(200);
    await put(u(0), { ...mine, message: "bell", volume: 100 }).expect(200);
    expect((await get(u(0))).body.sounds).toEqual({ ...mine, message: "bell", volume: 100 });
  });

  it("everybody has their own", async () => {
    await put(u(0), mine).expect(200);
    expect((await get(u(1))).body).toEqual({ sounds: null, notices: allOn });
  });

  it.each([
    ["an unknown sound", { ...mine, message: "siren" }],
    ["a file name with a folder", { ...mine, request: "file:../secret.mp3" }],
    ["a file name with a backslash", { ...mine, request: "file:a\\b.mp3" }],
    ["an empty file name", { ...mine, answer: "file:" }],
    ["a missing sound", { request: "chime", answer: "none", volume: 50 }],
    ["a volume over 100", { ...mine, volume: 101 }],
    ["a negative volume", { ...mine, volume: -1 }],
    ["a volume with decimals", { ...mine, volume: 50.5 }],
    ["a volume as text", { ...mine, volume: "50" }],
  ])("refuses %s, and saves nothing", async (_label, body) => {
    await put(u(0), { message: "ding", request: "ding", answer: "ding", volume: 40 }).expect(200);
    await put(u(0), body).expect(400);
    expect((await get(u(0))).body.sounds).toEqual({ message: "ding", request: "ding", answer: "ding", volume: 40 });
  });

  it("needs a login", async () => {
    const request = (await import("supertest")).default;
    await request(server()).get("/api/preferences").expect(401);
    await request(server()).put("/api/preferences/sounds").send(mine).expect(401);
  });

  it("is gone with the account", async () => {
    await put(u(0), mine).expect(200);
    await u(0).raw("delete", "/users/me", { confirm: "DELETE" }).expect(204);
    expect((await getFirestore().collection("user-account").doc("uid00").get()).exists).toBe(false);
  });

  it("an account that never existed in the database can still save (merge)", async () => {
    const newcomer = new User(person(80), {});
    await put(newcomer, mine).expect(200);
    expect((await get(newcomer)).body.sounds).toEqual(mine);
  });
});

describe("the profile says whether the email is verified", () => {
  it("verified: true; not verified: false (the address itself is still known)", async () => {
    expect((await u(0).raw("get", "/profile").expect(200)).body.emailVerified).toBe(true);
    const unverified = await new User(person(81), { emailVerified: false, phoneVerified: false }).signUp();
    expect((await unverified.raw("get", "/profile").expect(200)).body.emailVerified).toBe(false);
  });
});

describe("notification choices on the account", () => {
  const putNotices = (user: User, body: object) => user.raw("put", "/preferences/notices", body);
  const quiet = { message: false, request: true, answer: true, removed: false, hideText: true };

  it("saved, read back, and everybody has their own", async () => {
    expect((await putNotices(u(0), quiet).expect(200)).body).toEqual({ notices: quiet });
    expect((await get(u(0)).expect(200)).body.notices).toEqual(quiet);
    expect((await get(u(1)).expect(200)).body.notices).toEqual(allOn);
  });

  it("a choice that is not true or false, or a missing one, is refused and nothing changes", async () => {
    await putNotices(u(0), { ...quiet, message: "no" }).expect(400);
    await putNotices(u(0), { message: false }).expect(400);
    expect((await get(u(0)).expect(200)).body.notices).toEqual(allOn);
  });

  it("saving the notices does not touch the sounds, and the other way round", async () => {
    await put(u(0), mine).expect(200);
    await putNotices(u(0), quiet).expect(200);
    await put(u(0), { ...mine, volume: 10 }).expect(200);
    const body = (await get(u(0)).expect(200)).body;
    expect(body.sounds).toEqual({ ...mine, volume: 10 });
    expect(body.notices).toEqual(quiet);
  });
});
