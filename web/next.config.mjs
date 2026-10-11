/** @type {import('next').NextConfig} */
const config = {
  reactStrictMode: true,
  // Minimal runtime: `server.js` + static assets, no npm/node_modules.
  output: 'standalone',
};
export default config;
