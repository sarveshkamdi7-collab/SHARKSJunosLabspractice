export interface ParsedCidr {
  address: string;
  prefix: number;
  addressInt: number;
  networkInt: number;
  broadcastInt: number;
  network: string;
  mask: number;
}

export function isValidIpv4(value: string): boolean {
  const parts = value.split('.');
  if (parts.length !== 4) return false;
  return parts.every((part) => {
    if (!/^\d{1,3}$/.test(part)) return false;
    const number = Number(part);
    return number >= 0 && number <= 255;
  });
}

export function ipToInt(address: string): number {
  const parts = address.split('.').map(Number);
  return (((parts[0] << 24) >>> 0) + (parts[1] << 16) + (parts[2] << 8) + parts[3]) >>> 0;
}

export function intToIp(value: number): string {
  const n = value >>> 0;
  return [
    (n >>> 24) & 0xff,
    (n >>> 16) & 0xff,
    (n >>> 8) & 0xff,
    n & 0xff,
  ].join('.');
}

export function maskForPrefix(prefix: number): number {
  if (prefix <= 0) return 0;
  if (prefix >= 32) return 0xffffffff >>> 0;
  return (0xffffffff << (32 - prefix)) >>> 0;
}

export function networkOf(addressInt: number, prefix: number): number {
  return (addressInt & maskForPrefix(prefix)) >>> 0;
}

export function parseCidr(value: string): ParsedCidr | undefined {
  const [address, prefixRaw] = value.split('/');
  if (!isValidIpv4(address)) return undefined;
  const prefix = prefixRaw === undefined ? 32 : Number(prefixRaw);
  if (!Number.isInteger(prefix) || prefix < 0 || prefix > 32) return undefined;
  const addressInt = ipToInt(address);
  const networkInt = networkOf(addressInt, prefix);
  const broadcastInt = (networkInt | (~maskForPrefix(prefix) >>> 0)) >>> 0;
  return {
    address,
    prefix,
    addressInt,
    networkInt,
    broadcastInt,
    network: intToIp(networkInt),
    mask: maskForPrefix(prefix),
  };
}

export function containsAddress(cidr: ParsedCidr, addressInt: number): boolean {
  return (addressInt & cidr.mask) >>> 0 === cidr.networkInt;
}

export function sameSubnet(a: ParsedCidr, b: ParsedCidr): boolean {
  return a.networkInt === b.networkInt && a.prefix === b.prefix;
}

export function formatAge(seconds: number): string {
  const days = Math.floor(seconds / 86400);
  const hours = Math.floor((seconds % 86400) / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const secs = seconds % 60;
  if (days > 0) {
    return `${days}d ${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
  }
  return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
}
