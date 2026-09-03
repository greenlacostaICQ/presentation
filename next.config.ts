import type { NextConfig } from 'next';

const isGitHubPages = process.env.GITHUB_PAGES === 'true';

const nextConfig: NextConfig = {
  output: 'standalone',
  basePath: isGitHubPages ? '/presentation' : '',
  assetPrefix: isGitHubPages ? '/presentation' : '',
};

export default nextConfig;
