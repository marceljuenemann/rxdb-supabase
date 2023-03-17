import type { ReplicationPullHandlerResult, ReplicationPullOptions } from "./rxdb-internal-types.js"
import { SupabaseReplicationCheckpoint, SupabaseReplicationOptions } from "./index.js"
import { RxCollection, WithDeleted } from "rxdb"


type Options<T> = SupabaseReplicationOptions<T> & {
  // Mark fields as required.
  table: string,
  primaryKey: string,
  lastModifiedFieldName: string
}

/**
 * Pulls all changes since the last checkpoint from supabase.
 */
export function pullHandler<T>(options: Options<T>): ReplicationPullOptions<T, SupabaseReplicationCheckpoint> {
  return {
    ...options,
    stream$: undefined, // TODO: live updates
    handler: async (lastCheckpoint: SupabaseReplicationCheckpoint, batchSize: number): Promise<ReplicationPullHandlerResult<T, SupabaseReplicationCheckpoint>> => {
      console.log("Pulling changes since", lastCheckpoint?.modified)

      let query = options.supabaseClient.from(options.table).select()
      if (lastCheckpoint) {
        // TODO: support rows with the exact same timestamp
        query = query.gt(options.lastModifiedFieldName, lastCheckpoint.modified)
      }

      query = query.order(options.lastModifiedFieldName)
                   .order(options.primaryKey)
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
        modified: lastDoc[options.lastModifiedFieldName],
        primaryKeyValue: lastDoc[options.primaryKey]
      }
      const newDocs = data.map(doc => {
        if (!options.lastModifiedFieldInCollection) {
          delete doc[options.lastModifiedFieldName]
        }
        return doc as WithDeleted<T>
      })

      console.log("New checkpoint", newCheckpoint)
      console.log("New docs", newDocs)
      return {
        checkpoint: newCheckpoint,
        documents: newDocs
      }
    }
  }
}
