import { addRxPlugin, createRxDatabase, RxCollection, RxConflictHandler, RxConflictHandlerInput, RxDatabase, RxError } from "rxdb";
import { RxDBDevModePlugin } from "rxdb/plugins/dev-mode";
import { RxReplicationState } from "rxdb/plugins/replication";
import { getRxStorageMemory } from "rxdb/plugins/storage-memory";
import { afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { replicateSupabase, SupabaseReplicationCheckpoint, SupabaseReplicationOptions } from "../index.js";
import { Human, HUMAN_SCHEMA } from "./test-types.js";
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
    await collection.insert({id: '1', name: 'Alice', age: null})
    expectInitialPull().thenReturn([])
    expectInsert('{"id":"1","name":"Alice","age":null,"_deleted":false}').thenReturn()
    await replication()
  })

  describe("initial replication", () => {
    it("pulls rows from supabase", async () => {
      /*
      let from = mock(PostgrestQueryBuilder)
      when(supabase.from('humans')).thenReturn(from)
      when(query.select()).thenReturn(query)
      
      let select = mock()

      */
/*
      expectInitialPull().thenReturn([])
      await replication({}, async state => {
        console.log("hi!")
      })

  */    
    })
  })

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

  let expectInitialPull = () => {
    return supabaseMock.expectQuery('Initial pull', {
      table: 'humans', 
      params: 'select=*&order=_modified.asc%2Cid.asc&limit=100'}
    )
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

  afterEach(async () => {
    supabaseMock.verifyNoMoreQueriesExpected()
    await db.remove()
  })  
})
