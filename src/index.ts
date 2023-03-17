import { RxReplicationState, startReplicationOnLeaderShip } from 'rxdb/plugins/replication'
import { SupabaseClient } from '@supabase/supabase-js'

import type { ReplicationOptions, ReplicationPullOptions, ReplicationPushOptions } from './rxdb-internal-types.js'

import { pullHandler } from './pull.js'
import { pushHandler } from './push.js'
import { type } from 'os'

const DEFAULT_LAST_MODIFIED_FIELD = '_modified'
const DEFAULT_DELETED_FIELD = '_deleted'

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
  const table = options.table || options.collection.name
  // TODO: can push these into pull.ts probably
  const primaryKey = options.primaryKey || options.collection.schema.primaryPath
  const lastModifiedFieldName = options.lastModifiedFieldName || DEFAULT_LAST_MODIFIED_FIELD
  const live = typeof options.live === 'undefined' ? true : options.live
  //const serverTimestampField = typeof options.serverTimestampField === 'undefined' ? 'serverTimestamp' : options.serverTimestampField;
  
  const replicationState = new RxReplicationState<RxDocType, SupabaseReplicationCheckpoint>(
    options.replicationIdentifier,
    options.collection,
    options.deletedField || DEFAULT_DELETED_FIELD,
    options.pull && pullHandler({...options, table, primaryKey, lastModifiedFieldName}),
    options.push && pushHandler({...options, table, primaryKey, lastModifiedFieldName}),
    live,
    options.retryTime,
    typeof options.autoStart === 'undefined' ? true : options.autoStart 
  );
 
  // Starts the replication if autoStart is true (or absent).
  startReplicationOnLeaderShip(false, replicationState);
  return replicationState;
}
