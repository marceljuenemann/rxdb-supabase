# rxdb-supabase: Offline Support for Supabase

![NPM](https://img.shields.io/npm/l/rxdb-supabase)
![NPM](https://img.shields.io/npm/v/rxdb-supabase)
![GitHub Workflow Status](https://github.com/marceljuenemann/rxdb-supabase/actions/workflows/rxdb-supabase.yml/badge.svg?branch=main)

[RxDB](https://rxdb.info/) is a client-side, offline-first database that supports various storage layers including IndexedDB. [Supabase](https://supabase.com/) is an open-source Firebase alternative that stores data in a Postgres database with row level security. This library uses RxDB's replication logic to enable a two-way sync of your client-side RxDB database with a remote Supabase table, while allowing you to define custom conflict resolution strategies.

## How it works

RxDB is an **offline-first database**, so all reads and writes are performed against the client-side RxDB database, which gets synced with the corresponding Supabase table in the background. Put another way, it stores a **full copy of the Supabase table locally** (or more specifically, the subset of rows accessible to the user after row-level security is applied). Everything is configured on a per-table basis though, so you could enable offline support for some tables while querying other tables using the SupabaseClient only when online.

Most of the replication and conflict resolution is handled by RxDB's [replication protocol](https://rxdb.info/replication.html). It works similar to git by always pulling all changes from Supabase before merging changes locally and then pushing them to Supabase. When you start the replication (e.g. when the user opens your web app), these three stages are executed in order:

1. **Pull changes from Supabase:** As the Supabase table might have been changed since the last sync on this particular client, we need to fetch all rows that were modified in the meantime. In order for this to be possible with Supabase, some restrictions apply to the table you want to sync:
   - **`_modified` field:** Your table needs a field with the timestamp of the last modification. This is easy to implement in Supabase, see the Getting Started guide below.
   - **`_deleted` field:** You can't actually delete rows from Supabase unless you are sure all clients have replicated the deletion locally. Instead, you need a boolean field that indicates whether the row has been deleted. You won't have to deal with this on the client-side though, as RxDB will handle this for you transparently.
1. **Push changes to Supabase:** Next, we fire INSERT and UPDATE queries to Supabase with all local writes. By default, rows are only updated if they have not changed in the meantime, i.e. all fields of the row need to have the value that they had when the local write was performed. Otherwise, RxDB's conflict handler is invoked, which you can customize to build your own strategy for merging changes.
1. **Watch Supabase changes in realtime:** After the initial sync is complete, we use Supabase's realtime feature to subscribe to any changes of the table. Note that this will miss any changes if the client is offline intermittendly, so you might want to call `reSync()` on the replication object whenever your app comes [back online](https://developer.mozilla.org/en-US/docs/Web/API/Navigator/onLine#listening_for_changes_in_network_status).

## Getting Started

### Install

`npm install rxdb-supabase rxdb @supabase/supabase-js --save`

### Create your RxDB

If you're new to RxDB, read the [Quickstart guide](https://rxdb.info/quickstart.html) for more details.

```typescript
import { createRxDatabase } from "rxdb"
import { getRxStorageDexie } from "rxdb/plugins/storage-dexie"

// Create your database
const myDatabase = await createRxDatabase({
  name: "humans",
  storage: getRxStorageDexie(), // Uses IndexedDB
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
     * implement other strategies, e.g. you might want to still perform an update
     * on a per-field basis as long as that field didn't change.
     */
    // conflictHandler: ...
  },
})
```

Use RxDB's functions for reading and writing the database. For example:

```typescript
const myCollection = myCollections.humans
myCollection.find({}).$.subscribe((documents) => {
  console.log("query has found " + documents.length + " documents")
})

const doc = await myCollection.insert({ id: "1", name: "Alice" })
await doc.patch({ age: 21 })
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

```sql
CREATE TRIGGER update_modified_datetime BEFORE UPDATE ON public.humans FOR EACH ROW
EXECUTE FUNCTION extensions.moddatetime('_modified');
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
  replicationIdentifier: "myId" + SUPABASE_URL, // TODO: Add Supabase user ID?
  pull: {}, // If absent, no data is pulled from Supabase
  push: {}, // If absent, no changes are pushed to Supabase
})
```

That's it, your replication is now running! Any errors can be observed with
`replication.errors$` and you can stop the replication again with `replication.cancel()`.
To ensure you don't miss any changes in Supabase, you might want to listen to the
[network status](https://developer.mozilla.org/en-US/docs/Web/API/Navigator/onLine#listening_for_changes_in_network_status) and call `replication.reSync()` when the
client gets back online.

## Options

These are all the available options, including the options inherited from RxDB.

```typescript
  /**
   * The RxDB collection to replicate.
   */
  collection: RxCollection<RxDocType, any, any, any>

  /**
   * The SupabaseClient to replicate with.
   */
  supabaseClient: SupabaseClient

  /**
   * The table to replicate to, if different from the name of the collection.
   * @default the name of the RxDB collection.
   */
  table?: string

  /**
   * The primary key of the supabase table, if different from the primary key of the RxDB.
   * @default the primary key of the RxDB collection
   */
  primaryKey?: string

  /**
   * Options for pulling data from supabase. Set to {} to pull with the default
   * options, as no data will be pulled if the field is absent.
   */
  pull?: {
    /**
     * Whether to subscribe to realtime Postgres changes for the table. If set to false,
     * only an initial pull will be performed. Only has an effect if the live option is set
     * to true.
     * @default true
     */
    realtimePostgresChanges?: boolean

    /**
     * The name of the supabase field that is automatically updated to the last
     * modified timestamp by postgres. This field is required for the pull sync
     * to work and can easily be implemented with moddatetime in supabase.
     * @default '_modified'
     */
    lastModifiedField?: string

    /**
     * Amount of documents to fetch from Supabase in one request.
     * @default 100
     */
    batchSize?: number

    /**
     * A modifier that runs on all documents that are pulled,
     * before they are used by RxDB.
     */
    modifier?: (docData: any) => Promise<WithDeleted<RxDocType>> | WithDeleted<RxDocType>

    /**
     * If set, the pull replication will start from the given checkpoint.
     */
    initialCheckpoint?: SupabaseReplicationCheckpoint
  }

  /**
   * Options for pushing data to supabase. Set to {} to push with the default
   * options, as no data will be pushed if the field is absent.
   */
  push?: {
    /**
     * Handler for pushing row updates to supabase. Must return true iff the UPDATE was
     * applied to the supabase table. Returning false signalises a write conflict, in
     * which case the current state of the row will be fetched from supabase and passed to
     * the RxDB collection's conflict handler.
     * @default the default handler will update the row only iff all fields match the
     * local state (before the update was applied), otherwise the conflict handler is
     * invoked. The default handler does not support JSON fields at the moment.
     */
    updateHandler?: (row: RxReplicationWriteToMasterRow<RxDocType>) => Promise<boolean>

    /**
     * A modifier that runs on all pushed documents before they are send to Supabase
     */
    modifier?: (docData: WithDeleted<RxDocType>) => Promise<any> | any

    /**
     * If set, the push replication will start from the given checkpoint.
     */
    initialCheckpoint?: SupabaseReplicationCheckpoint
  }

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
  replicationIdentifier: string

  /**
   * The name of the database field to mark a row as deleted.
   * @default '_deleted'
   */
  deletedField?: "_deleted" | string

  /**
   * By default it will do an ongoing realtime replication.
   * By settings live: false the replication will run once until the local state
   * is in sync with the remote state, then it will cancel itself.
   * @default true
   */
  live?: boolean

  /**
   * Time in milliseconds after which a Supabase request will be retried.
   * This time will be skipped if a offline->online switch is detected
   * via `navigator.onLine`
   * @default 5000
   */
  retryTime?: number

  /**
   * If set to `true`, the replication is started automatically. Otherwise you need
   * to call `replication.start()` manually.
   * @default true
   */
  autoStart?: boolean
}
```

## Notes

- **JSON fields require a custom `updateHandler`.** This is because the default update handler tries to check that all fields of a row have the expected value, but the supabase client doesn't currently have a simple way to add an equality check for JSON fields.
- If you delete rows frequently, you might want to enable RxDB's [cleanup plugin](https://rxdb.info/cleanup.html) to clear deleted rows from the local database after they were deleted. There's no recommended way for cleaning up those rows in Supabase yet.

## Future work

While the offline-first paradigm comes with [many advantages](https://rxdb.info/offline-first.html), there are also [downsides](https://rxdb.info/downsides-of-offline-first.html), most notably that the entire table needs to be downloaded to the client. Here are a few ideas for how this project could mitigate that in the future:

- [#4](https://github.com/marceljuenemann/rxdb-supabase/issues/4) Support "partitions", i.e. replicating subsets of the Supabase table, similar to subcollections in FireStore
- [#5](https://github.com/marceljuenemann/rxdb-supabase/issues/5) Add better support for a "push-only" mode
- [#6](https://github.com/marceljuenemann/rxdb-supabase/issues/6) Support using RxDB as a offline cache rather than a offline-first database

## Development

**Build:** `npm run build`

**Unit tests:** `npm run test` or `npm run test:watch`

**Unit test coverage:** `npm run test:coverage` (Not working yet!)

**Integration tests:** We also run integration tests against a real supabase instance:

- Set up a Supabase project and use `src/__tests__humans.sql` to create the table used in tests. It does not use row level security, so that should be disabled for the table.
- It requires the environment variables `TEST_SUPABASE_URL` and `TEST_SUPABASE_API_KEY` (the public API key) to be set
- `npm run integration-test`

**Format code:** `npm run format` (checked as part of the workflow, run for pull requests please :)

**Lint:** `npm run lint` (not passing or required for pull requests yet)

**Spell check:** `npm run spell:check` (not passing or required for pull requests yet)

**Release checklist:**

- Bump version
- Update `CHANGELOG.md`
- Update dependencies (`ncu -u`)
- `npm i`
- Build, test, format
- `npm publish`
- Commit
- Create GitHub release

_TODO: Set up semantic-releases workflow_
