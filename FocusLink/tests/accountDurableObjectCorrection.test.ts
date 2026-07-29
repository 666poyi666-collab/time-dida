import { describe, expect, it, vi } from 'vitest';

vi.mock('cloudflare:workers', () => ({
  DurableObject: class {
    constructor() {}
  },
}));

import {
  correctionPayloadsEquivalent,
  historicalCorrectionConflictMatches,
} from '../cloudflare/accountDurableObject';
import type { FocusLedgerCorrectionV2, FocusLedgerV2 } from '../shared/sync/v2Protocol';

function ledger(activeElapsedMs = 25_000): FocusLedgerV2 {
  return {
    sessionId: 'session-correction',
    startedAt: 1_000,
    endedAt: 31_000,
    status: 'finished',
    activeElapsedMs,
    pausedElapsedMs: 5_000,
    wallElapsedMs: 30_000,
    originDeviceId: 'device-desktop',
    segments: [],
    pauses: [],
  };
}

function correction(createdAt: number, after = ledger(26_000)): FocusLedgerCorrectionV2 {
  return {
    correctionId: 'correction-session-correction',
    sessionId: 'session-correction',
    baseLedgerRevision: 7,
    before: ledger(),
    after,
    reason: 'local_ledger_changed_after_sync',
    createdAt,
    createdByDeviceId: 'device-desktop',
  };
}

describe('Account DO historical correction conflict repair', () => {
  it('treats only createdAt drift as a semantic duplicate', () => {
    expect(correctionPayloadsEquivalent(correction(100), correction(200))).toBe(true);
    expect(correctionPayloadsEquivalent(correction(100), correction(200, ledger(27_000)))).toBe(
      false,
    );
  });

  it('matches only the historical revision-only synthetic conflict shape', () => {
    const canonical = correction(100);
    const incoming = correction(200);
    const conflict = {
      base_json: null,
      local_json: JSON.stringify(incoming),
      remote_json: JSON.stringify(canonical),
      fields_json: '["revision"]',
    };

    expect(historicalCorrectionConflictMatches(conflict, incoming, JSON.stringify(canonical))).toBe(
      true,
    );
    expect(
      historicalCorrectionConflictMatches(
        { ...conflict, base_json: JSON.stringify(canonical.before) },
        incoming,
        JSON.stringify(canonical),
      ),
    ).toBe(false);
    expect(
      historicalCorrectionConflictMatches(
        { ...conflict, fields_json: '["ledger"]' },
        incoming,
        JSON.stringify(canonical),
      ),
    ).toBe(false);
    expect(
      historicalCorrectionConflictMatches(
        { ...conflict, local_json: JSON.stringify(correction(200, ledger(27_000))) },
        incoming,
        JSON.stringify(canonical),
      ),
    ).toBe(false);
  });
});
