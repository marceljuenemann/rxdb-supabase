import process from "process"
import { SupabaseClient, createClient } from "@supabase/supabase-js"
import { beforeAll, describe, expect, it } from "vitest"

import { foobar } from "../index.js";

/**
 * Integration test running against an actual Supabase instance.
 */
describe("Integration test", () => {
  let supabase: SupabaseClient // this.supabase = createClient(environment.supabase.url, environment.supabase.apiKey)

  beforeAll(() => {
    supabase = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_API_KEY!)
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
