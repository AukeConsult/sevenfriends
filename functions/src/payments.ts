import express, { Router } from "express";
import { DecodedIdToken } from "firebase-admin/auth";
import { getFirestore } from "firebase-admin/firestore";
import Stripe from "stripe";
import { asyncHandler, requireAuth } from "./auth";
import { donationCol, userDoc } from "./paths";
import { setting } from "./settings";

/** The product id of what is paid for: it is in the Stripe metadata, the Stripe description and on every donation record. */
const PRODUCT_ID = "donation";

const uidOf = (res: { locals: Record<string, unknown> }) => (res.locals.token as DecodedIdToken).uid;

let stripeClient: Stripe | undefined;
/** The Stripe client, made when first needed (the keys come from the root .env through functions/.env). */
function stripe(): Stripe {
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) throw new Error("STRIPE_SECRET_KEY is not set");
  return (stripeClient ??= new Stripe(key));
}

/** Is donating switched on (PAYMENT=on in the root .env)? */
export const paymentOn = (): boolean => ["on", "true", "1", "yes"].includes(setting("PAYMENT").trim().toLowerCase());

/** Whole positive number from a setting (smallest currency unit), or the fallback. */
function whole(name: "PAYMENT_AMOUNT" | "PAYMENT_MIN_AMOUNT" | "PAYMENT_MAX_AMOUNT", fallback: number): number {
  const n = Number(setting(name));
  return Number.isInteger(n) && n > 0 ? n : fallback;
}

/** What can be donated: the currency, the least and the most (smallest currency unit; the least is 5.00 by default) and the amount that is suggested first. */
function limits(): { currency: string; min: number; max: number; suggested: number } | null {
  const currency = setting("PAYMENT_CURRENCY").toLowerCase();
  const min = whole("PAYMENT_MIN_AMOUNT", 500);
  const max = Math.max(whole("PAYMENT_MAX_AMOUNT", 100000), min);
  if (!/^[a-z]{3}$/.test(currency)) return null;
  return { currency, min, max, suggested: Math.min(Math.max(whole("PAYMENT_AMOUNT", min), min), max) };
}

/** Routes for a signed-in person: start a donation, and list the donations made. A person can donate as often as they like. */
export const paymentsRouter = Router();

/** POST /payments/intent: makes a PaymentIntent; the app shows the Payment Element with the returned client secret. */
paymentsRouter.post("/intent", requireAuth, asyncHandler(async (req, res) => {
  const uid = uidOf(res);
  const publishableKey = process.env.STRIPE_PUBLISHABLE_KEY;
  const range = limits();
  if (!paymentOn() || !publishableKey || !process.env.STRIPE_SECRET_KEY || !range) {
    res.status(503).json({ error: "Payments are not set up" });
    return;
  }
  // the person chooses the amount (smallest currency unit): a whole number from the least to the most
  const amount = req.body?.amount;
  if (!Number.isInteger(amount) || amount < range.min || amount > range.max) {
    res.status(400).json({ error: "Choose an amount between " + range.min + " and " + range.max });
    return;
  }
  const cost = { amount: amount as number, currency: range.currency };
  const intent = await stripe().paymentIntents.create({
    amount: cost.amount,
    currency: cost.currency,
    automatic_payment_methods: { enabled: true },
    description: PRODUCT_ID,
    metadata: { uid, product: PRODUCT_ID },
  });
  await donationCol(uid).doc(intent.id).set({ product: PRODUCT_ID, amount: cost.amount, currency: cost.currency, status: "pending", createdAt: Date.now() });
  res.status(201).json({ clientSecret: intent.client_secret, publishableKey, amount: cost.amount, currency: cost.currency });
}));

/** GET /payments/status: is donating on, and the donations of this account (the ones that were paid or refunded), newest first. */
paymentsRouter.get("/status", requireAuth, asyncHandler(async (_req, res) => {
  const uid = uidOf(res);
  const snap = await donationCol(uid).where("status", "in", ["completed", "refunded"]).get();
  const donations = snap.docs
    .map((d) => ({ id: d.id, amount: d.data().amount as number, currency: d.data().currency as string, status: d.data().status as string, paidAt: (d.data().paidAt ?? d.data().createdAt) as number }))
    .sort((a, b) => b.paidAt - a.paidAt);
  res.json({ enabled: paymentOn(), limits: limits(), donations });
}));

/** The Stripe webhook (POST /api/payments/webhook): the only thing that marks a donation as paid. The browser's word is never trusted. */
export const paymentsWebhookRouter = Router();

paymentsWebhookRouter.post("/", express.raw({ type: "application/json" }), asyncHandler(async (req, res) => {
  const secret = process.env.STRIPE_WEBHOOK_SECRET;
  const signature = req.header("stripe-signature");
  if (!secret || !signature) {
    res.status(400).json({ error: "Not a Stripe call" });
    return;
  }
  let event: Stripe.Event;
  try {
    // Cloud Functions has already read the body and keeps the exact bytes in rawBody (express.raw covers the plain Express case, as in the tests)
    event = stripe().webhooks.constructEvent((req as { rawBody?: Buffer }).rawBody ?? req.body, signature, secret);
  } catch (err) {
    console.error("Stripe webhook rejected:", (err as Error).message); // never the body or the secret
    res.status(400).json({ error: "Bad signature" });
    return;
  }
  await handleEvent(event);
  res.json({ received: true }); // a thrown error is a 500: Stripe tries again
}));

/** Marks the account as a supporter when it has at least one paid donation, and not when it has none (all refunded). */
async function setSupporter(t: FirebaseFirestore.Transaction, uid: string, value: boolean): Promise<void> {
  t.set(userDoc(uid), value ? { supporter: true } : { supporter: false }, { merge: true });
}

/** One Stripe event. Safe to run twice (Stripe repeats events): the transaction looks at the state first. */
export async function handleEvent(event: Stripe.Event): Promise<void> {
  const db = getFirestore();
  if (event.type === "payment_intent.succeeded") {
    const intent = event.data.object as Stripe.PaymentIntent;
    const uid = intent.metadata?.uid;
    if (!uid) return;
    await db.runTransaction(async (t) => {
      const ref = donationCol(uid).doc(intent.id);
      const data = (await t.get(ref)).data();
      // A payment we did not start, or one that does not match what we recorded, is not honoured.
      if (!data || data.amount !== intent.amount_received || data.currency !== intent.currency) {
        console.error("Payment does not match its record:", intent.id);
        return;
      }
      if (data.status === "completed") return;
      t.update(ref, { status: "completed", paidAt: Date.now() });
      await setSupporter(t, uid, true);
    });
  } else if (event.type === "payment_intent.payment_failed") {
    const intent = event.data.object as Stripe.PaymentIntent;
    const uid = intent.metadata?.uid;
    if (!uid) return;
    const ref = donationCol(uid).doc(intent.id);
    const snap = await ref.get();
    if (snap.exists && snap.data()?.status === "pending") await ref.update({ status: "failed", failure: intent.last_payment_error?.message ?? "" });
  } else if (event.type === "charge.refunded") {
    const charge = event.data.object as Stripe.Charge;
    const id = typeof charge.payment_intent === "string" ? charge.payment_intent : charge.payment_intent?.id;
    if (!id) return;
    const uid = (await stripe().paymentIntents.retrieve(id)).metadata?.uid;
    if (!uid) return;
    await db.runTransaction(async (t) => {
      const ref = donationCol(uid).doc(id);
      const data = (await t.get(ref)).data();
      const paid = await t.get(donationCol(uid).where("status", "==", "completed"));
      if (!data || data.status === "refunded") return;
      t.update(ref, { status: "refunded", refundedAt: Date.now() });
      await setSupporter(t, uid, paid.docs.some((d) => d.id !== id));
    });
  }
}
