import { describe, expect, it } from 'vitest';

import { readDeviceSyncJsonResponse, readDeviceSyncResponseText } from '@shared/sync/httpTransport';

describe('device sync response byte guard', () => {
  it('reads a bounded UTF-8 JSON response', async () => {
    const response = new Response(JSON.stringify({ title: '中文账本' }), {
      headers: { 'Content-Type': 'application/json' },
    });
    await expect(readDeviceSyncJsonResponse(response, 1_024)).resolves.toEqual({
      title: '中文账本',
    });
  });

  it('rejects declared and streamed bodies above the configured limit', async () => {
    const declared = new Response('small', {
      headers: { 'Content-Length': '2048' },
    });
    await expect(readDeviceSyncResponseText(declared, 1_024)).rejects.toThrow(/超过/);

    const streamed = new Response('字'.repeat(400));
    await expect(readDeviceSyncResponseText(streamed, 1_024)).rejects.toThrow(/超过/);
  });
});
