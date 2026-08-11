import { afterEach, describe, expect, it } from 'vitest';

import {
  createDeviceSyncCloudServer,
  isFetchForbiddenPort,
  type DeviceSyncCloudServer,
} from '../cloud';

describe('device sync loopback port safety', () => {
  const servers: DeviceSyncCloudServer[] = [];

  afterEach(async () => {
    await Promise.all(servers.splice(0).map((server) => server.close()));
  });

  it('matches representative WHATWG Fetch forbidden ports', () => {
    expect([0, 1, 5060, 6000, 6667, 10080].every(isFetchForbiddenPort)).toBe(true);
    expect([80, 443, 18787, 49152].every((port) => !isFetchForbiddenPort(port))).toBe(true);
  });

  it('rejects an explicit forbidden port before binding', async () => {
    const server = createDeviceSyncCloudServer({ port: 6000 });
    servers.push(server);

    await expect(server.listen()).rejects.toThrow('port 6000 is forbidden by Fetch');
    expect(server.httpServer.listening).toBe(false);
  });

  it('does not let the test seam allow a standard forbidden port', async () => {
    const server = createDeviceSyncCloudServer({
      port: 6000,
      isPortForbidden: () => false,
    });
    servers.push(server);

    await expect(server.listen()).rejects.toThrow('port 6000 is forbidden by Fetch');
    expect(server.httpServer.listening).toBe(false);
  });

  it('rebinds when the first dynamic port is forbidden', async () => {
    let assignedPortChecks = 0;
    const server = createDeviceSyncCloudServer({
      isPortForbidden: () => assignedPortChecks++ === 0,
    });
    servers.push(server);

    const address = await server.listen();
    expect(assignedPortChecks).toBe(2);
    expect(server.httpServer.listening).toBe(true);
    expect(new URL(address.url).port).toBe(String(address.port));
  });

  it('closes after exhausting dynamic forbidden-port retries', async () => {
    let assignedPortChecks = 0;
    const server = createDeviceSyncCloudServer({
      isPortForbidden: () => {
        assignedPortChecks += 1;
        return true;
      },
    });
    servers.push(server);

    await expect(server.listen()).rejects.toThrow('after 16 attempts');
    expect(assignedPortChecks).toBe(16);
    expect(server.httpServer.listening).toBe(false);
  });

  it('shares one in-flight dynamic bind across concurrent callers', async () => {
    const server = createDeviceSyncCloudServer();
    servers.push(server);

    const first = server.listen();
    const second = server.listen();
    expect(second).toBe(first);
    const [firstAddress, secondAddress] = await Promise.all([first, second]);
    expect(secondAddress).toEqual(firstAddress);
  });

  it('shares one failing in-flight bind across concurrent callers', async () => {
    const server = createDeviceSyncCloudServer({ isPortForbidden: () => true });
    servers.push(server);

    const first = server.listen();
    const second = server.listen();
    expect(second).toBe(first);
    await expect(first).rejects.toThrow('after 16 attempts');
    expect(server.httpServer.listening).toBe(false);
  });

  it('allows a fresh listen attempt after exhausting forbidden retries', async () => {
    let forbidDynamicPorts = true;
    const server = createDeviceSyncCloudServer({
      isPortForbidden: () => forbidDynamicPorts,
    });
    servers.push(server);

    await expect(server.listen()).rejects.toThrow('after 16 attempts');
    expect(server.httpServer.listening).toBe(false);

    forbidDynamicPorts = false;
    const address = await server.listen();
    expect(server.httpServer.listening).toBe(true);
    expect(new URL(address.url).port).toBe(String(address.port));
  });

  it('waits for an in-flight bind before closing', async () => {
    const server = createDeviceSyncCloudServer();
    servers.push(server);

    const listening = server.listen();
    await server.close();
    expect(server.httpServer.listening).toBe(false);
    await expect(listening).resolves.toMatchObject({ host: '127.0.0.1' });
  });
});
