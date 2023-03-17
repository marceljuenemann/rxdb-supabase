import { RxReplicationWriteToMasterRow, WithDeleted } from "rxdb"
import { SupabaseReplicationOptions } from "./index.js"
import { ReplicationPushOptions } from "./rxdb-internal-types.js"

const POSTGRES_DUPLICATE_KEY_ERROR_CODE = '23505'

// TODO: support larger batch sizes to enable bulk insertion.
export function pushHandler<T>(options: SupabaseReplicationOptions<T>): ReplicationPushOptions<T> {
  return {
    ...options.push,
    batchSize: 1,
    handler: async (rows: RxReplicationWriteToMasterRow<T>[]): Promise<WithDeleted<T>[]> => {
      if (rows.length != 1) throw 'Invalid batch size'
      const row = rows[0]
     
      console.log("Pushing changes...", row)

      if (!row.assumedMasterState) {
        console.log("Inserting x...")

        const { error } = await options.supabaseClient.from('humans') // TODO: configurable
          .insert(row.newDocumentState)

        if (!error) {
          console.log("Success!")
          return []
        }
        if (error.code != POSTGRES_DUPLICATE_KEY_ERROR_CODE) console.error("error")

        console.log("Conflict!")
        // TODO: Fetch current master state and return
        // TODO: Figure out what happens when we throw here? Would the caller have to do something?
      } else {
        throw 'Updating not supported yet'
      }

      return []
    } 
  }
}
