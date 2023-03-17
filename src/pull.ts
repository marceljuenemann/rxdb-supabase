import type { ReplicationPullHandlerResult, ReplicationPullOptions } from "./rxdb-internal-types.js"
import { SupabaseCheckpoint, SupabaseReplicationOptions } from "./index.js"


export function pullHandler<T>(options: SupabaseReplicationOptions<T>): ReplicationPullOptions<T, SupabaseCheckpoint> {
  return {
    ...options,
    stream$: undefined, // TODO
    handler: (lastPulledCheckpoint: SupabaseCheckpoint, batchSize: number): Promise<ReplicationPullHandlerResult<T, SupabaseCheckpoint>> => {
      console.log("Pulling changes...", lastPulledCheckpoint, batchSize)
      return Promise.resolve({
        checkpoint: lastPulledCheckpoint,
        documents: []
      })
    }
  }
}
