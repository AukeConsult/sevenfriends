import { Readable } from "stream";

/** An in-memory stand-in for the Google Storage bucket (the parts sf-cache.ts uses). */
type Stored = { data: Buffer; metadata: Record<string, any> };
const objects = new Map<string, Stored>();

export const resetFakeStorage = () => objects.clear();
/** the names of everything stored, for the tests */
export const storedNames = () => [...objects.keys()].sort();
export const storedData = (name: string) => objects.get(name)?.data;

const notFound = () => Object.assign(new Error("Not Found"), { code: 404 });

function file(name: string) {
  return {
    name,
    get metadata() {
      return objects.get(name)?.metadata ?? {};
    },
    async save(data: Buffer, options: { contentType: string; metadata?: Record<string, any> }) {
      objects.set(name, { data: Buffer.from(data), metadata: { ...options.metadata, contentType: options.contentType, size: String(data.length), name } });
    },
    async getMetadata() {
      const o = objects.get(name);
      if (!o) throw notFound();
      return [o.metadata];
    },
    async download(range?: { start: number; end: number }) {
      const o = objects.get(name);
      if (!o) throw notFound();
      return [range ? o.data.subarray(range.start, range.end + 1) : o.data];
    },
    async setMetadata(change: Record<string, any>) {
      const o = objects.get(name);
      if (!o) throw notFound();
      o.metadata = { ...o.metadata, ...change };
    },
    createReadStream(range?: { start: number; end: number }) {
      const o = objects.get(name);
      if (!o) throw notFound();
      return Readable.from([range ? o.data.subarray(range.start, range.end + 1) : o.data]);
    },
    async delete(options?: { ignoreNotFound?: boolean }) {
      if (!objects.delete(name) && !options?.ignoreNotFound) throw notFound();
    },
  };
}

export const fakeBucket = {
  file,
  async getFiles({ prefix }: { prefix: string }) {
    return [[...objects.keys()].filter((n) => n.startsWith(prefix)).map(file)];
  },
  /** join files (in the order given) into one */
  async combine(sources: { name: string }[], destination: { name: string }) {
    const parts = sources.map((f) => objects.get(f.name)?.data);
    if (parts.some((p) => !p)) throw notFound();
    const data = Buffer.concat(parts as Buffer[]);
    objects.set(destination.name, { data, metadata: { size: String(data.length), name: destination.name } });
  },
  async deleteFiles({ prefix }: { prefix: string }) {
    for (const n of [...objects.keys()]) if (n.startsWith(prefix)) objects.delete(n);
  },
};

/** pretend `owner` already keeps `bytes` of video (without really holding that many bytes), for the quota test */
export function stuffStorage(owner: string, bytes: number) {
  objects.set(`sf-cache/${owner}/stuffing`, { data: Buffer.alloc(0), metadata: { metadata: { kind: "video" }, size: String(bytes), contentType: "video/mp4" } });
}
