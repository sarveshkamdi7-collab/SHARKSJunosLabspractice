import { describe, expect, it } from 'vitest';
import { ConfigTree } from '../config/tree';
import { JunosDevice } from '../engine/device';
import { Network } from '../engine/network';

const CLOCK = Date.parse('2026-11-03T12:00:00Z');

function buildDevice(
  name: string,
  address: string,
  routerId: string,
  extra: string[] = [],
): JunosDevice {
  return new JunosDevice({
    name,
    profile: 'vMX',
    config: ConfigTree.fromSetLines([
      `set system host-name ${name}`,
      `set interfaces xe-0/0/0 unit 0 family inet address ${address}`,
      `set interfaces lo0 unit 0 family inet address ${routerId}/32`,
      `set routing-options router-id ${routerId}`,
      'set protocols ospf area 0.0.0.0 interface xe-0/0/0.0',
      ...extra,
    ]),
    clock: () => CLOCK,
    bootTime: CLOCK - 2 * 24 * 60 * 60 * 1000,
  });
}

function buildLab(): { r1: JunosDevice; r2: JunosDevice; network: Network } {
  const r1 = buildDevice('R1', '10.0.12.1/30', '1.1.1.1');
  const r2 = buildDevice('R2', '10.0.12.2/30', '2.2.2.2');
  const network = new Network();
  network.connect(r1, 'xe-0/0/0', r2, 'xe-0/0/0');
  return { r1, r2, network };
}

function runTicks(devices: JunosDevice[], count: number): void {
  for (let index = 0; index < count; index++) {
    for (const device of devices) device.tickOspf();
  }
}

describe('OSPF adjacency', () => {
  it('discovers neighbors on connected OSPF interfaces', () => {
    const { r1 } = buildLab();
    expect(r1.ospf.neighbors).toHaveLength(1);
    const neighbor = r1.ospf.neighbors[0];
    expect(neighbor.address).toBe('10.0.12.2');
    expect(neighbor.routerId).toBe('2.2.2.2');
    expect(neighbor.interfaceName).toBe('xe-0/0/0.0');
    expect(neighbor.area).toBe('0.0.0.0');
    expect(neighbor.state).toBe('Down');
  });

  it('advances through the state machine one step per tick', () => {
    const { r1 } = buildLab();
    const expected = ['Init', '2Way', 'ExStart', 'Exchange', 'Loading', 'Full'];
    for (const state of expected) {
      r1.tickOspf();
      expect(r1.ospf.neighbors[0].state).toBe(state);
    }
  });

  it('elects a DR and BDR on a broadcast link', () => {
    const { r1, r2 } = buildLab();
    runTicks([r1, r2], 2);
    const r1Interface = r1.ospf.interfaces.get('xe-0/0/0.0')!;
    const r2Interface = r2.ospf.interfaces.get('xe-0/0/0.0')!;
    expect(r2Interface.state).toBe('DR');
    expect(r1Interface.state).toBe('BDR');
    expect(r1Interface.drId).toBe('2.2.2.2');
    expect(r1Interface.bdrId).toBe('1.1.1.1');
  });

  it('halts at ExStart on an area mismatch', () => {
    const { r1 } = buildLab();
    r1.ospf.neighbors[0].remoteArea = '0.0.0.1';
    runTicks([r1], 4);
    const neighbor = r1.ospf.neighbors[0];
    expect(neighbor.state).toBe('ExStart');
    expect(neighbor.mismatch).toBe('Area ID mismatch');
    runTicks([r1], 3);
    expect(neighbor.state).toBe('ExStart');
  });

  it('halts at ExStart on an MTU mismatch', () => {
    const { r1 } = buildLab();
    r1.ospf.neighbors[0].remoteMtu = 9000;
    runTicks([r1], 4);
    const neighbor = r1.ospf.neighbors[0];
    expect(neighbor.state).toBe('ExStart');
    expect(neighbor.mismatch).toBe('MTU mismatch');
  });

  it('does not form an adjacency on a passive interface', () => {
    const r1 = buildDevice('R1', '10.0.12.1/30', '1.1.1.1');
    const r2 = buildDevice('R2', '10.0.12.2/30', '2.2.2.2', [
      'set protocols ospf area 0.0.0.0 interface xe-0/0/0.0 passive',
    ]);
    const network = new Network();
    network.connect(r1, 'xe-0/0/0', r2, 'xe-0/0/0');
    expect(r1.ospf.neighbors).toHaveLength(0);
    expect(r2.ospf.neighbors).toHaveLength(0);
  });
});

describe('OSPF routes and commands', () => {
  it('injects remote networks as OSPF/10 routes when the neighbor is Full', () => {
    const { r1, r2 } = buildLab();
    runTicks([r1, r2], 6);
    const route = r1.rib.routes.find((candidate) => candidate.destination === '2.2.2.2/32');
    expect(route?.protocol).toBe('OSPF');
    expect(route?.preference).toBe(10);
    expect(route?.active).toBe(true);
    expect(route?.nextHop).toBe('10.0.12.2');
    expect(route?.interfaceName).toBe('xe-0/0/0.0');
    expect(r1.rib.render().join('\n')).toContain('[OSPF/10]');
  });

  it('prefers a directly connected route over an OSPF route for the same prefix', () => {
    const { r1, r2 } = buildLab();
    runTicks([r1, r2], 6);
    expect(r1.rib.lookup('10.0.12.2')?.protocol).toBe('Direct');
  });

  it('renders neighbors with the Full state and interface columns', () => {
    const { r1, r2 } = buildLab();
    runTicks([r1, r2], 6);
    const lines = r1.ospf.renderNeighbors();
    expect(lines[0]).toContain('Address');
    expect(lines[0]).toContain('Dead Time');
    expect(lines[0]).toContain('Interface');
    expect(lines[1]).toContain('10.0.12.2');
    expect(lines[1]).toContain('2.2.2.2');
    expect(lines[1]).toContain('Full');
    expect(lines[1]).toContain('xe-0/0/0.0');
  });

  it('renders interface DR/BDR state', () => {
    const { r1, r2 } = buildLab();
    runTicks([r1, r2], 6);
    const lines = r1.ospf.renderInterfaces();
    expect(lines[0]).toContain('DR ID');
    expect(lines[0]).toContain('BDR ID');
    expect(lines[1]).toContain('xe-0/0/0.0');
    expect(lines[1]).toContain('BDR');
  });

  it('renders the link-state database', () => {
    const { r1, r2 } = buildLab();
    runTicks([r1, r2], 6);
    const output = r1.ospf.renderDatabase().join('\n');
    expect(output).toContain('OSPF database, Area 0.0.0.0');
    expect(output).toContain('Router');
    expect(output).toContain('1.1.1.1');
    expect(output).toContain('2.2.2.2');
  });

  it('clears neighbors and removes their OSPF routes', () => {
    const { r1, r2 } = buildLab();
    runTicks([r1, r2], 6);
    expect(r1.rib.lookup('2.2.2.2')).toBeDefined();
    r1.ospf.clear('10.0.12.2');
    r1.injectOspfRoutes();
    expect(r1.ospf.neighbors[0].state).toBe('Down');
    expect(r1.rib.lookup('2.2.2.2')).toBeUndefined();
  });

  it('pings a remote loopback over an OSPF route', () => {
    const { r1, r2, network } = buildLab();
    runTicks([r1, r2], 6);
    const output = network.ping(r1, '2.2.2.2').join('\n');
    expect(output).toContain('64 bytes from 2.2.2.2');
    expect(output).toContain('0% packet loss');
  });

  it('exposes OSPF commands through the CLI', () => {
    const { r1, r2 } = buildLab();
    runTicks([r1, r2], 6);
    const session = r1.createSession();
    session.process('root');
    session.process('cli');
    expect(session.process('show ospf neighbor')).toContain('Full');
    expect(session.process('show ospf interface')).toContain('BDR');
    expect(session.process('show ospf database')).toContain('OSPF database, Area 0.0.0.0');
    expect(session.process('show route')).toContain('[OSPF/10]');
    session.process('clear ospf neighbor 10.0.12.2');
    expect(session.process('show ospf neighbor')).toContain('Down');
  });
});
