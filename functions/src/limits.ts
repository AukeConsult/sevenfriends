import { MAX_UPLOAD_BYTES, SAFEBOX_MAX_BYTES } from "./constants";
import { userDoc } from "./paths";

/** What one account may use. Later these come with the licence of the account; for now every account has the defaults below. */
export interface AccountLimits {
  /** the biggest single file of a safebox that this account may add */
  safeboxFileBytes: number;
  /** the most a safebox may hold in all, when this account adds to it */
  safeboxTotalBytes: number;
}

/** What an account has when nothing is written on it. */
export const DEFAULT_LIMITS: AccountLimits = { safeboxFileBytes: MAX_UPLOAD_BYTES, safeboxTotalBytes: SAFEBOX_MAX_BYTES };

const positive = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value) && value > 0;

/**
 * The limits of an account document (`limits.safeboxFileBytes`, `limits.safeboxTotalBytes`, set by us, never by the app); what is not written (or is damaged) has its default.
 * A file is sent in one request, which Cloud Functions limits to 32 MB (`MAX_UPLOAD_BYTES`): a bigger value on the account only counts once files are sent in pieces.
 */
export function limitsOfData(data: Record<string, any> | undefined): AccountLimits {
  const saved = data?.limits ?? {};
  return {
    safeboxFileBytes: Math.min(positive(saved.safeboxFileBytes) ? saved.safeboxFileBytes : DEFAULT_LIMITS.safeboxFileBytes, MAX_UPLOAD_BYTES),
    safeboxTotalBytes: positive(saved.safeboxTotalBytes) ? saved.safeboxTotalBytes : DEFAULT_LIMITS.safeboxTotalBytes,
  };
}

export async function limitsOf(uid: string): Promise<AccountLimits> {
  return limitsOfData((await userDoc(uid).get()).data());
}
