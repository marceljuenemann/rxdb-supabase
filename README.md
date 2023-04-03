# rxdb-supabase: Offline Support for Supabase

![NPM](https://img.shields.io/npm/l/rxdb-supabase)
![NPM](https://img.shields.io/npm/v/rxdb-supabase)
![GitHub Workflow Status](https://github.com/marceljuenemann/rxdb-supabase/actions/workflows/rxdb-supabase.yml/badge.svg?branch=main)

[RxDB](https://rxdb.info/) is a client-side, offline-first database that supports various storage layers including IndexedDB. [Supabase](https://supabase.com/) is an open-source Firebase alternative that stores data in a Postgres database with row level security. This library uses RxDB's replication logic to enables a two-way sync of your client-side RxDB database with a remote Supabase table, while allowing you to define custom conflict resolution strategies.

## How it works

RxDB is an offline-first database, so all reads and writes are performed against the client-side RxDB database, while it's synced with the corresponding Supabase table in the background. Put another way, you have to store a **full copy of the Supabase table locally** (or more specifically, the subset of rows accessible to the user after row-level security is applied). Everything is configured on a per-table basis though, so you could use RxDB for some tables while only allowing other tables to be queried when the user is online.

Most of the replication and conflict resolution is handled by RxDB's [replication protocol](https://rxdb.info/replication.html). It works similar to git by always pulling all changes from Supabase before merging changes locally and then pushing them to Supabase. When you start the replication (e.g. when the user opens your web app), these three stages are executed in order:

1. **Pull changes from Supabase:** As the Supabase table might have been changed since the last sync (e.g. by other clients), we need to fetch all rows that were modified in the meantime. In order for this to be possible with Supabase, some restrictions apply to the table you want to sync:
    * **`_modified` field:** Your table needs a field with the timestamp of the last modification. This is easy to implement in Supabase, see the Getting Started guide below.
    * **`_deleted` field:** You can't actually delete rows from Supabase unless you are sure all clients have replicated the deletion locally. Instead, you need a boolean field that indicates whether the row has been deleted. You won't have to deal with this on the client-side though, as RxDB will handle this for you transparently.  
1. **Push changes to Supabase:** Next, we fire INSERT and UPDATE queries to Supabase with all local writes. By default, rows are only updated if they have not changed in the meantime. If they did change, RxDB's conflict handler is invoked, which you can customize to build your own strategy for merging changes.
1. **Watch Supabase changes in realtime:** After the initial sync is complete, we use Supabase's realtime feature to subscribe to any changes of the table. Note that this will miss any changes if the client is offline intermittendly, so you might want to call `reSync()` on the replication object when your app comes back online.





* Getting started
* Limitations
  * Offline-first 
  * _modified and _deleted
  * Link to ideas
* Custom conflict resolution
* Options
* Development 





To run integration tests, set enviornment variables TEST_SUPABASE_URL and TEST_SUPABASE_API_KEY

Call resync when online again?

# Typescript Library Starter

![NPM](https://img.shields.io/npm/l/@gjuchault/typescript-library-starter)
![NPM](https://img.shields.io/npm/v/@gjuchault/typescript-library-starter)
![GitHub Workflow Status](https://github.com/gjuchault/typescript-library-starter/actions/workflows/typescript-library-starter.yml/badge.svg?branch=main)

Yet another (opinionated) typescript library starter template.

## Opinions and limitations

1. Relies as much as possible on each included library's defaults
2. Only rely on GitHub Actions
3. Do not include documentation generation

## Getting started

1. `npx degit gjuchault/typescript-library-starter my-project` or click on `Use this template` button on GitHub!
2. `cd my-project`
3. `npm install`
4. `git init` (if you used degit)
5. `npm run setup`

To enable deployment, you will need to:

1. Setup `NPM_TOKEN` secret in GitHub actions ([Settings > Secrets > Actions](https://github.com/gjuchault/typescript-service-starter/settings/secrets/actions))
2. Give `GITHUB_TOKEN` write permissions for GitHub releases ([Settings > Actions > General](https://github.com/gjuchault/typescript-service-starter/settings/actions) > Workflow permissions)

## Features

### Node.js, npm version

Typescript Library Starter relies on [volta](https://volta.sh/) to ensure node version to be consistent across developers. It's also used in the GitHub workflow file.

### Typescript

Leverages [esbuild](https://github.com/evanw/esbuild) for blazing fast builds, but keeps `tsc` to generate `.d.ts` files.
Generates a single ESM build.

Commands:

- `build`: runs typechecking then ESM and `d.ts` files in the `build/` directory
- `clean`: removes the `build/` directory
- `type:dts`: only generates `d.ts`
- `type:check`: only run typechecking
- `type:build`: only generates ESM

### Tests

typescript-library-starter uses [vitest](https://vitest.dev/). The coverage is done through vitest, using [c8](https://github.com/bcoe/c8).

Commands:

- `test`: runs vitest test runner
- `test:watch`: runs vitest test runner in watch mode
- `test:coverage`: runs vitest test runner and generates coverage reports

### Format & lint

This template relies on the combination of [eslint](https://github.com/eslint/eslint) — through [typescript-eslint](https://github.com/typescript-eslint/typescript-eslint) for linting and [prettier](https://github.com/prettier/prettier) for formatting.
It also uses [cspell](https://github.com/streetsidesoftware/cspell) to ensure spelling

Commands:

- `format`: runs prettier with automatic fixing
- `format:check`: runs prettier without automatic fixing (used in CI)
- `lint`: runs eslint with automatic fixing
- `lint:check`: runs eslint without automatic fixing (used in CI)
- `spell:check`: runs spellchecking

### Releasing

Under the hood, this library uses [semantic-release](https://github.com/semantic-release/semantic-release) and [commitizen](https://github.com/commitizen/cz-cli).
The goal is to avoid manual release process. Using `semantic-release` will automatically create a github release (hence tags) as well as an npm release.
Based on your commit history, `semantic-release` will automatically create a patch, feature or breaking release.

Commands:

- `cz`: interactive CLI that helps you generate a proper git commit message, using [commitizen](https://github.com/commitizen/cz-cli)
- `semantic-release`: triggers a release (used in CI)
