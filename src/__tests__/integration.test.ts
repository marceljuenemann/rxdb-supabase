import process from "process"
import { SupabaseClient, createClient } from "@supabase/supabase-js"
import { beforeAll, beforeEach, describe, expect, it } from "vitest"

import { foobar } from "../index.js";
import { createRxDatabase, RxCollection, RxDatabase } from "rxdb";
import { getRxStorageMemory } from "rxdb/plugins/storage-memory";
import { Human, HUMAN_SCHEMA } from "./test-types.js";
import { afterEach } from "node:test";

/**
 * Integration test running against an actual Supabase instance.
 */
describe("Integration test", () => {
  let supabase: SupabaseClient 
  let db: RxDatabase
  let collection: RxCollection<Human>

  beforeAll(() => {
    supabase = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_API_KEY!)
  })

  beforeEach(async () => {
    // Empty the supabase table.
    const { error } = await supabase.from('humans').delete().neq('passportId', -1)
    if (error) throw error

    // Create an in-memory RxDB database.
    db = await createRxDatabase({name: 'test', storage: getRxStorageMemory()});
    collection = (await db.addCollections({
      humans: { schema: HUMAN_SCHEMA },
    }))['humans']
  })

  afterEach(() => {
    db.destroy()
  })


  describe("given two positive integers", () => {
    const first = 1;
    const second = 2;

    describe("when called", () => {
      it("returns the sum of them multiplied by 3", () => {
        expect(foobar(first, second)).toEqual(9);
      });
    });
  });

});
