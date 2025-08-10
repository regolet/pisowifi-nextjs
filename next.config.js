/** @type {import('next').NextConfig} */
const nextConfig = {
  // Disable SWC for ARM architecture compatibility
  swcMinify: false,
  env: {
    NEXTAUTH_SECRET: process.env.NEXTAUTH_SECRET,
    DATABASE_URL: process.env.DATABASE_URL,
    GPIO_SERVICE_URL: process.env.GPIO_SERVICE_URL || 'http://localhost:3001',
  },
  // Enable WebSocket support
  webpack: (config, { isServer }) => {
    if (!isServer) {
      config.resolve.fallback = {
        ...config.resolve.fallback,
        fs: false,
        net: false,
        tls: false,
      };
    }
    config.externals.push({
      'utf-8-validate': 'commonjs utf-8-validate',
      'bufferutil': 'commonjs bufferutil',
    });
    return config;
  },
}

module.exports = nextConfig