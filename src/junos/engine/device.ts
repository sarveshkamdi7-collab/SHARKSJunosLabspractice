import type { CommandDefinition } from '../types';
import { ConfigManager } from '../config/commit';
import { ConfigTree } from '../config/tree';
import { renderConfig, renderDisplaySet } from '../config/render';
import { configCommands } from '../config/commands';
import { CommandRegistry } from '../parser/registry';
import { hasPipe } from '../parser/pipes';
import { JunosSession } from '../modes/session';
import {
  profileFor,
  serialNumber,
  type DeviceProfile,
  type ProfileName,
} from './profiles';
import { InterfaceEngine } from './interfaces';
import { ArpTable } from './arp';
import { Rib } from './routes';
import type { Network } from './network';
import { parseCidr } from './ipv4';
import { OspfEngine, type OspfInterfaceSpec } from '../protocols/ospf';

export interface DeviceOptions {
  name: string;
  profile: ProfileName;
  config?: ConfigTree;
  clock?: () => number;
  linkUp?: (name: string) => boolean;
  bootTime?: number;
}

const DAY = 24 * 60 * 60 * 1000;
const HOUR = 60 * 60 * 1000;

function formatUtc(ms: number): string {
  return new Date(ms).toISOString().replace('T', ' ').slice(0, 19) + ' UTC';
}

function formatDuration(ms: number): string {
  const days = Math.floor(ms / DAY);
  const hours = Math.floor((ms % DAY) / HOUR);
  const minutes = Math.floor((ms % HOUR) / 60000);
  if (days > 0) return `${days}d ${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`;
  return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`;
}

function isIPv4Address(value: string): boolean {
  const parts = value.split('.');
  if (parts.length !== 4) return false;
  return parts.every((part) => /^\d{1,3}$/.test(part) && Number(part) <= 255);
}

export class JunosDevice {
  readonly name: string;
  readonly profile: DeviceProfile;
  readonly config: ConfigManager;
  readonly interfaces: InterfaceEngine;
  readonly arp: ArpTable;
  readonly rib: Rib;
  readonly ospf: OspfEngine;
  readonly connected = new Set<string>();
  network?: Network;
  readonly clock: () => number;
  readonly bootTime: number;

  constructor(options: DeviceOptions) {
    this.name = options.name;
    this.profile = profileFor(options.profile);
    this.clock = options.clock ?? (() => Date.now());
    this.bootTime = options.bootTime ?? this.clock() - (2 * DAY + 3 * HOUR);
    this.config = new ConfigManager(options.config ?? new ConfigTree(), this.clock);
    this.interfaces = new InterfaceEngine(
      this.profile,
      this.name,
      options.linkUp ?? ((name: string) => this.connected.has(name)),
    );
    this.interfaces.refresh(this.config.active);
    this.arp = new ArpTable();
    this.rib = new Rib();
    this.rib.rebuild(this.interfaces.all(), this.config.active);
    this.ospf = new OspfEngine(this.routerId(), () => this.injectOspfRoutes());
    this.syncOspfConfig();
  }

  hostname(): string {
    const node = this.config.active.get(['system', 'host-name']);
    return node?.values[0] || this.name;
  }

  refresh(): void {
    this.config.tick();
    this.interfaces.refresh(this.config.active);
    this.rib.rebuild(this.interfaces.all(), this.config.active);
    this.syncOspfConfig();
    this.injectOspfRoutes();
    this.network?.discoverOspf();
  }

  syncOspfConfig(): void {
    this.ospf.routerId = this.routerId();
    const areaNode = this.config.active.get(['protocols', 'ospf', 'area']);
    const specs: OspfInterfaceSpec[] = [];
    if (areaNode) {
      for (const [areaId, area] of areaNode.children) {
        if (area.leaf) continue;
        const interfaceNode = area.children.get('interface');
        if (!interfaceNode) continue;
        if (interfaceNode.leaf) {
          for (const name of interfaceNode.values) {
            specs.push({ name, area: areaId, mtu: this.interfaceMtu(name) });
          }
          continue;
        }
        for (const [name, node] of interfaceNode.children) {
          const networkType =
            node.children.get('network-type')?.values[0] === 'point-to-point'
              ? 'point-to-point'
              : 'broadcast';
          specs.push({
            name,
            area: areaId,
            mtu: this.interfaceMtu(name),
            passive: node.children.has('passive'),
            networkType,
          });
        }
      }
    }
    this.ospf.configure(specs);
    this.ospf.advertisedRoutes = this.rib.routes
      .filter((route) => route.protocol === 'Direct' && route.active)
      .map((route) => route.destination);
  }

  private interfaceMtu(name: string): number {
    const found = this.interfaces.find(name);
    return found?.unit?.mtu ?? found?.intf.mtu ?? this.profile.logicalMtu;
  }

  injectOspfRoutes(): void {
    this.rib.routes = this.rib.routes.filter((route) => route.protocol !== 'OSPF');
    for (const neighbor of this.ospf.fullNeighbors()) {
      for (const destination of neighbor.advertisedRoutes) {
        const cidr = parseCidr(destination);
        if (!cidr) continue;
        this.rib.addRoute({
          destination: `${cidr.network}/${cidr.prefix}`,
          prefix: cidr.prefix,
          networkInt: cidr.networkInt,
          protocol: 'OSPF',
          preference: 10,
          active: true,
          hidden: false,
          nextHop: neighbor.address,
          interfaceName: neighbor.interfaceName,
          kind: 'unicast',
          metric: 10,
          age: 1200 + (cidr.networkInt % 600),
        });
      }
    }
  }

  tickOspf(): void {
    this.ospf.tick();
    this.injectOspfRoutes();
  }

  connect(interfaceName: string): void {
    this.connected.add(interfaceName);
    this.refresh();
  }

  disconnect(interfaceName: string): void {
    this.connected.delete(interfaceName);
    this.refresh();
  }

  routerId(): string {
    const configured = this.config.active.get(['routing-options', 'router-id']);
    if (configured?.values[0]) return configured.values[0];
    const lo0 = this.interfaces.find('lo0.0');
    return lo0?.unit?.addresses[0]?.address ?? '0.0.0.0';
  }

  serial(): string {
    return serialNumber(this.profile, this.name);
  }

  showVersion(): string[] {
    return [
      `Hostname: ${this.hostname()}`,
      `Model: ${this.profile.model}`,
      `Junos: ${this.profile.junosVersion}`,
      `JUNOS OS Kernel 64-bit  [${this.profile.junosVersion}]`,
      `JUNOS OS libs  [${this.profile.junosVersion}]`,
      `JUNOS Web Management  [${this.profile.junosVersion}]`,
      `JUNOS base OS boot  [${this.profile.junosVersion}]`,
      `Serial number: ${this.serial()}`,
    ];
  }

  showUptime(): string[] {
    const now = this.clock();
    const uptime = now - this.bootTime;
    return [
      `Current time: ${formatUtc(now)}`,
      `System booted: ${formatUtc(this.bootTime)} (${formatDuration(uptime)} ago)`,
      `Protocols started: ${formatUtc(this.bootTime + 10_000)}`,
      `Last configured: ${formatUtc(now - HOUR)} by root`,
      `${formatDuration(uptime)} up, 1 user, load averages: 0.00, 0.01, 0.05`,
    ];
  }

  operationalCommands(): CommandDefinition[] {
    const showInterfacesTerse: CommandDefinition = {
      path: ['show', 'interfaces', 'terse'],
      modes: ['operational'],
      help: 'Show terse interface information',
      handler: () => {
        this.refresh();
        return this.interfaces.terse();
      },
    };

    const showInterfacesDetail: CommandDefinition = {
      path: ['show', 'interfaces', 'detail'],
      modes: ['operational'],
      help: 'Show detailed interface information',
      handler: () => {
        this.refresh();
        return this.interfaces
          .all()
          .flatMap((intf) => this.interfaces.detail(intf.name) ?? []);
      },
    };

    const showInterfaces: CommandDefinition = {
      path: ['show', 'interfaces'],
      modes: ['operational'],
      help: 'Show interface information',
      args: [{ name: 'interface', required: false, variadic: true }],
      handler: (ctx) => {
        this.refresh();
        if (ctx.args.length === 0) {
          return this.interfaces
            .all()
            .flatMap((intf) => this.interfaces.detail(intf.name) ?? []);
        }
        const lines: string[] = [];
        for (const name of ctx.args) {
          const detail = this.interfaces.detail(name);
          if (!detail) return [`error: interface ${name} not found`];
          lines.push(...detail);
        }
        return lines;
      },
    };

    const showVersion: CommandDefinition = {
      path: ['show', 'version'],
      modes: ['operational'],
      help: 'Show software version',
      handler: () => this.showVersion(),
    };

    const showUptime: CommandDefinition = {
      path: ['show', 'system', 'uptime'],
      modes: ['operational'],
      help: 'Show system uptime',
      handler: () => this.showUptime(),
    };

    const showArp: CommandDefinition = {
      path: ['show', 'arp'],
      modes: ['operational'],
      help: 'Show ARP entries',
      handler: () => this.arp.render(),
    };

    const showConfiguration: CommandDefinition = {
      path: ['show', 'configuration'],
      modes: ['operational'],
      help: 'Show active configuration',
      handler: (ctx) => {
        if (hasPipe(ctx.pipes, 'displaySet')) {
          return renderDisplaySet(this.config.active);
        }
        const text = renderConfig(this.config.active);
        return text ? text.split('\n') : [];
      },
    };

    const showCandidate: CommandDefinition = {
      path: ['show', 'configuration', 'candidate'],
      modes: ['operational'],
      help: 'Show candidate configuration',
      handler: (ctx) => {
        if (hasPipe(ctx.pipes, 'displaySet')) {
          return renderDisplaySet(this.config.candidate);
        }
        const text = renderConfig(this.config.candidate);
        return text ? text.split('\n') : [];
      },
    };

    const showRoute: CommandDefinition = {
      path: ['show', 'route'],
      modes: ['operational'],
      help: 'Show routing table',
      args: [{ name: 'destination', required: false, variadic: true }],
      handler: (ctx) => {
        this.refresh();
        if (ctx.args.length === 0) return this.rib.render();
        const target = ctx.args[0];
        const cidr = parseCidr(target);
        const routes = this.rib.sorted().filter((route) => {
          if (route.destination === target) return true;
          if (cidr && route.prefix === cidr.prefix && route.networkInt === cidr.networkInt) {
            return true;
          }
          return false;
        });
        if (routes.length === 0) {
          return [`inet.0: 0 destinations, 0 routes (0 active, 0 holddown, 0 hidden)`];
        }
        const saved = this.rib.routes;
        this.rib.routes = routes;
        const rendered = this.rib.render();
        this.rib.routes = saved;
        return rendered;
      },
    };

    const showRouteSummary: CommandDefinition = {
      path: ['show', 'route', 'summary'],
      modes: ['operational'],
      help: 'Show routing table summary',
      handler: () => {
        this.refresh();
        return this.rib.summary(this.routerId());
      },
    };

    const showForwardingTable: CommandDefinition = {
      path: ['show', 'route', 'forwarding-table'],
      modes: ['operational'],
      help: 'Show forwarding table',
      handler: () => {
        this.refresh();
        return this.rib.forwardingTable();
      },
    };

    const pingCommand: CommandDefinition = {
      path: ['ping'],
      modes: ['operational', 'shell'],
      help: 'Ping a host',
      args: [
        { name: 'host', required: true },
        { name: 'count', required: false, type: 'number' },
      ],
      handler: (ctx) => {
        const target = ctx.args[0];
        if (target.includes('/') || !isIPv4Address(target)) {
          return [`ping: cannot resolve ${target}: Host name lookup failure`];
        }
        const rawCount = ctx.flags.c ?? ctx.flags.count ?? ctx.args[1];
        const count = rawCount === undefined || rawCount === true ? 5 : Number(rawCount);
        if (!this.network) {
          return [
            `PING ${target} (${target}): 56 data bytes`,
            'ping: sendto: No route to host',
            `--- ${target} ping statistics ---`,
            `${count} packets transmitted, 0 packets received, 100% packet loss`,
          ];
        }
        return this.network.ping(this, target, count);
      },
    };

    const tracerouteCommand: CommandDefinition = {
      path: ['traceroute'],
      modes: ['operational', 'shell'],
      help: 'Trace a route to a host',
      args: [{ name: 'host', required: true }],
      handler: (ctx) => {
        const target = ctx.args[0];
        if (target.includes('/') || !isIPv4Address(target)) {
          return [`traceroute: cannot resolve ${target}: Host name lookup failure`];
        }
        if (!this.network) {
          return ['traceroute: sendto: No route to host'];
        }
        return this.network.traceroute(this, target);
      },
    };

    const startShellCommand: CommandDefinition = {
      path: ['start', 'shell'],
      modes: ['operational'],
      help: 'Start the FreeBSD shell',
      handler: (ctx) => {
        ctx.session.setMode('shell');
        return [];
      },
    };

    const ifconfigCommand: CommandDefinition = {
      path: ['ifconfig'],
      modes: ['shell'],
      help: 'Show shell interface configuration',
      args: [{ name: 'interface', required: false }],
      handler: (ctx) => {
        this.refresh();
        const wanted = ctx.args[0];
        const found = wanted ? this.interfaces.find(wanted) : undefined;
        if (wanted && !found) return [`ifconfig: interface ${wanted} does not exist`];
        const list = found ? [found.intf] : this.interfaces.all();
        const lines: string[] = [];
        for (const intf of list) {
          const flags = ['UP', 'BROADCAST', 'RUNNING', 'SIMPLEX', 'MULTICAST'];
          lines.push(`${intf.name}: flags=3c03<${flags.join(',')}> mtu ${intf.mtu}`);
          lines.push(`        ether ${intf.mac}`);
          for (const unit of intf.units) {
            for (const address of unit.addresses) {
              lines.push(`        inet ${address.address}/${address.prefix}`);
            }
          }
        }
        return lines;
      },
    };

    const netstatCommand: CommandDefinition = {
      path: ['netstat'],
      modes: ['shell'],
      help: 'Show shell routing and socket information',
      args: [{ name: 'option', required: false, variadic: true }],
      handler: (ctx) => {
        this.refresh();
        const flags = Object.keys(ctx.flags).join('');
        if (flags.includes('r')) {
          const lines = [
            'Routing tables',
            '',
            'Internet:',
            'Destination        Gateway            Flags      Netif Expire',
          ];
          for (const route of this.rib.routes) {
            const netif = (route.interfaceName ?? '-').split('.')[0];
            lines.push(
              `${route.destination.padEnd(19)}${(route.nextHop ?? netif).padEnd(19)}${'U'.padEnd(11)}${netif}`,
            );
          }
          return lines;
        }
        if (flags.includes('i')) {
          const lines = [
            'Name    Mtu   Network       Address            Ipkts Ierrs    Opkts Oerrs  Coll',
          ];
          for (const intf of this.interfaces.all()) {
            lines.push(
              `${intf.name.padEnd(8)}${String(intf.mtu).padStart(6)}   <Link>        ${intf.mac.padEnd(19)} 0     0        0     0     0`,
            );
          }
          return lines;
        }
        return [
          'Active Internet connections',
          'Proto Recv-Q Send-Q  Local Address          Foreign Address        (state)',
          `tcp4       0      0  ${this.name.toLowerCase()}.ssh     *.*                    LISTEN`,
        ];
      },
    };

    const showOspfNeighbor: CommandDefinition = {
      path: ['show', 'ospf', 'neighbor'],
      modes: ['operational'],
      help: 'Show OSPF neighbors',
      handler: () => this.ospf.renderNeighbors(),
    };

    const showOspfInterface: CommandDefinition = {
      path: ['show', 'ospf', 'interface'],
      modes: ['operational'],
      help: 'Show OSPF interfaces',
      handler: () => this.ospf.renderInterfaces(),
    };

    const showOspfDatabase: CommandDefinition = {
      path: ['show', 'ospf', 'database'],
      modes: ['operational'],
      help: 'Show OSPF link-state database',
      handler: () => this.ospf.renderDatabase(),
    };

    const clearOspfNeighbor: CommandDefinition = {
      path: ['clear', 'ospf', 'neighbor'],
      modes: ['operational'],
      help: 'Clear OSPF neighbors',
      args: [{ name: 'address', required: false, type: 'ipv4' }],
      handler: (ctx) => {
        this.ospf.clear(ctx.args[0]);
        this.injectOspfRoutes();
        return [];
      },
    };

    return [
      showInterfacesTerse,
      showInterfacesDetail,
      showInterfaces,
      showVersion,
      showUptime,
      showArp,
      showConfiguration,
      showCandidate,
      showRoute,
      showRouteSummary,
      showForwardingTable,
      pingCommand,
      tracerouteCommand,
      startShellCommand,
      ifconfigCommand,
      netstatCommand,
      showOspfNeighbor,
      showOspfInterface,
      showOspfDatabase,
      clearOspfNeighbor,
    ];
  }

  registry(): CommandRegistry {
    return new CommandRegistry()
      .registerAll(this.operationalCommands())
      .registerAll(configCommands(this.config));
  }

  createSession(): JunosSession {
    const session = new JunosSession({
      hostname: this.hostname(),
      registry: this.registry(),
      hasUncommittedChanges: () => this.config.isDirty(),
      clock: this.clock,
    });
    return session;
  }
}
