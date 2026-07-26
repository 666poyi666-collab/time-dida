import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const root = path.resolve(__dirname, '..');

describe('Foxlink independent MCP contract', () => {
  it('keeps the business API inside Electron and outside PersonalMcpGateway', () => {
    const api = fs.readFileSync(path.join(root, 'electron/mcp/businessApi.ts'), 'utf8');
    expect(api).toContain("const HOST = '127.0.0.1'");
    expect(api).toContain('const PORT = 18770');
    expect(api).toContain('/v1/status');
    expect(api).toContain('/v1/health');
    expect(api).toContain('/v1/capabilities');
    expect(api).not.toContain('PersonalMcpGateway');
  });

  it('uses independent MCP and tunnel service identities', () => {
    const nativeService = fs.readFileSync(
      path.join(root, 'mcp/foxlink_mcp/windows_service.py'),
      'utf8',
    );
    const installer = fs.readFileSync(path.join(root, 'mcp/service/install.ps1'), 'utf8');
    const tunnel = fs.readFileSync(path.join(root, 'mcp/tunnel/service.xml'), 'utf8');
    const tunnelRuntime = fs.readFileSync(path.join(root, 'mcp/tunnel/run-service.ps1'), 'utf8');
    expect(nativeService).toContain('_svc_name_ = "PoyiFoxlinkMcp"');
    expect(nativeService).toContain('foxlink_mcp.windows_service.FoxlinkMcpService');
    expect(installer).toContain('-m foxlink_mcp.windows_service --startup delayed install');
    expect(tunnel).toContain('<id>FoxlinkSecureMcpTunnel</id>');
    expect(tunnel).toContain('<depend>PoyiFoxlinkMcp</depend>');
    expect(tunnelRuntime).toContain('127.0.0.1:8770/mcp');
  });
});
