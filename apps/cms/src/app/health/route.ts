import config from '@payload-config'
import { getPayload } from 'payload'

export const dynamic = 'force-dynamic'

/** Container health check. Opens the database and runs one trivial query. */
export async function GET(): Promise<Response> {
  try {
    const payload = await getPayload({ config })
    await payload.count({ collection: 'users', overrideAccess: true })
    return Response.json({ status: 'ok' })
  } catch {
    return Response.json({ status: 'unhealthy' }, { status: 503 })
  }
}
