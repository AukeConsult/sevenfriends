import { getFirestore } from "firebase-admin/firestore";
import { beforeEach, describe, expect, it } from "vitest";
import { User, connect, seedPool } from "./helpers";

/** What a confirmed friend sees of my picture and icon: they follow what I change. */
let pool: User[];
let u: (n: number) => User;
beforeEach(async () => {
  pool = await seedPool();
  u = (n) => pool[n];
});

const jpeg = (size = 1000) => `data:image/jpeg;base64,${Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(size, 7)]).toString("base64")}`;
const friendOf = async (viewer: User, id: string) => (await viewer.friends()).find((f) => f.id === id)!;
const pictureOf = (viewer: User, id: string) => viewer.call("get", `/circles/default/friends/${id}/picture`);
const touched = async (viewer: User, id: string) =>
  (await getFirestore().collection("user-account").doc(viewer.p.uid).collection("friend-circle").doc("default").collection("friends").doc(id).get()).data()?.moodChangedAt;

describe("the friend's picture and icon", () => {
  it("none at first", async () => {
    const id = await connect(u(0), u(1));
    expect(await friendOf(u(0), id)).toMatchObject({ icon: null, pictureAt: null });
    expect((await pictureOf(u(0), id).expect(200)).body).toEqual({ image: null });
  });

  it("an uploaded picture is fetched by the friend, and the list says when it changed", async () => {
    const id = await connect(u(0), u(1));
    const image = jpeg();
    await u(1).raw("put", "/profile/picture", { image }).expect(200);
    const friend = await friendOf(u(0), id);
    expect(friend.pictureAt).toBeTruthy();
    expect((await pictureOf(u(0), id).expect(200)).body).toEqual({ image });

    await new Promise((r) => setTimeout(r, 10));
    await u(1).raw("put", "/profile/picture", { image: jpeg(2000) }).expect(200);
    expect((await friendOf(u(0), id)).pictureAt).not.toBe(friend.pictureAt); // a new version: the app fetches it again

    await u(1).raw("delete", "/profile/picture").expect(204);
    expect(await friendOf(u(0), id)).toMatchObject({ pictureAt: null });
    expect((await pictureOf(u(0), id).expect(200)).body).toEqual({ image: null });
  });

  it("the icon the friend chose is shown, and a change tells the friend's apps", async () => {
    const id = await connect(u(0), u(1));
    expect(await touched(u(0), id)).toBeUndefined();
    await u(1).raw("put", "/profile", { icon: 4 }).expect(200);
    expect((await friendOf(u(0), id)).icon).toBe(4);
    const first = await touched(u(0), id);
    expect(first).toBeTruthy(); // their app listens to this and reloads the list
    await new Promise((r) => setTimeout(r, 10));
    await u(1).raw("put", "/profile", { icon: 4 }).expect(200); // nothing changed: nobody is disturbed
    expect((await touched(u(0), id)).toMillis()).toBe(first.toMillis());
    await u(1).raw("put", "/profile", { icon: null }).expect(200);
    expect((await friendOf(u(0), id)).icon).toBeNull();
  });

  it("an upload or a removal tells the friend's apps too", async () => {
    const id = await connect(u(0), u(1));
    await u(1).raw("put", "/profile/picture", { image: jpeg() }).expect(200);
    const first = await touched(u(0), id);
    expect(first).toBeTruthy();
    await new Promise((r) => setTimeout(r, 10));
    await u(1).raw("delete", "/profile/picture").expect(204);
    expect((await touched(u(0), id)).toMillis()).toBeGreaterThan(first.toMillis());
  });

  it("only for confirmed friends: a pending one or a stranger has no picture to fetch", async () => {
    const entry = await u(0).add(u(1).p);
    await u(1).raw("put", "/profile/picture", { image: jpeg() }).expect(200);
    expect((await friendOf(u(0), entry.id))).toMatchObject({ icon: null, pictureAt: null });
    await pictureOf(u(0), entry.id).expect(404);
    await pictureOf(u(2), entry.id).expect(404);
  });
});
