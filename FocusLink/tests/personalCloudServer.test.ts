import os from 'node:os';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { PERSONAL_CLOUD_RETIRED_MESSAGE, startPersonalCloud } from '../cloud/server';

const TOKEN = 'personal-cloud-token-with-more-than-32-characters';

describe('retired Node personal-cloud authority', () => {
  it('cannot bind a production socket even with otherwise valid configuration', async () => {
    await expect(
      startPersonalCloud({
        host: '127.0.0.1',
        port: 0,
        accounts: [{ accountId: 'owner', accessToken: TOKEN }],
        allowedOrigins: ['https://focus.example'],
        persistencePath: path.join(os.tmpdir(), 'unused-focuslink-store.json'),
        requireForwardedHttps: true,
        maxRequestsPerMinute: 600,
      }),
    ).rejects.toThrow(PERSONAL_CLOUD_RETIRED_MESSAGE);
  });
});
