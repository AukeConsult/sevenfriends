/**
 * Settings of the system that can be changed without touching the code: environment variables of the backend.
 * Put them in `functions/.env` (loaded by `firebase deploy` and by the emulators; copy `functions/.env.example`).
 * Do NOT put secrets in `.env`.
 * Every setting has a default, so nothing has to be set.
 */
export const DEFAULTS = {
  /** where people go to sign up (the link in the invitation) */
  APP_URL: "https://sevenfriends.web.app/",
  /** the region of the mail trigger: where the Firestore database is */
  MAIL_TRIGGER_REGION: "europe-west1",
  /** the subject of the invitation email */
  INVITE_EMAIL_SUBJECT: "{fromName} invited you to Seven Friends",
  /** the text of the invitation email */
  INVITE_EMAIL_TEXT:
    "{fromName} wants you as one of their 7 closest friends on Seven Friends.\\n\\n{message}\\n\\nSign up with this email address ({to}) to see the request: {appUrl}",
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
