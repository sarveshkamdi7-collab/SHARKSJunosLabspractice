import { describe, expect, it } from 'vitest';
import { ConfigTree } from '../config/tree';
import { JunosDevice } from './device';
import { Network } from './network';

const CLOCK = Date.parse('2026-11-03T12:00:00Z');

function buildDevice(name: string, lines: string[]): JunosDevice {
  return new JunosDevice({
    name,
    profile: 'vMX',
    config: ConfigTree.fromSetLines(lines),
    clock: () => CLOCK,
    bootTime: CLOCK - 2 * 24 * 60 * 60 * 1000,
  });
}

function buildLab(): { r1: JunosDevice; r2: JunosDevice; r3: JunosDevice; network: Network } {
  const r1 = buildDevice('R1', [
    'set system host-name R1',
    'set interfaces xe-0/0/0 unit 0 family inet address 10.0.12.1/30',
    'set interfaces lo0 unit 0 family inet address 1.1.1.1/32',
    'set routing-options router-id 1.1.1.1',
    'set routing-options static route 0.0.0.0/0 next-hop 10.0.12.2',
    'set routing-options static route 192.168.50.0/24 next-hop 10.99.99.99',
  ]);
  const r2 = buildDevice('R2', [
    'set system host-name R2',
    'set interfaces xe-0/0/0 unit 0 family inet address 10.0.12.2/30',
    'set interfaces xe-0/0/1 unit 0 family inet address 10.0.23.2/30',
    'set interfaces lo0 unit 0 family inet address 2.2.2.2/32',
    'set routing-options router-id 2.2.2.2',
    'set routing-options static route 3.3.3.3/32 next-hop 10.0.23.3',
  ]);
  const r3 = buildDevice('R3', [
    'set system host-name R3',
    'set interfaces xe-0/0/0 unit 0 family inet address 10.0.23.3/30',
    'set interfaces lo0 unit 0 family inet address 3.3.3.3/32',
    'set routing-options router-id 3.3.3.3',
  ]);

  const network = new Network();
  network.connect(r1, 'xe-0/0/0', r2, 'xe-0/0/0');
  network.connect(r2, 'xe-0/0/1', r3, 'xe-0/0/0');
  return { r1, r2, r3, network };
}

describe('RIB construction', () => {
  it('installs direct routes from interface subnets', () => {
    const { r1 } = buildLab();
    const route = r1.rib.routes.find((candidate) => candidate.destination === '10.0.12.0/30');
    expect(route).toBeDefined();
    expect(route?.protocol).toBe('Direct');
    expect(route?.preference).toBe(0);
    expect(route?.interfaceName).toBe('xe-0/0/0.0');
  });

  it('installs local /32 routes', () => {
    const { r1 } = buildLab();
    const route = r1.rib.routes.find(
      (candidate) => candidate.destination === '10.0.12.1/32',
    );
    expect(route?.protocol).toBe('Local');
    expect(route?.preference).toBe(0);
    expect(route?.nextHop).toBe('Local');
  });

  it('installs loopback direct and local routes', () => {
    const { r1 } = buildLab();
    const loopback = r1.rib.routes.filter((candidate) => candidate.destination === '1.1.1.1/32');
    expect(loopback.map((route) => route.protocol).sort()).toEqual(['Direct', 'Local']);
  });

  it('resolves a static route through a connected next hop', () => {
    const { r1 } = buildLab();
    const route = r1.rib.routes.find((candidate) => candidate.destination === '0.0.0.0/0');
    expect(route?.protocol).toBe('Static');
    expect(route?.preference).toBe(5);
    expect(route?.active).toBe(true);
    expect(route?.hidden).toBe(false);
    expect(route?.nextHop).toBe('10.0.12.2');
    expect(route?.interfaceName).toBe('xe-0/0/0.0');
  });

  it('marks an unresolved static route hidden', () => {
    const { r1 } = buildLab();
    const route = r1.rib.routes.find(
      (candidate) => candidate.destination === '192.168.50.0/24',
    );
    expect(route?.active).toBe(false);
    expect(route?.hidden).toBe(true);
  });

  it('rebuilds the RIB after a commit', () => {
    const { r1 } = buildLab();
    r1.config.candidate.set(['routing-options', 'static', 'route', '8.8.8.0/24', 'next-hop'], '10.0.12.2');
    r1.config.commit();
    r1.refresh();
    expect(
      r1.rib.routes.find((route) => route.destination === '8.8.8.0/24')?.active,
    ).toBe(true);
  });
});

describe('show route', () => {
  it('renders the route table header and protocol tags', () => {
    const { r1 } = buildLab();
    const output = r1.rib.render().join('\n');
    expect(output).toContain('inet.0:');
    expect(output).toContain('+ = Active Route');
    expect(output).toContain('[Direct/0]');
    expect(output).toContain('[Local/0]');
    expect(output).toContain('[Static/5]');
  });

  it('marks active routes with an asterisk', () => {
    const { r1 } = buildLab();
    const lines = r1.rib.render();
    expect(lines.find((line) => line.startsWith('10.0.12.0/30'))).toContain('*[Direct/0]');
    expect(lines.find((line) => line.startsWith('0.0.0.0/0'))).toContain('*[Static/5]');
  });

  it('shows the hidden route without an active marker', () => {
    const { r1 } = buildLab();
    const lines = r1.rib.render();
    const line = lines.find((candidate) => candidate.startsWith('192.168.50.0/24'))!;
    expect(line).toContain('[Static/5]');
    expect(line).not.toContain('*[Static/5]');
  });

  it('summarizes routes by protocol', () => {
    const { r1 } = buildLab();
    const output = r1.rib.summary(r1.routerId()).join('\n');
    expect(output).toContain('Router ID: 1.1.1.1');
    expect(output).toContain('Direct:');
    expect(output).toContain('Local:');
    expect(output).toContain('Static:');
  });

  it('renders the forwarding table', () => {
    const { r1 } = buildLab();
    const lines = r1.rib.forwardingTable();
    expect(lines[0]).toBe('Routing table: default.inet');
    expect(lines[1]).toBe('Internet:');
    expect(lines[2]).toContain('Destination');
    expect(lines.join('\n')).toContain('10.0.12.0/30');
  });
});

describe('ping and traceroute', () => {
  it('pings a directly connected device', () => {
    const { r1, network } = buildLab();
    const output = network.ping(r1, '2.2.2.2').join('\n');
    expect(output).toContain('PING 2.2.2.2 (2.2.2.2): 56 data bytes');
    expect(output).toContain('64 bytes from 2.2.2.2');
    expect(output).toContain('ttl=64');
    expect(output).toContain('5 packets transmitted, 5 packets received, 0% packet loss');
    expect(output).toContain('round-trip min/avg/max/stddev');
  });

  it('pings across two routers', () => {
    const { r1, network } = buildLab();
    const output = network.ping(r1, '3.3.3.3').join('\n');
    expect(output).toContain('64 bytes from 3.3.3.3');
    expect(output).toContain('ttl=63');
    expect(output).toContain('0% packet loss');
  });

  it('traces a multi-hop path', () => {
    const { r1, network } = buildLab();
    const lines = network.traceroute(r1, '3.3.3.3');
    expect(lines[0]).toBe('traceroute to 3.3.3.3 (3.3.3.3), 30 hops max, 40 byte packets');
    const text = lines.join('\n');
    expect(text).toContain('10.0.12.2');
    expect(text).toContain('10.0.23.3');
    expect(text).toContain('3.3.3.3');
    expect(lines.filter((line) => /^\s*\d+\s+/.test(line))).toHaveLength(3);
  });

  it('reports no route to host', () => {
    const { r2, network } = buildLab();
    const output = network.ping(r2, '8.8.8.8').join('\n');
    expect(output).toContain('ping: sendto: No route to host');
    expect(output).toContain('5 packets transmitted, 0 packets received, 100% packet loss');
  });

  it('runs ping and show route through the CLI', () => {
    const { r1 } = buildLab();
    const session = r1.createSession();
    session.process('root');
    session.process('cli');
    expect(session.process('show route')).toContain('[Static/5]');
    expect(session.process('show route summary')).toContain('Router ID: 1.1.1.1');
    expect(session.process('show route forwarding-table')).toContain('Routing table: default.inet');
    expect(session.process('ping 3.3.3.3')).toContain('0% packet loss');
    expect(session.process('traceroute 3.3.3.3')).toContain('10.0.23.3');
  });
});
