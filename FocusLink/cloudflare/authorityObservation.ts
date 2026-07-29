export const FOCUSLINK_AUTHORITY_OBSERVATION_PATH = '/internal/authority-observation/v1' as const;
export const FOCUSLINK_AUTHORITY_OBSERVATION_MEDIA_TYPE =
  'application/vnd.poyi.authority-observation.v1+json' as const;
export const FOCUSLINK_AUTHORITY_PRODUCT_ID = 'focuslink' as const;
export const FOCUSLINK_AUTHORITY_OBSERVATION_TTL_MS = 5 * 60 * 1000;
export const FOCUSLINK_AUTHORITY_FRESH_MS = 15 * 60 * 1000;

export type FocusLinkAuthorityFreshness = 'fresh' | 'stale' | 'offline' | 'blocked' | 'unknown';

export interface FocusLinkAuthorityTruth {
  revision: number;
  freshness: FocusLinkAuthorityFreshness;
  lastVerifiedAt: string;
  pendingCount: number;
  blockerReason: string | null;
  pcOff: {
    readAvailable: boolean;
    writeAvailable: boolean;
    continuedSync: boolean;
  };
}

export interface FocusLinkAuthorityObservation {
  schemaVersion: 1;
  productId: typeof FOCUSLINK_AUTHORITY_PRODUCT_ID;
  audience: string;
  observedAt: string;
  expiresAt: string;
  truth: FocusLinkAuthorityTruth;
}

export interface FocusLinkAuthorityCheckpointInput {
  revision: number;
  audience: string;
  observedAtMs: number;
  lastVerifiedAtMs: number;
  pendingCount: number;
  blockerReason: string | null;
  readAvailable: boolean;
  writeAvailable: boolean;
  continuedSync: boolean;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function hasExactKeys(value: Record<string, unknown>, expected: readonly string[]): boolean {
  const actual = Object.keys(value).sort();
  const sortedExpected = [...expected].sort();
  return (
    actual.length === sortedExpected.length &&
    actual.every((key, index) => key === sortedExpected[index])
  );
}

function isTimestamp(value: unknown): value is string {
  if (typeof value !== 'string' || !/(?:Z|[+-]\d{2}:\d{2})$/.test(value)) return false;
  return Number.isFinite(Date.parse(value));
}

function isNonNegativeSafeInteger(value: unknown): value is number {
  return Number.isSafeInteger(value) && Number(value) >= 0;
}

export function exactFocusLinkAuthorityAudience(value: unknown): string | null {
  if (typeof value !== 'string' || value.endsWith('/')) return null;
  try {
    const url = new URL(value);
    if (
      url.protocol !== 'https:' ||
      !url.hostname ||
      url.username ||
      url.password ||
      url.search ||
      url.hash ||
      url.pathname !== `/authority/${FOCUSLINK_AUTHORITY_PRODUCT_ID}` ||
      url.href !== value
    ) {
      return null;
    }
    return value;
  } catch {
    return null;
  }
}

export function buildFocusLinkAuthorityObservation(
  input: FocusLinkAuthorityCheckpointInput,
): FocusLinkAuthorityObservation {
  if (
    !Number.isSafeInteger(input.revision) ||
    input.revision < 1 ||
    !Number.isSafeInteger(input.observedAtMs) ||
    input.observedAtMs < 0 ||
    !Number.isSafeInteger(input.lastVerifiedAtMs) ||
    input.lastVerifiedAtMs < 0 ||
    input.lastVerifiedAtMs > input.observedAtMs ||
    !isNonNegativeSafeInteger(input.pendingCount) ||
    (input.continuedSync && (!input.readAvailable || !input.writeAvailable)) ||
    (input.blockerReason === null && input.pendingCount !== 0) ||
    (input.pendingCount > 0 && input.blockerReason === null)
  ) {
    throw new Error('authority checkpoint is invalid');
  }
  const audience = exactFocusLinkAuthorityAudience(input.audience);
  if (!audience) throw new Error('authority audience is invalid');
  const freshness: FocusLinkAuthorityFreshness = input.blockerReason === null ? 'fresh' : 'blocked';
  const observation: FocusLinkAuthorityObservation = {
    schemaVersion: 1,
    productId: FOCUSLINK_AUTHORITY_PRODUCT_ID,
    audience,
    observedAt: new Date(input.observedAtMs).toISOString(),
    expiresAt: new Date(input.observedAtMs + FOCUSLINK_AUTHORITY_OBSERVATION_TTL_MS).toISOString(),
    truth: {
      revision: input.revision,
      freshness,
      lastVerifiedAt: new Date(input.lastVerifiedAtMs).toISOString(),
      pendingCount: input.pendingCount,
      blockerReason: input.blockerReason,
      pcOff: {
        readAvailable: input.readAvailable,
        writeAvailable: input.writeAvailable,
        continuedSync: input.continuedSync,
      },
    },
  };
  if (!validateFocusLinkAuthorityObservation(observation, input.observedAtMs)) {
    throw new Error('authority observation is invalid');
  }
  return observation;
}

export function validateFocusLinkAuthorityObservation(
  value: unknown,
  nowMs = Date.now(),
): value is FocusLinkAuthorityObservation {
  if (
    !isRecord(value) ||
    !hasExactKeys(value, [
      'schemaVersion',
      'productId',
      'audience',
      'observedAt',
      'expiresAt',
      'truth',
    ]) ||
    value.schemaVersion !== 1 ||
    value.productId !== FOCUSLINK_AUTHORITY_PRODUCT_ID ||
    exactFocusLinkAuthorityAudience(value.audience) === null ||
    !isTimestamp(value.observedAt) ||
    !isTimestamp(value.expiresAt) ||
    !isRecord(value.truth)
  ) {
    return false;
  }
  const observedAt = Date.parse(value.observedAt);
  const expiresAt = Date.parse(value.expiresAt);
  if (expiresAt <= observedAt || expiresAt <= nowMs) return false;
  const truth = value.truth;
  if (
    !hasExactKeys(truth, [
      'revision',
      'freshness',
      'lastVerifiedAt',
      'pendingCount',
      'blockerReason',
      'pcOff',
    ]) ||
    !Number.isSafeInteger(truth.revision) ||
    Number(truth.revision) < 1 ||
    !['fresh', 'stale', 'offline', 'blocked', 'unknown'].includes(String(truth.freshness)) ||
    !isTimestamp(truth.lastVerifiedAt) ||
    !isNonNegativeSafeInteger(truth.pendingCount) ||
    !(truth.blockerReason === null || typeof truth.blockerReason === 'string') ||
    !isRecord(truth.pcOff)
  ) {
    return false;
  }
  if (Date.parse(truth.lastVerifiedAt) > observedAt) return false;
  const pcOff = truth.pcOff;
  if (
    !hasExactKeys(pcOff, ['readAvailable', 'writeAvailable', 'continuedSync']) ||
    ![pcOff.readAvailable, pcOff.writeAvailable, pcOff.continuedSync].every(
      (item) => typeof item === 'boolean',
    ) ||
    (pcOff.continuedSync && !(pcOff.readAvailable && pcOff.writeAvailable))
  ) {
    return false;
  }
  if (truth.freshness === 'fresh' && (truth.pendingCount !== 0 || truth.blockerReason !== null)) {
    return false;
  }
  if (Number(truth.pendingCount) > 0 && truth.freshness !== 'blocked') return false;
  if (truth.blockerReason === null && truth.freshness === 'blocked') return false;
  if (truth.blockerReason !== null && truth.freshness !== 'blocked') return false;
  return true;
}
