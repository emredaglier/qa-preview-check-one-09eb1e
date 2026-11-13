import type { CollectionConfig } from 'payload'

import { authenticated } from '../access'

/**
 * Admin users only. There is no public sign-up: `create` needs a signed-in user. The very first
 * user is made through Payload's first-register screen, which only works while the table is empty.
 */
export const Users: CollectionConfig = {
  slug: 'users',
  access: {
    admin: authenticated,
    create: authenticated,
    delete: authenticated,
    read: authenticated,
    update: authenticated,
    // Payload's default lets any signed-in user unlock any account. Locks expire on their own.
    unlock: () => false,
  },
  admin: {
    defaultColumns: ['name', 'email'],
    useAsTitle: 'name',
  },
  auth: {
    lockTime: 10 * 60 * 1000,
    maxLoginAttempts: 5,
    tokenExpiration: 2 * 60 * 60,
    cookies: {
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'Lax',
    },
  },
  fields: [{ name: 'name', type: 'text' }],
  timestamps: true,
}
