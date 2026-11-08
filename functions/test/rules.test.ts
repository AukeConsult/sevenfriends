import { RulesTestEnvironment, assertFails, assertSucceeds, initializeTestEnvironment } from "@firebase/rules-unit-testing";
import fs from "node:fs";
import path from "node:path";
import { afterAll, beforeAll, beforeEach, describe, it } from "vitest";
import { USING_EMULATOR } from "./setup";

/**
 * The Firestore security rules (firestore.rules): USER CONTROL.
 * All data goes through the backend (the Admin SDK ignores the rules). The only thing the app reads
 * directly is the live data under the signed-in user's OWN account: the pings (incoming-signal), the
 * messages and the friend list. Everything else is closed, and nobody writes from the client.
 *
 * These tests need the real Firestore emulator (the rules engine): `npm run test:emulator`.
 * With the default `npm test` they are skipped.
 */
const rules = fs.readFileSync(path.resolve(__dirname, "../../firestore.rules"), "utf8");

describe.skipIf(!USING_EMULATOR)("firestore security rules: every user controls only their own data", () => {
  let env: RulesTestEnvironment;

  beforeAll(async () => {
    const [host, port] = process.env.FIRESTORE_EMULATOR_HOST!.split(":");
    env = await initializeTestEnvironment({ projectId: "demo-sevenfriends-rules", firestore: { rules, host, port: Number(port) } });
  });
  afterAll(async () => { await env.cleanup(); });

  beforeEach(async () => {
    await env.clearFirestore();
    await env.withSecurityRulesDisabled(async (context) => {
      const db = context.firestore();
      for (const uid of ["uid01", "uid02"]) {
        const base = `user-account/${uid}`;
        await db.doc(base).set({ uid, email: `${uid}@test.dev` });
        await db.doc(`${base}/friend-circle/default`).set({ name: "My friends", type: "friends" });
        await db.doc(`${base}/friend-circle/default/friends/f1`).set({ name: "A friend", status: "pending" });
        await db.doc(`${base}/friend-request/r1`).set({ fromUid: "x", status: "pending" });
        await db.doc(`${base}/incoming-signal/s1`).set({ connectionId: "c1" });
        await db.doc(`${base}/messages/m1`).set({ connectionId: "c1", text: "hello", read: false });
        await db.doc(`${base}/messages/m2`).set({ connectionId: "c1", text: "sent", read: true });
      }
    });
  });

  const me = () => env.authenticatedContext("uid01").firestore();
  const stranger = () => env.authenticatedContext("uid02").firestore();
  const anonymous = () => env.unauthenticatedContext().firestore();

  describe("the live data under my own account may be listened to by me (queries only)", () => {
    it("my pings", async () => {
      await assertSucceeds(me().collection("user-account/uid01/incoming-signal").get());
    });

    it("my unread messages: the one query the app listens to", async () => {
      await assertSucceeds(me().collection("user-account/uid01/messages").where("read", "==", false).get());
    });

    it("the times of my profile and sounds changes", async () => {
      await assertSucceeds(me().collection("user-account/uid01/sync").get());
    });

    it("my friend list", async () => {
      await assertSucceeds(me().collection("user-account/uid01/friend-circle/default/friends").get());
    });

    it("the friend list of each of my other circles (the app in that circle listens to it)", async () => {
      for (const circle of ["buddies", "work", "family"]) {
        await assertSucceeds(me().collection(`user-account/uid01/friend-circle/${circle}/friends`).get());
      }
    });
  });

  describe("even my own data is closed beyond what the app needs", () => {
    it.each([
      ["a single ping by its path", () => me().doc("user-account/uid01/incoming-signal/s1").get()],
      ["a single message by its path", () => me().doc("user-account/uid01/messages/m1").get()],
      ["a single friend by its path", () => me().doc("user-account/uid01/friend-circle/default/friends/f1").get()],
      ["all my messages (not only the unread ones)", () => me().collection("user-account/uid01/messages").get()],
      ["my read messages", () => me().collection("user-account/uid01/messages").where("read", "==", true).get()],
      ["the friends of another circle", () => me().collection("user-account/uid01/friend-circle/other/friends").get()],
    ])("cannot read %s", async (_label, read) => {
      await assertFails(read());
    });
  });

  describe("nobody else can read them", () => {
    it.each([
      ["a signed-in stranger: pings", () => stranger().collection("user-account/uid01/incoming-signal").get()],
      ["a signed-in stranger: ping", () => stranger().doc("user-account/uid01/incoming-signal/s1").get()],
      ["a signed-in stranger: messages", () => stranger().collection("user-account/uid01/messages").get()],
      ["a signed-in stranger: unread messages query", () => stranger().collection("user-account/uid01/messages").where("read", "==", false).get()],
      ["a signed-in stranger: the sync times", () => stranger().collection("user-account/uid01/sync").get()],
      ["a signed-in stranger: one message", () => stranger().doc("user-account/uid01/messages/m1").get()],
      ["a signed-in stranger: my buddies list", () => stranger().collection("user-account/uid01/friend-circle/buddies/friends").get()],
      ["a signed-in stranger: my friend list", () => stranger().collection("user-account/uid01/friend-circle/default/friends").get()],
      ["a signed-in stranger: one friend", () => stranger().doc("user-account/uid01/friend-circle/default/friends/f1").get()],
      ["somebody not signed in: my friend list", () => anonymous().collection("user-account/uid01/friend-circle/default/friends").get()],
      ["somebody not signed in: pings", () => anonymous().collection("user-account/uid01/incoming-signal").get()],
      ["somebody not signed in: messages", () => anonymous().collection("user-account/uid01/messages").get()],
    ])("%s", async (_label, read) => {
      await assertFails(read());
    });

    it("a collection group query cannot be used to read everybody's pings or messages", async () => {
      await assertFails(me().collectionGroup("incoming-signal").get());
      await assertFails(me().collectionGroup("messages").get());
    });
  });

  describe("nobody writes from the client (only the backend does), not even on their own account", () => {
    it.each([
      ["create a ping", () => me().doc("user-account/uid01/incoming-signal/new").set({ connectionId: "c9" })],
      ["change a ping", () => me().doc("user-account/uid01/incoming-signal/s1").update({ connectionId: "c9" })],
      ["delete a ping", () => me().doc("user-account/uid01/incoming-signal/s1").delete()],
      ["create a message", () => me().doc("user-account/uid01/messages/new").set({ text: "forged", read: false })],
      ["change a message", () => me().doc("user-account/uid01/messages/m1").update({ read: true })],
      ["delete a message", () => me().doc("user-account/uid01/messages/m1").delete()],
      ["write a ping to somebody else", () => me().doc("user-account/uid02/incoming-signal/new").set({ connectionId: "c9" })],
      ["create a friend", () => me().doc("user-account/uid01/friend-circle/default/friends/new").set({ name: "forged" })],
      ["change a friend (an answer cannot be forged)", () => me().doc("user-account/uid01/friend-circle/default/friends/f1").update({ status: "confirmed" })],
      ["delete a friend", () => me().doc("user-account/uid01/friend-circle/default/friends/f1").delete()],
      ["write a message to somebody else", () => me().doc("user-account/uid02/messages/new").set({ text: "spam", read: false })],
    ])("cannot %s", async (_label, write) => {
      await assertFails(write());
    });
  });

  describe("everything else is closed to the client, even my own data", () => {
    it.each([
      ["my profile", "user-account/uid01"],
      ["my circle", "user-account/uid01/friend-circle/default"],
      ["my friend requests", "user-account/uid01/friend-request/r1"],
      ["somebody else's profile", "user-account/uid02"],
      ["somebody else's friends", "user-account/uid02/friend-circle/default/friends/f1"],
      ["a path that does not exist in the app", "anything/else"],
    ])("cannot read or write %s", async (_label, docPath) => {
      await assertFails(me().doc(docPath).get());
      await assertFails(me().doc(docPath).set({ hacked: true }));
      await assertFails(me().doc(docPath).delete());
    });

    it("cannot list the user accounts or read friend lists with a collection group query", async () => {
      await assertFails(me().collection("user-account").get());
      await assertFails(me().collectionGroup("friends").get()); // my own list is read by its path, never by a group query
      await assertFails(me().collectionGroup("friend-request").get());
    });
  });
});
