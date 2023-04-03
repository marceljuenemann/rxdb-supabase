import {
  addRxPlugin,
  createRxDatabase,
  RxCollection,
  RxDatabase,
  RxReplicationWriteToMasterRow,
} from "rxdb"
import { RxDBDevModePlugin } from "rxdb/plugins/dev-mode"
import { RxReplicationState } from "rxdb/plugins/replication"
import { getRxStorageMemory } from "rxdb/plugins/storage-memory"
import { afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest"
import {
  SupabaseReplication,
  SupabaseReplicationCheckpoint,
  SupabaseReplicationOptions,
} from "../supabase-replication.js"
import { SupabaseBackendMock } from "./supabase-backend-mock.js"
import { Human, HumanRow, HUMAN_SCHEMA } from "./test-types.js"
import { withReplication, resolveConflictWithName } from "./test-utils.js"

describe.skipIf(process.env.INTEGRATION_TEST)("replicateSupabase", () => {
  let supabaseMock: SupabaseBackendMock
  let db: RxDatabase
  let collection: RxCollection<Human>

  beforeAll(() => {
    addRxPlugin(RxDBDevModePlugin)
  })

  beforeEach(async () => {
    // Create an in-memory RxDB database.
    db = await createRxDatabase({
      name: "test",
      storage: getRxStorageMemory(),
      ignoreDuplicate: true,
    })
    collection = (
      await db.addCollections({
        humans: { schema: HUMAN_SCHEMA },
      })
    ).humans

    // Supabase client with mocked HTTP.
    supabaseMock = new SupabaseBackendMock()
  })

  describe("initial pull", () => {
    describe("without initial checkpoint", () => {
      it("pulls all rows from supabase", async () => {
        expectPull().thenReturn(createHumans(1))
        await replication()

        expect(await rxdbContents()).toEqual([{ id: "1", name: "Human 1", age: 11 }])
      })
    })

    describe("with previous checkpoint", () => {
      it("pulls only modified rows", async () => {
        const checkpoint: SupabaseReplicationCheckpoint = {
          modified: "timestamp",
          primaryKeyValue: "pkv",
        }
        expectPull({
          withFilter: { lastModified: "timestamp", lastPrimaryKey: "pkv" },
        }).thenReturn(createHumans(1))
        await replication({
          pull: {
            initialCheckpoint: checkpoint,
            realtimePostgresChanges: false,
          },
        })

        expect(await rxdbContents()).toEqual([{ id: "1", name: "Human 1", age: 11 }])
      })

      describe("with custom modified field", () => {
        it("pulls only modified rows using the specified field", async () => {
          const checkpoint: SupabaseReplicationCheckpoint = {
            modified: "timestamp",
            primaryKeyValue: "pkv",
          }
          expectPull({
            withFilter: {
              lastModified: "timestamp",
              lastPrimaryKey: "pkv",
              modifiedField: "myfield",
            },
          }).thenReturn([
            {
              id: "1",
              name: "Alice",
              age: null,
              _deleted: false,
              myfield: "timestamp",
            },
          ])
          await replication({
            pull: {
              initialCheckpoint: checkpoint,
              realtimePostgresChanges: false,
              lastModifiedFieldName: "myfield",
            },
          })

          expect(await rxdbContents()).toEqual([{ id: "1", name: "Alice", age: null }])
        })
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
        const expectedQuery = (lastHuman: number) => {
          const human = createHuman(lastHuman)
          return {
            withLimit: BATCH_SIZE,
            withFilter: {
              lastModified: human._modified,
              lastPrimaryKey: human.id,
            },
          }
        }

        // Expect three queries
        const BATCH_SIZE = 13
        const humans = createHumans(BATCH_SIZE * 2 + 3)
        expectPull({ withLimit: BATCH_SIZE }).thenReturn(humans.slice(0, BATCH_SIZE))
        expectPull(expectedQuery(BATCH_SIZE)).thenReturn(humans.slice(BATCH_SIZE, BATCH_SIZE * 2))
        expectPull(expectedQuery(BATCH_SIZE * 2)).thenReturn(humans.slice(BATCH_SIZE * 2))

        await replication({
          pull: { batchSize: BATCH_SIZE, realtimePostgresChanges: false },
        })

        expect(await rxdbContents()).toHaveLength(humans.length)
      })
    })

    describe("with query failing", () => {
      it("retries automatically", async () => {
        expectPull().thenFail()
        expectPull().thenReturn(createHumans(1))

        const errors = await replication({ retryTime: 10 }, async () => {}, true)
        expect(errors).toHaveLength(1)
        expect(await rxdbContents()).toEqual([{ id: "1", name: "Human 1", age: 11 }])
      })
    })

    describe("with deletion", () => {
      it("deletes row locally", async () => {
        // Fill database first
        await collection.insert({ id: "1", name: "Alice", age: null })
        expectPull().thenReturn([])
        expectInsert('{"id":"1","name":"Alice","age":null,"_deleted":false}').thenReturn()
        await replication()
        expect(await rxdbContents()).toEqual([{ id: "1", name: "Alice", age: null }])

        // Now return deletion
        expectPull().thenReturn([
          {
            id: "1",
            name: "Alice",
            age: null,
            _deleted: true,
            _modified: "time",
          },
        ])
        await replication()
        expect(await rxdbContents()).toEqual([])
      })

      describe("with custom delete field name", () => {
        it("uses specified field name", async () => {
          // Fill database first (using default here)
          await collection.insert({ id: "1", name: "Alice", age: null })
          expectPull().thenReturn([])
          expectInsert('{"id":"1","name":"Alice","age":null,"_deleted":false}').thenReturn()
          await replication()
          expect(await rxdbContents()).toEqual([{ id: "1", name: "Alice", age: null }])

          // Now return deletion (using custom field here)
          expectPull().thenReturn([
            {
              id: "1",
              name: "Alice",
              age: null,
              myfield: true,
              _modified: "time",
            },
          ])
          await replication({ deletedField: "myfield" })
          expect(await rxdbContents()).toEqual([])
        })
      })
    })
  })

  describe("with client-side insertion", () => {
    describe("with single insertion", () => {
      it("inserts row to supabase", async () => {
        await collection.insert({ id: "1", name: "Alice", age: null })
        expectPull().thenReturn([])
        expectInsert('{"id":"1","name":"Alice","age":null,"_deleted":false}').thenReturn()

        await replication()
      })
    })

    describe("with multiple insertions", () => {
      it("triggers multiple INSERT calls", async () => {
        // TODO: Batch insertion would be nice in this case.
        await collection.insert({ id: "1", name: "Alice", age: null })
        await collection.insert({ id: "2", name: "Bob", age: 42 })
        expectPull().thenReturn([])
        expectInsert('{"id":"1","name":"Alice","age":null,"_deleted":false}').thenReturn()
        expectInsert('{"id":"2","name":"Bob","age":42,"_deleted":false}').thenReturn()

        await replication()
      })
    })

    describe("with custom _delete field", () => {
      it("uses specified field", async () => {
        await collection.insert({ id: "1", name: "Alice", age: null })
        expectPull().thenReturn([])
        expectInsert('{"id":"1","name":"Alice","age":null,"removed":false}').thenReturn()

        await replication({ deletedField: "removed" })
      })
    })

    describe("with network error", () => {
      it("automatically retries", async () => {
        await collection.insert({ id: "1", name: "Alice", age: null })
        expectPull().thenReturn([])
        expectInsert('{"id":"1","name":"Alice","age":null,"_deleted":false}').thenFail()
        expectInsert('{"id":"1","name":"Alice","age":null,"_deleted":false}').thenReturn()

        const errors = await replication({ retryTime: 10 }, async () => {}, true)
        expect(errors).toHaveLength(1)
      })
    })

    describe("with postgres error", () => {
      it("automatically retries", async () => {
        await collection.insert({ id: "1", name: "Alice", age: null })
        expectPull().thenReturn([])
        expectInsert('{"id":"1","name":"Alice","age":null,"_deleted":false}').thenReturnError(
          "53000",
          503
        )
        expectInsert('{"id":"1","name":"Alice","age":null,"_deleted":false}').thenReturn()

        const errors = await replication({ retryTime: 10 }, async () => {}, true)
        expect(errors).toHaveLength(1)
      })
    })

    describe("with duplicate key error", () => {
      it("fetches current state and invokes conflict handler ", async () => {
        collection.conflictHandler = resolveConflictWithName("Resolved Alice")
        await collection.insert({ id: "1", name: "Local Alice", age: null })
        expectPull().thenReturn([])
        expectInsert('{"id":"1","name":"Local Alice","age":null,"_deleted":false}').thenReturnError(
          "23505"
        )
        // Should fetch current state on duplicate key error...
        expectSelectById("1").thenReturn([
          {
            id: "1",
            name: "Remote Alice",
            age: 42,
            _deleted: false,
            _modified: "mod",
          },
        ])
        // Should update remote with the result of the conflict handler and the real master state as assumed state.
        supabaseMock
          .expectQuery("UPDATE Alice", {
            method: "PATCH",
            table: "humans",
            params: "id=eq.1&name=eq.Remote+Alice&age=eq.42&_deleted=is.false",
            body: '{"id":"1","name":"Resolved Alice","age":null,"_deleted":false}',
          })
          .thenReturn({}, { "Content-Range": "0-1/1" })

        await replication()
      })
    })
  })

  describe("with client-side update", () => {
    describe("without conflict", () => {
      it("performs UPDATE with equality checks", async () => {
        await collection.insert({
          id: "1",
          name: 'Robert "Bob" Simpson',
          age: null,
        })
        expectPull().thenReturn([])
        expectInsert(
          '{"id":"1","name":"Robert \\"Bob\\" Simpson","age":null,"_deleted":false}'
        ).thenReturn()

        await replication({}, async (replication) => {
          supabaseMock
            .expectQuery("UPDATE Bob", {
              method: "PATCH",
              table: "humans",
              params: "id=eq.1&name=eq.Robert+%22Bob%22+Simpson&age=is.null&_deleted=is.false",
              body: '{"id":"1","name":"Bobby","age":42,"_deleted":false}',
            })
            .thenReturn({}, { "Content-Range": "0-1/1" }) // TODO: Not sure this is the correct header result
          await collection.upsert({ id: "1", name: "Bobby", age: 42 })
        })

        expect(await rxdbContents()).toEqual([{ id: "1", name: "Bobby", age: 42 }])
      })
    })

    describe("with conflict", () => {
      it("invokes conflict handler and updates again", async () => {
        collection.conflictHandler = resolveConflictWithName("Resolved Alice")
        const doc = await collection.insert({
          id: "1",
          name: "Alice",
          age: null,
        })
        expectPull().thenReturn([])
        expectInsert('{"id":"1","name":"Alice","age":null,"_deleted":false}').thenReturn()

        await replication({}, async (replication) => {
          supabaseMock
            .expectQuery("UPDATE Alice (conflicting)", {
              method: "PATCH",
              table: "humans",
              params: "id=eq.1&name=eq.Alice&age=is.null&_deleted=is.false",
              body: '{"id":"1","name":"Alice local","age":42,"_deleted":false}',
            })
            .thenReturn({}, { "Content-Range": "0-0/0" }) // Zero rows updated

          expectSelectById("1").thenReturn([{ id: "1", name: "Alice remote", age: 54 }])
          supabaseMock
            .expectQuery("UPDATE Alice (after resolution)", {
              method: "PATCH",
              table: "humans",
              params: "id=eq.1&name=eq.Alice+remote&age=eq.54&_deleted=is.false",
              body: '{"id":"1","name":"Resolved Alice","age":42,"_deleted":false}',
            })
            .thenReturn({}, { "Content-Range": "0-1/1" }) // One row updated

          await doc.patch({ name: "Alice local", age: 42 })
        })

        expect(await rxdbContents()).toEqual([{ id: "1", name: "Resolved Alice", age: 42 }])
      })
    })

    describe("with custom updateHandler", () => {
      describe("returning true", () => {
        it("does not trigger any queries", async () => {
          const doc = await collection.insert({
            id: "1",
            name: "Alice",
            age: null,
          })
          expectPull().thenReturn([])
          expectInsert('{"id":"1","name":"Alice","age":null,"_deleted":false}').thenReturn()

          await replication(
            { push: { updateHandler: () => Promise.resolve(true) } },
            async (replication) => {
              await doc.patch({ name: "Alice local", age: 42 })
            }
          )

          expect(await rxdbContents()).toEqual([{ id: "1", name: "Alice local", age: 42 }])
        })
      })

      describe("returning false", () => {
        it("invokes conflict handler and updates again", async () => {
          let callCount = 0
          const customUpdateHandler = (
            row: RxReplicationWriteToMasterRow<Human>
          ): Promise<boolean> => {
            callCount++
            // Only return true (i.e. successful update) if we already fetched the updated state
            return Promise.resolve(row.assumedMasterState?.name === "Alice remote")
          }

          const doc = await collection.insert({
            id: "1",
            name: "Alice",
            age: null,
          })
          expectPull().thenReturn([])
          expectInsert('{"id":"1","name":"Alice","age":null,"_deleted":false}').thenReturn()

          collection.conflictHandler = resolveConflictWithName("Resolved Alice")
          await replication(
            { push: { updateHandler: customUpdateHandler } },
            async (replication) => {
              expectSelectById("1").thenReturn([{ id: "1", name: "Alice remote", age: 54 }])
              await doc.patch({ name: "Alice local", age: 42 })
            }
          )

          expect(callCount).toEqual(2)
          expect(await rxdbContents()).toEqual([{ id: "1", name: "Resolved Alice", age: 42 }])
        })
      })
    })

    describe("with network error", () => {
      it("automatically retries", async () => {
        await collection.insert({ id: "1", name: "Alice", age: null })
        expectPull().thenReturn([])
        expectInsert('{"id":"1","name":"Alice","age":null,"_deleted":false}').thenReturn()

        const errors = await replication(
          { retryTime: 10 },
          async () => {
            supabaseMock
              .expectQuery("UPDATE Alice (failing)", {
                method: "PATCH",
                table: "humans",
                params: "id=eq.1&name=eq.Alice&age=is.null&_deleted=is.false",
                body: '{"id":"1","name":"Alice 2","age":42,"_deleted":false}',
              })
              .thenFail()
            supabaseMock
              .expectQuery("UPDATE Alice (retry)", {
                method: "PATCH",
                table: "humans",
                params: "id=eq.1&name=eq.Alice&age=is.null&_deleted=is.false",
                body: '{"id":"1","name":"Alice 2","age":42,"_deleted":false}',
              })
              .thenReturn({}, { "Content-Range": "0-1/1" })
            await collection.upsert({ id: "1", name: "Alice 2", age: 42 })
          },
          true
        )
        expect(errors).toHaveLength(1)
      })
    })

    // TODO: Test for unsupported field types (i.e. jsonb)
  })

  describe("with client-side delete", () => {
    describe("with default deleted field", () => {
      it("performs UPDATE with equality checks", async () => {
        const doc = await collection.insert({
          id: "1",
          name: "Alice",
          age: null,
        })
        expectPull().thenReturn([])
        expectInsert('{"id":"1","name":"Alice","age":null,"_deleted":false}').thenReturn()

        await replication({}, async (replication) => {
          supabaseMock
            .expectQuery("UPDATE Alice", {
              method: "PATCH",
              table: "humans",
              params: "id=eq.1&name=eq.Alice&age=is.null&_deleted=is.false",
              body: '{"id":"1","name":"Alice","age":null,"_deleted":true}',
            })
            .thenReturn({}, { "Content-Range": "0-1/1" })
          await doc.remove()
        })

        expect(await rxdbContents()).toEqual([])
      })
    })

    describe("with default custom deleted field", () => {
      it("performs UPDATE with equality checks and custom deleted field", async () => {
        const doc = await collection.insert({
          id: "1",
          name: "Alice",
          age: null,
        })
        expectPull().thenReturn([])
        expectInsert('{"id":"1","name":"Alice","age":null,"mydelete":false}').thenReturn()

        await replication({ deletedField: "mydelete" }, async (replication) => {
          supabaseMock
            .expectQuery("UPDATE Alice", {
              method: "PATCH",
              table: "humans",
              params: "id=eq.1&name=eq.Alice&age=is.null&mydelete=is.false",
              body: '{"id":"1","name":"Alice","age":null,"mydelete":true}',
            })
            .thenReturn({}, { "Content-Range": "0-1/1" })
          await doc.remove()
        })

        expect(await rxdbContents()).toEqual([])
      })
    })
  })

  describe("with realtime enabled", () => {
    describe("without events received", () => {
      it("subscribes to and unsubscribes from RealtimeChannel", async () => {
        expectPull().thenReturn([])
        const realtimeSubscription = supabaseMock.expectRealtimeSubscription("humans")
        await replication({ pull: { realtimePostgresChanges: true } }, async () => {
          realtimeSubscription.verifyUnsubscribed.never()
        })
        realtimeSubscription.verifyUnsubscribed.once()
      })
    })

    describe("with insert event received", () => {
      it("inserts new row locally", async () => {
        expectPull().thenReturn([])
        const realtimeSubscription = supabaseMock.expectRealtimeSubscription<HumanRow>("humans")
        await replication({ pull: { realtimePostgresChanges: true } }, async () => {
          realtimeSubscription.next({
            eventType: "INSERT",
            new: {
              id: "2",
              name: "Bob",
              age: null,
              _deleted: false,
              _modified: "2023-1",
            },
          })
        })
        expect(await rxdbContents()).toEqual([{ id: "2", name: "Bob", age: null }])
      })
    })

    describe("with multiple realtime events received", () => {
      it("updates local state", async () => {
        expectPull().thenReturn([])
        const realtimeSubscription = supabaseMock.expectRealtimeSubscription<HumanRow>("humans")
        await replication({ pull: { realtimePostgresChanges: true } }, async () => {
          realtimeSubscription.next({
            eventType: "INSERT",
            new: {
              id: "2",
              name: "Bob",
              age: null,
              _deleted: false,
              _modified: "2023-1",
            },
          })
          realtimeSubscription.next({
            eventType: "UPDATE",
            new: {
              id: "2",
              name: "Bob",
              age: 42,
              _deleted: false,
              _modified: "2023-2",
            },
          })
          realtimeSubscription.next({
            eventType: "INSERT",
            new: {
              id: "3",
              name: "Carl",
              age: null,
              _deleted: false,
              _modified: "2023-3",
            },
          })
          realtimeSubscription.next({
            eventType: "UPDATE",
            new: {
              id: "1",
              name: "Alice",
              age: null,
              _deleted: true,
              _modified: "2023-4",
            },
          })
        })
        expect(await rxdbContents()).toEqual([
          { id: "2", name: "Bob", age: 42 },
          { id: "3", name: "Carl", age: null },
        ])
      })
    })

    describe("with DELETE event received", () => {
      it("ignores event", async () => {
        expectPull().thenReturn([])
        const realtimeSubscription = supabaseMock.expectRealtimeSubscription<HumanRow>("humans")
        await replication({ pull: { realtimePostgresChanges: true } }, async () => {
          realtimeSubscription.next({
            eventType: "INSERT",
            new: {
              id: "1",
              name: "Alice",
              age: null,
              _deleted: false,
              _modified: "2023-1",
            },
          })
          realtimeSubscription.next({
            eventType: "DELETE",
            old: {
              id: "1",
              name: "Alice",
              age: null,
              _deleted: false,
              _modified: "2023-1",
            },
          })
        })
        expect(await rxdbContents()).toEqual([{ id: "1", name: "Alice", age: null }])
      })
    })
  })

  const replication = (
    options: Partial<SupabaseReplicationOptions<Human>> = {},
    callback: (
      state: RxReplicationState<Human, SupabaseReplicationCheckpoint>
    ) => Promise<void> = async () => {},
    expectErrors = false
  ): Promise<Error[]> => {
    return withReplication(() => startReplication(options), callback, expectErrors)
  }

  const startReplication = (
    options: Partial<SupabaseReplicationOptions<Human>> = {}
  ): SupabaseReplication<Human> => {
    const status = new SupabaseReplication({
      replicationIdentifier: "test",
      supabaseClient: supabaseMock.client,
      collection,
      pull: { realtimePostgresChanges: false },
      push: {},
      ...options,
    })
    return status
  }

  const expectPull = (
    options: {
      withLimit?: number
      withFilter?: {
        lastModified: string
        lastPrimaryKey: string
        modifiedField?: string
      }
    } = {}
  ) => {
    // TODO: test double quotes inside a search string
    const modifiedField = options.withFilter?.modifiedField || "_modified"
    let expectedFilter = ""
    if (options.withFilter) {
      expectedFilter =
        `&or=%28${modifiedField}.gt.%22${options.withFilter.lastModified}%22%2C` +
        `and%28${modifiedField}.eq.%22${options.withFilter.lastModified}%22%2C` +
        `id.gt.%22${options.withFilter.lastPrimaryKey}%22%29%29`
    }
    return supabaseMock.expectQuery(`Pull query with filter ${expectedFilter}`, {
      table: "humans",
      params: `select=*${expectedFilter}&order=${modifiedField}.asc%2Cid.asc&limit=${
        options.withLimit || 100
      }`,
    })
  }

  const expectSelectById = (id: string) => {
    return supabaseMock.expectQuery(`Select by id ${id}`, {
      table: "humans",
      params: `select=*&id=eq.${id}&limit=1`,
    })
  }

  const expectInsert = (body: string) => {
    return supabaseMock.expectInsert("humans", body)
  }

  const rxdbContents = async (): Promise<Human[]> => {
    const results = await collection.find().exec()
    return results.map((doc) => doc.toJSON())
  }

  const createHumans = (count: number): HumanRow[] => {
    return Array.from(Array(count).keys()).map((id) => createHuman(id + 1))
  }

  const createHuman = (id: number): HumanRow => {
    return {
      id: id.toString(),
      name: `Human ${id}`,
      age: id % 2 == 0 ? null : id * 11,
      _deleted: false,
      _modified: "2023-" + id,
    }
  }

  afterEach(async () => {
    supabaseMock.verifyNoMoreQueriesExpected()
    await db.remove()
  })
})
