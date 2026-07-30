import crypto from 'node:crypto';

import {
  FOCUSLINK_ACCOUNT_BOOTSTRAP_PATH,
  FOCUSLINK_ACCOUNT_BOOTSTRAP_PROTOCOL_VERSION,
  parseFocusLinkAccountBootstrapResponse,
  redactFocusLinkAccountBootstrapResponse,
} from '../../shared/sync/accountBootstrapProtocol';
import {
  FOCUSLINK_CANONICAL_SYNC_ORIGIN,
  FOCUSLINK_DEVICE_REGISTRATION_PROTOCOL_VERSION,
} from '../../shared/sync/identityProtocol';

void main();

async function main(): Promise<void> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15_000);
  try {
    const response = await fetch(
      `${FOCUSLINK_CANONICAL_SYNC_ORIGIN}${FOCUSLINK_ACCOUNT_BOOTSTRAP_PATH}`,
      {
        method: 'POST',
        headers: { accept: 'application/json', 'content-type': 'application/json' },
        body: JSON.stringify({
          protocolVersion: FOCUSLINK_ACCOUNT_BOOTSTRAP_PROTOCOL_VERSION,
          action: 'start',
          registration: {
            protocolVersion: FOCUSLINK_DEVICE_REGISTRATION_PROTOCOL_VERSION,
            installationId: `probe-${crypto.randomBytes(24).toString('base64url')}`,
            displayName: 'FocusLink deployment probe',
            platform: 'windows',
            deviceKind: 'desktop',
            appVersion: 'probe',
          },
        }),
        redirect: 'error',
        signal: controller.signal,
      },
    );
    if (response.status === 404) {
      report({ state: 'not-deployed', status: response.status });
      process.exitCode = 1;
    } else if (!response.ok) {
      report({ state: 'gateway-error', status: response.status });
      process.exitCode = 1;
    } else {
      const parsed = parseFocusLinkAccountBootstrapResponse(
        await response.json().catch(() => null),
      );
      if (!parsed) {
        report({ state: 'invalid-contract', status: response.status });
        process.exitCode = 1;
      } else if (parsed.status === 'authenticated') {
        report({ state: 'unsafe-auth-without-owner-login', status: response.status });
        process.exitCode = 1;
      } else if (parsed.status !== 'login-required') {
        report({ state: 'invalid-start-state', status: response.status });
        process.exitCode = 1;
      } else {
        report({
          state: 'deployed-login-required',
          status: response.status,
          response: redactFocusLinkAccountBootstrapResponse(parsed),
        });
      }
    }
  } catch (error) {
    report({
      state: error instanceof Error && error.name === 'AbortError' ? 'timeout' : 'unreachable',
    });
    process.exitCode = 1;
  } finally {
    clearTimeout(timeout);
  }
}

function report(value: Record<string, unknown>): void {
  process.stdout.write(`${JSON.stringify(value)}\n`);
}
