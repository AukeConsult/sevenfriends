/** The social media networks a person can add. */
export type SocialKey = "facebook" | "instagram" | "tiktok" | "snapchat" | "twitter" | "linkedin" | "telegram";

/** One account (or null) per network, as the API sends and receives them. */
export type Socials = Record<SocialKey, string | null>;
