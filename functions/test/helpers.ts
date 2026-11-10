import { getFirestore } from "firebase-admin/firestore";
import request from "supertest";
import { createServer, type Server } from "node:http";
import { createApp } from "../src/app";
import { MAX_FRIENDS } from "../src/constants";
import { resetFakeFirestore } from "./fake-firestore";
import { resetFakeStorage } from "./fake-storage";
import { PROJECT, USING_EMULATOR } from "./setup";
import type { Claims, Entry, Friend, Incoming, Person, Req, Via } from "./types";

/** One server for every request of a test file: supertest(app) would open (and close) a new port for each call, and Windows runs out of ports. */
let shared: Server | undefined;
export const server = (): Server => {
  if (!shared) {
    shared = createServer(app).listen(0, "127.0.0.1");
    shared.unref();
    shared.setMaxListeners(0); // supertest adds a few listeners for every request it sends
  }
  return shared;
};

export const app = createApp();
export const POOL_SIZE = 60; // everything below runs in a pool of at least 50 people
export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// ------------------------------------------------------------------ people

export function person(n: number): Person {
  const id = String(n).padStart(2, "0");
  return {
    n,
    uid: `uid${id}`,
    name: `Person ${id}`,
    email: `person${id}@test.dev`,
    phone: `+47900000${id}`,
  };
}

export const makePool = (size = POOL_SIZE) => Array.from({ length: size }, (_, i) => person(i));

export function contactOf(target: Person, via: Via): Record<string, string> {
  const base = { name: `Friend ${target.n}` };
  switch (via) {
    case "email": return { ...base, email: target.email };
    case "emailUpper": return { ...base, email: target.email.toUpperCase() };
    case "phone": return { ...base, phone: target.phone };
    case "phoneSpaced": return { ...base, phone: target.phone.replace(/^\+47(\d{3})(\d{3})(\d{2})$/, "+47 $1 $2 $3") };
    case "phoneNoPrefix": return { ...base, phone: target.phone.replace("+47", "") };
  }
}

// ------------------------------------------------------------------ api client


export class User {
  /** `claims`: what the login proves. By default the email is verified and the phone number was confirmed by SMS. */
  constructor(readonly p: Person, readonly claims: Claims = {}) {}

  private token() {
    return JSON.stringify({
      uid: this.p.uid,
      email: this.p.email,
      name: this.p.name,
      email_verified: this.claims.emailVerified ?? true,
      ...((this.claims.phoneVerified ?? true) ? { phone_number: this.p.phone } : {}),
    });
  }

  private call(method: "get" | "post" | "put" | "delete", path: string, body?: object) {
    const req = request(server())[method](`/api${path}`).set("Authorization", `Bearer ${this.token()}`);
    return body ? req.send(body) : req;
  }

  /** A request whose body is a file (any content type but JSON; the server finds the type from the bytes). */
  file(method: "post" | "put", path: string, bytes: Buffer, type = "application/x-test") {
    return request(server())[method](`/api${path}`).set("Authorization", `Bearer ${this.token()}`).set("Content-Type", type).send(bytes);
  }

  /** `getObject(userid/objectid)`: the bytes come back as a Buffer. */
  getObject(ownerId: string, name: string, headers: Record<string, string> = {}) {
    return request(server()).get(`/api/sf-cache/${ownerId}/${name}`).set("Authorization", `Bearer ${this.token()}`).set(headers).buffer(true).parse((res, done) => {
      const parts: Buffer[] = [];
      res.on("data", (c: Buffer) => parts.push(c));
      res.on("end", () => done(null, Buffer.concat(parts)));
    });
  }

  /** Sign up like the real app: login sync, then the phone number on the profile. */
  async signUp() {
    await this.call("post", "/users/sync").expect(200);
    await this.call("put", "/profile", {
      phone: this.p.phone,
    }).expect(200);
    return this;
  }

  raw = (method: "get" | "post" | "put" | "delete", path: string, body?: object) => this.call(method, path, body);

  async friends(): Promise<Friend[]> {
    return (await this.call("get", "/circles/default/friends").expect(200)).body.friends;
  }

  /** Add someone; returns the raw response (so tests can also check refusals). */
  addRaw(target: Person, via: Via = "email") {
    return this.call("post", "/circles/default/friends", contactOf(target, via));
  }

  async add(target: Person, via: Via = "email"): Promise<Friend> {
    return (await this.addRaw(target, via).expect(201)).body;
  }

  async check(): Promise<{ requests: Incoming[]; messages: { id: string; text: string; fromName: string }[] }> {
    return (await this.call("post", "/notifications/check").expect(200)).body;
  }

  async seated() { return (await this.check()).requests.filter((r) => r.seated); }
  async waitingList() { return (await this.check()).requests.filter((r) => !r.seated); }

  /** The message feed of a connection (friend id = connection id). */
  feed = (friendId: string) => this.call("get", `/circles/default/friends/${friendId}/messages`);
  send = (friendId: string, text: string) => this.call("post", `/circles/default/friends/${friendId}/messages`, { text });
  markFeedRead = (friendId: string) => this.call("post", `/circles/default/friends/${friendId}/messages/read`);

  confirm = (id: string) => this.call("post", `/friend-requests/${id}/accept`);
  reject = (id: string) => this.call("post", `/friend-requests/${id}/reject`);
  remove = (id: string) => this.call("delete", `/circles/default/friends/${id}`);

  /** Friend entry of mine that points at `other` (by the email used in contactOf). */
  async entryFor(other: Person): Promise<Friend | undefined> {
    return (await this.friends()).find((f) => f.email === other.email.toLowerCase());
  }
}

export const users = (pool: Person[]) => pool.map((p) => new User(p));

// ------------------------------------------------------------------ database

export async function clearDatabase() {
  resetFakeStorage();
  if (!USING_EMULATOR) {
    resetFakeFirestore();
    return;
  }
  const host = process.env.FIRESTORE_EMULATOR_HOST;
  const res = await fetch(`http://${host}/emulator/v1/projects/${PROJECT}/databases/(default)/documents`, {
    method: "DELETE",
  });
  if (!res.ok) throw new Error(`Could not clear the emulator: ${res.status}`);
}

/**
 * Run `fn` for every person "at the same moment". In-memory Firestore: truly concurrent.
 * Real emulator: one person at a time, because it locks documents while a transaction runs and a
 * ring of people who all write into each other's lists would wait on each other until
 * "Transaction lock timeout".
 */
export async function forEachUser<T>(list: User[], fn: (user: User, i: number) => Promise<T>): Promise<T[]> {
  if (!USING_EMULATOR) return Promise.all(list.map(fn));
  const results: T[] = [];
  for (let i = 0; i < list.length; i++) results.push(await fn(list[i], i));
  return results;
}

/** Fresh database with everyone signed up (batches of 15 at a time). */
export async function seedPool(size = POOL_SIZE): Promise<User[]> {
  await clearDatabase();
  const all = users(makePool(size));
  for (let i = 0; i < all.length; i += 15) {
    await Promise.all(all.slice(i, i + 15).map((u) => u.signUp()));
  }
  return all;
}

/** `a` adds `b`, `b` checks and confirms: a confirmed connection. Returns the shared connection id. */
export async function connect(a: User, b: User, via: Via = "email"): Promise<string> {
  const entry = await a.add(b.p, via);
  await b.check();
  const res = await b.confirm(entry.id);
  if (res.status !== 200) throw new Error(`connect failed: ${res.status} ${JSON.stringify(res.body)}`);
  return entry.id;
}

/** The pings (incoming signals) waiting under a person's account. */
export async function signalsOf(uid: string): Promise<{ id: string; connectionId?: string; time?: unknown }[]> {
  const snap = await getFirestore().collection("user-account").doc(uid).collection("incoming-signal").get();
  return snap.docs.map((d) => ({ ...d.data(), id: d.id }));
}

/** Fill `owner`'s circle with `count` confirmed-or-pending outgoing entries (people not matching anyone in the pool). */
export async function fillCircle(owner: User, count = MAX_FRIENDS) {
  const ids: string[] = [];
  for (let i = 0; i < count; i++) {
    const res = await owner.raw("post", "/circles/default/friends", { name: `Filler ${i}`, email: `filler${i}-${owner.p.uid}@nowhere.test` });
    if (res.status !== 201) throw new Error(`fillCircle failed: ${res.status}`);
    ids.push(res.body.id);
  }
  return ids;
}

// ------------------------------------------------------------------ invariants


/**
 * Reads everything straight from Firestore and checks the connection rules:
 * seats, one id per connection, symmetry, statuses, requests, no duplicates.
 * Returns a summary so tests can also assert counts.
 */
export async function assertConsistent() {
  const db = getFirestore();
  // a group entry has no other person to be symmetric with (groups.test.ts checks them)
  const entries: Entry[] = (await db.collectionGroup("friends").get()).docs.filter((d) => d.data().kind !== "group").map((d) => {
    const [, uid, , circle] = d.ref.path.split("/");
    return { uid, circle, id: d.id, data: d.data() };
  });
  const requests: Req[] = (await db.collectionGroup("friend-request").get()).docs.map((d) => ({
    uid: d.ref.path.split("/")[1],
    id: d.id,
    data: d.data(),
  }));
  const problems: string[] = [];
  const fail = (msg: string) => problems.push(msg);

  const entry = (uid: string, id: string) => entries.find((e) => e.uid === uid && e.id === id);

  // 1. seats
  const perCircle = new Map<string, number>();
  for (const e of entries) perCircle.set(`${e.uid}/${e.circle}`, (perCircle.get(`${e.uid}/${e.circle}`) ?? 0) + 1);
  for (const [k, n] of perCircle) if (n > MAX_FRIENDS) fail(`${k} has ${n} entries (max ${MAX_FRIENDS})`);

  // 2. one connection = one id: at most two entries per id, on different people, linked to each other
  const byId = new Map<string, Entry[]>();
  for (const e of entries) byId.set(e.id, [...(byId.get(e.id) ?? []), e]);
  for (const [id, group] of byId) {
    if (group.length > 2) fail(`id ${id} is used by ${group.length} entries`);
    if (group.length === 2) {
      const [a, b] = group;
      if (a.uid === b.uid) fail(`id ${id} used twice by ${a.uid}`);
      if (a.data.linkedUid !== b.uid || b.data.linkedUid !== a.uid) fail(`id ${id}: the two sides are not linked to each other`);
      if (a.data.status !== b.data.status) fail(`id ${id}: sides disagree (${a.data.status} vs ${b.data.status})`);
    }
    for (const e of group) {
      if (e.data.connectionId !== id) fail(`entry ${e.uid}/${id} has connectionId ${e.data.connectionId}`);
      if (e.data.ownerUid !== e.uid) fail(`entry ${e.uid}/${id} has ownerUid ${e.data.ownerUid} (the app listens to all its entries with it)`);
      // 3. confirmed means both sides have it
      if (e.data.status === "confirmed" && group.length !== 2) fail(`confirmed entry ${e.uid}/${id} has no other side`);
      // rejected: only the requester keeps it
      if (e.data.status === "rejected" && group.length !== 1) fail(`rejected entry ${e.uid}/${id} still has another side`);
    }
  }

  // 4. requests
  for (const r of requests) {
    const requester = entry(r.data.fromUid, r.id);
    const seat = entry(r.uid, r.id);
    if (!requester) { fail(`request ${r.uid}/${r.id} has no requester entry (orphan)`); continue; }
    if (requester.data.linkedUid !== r.uid) fail(`request ${r.uid}/${r.id}: requester entry not linked to the recipient`);
    switch (r.data.status) {
      case "pending":
        if (requester.data.status !== "pending") fail(`pending request ${r.id} but requester entry is ${requester.data.status}`);
        if (r.data.seatFriendId && !seat) fail(`pending request ${r.id} says seated but the recipient has no entry`);
        if (!r.data.seatFriendId && seat) fail(`pending request ${r.id} is waiting but the recipient has an entry`);
        break;
      case "accepted":
        if (requester.data.status !== "confirmed" || seat?.data.status !== "confirmed") fail(`accepted request ${r.id} but entries are not both confirmed`);
        break;
      case "rejected":
        if (requester.data.status !== "rejected") fail(`rejected request ${r.id} but requester entry is ${requester.data.status}`);
        if (seat) fail(`rejected request ${r.id} but the recipient still has a seat for it`);
        break;
      default:
        fail(`request ${r.id} has unexpected status ${r.data.status}`);
    }
  }

  // waiting flag only while the request really waits
  for (const e of entries) {
    if (e.data.waitingForSeat) {
      const r = requests.find((x) => x.id === e.id);
      if (!r || r.data.status !== "pending" || r.data.seatFriendId) fail(`entry ${e.uid}/${e.id} is flagged waiting but is not on a waiting list`);
    }
  }

  // 5. seats created for incoming requests must have their request
  for (const e of entries) {
    if (e.data.incomingRequestId) {
      if (e.data.incomingRequestId !== e.id) fail(`seat ${e.uid}/${e.id} has another request id`);
      if (!requests.find((r) => r.uid === e.uid && r.id === e.id)) fail(`seat ${e.uid}/${e.id} has no request`);
    }
  }

  // 6. never two connections between the same two people inside one circle
  const pairs = new Set<string>();
  for (const e of entries) {
    if (!e.data.linkedUid) continue;
    const key = `${e.uid}>${e.data.linkedUid}`;
    if (pairs.has(key)) fail(`duplicate connection ${key}`);
    pairs.add(key);
  }

  // 7. messages of a connection: two copies with the same id (sender read, receiver as set), and
  //    both people still have the confirmed connection (deleting a connection deletes its feed)
  const messages = (await db.collectionGroup("messages").get()).docs
    .map((d) => ({ uid: d.ref.path.split("/")[1], id: d.id, data: d.data() }))
    .filter((m) => m.data.connectionId);
  const byMessage = new Map<string, typeof messages>();
  for (const m of messages) byMessage.set(m.id, [...(byMessage.get(m.id) ?? []), m]);
  for (const [id, copies] of byMessage) {
    if (copies.length !== 2) { fail(`message ${id} has ${copies.length} copies (must be 2)`); continue; }
    const from = copies.find((c) => c.uid === c.data.fromUid);
    const to = copies.find((c) => c.uid === c.data.toUid);
    if (!from || !to || from === to) { fail(`message ${id}: copies are not one for the sender and one for the receiver`); continue; }
    if (from.data.read !== true) fail(`message ${id}: the sender's copy should be read`);
    if (from.data.text !== to.data.text) fail(`message ${id}: the two copies differ`);
    const connectionId = from.data.connectionId as string;
    for (const who of [from.uid, to.uid]) {
      if (entry(who, connectionId)?.data.status !== "confirmed") fail(`message ${id}: ${who} has no confirmed connection ${connectionId}`);
    }
  }

  // 8. incoming signals (pings): the id is the connection id, they hold nothing but a ping,
  //    and the entry that sent them still exists and remembers whom it pinged
  const signals = (await db.collectionGroup("incoming-signal").get()).docs.map((d) => ({
    uid: d.ref.path.split("/")[1],
    id: d.id,
    data: d.data(),
  }));
  for (const signal of signals) {
    const where = `signal ${signal.uid}/${signal.id}`;
    if (signal.data.connectionId !== signal.id) fail(`${where}: connectionId does not match its id`);
    if (Object.keys(signal.data).sort().join() !== "circleId,connectionId,time") fail(`${where}: holds more than a ping (the connection, the circle it is for, and when)`);
    const sender = entries.find((e) => e.id === signal.id && e.uid !== signal.uid);
    if (!sender) fail(`${where}: the entry that sent it no longer exists`);
    else if (!(sender.data.signaledUids ?? []).includes(signal.uid)) fail(`${where}: not recorded on its entry`);
  }

  // 9. people are reachable by their email / phone whether or not it is verified, but a confirmed phone must be
  //    the account's key
  const accounts = (await db.collection("user-account").get()).docs.map((d) => ({ id: d.id, data: d.data() }));
  for (const account of accounts) {
    const { phoneKey, verifiedPhone } = account.data;
    if (verifiedPhone && !String(verifiedPhone).replace(/\D/g, "").endsWith(String(phoneKey))) fail(`account ${account.id}: phoneKey does not belong to the verified number`);
  }

  if (problems.length) throw new Error(`Connection rules broken:\n- ${problems.slice(0, 15).join("\n- ")}${problems.length > 15 ? `\n... and ${problems.length - 15} more` : ""}`);

  return {
    entries: entries.length,
    requests: requests.length,
    confirmed: entries.filter((e) => e.data.status === "confirmed").length,
    messages: messages.length,
    signals: signals.length,
    perCircle,
  };
}
