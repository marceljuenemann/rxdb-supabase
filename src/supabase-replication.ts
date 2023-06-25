import { RealtimeChannel, SupabaseClient } from "@supabase/supabase-js"
import {
  ReplicationOptions,
  ReplicationPullHandlerResult,
  ReplicationPullOptions,
  ReplicationPushOptions,
  RxReplicationPullStreamItem,
  RxReplicationWriteToMasterRow,
  WithDeleted,
} from "rxdb"
import { RxReplicationState } from "rxdb/plugins/replication"
import { Subject } from "rxjs"

const DEFAULT_LAST_MODIFIED_FIELD = "_modified"
const DEFAULT_DELETED_FIELD = "_deleted"
const POSTGRES_DUPLICATE_KEY_ERROR_CODE = "23505"

export type SupabaseReplicationOptions<RxDocType> = {
  /**
   * The SupabaseClient to replicate with.
   */
  supabaseClient: SupabaseClient

  /**
   * The table to replicate to, if different from the name of the collection.
   * @default the name of the RxDB collection.
   */
  table?: string

  /**
   * The primary key of the supabase table, if different from the primary key of the RxDB.
   * @default the primary key of the RxDB collection
   */
  // TODO: Support composite primary keys.
  primaryKey?: string

  /**
   * Options for pulling data from supabase. Set to {} to pull with the default
   * options, as no data will be pulled if the field is absent.
   */
  pull?: Omit<
    ReplicationPullOptions<RxDocType, SupabaseReplicationCheckpoint>,
    "handler" | "stream$"
  > & {
    /**
     * Whether to subscribe to realtime Postgres changes for the table. If set to false,
     * only an initial pull will be performed. Only has an effect if the live option is set
     * to true.
     * @default true
     */
    realtimePostgresChanges?: boolean

    /**
     * The name of the supabase field that is automatically updated to the last
     * modified timestamp by postgres. This field is required for the pull sync
     * to work and can easily be implemented with moddatetime in supabase.
     * @default '_modified'
     */
    lastModifiedField?: string
  }

  /**
   * Options for pushing data to supabase. Set to {} to push with the default
   * options, as no data will be pushed if the field is absent.
   */
  // TODO: enable custom batch size (currently always one row at a time)
  push?: Omit<ReplicationPushOptions<RxDocType>, "handler" | "batchSize"> & {
    /**
     * Handler for pushing row updates to supabase. Must return true iff the UPDATE was
     * applied to the supabase table. Returning false signalises a write conflict, in
     * which case the current state of the row will be fetched from supabase and passed to
     * the RxDB collection's conflict handler.
     * @default the default handler will update the row only iff all fields match the
     * local state (before the update was applied), otherwise the conflict handler is
     * invoked. The default handler does not support JSON fields at the moment.
     */
    // TODO: Support JSON fields
    updateHandler?: (row: RxReplicationWriteToMasterRow<RxDocType>) => Promise<boolean>
  }
} & Omit<
  // We don't support waitForLeadership. You should just run in a SharedWorker anyways, no?
  ReplicationOptions<RxDocType, any>,
  "pull" | "push" | "waitForLeadership"
>

/**
 * The checkpoint stores until which point the client and supabse have been synced.
 * For this to work, we require each row to have a datetime field that contains the
 * last modified time. In case two rows have the same timestamp, we use the primary
 * key to define a strict order.
 */
export interface SupabaseReplicationCheckpoint {
  modified: string
  primaryKeyValue: string | number
}

/**
 * Replicates the local RxDB database with the given Supabase client.
 *
 * See SupabaseReplicationOptions for the various configuration options. For a general introduction
 * to RxDB's replication protocol, see https://rxdb.info/replication.html
 */
export class SupabaseReplication<RxDocType> extends RxReplicationState<
  RxDocType,
  SupabaseReplicationCheckpoint
> {
  private readonly table: string
  private readonly primaryKey: string
  private readonly lastModifiedFieldName: string

  private readonly realtimeChanges: Subject<
    RxReplicationPullStreamItem<RxDocType, SupabaseReplicationCheckpoint>
  >
  private realtimeChannel?: RealtimeChannel

  constructor(private options: SupabaseReplicationOptions<RxDocType>) {
    const realtimeChanges = new Subject<
      RxReplicationPullStreamItem<RxDocType, SupabaseReplicationCheckpoint>
    >()
    const replicationIdentifierHash = options.collection.database.hashFunction(
      [
        options.collection.database.name,
        options.collection.name,
        options.replicationIdentifier,
      ].join("|")
    )
    super(
      replicationIdentifierHash,
      options.collection,
      options.deletedField || DEFAULT_DELETED_FIELD,
      options.pull && {
        ...options.pull,
        stream$: realtimeChanges,
        handler: (lastCheckpoint, batchSize) => this.pullHandler(lastCheckpoint, batchSize),
      },
      options.push && {
        ...options.push,
        batchSize: 1, // TODO: support batch insertion
        handler: (rows) => this.pushHandler(rows),
      },
      typeof options.live === "undefined" ? true : options.live,
      typeof options.retryTime === "undefined" ? 5000 : options.retryTime,
      typeof options.autoStart === "undefined" ? true : options.autoStart
    )
    this.realtimeChanges = realtimeChanges
    this.table = options.table || options.collection.name
    this.primaryKey = options.primaryKey || options.collection.schema.primaryPath
    this.lastModifiedFieldName = options.pull?.lastModifiedField || DEFAULT_LAST_MODIFIED_FIELD

    if (this.autoStart) {
      this.start()
    }
  }

  public override async start(): Promise<void> {
    if (
      this.live &&
      this.options.pull &&
      (this.options.pull.realtimePostgresChanges ||
        typeof this.options.pull.realtimePostgresChanges === "undefined")
    ) {
      this.watchPostgresChanges()
    }
    return super.start()
  }

  public override async cancel(): Promise<any> {
    if (this.realtimeChannel) {
      return Promise.all([super.cancel(), this.realtimeChannel.unsubscribe()])
    }
    return super.cancel()
  }

  /**
   * Pulls all changes since the last checkpoint from supabase.
   */
  private async pullHandler(
    lastCheckpoint: SupabaseReplicationCheckpoint,
    batchSize: number
  ): Promise<ReplicationPullHandlerResult<RxDocType, SupabaseReplicationCheckpoint>> {
    let query = this.options.supabaseClient.from(this.table).select()
    if (lastCheckpoint && lastCheckpoint.modified) {
      // Construct the PostgREST query for the following condition:
      // WHERE _modified > lastModified OR (_modified = lastModified AND primaryKey > lastPrimaryKey)
      const lastModified = JSON.stringify(lastCheckpoint.modified)
      const lastPrimaryKey = JSON.stringify(lastCheckpoint.primaryKeyValue) // TODO: Add test for a integer primary key
      const isNewer = `${this.lastModifiedFieldName}.gt.${lastModified}`
      const isSameAge = `${this.lastModifiedFieldName}.eq.${lastModified}`
      query = query.or(`${isNewer},and(${isSameAge},${this.primaryKey}.gt.${lastPrimaryKey})`)
    }
    query = query.order(this.lastModifiedFieldName).order(this.primaryKey).limit(batchSize)
    //console.debug("Pulling changes since", lastCheckpoint?.modified, "with query", (query as any)['url'].toString())

    const { data, error } = await query
    if (error) throw error
    if (data.length == 0) {
      return {
        checkpoint: lastCheckpoint,
        documents: [],
      }
    } else {
      return {
        checkpoint: this.rowToCheckpoint(data[data.length - 1]),
        documents: data.map(this.rowToRxDoc.bind(this)),
      }
    }
  }

  /**
   * Pushes local changes to supabase.
   */
  private async pushHandler(
    rows: RxReplicationWriteToMasterRow<RxDocType>[]
  ): Promise<WithDeleted<RxDocType>[]> {
    if (rows.length != 1) throw new Error("Invalid batch size")
    const row = rows[0]
    //console.debug("Pushing changes...", row.newDocumentState)
    return row.assumedMasterState
      ? this.handleUpdate(row)
      : this.handleInsertion(row.newDocumentState)
  }

  /**
   * Tries to insert a new row. Returns the current state of the row in case of a conflict.
   */
  private async handleInsertion(doc: WithDeleted<RxDocType>): Promise<WithDeleted<RxDocType>[]> {
    const { error } = await this.options.supabaseClient.from(this.table).insert(doc)
    if (!error) {
      return [] // Success :)
    } else if (error.code == POSTGRES_DUPLICATE_KEY_ERROR_CODE) {
      // The row was already inserted. Fetch current state and let conflict handler resolve it.
      return [await this.fetchByPrimaryKey((doc as any)[this.primaryKey])]
    } else {
      throw error
    }
  }

  /**
   * Updates a row in supabase if all fields match the local state. Otherwise, the current
   * state is fetched and passed to the conflict handler.
   */
  private async handleUpdate(
    row: RxReplicationWriteToMasterRow<RxDocType>
  ): Promise<WithDeleted<RxDocType>[]> {
    const updateHandler = this.options.push?.updateHandler || this.defaultUpdateHandler.bind(this)
    if (await updateHandler(row)) return [] // Success :)
    // Fetch current state and let conflict handler resolve it.
    return [await this.fetchByPrimaryKey((row.newDocumentState as any)[this.primaryKey])]
  }

  /**
   * Updates the row only if all database fields match the expected state.
   */
  private async defaultUpdateHandler(
    row: RxReplicationWriteToMasterRow<RxDocType>
  ): Promise<boolean> {
    let query = this.options.supabaseClient
      .from(this.table)
      .update(row.newDocumentState, { count: "exact" })
    Object.entries(row.assumedMasterState!).forEach(([field, value]) => {
      const type = typeof value
      if (type === "string" || type === "number") {
        query = query.eq(field, value)
      } else if (type === "boolean" || value === null) {
        query = query.is(field, value)
      } else {
        throw new Error(`replicateSupabase: Unsupported field of type ${type}`)
      }
    })
    const { error, count } = await query
    if (error) throw error
    return count == 1
  }

  private watchPostgresChanges() {
    this.realtimeChannel = this.options.supabaseClient
      .channel(`rxdb-supabase-${this.replicationIdentifierHash}`)
      .on("postgres_changes", { event: "*", schema: "public", table: this.table }, (payload) => {
        if (payload.eventType === "DELETE" || !payload.new) return // Should have set _deleted field already
        //console.debug('Realtime event received:', payload)
        this.realtimeChanges.next({
          checkpoint: this.rowToCheckpoint(payload.new),
          documents: [this.rowToRxDoc(payload.new)],
        })
      })
      .subscribe()
  }

  private async fetchByPrimaryKey(primaryKeyValue: any): Promise<WithDeleted<RxDocType>> {
    const { data, error } = await this.options.supabaseClient
      .from(this.table)
      .select()
      .eq(this.primaryKey, primaryKeyValue)
      .limit(1)
    if (error) throw error
    if (data.length != 1) throw new Error("No row with given primary key")
    return this.rowToRxDoc(data[0])
  }

  private rowToRxDoc(row: any): WithDeleted<RxDocType> {
    // TODO: Don't delete the field if it is actually part of the collection
    delete row[this.lastModifiedFieldName]
    return row as WithDeleted<RxDocType>
  }

  private rowToCheckpoint(row: any): SupabaseReplicationCheckpoint {
    return {
      modified: row[this.lastModifiedFieldName],
      primaryKeyValue: row[this.primaryKey],
    }
  }
}
