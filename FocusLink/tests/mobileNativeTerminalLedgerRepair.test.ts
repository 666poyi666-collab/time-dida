import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import {
  presentNativePermissionItems,
  TerminalLedgerRepairControl,
  terminalLedgerRequeueFailureCopy,
  terminalLedgerRequeueNotice,
} from '../src/mobile/NativeSystemControls';

vi.mock('@capacitor/core', () => ({
  Capacitor: {
    isNativePlatform: () => false,
    isPluginAvailable: () => false,
  },
  registerPlugin: () => ({}),
}));

describe('mobile native terminal-ledger repair control', () => {
  it('lets fresh system readback replace a stale root permission batch', () => {
    expect(
      presentNativePermissionItems(
        {
          canPostNotification: true,
          overlayPermissionGranted: true,
          batteryOptimizationExempt: false,
          backgroundAppOpsAllowed: true,
        },
        {
          rootAvailable: true,
          attemptedAtEpochMs: 10,
          items: [
            {
              id: 'overlay',
              state: 'not-granted',
              verified: false,
              commandAttempted: true,
              commandSucceeded: true,
            },
            {
              id: 'battery',
              state: 'granted',
              verified: true,
              commandAttempted: true,
              commandSucceeded: true,
            },
          ],
        },
      ),
    ).toEqual([
      { id: 'notification', state: 'granted' },
      { id: 'overlay', state: 'granted' },
      { id: 'battery', state: 'not-granted' },
      { id: 'background', state: 'granted' },
      { id: 'autostart', state: 'manual-required' },
    ]);
  });

  it('renders no repair affordance until native diagnostics report a terminal record', () => {
    const onRequeue = vi.fn();
    expect(
      renderToStaticMarkup(
        createElement(TerminalLedgerRepairControl, {
          count: 0,
          errorCode: undefined,
          disabled: false,
          requeueing: false,
          onRequeue,
        }),
      ),
    ).toBe('');

    const markup = renderToStaticMarkup(
      createElement(TerminalLedgerRepairControl, {
        count: 2,
        errorCode: 'conflict_present',
        disabled: false,
        requeueing: false,
        onRequeue,
      }),
    );
    expect(markup).toContain('请先在电脑端处理冲突或拒绝');
    expect(markup).toContain('不会自动重试');
    expect(markup).toContain('重新检查已结束专注');
  });

  it('keeps zero and failure outcomes safe and never reflects a native raw error', () => {
    expect(terminalLedgerRequeueNotice(0)).toContain('没有可重新检查');
    expect(terminalLedgerRequeueNotice(2)).toContain('仅本次由你手动触发');
    expect(terminalLedgerRequeueFailureCopy({ code: 'stale_connection' })).toContain(
      '账号连接已变化',
    );
    expect(terminalLedgerRequeueFailureCopy({ code: 'upstream_internal_secret' })).not.toContain(
      'upstream_internal_secret',
    );
  });
});
