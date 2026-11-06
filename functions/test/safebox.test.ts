import { getFirestore } from "firebase-admin/firestore";
import { beforeEach, describe, expect, it } from "vitest";
import { storedData, storedNames } from "./fake-storage";
import { User, connect, seedPool } from "./helpers";

/** The safebox: files only the two friends of a confirmed friendship reach. */
let pool: User[];
let u: (n: number) => User;
beforeEach(async () => {
  pool = await seedPool();
  u = (n) => pool[n];
});

const filler = (size: number) => Buffer.alloc(size, 7);
const png = (size = 2000) => Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), filler(size)]);
const jpeg = (size = 500) => Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), filler(size)]);
const pdf = () => Buffer.concat([Buffer.from("%PDF-1.7\n"), filler(500)]);
const zip = () => Buffer.concat([Buffer.from([0x50, 0x4b, 3, 4]), filler(500)]);
const text = () => Buffer.from("Shopping list\n- milk\n- eggs\n");

const box = (id: string, rest = "") => `/circles/default/friends/${id}/safebox${rest}`;
const put = (user: User, id: string, bytes: Buffer, name?: string) => user.file("post", `${box(id)}${name ? `?name=${encodeURIComponent(name)}` : ""}`, bytes);
const listOf = async (user: User, id: string) => (await user.raw("get", box(id)).expect(200)).body as { items: { id: string; name: string; kind: string; mine: boolean; bytes: number; hasThumb: boolean }[]; usedBytes: number; maxBytes: number };
const stored = () => storedNames().filter((n) => n.startsWith("sf-cache/box-"));
const download = (user: User, id: string, itemId: string, rest = "") =>
  user.raw("get", box(id, `/${itemId}${rest}`)).buffer(true).parse((res, done) => {
    const parts: Buffer[] = [];
    res.on("data", (c: Buffer) => parts.push(c));
    res.on("end", () => done(null, Buffer.concat(parts)));
  });

describe("putting files in the box", () => {
  it("stores the file under the id of the friendship and lists it for both friends", async () => {
    const id = await connect(u(0), u(1));
    const item = (await put(u(0), id, png(), "holiday.png").expect(201)).body;
    expect(item).toMatchObject({ name: "holiday.png", kind: "image", mime: "image/png", bytes: png().length, mine: true, hasThumb: false });
    expect(stored()).toEqual([`sf-cache/box-${id}/${item.id}`]);
    expect((await listOf(u(0), id)).items).toMatchObject([{ id: item.id, mine: true }]);
    expect((await listOf(u(1), id)).items).toMatchObject([{ id: item.id, mine: false }]);
    expect((await listOf(u(1), id)).usedBytes).toBe(png().length);
  });

  it("knows documents from their first bytes: pdf, zip and plain text", async () => {
    const id = await connect(u(0), u(1));
    expect((await put(u(0), id, pdf(), "a.pdf").expect(201)).body).toMatchObject({ kind: "document", mime: "application/pdf" });
    expect((await put(u(0), id, zip(), "b.docx").expect(201)).body).toMatchObject({ kind: "document", mime: "application/zip" });
    expect((await put(u(0), id, text(), "c.txt").expect(201)).body).toMatchObject({ kind: "document", mime: "text/plain; charset=utf-8" });
  });

  it("refuses what it does not know, and an empty file", async () => {
    const id = await connect(u(0), u(1));
    await put(u(0), id, Buffer.from([1, 2, 3, 0, 0, 9, 9, 9, 9, 9, 9, 9, 9]), "x.bin").expect(415);
    await u(0).file("post", box(id), Buffer.alloc(0)).expect(400);
    expect(stored()).toEqual([]);
  });

  it("is full when the box holds as much as it may", async () => {
    const id = await connect(u(0), u(1));
    const first = (await put(u(0), id, pdf(), "a.pdf").expect(201)).body;
    await getFirestore().collection("safebox").doc(id).collection("items").doc(first.id).update({ bytes: 200 * 1024 * 1024 });
    await put(u(1), id, pdf(), "b.pdf").expect(413);
  });
});

describe("who may open the box", () => {
  it("a stranger and a friend who is not confirmed get nothing", async () => {
    const id = await connect(u(0), u(1));
    const item = (await put(u(0), id, pdf(), "a.pdf").expect(201)).body;
    for (const method of ["get", "post"] as const) await u(2).raw(method, box(id)).expect(404);
    await u(2).raw("get", box(id, `/${item.id}`)).expect(404);
    await u(2).raw("delete", box(id, `/${item.id}`)).expect(404);
    const pending = (await u(0).add(u(3).p)).id;
    await u(0).raw("get", box(pending)).expect(403);
  });

  it("the file comes back with its type, only to the friends", async () => {
    const id = await connect(u(0), u(1));
    const item = (await put(u(0), id, pdf(), "a.pdf").expect(201)).body;
    const res = await download(u(1), id, item.id).expect(200);
    expect(res.headers["content-type"]).toBe("application/pdf");
    expect(res.headers["content-disposition"]).toContain("a.pdf");
    expect(res.body).toEqual(pdf());
    await download(u(2), id, item.id).expect(404);
  });

  it("the app reads a box file through the media cache too (so the picture, video and sound views work), only for the two friends", async () => {
    const id = await connect(u(0), u(1));
    const item = (await put(u(0), id, png(), "a.png").expect(201)).body;
    expect((await u(1).getObject(`box-${id}`, item.id).expect(200)).body).toEqual(png());
    await u(2).getObject(`box-${id}`, item.id).expect(404);
  });

  it("a zip is sent as a download, never opened in the page", async () => {
    const id = await connect(u(0), u(1));
    const item = (await put(u(0), id, zip(), "b.docx").expect(201)).body;
    expect((await download(u(1), id, item.id).expect(200)).headers["content-disposition"]).toMatch(/^attachment/);
  });
});

describe("previews, names and deleting", () => {
  it("a picture gets a small preview, a document does not", async () => {
    const id = await connect(u(0), u(1));
    const image = (await put(u(0), id, png(), "a.png").expect(201)).body;
    const doc = (await put(u(0), id, pdf(), "a.pdf").expect(201)).body;
    await u(0).file("put", box(id, `/${image.id}/thumb`), jpeg()).expect(204);
    await u(0).file("put", box(id, `/${doc.id}/thumb`), jpeg()).expect(400);
    await u(0).file("put", box(id, `/${image.id}/thumb`), pdf()).expect(415);
    expect((await listOf(u(1), id)).items.find((i) => i.id === image.id)?.hasThumb).toBe(true);
    expect((await download(u(1), id, image.id, "/thumb").expect(200)).body).toEqual(jpeg());
    expect(storedData(`sf-cache/box-${id}/${image.id}.thumb`)).toEqual(jpeg());
  });

  it("either friend can rename a file", async () => {
    const id = await connect(u(0), u(1));
    const item = (await put(u(0), id, pdf(), "old.pdf").expect(201)).body;
    await u(1).raw("put", box(id, `/${item.id}`), { name: "new.pdf" }).expect(200);
    expect((await listOf(u(0), id)).items[0].name).toBe("new.pdf");
    await u(1).raw("put", box(id, `/${item.id}`), { name: "  " }).expect(400);
  });

  it("either friend can take a file out, for both", async () => {
    const id = await connect(u(0), u(1));
    const item = (await put(u(0), id, png(), "a.png").expect(201)).body;
    await u(0).file("put", box(id, `/${item.id}/thumb`), jpeg()).expect(204);
    await u(1).raw("delete", box(id, `/${item.id}`)).expect(204);
    expect((await listOf(u(0), id)).items).toEqual([]);
    expect(stored()).toEqual([]);
    await u(0).raw("delete", box(id, `/${item.id}`)).expect(404);
  });
});

describe("when the friendship ends", () => {
  it("removing the friend deletes the whole box", async () => {
    const id = await connect(u(0), u(1));
    await put(u(0), id, png(), "a.png").expect(201);
    await put(u(1), id, pdf(), "a.pdf").expect(201);
    expect(stored()).toHaveLength(2);
    await u(0).remove(id).expect(204);
    expect(stored()).toEqual([]);
    expect((await getFirestore().collection("safebox").doc(id).collection("items").get()).size).toBe(0);
  });

  it("erasing an account deletes the boxes of its friendships", async () => {
    const id = await connect(u(0), u(1));
    await put(u(1), id, png(), "a.png").expect(201);
    await u(0).raw("delete", "/users/me", { confirm: "DELETE" }).expect(204);
    expect(stored()).toEqual([]);
  });
});

describe("moving a picture or video from the conversation", () => {
  const sendImage = async (user: User, id: string, thumb = false) => {
    const up = (await user.file("post", "/sf-cache?kind=image&name=beach.png", png()).expect(201)).body;
    if (thumb) await user.file("put", `/sf-cache/${up.objectId}/thumb`, jpeg()).expect(204);
    await user.raw("post", `/circles/default/friends/${id}/messages`, { text: "", media: { objectId: up.objectId } }).expect(201);
    return up.objectId as string;
  };
  const copy = (user: User, id: string, messageId: string) => user.raw("post", box(id, "/from-message"), { messageId });

  it("moves the picture and its preview to the box, for both friends; the message stays and says so", async () => {
    const id = await connect(u(0), u(1));
    const messageId = await sendImage(u(0), id, true);
    const item = (await copy(u(1), id, messageId).expect(201)).body;
    expect(item).toMatchObject({ name: "beach.png", kind: "image", hasThumb: true, mine: true });
    expect((await listOf(u(0), id)).items).toMatchObject([{ id: item.id, mine: false }]);
    expect(storedData(`sf-cache/box-${id}/${item.id}`)).toEqual(png());
    expect(storedData(`sf-cache/box-${id}/${item.id}.thumb`)).toEqual(jpeg());
    for (const user of [u(0), u(1)]) {
      const messages = (await user.feed(id).expect(200)).body.messages as { media: unknown; inBox: boolean }[];
      expect(messages).toMatchObject([{ media: null, inBox: true }]);
    }
    expect(storedNames().filter((n) => n.startsWith("sf-cache/uid"))).toEqual([]); // the file left the conversation
  });

  it("refuses a message without a picture, an unknown message and a stranger", async () => {
    const id = await connect(u(0), u(1));
    const text = (await u(0).send(id, "hello").expect(201)).body.id as string;
    await copy(u(0), id, text).expect(404);
    await copy(u(0), id, "doesnotexist1234").expect(404);
    const messageId = await sendImage(u(0), id);
    await copy(u(2), id, messageId).expect(404);
    expect((await listOf(u(0), id)).items).toEqual([]);
  });
});
