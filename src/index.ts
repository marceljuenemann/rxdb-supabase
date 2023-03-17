import { RxCollection, addRxPlugin, RxReplicationWriteToMasterRow, ReplicationPullHandlerResult, WithDeleted } from 'rxdb'
import { RxReplicationState, startReplicationOnLeaderShip } from 'rxdb/plugins/replication'
import { RxDBLeaderElectionPlugin } from 'rxdb/plugins/leader-election'

// TODO: Just don't import these and work around the fact rxdb doesn't expose them
import type { ReplicationOptions, ReplicationPullOptions, ReplicationPushOptions } from 'rxdb/types'

import { SupabaseClient } from '@supabase/supabase-js'

// TODO: move to types

const POSTGRES_DUPLICATE_KEY_ERROR_CODE = '23505'

/**
 * Checkpoints are used to store until which point the client and supabase have been
 * synced. For that we use the last modified timestamp that must be present on each
 * row, as well as the primary key.
 */
export type SupabaseCheckpoint = {
  moddatetime: string
  primaryKeyValue: string
};

export class RxSupabaseReplicationState<RxDocType> extends RxReplicationState<RxDocType, SupabaseCheckpoint> {
  // TODO: Not really a fan of this long constructor list...
  // TODO: can just pass in the options, really
  // TODO: Seems like we don't really need this class at all? Or are we responsible for setting
  // the defaults? Really?
  constructor(
      //public readonly firestore: FirestoreOptions<RxDocType>,
      replicationIdentifierHash: string,
      collection: RxCollection<RxDocType>,
      pull?: ReplicationPullOptions<RxDocType, SupabaseCheckpoint>,
      push?: ReplicationPushOptions<RxDocType>,
      live: boolean = true,
      retryTime: number = 1000 * 5,
      autoStart: boolean = true
  ) {
      super(
          replicationIdentifierHash,
          collection,
          '_deleted',  // TODO: configurable
          pull,
          push,
          live,
          retryTime,
          autoStart
      );
  }
}

export type SupabaseReplicationOptions<RxDocType> = Omit<
    ReplicationOptions<RxDocType, any>,
    'replicationIdentifier' // TODO: require from user?
    | 'deletedField' // TODO
    | 'pull' // TODO
    | 'push'
  > & {
  supabaseClient: SupabaseClient,
  pull?: Omit<ReplicationPullOptions<RxDocType, SupabaseCheckpoint>, 'handler' | 'stream$'>;
  push?: Omit<ReplicationPushOptions<RxDocType>, 'handler' | 'batchSize'>
}

export function replicateSupabase<RxDocType>(options: SupabaseReplicationOptions<RxDocType>) {
  options.live = typeof options.live === 'undefined' ? true : options.live;
  options.waitForLeadership = typeof options.waitForLeadership === 'undefined' ? true : options.waitForLeadership;
  addRxPlugin(RxDBLeaderElectionPlugin)

  console.log("Replicating now...")
  // TODO: Do something about auth changes in the SupabaseClient? Well, probably just
  // require the caller to cancel the replication when the user changes to something they
  // no longer want :) Maybe just force users to pass in the replication ID

  //const pullStream$: Subject<RxReplicationPullStreamItem<RxDocType, FirestoreCheckpointType>> = new Subject();
  //let replicationPrimitivesPull: ReplicationPullOptions<RxDocType, FirestoreCheckpointType> | undefined;
  
  
  //const serverTimestampField = typeof options.serverTimestampField === 'undefined' ? 'serverTimestamp' : options.serverTimestampField;
  //options.serverTimestampField = serverTimestampField;
  //const primaryPath = collection.schema.primaryPath;


  // TODO: Why does firebase replication not allow the serverTimestamp in the collection?
  // Don't see a problem with allowing that here.


  // TODO: check that either pull or push are present


  const replicationState = new RxSupabaseReplicationState<RxDocType>(
    // options.firestore,
    // FIRESTORE_REPLICATION_PLUGIN_IDENTITY_PREFIX + options.collection.database.hashFunction(options.firestore.projectId),
    'myid', // TODO: add to options, just prefix with my plugin name. Not allowed to use hyphen...
    options.collection,
    options.pull && pullHandler(options),
    options.push && pushHandler(options),
    options.live,
    options.retryTime,
    options.autoStart
  );

  // Starting the replication as soon as leadership has been decided.
  startReplicationOnLeaderShip(options.waitForLeadership, replicationState);
  return replicationState;
}

function pullHandler<T>(options: SupabaseReplicationOptions<T>): ReplicationPullOptions<T, SupabaseCheckpoint> {
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

// TODO: maybe move to push.ts? Might not be needed, but rename this file to something nicer.
// TODO: support larger batch sizes to enable bulk insertion.
function pushHandler<T>(options: SupabaseReplicationOptions<T>): ReplicationPushOptions<T> {
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
