import { addRxPlugin, createRxDatabase, RxCollection, RxConflictHandler, RxConflictHandlerInput, RxDatabase } from "rxdb";
import { RxDBDevModePlugin } from "rxdb/plugins/dev-mode";
import { RxReplicationState } from "rxdb/plugins/replication";
import { getRxStorageMemory } from "rxdb/plugins/storage-memory";
import { afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { replicateSupabase, SupabaseReplicationOptions } from "../index.js";
import { Human, HUMAN_SCHEMA } from "./test-types.js";
import { SupabaseBackendMock } from "./supabase-backend-mock.js";

describe.only("replicateSupabase", () => {
  let supabaseMock: SupabaseBackendMock
  let db: RxDatabase
  let collection: RxCollection<Human>

  beforeAll(() => {
    addRxPlugin(RxDBDevModePlugin);
  })

  beforeEach(async () => {
    // Create an in-memory RxDB database.
    db = await createRxDatabase({name: 'test', storage: getRxStorageMemory()});
    collection = (await db.addCollections({
      humans: { schema: HUMAN_SCHEMA },
    }))['humans']

    // Supabase client with mocked HTTP.
    supabaseMock = new SupabaseBackendMock()

    // Start with Alice?
    /*
    await replication({}, async() => {
      // TODO: remove explicit null, should be set by pull anyways
      await collection.insert({id: '1', name: 'Alice', age: null})
    })

    expect(await rxdbContents()).toEqual([{id: '1', name: 'Alice', age: null}])
    expect(await supabaseContents()).toEqual([{id: '1', name: 'Alice', age: null, '_deleted': false}])
    */
  })

  describe("initial replication", () => {
    it("pulls rows from supabase", async () => {
      /*
      let from = mock(PostgrestQueryBuilder)
      when(supabase.from('humans')).thenReturn(from)
      when(query.select()).thenReturn(query)
      
      let select = mock()

      */

      supabaseMock.expectQuery('humans', 'select=*&order=_modified.asc%2Cid.asc&limit=100').thenReturn([])

      let replication = startReplication({push: undefined})
      
      await replication.awaitInSync()

    })
  })

  describe("on client-side insertion", () => {
    describe("without conflict", () => {
      it("inserts into supabase", async () => {
        /*
        await replication({}, async() => {
          await collection.insert({id: '2', name: 'Bob', age: null})
        })

        expect(await supabaseContents()).toEqual([
          {id: '1', name: 'Alice', age: null, '_deleted': false},
          {id: '2', name: 'Bob', age: null, '_deleted': false}
        ])
        */
      })
    })
  })


  let startReplication = (options: Partial<SupabaseReplicationOptions<Human>> = {}): RxReplicationState<Human, SupabaseReplicationCheckpoint> => {
    let status = replicateSupabase({
      replicationIdentifier: 'test',
      supabaseClient: supabaseMock.client,
      collection,
      pull: {},
      push: {},
      ...options
    })
    // TODO: Add unit tests for errors thrown by supabse
    status.error$.subscribe(error => {
      console.error(error)
    })
    return status
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
    await db.remove()
  })  
})
