# UptimeRobot monitors

Free plan, 5 minute interval (ADR-0011). The owner creates these once per project; nothing in this repo talks to UptimeRobot, so there is no API key to store. Alerts go to the owner's email (and the same webhook as deploy alerts if wanted).

A check that only fetches `/` can look healthy while the CDN or the database is broken, so each monitor below covers one failure `/` alone would miss. `<DOMAIN>` and `<CDN_HOST>` are the values in [`project.env`](project.env).

| #   | Name               | Type    | URL                                                                        | Expect                                     |
| --- | ------------------ | ------- | -------------------------------------------------------------------------- | ------------------------------------------ |
| 1   | `<project>` home   | Keyword | `https://<DOMAIN>/`                                                        | HTTP 200, a keyword only the home page has |
| 2   | `<project>` page   | Keyword | `https://<DOMAIN>/<a content page>`                                        | HTTP 200, a keyword only that page has     |
| 3   | `<project>` static | HTTP(s) | `https://<CDN_HOST>/releases/<live-release>/_next/static/chunks/<file>.js` | HTTP 200                                   |

Monitor 3 breaks on every release, because the path carries the release tag and the file names are content-hashed. Update it after each deploy (below), or delete it: the deploy's own smoke checks (`infra/smoke.sh`) fetch a static chunk and a media file, and the release gate (`pnpm smoke`) covers broken chunks before release.

## Updating the content page and chunk URLs

**Page (monitor 2):** pick a page that stays published and keep its URL. If you rename or unpublish it the monitor goes red: edit the monitor's URL and keyword (Monitors, the monitor, Edit).

**Chunk (monitor 3):** after each deploy, find a current file name and the release tag (`infra/deploy.sh status` on the server shows the live one):

```sh
# on your laptop
curl -s https://<DOMAIN>/ | grep -o 'https://<CDN_HOST>/releases/[^"]*\.js' | head -1
```

Paste that URL into monitor 3.

## Not monitored here

- `cms` and `/admin` are Tailscale-only (ADR-0002), so UptimeRobot cannot reach them.
- Backups are watched by the nightly media-backup workflow and Litestream's own alerts, not by uptime checks.
