import { app } from 'electron';
import fs from 'node:fs';
import path from 'node:path';

import type { DeviceSyncSessionBundle } from '@shared/sync/deviceProtocol';
import {
  closeDatabase,
  getSession,
  initDatabase,
  insertDeviceSyncBundleIfMissing,
  listPauses,
  listSegments,
} from '../../electron/db/index.js';
import { logger } from '../../electron/logger.js';
import { configureIsolatedUserData } from './isolatedUserData.js';

const RESULT_FILE = path.join(process.cwd(), 'device-sync-db-result.json');
configureIsolatedUserData('device-sync-db', true);

function fixture(): DeviceSyncSessionBundle {
  const sessionId = 'remote-session';
  const startedAt = 1_720_000_000_000;
  const endedAt = startedAt + 2_000;
  return {
    session: {
      id: sessionId,
      title: '跨设备导入',
      status: 'finished',
      startedAt,
      endedAt,
      activeElapsedMs: 1_000,
      pauseElapsedMs: 1_000,
      wallElapsedMs: 2_000,
      defaultTaskId: null,
      defaultTaskSource: null,
      defaultTaskTitle: null,
      note: null,
      createdAt: startedAt,
      updatedAt: endedAt,
    },
    segments: [
      {
        id: 'remote-segment',
        sessionId,
        taskId: null,
        taskSource: null,
        title: '远端片段',
        startedAt,
        endedAt: startedAt + 1_000,
        activeElapsedMs: 1_000,
        note: null,
        tomatodoSubject: null,
        createdAt: startedAt,
        updatedAt: endedAt,
      },
    ],
    pauses: [
      {
        id: 'remote-pause',
        sessionId,
        segmentId: 'remote-segment',
        pauseStartedAt: startedAt + 1_000,
        pauseEndedAt: endedAt,
        durationMs: 1_000,
        reason: null,
        createdAt: startedAt,
        updatedAt: endedAt,
      },
    ],
  };
}

void app.whenReady().then(() => {
  logger.init();
  initDatabase();
  const result: {
    timestamp: string;
    checks: Record<string, boolean>;
    errors: string[];
    success: boolean;
  } = { timestamp: new Date().toISOString(), checks: {}, errors: [], success: false };

  try {
    const bundle = fixture();
    result.checks.firstInsert = insertDeviceSyncBundleIfMissing(bundle);
    result.checks.duplicateSkipped = !insertDeviceSyncBundleIfMissing(bundle);
    const session = getSession(bundle.session.id);
    const segments = listSegments(bundle.session.id);
    const pauses = listPauses(bundle.session.id);
    result.checks.sessionImported = session?.title === '跨设备导入';
    result.checks.segmentImported =
      segments.length === 1 &&
      segments[0]?.id === 'remote-segment' &&
      segments[0].cloudFocusId === null;
    result.checks.pauseImported =
      pauses.length === 1 &&
      pauses[0]?.id === 'remote-pause' &&
      pauses[0].segmentId === 'remote-segment';

    const rollbackBundle = fixture();
    rollbackBundle.session.id = 'rollback-session';
    rollbackBundle.segments[0] = {
      ...rollbackBundle.segments[0],
      id: 'rollback-segment',
      sessionId: rollbackBundle.session.id,
    };
    rollbackBundle.pauses[0] = {
      ...rollbackBundle.pauses[0],
      sessionId: rollbackBundle.session.id,
      segmentId: rollbackBundle.segments[0].id,
      // Deliberately collide after the session and segment inserts have run.
      id: 'remote-pause',
    };
    let rollbackRejected = false;
    try {
      insertDeviceSyncBundleIfMissing(rollbackBundle);
    } catch {
      rollbackRejected = true;
    }
    result.checks.failedBundleRejected = rollbackRejected;
    result.checks.failedBundleRolledBack =
      getSession(rollbackBundle.session.id) === null &&
      listSegments(rollbackBundle.session.id).length === 0 &&
      listPauses(rollbackBundle.session.id).length === 0;
    result.success = Object.values(result.checks).every(Boolean);
  } catch (error) {
    result.errors.push(error instanceof Error ? error.message : String(error));
  } finally {
    closeDatabase();
  }

  fs.writeFileSync(RESULT_FILE, JSON.stringify(result, null, 2), 'utf8');
  console.log('===== DEVICE SYNC DB RESULT =====');
  console.log(JSON.stringify(result, null, 2));
  app.exit(result.success ? 0 : 1);
});
