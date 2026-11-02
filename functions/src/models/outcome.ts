import { AcceptResult } from "./shared";

/** The result of confirming a request inside the backend; "not-found" becomes a 404. */
export type AcceptOutcome = AcceptResult | "not-found";
