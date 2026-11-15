/** How long somebody counts as new: the first days after the account was made (or until the setup is finished). */
export const NEW_USER_DAYS = 7;

/**
 * Is this a new person? Yes while their setup is not finished, and for the first week of the account. A new person is shown what is left to do in a way that cannot be
 * missed (the setup notes on Home: open, with a border, in larger text); everybody else gets the small folded line.
 * `creationTime` = when the account was made (the login's `metadata.creationTime`); nothing known counts as not new.
 */
export function isNewUser(creationTime: string | null | undefined, setupLeft: boolean, now: number = Date.now()): boolean {
  if (setupLeft) return true;
  const created = creationTime ? Date.parse(creationTime) : NaN;
  return Number.isFinite(created) && now - created >= 0 && now - created < NEW_USER_DAYS * 24 * 60 * 60 * 1000;
}
