export function parseAuthorizedAdbDevices(output: string): string[] {
  const devices: string[] = [];
  for (const line of output.split(/\r?\n/)) {
    const match = line.trim().match(/^(\S+)\s+device(?:\s|$)/);
    if (match && match[1] !== 'List') devices.push(match[1]);
  }
  return devices;
}
