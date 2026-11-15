import { NEW_USER_DAYS, isNewUser } from './new-user';

const DAY = 24 * 60 * 60 * 1000;
const NOW = Date.parse('2026-11-15T12:00:00Z');
const ago = (days: number) => new Date(NOW - days * DAY).toUTCString();

/** Who is a new person: the setup notes on Home are made prominent for them. */
describe('isNewUser', () => {
  it('somebody whose setup is not finished is new, however old the account is', () => {
    expect(isNewUser(ago(400), true, NOW)).toBe(true);
    expect(isNewUser(undefined, true, NOW)).toBe(true);
  });

  it('an account from the last days is new, even when the setup is finished', () => {
    expect(isNewUser(ago(0), false, NOW)).toBe(true);
    expect(isNewUser(ago(NEW_USER_DAYS - 1), false, NOW)).toBe(true);
  });

  it('an account older than a week with the setup finished is not new', () => {
    expect(isNewUser(ago(NEW_USER_DAYS), false, NOW)).toBe(false);
    expect(isNewUser(ago(90), false, NOW)).toBe(false);
  });

  it('nothing known, or something that is not a time, is not new (never an error)', () => {
    expect(isNewUser(undefined, false, NOW)).toBe(false);
    expect(isNewUser(null, false, NOW)).toBe(false);
    expect(isNewUser('not a date', false, NOW)).toBe(false);
  });

  it('a time in the future (a clock that is wrong) is not new', () => {
    expect(isNewUser(new Date(NOW + 3 * DAY).toUTCString(), false, NOW)).toBe(false);
  });
});
