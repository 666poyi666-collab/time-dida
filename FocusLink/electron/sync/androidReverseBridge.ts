import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { getSettings } from '../settingsStore.js';
import { logger } from '../logger.js';
import { EMBEDDED_DEVICE_SYNC_ENDPOINT } from './embeddedDeviceSyncServer.js';
import { parseAuthorizedAdbDevices } from './androidReverseBridgePolicy.js';

const execFileAsync = promisify(execFile);
const REVERSE_PORT = '18787';

export async function ensureAndroidReverseBridges(): Promise<string[]> {
  const settings = getSettings().deviceSync;
  if (!settings.enabled || settings.endpoint.replace(/\/$/, '') !== EMBEDDED_DEVICE_SYNC_ENDPOINT) {
    return [];
  }
  let stdout: string;
  try {
    ({ stdout } = await execFileAsync('adb', ['devices'], {
      encoding: 'utf8',
      timeout: 8_000,
      windowsHide: true,
    }));
  } catch (error) {
    logger.debug('deviceSync', 'ADB bridge unavailable', {
      error: error instanceof Error ? error.message : String(error),
    });
    return [];
  }

  const connected: string[] = [];
  for (const serial of parseAuthorizedAdbDevices(stdout)) {
    try {
      await execFileAsync(
        'adb',
        ['-s', serial, 'reverse', `tcp:${REVERSE_PORT}`, `tcp:${REVERSE_PORT}`],
        { encoding: 'utf8', timeout: 8_000, windowsHide: true },
      );
      connected.push(serial);
    } catch (error) {
      logger.debug('deviceSync', 'unable to refresh Android reverse bridge', {
        serial,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }
  if (connected.length > 0)
    logger.info('deviceSync', 'Android reverse bridges confirmed', { connected });
  return connected;
}

/** Opens a one-time local pairing link on one already-authorized Android device. */
export async function openAndroidPairingLink(serial: string, pairingUrl: string): Promise<void> {
  if (!/^[A-Za-z0-9._:-]+$/.test(serial)) throw new Error('ADB device serial is invalid');
  const url = new URL(pairingUrl);
  if (url.protocol !== 'focuslink:' || url.hostname !== 'pair') {
    throw new Error('Android pairing URL is invalid');
  }
  await execFileAsync(
    'adb',
    [
      '-s',
      serial,
      'shell',
      'am',
      'start',
      '-W',
      '-a',
      'android.intent.action.VIEW',
      '-d',
      // adb joins arguments into a remote shell command. Quote the already-validated
      // URI so its query-string ampersands are not interpreted as shell separators.
      `'${pairingUrl}'`,
      'app.focuslink.mobile',
    ],
    { encoding: 'utf8', timeout: 15_000, windowsHide: true },
  );
}
