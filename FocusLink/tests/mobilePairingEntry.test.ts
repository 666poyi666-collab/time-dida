import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { normalizePairingCodeInput } from '../src/mobile/pairingInput';

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

describe('Android pairing entry', () => {
  it('preserves case-sensitive base64url nonces entered manually', () => {
    expect(normalizePairingCodeInput('  AbC_def-123  ')).toBe('AbC_def-123');
  });

  it('keeps a browsable focuslink://pair deep link for ADB and QR automation', () => {
    const manifest = fs.readFileSync(
      path.join(projectRoot, 'android', 'app', 'src', 'main', 'AndroidManifest.xml'),
      'utf8',
    );
    const mobile = fs.readFileSync(
      path.join(projectRoot, 'src', 'mobile', 'MobileApp.tsx'),
      'utf8',
    );
    const watch = fs.readFileSync(path.join(projectRoot, 'src', 'mobile', 'WatchApp.tsx'), 'utf8');

    expect(manifest).toContain('android:name="android.intent.category.BROWSABLE"');
    expect(manifest).toContain('android:scheme="focuslink"');
    expect(manifest).toContain('android:host="pair"');
    for (const source of [mobile, watch]) {
      expect(source).toContain("CapacitorApp.addListener('appUrlOpen'");
      expect(source).toContain('CapacitorApp.getLaunchUrl()');
      expect(source).toContain('exchangeDeviceSyncPairingCode');
    }
  });
});
