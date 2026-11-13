import { describe, expect, it } from 'vitest'

import {
  builtFilePaths,
  chunkPaths,
  collectServed,
  findLeaks,
  type Fetcher,
  type Served,
} from './secrets-scan.ts'

const SECRET = 'smoke-only-web-payload-secret'
const served = (url: string, text: string): Served => ({ url, text })

describe('findLeaks', () => {
  it('passes files that hold none of the secrets and no secret-shaped text', () => {
    expect(
      findLeaks(
        [
          served('/', '<html><h1>Hello</h1><script src="/_next/static/chunks/a.js"></script>'),
          served('/_next/static/chunks/a.js', 'var a=process.env.NODE_ENV;console.log("hi")'),
        ],
        [SECRET],
      ),
    ).toEqual([])
  })

  it('finds a secret value in a script, in the page HTML and in RSC data, naming the file', () => {
    const leaks = findLeaks(
      [
        served('/_next/static/chunks/a.js', `fetch("/x",{headers:{k:"${SECRET}"}})`),
        served('/', `<html>...</html>`),
        served('/other', `self.__next_f.push([1,"{\\"token\\":\\"${SECRET}\\"}"])`),
      ],
      [SECRET],
    )
    expect(leaks.map((leak) => leak.url)).toEqual(['/_next/static/chunks/a.js', '/other'])
    expect(leaks[0]?.kind).toBe('value')
  })

  it('finds the value written URL-encoded or as base64', () => {
    const secret = 'a secret/with+chars&more'
    const encoded = findLeaks([served('/u', `href="?k=${encodeURIComponent(secret)}"`)], [secret])
    const base64 = findLeaks([served('/b', `x="${btoa(secret)}"`)], [secret])
    expect(encoded).toHaveLength(1)
    expect(base64).toHaveLength(1)
  })

  it('never prints the secret itself, only which secret it was by position', () => {
    const [leak] = findLeaks([served('/a.js', SECRET)], [SECRET])
    expect(JSON.stringify(leak)).not.toContain(SECRET)
    expect(leak?.what).toBe('secret #1')
  })

  it('finds text shaped like a credential, with no list of values needed', () => {
    const cases: Record<string, string> = {
      'private key': 'x="-----BEGIN RSA PRIVATE KEY-----MIIE"',
      'AWS access key id': 'id:"AKIAIOSFODNN7EXAMPLE"',
      'GitHub token': 'token:"ghp_abcdefghijklmnopqrstuvwxyz0123456789"',
      'Stripe secret key': 'k:"sk_' + 'live_abcdefghijklmnopqrstuvwx"',
      'Slack token': 't:"xoxb-123456789012-abcdefghij"',
    }
    for (const [name, text] of Object.entries(cases)) {
      const leaks = findLeaks([served('/a.js', text)], [])
      expect(
        leaks.map((leak) => leak.what),
        name,
      ).toEqual([name])
      expect(leaks[0]?.kind).toBe('shape')
    }
  })

  it('does not mistake a public key for a private one, or a short word for a key id', () => {
    expect(
      findLeaks([served('/a.js', '-----BEGIN PUBLIC KEY----- AKIA sk_live_ ghp_short')], []),
    ).toEqual([])
  })

  it('refuses a secret too short to scan for, instead of passing on a meaningless scan', () => {
    expect(() => findLeaks([served('/', 'x')], ['short'])).toThrow(/too short/)
    expect(() => findLeaks([served('/', 'x')], [''])).toThrow(/too short/)
  })
})

describe('chunkPaths', () => {
  it('lists every script and stylesheet a document or a script points at, once', () => {
    const html = `
      <link rel="stylesheet" href="https://cdn.example.com/releases/v1/_next/static/css/app.css?dpl=v1"/>
      <script src="/_next/static/chunks/main-abc.js?dpl=v1" async=""></script>
      <script src="/_next/static/chunks/main-abc.js?dpl=v1" async=""></script>
      <script>self.__next_f.push([1,"[\\"static/chunks/lazy-def.js\\",\\"static/chunks/%5Bturbo%5D.js\\"]"])</script>
      <img src="/_next/static/media/logo.png"/>`
    expect(chunkPaths(html).sort()).toEqual([
      'static/chunks/%5Bturbo%5D.js',
      'static/chunks/lazy-def.js',
      'static/chunks/main-abc.js',
      'static/css/app.css',
    ])
  })

  it('returns nothing for a document with no build files', () => {
    expect(chunkPaths('<html><body>plain</body></html>')).toEqual([])
  })
})

describe('chunkPaths: what it must and must not match', () => {
  it('does not take `foo.json` or `foo.js.map` for `foo.js`', () => {
    expect(
      chunkPaths(
        'static/chunks/data.json static/chunks/a.js.map "static/chunks/b.css2" static/chunks/c.jsx',
      ),
    ).toEqual([])
  })

  it('still finds a file followed by a quote, a comma, a bracket or the end of the text', () => {
    expect(
      chunkPaths(
        '"static/chunks/a.js","static/chunks/b.js"] static/css/c.css static/chunks/d.js',
      ).sort(),
    ).toEqual([
      'static/chunks/a.js',
      'static/chunks/b.js',
      'static/chunks/d.js',
      'static/css/c.css',
    ])
  })

  it('finds the build manifests under static/<buildId>/', () => {
    expect(
      chunkPaths(
        '<script src="/_next/static/Xk3-9_abcDEF/_buildManifest.js?dpl=v1"></script>' +
          '<script src="/_next/static/Xk3-9_abcDEF/_ssgManifest.js"></script>',
      ).sort(),
    ).toEqual(['static/Xk3-9_abcDEF/_buildManifest.js', 'static/Xk3-9_abcDEF/_ssgManifest.js'])
  })

  it('cannot see a runtime-built chunk URL, which is why the built files are listed', () => {
    expect(chunkPaths('n.u=e=>"static/chunks/"+e+"."+{123:"abc"}[e]+".js"')).toEqual([])
  })
})

describe('builtFilePaths', () => {
  it('keeps scripts and stylesheets of the static folder, as paths under /_next/, sorted', () => {
    expect(
      builtFilePaths([
        'chunks/b.js',
        'media/logo.png',
        'css/app.css',
        'chunks/app/(site)/page-1.js',
        'Xk3/_buildManifest.js',
        'chunks/a.js.map',
        'chunks/data.json',
        'media/font.woff2',
      ]),
    ).toEqual([
      'static/Xk3/_buildManifest.js',
      'static/chunks/app/(site)/page-1.js',
      'static/chunks/b.js',
      'static/css/app.css',
    ])
  })

  it('is empty for an empty listing', () => {
    expect(builtFilePaths([])).toEqual([])
  })
})

/** A fake site: a map of URL (plus ` RSC` for flight data) to the text it serves; the rest is a 404. */
const site = (pages: Record<string, string>): Fetcher => {
  return async (url, headers) => {
    const text = pages[headers ? `${url} RSC` : url]
    return text === undefined ? { status: 404, text: '' } : { status: 200, text }
  }
}
const urls = (files: Served[]) => files.map((file) => file.url)

describe('collectServed', () => {
  it('reads each route as HTML and as flight data, and what they point at', async () => {
    const { files } = await collectServed(
      site({
        '/': '<script src="/_next/static/chunks/main.js"></script>',
        '/ RSC': '0:["$","div"]',
        '/_next/static/chunks/main.js': 'console.log(1)',
      }),
      ['/'],
      [],
    )
    expect(urls(files)).toEqual(['/', '/ (flight data)', '/_next/static/chunks/main.js'])
  })

  it('finds a secret that sits only in a second-level chunk (page -> chunk -> chunk)', async () => {
    const { files } = await collectServed(
      site({
        '/': '<script src="/_next/static/chunks/main.js"></script>',
        '/_next/static/chunks/main.js': 'import("static/chunks/lazy.js")',
        '/_next/static/chunks/lazy.js': `const k="${SECRET}"`,
      }),
      ['/'],
      [],
    )
    expect(findLeaks(files, [SECRET]).map((leak) => leak.url)).toEqual([
      '/_next/static/chunks/lazy.js',
    ])
  })

  it('finds a secret that sits only in an RSC payload', async () => {
    const { files } = await collectServed(
      site({
        '/': '<html><h1>Hello</h1></html>',
        '/ RSC': `1:{"apiKey":"${SECRET}"}`,
      }),
      ['/'],
      [],
    )
    expect(findLeaks(files, [SECRET])).toEqual([
      { url: '/ (flight data)', kind: 'value', what: 'secret #1' },
    ])
  })

  it('reads every built file it is given, even one no page refers to (a lazily loaded chunk)', async () => {
    const { files } = await collectServed(
      site({
        '/': '<html></html>',
        '/_next/static/chunks/lazy-1234.js': `x="${SECRET}"`,
      }),
      ['/'],
      ['static/chunks/lazy-1234.js'],
    )
    expect(findLeaks(files, [SECRET]).map((leak) => leak.url)).toEqual([
      '/_next/static/chunks/lazy-1234.js',
    ])
  })

  it('reads a file once, however many pages and files point at it', async () => {
    const { files } = await collectServed(
      site({
        '/a': '<script src="/_next/static/chunks/m.js">',
        '/b': '<script src="/_next/static/chunks/m.js">',
        '/_next/static/chunks/m.js': '',
      }),
      ['/a', '/b'],
      ['static/chunks/m.js'],
    )
    expect(urls(files).filter((url) => url.endsWith('m.js'))).toHaveLength(1)
  })

  it('names a built file the container does not serve, so a listing that reads nothing fails', async () => {
    const { unserved } = await collectServed(site({ '/': '' }), ['/'], ['static/chunks/gone.js'])
    expect(unserved).toEqual(['/_next/static/chunks/gone.js'])
  })

  it('still names a built file that a page also refers to', async () => {
    const { unserved } = await collectServed(
      site({ '/': '<script src="/_next/static/chunks/gone.js">' }),
      ['/'],
      ['static/chunks/gone.js'],
    )
    expect(unserved).toEqual(['/_next/static/chunks/gone.js'])
  })

  it('does not count a referenced file that 404s as unserved: the route sweep owns that', async () => {
    const { unserved } = await collectServed(
      site({ '/': '<script src="/_next/static/chunks/gone.js">' }),
      ['/'],
      [],
    )
    expect(unserved).toEqual([])
  })

  it('stops with an error when there are more files than the limit, instead of running on', async () => {
    const many = Array.from({ length: 5 }, (_, i) => `static/chunks/c${i}.js`)
    await expect(collectServed(site({}), ['/'], many, 3)).rejects.toThrow(/more than 3/)
  })
})
