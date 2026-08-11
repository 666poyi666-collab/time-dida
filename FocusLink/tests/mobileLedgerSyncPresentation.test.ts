import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  countOutstandingLedgerEntities,
  mobileLedgerProjectionVerifiedAt,
  presentMobileLedgerSync,
} from '../src/mobile/ledgerSyncPresentation';

const mobileAppSource = fs.readFileSync(
  path.join(process.cwd(), 'src', 'mobile', 'MobileApp.tsx'),
  'utf8',
);

const base = {
  uploaded: 1,
  downloaded: 2,
  bundleCount: 3,
  outstandingCount: 0,
  conflicts: 0,
  unresolvedConflicts: 0,
  rejected: 0,
};

describe('mobile ledger sync presentation', () => {
  it('only confirms a ledger sync when it has no conflicts or rejected records', () => {
    expect(presentMobileLedgerSync(base)).toMatchObject({
      pullState: 'confirmed',
      lastErrorCode: '',
      notice: '账本同步已确认：补传 1，处理 2 条变更，现有 3 场会话',
    });
  });

  it('keeps conflicts visible and pending instead of reporting confirmation', () => {
    expect(
      presentMobileLedgerSync({
        ...base,
        outstandingCount: 1,
        conflicts: 2,
        unresolvedConflicts: 1,
      }),
    ).toMatchObject({
      pullState: 'partial',
      pendingCount: 1,
      lastErrorCode: 'conflict_present',
    });
  });

  it('keeps rejected records visible and pending instead of reporting confirmation', () => {
    expect(presentMobileLedgerSync({ ...base, outstandingCount: 1, rejected: 2 })).toMatchObject({
      pullState: 'partial',
      pendingCount: 1,
      lastErrorCode: 'rejected_operation',
    });
  });

  it('keeps a deferred retry pending instead of calling the ledger confirmed', () => {
    expect(presentMobileLedgerSync({ ...base, outstandingCount: 1 })).toMatchObject({
      pullState: 'partial',
      pendingCount: 1,
      lastErrorCode: 'sync_failed',
      notice: expect.stringContaining('1 场会话待处理'),
    });
  });

  it('counts the union of legacy bundles and v2 mutations by completed-session identity', () => {
    expect(
      countOutstandingLedgerEntities(
        [
          { entityId: 'session-a', syncDeviceId: null },
          { entityId: 'session-b', syncDeviceId: 'device-current' },
          { entityId: 'session-foreign', syncDeviceId: 'device-old-account' },
        ],
        ['session-a', 'session-a', 'session-c'],
        'device-current',
      ),
    ).toBe(3);
  });

  it.each(['conflict', 'rejected', 'deferred retry'])(
    'does not advance native verification time for a partial %s result',
    () => {
      expect(mobileLedgerProjectionVerifiedAt('partial', 70_000, 90_000)).toBe(70_000);
      expect(mobileLedgerProjectionVerifiedAt('partial', null, 90_000)).toBeNull();
    },
  );

  it('advances native verification time only for a fully confirmed result', () => {
    expect(mobileLedgerProjectionVerifiedAt('confirmed', 70_000, 90_000)).toBe(90_000);
  });

  it('wires the completed-ledger UI through the shared partial-sync policy', () => {
    expect(mobileAppSource).toMatch(
      /import \{[\s\S]*?countOutstandingLedgerEntities,[\s\S]*?mobileLedgerProjectionVerifiedAt,[\s\S]*?presentMobileLedgerSync,[\s\S]*?\} from '\.\/ledgerSyncPresentation';/,
    );
    expect(mobileAppSource).toMatch(
      /presentMobileLedgerSync\(\{[\s\S]*?conflicts:\s*synced\.conflicts,[\s\S]*?unresolvedConflicts:\s*synced\.unresolvedConflicts,[\s\S]*?rejected:\s*synced\.rejected,[\s\S]*?\}\)/,
    );
    expect(mobileAppSource).toContain('countOutstandingLedgerEntities(');
    expect(mobileAppSource).toContain('synced.outstandingEntityIds');
    expect(mobileAppSource).toContain('mobileLedgerProjectionVerifiedAt(');
    expect(mobileAppSource).toContain('presentation.pullState');
    expect(mobileAppSource).toContain('synced.lastVerifiedAt');
    expect(mobileAppSource).toContain('currentV2Status?.lastVerifiedAt ?? null');
    expect(mobileAppSource).not.toContain('lastVerifiedAt: ledger.lastSyncAt');
    expect(mobileAppSource).not.toContain('lastVerifiedAt: cacheRef.current.lastSyncAt');
    expect(mobileAppSource).toContain(
      "import { readMobileV2Bootstrap, readMobileV2Status } from './v2Cache';",
    );
    expect(mobileAppSource).not.toContain('账本同步已确认');
  });
});
