import { describe, expect, it } from 'vitest';
import { remoteForkEvidence, resolveMobileAuthorityMode } from '../src/mobile/authorityPolicy';
import { idleLiveFocusSnapshot, type LiveFocusSnapshotLike } from '../src/mobile/runtimeModel';

function remote(sessionId: string): LiveFocusSnapshotLike {
  return {
    ...idleLiveFocusSnapshot(7, 10_000),
    state: 'running',
    sessionId,
    title: '远端会话',
  };
}

describe('mobile authority policy', () => {
  it('uses cloud-live only when no local session owns control', () => {
    expect(
      resolveMobileAuthorityMode({
        hasLocalSession: false,
        connectionConfigured: true,
        connectionLive: true,
        remote: remote('cloud-a'),
        localSessionId: null,
      }),
    ).toBe('cloud-live');
  });

  it('keeps a disconnected local session locally authoritative', () => {
    expect(
      resolveMobileAuthorityMode({
        hasLocalSession: true,
        connectionConfigured: false,
        connectionLive: false,
        remote: null,
        localSessionId: 'local-a',
      }),
    ).toBe('local-offline');
  });

  it('uses reconnecting while confirming a non-conflicting remote state', () => {
    expect(
      resolveMobileAuthorityMode({
        hasLocalSession: true,
        connectionConfigured: true,
        connectionLive: true,
        remote: idleLiveFocusSnapshot(),
        localSessionId: 'local-a',
      }),
    ).toBe('reconnecting');
  });

  it('forks only for a different active remote session id', () => {
    const evidence = remoteForkEvidence(remote('cloud-b'), 'local-a', 12_345);
    expect(evidence).toEqual({ sessionId: 'cloud-b', revision: 7, detectedAt: 12_345 });
    expect(remoteForkEvidence(remote('local-a'), 'local-a')).toBeNull();
    expect(
      resolveMobileAuthorityMode({
        hasLocalSession: true,
        connectionConfigured: true,
        connectionLive: true,
        remote: remote('cloud-b'),
        localSessionId: 'local-a',
      }),
    ).toBe('forked-local');
  });
});
