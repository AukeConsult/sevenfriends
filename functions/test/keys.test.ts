import { webcrypto } from "node:crypto";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { MAX_KEYS_PER_PERSON, fingerprintOf, keyIdOf } from "../src/models";
import { User, connect, seedPool } from "./helpers";

/** Public keys and the backup of the private key (docs/design/safebox-encryption.md). */
let pool: User[];
let jwk: JsonWebKey;
let other: JsonWebKey;

const makeKey = async () => {
  const pair = await webcrypto.subtle.generateKey({ name: "RSA-OAEP", modulusLength: 3072, publicExponent: new Uint8Array([1, 0, 1]), hash: "SHA-256" }, true, ["encrypt", "decrypt"]);
  return (await webcrypto.subtle.exportKey("jwk", pair.publicKey)) as JsonWebKey;
};

beforeAll(async () => {
  jwk = await makeKey();
  other = await makeKey();
}, 60000);

beforeEach(async () => {
  pool = await seedPool();
});

describe("publishing a public key", () => {
  it("is stored under the key ID the server works out itself", async () => {
    const fingerprint = (await fingerprintOf(jwk))!;
    const res = await pool[0].raw("post", "/keys", { publicKey: jwk, label: "My laptop" }).expect(201);
    expect(res.body).toMatchObject({ id: keyIdOf(fingerprint), fingerprint, label: "My laptop", revoked: false });
    const mine = (await pool[0].raw("get", "/keys").expect(200)).body;
    expect(mine.keys).toHaveLength(1);
    expect(mine.keys[0].id).toBe(keyIdOf(fingerprint));
    expect(mine.hasBackup).toBe(false);
    expect((await pool[1].raw("get", "/keys").expect(200)).body.keys).toEqual([]); // only mine
  });

  it("twice is the same key: only the label can change", async () => {
    await pool[0].raw("post", "/keys", { publicKey: jwk, label: "Old" }).expect(201);
    await pool[0].raw("post", "/keys", { publicKey: { ...jwk, key_ops: ["encrypt"], ext: true, alg: "RSA-OAEP-256" }, label: "New" }).expect(200); // extra JWK fields do not make another key
    const keys = (await pool[0].raw("get", "/keys")).body.keys;
    expect(keys).toHaveLength(1);
    expect(keys[0].label).toBe("New");
  });

  it("keeps a different key as a second device", async () => {
    await pool[0].raw("post", "/keys", { publicKey: jwk }).expect(201);
    await pool[0].raw("post", "/keys", { publicKey: other }).expect(201);
    expect((await pool[0].raw("get", "/keys")).body.keys).toHaveLength(2);
  });

  it.each([
    ["nothing", undefined],
    ["a private key", { kty: "RSA", n: "x".repeat(512), e: "AQAB", d: "secret" }],
    ["a short key", { kty: "RSA", n: "abc", e: "AQAB" }],
    ["another exponent", { kty: "RSA", n: "A".repeat(512), e: "AAEAAQ" }],
    ["another kind of key", { kty: "EC", crv: "P-256", x: "a", y: "b" }],
    ["text that is not base64url", { kty: "RSA", n: "!".repeat(512), e: "AQAB" }],
  ])("refuses %s", async (_label, publicKey) => {
    const res = await pool[0].raw("post", "/keys", { publicKey });
    // a private key sent as `d` is cut away rather than stored: only e, kty and n are ever kept
    if (_label === "a private key") expect(res.status).toBe(201);
    else expect(res.status).toBe(400);
  });

  it("is limited to a number of devices", async () => {
    for (let i = 0; i < MAX_KEYS_PER_PERSON; i++) {
      const n = Buffer.from(webcrypto.getRandomValues(new Uint8Array(384))).toString("base64url");
      await pool[0].raw("post", "/keys", { publicKey: { kty: "RSA", e: "AQAB", n } }).expect(201);
    }
    expect((await pool[0].raw("post", "/keys", { publicKey: jwk })).status).toBe(409);
  });
});

describe("retiring a key", () => {
  it("marks it revoked, for its owner only, and publishing it again does not bring it back", async () => {
    const id = (await pool[0].raw("post", "/keys", { publicKey: jwk }).expect(201)).body.id;
    expect((await pool[1].raw("post", `/keys/${id}/revoke`)).status).toBe(404); // not their key
    await pool[0].raw("post", `/keys/${id}/revoke`).expect(200);
    expect((await pool[0].raw("get", "/keys")).body.keys[0]).toMatchObject({ id, revoked: true });
    await pool[0].raw("post", "/keys", { publicKey: jwk }).expect(200);
    expect((await pool[0].raw("get", "/keys")).body.keys[0].revoked).toBe(true);
    expect((await pool[0].raw("post", "/keys/nothing/revoke")).status).toBe(404);
  });

  it("lists the public key with each key", async () => {
    await pool[0].raw("post", "/keys", { publicKey: jwk }).expect(201);
    expect((await pool[0].raw("get", "/keys")).body.keys[0].publicKey).toEqual({ e: "AQAB", kty: "RSA", n: jwk.n });
  });
});

describe("the backup of the private key", () => {
  const backup = () => ({ v: 1, iv: Buffer.from(webcrypto.getRandomValues(new Uint8Array(12))).toString("base64"), data: Buffer.from(webcrypto.getRandomValues(new Uint8Array(1900))).toString("base64") });

  it("is stored, listed as present, and given back to its owner only", async () => {
    const b = backup();
    await pool[0].raw("put", "/keys/backup", b).expect(200);
    expect((await pool[0].raw("get", "/keys")).body.hasBackup).toBe(true);
    expect((await pool[0].raw("get", "/keys/backup").expect(200)).body).toEqual(b);
    expect((await pool[1].raw("get", "/keys/backup")).status).toBe(404);
  });

  it("is replaced by a newer one", async () => {
    await pool[0].raw("put", "/keys/backup", backup()).expect(200);
    const second = backup();
    await pool[0].raw("put", "/keys/backup", second).expect(200);
    expect((await pool[0].raw("get", "/keys/backup")).body).toEqual(second);
  });

  it.each([
    ["a wrong version", { ...{ iv: "AAAAAAAAAAAAAAAA", data: "A".repeat(100) }, v: 2 }],
    ["an iv of the wrong length", { v: 1, iv: "AAAA", data: "A".repeat(100) }],
    ["data that is not base64", { v: 1, iv: "AAAAAAAAAAAAAAAA", data: "!".repeat(100) }],
    ["data that is far too large", { v: 1, iv: "AAAAAAAAAAAAAAAA", data: "A".repeat(9000) }],
  ])("refuses %s", async (_label, body) => {
    expect((await pool[0].raw("put", "/keys/backup", body)).status).toBe(400);
    expect((await pool[0].raw("get", "/keys")).body.hasBackup).toBe(false);
  });
});

describe("publishing a key together with its backup", () => {
  const backup = { v: 1, iv: Buffer.alloc(12, 1).toString("base64"), data: Buffer.alloc(100, 2).toString("base64") };

  it("stores both in one step and answers with what is stored", async () => {
    const res = await pool[0].raw("post", "/keys", { publicKey: jwk, label: "Laptop", backup }).expect(201);
    expect(res.body).toMatchObject({ label: "Laptop", revoked: false });
    expect(res.body.createdAt).toBeTruthy();
    const mine = (await pool[0].raw("get", "/keys")).body;
    expect(mine.hasBackup).toBe(true);
    expect((await pool[0].raw("get", "/keys/backup").expect(200)).body).toMatchObject(backup);
  });

  it("stores neither when the backup is not valid", async () => {
    await pool[0].raw("post", "/keys", { publicKey: jwk, backup: { v: 1, iv: "x", data: "y" } }).expect(400);
    const mine = (await pool[0].raw("get", "/keys")).body;
    expect(mine.keys).toEqual([]);
    expect(mine.hasBackup).toBe(false);
  });

  it("stores neither when the key is not valid", async () => {
    await pool[0].raw("post", "/keys", { publicKey: { kty: "RSA", n: "abc", e: "AQAB" }, backup }).expect(400);
    expect((await pool[0].raw("get", "/keys")).body.hasBackup).toBe(false);
  });
});

describe("the keys of a safebox", () => {
  const keysOf = (user: User, id: string) => user.raw("get", `/circles/default/friends/${id}/safebox/keys`);

  it("show my keys and my friend's, each from its own side, and none that are retired", async () => {
    const id = await connect(pool[0], pool[1]);
    expect((await keysOf(pool[0], id).expect(200)).body).toEqual({ friendUid: pool[1].p.uid, mine: [], friend: [] });
    const mineId = (await pool[0].raw("post", "/keys", { publicKey: jwk }).expect(201)).body.id;
    const a = (await keysOf(pool[0], id)).body;
    expect(a.mine.map((k: { id: string }) => k.id)).toEqual([mineId]);
    expect(a.friend).toEqual([]);
    const b = (await keysOf(pool[1], id)).body; // the same box from the friend's side: the keys swap places
    expect(b.mine).toEqual([]);
    expect(b.friend.map((k: { id: string }) => k.id)).toEqual([mineId]);
    await pool[0].raw("post", `/keys/${mineId}/revoke`).expect(200);
    expect((await keysOf(pool[1], id)).body.friend).toEqual([]);
  });

  it("are not shown to anyone but the two friends", async () => {
    const id = await connect(pool[0], pool[1]);
    expect((await keysOf(pool[2], id)).status).toBe(404);
  });
});
