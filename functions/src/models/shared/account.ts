/** The answer of `POST /accounts/check`: is the account of a device still there? "gone" = deleted (or never was): the device wipes what it holds of it. */
export type AccountStatus = "active" | "gone";
