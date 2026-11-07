import { webcrypto, randomBytes } from "node:crypto";
import { getFirestore } from "firebase-admin/firestore";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { EncryptedUploadHeader, SafeboxEnc } from "../src/models";
import { storedData, storedNames } from "./fake-storage";
import { User, connect, seedPool } from "./helpers";

/** The encrypted upload of the safebox: the server keeps ciphertext it cannot read, and checks that both friends' keys have their copy of the file key. */
let pool: User[];
const keys: JsonWebKey[] = [];

const makeKey = async () => {
  const pair = await webcrypto.subtle.generateKey({ name: "RSA-OAEP", modulusLength: 3072, publicExponent: new Uint8Array([1, 0, 1]), hash: "SHA-256" }, true, ["encrypt", "decrypt"]);
  return (await webcrypto.subtle.exportKey("jwk", pair.publicKey)) as JsonWebKey;
};
beforeAll(async () => {
  for (let i = 0; i < 3; i++) keys.push(await makeKey());
}, 60000);
beforeEach(async () => {
  pool = await seedPool();
});

const box = (id: string, rest = "") => `/circles/default/friends/${id}/safebox${rest}`;
const publish = async (user: User, jwk: JsonWebKey) => (await user.raw("post", "/keys", { publicKey: jwk }).expect(201)).body.id as string;
const b64 = (n: number) => randomBytes(n).toString("base64");

/** an upload as the app makes it: header, locked file, locked preview (the locks are random bytes here: the server cannot tell) */
function upload(wraps: SafeboxEnc["wraps"], opts: { file?: number; thumb?: number; kind?: "image" | "document"; mutate?: (h: EncryptedUploadHeader) => void } = {}): Buffer {
  const file = randomBytes(opts.file ?? 300);
  const thumb = opts.thumb ? randomBytes(opts.thumb) : null;
  const header: EncryptedUploadHeader = {
    v: 1,
    kind: opts.kind ?? "document",
    fileLength: file.length,
    thumbLength: thumb?.length ?? 0,
    enc: { v: 1, iv: b64(12), metaIv: b64(12), meta: b64(60), thumbIv: thumb ? b64(12) : null, wraps },
  };
  opts.mutate?.(header);
  const head = Buffer.from(JSON.stringify(header));
  const length = Buffer.alloc(4);
  length.writeUInt32BE(head.length);
  return Buffer.concat([length, head, file, ...(thumb ? [thumb] : [])]);
}
const wrap = (uid: string, keyId: string) => ({ uid, keyId, wrappedKey: b64(384) });
const send = (user: User, id: string, body: Buffer) => user.file("post", box(id, "/encrypted"), body);

/** both friends have a key: the wraps a good upload needs */
async function twoWithKeys() {
  const id = await connect(pool[0], pool[1]);
  const mine = await publish(pool[0], keys[0]);
  const theirs = await publish(pool[1], keys[1]);
  return { id, mine, theirs, wraps: [wrap(pool[0].p.uid, mine), wrap(pool[1].p.uid, theirs)] };
}

describe("an encrypted upload", () => {
  it("is stored as it came, with no readable name, and listed for both friends with only their own copy of the key", async () => {
    const { id, mine, theirs, wraps } = await twoWithKeys();
    const body = upload(wraps, { file: 500, thumb: 80, kind: "image" });
    const item = (await send(pool[0], id, body).expect(201)).body;
    expect(item).toMatchObject({ name: "Encrypted file", kind: "image", mime: "application/octet-stream", bytes: 500, mine: true, hasThumb: true });
    expect(item.enc.wraps).toEqual([expect.objectContaining({ uid: pool[0].p.uid, keyId: mine })]);
    const theirsList = (await pool[1].raw("get", box(id)).expect(200)).body.items;
    expect(theirsList[0]).toMatchObject({ id: item.id, mine: false });
    expect(theirsList[0].enc.wraps).toEqual([expect.objectContaining({ uid: pool[1].p.uid, keyId: theirs })]);
    expect(storedNames().filter((n) => n.startsWith("sf-cache/box-"))).toEqual(expect.arrayContaining([`sf-cache/box-${id}/${item.id}`, `sf-cache/box-${id}/${item.id}.thumb`]));
    expect(Buffer.from(storedData(`sf-cache/box-${id}/${item.id}`)!).length).toBe(500);
  });

  it("is sent back as it is stored (the same bytes for both friends), as a download with no name", async () => {
    const { id, wraps } = await twoWithKeys();
    const item = (await send(pool[0], id, upload(wraps)).expect(201)).body;
    for (const user of [pool[0], pool[1]]) {
      const res = await user.raw("get", box(id, `/${item.id}`)).buffer(true).parse((r, done) => {
        const parts: Buffer[] = [];
        r.on("data", (c: Buffer) => parts.push(c));
        r.on("end", () => done(null, Buffer.concat(parts)));
      });
      expect(res.status).toBe(200);
      expect(res.headers["content-type"]).toContain("application/octet-stream");
      expect(res.headers["content-disposition"]).toContain("attachment");
      expect(res.headers["content-disposition"]).not.toMatch(/Encrypted|\.pdf/);
      expect((res.body as Buffer).length).toBe(300);
    }
  });

  it("needs a copy of the file key for every key of both friends, no more and no fewer", async () => {
    const { id, mine, wraps } = await twoWithKeys();
    const second = await publish(pool[0], keys[2]); // I have a second device
    expect((await send(pool[0], id, upload(wraps)).expect(409)).body.error).toMatch(/keys changed/i); // a copy for the new device is missing
    const all = [...wraps, wrap(pool[0].p.uid, second)];
    await send(pool[0], id, upload(all)).expect(201);
    await send(pool[0], id, upload(all.slice(1))).expect(409); // mine is missing
    await send(pool[0], id, upload([...all, wrap(pool[0].p.uid, mine)])).expect(409); // twice
    await send(pool[0], id, upload([...all, wrap(pool[2].p.uid, mine)])).expect(409); // for someone who is not in the box
  });

  it("needs copies only for the keys that exist (a friend without a key has none)", async () => {
    const id = await connect(pool[0], pool[1]);
    const mine = await publish(pool[0], keys[0]);
    await send(pool[0], id, upload([wrap(pool[0].p.uid, mine)])).expect(201); // only my own copy: allowed (the app does not do this; it stores plain files then)
    await send(pool[0], id, upload([])).expect(400);
  });

  it.each([
    ["a body that is too short", () => Buffer.from([0, 0])],
    ["a header that is not JSON", () => Buffer.concat([Buffer.from([0, 0, 0, 3]), Buffer.from("abc"), randomBytes(100)])],
    ["a header longer than the body", () => Buffer.concat([Buffer.from([0, 0, 1, 0]), Buffer.from("{}")])],
  ])("refuses %s", async (_label, make) => {
    const { id } = await twoWithKeys();
    await send(pool[0], id, make()).expect(400);
  });

  it.each<[string, (h: EncryptedUploadHeader) => void]>([
    ["a wrong kind", (h) => ((h as any).kind = "program")],
    ["lengths that do not add up", (h) => (h.fileLength += 5)],
    ["a preview without an iv", (h) => (h.enc.thumbIv = null)],
    ["an iv of the wrong size", (h) => (h.enc.iv = b64(8))],
    ["a locked key of the wrong size", (h) => (h.enc.wraps[0].wrappedKey = b64(100))],
    ["a key ID that is not one", (h) => (h.enc.wraps[0].keyId = "nope")],
    ["a name that is too long", (h) => (h.enc.meta = b64(3000))],
  ])("refuses %s", async (_label, mutate) => {
    const { id, wraps } = await twoWithKeys();
    await send(pool[0], id, upload(wraps, { thumb: 50, kind: "image", mutate })).expect(400);
    expect(storedNames().filter((n) => n.startsWith("sf-cache/box-"))).toEqual([]);
  });

  it("is not accepted from anyone but the two friends", async () => {
    const { id, wraps } = await twoWithKeys();
    await send(pool[2], id, upload(wraps)).expect(404);
  });

  it("counts in the room of the box like any file", async () => {
    const { id, wraps } = await twoWithKeys();
    const item = (await send(pool[0], id, upload(wraps, { file: 1000 })).expect(201)).body;
    expect((await pool[0].raw("get", box(id)).expect(200)).body.usedBytes).toBe(1000);
    await getFirestore().collection("safebox").doc(id).collection("items").doc(item.id).update({ bytes: 200 * 1024 * 1024 });
    await send(pool[1], id, upload(wraps)).expect(413);
  });

  it("is told to the friend like any file that is added", async () => {
    const { id, wraps } = await twoWithKeys();
    await send(pool[0], id, upload(wraps)).expect(201);
    const messages = await getFirestore().collection("user-account").doc(pool[1].p.uid).collection("messages").get();
    expect(messages.docs.some((m) => m.data().inBox === true)).toBe(true);
  });
});

describe("an encrypted file", () => {
  it("is renamed with a new locked name; the server never sees the name", async () => {
    const { id, wraps } = await twoWithKeys();
    const item = (await send(pool[0], id, upload(wraps)).expect(201)).body;
    const metaIv = b64(12);
    const meta = b64(70);
    const renamed = (await pool[1].raw("put", box(id, `/${item.id}`), { metaIv, meta }).expect(200)).body; // the friend may rename too
    expect(renamed.enc).toMatchObject({ metaIv, meta });
    expect(renamed.name).toBe("Encrypted file");
    expect((await pool[0].raw("get", box(id)).expect(200)).body.items[0].enc).toMatchObject({ metaIv, meta });
    await pool[0].raw("put", box(id, `/${item.id}`), { name: "plain.txt" }).expect(400); // a plain name is not taken for an encrypted file
    await pool[0].raw("put", box(id, `/${item.id}`), { metaIv: "short", meta }).expect(400);
  });

  it("has its preview sent with the file, never on its own", async () => {
    const { id, wraps } = await twoWithKeys();
    const item = (await send(pool[0], id, upload(wraps, { kind: "image" })).expect(201)).body;
    await pool[0].file("put", box(id, `/${item.id}/thumb`), Buffer.from([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3])).expect(400);
  });

  it("goes with the box when it is taken out", async () => {
    const { id, wraps } = await twoWithKeys();
    const item = (await send(pool[0], id, upload(wraps, { thumb: 40, kind: "image" })).expect(201)).body;
    await pool[1].raw("delete", box(id, `/${item.id}`)).expect(204);
    expect((await pool[0].raw("get", box(id)).expect(200)).body.items).toEqual([]);
    expect(storedNames().filter((n) => n.includes(`/${item.id}`) && !n.endsWith(".thumb"))).toEqual([]);
  });
});
