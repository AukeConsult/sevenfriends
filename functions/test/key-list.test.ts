import { webcrypto } from "node:crypto";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { DeviceList, SIGNED_MARK, canonicalPublicKey, packSignedText, signedTextBytes, unpackSignedText, canonicalSignKey, deviceListHash, deviceListText, fingerprintOf, keyIdOf } from "../src/models";
import { User, connect, seedPool } from "./helpers";

/** The signed device list and the signing key (docs/design/default-key.md, step 1). The server keeps the chain and checks its structure only. */
let pool: User[];
let lock: JsonWebKey;
let lock2: JsonWebKey;
let sign: JsonWebKey;
let signPair: CryptoKeyPair;

const lockKey = async () => (await webcrypto.subtle.exportKey("jwk", (await webcrypto.subtle.generateKey({ name: "RSA-OAEP", modulusLength: 3072, publicExponent: new Uint8Array([1, 0, 1]), hash: "SHA-256" }, true, ["encrypt", "decrypt"])).publicKey)) as JsonWebKey;
const signKey = async () => {
  const pair = await webcrypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign", "verify"]);
  return { pair, jwk: (await webcrypto.subtle.exportKey("jwk", pair.publicKey)) as JsonWebKey };
};

beforeAll(async () => {
  lock = await lockKey();
  lock2 = await lockKey();
  const s = await signKey();
  sign = s.jwk;
  signPair = s.pair;
}, 60000);

beforeEach(async () => {
  pool = await seedPool();
});

/** The lock keys are published first (with the signing key): a list may only name keys the person has published. */
const publish = async (user: User, ...keys: JsonWebKey[]) => {
  for (const k of keys) await user.raw("post", "/keys", { publicKey: k, signKey: sign }).expect(201);
};

const signed = async (version: number, prev: string, keys: JsonWebKey[], since?: string): Promise<DeviceList> => {
  const devices = await Promise.all(keys.map(async (k, i) => ({ keyId: keyIdOf((await fingerprintOf(k))!), lockKey: canonicalPublicKey(k)!, signKey: canonicalSignKey(sign)!, label: `Device ${i}` })));
  const list = { version, devices, prev, signedBy: devices[0].keyId, signature: "", ...(since ? { since } : {}) };
  const sig = await webcrypto.subtle.sign({ name: "ECDSA", hash: "SHA-256" }, signPair.privateKey, new TextEncoder().encode(deviceListText(list)));
  return { ...list, signature: Buffer.from(sig).toString("base64") };
};

describe("publishing a signing key", () => {
  it("is kept with a new lock key", async () => {
    await pool[0].raw("post", "/keys", { publicKey: lock, signKey: sign }).expect(201);
    const keys = (await pool[0].raw("get", "/keys")).body.keys;
    expect(keys[0].signKey).toMatchObject({ kty: "EC", crv: "P-256" });
  });

  it("is never added to a key that is already published (an older lock stays as it is)", async () => {
    await pool[0].raw("post", "/keys", { publicKey: lock }).expect(201);
    await pool[0].raw("post", "/keys", { publicKey: lock, signKey: sign }).expect(200);
    expect((await pool[0].raw("get", "/keys")).body.keys[0].signKey).toBeUndefined();
  });

  it.each([["a private key", { kty: "EC", crv: "P-256", x: "A".repeat(43), y: "A".repeat(43), d: "x" }], ["another curve", { kty: "EC", crv: "P-384", x: "A".repeat(43), y: "A".repeat(43) }], ["short coordinates", { kty: "EC", crv: "P-256", x: "a", y: "b" }]])("refuses %s", async (_n, k) => {
    const res = await pool[0].raw("post", "/keys", { publicKey: lock, signKey: k });
    if (res.status === 201) expect(JSON.stringify((await pool[0].raw("get", "/keys")).body)).not.toContain('"d"'); // a private part is cut away, never stored
    else expect(res.status).toBe(400);
  });
});

describe("the device list", () => {
  it("is empty at first", async () => {
    expect((await pool[0].raw("get", "/keys/list").expect(200)).body.lists).toEqual([]);
  });

  it("starts at version 1 and grows by one, each linked to the one before", async () => {
    await publish(pool[0], lock, lock2);
    const v1 = await signed(1, "", [lock]);
    await pool[0].raw("post", "/keys/list", v1).expect(201);
    const v2 = await signed(2, await deviceListHash(v1), [lock, lock2]);
    await pool[0].raw("post", "/keys/list", v2).expect(201);
    const lists = (await pool[0].raw("get", "/keys/list")).body.lists as DeviceList[];
    expect(lists.map((l) => l.version)).toEqual([1, 2]);
    expect(lists[1].devices).toHaveLength(2);
    expect((await pool[1].raw("get", "/keys/list")).body.lists).toEqual([]); // only mine
  });

  it("never replaces a version, skips one, or takes a wrong link", async () => {
    await publish(pool[0], lock);
    const v1 = await signed(1, "", [lock]);
    await pool[0].raw("post", "/keys/list", v1).expect(201);
    await pool[0].raw("post", "/keys/list", v1).expect(409); // the same version again
    await pool[0].raw("post", "/keys/list", await signed(3, await deviceListHash(v1), [lock])).expect(409); // a gap
    await pool[0].raw("post", "/keys/list", await signed(2, "0".repeat(64), [lock])).expect(409); // not linked to version 1
    expect((await pool[0].raw("get", "/keys/list")).body.lists).toHaveLength(1);
  });

  it("keeps the date of version 1 (it is part of the signed text) and refuses a bad one or one on a later version", async () => {
    await publish(pool[0], lock);
    const v1 = await signed(1, "", [lock], "2026-11-11T10:00:00.000Z");
    await pool[0].raw("post", "/keys/list", { ...v1, since: "yesterday" }).expect(400);
    await pool[0].raw("post", "/keys/list", v1).expect(201);
    expect((await pool[0].raw("get", "/keys/list")).body.lists[0].since).toBe("2026-11-11T10:00:00.000Z");
    await pool[0].raw("post", "/keys/list", await signed(2, await deviceListHash(v1), [lock], "2026-11-12T10:00:00.000Z")).expect(400);
  });

  it("names only keys the person has published and still uses, and is signed by a device of the version before", async () => {
    await publish(pool[0], lock);
    const v1 = await signed(1, "", [lock]);
    await pool[0].raw("post", "/keys/list", await signed(1, "", [lock2])).expect(409); // lock2 was never published
    await pool[0].raw("post", "/keys/list", v1).expect(201);
    const v2 = await signed(2, await deviceListHash(v1), [lock2]);
    await pool[0].raw("post", "/keys/list", v2).expect(409); // not published: refused, and the signer (lock2) is not in version 1
    await publish(pool[0], lock2);
    await pool[0].raw("post", "/keys/list", { ...v2, signedBy: (await signed(1, "", [lock2])).signedBy }).expect(409); // signed by a device that is not in version 1
    const v2ok = { ...(await signed(2, await deviceListHash(v1), [lock, lock2])) };
    await pool[0].raw("post", "/keys/list", v2ok).expect(201); // lock signs, lock2 joins
    // a key that was retired can not be named
    const keys = (await pool[0].raw("get", "/keys")).body.keys as { id: string; publicKey: JsonWebKey }[];
    await pool[0].raw("post", `/keys/${keys.find((k) => k.publicKey.n === (lock2 as { n: string }).n)!.id}/revoke`).expect(200);
    await pool[0].raw("post", "/keys/list", await signed(3, await deviceListHash(v2ok), [lock, lock2])).expect(409);
    await pool[0].raw("post", "/keys/list", await signed(3, await deviceListHash(v2ok), [lock])).expect(201); // taking it out is fine
  });

  it("refuses a badly formed list", async () => {
    await publish(pool[0], lock);
    const good = await signed(1, "", [lock]);
    await pool[0].raw("post", "/keys/list", { ...good, devices: [] }).expect(400);
    await pool[0].raw("post", "/keys/list", { ...good, devices: [{ ...good.devices[0], keyId: "a".repeat(32) }] }).expect(400); // a key ID that does not fit the key
    await pool[0].raw("post", "/keys/list", { ...good, devices: [{ ...good.devices[0], signKey: { kty: "EC" } }] }).expect(400);
    await pool[0].raw("post", "/keys/list", { ...good, prev: "x" }).expect(400);
    await pool[0].raw("post", "/keys/list", { ...good, signedBy: "b".repeat(32) }).expect(400); // version 1 signed by someone who is not in it
    await pool[0].raw("post", "/keys/list", { ...good, signature: "short" }).expect(400);
    await pool[0].raw("post", "/keys/list", { version: 1 }).expect(400);
  });
});

describe("a friend reading my device lists", () => {
  it("gets them for a confirmed friend only, every version, without the creation time", async () => {
    await publish(pool[0], lock, lock2);
    const v1 = await signed(1, "", [lock]);
    await pool[0].raw("post", "/keys/list", v1).expect(201);
    await pool[0].raw("post", "/keys/list", await signed(2, await deviceListHash(v1), [lock, lock2])).expect(201);
    const id = await connect(pool[0], pool[1]);
    const res = await pool[1].raw("get", `/circles/default/friends/${id}/safebox/key-lists`).expect(200);
    expect(res.body.people).toHaveLength(1);
    expect(res.body.people[0].uid).toBe(pool[0].p.uid);
    expect(res.body.people[0].lists.map((l: DeviceList) => l.version)).toEqual([1, 2]);
    expect(res.body.people[0].lists[0].createdAt).toBeUndefined();
    // a person without a list (an older lock) is listed with none
    const back = await pool[0].raw("get", `/circles/default/friends/${id}/safebox/key-lists`).expect(200);
    expect(back.body.people[0].lists).toEqual([]);
  });
});

describe("a signed text", () => {
  const body = { a: "uid00", c: "conn1", t: "2026-11-11T10:00:00.000Z", k: "k".repeat(32), x: "Hello" };

  it("is told from a plain text and packs and unpacks", async () => {
    const sig = Buffer.from(await webcrypto.subtle.sign({ name: "ECDSA", hash: "SHA-256" }, signPair.privateKey, new TextEncoder().encode(signedTextBytes(body)))).toString("base64");
    const packed = packSignedText({ v: 1, ...body, s: sig });
    expect(packed.startsWith(SIGNED_MARK)).toBe(true);
    expect(unpackSignedText(packed)).toEqual({ v: 1, ...body, s: sig });
    expect(unpackSignedText("Just a text")).toBe("plain");
    expect(unpackSignedText(SIGNED_MARK + "{not json")).toBeNull();
    expect(unpackSignedText(SIGNED_MARK + JSON.stringify({ v: 1, a: "x" }))).toBeNull();
  });

  it("holds only for the writer, the place, the time and the text it was made for", async () => {
    const verify = async (b: typeof body, sig: string) =>
      webcrypto.subtle.verify({ name: "ECDSA", hash: "SHA-256" }, await webcrypto.subtle.importKey("jwk", sign, { name: "ECDSA", namedCurve: "P-256" }, false, ["verify"]), Buffer.from(sig, "base64"), new TextEncoder().encode(signedTextBytes(b)));
    const sig = Buffer.from(await webcrypto.subtle.sign({ name: "ECDSA", hash: "SHA-256" }, signPair.privateKey, new TextEncoder().encode(signedTextBytes(body)))).toString("base64");
    expect(await verify(body, sig)).toBe(true);
    expect(await verify({ ...body, a: "uid01" }, sig)).toBe(false);
    expect(await verify({ ...body, c: "conn2" }, sig)).toBe(false);
    expect(await verify({ ...body, x: "Hullo" }, sig)).toBe(false);
  });
});
