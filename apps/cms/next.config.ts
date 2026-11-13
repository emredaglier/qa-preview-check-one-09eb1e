import path from 'node:path'

import { withPayload } from '@payloadcms/next/withPayload'
import type { NextConfig } from 'next'

const nextConfig: NextConfig = {
  // Workspace packages ship TypeScript source; list each one cms imports.
  transpilePackages: ['@house/cms-config'],
  poweredByHeader: false,
  // Docker image only: self-contained server output, traced from the monorepo root.
  ...(process.env.NEXT_STANDALONE === '1'
    ? {
        output: 'standalone' as const,
        outputFileTracingRoot: path.join(import.meta.dirname, '../..'),
      }
    : {}),
  // cms is only the Payload admin and API; the site lives in apps/web.
  async redirects() {
    return [{ source: '/', destination: '/admin', permanent: false }]
  },
}

export default withPayload(nextConfig, { devBundleServerPackages: false })
