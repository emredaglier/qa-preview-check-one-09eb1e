import path from 'node:path'

import { withPayload } from '@payloadcms/next/withPayload'
import type { NextConfig } from 'next'

const nextConfig: NextConfig = {
  // Workspace packages ship TypeScript source; list each one web imports.
  transpilePackages: ['@house/ui', '@house/motion', '@house/cms-config'],
  poweredByHeader: false,
  // Docker image only: self-contained server output, traced from the monorepo root.
  ...(process.env.NEXT_STANDALONE === '1'
    ? {
        output: 'standalone' as const,
        outputFileTracingRoot: path.join(import.meta.dirname, '../..'),
      }
    : {}),
  // Build args of the Docker image; both may be empty.
  ...(process.env.ASSET_PREFIX ? { assetPrefix: process.env.ASSET_PREFIX } : {}),
  ...(process.env.DEPLOYMENT_ID ? { deploymentId: process.env.DEPLOYMENT_ID } : {}),
}

// web has no admin and no API routes (ADR-0002); withPayload is only here to bundle Payload's
// server packages (libsql, ...) correctly for the Local API.
const withServerPackages = withPayload(nextConfig, { devBundleServerPackages: false })
const payloadHeaders = withServerPackages.headers

/** The Client Hints header names `withPayload` adds for the admin's theme detection. */
const isClientHintHeader = ({ key, value }: { key: string; value: string }) =>
  ['accept-ch', 'critical-ch'].includes(key.toLowerCase()) ||
  (key.toLowerCase() === 'vary' && /^sec-ch-/i.test(value))

/**
 * `withPayload` sends `Accept-CH`, `Critical-CH` and `Vary: Sec-CH-Prefers-Color-Scheme` on every
 * path, for the Payload admin. This site has no admin, so the headers only cost: on a first visit
 * Chrome sees `Critical-CH`, throws the response away and requests the page again (the page seems
 * to refresh on its own), and `Vary` splits caches.
 */
const stripClientHints: NonNullable<NextConfig['headers']> = async () =>
  ((await payloadHeaders?.()) ?? [])
    .map((rule) => ({ ...rule, headers: rule.headers.filter((h) => !isClientHintHeader(h)) }))
    .filter((rule) => rule.headers.length > 0)

export default { ...withServerPackages, headers: stripClientHints } satisfies NextConfig
