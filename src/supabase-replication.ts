import { SupabaseClient } from "@supabase/supabase-js"
import { ReplicationPullHandlerResult, RxReplicationWriteToMasterRow, WithDeleted } from "rxdb"
import { RxReplicationState, startReplicationOnLeaderShip } from "rxdb/plugins/replication"
import { ReplicationOptions, ReplicationPullOptions, ReplicationPushOptions } from "./rxdb-internal-types.js"

const DEFAULT_LAST_MODIFIED_FIELD = '_modified'
const DEFAULT_DELETED_FIELD = '_deleted'
const POSTGRES_DUPLICATE_KEY_ERROR_CODE = '23505'

export type SupabaseReplicationOptions<RxDocType> = {
  /**
   * The SupabaseClient to replicate with.
   */
  supabaseClient: SupabaseClient,

  /**
   * The table to replicate to, if different from the name of the collection.
   * @default the name of the RxDB collection.
   */
  table?: string,

  /**
   * The primary key of the supabase table, if different from the primary key of the RxDB.
   * @default the primary key of the RxDB collection
   */
  // TODO: Support composite primary keys.
  primaryKey?: string,

  /**
   * The name of the supabase field that is automatically updated to the last
   * modified timestamp by postgres. This field is required for the pull sync
   * to work and can easily be implemented with moddatetime in supabase.
   * @default '_modified'
   */
  lastModifiedFieldName?: string,

  /**
   * Whether the last modified field is part of the collection, or only exists
   * in the supabase table.
   * @default false
   */
  // TODO: automatically determine this from the collection
  lastModifiedFieldInCollection?: boolean,

  /**
   * Options for pulling data from supabase. Set to {} to pull with the default
   * options, as no data will be pulled if the field is absent.
   */
  pull?: Omit<ReplicationPullOptions<RxDocType, SupabaseReplicationCheckpoint>, 'handler' | 'stream$'>;

  /**
   * Options for pushing data to supabase. Set to {} to push with the default
   * options, as no data will be pushed if the field is absent.
   */
  // TODO: enable custom batch size (currently always one row at a time)
  push?: Omit<ReplicationPushOptions<RxDocType>, 'handler' | 'batchSize'>,

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
} & Omit<
  // We don't support waitForLeadership. You should just run in a SharedWorker anyways, no?
  ReplicationOptions<RxDocType, any>, 'pull' | 'push' | 'waitForLeadership'
>

/**
 * The checkpoint stores until which point the client and supabse have been synced.
 * For this to work, we require each row to have a datetime field that contains the
 * last modified time. In case two rows have the same timestamp, we use the primary
 * key to define a strict order.
 */
export type SupabaseReplicationCheckpoint = {
  modified: string
  primaryKeyValue: string
};

// TODO: some documentation
export function replicateSupabase<RxDocType>(options: SupabaseReplicationOptions<RxDocType>): RxReplicationState<RxDocType, SupabaseReplicationCheckpoint> {
  const replicationState = new SupabaseReplication(options).replicationState
  startReplicationOnLeaderShip(false, replicationState);
  return replicationState;
}

// TODO: 
export class SupabaseReplication<RxDocType> {
  private readonly table: string
  private readonly primaryKey: string
  private readonly lastModifiedFieldName: string
  private readonly live: boolean

  readonly replicationState: RxReplicationState<RxDocType, SupabaseReplicationCheckpoint>

  constructor(private options: SupabaseReplicationOptions<RxDocType>) {
    this.table = options.table || options.collection.name
    this.primaryKey = options.primaryKey || options.collection.schema.primaryPath
    this.lastModifiedFieldName = options.lastModifiedFieldName || DEFAULT_LAST_MODIFIED_FIELD
    this.live = typeof options.live === 'undefined' ? true : options.live

    this.replicationState = new RxReplicationState<RxDocType, SupabaseReplicationCheckpoint>(
      this.options.replicationIdentifier,
      this.options.collection,
      this.options.deletedField || DEFAULT_DELETED_FIELD,
      this.options.pull && {
        ...this.options.pull,
        stream$: undefined,   // TODO: live updates
        handler: this.pullHandler.bind(this)
      },
      this.options.push && {
        ...this.options.push,
        batchSize: 1,         // TODO: support batch insertion
        handler: this.pushHandler.bind(this)
      },
      this.live,
      typeof this.options.retryTime === 'undefined' ? 5000 : this.options.retryTime,
      typeof this.options.autoStart === 'undefined' ? true : this.options.autoStart 
    )
  }

  /**
   * Pulls all changes since the last checkpoint from supabase.
   */
  private async pullHandler(lastCheckpoint: SupabaseReplicationCheckpoint, batchSize: number): Promise<ReplicationPullHandlerResult<RxDocType, SupabaseReplicationCheckpoint>> {
    console.log("Pulling changes since", lastCheckpoint?.modified)

    let query = this.options.supabaseClient.from(this.table).select()
    if (lastCheckpoint && lastCheckpoint.modified) {  // TODO: check modified
      // TODO: support rows with the exact same timestamp
      query = query.gt(this.lastModifiedFieldName, lastCheckpoint.modified)
    }

    query = query.order(this.lastModifiedFieldName)
                 .order(this.primaryKey)
                 .limit(batchSize)

    const { data, error } = await query
    if (error) throw error

    console.log('response', data)
    if (data.length === 0) {
      console.log("No docs returned")
      return {
        checkpoint: lastCheckpoint,
        documents: []
      }
    }

    const lastDoc = data[data.length - 1]
    const newCheckpoint: SupabaseReplicationCheckpoint = {
      modified: lastDoc[this.lastModifiedFieldName],
      primaryKeyValue: lastDoc[this.primaryKey]
    }
    const newDocs = data.map(this.rowToRxDoc.bind(this))

    console.log("New checkpoint", newCheckpoint)
    console.log("New docs", newDocs)
    return {
      checkpoint: newCheckpoint,
      documents: newDocs
    }
  }

  /**
   * Pushes local changes to supabase.
   */
  private async pushHandler(rows: RxReplicationWriteToMasterRow<RxDocType>[]): Promise<WithDeleted<RxDocType>[]> {
    if (rows.length != 1) throw 'Invalid batch size'
    const row = rows[0]
  
    console.log("Pushing changes...", row.newDocumentState)

    return row.assumedMasterState ? this.handleUpdate(row) : this.handleInsertion(row.newDocumentState)
  }

  /**
   * Tries to insert a new row. Returns the current state of the row in case of a conflict. 
   */
  private async handleInsertion(doc: WithDeleted<RxDocType>): Promise<WithDeleted<RxDocType>[]> {
    const { error } = await this.options.supabaseClient.from(this.table).insert(doc)
    if (!error) {
      return []  // Success :)
    } else if (error.code == POSTGRES_DUPLICATE_KEY_ERROR_CODE) {
      // The row was already inserted. Fetch current state and let conflict handler resolve it.
      return [await this.fetchByPrimaryKey((doc as any)[this.primaryKey])]
    } else {
      throw error  // TODO: add test
    }
  }

  /**
   * Updates a row in supabase if all fields match the local state. Otherwise, the current
   * state is fetched and passed to the conflict handler. 
   */
  private async handleUpdate(row: RxReplicationWriteToMasterRow<RxDocType>): Promise<WithDeleted<RxDocType>[]> {
    const updateHandler = this.options.updateHandler ? this.options.updateHandler : this.defaultUpdateHandler.bind(this)
    if (await updateHandler(row)) return []  // Success :)
    // Fetch current state and let conflict handler resolve it.
    return [await this.fetchByPrimaryKey((row.newDocumentState as any)[this.primaryKey])]
  }

  /**
   * Updates the row only if all database fields match the expected state.
   */
  private async defaultUpdateHandler(row: RxReplicationWriteToMasterRow<RxDocType>): Promise<boolean> {
    let query = this.options.supabaseClient.from(this.table).update(row.newDocumentState, { count: 'exact' })
    Object.entries(row.assumedMasterState!).forEach(([field, value]) => {
      let type = typeof value
      if (type === 'string' || type === 'number') {
        query = query.eq(field, value)
      } else if (type === 'boolean' || value === null) {
        query = query.is(field, value)
      } else {
        throw `replicateSupabase: Unsupported field of type ${type}`
      }
    })
    const { error, count } = await query
    console.debug("Update request:", (query as any)['url'].toString(), "count", count)
    if (error) throw error
    return count == 1
  }

  private async fetchByPrimaryKey(primaryKeyValue: any): Promise<WithDeleted<RxDocType>>  {
    const { data, error } = await this.options.supabaseClient.from(this.table)
        .select()
        .eq(this.primaryKey, primaryKeyValue)
        .limit(1)
    if (error) throw error
    if (data.length != 1) throw 'No row with given primary key'
    return this.rowToRxDoc(data[0])
  }

  private rowToRxDoc(row: any): WithDeleted<RxDocType> {
    if (!this.options.lastModifiedFieldInCollection) {
      delete row[this.lastModifiedFieldName]
    }
    return row as WithDeleted<RxDocType>
  }
}
