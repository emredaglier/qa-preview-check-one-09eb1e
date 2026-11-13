import { HEAD_SCRIPT } from '@house/ui'
import { fontVariables } from '@house/ui/fonts'
import type { Metadata } from 'next'
import type { ReactNode } from 'react'

import './globals.css'
import { MotionFaultReporter } from './MotionFaultReporter'

export const metadata: Metadata = { title: 'Lilac & Linden' }

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    // data-js is set by the head script before first paint, so React must not complain that the
    // attribute differs from the server HTML.
    <html lang="en" className={fontVariables} suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: HEAD_SCRIPT }} />
      </head>
      <body>
        <MotionFaultReporter />
        {children}
      </body>
    </html>
  )
}
