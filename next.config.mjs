/** @type {import('next').NextConfig} */

// Space-separated list of origins allowed to embed this app in an <iframe>.
// Set FRAME_ANCESTORS in your host (Vercel) env, e.g.
//   FRAME_ANCESTORS='self' https://admin.example.com
// Default 'self' means only this same origin may frame it.
const frameAncestors = process.env.FRAME_ANCESTORS || "'self'";

const nextConfig = {
  reactStrictMode: true,
  images: { remotePatterns: [{ protocol: "https", hostname: "**" }] },
  // Don't let a lint warning fail the production build on the host.
  eslint: { ignoreDuringBuilds: true },
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          // Allow the configured admin(s) to embed us. We deliberately do NOT
          // send X-Frame-Options (it can't express an allow-list and would
          // block framing). frame-ancestors supersedes it in modern browsers.
          { key: "Content-Security-Policy", value: `frame-ancestors ${frameAncestors};` },
        ],
      },
    ];
  },
};
export default nextConfig;
