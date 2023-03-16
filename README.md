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
