import type { LiveFocusSnapshotLike } from './runtimeModel';
import type { MobileAuthorityMode } from './cache';

export interface RemoteForkEvidence {
  sessionId: string;
  revision: number;
  detectedAt: number;
}

export function resolveMobileAuthorityMode(input: {
  hasLocalSession: boolean;
  connectionConfigured: boolean;
  connectionLive: boolean;
  remote: LiveFocusSnapshotLike | null;
  localSessionId: string | null;
}): MobileAuthorityMode {
  if (!input.hasLocalSession) return 'cloud-live';
  if (!input.connectionConfigured || !input.connectionLive) return 'local-offline';
  if (isDifferentActiveRemote(input.remote, input.localSessionId)) return 'forked-local';
  return 'reconnecting';
}

export function remoteForkEvidence(
  remote: LiveFocusSnapshotLike | null,
  localSessionId: string | null,
  detectedAt = Date.now(),
): RemoteForkEvidence | null {
  if (!isDifferentActiveRemote(remote, localSessionId) || !remote?.sessionId) return null;
  return { sessionId: remote.sessionId, revision: remote.revision, detectedAt };
}

export function isDifferentActiveRemote(
  remote: LiveFocusSnapshotLike | null,
  localSessionId: string | null,
): boolean {
  return (
    remote !== null &&
    remote.state !== 'idle' &&
    remote.sessionId !== null &&
    remote.sessionId !== localSessionId
  );
}
