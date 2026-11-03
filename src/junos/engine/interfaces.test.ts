import { describe, expect, it } from 'vitest';
import { ConfigTree } from '../config/tree';
import {
  PROFILES,
  portNames,
  profileFor,
  stableMac,
  type ProfileName,
} from './profiles';
import { JunosDevice } from './device';

const CLOCK = Date.parse('2026-11-03T12:00:00Z');

function makeDevice(profile: ProfileName = 'vMX', connected: string[] = []): JunosDevice {
  const config = ConfigTree.fromSetLines([
    'set system host-name R1',
    'set interfaces xe-0/0/0 description core',
    'set interfaces xe-0/0/0 unit 0 family inet address 10.0.12.1/30',
    'set interfaces xe-0/0/1 unit 0 family inet address 10.0.12.5/30',
    'set interfaces lo0 unit 0 family inet address 1.1.1.1/32',
    'set interfaces irb unit 10 family inet address 10.0.3.1/24',
  ]);
  const device = new JunosDevice({
    name: 'R1',
    profile,
    config,
    clock: () => CLOCK,
    bootTime: CLOCK - (2 * 24 * 60 * 60 + 3 * 60 * 60) * 1000,
  });
  for (const name of connected) device.connect(name);
  return device;
}

describe('device profiles', () => {
  it('binds vSRX naming and MTU defaults', () => {
    const profile = profileFor('vSRX');
    expect(profile.interfacePrefix).toBe('ge-0/0/');
    expect(profile.physicalMtu).toBe(1514);
    expect(profile.logicalMtu).toBe(1500);
  });

  it('binds vMX xe interfaces', () => {
    expect(PROFILES.vMX.interfacePrefix).toBe('xe-0/0/');
    expect(portNames(PROFILES.vMX)[0]).toBe('xe-0/0/0');
    expect(portNames(PROFILES.vMX)).toHaveLength(8);
  });

  it('binds EX switch ports', () => {
    expect(PROFILES.EX.model).toBe('EX4300-24T');
    expect(portNames(PROFILES.EX)).toHaveLength(24);
    expect(portNames(PROFILES.EX)[23]).toBe('ge-0/0/23');
  });

  it('generates deterministic hardware addresses', () => {
    const first = stableMac('R1:xe-0/0/0');
    const second = stableMac('R1:xe-0/0/0');
    expect(first).toBe(second);
    expect(first).toMatch(/^00:05:86(:[0-9a-f]{2}){3}$/);
    expect(stableMac('R2:xe-0/0/0')).not.toBe(first);
  });
});

describe('show interfaces terse', () => {
  it('renders the exact column header', () => {
    const lines = makeDevice().interfaces.terse();
    expect(lines[0]).toBe(
      'Interface               Admin Link Proto    Local                 Remote',
    );
  });

  it('marks a connected physical link up', () => {
    const lines = makeDevice('vMX', ['xe-0/0/0']).interfaces.terse();
    const row = lines.find((line) => line.startsWith('xe-0/0/0 '));
    expect(row).toContain('up    up');
  });

  it('marks an unconnected physical link down', () => {
    const lines = makeDevice().interfaces.terse();
    const row = lines.find((line) => line.startsWith('xe-0/0/1 '));
    expect(row).toContain('up    down');
  });

  it('shows logical units with inet addresses', () => {
    const lines = makeDevice('vMX', ['xe-0/0/0']).interfaces.terse();
    const row = lines.find((line) => line.startsWith('xe-0/0/0.0'));
    expect(row).toContain('inet');
    expect(row).toContain('10.0.12.1/30');
  });

  it('shows loopback as up', () => {
    const lines = makeDevice().interfaces.terse();
    const row = lines.find((line) => line.startsWith('lo0 '));
    expect(row).toContain('up    up');
    const unit = lines.find((line) => line.startsWith('lo0.0'));
    expect(unit).toContain('1.1.1.1/32');
  });

  it('shows irb addresses', () => {
    const lines = makeDevice().interfaces.terse();
    const row = lines.find((line) => line.startsWith('irb.10'));
    expect(row).toContain('10.0.3.1/24');
  });

  it('administratively disables an interface', () => {
    const device = makeDevice('vMX', ['xe-0/0/0']);
    device.config.active.set(['interfaces', 'xe-0/0/0', 'disable'], undefined);
    device.refresh();
    const row = device.interfaces.terse().find((line) => line.startsWith('xe-0/0/0 '));
    expect(row).toContain('down  down');
  });
});

describe('show interfaces detail', () => {
  it('renders indexes, hardware address, MTU and flags', () => {
    const device = makeDevice('vMX', ['xe-0/0/0']);
    const lines = device.interfaces.detail('xe-0/0/0')!;
    expect(lines[0]).toBe('Physical interface: xe-0/0/0, Enabled, Physical link is Up');
    expect(lines.join('\n')).toContain('SNMP ifIndex: 128');
    expect(lines.join('\n')).toContain('Hardware address: 00:05:86:');
    expect(lines.join('\n')).toContain('MTU: 1514');
    expect(lines.join('\n')).toContain('Logical interface xe-0/0/0.0');
    expect(lines.join('\n')).toContain('Protocol inet, MTU: 1500');
    expect(lines.join('\n')).toContain('Flags: Up SNMP-Traps 0x4000');
    expect(lines.join('\n')).toContain('      10.0.12.1/30');
  });

  it('reports a down link in flags', () => {
    const device = makeDevice('vMX');
    const lines = device.interfaces.detail('xe-0/0/1')!;
    expect(lines[0]).toContain('Physical link is Down');
    expect(lines.join('\n')).toContain('Flags: Device-Down');
  });

  it('returns undefined for an unknown interface', () => {
    expect(makeDevice().interfaces.detail('ge-9/9/9')).toBeUndefined();
  });
});

describe('base operational output', () => {
  it('shows version information', () => {
    const lines = makeDevice().showVersion();
    expect(lines[0]).toBe('Hostname: R1');
    expect(lines[1]).toBe('Model: vMX');
    expect(lines[2]).toBe('Junos: 21.4R3.15');
  });

  it('shows system uptime', () => {
    const lines = makeDevice().showUptime();
    expect(lines[0]).toBe('Current time: 2026-11-03 12:00:00 UTC');
    expect(lines[1]).toContain('System booted: 2026-11-01 09:00:00 UTC');
    expect(lines[4]).toContain('2d 03:00 up');
  });

  it('shows ARP entries with Junos columns', () => {
    const device = makeDevice();
    device.arp.set([
      {
        mac: '00:05:86:11:22:33',
        address: '10.0.12.2',
        name: '10.0.12.2',
        interfaceName: 'xe-0/0/0.0',
        flags: 'none',
      },
    ]);
    const lines = device.arp.render();
    expect(lines[0]).toBe(
      'MAC Address       Address         Name                      Interface           Flags',
    );
    expect(lines[1]).toContain('00:05:86:11:22:33');
    expect(lines[1]).toContain('10.0.12.2');
    expect(lines[1]).toContain('xe-0/0/0.0');
    expect(lines[1]).toContain('none');
  });

  it('answers show commands through a session', () => {
    const device = makeDevice('vMX', ['xe-0/0/0']);
    device.arp.set([
      {
        mac: '00:05:86:11:22:33',
        address: '10.0.12.2',
        name: '10.0.12.2',
        interfaceName: 'xe-0/0/0.0',
        flags: 'none',
      },
    ]);
    const session = device.createSession();
    session.process('root');
    session.process('cli');
    expect(session.process('show interfaces terse')).toContain('xe-0/0/0.0');
    expect(session.process('show version')).toContain('Hostname: R1');
    expect(session.process('show arp')).toContain('10.0.12.2');
    expect(session.process('show interfaces xe-0/0/0')).toContain('SNMP ifIndex: 128');
  });
});
