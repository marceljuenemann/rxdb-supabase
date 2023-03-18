import { SupabaseClient } from "@supabase/supabase-js"
import { expect, vi } from "vitest"
import { Response, RequestInfo, RequestInit } from "node-fetch"

interface ExpectedFetch {
  url: string,
  response: Promise<Response>
}

/**
 * Runs a real SuperbaseClient against a mock backend by using a custom fetch implementation.
 */
export class SupabaseBackendMock {
  readonly url = 'http://example.com/'
  readonly key = 'ABCDEF'
  readonly client: SupabaseClient

  private expectedFetches: ExpectedFetch[] = []

  constructor(options: any = {}) {
    this.client = new SupabaseClient(this.url, this.key, {...options, global: {
      fetch: this.fetch.bind(this) 
    }})
  }

  ///humans?select=*&order=_modified.asc%2Cid.asc&limit=100
  expectQuery(table: string, searchParams: string) {
    console.error("Adding", searchParams)
    const url = `${this.url}rest/v1/${table}?${searchParams}`
    return {
      thenReturn: (body: any) => {
        const response = new Response(JSON.stringify(body), {status: 200, statusText: "OK"})
        this.expectedFetches.push({url, response: Promise.resolve(response)})
      }
    }
  }

  verifyNoMoreQueriesExpected() {
    console.log("afterEach remaining:", this.expectedFetches)
    expect(this.expectedFetches, 'Expected more Supabase calls').toEqual([])
  }

  private fetch(url: URL | RequestInfo, options?: RequestInit | undefined): Promise<Response> {
    expect(this.expectedFetches, `Did not expect any requests. Got ${url}`).not.toHaveLength(0)
    const expected = this.expectedFetches[0]
    this.expectedFetches = this.expectedFetches.slice(1)
    console.log("remaining:", this.expectedFetches)

    expect(url.toString()).toEqual(expected.url)
    return expected.response
  }
}
