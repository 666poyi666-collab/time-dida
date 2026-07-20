import { describe, expect, it } from 'vitest';

import {
  LIVE_FOCUS_COMMAND_PATH,
  LIVE_FOCUS_MAX_TITLE_LENGTH,
  LIVE_FOCUS_PROTOCOL_VERSION,
  LIVE_FOCUS_SNAPSHOT_PATH,
  LIVE_FOCUS_WAIT_PATH,
  validateLiveFocusCommandRequest,
} from '@shared/sync/liveFocusProtocol';

function startRequest(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    protocolVersion: LIVE_FOCUS_PROTOCOL_VERSION,
    deviceId: 'phone-a',
    command: {
      commandId: 'command-start-1',
      action: 'start',
      expectedRevision: 0,
      sessionId: 'session-live-1',
      title: '复习化学',
      task: { taskId: 'chemistry-1', taskSource: 'ticktick', taskTitle: '复习化学' },
    },
    ...overrides,
  };
}

describe('live focus protocol', () => {
  it('uses stable v1 routes and accepts strict start/transition commands', () => {
    expect(LIVE_FOCUS_SNAPSHOT_PATH).toBe('/v1/live');
    expect(LIVE_FOCUS_WAIT_PATH).toBe('/v1/live/wait');
    expect(LIVE_FOCUS_COMMAND_PATH).toBe('/v1/live/command');

    const start = validateLiveFocusCommandRequest(startRequest());
    expect(start.ok).toBe(true);
    expect(start.request?.command.action).toBe('start');

    const pause = validateLiveFocusCommandRequest({
      protocolVersion: 1,
      deviceId: 'tablet-b',
      command: {
        commandId: 'command-pause-1',
        action: 'pause',
        expectedRevision: 1,
        sessionId: 'session-live-1',
      },
    });
    expect(pause.ok).toBe(true);
  });

  it('rejects client ownership fields, malformed ids, unsafe revisions, and extra payload', () => {
    expect(validateLiveFocusCommandRequest({ ...startRequest(), accountId: 'forged' }).ok).toBe(
      false,
    );
    expect(
      validateLiveFocusCommandRequest({
        ...startRequest(),
        command: { ...(startRequest().command as object), ownerDeviceId: 'forged' },
      }).ok,
    ).toBe(false);
    expect(
      validateLiveFocusCommandRequest({
        ...startRequest(),
        command: { ...(startRequest().command as object), commandId: '' },
      }).ok,
    ).toBe(false);
    expect(
      validateLiveFocusCommandRequest({
        ...startRequest(),
        command: {
          ...(startRequest().command as object),
          expectedRevision: Number.MAX_SAFE_INTEGER + 1,
        },
      }).ok,
    ).toBe(false);
  });

  it('bounds titles and does not permit title fields on transitions', () => {
    expect(
      validateLiveFocusCommandRequest({
        ...startRequest(),
        command: {
          ...(startRequest().command as object),
          title: 'x'.repeat(LIVE_FOCUS_MAX_TITLE_LENGTH),
        },
      }).ok,
    ).toBe(true);
    expect(
      validateLiveFocusCommandRequest({
        ...startRequest(),
        command: {
          ...(startRequest().command as object),
          title: 'x'.repeat(LIVE_FOCUS_MAX_TITLE_LENGTH + 1),
        },
      }).ok,
    ).toBe(false);
    expect(
      validateLiveFocusCommandRequest({
        protocolVersion: 1,
        deviceId: 'phone-a',
        command: {
          commandId: 'command-resume-1',
          action: 'resume',
          expectedRevision: 2,
          sessionId: 'session-live-1',
          title: 'not allowed',
        },
      }).ok,
    ).toBe(false);
  });

  it('accepts strict task context and rejects unsupported task ownership fields', () => {
    expect(validateLiveFocusCommandRequest(startRequest()).ok).toBe(true);
    expect(
      validateLiveFocusCommandRequest({
        ...startRequest(),
        command: {
          ...(startRequest().command as object),
          task: {
            taskId: 'chemistry-1',
            taskSource: 'ticktick',
            taskTitle: '复习化学',
            accountId: 'forged',
          },
        },
      }).ok,
    ).toBe(false);
  });
});
