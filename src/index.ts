import { RxReplicationState, startReplicationOnLeaderShip } from 'rxdb/plugins/replication'
import { SupabaseClient } from '@supabase/supabase-js'

import type { ReplicationOptions, ReplicationPullOptions, ReplicationPushOptions } from './rxdb-internal-types.js'

import { pullHandler } from './pull.js'
import { pushHandler } from './push.js'

export type SupabaseReplicationOptions<RxDocType> = {
  supabaseClient: SupabaseClient,
  // TODO: allow stream$ for custom postgresChanges listener
  pull?: Omit<ReplicationPullOptions<RxDocType, SupabaseReplicationCheckpoint>, 'handler' | 'stream$'>;
  // TODO: enable custom batch size (currently always one row at a time)
  push?: Omit<ReplicationPushOptions<RxDocType>, 'handler' | 'batchSize'>
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

export function replicateSupabase<RxDocType>(options: SupabaseReplicationOptions<RxDocType>) {
  options.live = typeof options.live === 'undefined' ? true : options.live;
  //const serverTimestampField = typeof options.serverTimestampField === 'undefined' ? 'serverTimestamp' : options.serverTimestampField;
  
  const replicationState = new RxReplicationState<RxDocType, SupabaseReplicationCheckpoint>(
    options.replicationIdentifier,
    options.collection,
    options.deletedField || '_deleted',
    options.pull && pullHandler(options),
    options.push && pushHandler(options),
    options.live,
    options.retryTime,
    options.autoStart
  );
 
  // Starts the replication if autoStart is true (or absent).
  startReplicationOnLeaderShip(false, replicationState);
  return replicationState;
}
