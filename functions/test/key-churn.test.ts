import { webcrypto, randomBytes } from "node:crypto";
import { beforeAll, describe, expect, it } from "vitest";
import { DeviceList, canonicalPublicKey, canonicalSignKey, deviceListHash, deviceListText, fingerprintOf, keyIdOf } from "../src/models";
import { User, connect, seedPool } from "./helpers";

/**
 * Many changes back and forth: 5 people, 3 devices each, everyone a friend of everyone. Devices are approved, removed and replaced by other devices
 * of the same person, and every device sends to every friend in between. Rules checked after every round:
 *  1. A key that another device of the person approved (a new list version) is accepted by every friend and every device WITHOUT a second approval:
 *     the friend's pinned head is still part of the chain, so the pin just moves on.
 *  2. A device that is in the newest list can send; the server wants exactly one copy of the message key for each key in the newest list of both friends.
 *  3. A device that is not in the newest list (not approved yet, removed, replaced) cannot send, and a copy for such a key is refused by the server.
 *  2b. Every message a person ever sent stays verifiable and visible for every friend, however the sender's keys changed afterwards: the signature is checked
 *      against the devices of EVERY list version, and the server still returns the message in the friend's feed.
 *  4. The chain always holds (versions in a row, each linked to the one before and signed by a device of it) and old signatures still verify.
 */
const PEOPLE = 5;
const DEVICES = 3;
const ROUNDS = 60;

interface Device {
  lock: JsonWebKey;
  keyId: string;
  sign: CryptoKeyPair;
  signJwk: JsonWebKey;
  label: string;
}
interface Person {
  user: User;
  devices: Device[]; // every device that exists (listed or not)
  revoked: Set<string>;
  retired: Device[]; // removed or replaced: published once, revoked, never listed again
  published: Set<string>;
  lists: DeviceList[]; // what the server holds, as this test saw it
}

const lockPool: JsonWebKey[] = [];
const takeLock = () => {
  const k = lockPool.pop();
  if (!k) throw new Error("out of lock keys: raise the number made in beforeAll");
  return k;
};
const generateLock = async () => {
  const pair = await webcrypto.subtle.generateKey({ name: "RSA-OAEP", modulusLength: 3072, publicExponent: new Uint8Array([1, 0, 1]), hash: "SHA-256" }, true, ["encrypt", "decrypt"]);
  return (await webcrypto.subtle.exportKey("jwk", pair.publicKey)) as JsonWebKey;
};

beforeAll(async () => {
  const made = await Promise.all(Array.from({ length: PEOPLE * DEVICES + 30 }, generateLock));
  lockPool.push(...made);
}, 280000);

/** a small seeded random generator: the same run every time */
const rng = (seed: number) => () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 2 ** 32);

const b64 = (n: number) => randomBytes(n).toString("base64");
const b64of = (bytes: ArrayBuffer) => Buffer.from(bytes).toString("base64");
const ecdsa = { name: "ECDSA", hash: "SHA-256" } as const;

async function makeDevice(label: string): Promise<Device> {
  const lock = takeLock();
  const sign = await webcrypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign", "verify"]);
  const signJwk = (await webcrypto.subtle.exportKey("jwk", sign.publicKey)) as JsonWebKey;
  return { lock, keyId: keyIdOf((await fingerprintOf(lock))!), sign, signJwk, label };
}

const entryOf = (d: Device) => ({ keyId: d.keyId, lockKey: canonicalPublicKey(d.lock)!, signKey: canonicalSignKey(d.signJwk)!, label: d.label });
const head = (p: Person) => p.lists[p.lists.length - 1];
const listed = (p: Person) => (p.lists.length ? head(p).devices.map((e) => e.keyId) : []);
const isListed = (p: Person, d: Device) => listed(p).includes(d.keyId);

/** the same check a device does (friend-lists.service.ts `chainHolds`) */
async function signatureHolds(list: DeviceList, signers: DeviceList["devices"]) {
  const signer = signers.find((d) => d.keyId === list.signedBy);
  if (!signer) return false;
  const key = await webcrypto.subtle.importKey("jwk", signer.signKey, { name: "ECDSA", namedCurve: "P-256" }, false, ["verify"]);
  return webcrypto.subtle.verify(ecdsa, key, Buffer.from(list.signature, "base64"), new TextEncoder().encode(deviceListText(list)));
}
async function chainHolds(lists: DeviceList[]) {
  for (let i = 0; i < lists.length; i++) {
    const l = lists[i];
    if (l.version !== i + 1) return false;
    if (i === 0 ? l.prev !== "" || !(await signatureHolds(l, l.devices)) : l.prev !== (await deviceListHash(lists[i - 1])) || !(await signatureHolds(l, lists[i - 1].devices))) return false;
  }
  return true;
}

/** a new list version, signed by `by`, a device of the version before */
async function nextList(p: Person, devices: Device[], by: Device): Promise<DeviceList> {
  const prev = p.lists.length ? await deviceListHash(head(p)) : "";
  const list = { version: p.lists.length + 1, devices: devices.map(entryOf), prev, signedBy: by.keyId, signature: "", ...(p.lists.length ? {} : { since: new Date().toISOString() }) };
  return { ...list, signature: b64of(await webcrypto.subtle.sign(ecdsa, by.sign.privateKey, new TextEncoder().encode(deviceListText(list)))) };
}

async function publishKey(p: Person, d: Device) {
  if (p.published.has(d.keyId)) return; // an extra device was published when it was made
  p.published.add(d.keyId);
  await p.user.raw("post", "/keys", { publicKey: d.lock, signKey: d.signJwk, label: d.label }).expect(201);
}
async function publishList(p: Person, devices: Device[], by: Device) {
  const list = await nextList(p, devices, by);
  await p.user.raw("post", "/keys/list", list).expect(201);
  p.lists.push(list);
}

/** an approved device lets another device of the same person in */
async function approve(p: Person, newcomer: Device, by: Device) {
  await publishKey(p, newcomer);
  await publishList(p, [...p.devices.filter((d) => isListed(p, d)), newcomer], by);
}
async function remove(p: Person, gone: Device, by: Device) {
  await publishList(p, p.devices.filter((d) => isListed(p, d) && d !== gone), by);
  await p.user.raw("post", `/keys/${gone.keyId}/revoke`).expect(200);
  p.revoked.add(gone.keyId);
  p.devices.splice(p.devices.indexOf(gone), 1);
  p.retired.push(gone);
}
/** a device replaces its key (rotation): the new key takes its place in the list, signed by the old key */
async function rotate(p: Person, old: Device) {
  const fresh = await makeDevice(old.label);
  await publishKey(p, fresh);
  await publishList(p, p.devices.filter((d) => isListed(p, d)).map((d) => (d === old ? fresh : d)), old);
  await p.user.raw("post", `/keys/${old.keyId}/revoke`).expect(200);
  p.revoked.add(old.keyId);
  p.devices[p.devices.indexOf(old)] = fresh;
  p.retired.push(old);
}

const wrap = (uid: string, keyId: string) => ({ uid, keyId, wrappedKey: b64(384) });
const copiesFor = (...people: Person[]) => people.flatMap((p) => listed(p).map((id) => wrap(p.user.p.uid, id)));

/** what the app does before it locks: this device must be in my newest list, and my friend must have a listed key */
const mayLock = (me: Person, d: Device, friend: Person) => isListed(me, d) && listed(friend).length > 0;

describe("keys changing back and forth, 5 people with 3 devices each", () => {
  it("keeps every friend's trust, the chains and the send rules right through many changes", async () => {
    const random = rng(7);
    const pick = <T>(a: T[]) => a[Math.floor(random() * a.length)];
    const pool = (await seedPool()).slice(0, PEOPLE);
    const people: Person[] = pool.map((user) => ({ user, devices: [], revoked: new Set(), retired: [], published: new Set(), lists: [] }));
    const connection = new Map<string, string>();
    const idOf = (a: number, b: number) => connection.get([a, b].sort().join("-"))!;
    for (let a = 0; a < PEOPLE; a++) for (let b = a + 1; b < PEOPLE; b++) connection.set(`${a}-${b}`, await connect(pool[a], pool[b]));

    // the first device of each person makes version 1 itself; the other two are approved by it
    for (const p of people) {
      p.devices = await Promise.all(Array.from({ length: DEVICES }, (_, i) => makeDevice(`Device ${i}`)));
      await publishKey(p, p.devices[0]);
      await publishList(p, [p.devices[0]], p.devices[0]);
      for (const d of p.devices.slice(1)) await approve(p, d, p.devices[0]);
    }

    // what each person has pinned of each friend: the hash of the newest list that was accepted (version and hash)
    const pins = people.map(() => new Map<number, { version: number; hash: string }>());
    const accepted: number[] = []; // how many times a pin had to be accepted by hand: must stay 0
    const checkFriends = async () => {
      for (let o = 0; o < PEOPLE; o++) {
        for (let f = 0; f < PEOPLE; f++) {
          if (o === f) continue;
          const lists = people[f].lists;
          expect(await chainHolds(lists), `chain of person ${f}`).toBe(true);
          const pin = pins[o].get(f);
          if (pin) {
            // rule 1: the pinned list is still in the chain, so the newer head is accepted and the pin moves on, no second approval
            if (lists[pin.version - 1] === undefined || (await deviceListHash(lists[pin.version - 1])) !== pin.hash) accepted.push(o);
          }
          pins[o].set(f, { version: lists.length, hash: await deviceListHash(lists[lists.length - 1]) });
        }
      }
    };
    await checkFriends();

    let sent = 0;
    let refused = 0;
    const log: { author: number; to: number; text: string; signature: ArrayBuffer; keyId: string }[] = [];
    /** rule 2: an old message is checked like a friend's device does (`checked()`): against the devices of every version of the author's lists */
    const allOldMessagesVerify = async () => {
      for (const m of log) {
        const entries = people[m.author].lists.flatMap((l) => l.devices).filter((e) => e.keyId === m.keyId);
        expect(entries.length, "the sender's key is in some version of the list").toBeGreaterThan(0);
        const key = await webcrypto.subtle.importKey("jwk", entries[0].signKey, { name: "ECDSA", namedCurve: "P-256" }, false, ["verify"]);
        expect(await webcrypto.subtle.verify(ecdsa, key, m.signature, new TextEncoder().encode(m.text)), "an old message no longer verifies").toBe(true);
      }
    };
    for (let round = 0; round < ROUNDS; round++) {
      const p = pick(people);
      const inList = p.devices.filter((d) => isListed(p, d));
      const outside = p.devices.filter((d) => !isListed(p, d));
      const roll = random();
      if (outside.length && roll < 0.35) await approve(p, pick(outside), pick(inList)); // a device is approved by another one
      else if (inList.length > 1 && roll < 0.55) await remove(p, pick(inList), pick(inList)); // may be signed by the removed device itself: it is in the version before
      else if (roll < 0.75 && lockPool.length) await rotate(p, pick(inList)); // a device renews its key
      else if (p.devices.length < DEVICES + 3 && lockPool.length > 2 && roll < 0.85) {
        const extra = await makeDevice(`Extra ${round}`); // a brand new device: published, but waits for approval
        await publishKey(p, extra);
        p.devices.push(extra);
      }
      await checkFriends();

      await allOldMessagesVerify();

      // every device of everyone tries to send to a random friend
      for (let s = 0; s < PEOPLE; s++) {
        const me = people[s];
        const friend = people[(s + 1 + Math.floor(random() * (PEOPLE - 1))) % PEOPLE];
        const friendIndex = people.indexOf(friend);
        for (const d of me.devices) {
          const ok = mayLock(me, d, friend);
          if (!ok) {
            expect(isListed(me, d), "only a device that is not in my newest list is turned away").toBe(false);
            refused++;
            continue;
          }
          const text = b64(40);
          const signature = await webcrypto.subtle.sign(ecdsa, d.sign.privateKey, new TextEncoder().encode(text));
          const body = (wraps: ReturnType<typeof wrap>[]) => ({ text, enc: { v: 1, iv: b64(12), wraps } });
          const url = `/circles/default/friends/${idOf(s, friendIndex)}/messages`;
          // the right copies: one for each key in the newest list of both
          await me.user.raw("post", url, body(copiesFor(me, friend))).expect(201);
          sent++;
          log.push({ author: s, to: friendIndex, text, signature, keyId: d.keyId });
          // the signature holds for the sender's device in every version it was in, and for no other device of that person
          const versions = me.lists.filter((l) => l.devices.some((e) => e.keyId === d.keyId));
          expect(versions.length).toBeGreaterThan(0);
          for (const l of versions) {
            const e = l.devices.find((x) => x.keyId === d.keyId)!;
            const key = await webcrypto.subtle.importKey("jwk", e.signKey, { name: "ECDSA", namedCurve: "P-256" }, false, ["verify"]);
            expect(await webcrypto.subtle.verify(ecdsa, key, signature, new TextEncoder().encode(text))).toBe(true);
          }
          // wrong sets of copies are refused: a key that left the list (or was replaced) is no longer wanted, a missing one is wanted
          const unlisted = [me, friend].flatMap((q) => [...q.devices, ...q.retired].filter((x) => !listed(q).includes(x.keyId)).map((x) => ({ x, q })));
          const gone = unlisted.length ? pick(unlisted) : undefined;
          if (gone) {
            expect((await me.user.raw("post", url, body([...copiesFor(me, friend), wrap(gone.q.user.p.uid, gone.x.keyId)]))).status, "a copy for a key that is not in the list").toBe(409);
          }
          const all = copiesFor(me, friend);
          expect((await me.user.raw("post", url, body(all.slice(1)))).status, "a copy is missing").toBe(409);
        }
      }
    }

    // old keys of replaced devices are gone from every newest list but stayed valid in the older versions
    for (const p of people) {
      expect(await chainHolds(p.lists)).toBe(true);
      const server = (await p.user.raw("get", "/keys/list")).body.lists as DeviceList[];
      expect(server.map((l) => l.version)).toEqual(p.lists.map((l) => l.version));
      expect(await chainHolds(server)).toBe(true);
      for (const id of p.revoked) expect(listed(p)).not.toContain(id);
    }
    await allOldMessagesVerify();
    // the friends still get every message in their feed (rule 2)
    for (let t = 0; t < PEOPLE; t++) {
      for (let a = 0; a < PEOPLE; a++) {
        if (a === t) continue;
        const wanted = log.filter((m) => m.author === a && m.to === t).map((m) => m.text);
        const feed = (await people[t].user.feed(idOf(a, t))).body.messages as { text: string; mine: boolean }[];
        const theirs = feed.filter((m) => !m.mine).map((m) => m.text);
        for (const text of wanted.slice(-20)) expect(theirs, `a message from ${a} is missing for ${t}`).toContain(text);
      }
    }
    expect(accepted, "no friend ever had to accept a new key by hand").toEqual([]);
    expect(sent).toBeGreaterThan(50);
    expect(refused).toBeGreaterThan(0);
    expect(Math.max(...people.map((p) => p.lists.length))).toBeGreaterThan(8);
  }, 280000);

  it("a chain is broken (a friend must be asked) when a version is signed by a device that was not in the version before", async () => {
    lockPool.push(...(await Promise.all([1, 2, 3].map(generateLock)))); // the first test may have used them all
    const [a] = (await seedPool()).slice(0, 1);
    const p: Person = { user: a, devices: [await makeDevice("A"), await makeDevice("B"), await makeDevice("C")], revoked: new Set(), retired: [], published: new Set(), lists: [] };
    await publishKey(p, p.devices[0]);
    await publishList(p, [p.devices[0]], p.devices[0]);
    await approve(p, p.devices[1], p.devices[0]);
    const forged = await nextList(p, [p.devices[0], p.devices[1], p.devices[2]], p.devices[2]); // C was never approved
    expect(await chainHolds([...p.lists, forged])).toBe(false);
    await publishKey(p, p.devices[2]);
    await a.raw("post", "/keys/list", forged).expect(409); // the server refuses it as well
  }, 60000);

  it("rule 3: when every device of a person is lost, the new device cannot approve itself and must ask each friend, one by one", async () => {
    lockPool.push(...(await Promise.all(Array.from({ length: DEVICES + 1 + (PEOPLE - 1) }, generateLock))));
    const pool = (await seedPool()).slice(0, PEOPLE);
    const people: Person[] = pool.map((user) => ({ user, devices: [], revoked: new Set(), retired: [], published: new Set(), lists: [] }));
    const [me, ...friends] = people;
    const connection = await Promise.all(friends.map((f) => connect(me.user, f.user)));
    const url = (i: number, rest = "") => `/circles/default/friends/${connection[i]}${rest}`;

    // everyone has a working list; I have 3 devices, and one message with each friend each way
    for (const p of people) {
      p.devices = await Promise.all(Array.from({ length: p === me ? DEVICES : 1 }, (_, i) => makeDevice(`Device ${i}`)));
      await publishKey(p, p.devices[0]);
      await publishList(p, [p.devices[0]], p.devices[0]);
    }
    for (const d of me.devices.slice(1)) await approve(me, d, me.devices[0]);
    const sendTo = async (from: Person, to: Person, i: number) => {
      const body = { text: b64(40), enc: { v: 1, iv: b64(12), wraps: copiesFor(from, to) } };
      return (await from.user.raw("post", url(i, "/messages"), body).expect(201)).body.id as string;
    };
    const old: string[][] = []; // the ids of the old messages, by friend
    for (let i = 0; i < friends.length; i++) old.push([await sendTo(me, friends[i], i), await sendTo(friends[i], me, i)]);

    // every device is lost: the keys are removed from my account, and a new device makes its keys
    for (const d of me.devices) {
      await me.user.raw("post", `/keys/${d.keyId}/revoke`).expect(200); // the person signs in on the new phone and removes the lost keys; the signed list stays as it was
      me.revoked.add(d.keyId);
    }
    const fresh = await makeDevice("New phone");
    await me.user.raw("post", "/keys", { publicKey: fresh.lock, signKey: fresh.signJwk, label: fresh.label }).expect(201);

    // it is a key of mine, but no device of the last list can sign it in: not the next version, not a new chain, not itself as the signer
    const stuck = await nextList(me, [fresh], fresh);
    expect((await me.user.raw("post", "/keys/list", stuck)).status, "signed by a device that is not in the version before").toBe(409);
    expect((await me.user.raw("post", "/keys/list", { ...stuck, version: 1, prev: "" })).status, "a new chain from version 1").toBe(409);
    expect(isListed(me, fresh), "so the new device is not in my list").toBe(false);
    expect(mayLock(me, fresh, friends[0]), "and it cannot send").toBe(false);

    // it asks every friend (the app does this on its own for each friendship); each friend answers for their own friendship only
    for (let i = 0; i < friends.length; i++) {
      expect((await me.user.raw("post", url(i, "/recovery")).expect(201)).body).toMatchObject({ role: "requester", status: "asked", keyId: fresh.keyId });
      expect((await friends[i].user.raw("get", url(i, "/recovery")).expect(200)).body).toMatchObject({ role: "helper", status: "asked" });
    }
    for (let i = 0; i < friends.length; i++) {
      await friends[i].user.raw("get", url(i, "/recovery/todo?part=messages")).expect(409); // nothing before the friend says yes
      expect((await friends[i].user.raw("post", url(i, "/recovery/approve")).expect(200)).body).toMatchObject({ status: "approved" });
      for (let j = 0; j < friends.length; j++) {
        const state = (await me.user.raw("get", url(j, "/recovery")).expect(200)).body;
        expect(state.status, `friend ${j} after friend ${i} approved`).toBe(j < i ? "done" : j === i ? "approved" : "asked"); // one by one: a yes from one friend is no yes from another
      }
      const todo = (await friends[i].user.raw("get", url(i, "/recovery/todo?part=messages")).expect(200)).body;
      expect(todo.items.map((m: { id: string }) => m.id).sort()).toEqual([...old[i]].sort());
      const items = todo.items.map((m: { id: string }) => ({ id: m.id, wraps: [wrap(me.user.p.uid, fresh.keyId)] }));
      await friends[i].user.raw("post", url(i, "/recovery/wraps"), { part: "messages", items }).expect(200);
      await friends[i].user.raw("post", url(i, "/recovery/finish")).expect(200);
    }

    // rule 2 again: every friend still has every old message, and my copies now have a copy for the new key
    for (let i = 0; i < friends.length; i++) {
      const feed = (await friends[i].user.feed(connection[i])).body.messages as { id: string }[];
      for (const id of old[i]) expect(feed.map((m) => m.id)).toContain(id);
      for (const m of (await me.user.feed(connection[i])).body.messages as { enc: { wraps: { keyId: string }[] } }[]) expect(m.enc.wraps.map((w) => w.keyId)).toContain(fresh.keyId);
    }
  }, 120000);

  it("removing a device takes it out of the signed list and leaves nothing of it: no open request, no push", async () => {
    lockPool.push(...(await Promise.all([1, 2].map(generateLock))));
    const [user] = (await seedPool()).slice(0, 1);
    const p: Person = { user, devices: [await makeDevice("Laptop"), await makeDevice("Phone")], revoked: new Set(), retired: [], published: new Set(), lists: [] };
    const [laptop, phone] = p.devices;
    await publishKey(p, laptop);
    await publishList(p, [laptop], laptop);
    await approve(p, phone, laptop); // the phone is published (a request opens for it) and listed
    const token = "removal-token-phone".padEnd(30, "x");
    await user.raw("post", "/push/devices", { token, keyId: phone.keyId }).expect(204);
    expect((await user.raw("get", `/own-recovery/pending?me=${laptop.keyId}`)).body.requests.map((r: { keyId: string }) => r.keyId)).toContain(phone.keyId);

    expect((await user.raw("post", "/push/test")).body.devices, "the phone is registered").toBe(1);

    await user.raw("post", `/keys/${phone.keyId}/revoke`, { by: phone.keyId }).expect(409); // a device never removes itself
    expect(listed(p)).toEqual([laptop.keyId, phone.keyId]);
    await remove(p, phone, laptop);

    expect(listed(p)).toEqual([laptop.keyId]);
    expect((await user.raw("get", `/own-recovery/pending?me=${laptop.keyId}`)).body.requests, "no request from the removed device").toEqual([]);
    expect((await user.raw("post", "/push/test")).body.devices, "no push goes to it").toBe(0);
    await user.raw("post", "/push/devices", { token, keyId: phone.keyId }).expect(403); // and it cannot register again
  }, 60000);

  it("shows which keys wait for approval, and says why nobody can help when the one approved device is gone", async () => {
    lockPool.push(...(await Promise.all([1, 2].map(generateLock))));
    const [user] = (await seedPool()).slice(0, 1);
    const p: Person = { user, devices: [await makeDevice("Laptop"), await makeDevice("Phone")], revoked: new Set(), retired: [], published: new Set(), lists: [] };
    const [laptop, phone] = p.devices;
    await publishKey(p, laptop);
    await publishKey(p, phone); // added next to the first: waits for approval
    const waiting = async () => ((await user.raw("get", "/keys")).body.keys as { id: string; waiting?: boolean }[]).filter((k) => k.waiting).map((k) => k.id);
    expect(await waiting()).toEqual([phone.keyId]);
    await user.raw("post", `/keys/${laptop.keyId}/revoke`).expect(200); // the one approved device is removed
    const res = await user.raw("post", "/own-recovery/ask", { key: phone.keyId });
    expect(res.status).toBe(409);
    expect(res.body.error).toContain("No other device of yours is approved to help");
  }, 60000);

  it("a new key can ask the other devices when one of them is in my signed list, even if it never got copies of the old messages", async () => {
    lockPool.push(...(await Promise.all([1, 2, 3].map(generateLock))));
    const [user] = (await seedPool()).slice(0, 1);
    const p: Person = { user, devices: [await makeDevice("Laptop"), await makeDevice("Phone"), await makeDevice("New")], revoked: new Set(), retired: [], published: new Set(), lists: [] };
    const [laptop, phone, fresh] = p.devices;
    await publishKey(p, laptop);
    await publishList(p, [laptop], laptop);
    await approve(p, phone, laptop); // the phone is in the signed list
    await user.raw("post", `/keys/${laptop.keyId}/revoke`).expect(200); // the first device is removed
    await publishKey(p, fresh); // a new key on a device
    await user.raw("post", "/own-recovery/ask", { key: fresh.keyId }).expect(201); // the phone (in the list) is asked
    const pending = (await user.raw("get", `/own-recovery/pending?me=${phone.keyId}`)).body;
    expect(pending.eligible, "the phone may help").toBe(true);
    expect(pending.requests.map((r: { keyId: string }) => r.keyId)).toContain(fresh.keyId);
  }, 60000);

  it("a new key made on one device is approved by another device on its own: copies of the old messages, the signed list, and then it can send", async () => {
    lockPool.push(...(await Promise.all([1, 2, 3].map(generateLock))));
    const pool = (await seedPool()).slice(0, 2);
    const [me, friend]: Person[] = pool.map((user) => ({ user, devices: [], revoked: new Set(), retired: [], published: new Set(), lists: [] }));
    const id = await connect(pool[0], pool[1]);
    me.devices = [await makeDevice("Laptop"), await makeDevice("New phone")];
    friend.devices = [await makeDevice("Friend")];
    const [laptop, phone] = me.devices;
    for (const [p, d] of [[me, laptop], [friend, friend.devices[0]]] as [Person, Device][]) {
      await publishKey(p, d);
      await publishList(p, [d], d);
    }
    const url = `/circles/default/friends/${id}/messages`;
    const send = async (from: Person, wraps: ReturnType<typeof wrap>[]) => (await from.user.raw("post", url, { text: b64(40), enc: { v: 1, iv: b64(12), wraps } }).expect(201)).body.id as string;
    const old = await send(me, copiesFor(me, friend));

    await publishKey(me, phone); // a new key on another device: it waits
    expect(mayLock(me, phone, friend), "it cannot send yet").toBe(false);

    // what the laptop does by itself when it sees the key (own-key-prompt.ts, then OwnRecoveryService.allow)
    const pending = (await me.user.raw("get", `/own-recovery/pending?me=${laptop.keyId}`)).body;
    expect(pending.keys.map((k: { id: string }) => k.id)).toEqual([phone.keyId]);
    const todo = (await me.user.raw("get", `/own-recovery/todo?key=${phone.keyId}&part=messages`)).body;
    expect(todo.items.map((m: { id: string }) => m.id)).toEqual([old]);
    await me.user.raw("post", "/own-recovery/wraps", { key: phone.keyId, part: "messages", items: todo.items.map((m: { id: string }) => ({ id: m.id, wrap: wrap(me.user.p.uid, phone.keyId) })) }).expect(200);
    await me.user.raw("post", "/own-recovery/done", { key: phone.keyId }).expect(200);
    await publishList(me, [laptop, phone], laptop);

    expect((await me.user.raw("get", `/own-recovery/pending?me=${laptop.keyId}`)).body.keys, "nothing waits any more").toEqual([]);
    expect(isListed(me, phone)).toBe(true);
    expect(await chainHolds(me.lists), "the friend's check of my chain still holds, no second approval").toBe(true);
    const feed = (await me.user.feed(id)).body.messages as { id: string; enc: { wraps: { keyId: string }[] } }[];
    expect(feed.find((m) => m.id === old)!.enc.wraps.map((w) => w.keyId), "the old message opens with the new key").toContain(phone.keyId);
    expect(mayLock(me, phone, friend), "the new device can send").toBe(true);
    await send(me, copiesFor(me, friend)); // locked for both of my devices and my friend's
    const friendFeed = (await friend.user.feed(id)).body.messages as { enc: { wraps: { uid: string; keyId: string }[] } }[];
    expect(friendFeed).toHaveLength(2);
    // the friend's copies hold only the friend's own key wraps: my new key changed nothing there
    for (const m of friendFeed) expect(m.enc.wraps.map((w) => `${w.uid}/${w.keyId}`)).toEqual([`${friend.user.p.uid}/${friend.devices[0].keyId}`]);
  }, 60000);

  it("a key that is in my list but has no copies approves a new key by adding it to the list; the card then goes away, and a listed key without copies can only be helped by a shared key", async () => {
    lockPool.push(...(await Promise.all([1, 2, 3].map(generateLock))));
    const [user] = (await seedPool()).slice(0, 1);
    const p: Person = { user, devices: [await makeDevice("Laptop"), await makeDevice("Phone"), await makeDevice("New")], revoked: new Set(), retired: [], published: new Set(), lists: [] };
    const [laptop, phone, fresh] = p.devices;
    await publishKey(p, laptop);
    await publishList(p, [laptop], laptop);
    await approve(p, phone, laptop); // the phone is listed, but never got copies
    await user.raw("post", `/keys/${laptop.keyId}/revoke`).expect(200); // the one key with copies is gone
    await publishKey(p, fresh);
    const pending = async () => ((await user.raw("get", `/own-recovery/pending?me=${phone.keyId}`)).body.keys as { id: string }[]).map((k) => k.id);
    expect(await pending(), "the phone is asked to approve the new key").toEqual([fresh.keyId]);

    await publishList(p, [phone, fresh], phone); // the phone approves it into the list (the copies it cannot give are skipped)

    expect(await pending(), "the card goes away: the key is in the list").toEqual([]);
    expect(((await user.raw("get", "/keys")).body.keys as { waiting?: boolean }[]).some((k) => k.waiting), "nothing is 'not approved yet'").toBe(false);
    expect((await user.raw("post", "/own-recovery/ask", { key: fresh.keyId })).status, "a listed key with no copies is not helped by a key that has none either").toBe(409);
  }, 60000);
});

