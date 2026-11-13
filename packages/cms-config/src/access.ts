import type { Access, PayloadRequest } from 'payload'

/** Anyone, including anonymous visitors. Use for content the public site renders. */
export const anyone: Access = () => true

/** Only a signed-in admin user. The Users collection is admin-only, so any user is an admin. */
export const authenticated = ({ req }: { req: PayloadRequest }): boolean => Boolean(req.user)
