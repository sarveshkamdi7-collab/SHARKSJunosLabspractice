import { ConfigTree, type ConfigNode } from '../config/tree';
import { renderTable } from '../render/table';
import {
  portNames,
  stableCounter,
  stableMac,
  type DeviceProfile,
} from './profiles';

export interface InterfaceAddress {
  address: string;
  prefix: number;
}

export interface LogicalUnit {
  unit: number;
  name: string;
  addresses: InterfaceAddress[];
  mtu: number;
  description?: string;
}

export interface InterfaceCounters {
  inputBytes: number;
  outputBytes: number;
  inputPackets: number;
  outputPackets: number;
  inputErrors: number;
  outputErrors: number;
}

export interface DeviceInterface {
  name: string;
  unit?: number;
  physical: boolean;
  index: number;
  snmpIndex: number;
  adminUp: boolean;
  linkUp: boolean;
  mtu: number;
  mac: string;
  description?: string;
  units: LogicalUnit[];
  counters: InterfaceCounters;
}

const TERSE_WIDTHS = [24, 6, 5, 9, 22];

function parseAddress(value: string): InterfaceAddress | undefined {
  const match = /^(\d{1,3}(?:\.\d{1,3}){3})(?:\/(\d{1,2}))?$/.exec(value);
  if (!match) return undefined;
  return {
    address: match[1],
    prefix: match[2] === undefined ? 32 : Number(match[2]),
  };
}

function leafValue(node: ConfigNode | undefined): string | undefined {
  if (!node || !node.leaf) return undefined;
  return node.values[0];
}

function leafExists(node: ConfigNode | undefined): boolean {
  return Boolean(node && node.leaf);
}

export class InterfaceEngine {
  readonly profile: DeviceProfile;
  readonly seed: string;
  readonly linkUp: (name: string) => boolean;
  interfaces: DeviceInterface[] = [];

  constructor(
    profile: DeviceProfile,
    seed: string,
    linkUp: (name: string) => boolean = () => true,
  ) {
    this.profile = profile;
    this.seed = seed;
    this.linkUp = linkUp;
  }

  refresh(config: ConfigTree): void {
    const names = [...portNames(this.profile)];
    const configured = config.get(['interfaces']);
    if (configured) {
      for (const name of configured.children.keys()) {
        if (!names.includes(name)) names.push(name);
      }
    }
    if (this.profile.managementInterface && !names.includes(this.profile.managementInterface)) {
      names.push(this.profile.managementInterface);
    }
    if (!names.includes('lo0')) names.push('lo0');

    const interfaces: DeviceInterface[] = [];
    names.forEach((name, position) => {
      const node = config.get(['interfaces', name]);
      const isLoopback = name === 'lo0';
      const isIrb = name.startsWith('irb');
      if (isIrb && !node) return;

      const disabled = leafExists(config.get(['interfaces', name, 'disable']));
      const adminUp = !disabled;
      const connected = isLoopback || isIrb ? true : this.linkUp(name);
      const linkUp = adminUp && connected;
      const mac = stableMac(`${this.seed}:${name}`, this.profile.macPrefix);
      const physicalMtu =
        Number(leafValue(config.get(['interfaces', name, 'mtu']))) || this.profile.physicalMtu;
      const description = leafValue(config.get(['interfaces', name, 'description']));

      const units = this.readUnits(config, name);

      interfaces.push({
        name,
        physical: true,
        index: 128 + position,
        snmpIndex: 128 + position,
        adminUp,
        linkUp,
        mtu: physicalMtu,
        mac,
        description,
        units,
        counters: this.counters(name),
      });
    });

    this.interfaces = interfaces;
  }

  private readUnits(config: ConfigTree, name: string): LogicalUnit[] {
    const units: LogicalUnit[] = [];
    const unitNode = config.get(['interfaces', name, 'unit']);
    if (!unitNode) return units;

    const numbers: string[] = [];
    if (unitNode.leaf) {
      for (const value of unitNode.values) numbers.push(value);
    }
    for (const key of unitNode.children.keys()) {
      if (!numbers.includes(key)) numbers.push(key);
    }

    for (const key of numbers.sort((a, b) => Number(a) - Number(b))) {
      const unit = Number(key);
      if (!Number.isFinite(unit)) continue;
      const base = ['interfaces', name, 'unit', key];
      const addresses: InterfaceAddress[] = [];
      const addressNode = config.get([...base, 'family', 'inet', 'address']);
      if (addressNode && addressNode.leaf) {
        for (const value of addressNode.values) {
          const parsed = parseAddress(value);
          if (parsed) addresses.push(parsed);
        }
      }
      const mtu =
        Number(leafValue(config.get([...base, 'mtu']))) || this.profile.logicalMtu;
      const description = leafValue(config.get([...base, 'description']));
      units.push({ unit, name: `${name}.${unit}`, addresses, mtu, description });
    }
    return units;
  }

  private counters(name: string): InterfaceCounters {
    const seed = `${this.seed}:${name}`;
    return {
      inputBytes: stableCounter(`${seed}:ib`, 1_000_000, 9_000_000),
      outputBytes: stableCounter(`${seed}:ob`, 1_000_000, 9_000_000),
      inputPackets: stableCounter(`${seed}:ip`, 5_000, 50_000),
      outputPackets: stableCounter(`${seed}:op`, 5_000, 50_000),
      inputErrors: stableCounter(`${seed}:ie`, 0, 5),
      outputErrors: stableCounter(`${seed}:oe`, 0, 5),
    };
  }

  all(): DeviceInterface[] {
    return this.interfaces;
  }

  find(name: string): { intf: DeviceInterface; unit?: LogicalUnit } | undefined {
    for (const intf of this.interfaces) {
      if (intf.name === name) return { intf };
      const unit = intf.units.find((candidate) => candidate.name === name);
      if (unit) return { intf, unit };
    }
    return undefined;
  }

  findByAddress(address: string): { intf: DeviceInterface; unit: LogicalUnit; address: InterfaceAddress } | undefined {
    for (const intf of this.interfaces) {
      for (const unit of intf.units) {
        for (const addr of unit.addresses) {
          if (addr.address === address) return { intf, unit, address: addr };
        }
      }
    }
    return undefined;
  }

  terse(): string[] {
    const rows: string[][] = [];
    for (const intf of this.interfaces) {
      rows.push([
        intf.name,
        intf.adminUp ? 'up' : 'down',
        intf.linkUp ? 'up' : 'down',
        '',
        '',
        '',
      ]);
      for (const unit of intf.units) {
        rows.push([
          unit.name,
          intf.adminUp ? 'up' : 'down',
          intf.linkUp ? 'up' : 'down',
          'inet',
          unit.addresses[0]?.address
            ? `${unit.addresses[0].address}/${unit.addresses[0].prefix}`
            : '',
          '',
        ]);
      }
    }
    return renderTable(
      ['Interface', 'Admin', 'Link', 'Proto', 'Local', 'Remote'],
      rows,
      TERSE_WIDTHS,
    );
  }

  detail(name: string): string[] | undefined {
    const found = this.find(name);
    if (!found) return undefined;
    const { intf } = found;
    const units = found.unit ? [found.unit] : intf.units;
    const state = intf.adminUp ? 'Enabled' : 'Disabled';
    const link = intf.linkUp ? 'Up' : 'Down';
    const lines = [
      `Physical interface: ${intf.name}, ${state}, Physical link is ${link}`,
      `  Interface index: ${intf.index}, SNMP ifIndex: ${intf.snmpIndex}`,
    ];
    if (intf.description) lines.push(`  Description: ${intf.description}`);
    lines.push(
      `  Link-level type: Ethernet, MTU: ${intf.mtu}, Speed: 1000mbps`,
      `  Hardware address: ${intf.mac}`,
      `  Current address: ${intf.mac}`,
      '  Last flapped: Never',
      '  Statistics last cleared: Never',
      '  Traffic statistics:',
      `   Input  bytes  : ${intf.counters.inputBytes}`,
      `   Output bytes  : ${intf.counters.outputBytes}`,
      `   Input  packets: ${intf.counters.inputPackets}`,
      `   Output packets: ${intf.counters.outputPackets}`,
      `   Input  errors : ${intf.counters.inputErrors}`,
      `   Output errors : ${intf.counters.outputErrors}`,
    );

    for (const unit of units) {
      lines.push(
        `  Logical interface ${unit.name} (Index ${64 + unit.unit}) (SNMP ifIndex ${512 + intf.index + unit.unit})`,
        `    Flags: ${intf.linkUp ? 'Up' : 'Device-Down'} SNMP-Traps 0x4000`,
        `    Protocol inet, MTU: ${unit.mtu}`,
      );
      if (unit.description) lines.push(`    Description: ${unit.description}`);
      if (unit.addresses.length > 0) {
        lines.push('    Addresses:');
        for (const address of unit.addresses) {
          lines.push(`      ${address.address}/${address.prefix}`);
        }
      }
    }
    return lines;
  }
}
