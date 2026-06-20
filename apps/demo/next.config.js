/** @type {import('next').NextConfig} */
const nextConfig = {
  transpilePackages: [
    "@repo/relay",
    "@repo/core",
    "@repo/sync",
    "@repo/transport",
  ],
};

export default nextConfig;
