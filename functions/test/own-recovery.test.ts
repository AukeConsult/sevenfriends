import { webcrypto, randomBytes } from "node:crypto";
import { getFirestore } from "firebase-admin/firestore";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { sendDueOwnRequestReminders } from "../src/own-request";
import { User, connect, seedPool } from "./helpers";
import { sentPushes } from "./setup";
import { keyListCol, messageCol, ownRequestCol } from "../src/paths";

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
    expect((await pool[0].raw("get", own(`/pending?me=${s.phone}`)).expect(200)).body).toEqual({ eligible: false, keys: [], requests: [] }); // the new device has nothing to give
    expect((await pool[0].raw("get", own("/pending?me=nope")).expect(200)).body.eligible).toBe(false);
  });

  it("gives the waiting key its copies, then marks it allowed", async () => {
    const s = await story();
    const todo = (await pool[0].raw("get", own(`/todo?key=${s.phone}&part=messages`)).expect(200)).body;
    expect(todo.items).toEqual([{ id: s.sent, wraps: [expect.objectContaining({ uid: s.u0, keyId: s.browser })], missing: [s.phone] }]);
    await pool[0].raw("post", own("/done"), { key: s.phone }).expect(409); // not done yet

    expect((await pool[0].raw("post", own("/wraps"), { key: s.phone, part: "messages", items: [{ id: s.sent, wraps: [wrap(s.u0, s.phone)] }] }).expect(200)).body.added).toBe(1);
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
    await pool[0].raw("post", own("/wraps"), { key: s.phone, part: "box", items: [{ id: "file1", connectionId: s.id, wraps: [wrap(s.u0, s.phone)] }] }).expect(200);
    const item = (await getFirestore().collection("safebox").doc(s.id).collection("items").doc("file1").get()).data();
    expect(item?.enc.wraps).toHaveLength(3);
  });

  it("refuses what is not mine: another person's key, another key than the waiting one, a safebox of somebody else", async () => {
    const s = await story();
    const body = (wrapFor: ReturnType<typeof wrap>, extra = {}) => ({ key: s.phone, part: "messages", items: [{ id: s.sent, wraps: [wrapFor] }], ...extra });
    await pool[0].raw("post", own("/wraps"), body(wrap(s.u1, s.phone))).expect(400); // for my friend
    const tablet = await publish(pool[0], keys[3]); // a second key that waits for its own Allow
    await pool[0].raw("post", own("/wraps"), body(wrap(s.u0, tablet))).expect(400); // not for a key that is not allowed (it waits)
    await pool[0].raw("post", own("/wraps"), body(wrap(s.u0, s.phone), { key: s.browser })).expect(409); // a key that is not waiting
    await pool[0].raw("post", own("/wraps"), { key: s.phone, part: "box", items: [{ id: "x", connectionId: "somebody-elses", wraps: [wrap(s.u0, s.phone)] }] }).expect(400);
    await pool[2].raw("get", own(`/todo?key=${s.phone}&part=messages`)).expect(409); // another person has no such key
  });

  it("locks for every allowed key at once and never for a key that still waits; retired copies go; parallel batches lose nothing", async () => {
    const s = await story();
    const tablet = await publish(pool[0], keys[3]); // waits too
    const gone = await publish(pool[0], keys[1]);
    await pool[0].raw("post", `/keys/${gone}/remove`).expect(200);
    await messageCol(s.u0).doc(s.sent).update({ "enc.wraps": [wrap(s.u0, s.browser), wrap(s.u0, gone)] }); // an old copy for a key that was retired
    const todo = (await pool[0].raw("get", own(`/todo?key=${s.phone}&part=messages`)).expect(200)).body;
    expect(todo.keys.map((k: { id: string }) => k.id).sort()).toEqual([s.browser, s.phone].sort()); // the key being allowed and the one that works, not the tablet
    expect(todo.items).toEqual([{ id: s.sent, wraps: expect.any(Array), missing: [s.phone] }]);
    const items = [{ id: s.sent, wraps: [wrap(s.u0, s.phone)] }];
    await Promise.all([1, 2, 3].map(() => pool[0].raw("post", own("/wraps"), { key: s.phone, part: "messages", items })));
    const keyIds = (await pool[0].feed(s.id)).body.messages[0].enc.wraps.map((w: { keyId: string }) => w.keyId).sort();
    expect(keyIds).toEqual([s.browser, s.phone].sort()); // the retired key's copy is gone, one copy for the phone, none for the tablet
    expect(keyIds).not.toContain(tablet);
  });

  it("a key allowed before that has no copies yet gets them too", async () => {
    const s = await story();
    await pool[0].raw("post", own("/trust"), { key: s.phone }).expect(200); // the phone counts as allowed (it is the one that works), but has no copy yet
    const tablet = await publish(pool[0], keys[3]);
    const todo = (await pool[0].raw("get", own(`/todo?key=${tablet}&part=messages`)).expect(200)).body;
    expect(todo.items[0].missing.sort()).toEqual([s.phone, tablet].sort());
  });

  it("a key that still lacks copies is not allowed: done is refused and the request stays", async () => {
    const s = await story();
    await pool[0].raw("post", own("/ask"), { key: s.phone }).expect(201);
    await pool[0].raw("post", own("/done"), { key: s.phone }).expect(409);
    expect((await pool[0].raw("get", own(`/request?key=${s.phone}`)).expect(200)).body.request).toMatchObject({ status: "asked" });
  });

  it("a person can say which device works: that key helps, the others wait", async () => {
    const s = await story();
    await pool[0].raw("post", own("/trust"), { key: "nope" }).expect(409);
    await pool[0].raw("post", own("/trust"), { key: s.phone }).expect(200);
    expect((await pool[0].raw("get", own(`/pending?me=${s.phone}`)).expect(200)).body).toMatchObject({ eligible: true, keys: [expect.objectContaining({ id: s.browser })] });
    expect((await pool[0].raw("get", own(`/pending?me=${s.browser}`)).expect(200)).body).toEqual({ eligible: false, keys: [], requests: [] });
  });

  it("tells how many messages and files are still locked for a key", async () => {
    const s = await story();
    expect((await pool[0].raw("get", own(`/status?key=${s.phone}`)).expect(200)).body).toEqual({ messages: 1, files: 0 });
    expect((await pool[0].raw("get", own(`/status?key=${s.browser}`)).expect(200)).body).toEqual({ messages: 0, files: 0 });
    await pool[0].raw("get", own("/status?key=nope")).expect(409);
  });
});

/** The request of a device to my other devices (docs/design/recovery-own-devices.md): made by itself, asked at any time, live progress, "Not me", nothing kept when done. */
describe("a device asks my other devices", () => {
  const stamp = async (uid: string) => (await getFirestore().collection("user-account").doc(uid).collection("sync").doc("state").get()).data()?.keysAt;
  const device = () => pool[0].raw("post", "/push/devices", { token: "token-00-a".padEnd(30, "x") }).expect(204);
  const mine = async (key: string) => (await pool[0].raw("get", own(`/request?key=${key}`)).expect(200)).body.request;

  it("a key added next to others makes a request by itself, with a push and a stamp", async () => {
    const id = await connect(pool[0], pool[1]);
    void id;
    const browser = await publish(pool[0], keys[0]);
    await device();
    sentPushes.length = 0;
    const phone = await publish(pool[0], keys[2]);
    expect(await mine(phone)).toMatchObject({ keyId: phone, status: "asked" });
    expect(await mine(browser)).toBeNull(); // the first key needs nothing
    expect(sentPushes.at(-1)?.data).toMatchObject({ id: `own-recovery-${phone}`, url: expect.stringMatching(/^\//) });
    expect(await stamp(pool[0].p.uid)).toBeTruthy();
    const pending = (await pool[0].raw("get", own(`/pending?me=${browser}`)).expect(200)).body;
    expect(pending.requests).toEqual([expect.objectContaining({ keyId: phone, status: "asked" })]);
    expect(pending.keys).toEqual([expect.objectContaining({ id: phone })]);
  });

  it("a request nobody answers gets one more push after a day, and only while it still waits", async () => {
    await connect(pool[0], pool[1]);
    const browser = await publish(pool[0], keys[0]);
    await device();
    const phone = await publish(pool[0], keys[2]);
    const hours = (n: number) => new Date(Date.now() + n * 3600000);
    sentPushes.length = 0;
    expect(await sendDueOwnRequestReminders(hours(23))).toBe(0); // not yet
    expect(await sendDueOwnRequestReminders(hours(25))).toBe(1);
    expect(sentPushes.at(-1)?.data).toMatchObject({ id: `own-recovery-${phone}`, title: expect.stringContaining("still waiting") });
    expect(await sendDueOwnRequestReminders(hours(50))).toBe(0); // once
    // a request that was answered before the day is over gets no reminder
    await pool[0].raw("post", own("/start"), { key: phone, me: browser }).expect(200);
    await getFirestore().collection("own-recovery-reminders").doc(`${pool[0].p.uid}_${phone}`).set({ uid: pool[0].p.uid, keyId: phone, at: hours(-1) });
    sentPushes.length = 0;
    expect(await sendDueOwnRequestReminders()).toBe(0);
    expect(sentPushes).toHaveLength(0);
    expect((await getFirestore().collection("own-recovery-reminders").get()).docs).toHaveLength(0); // looked at, so gone
  });

  it("works with progress on both sides, and a finished request is told and then deleted", async () => {
    const s = await story();
    await device();
    await pool[0].raw("post", own("/start"), { key: s.phone, me: s.browser }).expect(200);
    expect(await mine(s.phone)).toMatchObject({ status: "working", total: 1, added: 0 });
    await pool[0].raw("post", own("/start"), { key: s.phone, me: s.phone }).expect(409); // the asking key cannot help itself
    await pool[0].raw("post", own("/wraps"), { key: s.phone, part: "messages", items: [{ id: s.sent, wraps: [wrap(s.u0, s.phone)] }] }).expect(200);
    expect(await mine(s.phone)).toMatchObject({ status: "working", added: 1 });
    sentPushes.length = 0;
    await pool[0].raw("post", own("/done"), { key: s.phone }).expect(200);
    expect(await mine(s.phone)).toMatchObject({ status: "done" });
    expect(sentPushes.at(-1)?.data).toMatchObject({ id: `own-recovery-done-${s.phone}`, title: expect.stringContaining("is open on") });
    await pool[0].raw("post", own("/dismiss"), { key: s.phone }).expect(200);
    expect(await mine(s.phone)).toBeNull(); // nothing is kept
    expect((await getFirestore().collection("user-account").doc(s.u0).collection("own-recovery-request").doc(s.phone).get()).exists).toBe(false);
  });

  it("asking again at any time: a new request replaces the old one, also after it was allowed", async () => {
    const s = await story();
    await pool[0].raw("post", own("/wraps"), { key: s.phone, part: "messages", items: [{ id: s.sent, wraps: [wrap(s.u0, s.phone)] }] }).expect(200);
    await pool[0].raw("post", own("/done"), { key: s.phone }).expect(200);
    await pool[0].raw("post", own("/dismiss"), { key: s.phone }).expect(200);
    const asked = (await pool[0].raw("post", own("/ask"), { key: s.phone }).expect(201)).body.request;
    expect(asked).toMatchObject({ keyId: s.phone, status: "asked", total: 0 }); // nothing is missing, and it can still be asked
    expect((await pool[0].raw("get", own(`/pending?me=${s.browser}`)).expect(200)).body.requests).toHaveLength(1);
    // and the other device can do the work for a key that was allowed before (the request opens it)
    await pool[0].raw("get", own(`/todo?key=${s.phone}&part=messages`)).expect(200);
    await pool[0].raw("post", own("/ask"), { key: s.phone }).expect(201); // again
    await pool[0].raw("post", own("/ask"), { key: "nope" }).expect(409);
  });

  it("needs another device with a key: a lone key cannot ask", async () => {
    await connect(pool[0], pool[1]);
    const only = await publish(pool[0], keys[0]);
    await pool[0].raw("post", own("/ask"), { key: only }).expect(409);
  });

  it("\"Not me\" removes the key that asked, and the asking device reads it once", async () => {
    const s = await story();
    await pool[0].raw("post", own("/decline"), { key: s.phone, me: s.phone }).expect(409); // only a device that can help
    await pool[0].raw("post", own("/decline"), { key: s.phone, me: s.browser }).expect(200);
    expect((await pool[0].raw("get", "/keys").expect(200)).body.keys.find((k: { id: string }) => k.id === s.phone)).toBeUndefined(); // the key that was not me is deleted
    expect(await mine(s.phone)).toMatchObject({ status: "declined" });
    expect((await pool[0].raw("get", own(`/pending?me=${s.browser}`)).expect(200)).body.requests).toEqual([]);
    await pool[0].raw("post", own("/dismiss"), { key: s.phone }).expect(200);
    expect(await mine(s.phone)).toBeNull();
  });

  it("a person cannot touch the requests of somebody else", async () => {
    const s = await story();
    expect((await pool[1].raw("get", own(`/request?key=${s.phone}`)).expect(200)).body.request).toBeNull();
    await pool[1].raw("post", own("/decline"), { key: s.phone, me: s.browser }).expect(409);
    await pool[1].raw("post", own("/ask"), { key: s.phone }).expect(409);
  });
});

/** A new device that is not approved asks all my other devices by itself, and a device that really holds everything says so, so it can approve (no device is retired). */
describe("automatic approval of a new device", () => {
  const listOf = (uid: string, ids: string[]) => keyListCol(uid).doc("1").set({ version: 1, devices: ids.map((keyId) => ({ keyId })) });
  const waitingOf = async (user: User) => ((await user.raw("get", "/keys").expect(200)).body.keys as { id: string; waiting?: boolean }[]).filter((k) => k.waiting).map((k) => k.id);

  it("a key that holds the copies but is not in my signed list still waits, and a device that is in the list is asked to approve it", async () => {
    const s = await story();
    await listOf(s.u0, [s.browser]);
    await pool[0].raw("post", own("/wraps"), { key: s.phone, part: "messages", items: [{ id: s.sent, wraps: [wrap(s.u0, s.phone)] }] }).expect(200);
    await pool[0].raw("post", own("/done"), { key: s.phone }).expect(200); // it has every copy now (shared) but the list does not name it
    await ownRequestCol(s.u0).doc(s.phone).delete(); // and nobody asked (an old device, or the request was dismissed)
    expect(await waitingOf(pool[0])).toEqual([s.phone]);
    const found = (await pool[0].raw("get", own(`/pending?me=${s.browser}`)).expect(200)).body;
    expect(found.eligible).toBe(true);
    expect(found.keys.map((k: { id: string }) => k.id)).toEqual([s.phone]);
    expect(found.requests.map((r: { keyId: string }) => r.keyId)).toEqual([s.phone]); // the request was made by itself
  });

  it("once the list names the key it no longer waits", async () => {
    const s = await story();
    await listOf(s.u0, [s.browser, s.phone]);
    expect(await waitingOf(pool[0])).toEqual([]);
  });

  it("without a list the old rule stays: a key waits until it is shared", async () => {
    const s = await story();
    expect(await waitingOf(pool[0])).toEqual([s.phone]);
    await pool[0].raw("post", own("/wraps"), { key: s.phone, part: "messages", items: [{ id: s.sent, wraps: [wrap(s.u0, s.phone)] }] }).expect(200);
    await pool[0].raw("post", own("/done"), { key: s.phone }).expect(200);
    expect(await waitingOf(pool[0])).toEqual([]);
  });

  it("/works: a key that lacks copies is refused, one that holds everything becomes a helper next to the others, an unknown key and another person's key are refused", async () => {
    const s = await story();
    await pool[0].raw("post", own("/works"), { key: s.phone }).expect(409); // one message has no copy for it
    await pool[0].raw("post", own("/works"), { key: "nope" }).expect(409);
    await pool[1].raw("post", own("/works"), { key: s.phone }).expect(409); // not his key
    expect((await pool[0].raw("get", own(`/pending?me=${s.phone}`)).expect(200)).body.eligible).toBe(false);
    await pool[0].raw("post", own("/wraps"), { key: s.phone, part: "messages", items: [{ id: s.sent, wraps: [wrap(s.u0, s.phone)] }] }).expect(200);
    await pool[0].raw("post", own("/works"), { key: s.phone }).expect(200);
    await pool[0].raw("post", own("/works"), { key: s.phone }).expect(200); // again: the same
    expect((await pool[0].raw("get", own(`/pending?me=${s.phone}`)).expect(200)).body.eligible).toBe(true);
    expect((await pool[0].raw("get", own(`/pending?me=${s.browser}`)).expect(200)).body.eligible).toBe(true); // the first key still helps: nobody was retired
    expect((await pool[0].raw("get", "/keys").expect(200)).body.keys).toHaveLength(2); // nobody was removed
  });

  it("an old install that no device holds any more (the oldest key) no longer decides: the device that works can approve a new one", async () => {
    const ghost = await publish(pool[0], keys[0]);
    const real = await publish(pool[0], keys[1]);
    await pool[0].raw("post", own("/works"), { key: real }).expect(200); // nothing is locked for it yet: it holds everything
    const fresh = await publish(pool[0], keys[2]);
    await pool[0].raw("post", own("/ask"), { key: fresh }).expect(201);
    const found = (await pool[0].raw("get", own(`/pending?me=${real}`)).expect(200)).body;
    expect(found).toMatchObject({ eligible: true });
    expect(found.keys.map((k: { id: string }) => k.id)).toContain(fresh);
    expect(found.keys.map((k: { id: string }) => k.id)).not.toContain(real);
    expect(ghost).not.toBe(real);
  });

  it("the new device approved by another one can then send: it is in the signed list and gets its copies (the whole path)", async () => {
    const s = await story();
    await pool[0].raw("post", own("/ask"), { key: s.phone }).expect(201);
    await pool[0].raw("post", own("/start"), { key: s.phone, me: s.browser }).expect(200);
    await pool[0].raw("post", own("/wraps"), { key: s.phone, part: "messages", items: [{ id: s.sent, wraps: [wrap(s.u0, s.phone)] }] }).expect(200);
    await pool[0].raw("post", own("/done"), { key: s.phone }).expect(200);
    await listOf(s.u0, [s.browser, s.phone]); // what the approving device signs
    expect(await waitingOf(pool[0])).toEqual([]);
    expect((await pool[0].raw("get", own(`/pending?me=${s.phone}`)).expect(200)).body.eligible).toBe(true);
  });
});
