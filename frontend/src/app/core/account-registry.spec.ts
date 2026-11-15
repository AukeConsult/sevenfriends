import { forgetAccount, rememberAccount, rememberedAccounts } from './account-registry';

/** The pairs (user id, stamp) of the accounts this browser holds. These run in Chrome (karma) with the real localStorage. */
describe('account registry', () => {
  beforeEach(() => localStorage.clear());
  afterAll(() => localStorage.clear());

  it('holds nothing at first', () => {
    expect(rememberedAccounts()).toEqual([]);
  });

  it('remembers an account, and the same account again keeps ONE pair (the newest stamp)', () => {
    rememberAccount('u1', 'stamp-a');
    rememberAccount('u1', 'stamp-a');
    expect(rememberedAccounts()).toEqual([{ uid: 'u1', accountId: 'stamp-a' }]);
    rememberAccount('u1', 'stamp-b'); // the account was made again: the old stamp is replaced
    expect(rememberedAccounts()).toEqual([{ uid: 'u1', accountId: 'stamp-b' }]);
  });

  it('holds several accounts, and forgetting one leaves the others', () => {
    rememberAccount('u1', 'a');
    rememberAccount('u2', 'b');
    rememberAccount('u3', 'c');
    forgetAccount('u2');
    expect(rememberedAccounts().map((a) => a.uid).sort()).toEqual(['u1', 'u3']);
    forgetAccount('u1');
    forgetAccount('u3');
    expect(rememberedAccounts()).toEqual([]);
    expect(localStorage.getItem('sf-accounts')).toBeNull(); // nothing is left behind
  });

  it('forgetting an account that is not there changes nothing', () => {
    rememberAccount('u1', 'a');
    forgetAccount('nobody');
    expect(rememberedAccounts()).toEqual([{ uid: 'u1', accountId: 'a' }]);
  });

  it('never remembers an empty or absurd value', () => {
    rememberAccount('', 'a');
    rememberAccount('u1', '');
    rememberAccount('x'.repeat(200), 'a');
    rememberAccount('u1', 'y'.repeat(200));
    expect(rememberedAccounts()).toEqual([]);
  });

  it('a damaged value counts as nothing, and a later remember repairs it', () => {
    for (const bad of ['{not json', 'null', '[]', '"text"', '5', '{"u1":5}', '{"":"a"}', '{"u1":""}']) {
      localStorage.setItem('sf-accounts', bad);
      expect(rememberedAccounts()).toEqual([]);
    }
    localStorage.setItem('sf-accounts', '{"u1":"a","u2":7}');
    expect(rememberedAccounts()).toEqual([{ uid: 'u1', accountId: 'a' }]); // the good part is kept
    rememberAccount('u3', 'c');
    expect(rememberedAccounts().map((a) => a.uid).sort()).toEqual(['u1', 'u3']);
  });

  it('never throws when the storage is blocked', () => {
    spyOn(localStorage, 'getItem').and.throwError('blocked');
    spyOn(localStorage, 'setItem').and.throwError('blocked');
    spyOn(localStorage, 'removeItem').and.throwError('blocked');
    expect(rememberedAccounts()).toEqual([]);
    expect(() => rememberAccount('u1', 'a')).not.toThrow();
    expect(() => forgetAccount('u1')).not.toThrow();
  });
});
