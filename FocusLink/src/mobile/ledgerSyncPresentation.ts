export interface MobileLedgerSyncPresentationInput {
  uploaded: number;
  downloaded: number;
  bundleCount: number;
  /** Unique completed-ledger entity count across legacy and Sync v2 durable queues. */
  outstandingCount: number;
  conflicts: number;
  unresolvedConflicts: number;
  rejected: number;
}

export interface MobileLedgerSyncPresentation {
  pullState: 'confirmed' | 'partial';
  notice: string;
  pendingCount: number;
  lastErrorCode: '' | 'conflict_present' | 'rejected_operation' | 'sync_failed';
}

interface LedgerEntityReference {
  entityId: string;
  syncDeviceId?: string | null;
}

function nonNegativeCount(value: number): number {
  return Number.isSafeInteger(value) && value > 0 ? value : 0;
}

export function countOutstandingLedgerEntities(
  legacyRecords: readonly LedgerEntityReference[],
  v2EntityIds: readonly string[],
  currentDeviceId?: string,
): number {
  const entityIds = new Set<string>();
  for (const record of legacyRecords) {
    if (
      currentDeviceId &&
      record.syncDeviceId !== null &&
      record.syncDeviceId !== undefined &&
      record.syncDeviceId !== currentDeviceId
    ) {
      continue;
    }
    const entityId = record.entityId.trim();
    if (entityId) entityIds.add(entityId);
  }
  for (const rawEntityId of v2EntityIds) {
    const entityId = rawEntityId.trim();
    if (entityId) entityIds.add(entityId);
  }
  return entityIds.size;
}

export function mobileLedgerProjectionVerifiedAt(
  pullState: MobileLedgerSyncPresentation['pullState'],
  previousVerifiedAt: number | null,
  confirmedAt: number,
): number | null {
  if (pullState !== 'confirmed') return previousVerifiedAt;
  return Number.isSafeInteger(confirmedAt) && confirmedAt >= 0 ? confirmedAt : previousVerifiedAt;
}

/**
 * A successful HTTP exchange is not an acknowledged ledger sync when it leaves
 * conflicts or rejected records behind. Keep that distinction in one pure
 * presentation policy so the UI, durable diagnostic code and pending counter
 * cannot accidentally disagree.
 */
export function presentMobileLedgerSync(
  input: MobileLedgerSyncPresentationInput,
): MobileLedgerSyncPresentation {
  const conflicts = Math.max(
    nonNegativeCount(input.conflicts),
    nonNegativeCount(input.unresolvedConflicts),
  );
  const rejected = nonNegativeCount(input.rejected);
  const outstanding = nonNegativeCount(input.outstandingCount);
  const pendingCount = Math.max(outstanding, conflicts > 0 || rejected > 0 ? 1 : 0);

  if (pendingCount > 0 || conflicts > 0 || rejected > 0) {
    const outstanding = [
      pendingCount > 0 ? `${pendingCount} 场会话待处理` : null,
      conflicts > 0 ? `${conflicts} 条冲突` : null,
      rejected > 0 ? `${rejected} 条被拒绝` : null,
    ]
      .filter(Boolean)
      .join('、');
    return {
      pullState: 'partial',
      notice: `账本部分同步：${outstanding}已安全保留，待处理记录不会丢失`,
      pendingCount,
      lastErrorCode:
        conflicts > 0 ? 'conflict_present' : rejected > 0 ? 'rejected_operation' : 'sync_failed',
    };
  }

  const bundleCount = nonNegativeCount(input.bundleCount);
  return {
    pullState: 'confirmed',
    notice:
      input.downloaded > 0 || input.uploaded > 0
        ? `账本同步已确认：补传 ${input.uploaded}，处理 ${input.downloaded} 条变更，现有 ${bundleCount} 场会话`
        : `账本同步已确认：没有新变更，保留 ${bundleCount} 场会话`,
    pendingCount,
    lastErrorCode: '',
  };
}
