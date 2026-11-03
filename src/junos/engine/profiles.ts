export type ProfileName = 'vSRX' | 'vMX' | 'EX';

export interface DeviceProfile {
  name: ProfileName;
  model: string;
  junosVersion: string;
  interfacePrefix: string;
  interfaceCount: number;
  physicalMtu: number;
  logicalMtu: number;
  macPrefix: string;
  serialPrefix: string;
}

export const PROFILES: Record<ProfileName, DeviceProfile> = {
  vSRX: {
    name: 'vSRX',
    model: 'vSRX',
    junosVersion: '21.4R3.15',
    interfacePrefix: 'ge-0/0/',
    interfaceCount: 8,
    physicalMtu: 1514,
    logicalMtu: 1500,
    macPrefix: '00:05:86',
    serialPrefix: 'VS',
  },
  vMX: {
    name: 'vMX',
    model: 'vMX',
    junosVersion: '21.4R3.15',
    interfacePrefix: 'xe-0/0/',
    interfaceCount: 8,
    physicalMtu: 1514,
    logicalMtu: 1500,
    macPrefix: '00:05:86',
    serialPrefix: 'VM',
  },
  EX: {
    name: 'EX',
    model: 'EX4300-24T',
    junosVersion: '21.4R3.15',
    interfacePrefix: 'ge-0/0/',
    interfaceCount: 24,
    physicalMtu: 1514,
    logicalMtu: 1500,
    macPrefix: '00:05:86',
    serialPrefix: 'EX',
  },
};

export function profileFor(name: ProfileName): DeviceProfile {
  return PROFILES[name];
}

export function portNames(profile: DeviceProfile): string[] {
  return Array.from({ length: profile.interfaceCount }, (_, index) => {
    return `${profile.interfacePrefix}${index}`;
  });
}

function hash(input: string): number {
  let value = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    value ^= input.charCodeAt(i);
    value = Math.imul(value, 0x01000193) >>> 0;
  }
  return value >>> 0;
}

export function stableMac(seed: string, prefix = '00:05:86'): string {
  const h = hash(seed);
  const bytes = [(h >>> 16) & 0xff, (h >>> 8) & 0xff, h & 0xff];
  return `${prefix}:${bytes.map((byte) => byte.toString(16).padStart(2, '0')).join(':')}`;
}

export function serialNumber(profile: DeviceProfile, seed: string): string {
  const h = hash(`${profile.name}:${seed}`);
  return `${profile.serialPrefix}${h.toString(16).toUpperCase().padStart(8, '0')}`;
}

export function stableCounter(seed: string, min: number, range: number): number {
  return min + (hash(seed) % range);
}
