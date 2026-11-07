import { getFirestore } from "firebase-admin/firestore";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { MailSettings, MailTransport, deliverMail } from "../src/mail";
import { User, clearDatabase, person, seedPool } from "./helpers";

/** The mail trigger: what is written to `mail` is sent once through the configured mail server, and the result is kept. */
const KEYS = ["SMTP_HOST", "SMTP_PORT", "SMTP_SECURE", "SMTP_USER", "SMTP_PASS", "MAIL_FROM"];
const saved: Record<string, string | undefined> = {};

type Sent = { settings: MailSettings; from: string; to: string[]; subject: string; text?: string; html?: string };
let sent: Sent[];
let failWith: string | null;

const transportFor = (settings: MailSettings): MailTransport => ({
  async sendMail(options) {
    if (failWith) throw new Error(failWith);
    sent.push({ settings, ...options });
    return { messageId: "<id-1@test>", accepted: options.to, rejected: [], response: "250 OK" };
  },
});

const write = (id: string, data: Record<string, unknown>) => getFirestore().collection("mail").doc(id).set(data);
const read = async (id: string) => (await getFirestore().collection("mail").doc(id).get()).data()!;
const good = { to: ["friend@example.test"], message: { subject: "Hello", text: "Hi there" } };

beforeEach(async () => {
  await clearDatabase();
  KEYS.forEach((k) => { saved[k] = process.env[k]; delete process.env[k]; });
  process.env.SMTP_HOST = "smtp.example.test";
  process.env.MAIL_FROM = "Seven Friends <noreply@example.test>";
  sent = [];
  failWith = null;
});
afterEach(() => KEYS.forEach((k) => { if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k]; }));

describe("sending a mail document", () => {
  it("sends it through the configured server and records the result", async () => {
    await write("m1", good);
    expect(await deliverMail("m1", transportFor)).toBe("sent");

    expect(sent).toHaveLength(1);
    expect(sent[0]).toMatchObject({ from: "Seven Friends <noreply@example.test>", to: ["friend@example.test"], subject: "Hello", text: "Hi there" });
    const { delivery } = await read("m1");
    expect(delivery).toMatchObject({ state: "SUCCESS", attempts: 1, info: { messageId: "<id-1@test>", accepted: ["friend@example.test"], rejected: [], response: "250 OK" } });
    expect(delivery.endTime).toBeTruthy();
  });

  it("uses the SMTP settings: host, port (default 587, STARTTLS), 465 means encrypted, login only when given", async () => {
    await write("m1", good);
    await deliverMail("m1", transportFor);
    expect(sent[0].settings).toEqual({ host: "smtp.example.test", port: 587, secure: false, user: "", pass: "", from: "Seven Friends <noreply@example.test>" });

    process.env.SMTP_PORT = "465";
    process.env.SMTP_USER = "me";
    process.env.SMTP_PASS = "pa\\ns s";
    await write("m2", good);
    await deliverMail("m2", transportFor);
    expect(sent[1].settings).toMatchObject({ port: 465, secure: true, user: "me", pass: "pa\\ns s" }); // the password is used exactly as written

    process.env.SMTP_SECURE = "false";
    await write("m3", good);
    await deliverMail("m3", transportFor);
    expect(sent[2].settings.secure).toBe(false);
  });

  it("the password is never written to the document", async () => {
    process.env.SMTP_PASS = "very-secret-password";
    await write("m1", good);
    await deliverMail("m1", transportFor);
    expect(JSON.stringify(await read("m1"))).not.toContain("very-secret-password");
  });

  it("sends html too, and a single address written as a string", async () => {
    await write("m1", { to: "one@example.test", message: { subject: "S", html: "<b>Hi</b>" } });
    expect(await deliverMail("m1", transportFor)).toBe("sent");
    expect(sent[0]).toMatchObject({ to: ["one@example.test"], html: "<b>Hi</b>" });
  });
});

describe("only once", () => {
  it("a mail that was handled is never sent again (the function can run twice for one document)", async () => {
    await write("m1", good);
    expect(await deliverMail("m1", transportFor)).toBe("sent");
    expect(await deliverMail("m1", transportFor)).toBe("skipped");
    expect(sent).toHaveLength(1);
  });

  it("two runs at the same moment send it once", async () => {
    await write("m1", good);
    const results = await Promise.all([deliverMail("m1", transportFor), deliverMail("m1", transportFor), deliverMail("m1", transportFor)]);
    expect(results.filter((r) => r === "sent")).toHaveLength(1);
    expect(sent).toHaveLength(1);
  });

  it("a document that is gone is skipped", async () => {
    expect(await deliverMail("nope", transportFor)).toBe("skipped");
  });
});

describe("when something is wrong", () => {
  it("the mail server fails: ERROR with the reason, and RETRY sends it again", async () => {
    await write("m1", good);
    failWith = "connect ECONNREFUSED 127.0.0.1:587";
    expect(await deliverMail("m1", transportFor)).toBe("failed");
    expect((await read("m1")).delivery).toMatchObject({ state: "ERROR", attempts: 1, error: "connect ECONNREFUSED 127.0.0.1:587" });
    expect(await deliverMail("m1", transportFor)).toBe("skipped"); // an error is not retried by itself

    failWith = null;
    await getFirestore().collection("mail").doc("m1").update({ "delivery": { state: "RETRY", attempts: 1 } });
    expect(await deliverMail("m1", transportFor)).toBe("sent");
    expect((await read("m1")).delivery).toMatchObject({ state: "SUCCESS", attempts: 2 });
    expect(sent).toHaveLength(1);
  });

  it("email is not set up: ERROR that says what is missing, nothing is sent", async () => {
    delete process.env.SMTP_HOST;
    await write("m1", good);
    expect(await deliverMail("m1", transportFor)).toBe("failed");
    expect((await read("m1")).delivery.error).toMatch(/SMTP_HOST and MAIL_FROM/);
    expect(sent).toEqual([]);
  });

  it.each([
    ["no recipient", { message: { subject: "S", text: "T" } }, /recipient/],
    ["an invalid address", { to: ["not-an-address"], message: { subject: "S", text: "T" } }, /recipient/],
    ["too many recipients", { to: Array.from({ length: 11 }, (_, i) => `a${i}@example.test`), message: { subject: "S", text: "T" } }, /more than/],
    ["no subject", { to: ["a@example.test"], message: { text: "T" } }, /subject/],
    ["no text", { to: ["a@example.test"], message: { subject: "S" } }, /text/],
  ])("a bad document (%s): ERROR, nothing is sent", async (_label, data, problem) => {
    await write("m1", data);
    expect(await deliverMail("m1", transportFor)).toBe("failed");
    expect((await read("m1")).delivery.error).toMatch(problem);
    expect(sent).toEqual([]);
  });
});

describe("with the invitation emails of the app", () => {
  let pool: User[];
  beforeEach(async () => { pool = await seedPool(); });

  it("an invitation written by the app is sent with the right words and link", async () => {
    const stranger = person(70);
    const entry = await pool[0].add(stranger);
    await pool[0].raw("post", `/circles/default/friends/${entry.id}/invite`).expect(200);
    const [doc] = (await getFirestore().collection("mail").get()).docs;

    expect(await deliverMail(doc.id, transportFor)).toBe("sent");
    expect(sent[0].to).toEqual([stranger.email]);
    expect(sent[0].subject).toBe("Person 00 invited you to Seven Friends");
    expect(sent[0].text).toContain("https://sevenfriends.io/");
  });
});

describe("how the invitation email looks (assets/mail/invite.html)", () => {
  const sample = { fromUid: "x", fromName: "Leif Auke", to: "friend@example.com", message: "Hi! Be my friend." };

  it("fills in the places and keeps the message block", async () => {
    const { inviteHtml } = await import("../src/outbox");
    const html = inviteHtml(sample)!;
    expect(html).toContain("Leif Auke wants you as a close friend");
    expect(html).toContain("friend@example.com");
    expect(html).toContain("&quot;Hi! Be my friend.&quot;");
    expect(html).toContain('href="https://sevenfriends.io/"');
    expect(html).not.toMatch(/\{\w+\}/); // nothing left unfilled
    expect(html).not.toContain("HOW THE INVITATION EMAIL LOOKS"); // the note at the top is not sent
    expect(html.trimStart().startsWith("<!DOCTYPE html>")).toBe(true);
    expect(html.replace(/^<!DOCTYPE html>\s*/i, "").startsWith("<html")).toBe(true); // nothing but the page itself: no stray text of the note
    expect(html).not.toContain("npm --prefix");
  });

  it("without a message the block is gone", async () => {
    const { inviteHtml } = await import("../src/outbox");
    const html = inviteHtml({ ...sample, message: null })!;
    expect(html).not.toContain("border-left:4px solid");
    expect(html).toContain("Open Seven Friends");
  });

  it("nothing a person writes can add markup", async () => {
    const { inviteHtml } = await import("../src/outbox");
    const html = inviteHtml({ ...sample, fromName: "<b>Bad</b>", message: '<script>alert("x")</script>' })!;
    expect(html).not.toContain("<script>");
    expect(html).not.toContain("<b>Bad</b>");
    expect(html).toContain("&lt;script&gt;");
  });

  it("an invitation of the app carries the html next to the text", async () => {
    const pool = await seedPool();
    const entry = await pool[0].raw("post", "/circles/default/friends", { name: "N", email: person(70).email, message: "Come!" }).expect(201);
    await pool[0].raw("post", `/circles/default/friends/${entry.body.id}/invite`).expect(200);
    const [doc] = (await getFirestore().collection("mail").get()).docs;
    expect(doc.data().message.html).toContain("Person 00 wants you as a close friend");
    expect(doc.data().message.text).toContain("Come!");
    expect(await deliverMail(doc.id, transportFor)).toBe("sent");
    expect(sent[0].html).toContain("Open Seven Friends");
  });

  it("a missing template file means text only", async () => {
    const { inviteHtml } = await import("../src/outbox");
    process.env.INVITE_EMAIL_TEMPLATE = "assets/mail/does-not-exist.html";
    try {
      expect(inviteHtml(sample)).toBeUndefined();
    } finally {
      delete process.env.INVITE_EMAIL_TEMPLATE;
    }
  });
});
