import type { GlobalConfig } from 'payload'

import { anyone, authenticated } from '../access'

/** Site-wide text. The public site renders it; only a signed-in admin can change it. */
export const Site: GlobalConfig = {
  slug: 'site',
  label: 'Site',
  access: {
    read: anyone,
    update: authenticated,
  },
  fields: [
    { name: 'name', type: 'text', required: true },
    { name: 'tagline', type: 'text' },
    { name: 'intro', type: 'textarea' },
    { name: 'defaultDescription', type: 'textarea', label: 'Default description' },
  ],
}
