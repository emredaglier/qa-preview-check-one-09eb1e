import type { Metadata } from 'next'

import { GlowBackdrop } from './GlowBackdrop'

export const metadata: Metadata = {
  title: 'Glow example',
  robots: { index: false },
}

/**
 * The starter's example effect (`packages/motion/src/glow`), on a page of its own so the perf suite
 * has something to measure. The text is plain server HTML: the page is complete with the effect
 * off. A project deletes this folder with the effect it does not keep (README, "Starting a project").
 */
export default function GlowExample() {
  return (
    <main className="mx-auto max-w-2xl p-8" id="main">
      <h1 className="text-4xl font-semibold">Glow example</h1>
      <p className="mt-6">
        A soft glow follows the pointer behind the box below. It is drawn with WebGL2; without it
        the box is just this text.
      </p>
      <GlowBackdrop className="relative mt-8 h-[50vh] overflow-hidden rounded border">
        <p className="relative p-6">Plain HTML, in front of the canvas.</p>
      </GlowBackdrop>
    </main>
  )
}
