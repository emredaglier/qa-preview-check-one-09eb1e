import type { Metadata } from 'next'
import Link from 'next/link'

export const metadata: Metadata = { title: 'Not found' }

/** A missing page. Server-rendered; Next answers with status 404. */
export default function NotFound() {
  return (
    <main className="mx-auto max-w-2xl p-8" id="main">
      <h1 className="text-4xl font-semibold">Page not found</h1>
      <p className="mt-6">
        <Link href="/">Back to the home page</Link>
      </p>
    </main>
  )
}
