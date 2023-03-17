import process from "process"
import { SupabaseClient, createClient } from "@supabase/supabase-js"
import { afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest"

import { createRxDatabase, RxCollection, RxDatabase, WithDeleted } from "rxdb";
import { getRxStorageMemory } from "rxdb/plugins/storage-memory";
import { Human, HUMAN_SCHEMA } from "./test-types.js";
import { replicateSupabase, SupabaseCheckpoint, SupabaseReplicationOptions } from "../index.js";
import { RxReplicationState } from "rxdb/plugins/replication";
import { addRxPlugin } from 'rxdb';
import { RxDBDevModePlugin } from 'rxdb/plugins/dev-mode';

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
    addRxPlugin(RxDBDevModePlugin);
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

    expect(await rxdbContents()).toEqual([])
    expect(await supabaseContents()).toEqual([])
  })

  describe("on client-side insertion", () => {
    it("inserts into supabase", async () => {
      let replication = startReplication()

      await collection.insert({id: '1', name: 'Alice'})
      await replication.awaitInSync()
      replication.cancel()

      expect(await supabaseContents()).toEqual([{id: '1', name: 'Alice', age: null, '_deleted': false}])
    });
    
    // TODO: test duplicate key error (should invoke conflict handler)
    // TODO: test other error
    // TODO: Do I want all those tests against live DB? I guess not really, no, but some.
  });

  describe("when supabase changed while offline", () => {
    it("pulls new rows", async () => {
      // TODO: prepareDatabase. Or maybe into beforeEach?
      let replication = startReplication()
      await collection.insert({id: '1', name: 'Alice'})
      await replication.awaitInSync()
      await replication.cancel()

      await supabase.from('humans').insert({id: '2', name: 'Bob', age: 42})

      replication = startReplication()
      await replication.awaitInSync()
      
      expect(await rxdbContents()).toEqual([
        {id: '1', name: 'Alice'},
        {id: '2', name: 'Bob', age: 42}
      ])
    });
    
    // TODO: test duplicate key error (should invoke conflict handler)
    // TODO: test other error
    // TODO: Do I want all those tests against live DB? I guess not really, no, but some.
  });




  let startReplication = (options: Partial<SupabaseReplicationOptions<Human>> = {}): RxReplicationState<Human, SupabaseCheckpoint> => {
    let status = replicateSupabase({
      supabaseClient: supabase,
      collection,
      waitForLeadership: false,  // TODO: true doesn't work yet? Probably don't include field, should use SharedWorker anyways
      autoStart: true,
      pull: {},
      push: {},
      ...options
    })
    return status
  }

  let supabaseContents = async (stripModified: boolean = true): Promise<WithDeleted<Human>[]> => {
    // TODO: Remove the serverTimestamp field?
    const { data, error } = await supabase.from('humans').select().order('id')
    if (error) throw error
    if (stripModified) data.forEach(human => delete human['_modified'])
    return data as WithDeleted<Human>[]
  }

  let rxdbContents = async (): Promise<Human[]> => {
    const results = await collection.find().exec()
    return results.map(doc => doc.toJSON())
  }

  afterEach(async () => {
    await db.remove()
  })
});
