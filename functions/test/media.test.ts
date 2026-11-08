import { getFirestore } from "firebase-admin/firestore";
import { beforeEach, describe, expect, it } from "vitest";
import { User, connect, seedPool, server } from "./helpers";
import { sentPushes } from "./setup";
import { storedData, storedNames } from "./fake-storage";

/** Files in messages: stored in the media cache (sf-cache/<userid>/<objectid>), read through the proxy. */
let pool: User[];
let u: (n: number) => User;
beforeEach(async () => {
  pool = await seedPool();
  u = (n) => pool[n];
});

/** the first bytes of a real file of each format, then filler */
const filler = (size: number) => Buffer.alloc(size, 7);
const png = (size = 2000) => Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), filler(size)]);
const jpeg = (size = 2000) => Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), filler(size)]);
const mp4 = (size = 2000) => Buffer.concat([Buffer.from([0, 0, 0, 0x18]), Buffer.from("ftypisom"), filler(size)]);
const webm = (size = 2000) => Buffer.concat([Buffer.from([0x1a, 0x45, 0xdf, 0xa3]), filler(size)]);
const mp3 = (size = 2000) => Buffer.concat([Buffer.from("ID3"), filler(size)]);
const svg = () => Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>');

const upload = (user: User, kind: string, bytes: Buffer, name?: string) =>
  user.file("post", `/sf-cache?kind=${kind}${name ? `&name=${encodeURIComponent(name)}` : ""}`, bytes);
const uploaded = async (user: User, kind: string, bytes: Buffer, name?: string) =>
  (await upload(user, kind, bytes, name).expect(201)).body as { ownerId: string; objectId: string; kind: string; mime: string; name: string | null; bytes: number };
const sendMedia = (user: User, friendId: string, media: object, text?: string) =>
  user.raw("post", `/circles/default/friends/${friendId}/messages`, { ...(text === undefined ? {} : { text }), media });
const feedOf = async (user: User, id: string) => (await user.feed(id).expect(200)).body.messages as any[];
const stored = () => storedNames().filter((n) => n.startsWith("sf-cache/"));

describe("upload", () => {
  it("stores the file in the folder of the sender and says where", async () => {
    const res = await uploaded(u(0), "image", png(), "holiday.png");
    expect(res).toMatchObject({ ownerId: "uid00", kind: "image", mime: "image/png", name: "holiday.png", bytes: png().length });
    expect(stored()).toEqual([`sf-cache/uid00/${res.objectId}`]);
    expect(storedData(`sf-cache/uid00/${res.objectId}`)).toEqual(png());
  });

  it("finds the type from the bytes, not from what the app says", async () => {
    const res = await u(0).file("post", "/sf-cache?kind=image", jpeg(), "text/plain").expect(201);
    expect(res.body.mime).toBe("image/jpeg");
  });

  it.each([
    ["image", jpeg(), "image/jpeg"],
    ["video", mp4(), "video/mp4"],
    ["video", webm(), "video/webm"],
    ["audio", mp4(), "audio/mp4"],
    ["audio", mp3(), "audio/mpeg"],
    ["audio", webm(), "audio/webm"],
  ])("a %s file is accepted and stored as %s", async (kind, bytes, mime) => {
    expect((await uploaded(u(0), kind, bytes)).mime).toBe(mime);
  });

  it("refuses what is not a file of that kind", async () => {
    await upload(u(0), "document", png()).expect(400); // an unknown kind
    await upload(u(0), "avatar", png()).expect(400); // pictures and icons are not sent as messages
    await u(0).file("post", "/sf-cache?kind=image", Buffer.alloc(0)).expect(400);
    await upload(u(0), "image", Buffer.from("just some text, not a picture")).expect(415);
    await upload(u(0), "image", svg()).expect(415); // an svg can carry a script
    await upload(u(0), "image", mp4()).expect(415);
    await upload(u(0), "video", png()).expect(415);
    await upload(u(0), "audio", jpeg()).expect(415);
    expect(stored()).toEqual([]);
  });

  it("refuses a file that is too big", async () => {
    await upload(u(0), "image", png(10 * 1024 * 1024)).expect(413);
    expect(stored()).toEqual([]);
  });

  it("needs a login", async () => {
    const { default: request } = await import("supertest");
    await request(server()).post("/api/sf-cache?kind=image").set("Content-Type", "image/png").send(png()).expect(401);
  });

  it("the file name is cleaned: no folders, not too long", async () => {
    expect((await uploaded(u(0), "image", png(), "../../etc/passwd")).name).toBe("....etcpasswd");
    expect((await uploaded(u(0), "image", png(), "x".repeat(300))).name).toHaveLength(100);
    expect((await uploaded(u(0), "image", png())).name).toBeNull();
  });
});

describe("the preview of an image or video", () => {
  it("is stored next to the file", async () => {
    const file = await uploaded(u(0), "image", png());
    await u(0).file("put", `/sf-cache/${file.objectId}/thumb`, jpeg(500)).expect(204);
    expect(stored()).toContain(`sf-cache/uid00/${file.objectId}.thumb`);
  });

  it("is refused for audio, for somebody else's file, for a missing file and for something that is not a picture", async () => {
    const audio = await uploaded(u(0), "audio", mp3());
    await u(0).file("put", `/sf-cache/${audio.objectId}/thumb`, jpeg(500)).expect(404);
    const image = await uploaded(u(0), "image", png());
    await u(1).file("put", `/sf-cache/${image.objectId}/thumb`, jpeg(500)).expect(404);
    await u(0).file("put", "/sf-cache/doesnotexist1234/thumb", jpeg(500)).expect(404);
    await u(0).file("put", `/sf-cache/${image.objectId}/thumb`, mp4(500)).expect(415);
    await u(0).file("put", `/sf-cache/${image.objectId}/thumb`, jpeg(200 * 1024)).expect(413);
  });
});

describe("sending a file in a message", () => {
  it("a file without text is a message; the friend gets it with the file's details", async () => {
    const id = await connect(u(0), u(1));
    const file = await uploaded(u(0), "image", png(), "me.png");
    await u(0).file("put", `/sf-cache/${file.objectId}/thumb`, jpeg(300)).expect(204);
    sentPushes.length = 0;
    const sent = (await sendMedia(u(0), id, { objectId: file.objectId, width: 640, height: 480 }).expect(201)).body;
    expect(sent).toMatchObject({
      id: file.objectId, // the message has the id of its file
      text: "",
      mine: true,
      media: { ownerId: "uid00", objectId: file.objectId, kind: "image", mime: "image/png", name: "me.png", bytes: png().length, width: 640, height: 480, durationMs: null, hasThumb: true },
    });
    const theirs = (await feedOf(u(1), id))[0];
    expect(theirs).toMatchObject({ id: file.objectId, mine: false, read: false, media: { objectId: file.objectId, kind: "image" } });
    expect((await u(1).check()).messages[0].text).toBe("📷 Photo"); // what Home shows for a file without text
  });

  it("the text is the caption, and it is what the push says", async () => {
    const id = await connect(u(0), u(1));
    const video = await uploaded(u(0), "video", mp4());
    await getFirestore().collection("user-account").doc("uid01").collection("push-device").doc("d1").set({ token: "tok", createdAt: new Date(), updatedAt: new Date() });
    sentPushes.length = 0;
    await sendMedia(u(0), id, { objectId: video.objectId, durationMs: 12_000 }, "look at this").expect(201);
    expect((await feedOf(u(1), id))[0]).toMatchObject({ text: "look at this", media: { kind: "video", durationMs: 12_000, hasThumb: false } });
    expect(sentPushes[0].data.body).toBe("look at this");
  });

  it("a push for a file without text names the kind", async () => {
    const id = await connect(u(0), u(1));
    const audio = await uploaded(u(0), "audio", mp3());
    await getFirestore().collection("user-account").doc("uid01").collection("push-device").doc("d1").set({ token: "tok", createdAt: new Date(), updatedAt: new Date() });
    sentPushes.length = 0;
    await sendMedia(u(0), id, { objectId: audio.objectId }).expect(201);
    expect(sentPushes[0].data.body).toBe("🎤 Audio");
  });

  it("refuses a file that is not uploaded, not yours, or sent already", async () => {
    const id = await connect(u(0), u(1));
    await sendMedia(u(0), id, { objectId: "neveruploaded123" }).expect(400);
    await sendMedia(u(0), id, { objectId: "../bad" }).expect(400);
    const file = await uploaded(u(0), "image", png());
    await sendMedia(u(1), id, { objectId: file.objectId }).expect(400); // it is in the folder of the other person
    await sendMedia(u(0), id, { objectId: file.objectId }).expect(201);
    await sendMedia(u(0), id, { objectId: file.objectId }).expect(409);
    await u(0).send(id, "").expect(400); // no text and no file is still empty
  });

  it("odd sizes are left out, not stored", async () => {
    const id = await connect(u(0), u(1));
    const file = await uploaded(u(0), "image", png());
    const sent = (await sendMedia(u(0), id, { objectId: file.objectId, width: -5, height: "big", durationMs: 1.5 }).expect(201)).body;
    expect(sent.media).toMatchObject({ width: null, height: null, durationMs: null });
  });

  it("the caption can be changed, and a file message may have none", async () => {
    const id = await connect(u(0), u(1));
    const file = await uploaded(u(0), "image", png());
    await sendMedia(u(0), id, { objectId: file.objectId }, "first").expect(201);
    const url = `/circles/default/friends/${id}/messages/${file.objectId}`;
    expect((await u(0).raw("put", url, { text: "second" }).expect(200)).body).toMatchObject({ text: "second", edited: true, media: { objectId: file.objectId } });
    expect((await u(0).raw("put", url, { text: "" }).expect(200)).body.text).toBe("");
    const plain = (await u(0).send(id, "plain").expect(201)).body.id;
    await u(0).raw("put", `/circles/default/friends/${id}/messages/${plain}`, { text: "" }).expect(400);
  });
});

describe("getObject(userid/objectid): the proxy", () => {
  const sendFile = async (from: User, to: User, kind = "image", bytes = png(), name = "pic.png") => {
    const id = await connect(from, to);
    const file = await uploaded(from, kind, bytes, name);
    await from.file("put", `/sf-cache/${file.objectId}/thumb`, jpeg(100)).catch(() => null);
    await sendMedia(from, id, { objectId: file.objectId }).expect(201);
    return { id, file };
  };

  it("gives the bytes, the type and the name to the sender and to the receiver", async () => {
    const { file } = await sendFile(u(0), u(1));
    for (const reader of [u(0), u(1)]) {
      const res = await reader.getObject("uid00", file.objectId).expect(200);
      expect(res.body).toEqual(png());
      expect(res.headers["content-type"]).toBe("image/png");
      expect(res.headers["content-disposition"]).toBe("inline; filename*=UTF-8''pic.png");
      expect(res.headers["cache-control"]).toBe("private, max-age=31536000, immutable");
      expect(res.headers["x-content-type-options"]).toBe("nosniff");
    }
  });

  it("the preview is read the same way", async () => {
    const { file } = await sendFile(u(0), u(1));
    const res = await u(1).getObject("uid00", `${file.objectId}.thumb`).expect(200);
    expect(res.body).toEqual(jpeg(100));
    expect(res.headers["content-type"]).toBe("image/jpeg");
  });

  it("a browser that has the file already is told so (304)", async () => {
    const { file } = await sendFile(u(0), u(1));
    const first = await u(1).getObject("uid00", file.objectId).expect(200);
    await u(1).getObject("uid00", file.objectId, { "If-None-Match": first.headers.etag }).expect(304);
  });

  it("without a name the object id is the name", async () => {
    const id = await connect(u(0), u(1));
    const file = await uploaded(u(0), "image", png());
    await sendMedia(u(0), id, { objectId: file.objectId }).expect(201);
    expect((await u(1).getObject("uid00", file.objectId).expect(200)).headers["content-disposition"]).toBe(`inline; filename*=UTF-8''${file.objectId}`);
  });

  it("nobody else sees it: an outsider, a friend it was not sent to, a file not sent yet", async () => {
    const { file } = await sendFile(u(0), u(1));
    await connect(u(0), u(2)); // a friend of the sender, but the message went to somebody else
    await u(2).getObject("uid00", file.objectId).expect(404);
    await u(3).getObject("uid00", file.objectId).expect(404);

    const unsent = await uploaded(u(0), "image", png());
    await u(1).getObject("uid00", unsent.objectId).expect(404);
    await u(0).getObject("uid00", unsent.objectId).expect(200); // the owner always can
    await u(1).getObject("uid01", file.objectId).expect(404); // not in that folder
    await u(1).getObject("uid00", "not-an-object").expect(404);
    await u(1).getObject("uid00", `${file.objectId}.thumbs`).expect(404);
  });

  it("needs a login", async () => {
    const { file } = await sendFile(u(0), u(1));
    const { default: request } = await import("supertest");
    await request(server()).get(`/api/sf-cache/uid00/${file.objectId}`).expect(401);
  });
});

describe("a big file in pieces (chunked upload)", () => {
  const open = async (user: User) => (await user.raw("post", "/sf-cache/uploads").expect(201)).body as { uploadId: string; chunkBytes: number; maxChunks: number };
  const piece = (user: User, uploadId: string, n: number, bytes: Buffer) => user.file("put", `/sf-cache/uploads/${uploadId}/${n}`, bytes);
  const finish = (user: User, uploadId: string, query = "kind=video&parts=3&name=film.mp4") => user.raw("post", `/sf-cache/uploads/${uploadId}/finish?${query}`);
  const MB = 1024 * 1024;

  it("opens an upload, takes the pieces (in any order) and joins them into one file", async () => {
    const { uploadId, chunkBytes, maxChunks } = await open(u(0));
    expect(chunkBytes).toBe(8 * MB);
    expect(maxChunks).toBe(32);
    const [a, b, c] = [mp4(3000), filler(2000), filler(1000)];
    await piece(u(0), uploadId, 2, c).expect(204);
    await piece(u(0), uploadId, 0, a).expect(204);
    await piece(u(0), uploadId, 1, b).expect(204);
    expect(stored()).toHaveLength(3); // the pieces wait in tmp/<uploadid>/<n>
    expect(stored()[0]).toBe(`sf-cache/uid00/tmp/${uploadId}/0`);

    const done = (await finish(u(0), uploadId).expect(201)).body;
    expect(done).toEqual({ ownerId: "uid00", objectId: uploadId, kind: "video", mime: "video/mp4", name: "film.mp4", bytes: a.length + b.length + c.length });
    expect(stored()).toEqual([`sf-cache/uid00/${uploadId}`]); // the pieces are gone
    expect(storedData(`sf-cache/uid00/${uploadId}`)).toEqual(Buffer.concat([a, b, c]));
  });

  it("a file over the 30 MB of a single request goes this way, and is sent and read like any other", async () => {
    const id = await connect(u(0), u(1));
    const { uploadId } = await open(u(0));
    const first = mp4(8 * MB - 20);
    const rest = [filler(8 * MB), filler(8 * MB), filler(8 * MB)];
    await piece(u(0), uploadId, 0, first).expect(204);
    for (const [i, p] of rest.entries()) await piece(u(0), uploadId, i + 1, p).expect(204);
    const done = (await finish(u(0), uploadId, "kind=video&parts=4&name=big.mp4").expect(201)).body;
    expect(done.bytes).toBeGreaterThan(30 * MB);
    await sendMedia(u(0), id, { objectId: uploadId, durationMs: 60_000 }).expect(201);
    const read = await u(1).getObject("uid00", uploadId).expect(200);
    expect(read.body.length).toBe(done.bytes);
    expect(read.headers["content-type"]).toBe("video/mp4");
  });

  it("a piece sent again replaces the first; finishing twice gives the same answer", async () => {
    const { uploadId } = await open(u(0));
    await piece(u(0), uploadId, 0, mp4(100)).expect(204);
    await piece(u(0), uploadId, 0, mp4(500)).expect(204);
    const first = (await finish(u(0), uploadId, "kind=video&parts=1").expect(201)).body;
    expect(first.bytes).toBe(mp4(500).length);
    expect((await finish(u(0), uploadId, "kind=video&parts=1").expect(200)).body).toEqual(first);
    expect(stored()).toHaveLength(1);
  });

  it("refuses a piece that is empty, too big, or numbered wrongly", async () => {
    const { uploadId } = await open(u(0));
    await piece(u(0), uploadId, 0, Buffer.alloc(0)).expect(400);
    await piece(u(0), uploadId, 32, filler(10)).expect(400);
    await piece(u(0), uploadId, "x" as any, filler(10)).expect(400);
    await piece(u(0), "../bad", 0, filler(10)).expect(404);
    await piece(u(0), uploadId, 0, filler(8 * MB + 1)).expect(413);
    expect(stored()).toEqual([]);
  });

  it("refuses to finish when a piece is missing, or the numbers are wrong", async () => {
    const { uploadId } = await open(u(0));
    await piece(u(0), uploadId, 0, mp4()).expect(204);
    await piece(u(0), uploadId, 2, filler(10)).expect(204);
    const res = await finish(u(0), uploadId, "kind=video&parts=3").expect(400);
    expect(res.body.error).toBe("Piece 1 has not arrived");
    await finish(u(0), uploadId, "kind=video&parts=0").expect(400);
    await finish(u(0), uploadId, "kind=video&parts=33").expect(400);
    await finish(u(0), uploadId, "kind=avatar&parts=1").expect(400);
    await finish(u(0), uploadId, "parts=1").expect(400);
    expect(stored()).toHaveLength(2); // nothing was lost: the missing piece can still be sent
  });

  it("checks the joined file like a single upload: the type from the first bytes, the size, and clears the pieces if it is wrong", async () => {
    const wrong = await open(u(0));
    await piece(u(0), wrong.uploadId, 0, png()).expect(204);
    await finish(u(0), wrong.uploadId, "kind=video&parts=1").expect(415);
    expect(stored()).toEqual([]);

    const big = await open(u(0));
    await piece(u(0), big.uploadId, 0, png(6 * MB)).expect(204);
    await piece(u(0), big.uploadId, 1, filler(6 * MB)).expect(204);
    await finish(u(0), big.uploadId, "kind=image&parts=2").expect(413); // 12 MB is over the 10 MB of an image
    expect(stored()).toEqual([]);
  });

  it("is somebody's own: the pieces are in the folder of the sender", async () => {
    const { uploadId } = await open(u(0));
    await piece(u(0), uploadId, 0, mp4()).expect(204);
    await finish(u(1), uploadId, "kind=video&parts=1").expect(400); // the other person has no such piece
    await finish(u(0), uploadId, "kind=video&parts=1").expect(201);
  });

  it("needs a login", async () => {
    const { default: request } = await import("supertest");
    await request(server()).post("/api/sf-cache/uploads").expect(401);
    await request(server()).put("/api/sf-cache/uploads/abcdefgh12345678/0").send(Buffer.from("x")).expect(401);
    await request(server()).post("/api/sf-cache/uploads/abcdefgh12345678/finish?kind=video&parts=1").expect(401);
  });
});

describe("files go when the message goes", () => {
  const send = async (from: User, to: User, id: string, kind = "image", bytes = png()) => {
    const file = await uploaded(from, kind, bytes);
    await from.file("put", `/sf-cache/${file.objectId}/thumb`, jpeg(100));
    await sendMedia(from, id, { objectId: file.objectId }).expect(201);
    return file.objectId;
  };

  it("deleting a message deletes its file and preview, and the friend can no longer open it", async () => {
    const id = await connect(u(0), u(1));
    const file = await send(u(0), u(1), id);
    expect(stored()).toHaveLength(2);
    await u(0).raw("delete", `/circles/default/friends/${id}/messages/${file}`).expect(204);
    expect(stored()).toEqual([]);
    await u(1).getObject("uid00", file).expect(404);
  });

  it("clearing messages (mine and the friend's) deletes the files of both", async () => {
    const id = await connect(u(0), u(1));
    await send(u(0), u(1), id);
    await send(u(1), u(0), id, "audio", mp3());
    await u(0).raw("post", `/circles/default/friends/${id}/messages/delete`, { whose: "mine", dryRun: false }).expect(200);
    expect(stored().filter((n) => n.startsWith("sf-cache/uid00/"))).toEqual([]);
    expect(stored().filter((n) => n.startsWith("sf-cache/uid01/"))).toHaveLength(1); // the friend's is not mine to clear
    await u(0).raw("post", `/circles/default/friends/${id}/messages/delete`, { whose: "both" }).expect(200);
    expect(stored()).toEqual([]);
  });

  it("removing the friend deletes the files of the conversation", async () => {
    const id = await connect(u(0), u(1));
    await send(u(0), u(1), id);
    await send(u(1), u(0), id, "video", mp4());
    await u(0).remove(id).expect(204);
    expect(stored()).toEqual([]);
  });

  it("erasing an account deletes its folder and the files of its conversations", async () => {
    const id = await connect(u(0), u(1));
    const other = await connect(u(1), u(2));
    await send(u(1), u(0), id);
    await send(u(0), u(1), id, "video", mp4());
    await send(u(1), u(2), other); // a conversation with somebody else stays
    await uploaded(u(0), "image", png()); // never sent: still in the folder
    await u(0).raw("delete", "/users/me", { confirm: "DELETE" }).expect(204);
    expect(stored().filter((n) => n.startsWith("sf-cache/uid00/"))).toEqual([]);
    expect(stored()).toEqual(expect.arrayContaining([expect.stringMatching(/^sf-cache\/uid01\//)]));
    expect(stored()).toHaveLength(2); // the file and preview of the conversation with the third person
  });
});

describe("the profile picture is an object in the cache", () => {
  const dataUrl = (type: string, bytes: Buffer) => `data:image/${type};base64,${bytes.toString("base64")}`;
  const account = async (n: number) => (await getFirestore().collection("user-account").doc(`uid0${n}`).get()).data()!;

  it("is stored as an avatar; a new one replaces it; removing deletes it", async () => {
    await u(0).raw("put", "/profile/picture", { image: dataUrl("png", png()) }).expect(200);
    const first = (await account(0)).avatarObjectId as string;
    expect(stored()).toEqual([`sf-cache/uid00/${first}`]);
    expect((await u(0).raw("get", "/profile/picture").expect(200)).body.image).toBe(dataUrl("png", png()));

    await u(0).raw("put", "/profile/picture", { image: dataUrl("jpeg", jpeg()) }).expect(200);
    const second = (await account(0)).avatarObjectId as string;
    expect(second).not.toBe(first);
    expect(stored()).toEqual([`sf-cache/uid00/${second}`]); // the old one is gone

    await u(0).raw("delete", "/profile/picture").expect(204);
    expect(stored()).toEqual([]);
    expect((await account(0)).avatarObjectId).toBeNull();
  });

  it("friends read it through the proxy; the friend list names the object", async () => {
    const id = await connect(u(0), u(1));
    await u(1).raw("put", "/profile/picture", { image: dataUrl("png", png()) }).expect(200);
    const friend = (await u(0).friends()).find((f) => f.id === id)!;
    expect(friend.pictureId).toBe((await account(1)).avatarObjectId);
    const res = await u(0).getObject("uid01", friend.pictureId!).expect(200);
    expect(res.body).toEqual(png());
    expect(res.headers["content-type"]).toBe("image/png");
    await u(2).getObject("uid01", friend.pictureId!).expect(404); // not a friend
    await u(1).raw("delete", "/profile/picture").expect(204);
    expect((await u(0).friends()).find((f) => f.id === id)!.pictureId).toBeNull();
  });

  it("a picture saved before the cache existed moves into it when it is first read", async () => {
    const image = dataUrl("jpeg", jpeg());
    const db = getFirestore();
    await db.collection("user-account").doc("uid00").collection("profile-picture").doc("current").set({ image });
    await db.collection("user-account").doc("uid00").set({ profilePictureAt: new Date() }, { merge: true });
    expect((await u(0).raw("get", "/profile/picture").expect(200)).body.image).toBe(image);
    expect(stored()).toHaveLength(1);
    expect((await account(0)).avatarObjectId).toBeTruthy();
    expect((await db.collection("user-account").doc("uid00").collection("profile-picture").doc("current").get()).exists).toBe(false);
    expect((await u(0).raw("get", "/profile/picture").expect(200)).body.image).toBe(image); // and is read from the cache from now on
  });

  it("erasing the account deletes it", async () => {
    await u(0).raw("put", "/profile/picture", { image: dataUrl("png", png()) }).expect(200);
    await u(0).raw("delete", "/users/me", { confirm: "DELETE" }).expect(204);
    expect(stored()).toEqual([]);
  });
});
