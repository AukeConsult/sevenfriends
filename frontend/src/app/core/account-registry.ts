/**
 * The accounts this browser holds data of, as (user id, stamp) pairs: the stamp (`accountId`) is made by the server when an account is created and is
 * gone with it. A device asks the server about each pair (`AccountWatchService`); an account that is gone is wiped from the device. Neither part is secret
 * enough to matter on the device (the keys themselves are sealed), but the stamp is never sent anywhere except to the account check.
 */
const KEY = 'sf-accounts';

export interface RememberedAccount {
  uid: string;
  accountId: string;
}

const text = (v: unknown): v is string => typeof v === 'string' && v.length > 0 && v.length <= 128;

/** The pairs this browser holds; a damaged value counts as none (and is never allowed to throw). */
export function rememberedAccounts(): RememberedAccount[] {
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(KEY) ?? '{}');
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return [];
    return Object.entries(parsed as Record<string, unknown>)
      .filter(([uid, accountId]) => text(uid) && text(accountId))
      .map(([uid, accountId]) => ({ uid, accountId: accountId as string }));
  } catch {
    return [];
  }
}

function save(list: RememberedAccount[]): void {
  try {
    if (!list.length) localStorage.removeItem(KEY);
    else localStorage.setItem(KEY, JSON.stringify(Object.fromEntries(list.map((a) => [a.uid, a.accountId]))));
  } catch {
    /* no storage: nothing is remembered, nothing can be wiped later */
  }
}

/** This browser holds data of this account (a stamp the server gave). An empty stamp is never remembered. */
export function rememberAccount(uid: string, accountId: string): void {
  if (!text(uid) || !text(accountId)) return;
  const others = rememberedAccounts().filter((a) => a.uid !== uid);
  save([...others, { uid, accountId }]);
}

/** This browser no longer holds data of this account. */
export function forgetAccount(uid: string): void {
  save(rememberedAccounts().filter((a) => a.uid !== uid));
}
