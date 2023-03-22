import {
  RealtimeChannel,
  RealtimeClient,
  RealtimePostgresChangesFilter,
  RealtimePostgresChangesPayload,
  SupabaseClient,
} from "@supabase/supabase-js";
import { expect, vi } from "vitest";
import { Response, RequestInfo, RequestInit } from "node-fetch";
import {
  anyFunction,
  anyString,
  anything,
  instance,
  mock,
  verify,
  when,
} from "ts-mockito";

type RequestCheck = (
  input: URL | RequestInfo,
  options?: RequestInit | undefined
) => void;

interface ExpectedFetch {
  name: string;
  requestCheck: RequestCheck;
  response: Promise<Response>;
}

/**
 * Runs a real SuperbaseClient against a mock backend by using a custom fetch implementation.
 * Any calls to the RealtimeClient will be mocked as well.
 */
// TODO: Use fetch-mock package
export class SupabaseBackendMock {
  readonly url = "http://example.com/";
  readonly key = "ABCDEF";
  readonly client: SupabaseClient;

  private expectedFetches: ExpectedFetch[] = [];
  private realtimeClientMock = mock(RealtimeClient);

  constructor(options: any = {}) {
    this.client = new SupabaseClient(this.url, this.key, {
      ...options,
      global: {
        fetch: this.fetch.bind(this),
      },
    });
    let hackedClient = this.client as any;
    hackedClient["realtime"] = instance(this.realtimeClientMock);
  }

  expectFetch(name: string, requestCheck: RequestCheck) {
    return {
      thenReturn: (body: any = {}, headers: Record<string, string> = {}) => {
        const response = new Response(JSON.stringify(body), {
          status: 200,
          statusText: "OK",
          headers,
        });
        this.expectedFetches.push({
          name,
          requestCheck,
          response: Promise.resolve(response),
        });
      },
      thenReturnError: (
        errorCode: string,
        httpCode: number = 409,
        message: string = "Test error message"
      ) => {
        const response = new Response(
          JSON.stringify({ code: errorCode, message }),
          { status: httpCode, statusText: "ERROR" }
        );
        this.expectedFetches.push({
          name,
          requestCheck,
          response: Promise.resolve(response),
        });
      },
      thenFail: (error: any = {}) => {
        this.expectedFetches.push({
          name,
          requestCheck,
          response: Promise.reject(error),
        });
      },
    };
  }

  expectQuery(
    name: string,
    expected: { table: string; params?: string; method?: string; body?: string }
  ) {
    let expectedUrl = `${this.url}rest/v1/${expected.table}`;
    if (expected.params) expectedUrl += `?${expected.params}`;
    return this.expectFetch(
      name,
      (input: URL | RequestInfo, options?: RequestInit | undefined) => {
        // Set custom message to prevent output being truncated
        expect(options?.method).toEqual(expected.method || "GET");
        expect(
          input.toString(),
          `Expected ${input.toString()} to equal ${expectedUrl}`
        ).toEqual(expectedUrl);
        expect(
          options?.body,
          `Expected ${options?.body} to equal ${expected.body}`
        ).toEqual(expected.body);
      }
    );
  }

  expectInsert(table: string, body: string) {
    return this.expectQuery(`INSERT to ${table}: ${body}`, {
      table,
      method: "POST",
      body,
    });
  }

  verifyNoMoreQueriesExpected() {
    expect(
      this.expectedFetches.map((exp) => exp.name),
      "Expected more Supabase calls"
    ).toEqual([]);
  }

  private fetch(
    input: URL | RequestInfo,
    options?: RequestInit | undefined
  ): Promise<Response> {
    expect(
      this.expectedFetches,
      `Did not expect any requests. Got ${options?.method} ${input}`
    ).not.toHaveLength(0);
    const expected = this.expectedFetches[0];
    this.expectedFetches = this.expectedFetches.slice(1);
    expected.requestCheck(input, options);
    return expected.response;
  }

  expectRealtimeSubscription<T extends { [key: string]: any }>(
    table: string,
    event: string = "*",
    schema: string = "public",
    topic: string = "any"
  ) {
    const channelMock = mock(RealtimeChannel);
    let capturedCallback: (payload: RealtimePostgresChangesPayload<T>) => void;
    when(this.realtimeClientMock.channel(topic, anything())).thenReturn(
      instance(channelMock)
    );
    when(channelMock.on(anyString(), anything(), anyFunction())).thenCall(
      (
        type,
        filter: RealtimePostgresChangesFilter<any>,
        callback: (payload: RealtimePostgresChangesPayload<T>) => void
      ) => {
        expect(filter.event).toEqual(event);
        expect(filter.table).toEqual(table);
        expect(filter.schema).toEqual(schema);
        capturedCallback = callback;
        return instance(channelMock);
      }
    );
    when(channelMock.subscribe()).thenReturn(instance(channelMock));
    return {
      next: (event: Partial<RealtimePostgresChangesPayload<T>>) => {
        expect(
          capturedCallback,
          "Expected realtime subscription did not happen"
        ).toBeTruthy();
        capturedCallback(event as RealtimePostgresChangesPayload<T>);
      },
      verifyUnsubscribed: verify(channelMock.unsubscribe()),
    };
  }
}
