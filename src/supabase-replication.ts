import { ReplicationPullHandlerResult, RxReplicationWriteToMasterRow, WithDeleted } from "rxdb"
import { RxReplicationState } from "rxdb/plugins/replication"
import { SupabaseReplicationCheckpoint, SupabaseReplicationOptions } from "./index.js"

const DEFAULT_LAST_MODIFIED_FIELD = '_modified'
const DEFAULT_DELETED_FIELD = '_deleted'

const POSTGRES_DUPLICATE_KEY_ERROR_CODE = '23505'

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
      this.options.retryTime,
      typeof this.options.autoStart === 'undefined' ? true : this.options.autoStart 
    )
  }

  /**
   * Pulls all changes since the last checkpoint from supabase.
   */
  private async pullHandler(lastCheckpoint: SupabaseReplicationCheckpoint, batchSize: number): Promise<ReplicationPullHandlerResult<RxDocType, SupabaseReplicationCheckpoint>> {
    console.log("Pulling changes since", lastCheckpoint?.modified)

    let query = this.options.supabaseClient.from(this.table).select()
    if (lastCheckpoint) {
      // TODO: support rows with the exact same timestamp
      query = query.gt(this.lastModifiedFieldName, lastCheckpoint.modified)
    }

    query = query.order(this.lastModifiedFieldName)
                 .order(this.primaryKey)
                 .limit(batchSize)

    const { data, error } = await query
    if (error) throw error
    if (data.length == 0) {
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
    const newDocs = data.map(doc => {
      if (!this.options.lastModifiedFieldInCollection) {
        delete doc[this.lastModifiedFieldName]
      }
      return doc as WithDeleted<RxDocType>
    })

    console.log("New checkpoint", newCheckpoint)
    console.log("New docs", newDocs)
    return {
      checkpoint: newCheckpoint,
      documents: newDocs
    }
  }

  private async pushHandler(rows: RxReplicationWriteToMasterRow<RxDocType>[]): Promise<WithDeleted<RxDocType>[]> {
    if (rows.length != 1) throw 'Invalid batch size'
    const row = rows[0]
  
    console.log("Pushing changes...", row.newDocumentState)

    if (!row.assumedMasterState) {
      return this.handleInsertion(row.newDocumentState)
    } else {
      throw 'Updating not supported yet'
    }
  } 

  private async handleInsertion(doc: WithDeleted<RxDocType>): Promise<WithDeleted<RxDocType>[]> {
    const { error } = await this.options.supabaseClient.from(this.table).insert(doc)
    if (!error) return []  // Success :)
    if (error.code != POSTGRES_DUPLICATE_KEY_ERROR_CODE) throw error  // TODO: test

    // The row was already inserted. Fetch current state and let conflict handler resolve it.
    return [await this.fetchByPrimaryKey((doc as any)[this.primaryKey])]
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
