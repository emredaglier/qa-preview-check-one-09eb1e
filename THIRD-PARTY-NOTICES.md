# Third-party notices

Source code adapted into this repository keeps its original license notice here.

## Satus (darkroom.engineering)

The agent rules (`AGENTS.md`) and the CI checks below are adapted from
[Satus](https://github.com/darkroomengineering/satus) by darkroom.engineering. Each adapted file
says so in its header.

| Here                                                                                                    | Adapted from                                                                                     |
| ------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| `AGENTS.md`                                                                                             | `AGENTS.md` (engineering standards, proof of work)                                               |
| `scripts/assets-budget.ts`, `scripts/check-assets.ts`                                                   | `lib/scripts/check-assets.ts` (asset-weight budget)                                              |
| `smoke/routes.ts`, `smoke/a11y.ts`, `smoke/a11y.spec.ts`                                                | `e2e/route-sweep.e2e.ts` (route discovery, axe on each route)                                    |
| `smoke/secrets-scan.ts`, `smoke/secrets.spec.ts`, `scripts/public-env.ts`, `scripts/public-env.test.ts` | `e2e/secrets-in-bundle.e2e.ts` (secrets must not reach the bundle)                               |
| `smoke/webgl.ts`, `smoke/webgl-fallback.spec.ts`                                                        | the `isWebGL` gate and DOM fallback (`lib/hooks/use-device-detection.ts`, `lib/webgl/README.md`) |

Satus is licensed under the MIT License:

```
The MIT License

Copyright (c) 2024 darkroom.engineering

Permission is hereby granted, free of charge, to any person obtaining a copy of this software and associated documentation files (the “Software”), to deal in the Software without restriction, including without limitation the rights to use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of the Software, and to permit persons to whom the Software is furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED “AS IS”, WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.
```
