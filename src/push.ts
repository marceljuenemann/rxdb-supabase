import { RxReplicationWriteToMasterRow, WithDeleted } from "rxdb"
import { SupabaseReplicationOptions } from "./index.js"
import { ReplicationPushOptions } from "./rxdb-internal-types.js"

const POSTGRES_DUPLICATE_KEY_ERROR_CODE = '23505'

type Options<T> = SupabaseReplicationOptions<T> & {
  // Mark fields as required.
  table: string,
  primaryKey: string,
  lastModifiedFieldName: string
}

// TODO: support larger batch sizes to enable bulk insertion.
export function pushHandler<T>(options: Options<T>): ReplicationPushOptions<T> {
  return {
    ...options.push,
    batchSize: 1,
    handler: async (rows: RxReplicationWriteToMasterRow<T>[]): Promise<WithDeleted<T>[]> => {
      if (rows.length != 1) throw 'Invalid batch size'
      const row = rows[0]
     
      console.log("Pushing changes...", row.newDocumentState)

      if (!row.assumedMasterState) {
        return handleInsertion(row.newDocumentState, options)
      } else {
        throw 'Updating not supported yet'
      }

      return []
    } 
  }
}

async function handleInsertion<T>(doc: WithDeleted<T>, options: Options<T>): Promise<WithDeleted<T>[]> {
  const { error } = await options.supabaseClient.from(options.table).insert(doc)
  if (!error) return []  // Success :)
  if (error.code != POSTGRES_DUPLICATE_KEY_ERROR_CODE) throw error  // TODO: test

  // The row was already inserted. Fetch current state and let conflict handler resolve it.
  return [await fetchByPrimaryKey((doc as any)[options.primaryKey], options)]

/*
  const newDocs = data.map(doc => {
    if (!options.lastModifiedFieldInCollection) {
      delete doc[options.lastModifiedFieldName]
    }
    return doc as WithDeleted<T>
  })

  console.log("New ch
  */

}

async function fetchByPrimaryKey<T>(primaryKeyValue: any, options: Options<T>): Promise<WithDeleted<T>>  {
  const { data, error } = await options.supabaseClient.from(options.table)
      .select()
      .eq(options.primaryKey, primaryKeyValue)
      .limit(1)
  if (error) throw error
  if (data.length != 1) throw 'No row with given primary key'
  return rowToRxDoc(data[0], options)
}

function rowToRxDoc<T>(row: any, options: Options<T>): WithDeleted<T> {
  if (!options.lastModifiedFieldInCollection) {
    delete row[options.lastModifiedFieldName]
  }
  return row as WithDeleted<T>
}
