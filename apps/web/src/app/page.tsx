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

// Hours, address and email are written here, not in the CMS (the Site global holds the hero text).
const HOURS = [
  ['Monday to Saturday', '09:00–19:00'],
  ['Sunday', 'Closed'],
] as const

/**
 * The shop's one page. Everything on it is rendered on the server, so it is complete with
 * JavaScript off (ADR-0008). Plain look: system fonts, three colours, no images or motion.
 */
export default async function Home() {
  const site = await getSite()
  return (
    <div className="min-h-screen bg-[#faf6fb] text-[#2b2233]">
      <main className="mx-auto max-w-2xl p-8" id="main">
        <h1 className="text-4xl font-semibold text-[#5b3a7a]">{site.name}</h1>
        {site.tagline ? <p className="mt-2 text-lg">{site.tagline}</p> : null}
        {site.intro ? <p className="mt-6">{site.intro}</p> : null}

        <section className="mt-12" aria-labelledby="hours">
          <h2 className="text-2xl font-semibold text-[#5b3a7a]" id="hours">
            Opening hours
          </h2>
          <table className="mt-4 w-full border-collapse text-left">
            <tbody>
              {HOURS.map(([days, time]) => (
                <tr className="border-b border-[#d9cce3]" key={days}>
                  <th className="py-2 pr-4 font-normal" scope="row">
                    {days}
                  </th>
                  <td className="py-2">{time}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>

        <section className="mt-12" aria-labelledby="contact">
          <h2 className="text-2xl font-semibold text-[#5b3a7a]" id="contact">
            Contact
          </h2>
          <p className="mt-4">Alsancak, İzmir</p>
          <p className="mt-2">
            <a className="text-[#5b3a7a] underline" href="mailto:hello@example.com">
              hello@example.com
            </a>
          </p>
        </section>
      </main>
      <footer className="mx-auto max-w-2xl border-t border-[#d9cce3] p-8 text-sm">
        A sample site: this shop is fictional.
      </footer>
    </div>
  )
}
