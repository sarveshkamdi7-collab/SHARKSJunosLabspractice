import { describe, expect, it } from 'vitest';
import { ConfigTree } from '../src/junos/config/tree';
import { JunosDevice } from '../src/junos/engine/device';
import { Network } from '../src/junos/engine/network';

const CLOCK = Date.parse('2026-11-03T12:00:00Z');

function buildR1(): JunosDevice {
  return new JunosDevice({
    name: 'R1',
    profile: 'vSRX',
    config: ConfigTree.fromSetLines([
      'set system host-name R1',
      'set interfaces ge-0/0/0 unit 0 family inet address 10.0.12.1/30',
      'set interfaces lo0 unit 0 family inet address 1.1.1.1/32',
      'set routing-options router-id 1.1.1.1',
    ]),
    clock: () => CLOCK,
    bootTime: CLOCK - 2 * 24 * 60 * 60 * 1000,
  });
}

function buildR2(): JunosDevice {
  return new JunosDevice({
    name: 'R2',
    profile: 'vSRX',
    config: ConfigTree.fromSetLines([
      'set system host-name R2',
      'set interfaces ge-0/0/0 unit 0 family inet address 10.0.12.2/30',
      'set interfaces lo0 unit 0 family inet address 2.2.2.2/32',
      'set routing-options router-id 2.2.2.2',
    ]),
    clock: () => CLOCK,
    bootTime: CLOCK - 2 * 24 * 60 * 60 * 1000,
  });
}

function operationalSession(): ReturnType<JunosDevice['createSession']> {
  const device = buildR1();
  const session = device.createSession();
  session.process('root');
  session.process('cli');
  return session;
}

describe('Junos CLI audit', () => {
  it('operational_mode_rejects_run', () => {
    const session = operationalSession();
    const output = session.process('run ping 10.0.12.2');
    expect(output).toContain('run ping 10.0.12.2');
    expect(output).toContain('syntax error.');
    expect(output).toContain('^');
    expect(output).not.toContain('unknown command.');
  });

  it('config_mode_delegates_run', () => {
    const session = operationalSession();
    session.process('configure');
    const output = session.process('run show route');
    expect(output).toContain('inet.0:');
    expect(output).toContain('10.0.12.0/30');
    expect(session.mode).toBe('configure');
  });

  it('cidr_ping_rejection', () => {
    const session = operationalSession();
    expect(session.process('ping 10.0.12.1/32')).toContain(
      'ping: cannot resolve 10.0.12.1/32: Host name lookup failure',
    );
    expect(session.process('ping 10.0.')).toContain(
      'ping: cannot resolve 10.0.: Host name lookup failure',
    );
  });

  it('shell_binary_presence', () => {
    const r1 = buildR1();
    const r2 = buildR2();
    const network = new Network();
    network.connect(r1, 'ge-0/0/0', r2, 'ge-0/0/0');

    const session = r1.createSession();
    session.process('root');
    session.process('cli');
    session.process('start shell');

    expect(session.mode).toBe('shell');
    expect(session.process('ping 10.0.12.2')).toContain('64 bytes from 10.0.12.2');
    expect(session.process('ifconfig')).toContain('inet 10.0.12.1/30');
    expect(session.process('netstat -rn')).toContain('Routing tables');
    expect(session.process('traceroute 10.0.12.2')).toContain('traceroute to 10.0.12.2');

    session.process('cli');
    expect(session.mode).toBe('operational');
  });

  it('pipe_filter_execution', () => {
    const session = operationalSession();
    const output = session.process('show interfaces terse | match up');
    expect(output).toContain('ge-0/0/0.0');
    const lines = output.split('\n').filter((line) => line.length > 0);
    expect(lines.length).toBeGreaterThan(0);
    expect(lines.every((line) => line.toLowerCase().includes('up'))).toBe(true);
  });
});
