# Pinned scraper source

`israeli-bank-scrapers/` is based on the tracked source files from:

- Repository: https://github.com/int21asm/israeli-bank-scrapers
- Commit: `5170a65ffaf8df2d22f32b0fa1656350a8337590`
- Upstream project: https://github.com/eshaham/israeli-bank-scrapers
- License: MIT, reproduced in `israeli-bank-scrapers/LICENSE`

The source is included so a GitHub ZIP or a single clone can run this web app
without access to the original cloud workspace. Generated `lib/`, dependencies,
Git metadata, local test configuration, and credentials are not included.

Build it with `npm ci` and `npm run build` inside the vendor directory before
installing the web app. The launcher `start-demo.mjs` performs those steps.

To update the scraper, deliberately refresh this pinned source and its lockfile,
record the new origin commit here, and revalidate the integration. Do not run
the library's `prepare:core`, `prepare:default`, or `reset` scripts as setup;
they contain Git reset operations. Use its ordinary install and build commands.

The web adapter adds a Mizrahi balance fallback in `server/mizrahi-balance.js`.
It wraps this pinned version's `fetchAccount` and `getPendingTransactions` methods
to read the current-account header or latest ledger balance before navigation.
The vendored source also removes credentials, authorization headers, and response
bodies from POST parse-error messages in `src/helpers/fetch.ts`. Verify this
hardening and the Mizrahi method contracts when updating the pinned library.
