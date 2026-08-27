import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { FocusConsole } from '../src/mobile/FocusConsole';
import { idleLiveFocusSnapshot } from '../src/mobile/runtimeModel';
import {
  TABLET_FOCUS_MIN_SHORT_EDGE,
  TABLET_FOCUS_MIN_WIDTH,
  focusDeviceLabel,
  isWatchFocusViewport,
  isTabletFocusViewport,
} from '../src/mobile/viewportPolicy';

describe('mobile FocusLink viewport policy', () => {
  it('keeps portrait and wide landscape phones out of tablet-only UI', () => {
    expect(isTabletFocusViewport(393, 852)).toBe(false);
    expect(isTabletFocusViewport(412, 915)).toBe(false);
    expect(isTabletFocusViewport(915, 412)).toBe(false);
  });

  it('enables the tablet module when the viewport short edge reaches the Huawei boundary', () => {
    expect(TABLET_FOCUS_MIN_SHORT_EDGE).toBe(620);
    expect(TABLET_FOCUS_MIN_WIDTH).toBe(620);
    expect(isTabletFocusViewport(619, 1_024)).toBe(false);
    expect(isTabletFocusViewport(620, 1_024)).toBe(true);
    expect(isTabletFocusViewport(640, 1_024)).toBe(true);
    expect(isTabletFocusViewport(760, 1_024)).toBe(true);
    expect(isTabletFocusViewport(1_024, 640)).toBe(true);
  });

  it('renders tablet display controls only for true tablet profiles', () => {
    const originalWindow = Object.getOwnPropertyDescriptor(globalThis, 'window');
    try {
      expect(renderActiveConsole(915, 412)).not.toContain('aria-label="平板专注显示"');
      expect(renderActiveConsole(640, 1_024)).toContain('aria-label="平板专注显示"');
      expect(renderActiveConsole(760, 1_024)).toContain('aria-label="平板专注显示"');
    } finally {
      if (originalWindow) Object.defineProperty(globalThis, 'window', originalWindow);
      else delete (globalThis as { window?: Window }).window;
    }
  });

  it('routes both observed OWW221 WebView sizes to the watch without hijacking web previews', () => {
    expect(isWatchFocusViewport(189, 248)).toBe(true);
    expect(isWatchFocusViewport(320, 420)).toBe(true);
    expect(isWatchFocusViewport(378, 496, { native: true, pixelRatio: 1 })).toBe(true);
    expect(isWatchFocusViewport(360, 480)).toBe(false);
    expect(isWatchFocusViewport(392, 894, { native: true, pixelRatio: 2.75 })).toBe(false);
    expect(isWatchFocusViewport(640, 992, { native: true, pixelRatio: 2.5 })).toBe(false);
  });

  it('shows full authority device identity on tablets while keeping phones compact', () => {
    const owner = 'device-visual-proof-long-identifier';
    expect(focusDeviceLabel(owner, 'device-other', true)).toBe(owner);
    expect(focusDeviceLabel(owner, 'device-other', false)).toBe('device-v…tifier');
    expect(focusDeviceLabel(owner, owner, false)).toBe('此设备');
    expect(focusDeviceLabel(null, 'device-other', true)).toBe('尚无操作设备');
  });
});

function renderActiveConsole(width: number, height: number): string {
  Object.defineProperty(globalThis, 'window', {
    configurable: true,
    value: { innerHeight: height, innerWidth: width },
  });
  const snapshot = {
    ...idleLiveFocusSnapshot(1, 1_000, 1_000),
    state: 'running' as const,
    sessionId: 'session-viewport',
    startedAt: 1_000,
    currentStateStartedAt: 1_000,
    title: '视口验收专注',
  };
  return renderToStaticMarkup(
    createElement(FocusConsole, {
      snapshot,
      connection: 'live',
      connectionNotice: null,
      titleDraft: '',
      pendingCommand: null,
      commandNotice: null,
      localDeviceId: 'device-local',
      tasks: [],
      selectedTaskId: '',
      onTaskChange: () => undefined,
      onTitleChange: () => undefined,
      onCommand: () => undefined,
      onOpenConnection: () => undefined,
      onOpenTasks: () => undefined,
      snapshotSource: 'server',
      nativeSystemControls: {
        available: true,
        immersiveSystemBars: false,
        pictureInPictureSupported: true,
        pictureInPictureActive: false,
        busy: null,
      },
      onToggleImmersiveSystemBars: () => undefined,
      onEnterPictureInPicture: () => undefined,
      localOfflineMode: false,
      authorityMode: 'cloud-live',
      allowOfflineStart: false,
      timerStyle: 'standard',
    }),
  );
}
