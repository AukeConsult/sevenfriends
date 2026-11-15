import { beforeEach, describe, expect, it } from "vitest";
import { User, assertConsistent, person, seedPool } from "./helpers";

/**
 * An invitation for somebody who is NOT on the app (docs/guide/connections.md, "Invitation for somebody who is not on the app"): an EMAIL nobody has is saved as an
 * invitation that waits and shows as soon as that person signs up or logs on with it; a phone number nobody has saves nothing; somebody who IS on the app gets the
 * request at once (a valid invitation: nothing more to do).
 */
let pool: User[];
beforeEach(async () => {
  pool = await seedPool();
});

const stranger = person(90); // never signed in: there is no account for this email or phone number
const circle = "/circles/default/friends";

describe("an email nobody has", () => {
  it("is saved as an invitation: pending, with a seat, and it is on my list", async () => {
    const entry = await pool[0].add(stranger);
    expect(entry).toMatchObject({ status: "pending", email: stranger.email, onApp: false });
    expect((await pool[0].friends()).map((f) => f.id)).toContain(entry.id);
    expect(typeof entry.seat).toBe("number");
    await assertConsistent();
  });

  it("is ready when the person signs up or logs on with that email: the request is there, and they can confirm it", async () => {
    const entry = await pool[0].add(stranger);
    const newcomer = new User(stranger);
    await newcomer.raw("post", "/users/sync").expect(200); // signs up
    const { requests } = await newcomer.check(); // and the first look at the app
    expect(requests.map((r) => r.id)).toEqual([entry.id]);
    await newcomer.confirm(entry.id).expect(200);
    expect((await newcomer.friends()).map((f) => f.id)).toContain(entry.id);
    expect((await pool[0].friends()).find((f) => f.id === entry.id)?.status).toBe("confirmed");
    await assertConsistent();
  });

  it("the same email twice: the second is refused, nothing doubles", async () => {
    await pool[0].add(stranger);
    await pool[0].addRaw(stranger).expect(409);
    expect((await pool[0].friends()).filter((f) => f.email === stranger.email)).toHaveLength(1);
  });

  it("asked by the look-up (only if the person is on the app) it still saves nothing: the page offers the invitation, a tap saves it", async () => {
    const before = (await pool[0].friends()).length;
    const refused = await pool[0].raw("post", circle, { name: "", email: stranger.email, onlyIfOnApp: true }).expect(422);
    expect(refused.body.notOnApp).toBe(true);
    expect((await pool[0].friends()).length).toBe(before);
  });

  it("an email and a phone number together are saved too (the email is there)", async () => {
    const entry = (await pool[0].raw("post", circle, { name: "", email: stranger.email, phone: stranger.phone }).expect(201)).body;
    expect(entry).toMatchObject({ status: "pending", email: stranger.email });
  });

  it("is my own email: refused, as before", async () => {
    await pool[0].raw("post", circle, { name: "", email: pool[0].p.email }).expect(400);
  });
});

describe("a phone number nobody has", () => {
  it("saves nothing: an invitation needs an email (422, needsEmail), and my list is as it was", async () => {
    const before = (await pool[0].friends()).length;
    const refused = await pool[0].addRaw(stranger, "phone").expect(422);
    expect(refused.body).toMatchObject({ needsEmail: true });
    expect((await pool[0].friends()).length).toBe(before);
  });

  it("also in every way a number can be written", async () => {
    for (const via of ["phoneSpaced", "phoneNoPrefix"] as const) {
      await pool[0].addRaw(stranger, via).expect(422);
    }
    expect((await pool[0].friends()).filter((f) => f.phone)).toEqual([]);
  });
});

describe("somebody who IS on the app", () => {
  it("is a valid invitation by itself: the request is sent at once (by email or by phone number), and there is nothing to save for later", async () => {
    for (const [other, via] of [[1, "email"], [2, "phone"]] as const) {
      const entry = (await pool[0].raw("post", circle, { name: "", [via]: via === "email" ? pool[other].p.email : pool[other].p.phone, onlyIfOnApp: true }).expect(201)).body;
      expect(entry.onApp).toBe(true);
      expect((await pool[other].check()).requests.map((r) => r.id)).toContain(entry.id); // they have it, the procedure is over
    }
    await assertConsistent();
  });
});
