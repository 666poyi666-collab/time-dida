export interface CleanupSummary {
  files: number;
  directories: number;
  bytes: number;
}

export interface CleanupCandidate {
  path: string;
  root: string;
  reason: string;
  stat: unknown;
}

export interface CleanupPlanOptions {
  focuslinkRoot: string;
  workspaceRoot: string;
  externalRoots?: string[];
  now?: number;
  maxAgeMs?: number;
}

export interface CleanupResult {
  mode: 'dry-run' | 'apply';
  maxAgeMs: number;
  protected: string[];
  candidates: Array<{
    path: string;
    reason: string;
    summary: CleanupSummary | null;
    inspectError?: string;
  }>;
  removed: Array<{
    path: string;
    removed: boolean;
    attempts: number;
    summary: CleanupSummary | null;
  }>;
  failed: Array<{ path: string; error: string }>;
}

export function assertSafeDirectChild(target: string, allowedRoot: string): unknown | null;
export function assertFocusLinkProjectRoot(root: string): string;
export function removePathWithRetry(
  target: string,
  options?: { maxAttempts?: number; allowedRoot?: string },
): Promise<{ removed: boolean; attempts: number }>;
export function buildCleanupPlan(options: CleanupPlanOptions): CleanupCandidate[];
export function runCleanup(
  options?: Partial<CleanupPlanOptions> & {
    apply?: boolean;
  },
): Promise<CleanupResult>;
