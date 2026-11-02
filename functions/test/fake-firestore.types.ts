import type { DocRef } from "./fake-firestore";

// Types of the in-memory Firestore (fake-firestore.ts).
/* eslint-disable @typescript-eslint/no-explicit-any */

/** The fields of one document. */
export type Data = Record<string, any>;

/** One change to a document (collected by a transaction or batch, applied together). */
export type Write =
  | { op: "set"; ref: DocRef; data: Data; merge?: boolean }
  | { op: "create"; ref: DocRef; data: Data }
  | { op: "update"; ref: DocRef; data: Data }
  | { op: "delete"; ref: DocRef };

/** A `where` condition of a query. */
export type Filter = { field: string; op: "==" | "in"; value: any };

/** Where a query looks: one collection, or every collection with this name (collection group). */
export type Scope = { collection: string } | { group: string };
