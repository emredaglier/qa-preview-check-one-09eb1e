/**
 * The placeholder content `pnpm seed` writes into the Site global. A project replaces it with its
 * own text (or deletes the seed once the owner fills the admin in).
 */
export const PLACEHOLDER_SITE = {
  name: 'Project name',
  tagline: 'A placeholder page, read through the Payload Local API.',
  intro:
    'This text is stored in the CMS database and rendered on the server, so it is visible with JavaScript turned off.',
  defaultDescription: 'A placeholder site built from the house starter.',
} as const
