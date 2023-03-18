import { addRxPlugin, createRxDatabase, RxCollection, RxConflictHandler, RxConflictHandlerInput, RxDatabase, RxError, WithDeleted } from "rxdb";
import { RxDBDevModePlugin } from "rxdb/plugins/dev-mode";
import { RxReplicationState } from "rxdb/plugins/replication";
import { getRxStorageMemory } from "rxdb/plugins/storage-memory";
import { afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { replicateSupabase, SupabaseReplicationCheckpoint, SupabaseReplicationOptions } from "../index.js";
import { Human, HumanRow, HUMAN_SCHEMA } from "./test-types.js";
import { SupabaseBackendMock } from "./supabase-backend-mock.js";
import { BehaviorSubject } from "rxjs";

describe.only("replicateSupabase", () => {
  let supabaseMock: SupabaseBackendMock
  let db: RxDatabase
  let collection: RxCollection<Human>

  beforeAll(() => {
    addRxPlugin(RxDBDevModePlugin);
  })

  beforeEach(async () => {
    // Create an in-memory RxDB database.
    db = await createRxDatabase({name: 'test', storage: getRxStorageMemory(), ignoreDuplicate: true});
    collection = (await db.addCollections({
      humans: { schema: HUMAN_SCHEMA },
    }))['humans']

    // Supabase client with mocked HTTP.
    supabaseMock = new SupabaseBackendMock()

    // Start with Alice in the database.
    /*
    await collection.insert({id: '1', name: 'Alice', age: null})
    expectInitialPull().thenReturn([])
    expectInsert('{"id":"1","name":"Alice","age":null,"_deleted":false}').thenReturn()
    await replication()
    */
  })

  describe("initial pull", () => {
    describe("without initial checkpoint", () => {
      it("pulls all rows from supabase", async () => {
        expectPull().thenReturn(createHumans(1))
        await replication()

        expect(await rxdbContents()).toEqual([
          {id: '1', name: 'Human 1', age: 11}
        ])
      })
    })

    describe("with previous checkpoint", () => {
      it("pulls only modified rows", async () => {
        let checkpoint: SupabaseReplicationCheckpoint = {
          modified: 'timestamp',
          primaryKeyValue: 'pkv'
        }
        expectPull(checkpoint).thenReturn(createHumans(1))
        await replication({pull: {initialCheckpoint: checkpoint}})

        expect(await rxdbContents()).toEqual([
          {id: '1', name: 'Human 1', age: 11}
        ])  
      })
    })

    describe("with zero rows", () => {
      it("pulls no rows", async () => {
        expectPull().thenReturn([])
        await replication()

        expect(await rxdbContents()).toEqual([])  
      })
    })

    describe("with many rows", () => {
      it("pulls in batches", async () => {
        const expectedCheckpoint = (id: number): SupabaseReplicationCheckpoint => {
          return {
            modified: createHuman(id)._modified,
            primaryKeyValue: createHuman(id).id
          }
        } 

        // Expect three queries
        const BATCH_SIZE = 13
        const humans = createHumans(BATCH_SIZE * 2 + 1)
        expectPull(undefined, BATCH_SIZE).thenReturn(humans.slice(0, BATCH_SIZE))
        expectPull(expectedCheckpoint(BATCH_SIZE), BATCH_SIZE).thenReturn(humans.slice(BATCH_SIZE, BATCH_SIZE * 2))
        expectPull(expectedCheckpoint(BATCH_SIZE * 2), BATCH_SIZE).thenReturn(humans.slice(BATCH_SIZE * 2))

        await replication({pull: {batchSize: BATCH_SIZE}})

        expect(await rxdbContents()).toHaveLength(BATCH_SIZE * 2 + 1)
      })
    })

    describe("with query failing", () => {
      it.skip("retries automatically", async () => {
      })
    })

    describe("with deletion", () => {
      it.skip("deletes row locally", async () => {
      })
    })

    describe("with deletion and custom _delete field name", () => {
      it.skip("deletes row locally", async () => {
      })
    })
  })


  /*
  TODO
  - with client-side insertion
    - single
    - multiple
    - conflict handler
    - query error
    - custom field name
  - with client-side update
    - checks for equalty
    - throws on JSON types
    - invokes conflict handler
    - uses custom updateHandler
    - query error
  - with client-side delete
    - updates field
    - updates custom field
  - with live pull
    - ...

  */


  /**
   * Run the given transactions while a replication is running.
   */
  // TODO: Move this into utility and 
  let replication = (options: Partial<SupabaseReplicationOptions<Human>> = {}, 
                    transactions: (state: RxReplicationState<Human, SupabaseReplicationCheckpoint>) => Promise<void> = async() => {}):
                    Promise<void> => {
    const state = startReplication(options)
    return rejectOnReplicationError(state, async () => {
      await state.awaitInitialReplication()
      await transactions(state)
      await state.awaitInSync()
      await state.cancel()
    })
    // TODO: Add unit tests for errors cases
  }

  let startReplication = (options: Partial<SupabaseReplicationOptions<Human>> = {}): RxReplicationState<Human, SupabaseReplicationCheckpoint> => {
    return replicateSupabase({
      replicationIdentifier: 'test',
      supabaseClient: supabaseMock.client,
      collection,
      pull: {},
      push: {},
      ...options
    })
  }

  /**
   * Runs the given callback, but rejects the returned Promise early in case there are any errors.
   */
  let rejectOnReplicationError = function <T>(state: RxReplicationState<Human, SupabaseReplicationCheckpoint>, callback: () => Promise<T>): Promise<T> {
    return new Promise((resolve, reject) => {
      state.error$.subscribe(error => {
        console.error("Replication emitted an error:", error)
        reject(error.rxdb ? error.parameters.errors![0] : error)
      })
      callback().then(
        result => resolve(result),
        error => reject(error)
      )
    })
  }

  let expectPull = (checkpoint?: SupabaseReplicationCheckpoint, limit: number = 100, primaryKey: string = '', modifiedField: string = '_modified') => {
    // TODO: should be allowing for equal timestamp and have inequality for primary key.
    const filter = checkpoint ? `&${modifiedField}=gt.${checkpoint.modified}` : ''
    return supabaseMock.expectQuery(`Pull query with checkpoint ${checkpoint?.modified}`, {
      table: 'humans', 
      params: `select=*${filter}&order=_modified.asc%2Cid.asc&limit=${limit}`
    })
  }

  let expectInsert = (body: string) => {
    return supabaseMock.expectInsert('humans', body)
  }

  let resolveConflictWithName = <T>(name: string): RxConflictHandler<T> => {
    return async (input: RxConflictHandlerInput<T>) => {
      return {
        isEqual: false,
        documentData: {...input.newDocumentState, name}
      }
    }
  }

  let rxdbContents = async (): Promise<Human[]> => {
    const results = await collection.find().exec()
    return results.map(doc => doc.toJSON())
  }

  let createHumans = (count: number) => {
    return Array.from(Array(count).keys()).map(id => createHuman(id + 1))
  }

  let createHuman = (id: number): HumanRow => {
    return {
      id: id.toString(),
      name: `Human ${id}`,
      age: id % 2 == 0 ? null : id * 11,
      _deleted: false,
      _modified: '2023-' + id
    }
  }

  afterEach(async () => {
    supabaseMock.verifyNoMoreQueriesExpected()
    await db.remove()
  })  
})
