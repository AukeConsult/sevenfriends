import { webcrypto, randomBytes } from "node:crypto";
import { getFirestore } from "firebase-admin/firestore";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { User, connect, seedPool } from "./helpers";

/** Recovery from my own other device: the key of a device that can open my messages gives my other keys their copies, for every friend at once. */
let pool: User[];
const keys: JsonWebKey[] = [];

const makeKey = async () => {
  const pair = await webcrypto.subtle.generateKey({ name: "RSA-OAEP", modulusLength: 3072, publicExponent: new Uint8Array([1, 0, 1]), hash: "SHA-256" }, true, ["encrypt", "decrypt"]);
  return (await webcrypto.subtle.exportKey("jwk", pair.publicKey)) as JsonWebKey;
};
beforeAll(async () => {
  for (let i = 0; i < 4; i++) keys.push(await makeKey());
}, 90000);
beforeEach(async () => {
  pool = await seedPool();
});

const b64 = (n: number) => randomBytes(n).toString("base64");
const wrap = (uid: string, keyId: string) => ({ uid, keyId, wrappedKey: b64(384) });
const publish = async (user: User, jwk: JsonWebKey) => (await user.raw("post", "/keys", { publicKey: jwk }).expect(201)).body.id as string;
const messages = (id: string) => `/circles/default/friends/${id}/messages`;
const own = (rest: string) => `/own-recovery${rest}`;

/** 0 has a key (the browser) and sends one locked message to 1; then 0 adds a second key (the phone). */
async function story() {
  const id = await connect(pool[0], pool[1]);
  const [u0, u1] = [pool[0].p.uid, pool[1].p.uid];
  const browser = await publish(pool[0], keys[0]);
  const friend = await publish(pool[1], keys[1]);
  const sent = (await pool[0].raw("post", messages(id), { text: b64(40), enc: { v: 1, iv: b64(12), wraps: [wrap(u0, browser), wrap(u1, friend)] } }).expect(201)).body.id as string;
  const phone = await publish(pool[0], keys[2]);
  return { id, u0, u1, browser, friend, phone, sent };
}

describe("a key of mine is allowed by another device of mine", () => {
  it("the first key needs nothing; a key added next to it waits, and only the first key is asked to help", async () => {
    const s = await story();
    expect((await pool[0].raw("get", own(`/pending?me=${s.browser}`)).expect(200)).body).toMatchObject({ eligible: true, keys: [expect.objectContaining({ id: s.phone })] });
    expect((await pool[0].raw("get", own(`/pending?me=${s.phone}`)).expect(200)).body).toEqual({ eligible: false, keys: [] }); // the new device has nothing to give
    expect((await pool[0].raw("get", own("/pending?me=nope")).expect(200)).body.eligible).toBe(false);
  });

  it("gives the waiting key its copies, then marks it allowed", async () => {
    const s = await story();
    const todo = (await pool[0].raw("get", own(`/todo?key=${s.phone}&part=messages`)).expect(200)).body;
    expect(todo.items).toEqual([{ id: s.sent, wraps: [expect.objectContaining({ uid: s.u0, keyId: s.browser })], missing: [s.phone] }]);
    await pool[0].raw("post", own("/done"), { key: s.phone }).expect(409); // not done yet

    expect((await pool[0].raw("post", own("/wraps"), { key: s.phone, part: "messages", items: [{ id: s.sent, wrap: wrap(s.u0, s.phone) }] }).expect(200)).body.added).toBe(1);
    expect((await pool[0].feed(s.id)).body.messages[0].enc.wraps.map((w: { keyId: string }) => w.keyId).sort()).toEqual([s.browser, s.phone].sort());
    expect((await pool[0].raw("get", own(`/todo?key=${s.phone}&part=messages`)).expect(200)).body.items).toEqual([]);

    await pool[0].raw("post", own("/done"), { key: s.phone }).expect(200);
    expect((await pool[0].raw("get", own(`/pending?me=${s.browser}`)).expect(200)).body.keys).toEqual([]);
    expect((await pool[0].raw("get", own(`/pending?me=${s.phone}`)).expect(200)).body.eligible).toBe(true); // now it can help the next one
  });

  it("also covers the files of the safebox, in every friendship", async () => {
    const s = await story();
    await getFirestore().collection("safebox").doc(s.id).collection("items").doc("file1").set({ enc: { v: 1, wraps: [wrap(s.u0, s.browser), wrap(s.u1, s.friend)] } });
    const todo = (await pool[0].raw("get", own(`/todo?key=${s.phone}&part=box`)).expect(200)).body;
    expect(todo.items).toEqual([{ id: "file1", connectionId: s.id, wraps: [expect.objectContaining({ uid: s.u0 })], missing: [s.phone] }]);
    await pool[0].raw("post", own("/wraps"), { key: s.phone, part: "box", items: [{ id: "file1", connectionId: s.id, wrap: wrap(s.u0, s.phone) }] }).expect(200);
    const item = (await getFirestore().collection("safebox").doc(s.id).collection("items").doc("file1").get()).data();
    expect(item?.enc.wraps).toHaveLength(3);
  });

  it("refuses what is not mine: another person's key, another key than the waiting one, a safebox of somebody else", async () => {
    const s = await story();
    const body = (wrapFor: ReturnType<typeof wrap>, extra = {}) => ({ key: s.phone, part: "messages", items: [{ id: s.sent, wrap: wrapFor }], ...extra });
    await pool[0].raw("post", own("/wraps"), body(wrap(s.u1, s.phone))).expect(400); // for my friend
    await pool[0].raw("post", own("/wraps"), body(wrap(s.u0, s.browser))).expect(400); // not for the waiting key
    await pool[0].raw("post", own("/wraps"), body(wrap(s.u0, s.phone), { key: s.browser })).expect(409); // a key that is not waiting
    await pool[0].raw("post", own("/wraps"), { key: s.phone, part: "box", items: [{ id: "x", connectionId: "somebody-elses", wrap: wrap(s.u0, s.phone) }] }).expect(400);
    await pool[2].raw("get", own(`/todo?key=${s.phone}&part=messages`)).expect(409); // another person has no such key
  });
});
