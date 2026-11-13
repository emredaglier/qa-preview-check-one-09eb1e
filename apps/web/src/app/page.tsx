import type { Metadata } from 'next'

import { getSite } from '../data/site'

// Content comes from the database at request time (cached by tag), never at build time.
export const dynamic = 'force-dynamic'

export async function generateMetadata(): Promise<Metadata> {
  const site = await getSite()
  return {
    title: site.name,
    description: site.defaultDescription || undefined,
  }
}

/**
 * Placeholder home page. Everything on it is rendered on the server from the Site global, so it
 * is complete with JavaScript off (ADR-0008). Replace it with the project's own page.
 */
export default async function Home() {
  const site = await getSite()
  return (
    <main className="mx-auto max-w-2xl p-8" id="main">
      <h1 className="text-4xl font-semibold">{site.name}</h1>
      {site.tagline ? <p className="mt-2 text-lg">{site.tagline}</p> : null}
      {site.intro ? <p className="mt-6">{site.intro}</p> : null}
    </main>
  )
}
