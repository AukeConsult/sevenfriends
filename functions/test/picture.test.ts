import { getFirestore } from "firebase-admin/firestore";
import { beforeEach, describe, expect, it } from "vitest";
import request from "supertest";
import { User, seedPool, server } from "./helpers";

/** The picture a person uploads for their profile: a small image, kept in its own document. */
let pool: User[];
let u: (n: number) => User;
beforeEach(async () => {
  pool = await seedPool();
  u = (n) => pool[n];
});

const dataUrl = (type: string, bytes: Buffer) => `data:image/${type};base64,${bytes.toString("base64")}`;
/** the first bytes of a real file of that type, then filler: enough to pass the check of the first bytes */
const jpeg = (size = 2000) => Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(size, 7)]);
const png = (size = 2000) => Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(size, 7)]);
const webp = (size = 2000) => Buffer.concat([Buffer.from("RIFF"), Buffer.from([0, 0, 0, 0]), Buffer.from("WEBP"), Buffer.alloc(size, 7)]);

const put = (user: User, image: unknown) => user.raw("put", "/profile/picture", { image });
const get = (user: User) => user.raw("get", "/profile/picture");

describe("my picture", () => {
  it("none at first", async () => {
    expect((await get(u(0)).expect(200)).body).toEqual({ image: null });
    expect((await u(0).raw("get", "/profile").expect(200)).body.hasPicture).toBe(false);
  });

  it.each([["jpeg", jpeg], ["png", png], ["webp", webp]])("a %s is saved and read back", async (type, make) => {
    const image = dataUrl(type, make());
    expect((await put(u(0), image).expect(200)).body).toEqual({ image });
    expect((await get(u(0)).expect(200)).body).toEqual({ image });
    expect((await u(0).raw("get", "/profile").expect(200)).body.hasPicture).toBe(true);
  });

  it("a new picture replaces the old one, and it can be removed", async () => {
    await put(u(0), dataUrl("jpeg", jpeg(1000))).expect(200);
    const second = dataUrl("png", png(3000));
    await put(u(0), second).expect(200);
    expect((await get(u(0))).body.image).toBe(second);

    await u(0).raw("delete", "/profile/picture").expect(204);
    expect((await get(u(0))).body.image).toBeNull();
    expect((await u(0).raw("get", "/profile")).body.hasPicture).toBe(false);
  });

  it("everybody has their own", async () => {
    await put(u(0), dataUrl("jpeg", jpeg())).expect(200);
    expect((await get(u(1))).body.image).toBeNull();
    expect((await u(1).raw("get", "/profile")).body.hasPicture).toBe(false);
  });

  it("the picture does not weigh on the account document", async () => {
    await put(u(0), dataUrl("jpeg", jpeg(50000))).expect(200);
    const account = (await getFirestore().collection("user-account").doc("uid00").get()).data()!;
    expect(JSON.stringify(account).length).toBeLessThan(5000);
  });
});

describe("what is refused", () => {
  const ok = dataUrl("jpeg", jpeg(500));
  beforeEach(async () => { await put(u(0), ok).expect(200); });

  it.each([
    ["no image", undefined],
    ["a number", 42],
    ["plain text", "hello"],
    ["a gif", `data:image/gif;base64,${Buffer.from("GIF89a....").toString("base64")}`],
    ["an svg (it can carry scripts)", `data:image/svg+xml;base64,${Buffer.from("<svg onload='x'/>").toString("base64")}`],
    ["a web address", "https://example.com/me.jpg"],
    ["not base64", "data:image/jpeg;base64,@@@@"],
    ["text that says it is a jpeg", dataUrl("jpeg", Buffer.from("this is not an image at all"))],
    ["a png that is a jpeg", dataUrl("png", jpeg())],
    ["a webp that is a png", dataUrl("webp", png())],
    ["an empty image", "data:image/jpeg;base64,"],
  ])("refuses %s, and keeps the old picture", async (_label, image) => {
    await put(u(0), image).expect(400);
    expect((await get(u(0))).body.image).toBe(ok);
  });

  it("refuses a picture that is too big (over 70 KB)", async () => {
    const res = await put(u(0), dataUrl("jpeg", jpeg(71 * 1024))).expect(400);
    expect(res.body.error).toMatch(/too big/);
    expect((await get(u(0))).body.image).toBe(ok);
  });

  it("takes one just under the limit", async () => {
    await put(u(0), dataUrl("jpeg", jpeg(69 * 1024))).expect(200);
  });

  it("needs a login", async () => {
    await request(server()).get("/api/profile/picture").expect(401);
    await request(server()).put("/api/profile/picture").send({ image: ok }).expect(401);
    await request(server()).delete("/api/profile/picture").expect(401);
  });
});

describe("deleting an account", () => {
  it("removes the picture too", async () => {
    await put(u(0), dataUrl("jpeg", jpeg())).expect(200);
    await u(0).raw("delete", "/users/me", { confirm: "DELETE" }).expect(204);
    expect((await getFirestore().collectionGroup("profile-picture").get()).docs).toEqual([]);
  });
});
