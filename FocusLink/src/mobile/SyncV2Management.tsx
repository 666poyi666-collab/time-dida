import { AlertTriangle, ArchiveRestore, Laptop, RefreshCw } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { isCanonicalFocusLinkDeviceConnection } from '@shared/sync/identityProtocol';
import {
  createMobileAccountRequestLifecycle,
  mobileAccountConnectionKey,
} from './accountLifecycle';

interface Summary {
  devices: Array<{
    deviceId: string;
    displayName: string;
    lastSeenAt: number;
    stale: boolean;
    revokedAt: number | null;
  }>;
  conflicts: Array<{ conflict_id: string; entity_id: string; status: string; fields: string[] }>;
  trash: Array<{ entity_id: string; entity_type: string; deleted_at: number; purge_after: number }>;
}

export function SyncV2Management({ endpoint, token }: { endpoint: string; token: string }) {
  const [summary, setSummary] = useState<Summary | null>(null);
  const [error, setError] = useState<string | null>(null);
  const requests = useRef(createMobileAccountRequestLifecycle()).current;
  const refresh = useCallback(async () => {
    if (!endpoint || !token) {
      requests.invalidate();
      setSummary(null);
      setError(null);
      return;
    }
    const request = requests.issue(mobileAccountConnectionKey({ endpoint, token }));
    setSummary(null);
    setError(null);
    try {
      const [devices, conflicts, trash] = await Promise.all([
        get<{ devices?: Summary['devices'] }>(endpoint, token, '/v2/devices', request.signal),
        get<{ conflicts?: Summary['conflicts'] }>(endpoint, token, '/v2/conflicts', request.signal),
        get<{ items?: Summary['trash'] }>(endpoint, token, '/v2/trash', request.signal),
      ]);
      if (!request.isCurrent()) return;
      setSummary({
        devices: devices.devices ?? [],
        conflicts: conflicts.conflicts ?? [],
        trash: trash.items ?? [],
      });
    } catch (cause) {
      if (!request.isCurrent()) return;
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      request.finish();
    }
  }, [endpoint, requests, token]);
  useEffect(() => {
    void refresh();
    return () => requests.invalidate();
  }, [refresh, requests]);
  if (!endpoint || !token) return null;
  return (
    <section className="sync-v2-management" aria-labelledby="sync-v2-management-title">
      <div className="settings-section-heading">
        <div>
          <p className="eyebrow">SYNC V2</p>
          <h3 id="sync-v2-management-title">设备与数据处理</h3>
        </div>
        <button
          type="button"
          className="icon-button"
          onClick={() => void refresh()}
          title="刷新同步状态"
        >
          <RefreshCw aria-hidden="true" />
          <span className="sr-only">刷新同步状态</span>
        </button>
      </div>
      {error && <p className="settings-section-note">{error}</p>}
      <div className="settings-status-grid">
        <SummaryLine icon={Laptop} label="设备" value={`${summary?.devices.length ?? 0} 台`} />
        <SummaryLine
          icon={AlertTriangle}
          label="冲突"
          value={`${summary?.conflicts.filter((item) => item.status === 'open').length ?? 0} 项`}
        />
        <SummaryLine
          icon={ArchiveRestore}
          label="回收站"
          value={`${summary?.trash.length ?? 0} 项`}
        />
      </div>
      {summary?.conflicts
        .filter((item) => item.status === 'open')
        .map((item) => (
          <div className="sync-v2-diagnostic-row" key={item.conflict_id}>
            <strong>{item.entity_id}</strong>
            <span>{item.fields.join('、') || 'revision'}</span>
          </div>
        ))}
    </section>
  );
}

function SummaryLine({
  icon: Icon,
  label,
  value,
}: {
  icon: typeof Laptop;
  label: string;
  value: string;
}) {
  return (
    <div className="settings-status-line">
      <Icon aria-hidden="true" />
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}
async function get<T>(
  endpoint: string,
  token: string,
  path: string,
  signal: AbortSignal,
): Promise<T> {
  if (!isCanonicalFocusLinkDeviceConnection(endpoint, token)) {
    throw new Error('设备凭据只能连接 FocusLink 官方同步服务');
  }
  const response = await fetch(`${endpoint}${path}`, {
    headers: { authorization: `Bearer ${token.trim()}` },
    cache: 'no-store',
    credentials: 'omit',
    redirect: 'error',
    signal,
  });
  if (!response.ok) throw new Error(`Sync v2 ${path} HTTP ${response.status}`);
  return response.json() as Promise<T>;
}
