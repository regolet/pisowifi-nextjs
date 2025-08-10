/** @type {import('next').NextConfig} */
const nextConfig = {
  // Disable SWC completely for ARM architecture compatibility
  swcMinify: false,
  compiler: {
    // Remove SWC-based optimizations
    removeConsole: false,
  },
  experimental: {
    forceSwcTransforms: false,
  },
  env: {
    NEXTAUTH_SECRET: process.env.NEXTAUTH_SECRET,
    DATABASE_URL: process.env.DATABASE_URL,
    GPIO_SERVICE_URL: process.env.GPIO_SERVICE_URL || 'http://localhost:3001',
  },
  // Enable WebSocket support
  webpack: (config, { isServer, dev }) => {
    // Force Babel loader
    config.module.rules.push({
      test: /\.(js|jsx|ts|tsx)$/,
      exclude: /node_modules/,
      use: {
        loader: 'babel-loader',
        options: {
          presets: ['next/babel'],
        },
      },
    });
    
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