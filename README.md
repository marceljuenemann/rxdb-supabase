# rxdb-supabase: Offline Support for Supabase

![NPM](https://img.shields.io/npm/l/rxdb-supabase)
![NPM](https://img.shields.io/npm/v/rxdb-supabase)
![GitHub Workflow Status](https://github.com/marceljuenemann/rxdb-supabase/actions/workflows/rxdb-supabase.yml/badge.svg?branch=main)

[RxDB](https://rxdb.info/) is a client-side, offline-first database that supports various storage layers including IndexedDB. [Supabase](https://supabase.com/) is an open-source Firebase alternative that stores data in a Postgres database with row level security. This library uses RxDB's replication logic to enables a two-way sync of your client-side RxDB database with a remote Supabase table, while allowing you to define custom conflict resolution strategies.


## How it works

RxDB is an offline-first database, so all reads and writes are performed against the client-side RxDB database, while it's synced with the corresponding Supabase table in the background. Put another way, you have to store a **full copy of the Supabase table locally** (or more specifically, the subset of rows accessible to the user after row-level security is applied). Everything is configured on a per-table basis though, so you could use RxDB for some tables while only allowing other tables to be queried when the user is online.

Most of the replication and conflict resolution is handled by RxDB's [replication protocol](https://rxdb.info/replication.html). It works similar to git by always pulling all changes from Supabase before merging changes locally and then pushing them to Supabase. When you start the replication (e.g. when the user opens your web app), these three stages are executed in order:

1. **Pull changes from Supabase:** As the Supabase table might have been changed since the last sync on this particular client, we need to fetch all rows that were modified in the meantime. In order for this to be possible with Supabase, some restrictions apply to the table you want to sync:
    * **`_modified` field:** Your table needs a field with the timestamp of the last modification. This is easy to implement in Supabase, see the Getting Started guide below.
    * **`_deleted` field:** You can't actually delete rows from Supabase unless you are sure all clients have replicated the deletion locally. Instead, you need a boolean field that indicates whether the row has been deleted. You won't have to deal with this on the client-side though, as RxDB will handle this for you transparently.  
1. **Push changes to Supabase:** Next, we fire INSERT and UPDATE queries to Supabase with all local writes. By default, rows are only updated if they have not changed in the meantime, i.e. all fields of the row need to have the value that they had when the local write was performed. Otherwise, RxDB's conflict handler is invoked, which you can customize to build your own strategy for merging changes.
1. **Watch Supabase changes in realtime:** After the initial sync is complete, we use Supabase's realtime feature to subscribe to any changes of the table. Note that this will miss any changes if the client is offline intermittendly, so you might want to call `reSync()` on the replication object whenever your app comes back online.


## Getting Started

### Install

`npm install rxdb-supabase rxdb @supabase/supabase-js --save`

### Create your RxDB

If you're new to RxDB, read the [Quickstart guide](https://rxdb.info/quickstart.html) for more details.

```typescript
import { createRxDatabase } from 'rxdb';
import { getRxStorageDexie } from 'rxdb/plugins/storage-dexie';

// Create your database
const myDatabase = await createRxDatabase({
  name: 'humans',
  storage: getRxStorageDexie()  // Uses IndexedDB
})

// Create a collection matching your Supabase table structure.
const mySchema = {
  title: "human schema",
  version: 0,
  primaryKey: "id",
  type: "object",
  properties: {
    id: {
      type: "string",
      maxLength: 100,
    },
    name: {
      type: "string",
    },
    age: {
      description: "age in years",
      type: "integer",
    },
  },
  required: ["id", "name", "age"],
  indexes: ["age"],
}
const myCollections = await db.addCollections({
  humans: { 
    schema: mySchema,
    /**
     * Whenever we attempt to replicate a local write to a row that was changed in
     * Supabase in the meantime (e.g. by another client), the conflict handler is
     * invoked. By default, RxDB will dismiss the local write and update the local
     * state to match the state in Supabase. With a custom conflict handler you can
     * implement other strategies, e.g. still perform an update to a single field if
     * that field didn't change in Supabase in the meantime.
     */
    // conflictHandler: ...
  },
})
```

Use RxDB's functions for reading and writing the database. For example:

```typescript
const myCollection = myCollections.humans
myCollection.find({}).$.subscribe(documents => {
  console.log('query has found ' + documents.length + ' documents');
});

const doc = await myCollection.insert({id: "1", name: "Alice"})
await doc.patch({age: 21})
await doc.remove()
```

### Create your Supabase table

As stated above, your table needs a `_modified` timestamp and a `_deleted` field in order
for the replication to be able to detect which rows changed in Supabase. You can configure a different name for these fields with the `lastModifiedField` and `deletedField` options.

```sql
CREATE TABLE public.humans (
    id text NOT NULL,
    name text NOT NULL,
    age smallint,
    _deleted boolean DEFAULT false NOT NULL,
    _modified timestamp with time zone DEFAULT now() NOT NULL
);
ALTER TABLE ONLY public.humans ADD CONSTRAINT humans_pkey PRIMARY KEY (id);
```

Create a trigger that keeps the `_modified` field updated:

```
CREATE TRIGGER update_modified_datetime BEFORE UPDATE ON public.humans FOR EACH ROW EXECUTE FUNCTION extensions.moddatetime('_modified');
```

### Start the Replication

Make sure you've [initialized your SupabaseClient](https://supabase.com/docs/reference/javascript/initializing) and, if you're using row level security, that the client is authenticated.

```typescript
const replication = new SupabaseReplication({
  supabaseClient: supabaseClient,
  collection: myCollection,
  /**
   * An ID for the replication, so that RxDB is able to resume the replication
   * on app reload. It is recommended to add the supabase URL to make sure you're
   * not mixing up replications against different databases.
   * 
   * If you're using row-level security, you might also want to append the user ID
   * in case the logged in user changes, although depending on your application you
   * might want to re-create the entire RxDB from scratch in that case or have one
   * RxDB per user ID (you could add the user ID to the RxDB name).
   */
  replicationIdentifier: "myId" + SUPABASE_URL,  // TODO: Add Supabase user ID?
  pull: {},  // If absent, no data is pulled from Supabase
  push: {},  // If absent, no changes are pushed to Supabase 
})
```

That's it, your replication is now running! Any errors can be observed with
`replication.errors$` and you can stop the replication again with `replication.cancel()`.
To ensure you don't miss any changes in Supabase, you might want to listen to the
[network status](https://developer.mozilla.org/en-US/docs/Web/API/Navigator/onLine#listening_for_changes_in_network_status) and call `replication.reSync()` when the
client gets back online.


* Options
* Notes
* Limitations
  * Offline-first 
  * _modified and _deleted
  * Link to ideas
* Development 

Notes:
* JSON fields not supported, need to write your own updateHandler
* Replication ID and the problem around auth / user changes (maybe not really a problem)
* _modified column (if pull is used)
* _deleted column
  * Refer to cleanup plugin
  * TODO: allow to set to null for push-only mode, in which case we don't store it
* Only use null collections :)

To run integration tests, set enviornment variables TEST_SUPABASE_URL and TEST_SUPABASE_API_KEY


## Features


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
