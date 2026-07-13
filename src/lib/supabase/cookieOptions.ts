// When the app is embedded in another site's <iframe>, its auth cookies are
// "third-party" and must be SameSite=None; Secure to be sent at all. Enable by
// setting NEXT_PUBLIC_EMBED=true in the host env. When not embedding we keep the
// safer default (Lax), so standalone use is unchanged.
//
// NOTE: modern browsers also partition/withhold third-party cookies. For the
// session to survive inside a cross-site iframe the embedding admin should load
// this app over HTTPS and, ideally, browsers that support CHIPS/partitioned
// cookies. Same-site embedding (subdomain of the admin) is the most reliable.
const EMBED = process.env.NEXT_PUBLIC_EMBED === "true";

export const authCookieOptions = EMBED
  ? { sameSite: "none" as const, secure: true }
  : undefined;
