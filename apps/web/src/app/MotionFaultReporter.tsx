'use client'

import { useEffect } from 'react'

import { reportFault, startMotionFaultReporting } from '../lib/observability'

/** Mounted once in the root layout: sends every motion fault of the page to `reportFault`. */
export function MotionFaultReporter() {
  useEffect(() => startMotionFaultReporting(window, reportFault), [])
  return null
}
