import process from "process"
import { SupabaseClient, createClient } from "@supabase/supabase-js"
import { afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest"

import { createRxDatabase, RxCollection, RxDatabase } from "rxdb";
import { getRxStorageMemory } from "rxdb/plugins/storage-memory";
import { Human, HUMAN_SCHEMA } from "./test-types.js";
import { replicateSupabase, SupabaseCheckpoint, SupabaseReplicationOptions } from "../index.js";
import { RxReplicationState } from "rxdb/plugins/replication";

/**
 * Integration test running against an actual Supabase instance.
 */
// TODO: export schema into .sql file
describe("replicateSupabase with actual SupabaseClient", () => {
  let supabase: SupabaseClient 
  let db: RxDatabase
  let collection: RxCollection<Human>

  beforeAll(() => {
    supabase = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_API_KEY!)
  })

  beforeEach(async () => {
    // Empty the supabase table.
    const { error } = await supabase.from('humans').delete().neq('id', -1)
    if (error) throw error

    // Create an in-memory RxDB database.
    db = await createRxDatabase({name: 'test', storage: getRxStorageMemory()});
    collection = (await db.addCollections({
      humans: { schema: HUMAN_SCHEMA },
    }))['humans']
  })

  describe("on client-side insertion", () => {
    it("inserts into supabase", async () => {
      let replication = startReplication({pull: {}, push: {}})

      collection.insert({id: '1', name: 'Alice'})
      await replication.awaitInSync()

      expect(await supabaseContents()).toEqual([{id: '1', name: 'Alice', age: null, '_deleted': false}])
    });
    
    // TODO: test duplicate key error (should invoke conflict handler)
    // TODO: test other error
    // TODO: Do I want all those tests against live DB? I guess not really, no, but some.
  });

  let startReplication = (options: Partial<SupabaseReplicationOptions<Human>>): RxReplicationState<Human, SupabaseCheckpoint> => {
    let status = replicateSupabase({
      supabaseClient: supabase,
      collection,
      waitForLeadership: false,  // TODO: true doesn't work yet?
      autoStart: true,
      ...options
    })
    return status
  }

  let supabaseContents = async (): Promise<Human[]> => {
    const { data, error } = await supabase.from('humans').select().order('id')
    if (error) throw error
    return data as Human[]
  }

  afterEach(() => {
    try {
      db.destroy()
    } catch (e) {
      // Test did not insert anything into the database
    }
  })
});
