import type { NetworkInterfaceInfo } from 'node:os';

export function isPrivateIpv4(address: string) {
  const parts = address.split('.').map(Number);
  if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) return false;
  return parts[0] === 10 || (parts[0] === 192 && parts[1] === 168)
    || (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31);
}

export function localAccessUrls(
  interfaces: Record<string, NetworkInterfaceInfo[] | undefined>,
  origin: string,
) {
  const current = new URL(origin);
  const addresses = Object.entries(interfaces)
    .filter(([name]) => !/^(utun|tun|tap|docker|br-|veth)/.test(name))
    .sort(([first], [second]) => Number(!/^(en|eth|wlan|Wi-Fi)/.test(first)) - Number(!/^(en|eth|wlan|Wi-Fi)/.test(second)))
    .flatMap(([, entries]) => entries ?? [])
    .filter((entry) => !entry.internal && entry.family === 'IPv4' && isPrivateIpv4(entry.address))
    .map((entry) => entry.address);
  return [...new Set(addresses)].slice(0, 4).map((address) => {
    const url = new URL('/asistente', current);
    url.hostname = address;
    return url.toString();
  });
}
