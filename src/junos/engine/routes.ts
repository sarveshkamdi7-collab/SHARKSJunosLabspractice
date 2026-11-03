import { ConfigTree } from '../config/tree';
import { renderTable } from '../render/table';
import type { DeviceInterface } from './interfaces';
import {
  containsAddress,
  formatAge,
  ipToInt,
  maskForPrefix,
  networkOf,
  parseCidr,
} from './ipv4';

export type RouteProtocol = 'Direct' | 'Local' | 'Static' | 'OSPF' | 'BGP';
export type RouteKind = 'direct' | 'local' | 'unicast' | 'discard' | 'reject';

export interface Route {
  destination: string;
  prefix: number;
  networkInt: number;
  protocol: RouteProtocol;
  preference: number;
  active: boolean;
  hidden: boolean;
  nextHop?: string;
  interfaceName?: string;
  kind: RouteKind;
  age: number;
  metric?: number;
  index: number;
}

const PROTOCOL_RANK: Record<RouteProtocol, number> = {
  Direct: 0,
  Local: 1,
  Static: 2,
  OSPF: 3,
  BGP: 4,
};

interface ResolvedInterface {
  interfaceName: string;
  physicalName: string;
}

function physicalName(name: string): string {
  return name.split('.')[0];
}

export class Rib {
  routes: Route[] = [];

  addRoute(route: Omit<Route, 'index'>): Route {
    const full: Route = { ...route, index: this.routes.length };
    this.routes.push(full);
    return full;
  }

  clear(): void {
    this.routes = [];
  }

  rebuild(interfaces: DeviceInterface[], config: ConfigTree): void {
    this.clear();
    const directSeen = new Set<string>();

    for (const intf of interfaces) {
      for (const unit of intf.units) {
        for (const address of unit.addresses) {
          const cidr = parseCidr(`${address.address}/${address.prefix}`);
          if (!cidr) continue;
          const network = `${cidr.network}/${cidr.prefix}`;
          if (!directSeen.has(network)) {
            directSeen.add(network);
            this.addRoute({
              destination: network,
              prefix: cidr.prefix,
              networkInt: cidr.networkInt,
              protocol: 'Direct',
              preference: 0,
              active: intf.linkUp,
              hidden: false,
              nextHop: unit.name,
              interfaceName: unit.name,
              kind: 'direct',
              age: 86_400 + (cidr.networkInt % 3_600),
            });
          }
          this.addRoute({
            destination: `${cidr.address}/32`,
            prefix: 32,
            networkInt: cidr.addressInt,
            protocol: 'Local',
            preference: 0,
            active: intf.linkUp,
            hidden: false,
            nextHop: 'Local',
            interfaceName: unit.name,
            kind: 'local',
            age: 86_400 + (cidr.addressInt % 3_600),
          });
        }
      }
    }

    this.addStaticRoutes(interfaces, config);
  }

  private addStaticRoutes(interfaces: DeviceInterface[], config: ConfigTree): void {
    const staticNode = config.get(['routing-options', 'static', 'route']);
    if (!staticNode) return;

    for (const [key, node] of staticNode.children) {
      if (node.leaf) continue;
      const cidr = parseCidr(key);
      if (!cidr) continue;
      const preference = Number(node.children.get('preference')?.values[0] ?? 5);
      const discard = node.children.has('discard');
      const reject = node.children.has('reject');
      const nextHops = node.children.get('next-hop')?.values ?? [];
      const age = 5 + (cidr.networkInt % 120);

      if (discard || reject) {
        this.addRoute({
          destination: `${cidr.network}/${cidr.prefix}`,
          prefix: cidr.prefix,
          networkInt: cidr.networkInt,
          protocol: 'Static',
          preference,
          active: true,
          hidden: false,
          kind: discard ? 'discard' : 'reject',
          age,
        });
        continue;
      }

      if (nextHops.length === 0) {
        this.addRoute({
          destination: `${cidr.network}/${cidr.prefix}`,
          prefix: cidr.prefix,
          networkInt: cidr.networkInt,
          protocol: 'Static',
          preference,
          active: false,
          hidden: true,
          kind: 'unicast',
          age,
        });
        continue;
      }

      for (const nextHop of nextHops) {
        const resolved = this.resolveNextHop(nextHop, interfaces);
        this.addRoute({
          destination: `${cidr.network}/${cidr.prefix}`,
          prefix: cidr.prefix,
          networkInt: cidr.networkInt,
          protocol: 'Static',
          preference,
          active: Boolean(resolved),
          hidden: !resolved,
          nextHop,
          interfaceName: resolved?.interfaceName,
          kind: 'unicast',
          age,
        });
      }
    }
  }

  private resolveNextHop(nextHop: string, interfaces: DeviceInterface[]): ResolvedInterface | undefined {
    if (!/^\d{1,3}(\.\d{1,3}){3}$/.test(nextHop)) return undefined;
    const nextInt = ipToInt(nextHop);
    for (const intf of interfaces) {
      for (const unit of intf.units) {
        for (const address of unit.addresses) {
          const cidr = parseCidr(`${address.address}/${address.prefix}`);
          if (!cidr) continue;
          if (cidr.prefix < 32 && containsAddress(cidr, nextInt)) {
            return { interfaceName: unit.name, physicalName: physicalName(unit.name) };
          }
        }
      }
    }
    return undefined;
  }

  sorted(): Route[] {
    return [...this.routes].sort((a, b) => {
      if (a.networkInt !== b.networkInt) return a.networkInt - b.networkInt;
      if (a.prefix !== b.prefix) return a.prefix - b.prefix;
      if (a.preference !== b.preference) return a.preference - b.preference;
      return PROTOCOL_RANK[a.protocol] - PROTOCOL_RANK[b.protocol];
    });
  }

  lookup(address: string): Route | undefined {
    const target = ipToInt(address);
    const matches = this.routes.filter((route) => {
      if (!route.active || route.hidden) return false;
      return ((target & maskForPrefix(route.prefix)) >>> 0) === route.networkInt;
    });
    matches.sort((a, b) => {
      if (a.prefix !== b.prefix) return b.prefix - a.prefix;
      if (a.preference !== b.preference) return a.preference - b.preference;
      if (a.kind === 'local' && b.kind !== 'local') return -1;
      if (b.kind === 'local' && a.kind !== 'local') return 1;
      return PROTOCOL_RANK[a.protocol] - PROTOCOL_RANK[b.protocol];
    });
    return matches[0];
  }

  destinations(): number {
    return new Set(this.routes.map((route) => route.destination)).size;
  }

  render(): string[] {
    const routes = this.sorted();
    const active = routes.filter((route) => route.active).length;
    const hidden = routes.filter((route) => route.hidden).length;
    const lines = [
      `inet.0: ${this.destinations()} destinations, ${routes.length} routes (${active} active, 0 holddown, ${hidden} hidden)`,
      '',
      '+ = Active Route, - = Last Active, * = Both',
      '',
    ];

    for (const route of routes) {
      lines.push(
        `${route.destination.padEnd(18)}${route.active ? '*' : ' '}[${route.protocol}/${route.preference}] ${formatAge(route.age)}`,
      );
      if (route.kind === 'direct') {
        lines.push(`${' '.repeat(20)}> via ${route.interfaceName}`);
      } else if (route.kind === 'local') {
        lines.push(`${' '.repeat(22)}Local via ${route.interfaceName}`);
      } else if (route.kind === 'discard') {
        lines.push(`${' '.repeat(22)}Discard`);
      } else if (route.kind === 'reject') {
        lines.push(`${' '.repeat(22)}Reject`);
      } else if (route.nextHop) {
        const via = route.interfaceName ? ` via ${route.interfaceName}` : '';
        lines.push(`${' '.repeat(20)}> to ${route.nextHop}${via}`);
      }
    }
    return lines;
  }

  summary(routerId = '0.0.0.0'): string[] {
    const routes = this.sorted();
    const active = routes.filter((route) => route.active).length;
    const hidden = routes.filter((route) => route.hidden).length;
    const lines = [
      `Router ID: ${routerId}`,
      '',
      `inet.0: ${this.destinations()} destinations, ${routes.length} routes (${active} active, 0 holddown, ${hidden} hidden)`,
    ];
    for (const protocol of ['Direct', 'Local', 'Static', 'OSPF', 'BGP'] as RouteProtocol[]) {
      const group = routes.filter((route) => route.protocol === protocol);
      if (group.length === 0) continue;
      const groupActive = group.filter((route) => route.active).length;
      lines.push(
        `${protocol.padStart(20)}: ${String(group.length).padStart(6)} routes, ${String(groupActive).padStart(6)} active`,
      );
    }
    return lines;
  }

  forwardingTable(): string[] {
    const routes = this.sorted();
    const rows = routes.map((route, index) => {
      const nextHop = route.kind === 'unicast' && route.nextHop ? route.nextHop : '0:0:0:0:0:0';
      const type =
        route.kind === 'discard' || route.kind === 'reject' ? route.kind : 'ucst';
      return [
        route.destination,
        'user',
        '0',
        nextHop,
        type,
        String(540 + index),
        '3',
        route.interfaceName ?? '',
      ];
    });
    return [
      'Routing table: default.inet',
      'Internet:',
      ...renderTable(
        ['Destination', 'Type', 'RtRef', 'Next hop', 'Type', 'Index', 'NhRef', 'Netif'],
        rows,
        [19, 5, 6, 19, 8, 9, 6],
      ),
    ];
  }
}
