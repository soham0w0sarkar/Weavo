/** @type {import('next').NextConfig} */
const basePath = process.env.NEXT_PUBLIC_BASE_PATH ?? "";
const staticExport = process.env.NEXT_STATIC_EXPORT === "1";

const nextConfig = {
  ...(staticExport ? { output: "export" } : {}),
  basePath,
  assetPrefix: basePath ? `${basePath}/` : undefined,
  transpilePackages: [
    "@repo/relay",
    "@repo/core",
    "@repo/sync",
    "@repo/transport",
  ],
  images: {
    unoptimized: true,
  },
};

export default nextConfig;
