/**
 * Settings of the system that can be changed without touching the code: environment variables of the backend.
 * Put them in `functions/.env` (loaded by `firebase deploy` and by the emulators; copy `functions/.env.example`).
 * Do NOT put secrets in `.env`.
 * Every setting has a default, so nothing has to be set.
 */
export const DEFAULTS = {
  /** where people go to sign up (the link in the invitation) */
  APP_URL: "https://sevenfriends.io/",
  /** the region of the mail trigger: where the Firestore database is */
  MAIL_TRIGGER_REGION: "europe-west1",
  /** the file that sets how the invitation email LOOKS (HTML), relative to the functions folder; delete the file to send text only */
  INVITE_EMAIL_TEMPLATE: "assets/mail/invite.html",
  /** how many times one person can ask a friend for key recovery in a day; 0 = no limit (off while it is being tested, 3 is the plan: docs/design/recovery-by-friend.md) */
  RECOVERY_ASKS_PER_DAY: "0",
  /** how many days the push services keep a push for a device that is off or offline (1 to 28: FCM allows 4 weeks at most; 0 = send no TTL, FCM then uses its own 4 weeks) */
  PUSH_TTL_DAYS: "28",
  /** the subject of the invitation email */
  INVITE_EMAIL_SUBJECT: "{fromName} invited you to {appName}",
  /** the text of the invitation email */
  INVITE_EMAIL_TEXT:
    "{fromName} wants you as one of their 7 closest friends on {appName}.\\n\\n{message}\\n\\nSign up with this email address ({to}) to see the request: {inviteUrl}",
} as const;

export type SettingName = keyof typeof DEFAULTS;

/** A setting: the environment variable if it is set (and not empty), otherwise the default. A literal `\n` is a new line. */
export function setting(name: SettingName): string {
  const value = process.env[name]?.trim();
  return (value ? value : DEFAULTS[name]).replace(/\\n/g, "\n");
}

/**
 * Fills `{name}` places in a template. A place with no value (for example `{message}` when no message was written)
 * becomes empty, and the blank lines it leaves are folded, so the text never has a hole in it.
 */
export function fill(template: string, values: Record<string, string>): string {
  return template
    .replace(/\{(\w+)\}/g, (_all, key: string) => values[key] ?? "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}
