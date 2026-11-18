# Donations (Stripe)

A person can donate to Seven Friends as often as they like, and chooses the amount (5.00 or more). The payment is made with the Stripe **Payment Element** that sits inside the Settings page `/settings/support` (the Settings row is called "Donations"). Every donation is a document in the collection `user-account/{uid}/donation/{paymentIntentId}`, and the page lists them with amount and date. The product id of what is paid for is `donation` (in the Stripe metadata, the Stripe description and on every record). The About page carries no payment information. Nothing in the app reacts to `supporter` yet.

## How it works
1. The page asks `GET /api/payments/status`: `{ enabled, limits: { currency, min, max, suggested }, donations: [{ id, amount, currency, status, paidAt }] }` (the donations that were paid or refunded, newest first).
2. Step 1, the person picks an amount (a few buttons and a field; the least is `min`). **Next** calls `POST /api/payments/intent` with `{ amount }` (the smallest unit of the currency). The backend checks the amount is a whole number between `min` and `max` (an amount outside answers 400), makes a Stripe PaymentIntent, writes the donation with `status: "pending"`, and returns the client secret, the publishable key, the amount and the currency.
3. Step 2, the page loads Stripe.js, mounts the Payment Element and shows the amount. **Donate** calls `stripe.confirmPayment` (`redirect: 'if_required'`; a method that needs a redirect returns to `/settings/support`). The page then says "Donation received", and asks the status again every 2 seconds (30 seconds at most) until the new donation is in the list. "Make another donation" starts again at step 1.
4. Stripe calls `POST /api/payments/webhook`. The backend checks the signature (the exact bytes are `req.rawBody`: Cloud Functions has already read the body; the route is also mounted BEFORE `express.json` in `app.ts`) and handles:
   - `payment_intent.succeeded`: in a transaction, if the donation exists and matches (same amount and currency; the uid is in the PaymentIntent metadata) and is not yet completed: `status: "completed"`, `paidAt`, and `supporter: true` on the account. A payment that does not match is logged and ignored.
   - `payment_intent.payment_failed`: a pending donation becomes `failed`.
   - `charge.refunded`: the donation becomes `refunded`; `supporter` stays true only while the account has another completed donation.
5. **Only the webhook marks a donation as paid.** The answer of the browser is never trusted. Stripe repeats events, so every handler is safe to run twice; an error returns 500 so Stripe tries again.

## Files
- `functions/src/payments.ts`: the routes and `handleEvent`.
- `functions/src/constants.ts` (`DONATION_COLLECTION`), `functions/src/paths.ts` (`donationCol(uid)`). `erase.ts` deletes a person's donation documents with the account (the records at Stripe stay with Stripe).
- `functions/src/settings.ts`: `PAYMENT_AMOUNT` (the amount suggested first, smallest currency unit: 500 = 5.00), `PAYMENT_MIN_AMOUNT` (default 500), `PAYMENT_MAX_AMOUNT` (default 100000), `PAYMENT_CURRENCY` (default `eur`).
- `scripts/sync-stripe.mjs`: copies the Stripe settings from the root `.env` to `functions/.env`.
- `frontend/src/app/support/` (the page), the row in `frontend/src/app/settings-home/`, `frontend/public/i18n/<lang>/support.json` (English text in every language for now, to be translated).

## Setup
- Everything goes in the **project root `.env`** (template: `.env.example`): `PAYMENT` (`on` / `off`, the switch: not set = off), `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `STRIPE_PUBLISHABLE_KEY`, `PAYMENT_AMOUNT`, `PAYMENT_MIN_AMOUNT`, `PAYMENT_MAX_AMOUNT`, `PAYMENT_CURRENCY`. No Firebase secrets are used.
- `scripts/sync-stripe.mjs` (`npm run sync:stripe`; also runs before `npm run dev:emulators` and before a functions deploy, see `firebase.json`) copies those keys into `functions/.env` (gitignored, loaded by Firebase) between two marker lines. Change the root `.env`, then restart the emulators or deploy again. Never commit or print the keys. Note: on a deploy they become plain environment variables of the function.
- Stripe dashboard: a webhook endpoint `https://<host>/api/payments/webhook` for `payment_intent.succeeded`, `payment_intent.payment_failed`, `charge.refunded`. Locally: `stripe listen --events payment_intent.succeeded,payment_intent.payment_failed,charge.refunded --forward-to http://localhost:5001/demo-sevenfriends/europe-west1/api/api/payments/webhook` (it prints the `whsec_` secret for `.env`). Test card: `4242 4242 4242 4242`.
- `PAYMENT=off`: the intent route answers 503 and the page says donations are not available. The webhook keeps working (a payment already made is still recorded or refunded) and the list of donations already made is still returned.
- Stripe needs at least about 0.50 EUR for a payment, so a `PAYMENT_MIN_AMOUNT` below that fails at Stripe.

## Not done
- Backend tests for the webhook (no real Stripe in tests: mock `Stripe` and `constructEvent`).
- What `supporter` unlocks, if anything. Currencies with other than 2 decimals (the page assumes 100 units per whole).
- Translations of the page.
