/** Friendly text for the Firebase login error codes (all login pages use this). */
const MESSAGES: Record<string, string> = {
  'auth/invalid-credential': 'Wrong email or password.',
  'auth/wrong-password': 'Wrong email or password.',
  'auth/user-not-found': 'Wrong email or password.',
  'auth/invalid-email': 'Please enter a valid email address.',
  'auth/email-already-in-use': 'An account with this email already exists.',
  'auth/weak-password': 'Password must be at least 6 characters.',
  'auth/too-many-requests': 'Too many attempts. Try again later.',
  'auth/operation-not-allowed':
    'This sign-in method is not enabled in Firebase, or (for phone) texts to this country are not allowed there: Authentication → Settings → SMS region policy.',
  'auth/invalid-phone-number': 'Check the number: write it with the country code, for example +47 900 00 000.',
  'auth/missing-phone-number': 'Write your phone number first.',
  'auth/quota-exceeded': 'Too many text messages were sent. Try again later.',
  'auth/captcha-check-failed': 'The security check failed. Reload the page and try again.',
  'auth/invalid-verification-code': 'That code is not right. Check the text message and try again.',
  'auth/code-expired': 'The code has expired. Ask for a new one.',
  'auth/credential-already-in-use': 'This number is already used by another account.',
  'auth/provider-already-linked': 'A phone number is already verified on this account.',
  'auth/requires-recent-login': 'Please sign in again, then try once more.',
  'auth/invalid-action-code': 'This link is not valid any more. Ask for a new one.',
  'auth/expired-action-code': 'This link has expired. Ask for a new one.',
  'auth/unauthorized-continue-uri': 'This web address is not allowed to send sign-in links (add it under Authorized domains in Firebase).',
};

const code = (err: unknown): string => (err as { code?: string } | null)?.code ?? '';

/** The message for an error, or the fallback when the code is not known. */
export const authMessage = (err: unknown, fallback: string): string => MESSAGES[code(err)] ?? fallback;

/** The user closed the pop-up: not an error to show. */
export const wasCancelled = (err: unknown): boolean =>
  ['auth/popup-closed-by-user', 'auth/cancelled-popup-request'].includes(code(err));

/** The email or the password did not fit: for somebody new, that usually means "there is no account yet". */
export const wasRejected = (err: unknown): boolean =>
  ['auth/invalid-credential', 'auth/wrong-password', 'auth/user-not-found'].includes(code(err));
