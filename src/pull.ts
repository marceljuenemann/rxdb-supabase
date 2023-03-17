import type { ReplicationPullHandlerResult, ReplicationPullOptions } from "./rxdb-internal-types.js"
import { SupabaseReplicationCheckpoint, SupabaseReplicationOptions } from "./index.js"


export function pullHandler<T>(options: SupabaseReplicationOptions<T>): ReplicationPullOptions<T, SupabaseReplicationCheckpoint> {
  return {
    ...options,
    stream$: undefined, // TODO
    handler: (lastPulledCheckpoint: SupabaseReplicationCheckpoint, batchSize: number): Promise<ReplicationPullHandlerResult<T, SupabaseReplicationCheckpoint>> => {
      console.log("Pulling changes...", lastPulledCheckpoint, batchSize)
      return Promise.resolve({
        checkpoint: lastPulledCheckpoint,
        documents: []
      })
    }
  }
}
