import { ScheduledSyncDisabledError } from './errors.js';

export type SyncActor = { type: 'session'; sessionId: string } | { type: 'job'; jobId: string };

export function authorizeSync(actor: SyncActor, scheduledSyncEnabled: boolean): void {
  if (actor.type === 'job' && !scheduledSyncEnabled) {
    throw new ScheduledSyncDisabledError();
  }
}
