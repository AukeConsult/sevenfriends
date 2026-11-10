/**
 * A small in-memory stand-in for the parts of Firestore (firebase-admin) that the backend uses,
 * so the connection tests run anywhere without Java or the emulator.
 *
 * It follows the real rules that matter for these tests:
 *  - transactions: all reads before any write, optimistic retry when something changed,
 *    all-or-nothing commit; `update` of a missing document fails; `create` of an existing one fails (code 6)
 *  - orderBy leaves out documents that lack the field
 *  - select(...fields) and getAll(..., { fieldMask }) return ONLY those fields, so code that reads a field it did not ask for fails here
 *  - serverTimestamp() values are strictly increasing, so "oldest first" is deterministic
 *
 * Set FIRESTORE_EMULATOR_HOST to run the same tests against the real emulator instead (see setup.ts).
 */
/* eslint-disable @typescript-eslint/no-explicit-any */
import type { Data, Filter, Scope, Write } from "./fake-firestore.types";
// ------------------------------------------------------------------ values

let lastMillis = 0;
const nextMillis = () => (lastMillis = Math.max(Date.now(), lastMillis + 1));

export class Timestamp {
  constructor(readonly seconds: number, readonly nanoseconds: number) {}
  static fromMillis(ms: number) {
    return new Timestamp(Math.floor(ms / 1000), (ms % 1000) * 1e6);
  }
  static now() {
    return Timestamp.fromMillis(nextMillis());
  }
  toMillis() {
    return this.seconds * 1000 + Math.floor(this.nanoseconds / 1e6);
  }
  toDate() {
    return new Date(this.toMillis());
  }
}

class ServerTimestamp {}
class DeleteField {}
class Increment {
  constructor(readonly n: number) {}
}
export const FieldValue = {
  serverTimestamp: () => new ServerTimestamp(),
  increment: (n: number) => new Increment(n),
  delete: () => new DeleteField(),
};

const withoutDeleted = (data: Data): Data => Object.fromEntries(Object.entries(data).filter(([, v]) => v !== undefined));

function clone<T>(v: T): T {
  if (v instanceof Timestamp) return v;
  if (Array.isArray(v)) return v.map(clone) as any;
  if (v && typeof v === "object") return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, clone(x)])) as any;
  return v;
}

function resolve(data: Data, existing: Data | undefined): Data {
  const out: Data = {};
  for (const [k, v] of Object.entries(data)) {
    if (v === undefined) throw new Error(`Cannot use "undefined" as a Firestore value (field "${k}")`);
    if (v instanceof DeleteField) out[k] = undefined; // removed by `withoutDeleted` after the merge
    else if (v instanceof ServerTimestamp) out[k] = Timestamp.now();
    else if (v instanceof Increment) out[k] = (existing?.[k] ?? 0) + v.n;
    else if (v && typeof v === "object" && Object.getPrototypeOf(v) === Object.prototype) out[k] = resolve(v as Data, undefined); // nested map: its server timestamps too
    else out[k] = clone(v);
  }
  return out;
}

const same = (a: any, b: any): boolean =>
  a instanceof Timestamp && b instanceof Timestamp ? a.toMillis() === b.toMillis() : a === b;

const order = (a: any, b: any): number => {
  const x = a instanceof Timestamp ? a.toMillis() : a;
  const y = b instanceof Timestamp ? b.toMillis() : b;
  return x < y ? -1 : x > y ? 1 : 0;
};

const fail = (code: number, message: string) => Object.assign(new Error(message), { code });

// ------------------------------------------------------------------ storage

const docs = new Map<string, Data>();
const versions = new Map<string, number>(); // doc path -> version (bumped on every write, also deletes)
const collVersions = new Map<string, number>(); // collection path -> version (any write inside)
let counter = 0;

export function resetFakeFirestore() {
  docs.clear();
  versions.clear();
  collVersions.clear();
}

const parentOf = (path: string) => path.split("/").slice(0, -1).join("/");
const bump = (path: string) => {
  versions.set(path, (versions.get(path) ?? 0) + 1);
  const c = parentOf(path);
  collVersions.set(c, (collVersions.get(c) ?? 0) + 1);
  const g = `group:${c.split("/").pop()}`; // a collection group query sees every collection with that name
  collVersions.set(g, (collVersions.get(g) ?? 0) + 1);
};

/** Validates every write against the current state first; applies nothing if any of them fails. */
function applyWrites(writes: Write[]) {
  const overlay = new Map<string, Data | null>();
  const current = (path: string) => (overlay.has(path) ? overlay.get(path)! : (docs.get(path) ?? null));

  for (const w of writes) {
    const path = w.ref.path;
    const existing = current(path);
    switch (w.op) {
      case "set":
        overlay.set(path, withoutDeleted(w.merge ? { ...(existing ?? {}), ...resolve(w.data, existing ?? undefined) } : resolve(w.data, undefined)));
        break;
      case "create":
        if (existing) throw fail(6, `ALREADY_EXISTS: ${path}`);
        overlay.set(path, resolve(w.data, undefined));
        break;
      case "update":
        if (!existing) throw fail(5, `NOT_FOUND: no document to update: ${path}`);
        {
          // "a.b": value changes only b inside the map a (one level, as the real Firestore does)
          const plain: Data = {};
          const nested: Data = {};
          for (const [k, v] of Object.entries(w.data)) {
            const dot = k.indexOf(".");
            if (dot < 0) plain[k] = v;
            else {
              const head = k.slice(0, dot);
              if (k.includes(".", dot + 1)) throw new Error(`fake-firestore: field "${k}" is nested deeper than one level`);
              nested[head] = { ...(nested[head] ?? existing[head] ?? {}), [k.slice(dot + 1)]: v };
            }
          }
          overlay.set(path, withoutDeleted({ ...existing, ...resolve(plain, existing), ...nested }));
        }
        break;
      case "delete":
        overlay.set(path, null);
        break;
    }
  }
  for (const [path, data] of overlay) {
    if (data === null) docs.delete(path);
    else docs.set(path, data);
    bump(path);
  }
}

// ------------------------------------------------------------------ snapshots

export class DocSnap {
  constructor(readonly ref: DocRef, private readonly stored: Data | undefined) {}
  get id() {
    return this.ref.id;
  }
  get exists() {
    return this.stored !== undefined;
  }
  data() {
    return this.stored === undefined ? undefined : clone(this.stored);
  }
  get(field: string) {
    return this.stored?.[field];
  }
}

/** A snapshot with only the asked fields (what `select` and a field mask do). */
const projected = (snap: DocSnap, fields: string[]) => {
  const data = snap.data();
  if (data === undefined) return new DocSnap(snap.ref, undefined);
  const out: Record<string, any> = {};
  for (const f of fields) {
    const path = f.split("."); // a nested field ("enc.meta") comes back nested, without its other fields
    let from: any = data;
    for (const key of path) from = from !== null && typeof from === "object" && key in from ? from[key] : undefined;
    if (from === undefined) continue;
    let to = out;
    path.slice(0, -1).forEach((key) => (to = to[key] ??= {}));
    to[path[path.length - 1]] = from;
  }
  return new DocSnap(snap.ref, out);
};

export class QuerySnap {
  constructor(readonly docs: DocSnap[]) {}
  get size() {
    return this.docs.length;
  }
  get empty() {
    return this.docs.length === 0;
  }
  forEach(fn: (d: DocSnap) => void) {
    this.docs.forEach(fn);
  }
}

const snapOf = (path: string) => new DocSnap(new DocRef(path), docs.get(path));

// ------------------------------------------------------------------ references

export class DocRef {
  constructor(readonly path: string) {}
  get id() {
    return this.path.split("/").pop()!;
  }
  get parent(): CollRef {
    return new CollRef(parentOf(this.path));
  }
  collection(name: string) {
    return new CollRef(`${this.path}/${name}`);
  }
  async get() {
    return snapOf(this.path);
  }
  async set(data: Data, opts?: { merge?: boolean }) {
    applyWrites([{ op: "set", ref: this, data, merge: opts?.merge }]);
  }
  async create(data: Data) {
    applyWrites([{ op: "create", ref: this, data }]);
  }
  async update(data: Data) {
    applyWrites([{ op: "update", ref: this, data }]);
  }
  async delete() {
    applyWrites([{ op: "delete", ref: this }]);
  }
}


export class Query {
  constructor(
    protected readonly scope: Scope,
    private readonly filters: Filter[] = [],
    private readonly sort?: { field: string; dir: "asc" | "desc" },
    private readonly max?: number,
    private readonly fields?: string[],
    private readonly after?: { value: any },
  ) {}

  where(field: string, op: string, value: any) {
    if (op !== "==" && op !== "in" && op !== ">=" && op !== "<=") throw new Error(`fake-firestore: operator "${op}" not supported`);
    return new Query(this.scope, [...this.filters, { field, op, value }], this.sort, this.max, this.fields, this.after);
  }
  orderBy(field: string, dir: "asc" | "desc" = "asc") {
    return new Query(this.scope, this.filters, { field, dir }, this.max, this.fields, this.after);
  }
  limit(n: number) {
    return new Query(this.scope, this.filters, this.sort, n, this.fields, this.after);
  }
  /** Only these fields come back (none = only the documents' names). */
  select(...fields: string[]) {
    return new Query(this.scope, this.filters, this.sort, this.max, fields, this.after);
  }
  /** Continue after this value of the ordered field (needs orderBy). */
  startAfter(value: any) {
    return new Query(this.scope, this.filters, this.sort, this.max, this.fields, { value });
  }
  /** The number of documents, without reading them. */
  count() {
    return {
      get: async () => {
        const size = (await this.get()).size;
        return { data: () => ({ count: size }) };
      },
    };
  }

  /** @internal: the key a transaction watches: the collection path, or `group:<name>` for a group query */
  collectionPath() {
    return "collection" in this.scope ? this.scope.collection : `group:${this.scope.group}`;
  }

  async get(): Promise<QuerySnap> {
    let hits = [...docs.keys()].filter((path) => {
      const parts = path.split("/");
      if ("collection" in this.scope) return parentOf(path) === this.scope.collection;
      return parts[parts.length - 2] === this.scope.group;
    });
    let found = hits.map(snapOf);
    for (const f of this.filters) {
      found = found.filter((d) => {
        const v = d.get(f.field);
        if (f.op === ">=") return v !== undefined && order(v, f.value) >= 0;
        if (f.op === "<=") return v !== undefined && order(v, f.value) <= 0;
        return f.op === "==" ? same(v, f.value) : (f.value as any[]).some((x) => same(v, x));
      });
    }
    if (this.sort) {
      const { field, dir } = this.sort;
      found = found.filter((d) => d.get(field) !== undefined); // like Firestore: documents without the field drop out
      found.sort((a, b) => order(a.get(field), b.get(field)) * (dir === "asc" ? 1 : -1));
      if (this.after) found = found.filter((d) => order(d.get(field), this.after!.value) * (dir === "asc" ? 1 : -1) > 0);
    }
    if (this.max !== undefined) found = found.slice(0, this.max);
    if (this.fields) found = found.map((d) => projected(d, this.fields!));
    return new QuerySnap(found);
  }
}

export class CollRef extends Query {
  constructor(readonly path: string) {
    super({ collection: path });
  }
  get id() {
    return this.path.split("/").pop()!;
  }
  get parent(): DocRef | null {
    const p = parentOf(this.path);
    return p ? new DocRef(p) : null;
  }
  doc(id?: string) {
    return new DocRef(`${this.path}/${id ?? `auto${(++counter).toString(36).padStart(8, "0")}`}`);
  }
}

// ------------------------------------------------------------------ transactions and batches

class Tx {
  private readonly readDocs = new Map<string, number>();
  private readonly readColls = new Map<string, number>();
  readonly writes: Write[] = [];

  async get(target: DocRef | Query): Promise<any> {
    if (this.writes.length) throw new Error("Firestore transactions require all reads to be executed before all writes");
    if (target instanceof DocRef) {
      this.readDocs.set(target.path, versions.get(target.path) ?? 0);
      return snapOf(target.path);
    }
    const coll = target.collectionPath();
    this.readColls.set(coll, collVersions.get(coll) ?? 0);
    return target.get();
  }
  /** One document with only some fields (`tx.getAll(ref, { fieldMask })`), as the real SDK does. */
  async getAll(ref: DocRef, options?: { fieldMask?: string[] }): Promise<any[]> {
    if (this.writes.length) throw new Error("Firestore transactions require all reads to be executed before all writes");
    this.readDocs.set(ref.path, versions.get(ref.path) ?? 0);
    return [options?.fieldMask ? projected(snapOf(ref.path), options.fieldMask) : snapOf(ref.path)];
  }
  set(ref: DocRef, data: Data, opts?: { merge?: boolean }) {
    this.writes.push({ op: "set", ref, data, merge: opts?.merge });
    return this;
  }
  create(ref: DocRef, data: Data) {
    this.writes.push({ op: "create", ref, data });
    return this;
  }
  update(ref: DocRef, data: Data) {
    this.writes.push({ op: "update", ref, data });
    return this;
  }
  delete(ref: DocRef) {
    this.writes.push({ op: "delete", ref });
    return this;
  }
  /** Did anything I read change since I read it? */
  stale() {
    for (const [p, v] of this.readDocs) if ((versions.get(p) ?? 0) !== v) return true;
    for (const [p, v] of this.readColls) if ((collVersions.get(p) ?? 0) !== v) return true;
    return false;
  }
}

class Batch {
  private readonly writes: Write[] = [];
  set(ref: DocRef, data: Data, opts?: { merge?: boolean }) {
    this.writes.push({ op: "set", ref, data, merge: opts?.merge });
    return this;
  }
  create(ref: DocRef, data: Data) {
    this.writes.push({ op: "create", ref, data });
    return this;
  }
  update(ref: DocRef, data: Data) {
    this.writes.push({ op: "update", ref, data });
    return this;
  }
  delete(ref: DocRef) {
    this.writes.push({ op: "delete", ref });
    return this;
  }
  async commit() {
    applyWrites(this.writes);
  }
}

class FakeFirestore {
  collection(path: string) {
    return new CollRef(path);
  }
  collectionGroup(id: string) {
    return new Query({ group: id });
  }
  batch() {
    return new Batch();
  }
  /** Several documents at once; the last argument may be `{ fieldMask }`. */
  async getAll(...args: any[]) {
    const options = args[args.length - 1] instanceof DocRef ? undefined : (args.pop() as { fieldMask?: string[] });
    return (args as DocRef[]).map((ref) => (options?.fieldMask ? projected(snapOf(ref.path), options.fieldMask) : snapOf(ref.path)));
  }
  async runTransaction<T>(fn: (tx: Tx) => Promise<T>): Promise<T> {
    for (let attempt = 0; attempt < 25; attempt++) {
      const tx = new Tx();
      const result = await fn(tx);
      if (tx.stale()) continue; // someone else wrote what we read: run again
      applyWrites(tx.writes);
      return result;
    }
    throw new Error("fake-firestore: transaction kept conflicting");
  }
}

const db = new FakeFirestore();
export const getFirestore = () => db;
