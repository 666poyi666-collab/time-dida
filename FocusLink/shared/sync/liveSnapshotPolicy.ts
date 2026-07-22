import type { LiveFocusState } from './liveFocusProtocol';

export interface LiveSnapshotVersion {
  revision: number;
  state: LiveFocusState;
  sessionId: string | null;
  serverTime: number;
}

/** Compare-and-swap register ordering shared by desktop, Web and Android renderers. */
export function shouldAcceptLiveSnapshot(
  current: LiveSnapshotVersion | null,
  incoming: LiveSnapshotVersion,
): boolean {
  if (!current) return true;
  if (incoming.revision !== current.revision) return incoming.revision > current.revision;
  if (incoming.state !== current.state || incoming.sessionId !== current.sessionId) return false;
  return incoming.serverTime >= current.serverTime;
}

export function liveSnapshotVersion(input: {
  snapshot: { revision: number; state: LiveFocusState; session: { id: string } | null };
  serverTime: number;
}): LiveSnapshotVersion {
  return {
    revision: input.snapshot.revision,
    state: input.snapshot.state,
    sessionId: input.snapshot.session?.id ?? null,
    serverTime: input.serverTime,
  };
}
