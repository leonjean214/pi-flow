# Vendored Bash syntax parser

`bash-syntax.js` bundles the parser and traversal exports of ISC-licensed
[`unbash@6.0.5`](https://github.com/webpro-nl/unbash/tree/6.0.5) with
`unbash-6.0.5.patch` applied to its published `dist/lexer.js`. Its license text
is embedded in the bundle so it is preserved in compiled and packed copies.
The `.d.ts` is the upstream `dist/types.d.ts` with declarations for the two
bundled exports.

To regenerate in a temporary directory: install `unbash@6.0.5` exactly with
`npm install --save-exact unbash@6.0.5`; copy its `dist/` to `candidate/`; and
run `patch -d candidate -p2 < /path/to/unbash-6.0.5.patch`. Use this entry:

```js
export { parse } from "./candidate/parser.js";
export { forEachChild } from "./candidate/traversal.js";
```

Save it as `unbash-entry.mjs`. Add `{"type":"module"}` as
`candidate/package.json`. Put the ISC license into a `/*! ... */` header in
`vendor-license.txt`, then run:

```bash
npm exec --yes --package esbuild@0.25.12 -- esbuild unbash-entry.mjs \
  --bundle --format=esm --platform=node --target=es2022 --legal-comments=inline \
  --minify --banner:js="$(<vendor-license.txt)" --outfile=bash-syntax.js
```

This bundle stays private to the direct-push scanner. The main `tsc` build and
the direct smoke-test build both emit it; neither needs to resolve an installed
parser package at runtime.
