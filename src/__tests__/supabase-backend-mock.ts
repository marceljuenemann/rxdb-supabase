import { SupabaseClient } from "@supabase/supabase-js"
import { expect, vi } from "vitest"
import { Response, RequestInfo, RequestInit } from "node-fetch"

type RequestCheck = (input: URL | RequestInfo, options?: RequestInit | undefined) => void

interface ExpectedFetch {
  name: string,
  requestCheck: RequestCheck,
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

  expectFetch(name: string, requestCheck: RequestCheck) {
    return {
      thenReturn: (body: any = {}) => {
        const response = new Response(JSON.stringify(body), {status: 200, statusText: "OK"})
        this.expectedFetches.push({name, requestCheck, response: Promise.resolve(response)})
      }
    }
  }

  expectQuery(name: string, expected: {table: string, params?: string, method?: string, body?: string}) {
    let expectedUrl = `${this.url}rest/v1/${expected.table}`
    if (expected.params) expectedUrl += `?${expected.params}`
    return this.expectFetch(name, (input: URL | RequestInfo, options?: RequestInit | undefined) => {
      expect(input.toString()).toEqual(expectedUrl)
      expect(options?.method).toEqual(expected.method || 'GET')
      expect(options?.body).toEqual(expected.body)
    })
  }

  expectInsert(table: string, body: string) {
    return this.expectQuery(`INSERT to ${table}: ${body}`, {
      table, method: 'POST', body
    })
  }

  verifyNoMoreQueriesExpected() {
    console.log("afterEach remaining:", this.expectedFetches)
    expect(this.expectedFetches.map(exp => exp.name), 'Expected more Supabase calls').toEqual([])
  }

  private fetch(input: URL | RequestInfo, options?: RequestInit | undefined): Promise<Response> {
    expect(this.expectedFetches, `Did not expect any requests. Got ${options?.method} ${input}`).not.toHaveLength(0)
    const expected = this.expectedFetches[0]
    this.expectedFetches = this.expectedFetches.slice(1)
    expected.requestCheck(input, options)
    return expected.response
  }
}
