/** @type {import('next').NextConfig} */
const nextConfig = {
  output: 'standalone',
  reactStrictMode: true,
  eslint: { ignoreDuringBuilds: true },
  typescript: { ignoreBuildErrors: false },
  experimental: {
    // Required to resolve pnpm workspace peer deps cleanly.
    serverComponentsExternalPackages: ['pg', 'bcryptjs', 'resend', 'stripe'],
  },
  webpack: (config) => {
    // Our source uses NodeNext-style `.js` import specifiers that point at
    // `.ts` files. Next.js 14's default bundler resolution won't expand
    // these, so teach webpack to try `.ts`/`.tsx` before `.js`.
    config.resolve.extensionAlias = {
      ...(config.resolve.extensionAlias ?? {}),
      '.js': ['.ts', '.tsx', '.js'],
    };
    return config;
  },
};

export default nextConfig;
