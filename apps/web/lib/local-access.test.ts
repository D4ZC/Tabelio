import type { NetworkInterfaceInfo } from 'node:os';
import { describe, expect, it } from 'vitest';
import { isPrivateIpv4, localAccessUrls } from './local-access';

const adapter = (address: string, internal = false): NetworkInterfaceInfo => ({
  address, internal, family: 'IPv4', netmask: '255.255.255.0', mac: '00:00:00:00:00:00', cidr: `${address}/24`,
});

describe('LAN QR links', () => {
  it('rejects public, loopback, link-local and malformed addresses', () => {
    for (const address of ['127.0.0.1', '8.8.8.8', '169.254.1.1', '172.32.0.1', '192.168.1.999']) expect(isPrivateIpv4(address)).toBe(false);
  });
  it('preserves HTTPS and the actual web port and opens the assistant', () => {
    expect(localAccessUrls({ en0: [adapter('192.168.1.12')] }, 'https://localhost:3443')).toEqual(['https://192.168.1.12:3443/asistente']);
  });
  it('filters VPNs and loopback and deduplicates adapters', () => {
    expect(localAccessUrls({ lo0: [adapter('127.0.0.1', true)], utun0: [adapter('10.8.0.1')], en0: [adapter('192.168.1.12'), adapter('192.168.1.12')] }, 'http://localhost:3000'))
      .toEqual(['http://192.168.1.12:3000/asistente']);
  });
});
