import { renderTable } from '../render/table';

export type OspfState =
  | 'Down'
  | 'Init'
  | '2Way'
  | 'ExStart'
  | 'Exchange'
  | 'Loading'
  | 'Full';

export type OspfNetworkType = 'broadcast' | 'point-to-point';

export interface OspfInterfaceSpec {
  name: string;
  area: string;
  mtu: number;
  passive?: boolean;
  networkType?: OspfNetworkType;
}

export interface OspfInterface {
  name: string;
  area: string;
  mtu: number;
  passive: boolean;
  networkType: OspfNetworkType;
  state: 'DR' | 'BDR' | 'DROther' | 'Waiting' | 'Point-to-Point';
  drId: string;
  bdrId: string;
}

export interface OspfNeighborOptions {
  address: string;
  routerId: string;
  interfaceName: string;
  area: string;
  mtu?: number;
  remoteArea?: string;
  remoteMtu?: number;
  priority?: number;
  advertisedRoutes?: string[];
}

export interface OspfNeighbor {
  address: string;
  routerId: string;
  interfaceName: string;
  area: string;
  mtu: number;
  remoteArea: string;
  remoteMtu: number;
  priority: number;
  state: OspfState;
  deadTime: number;
  mismatch?: string;
  injected: boolean;
  advertisedRoutes: string[];
}

const NEIGHBOR_WIDTHS = [17, 9, 13, 4, 16, 11, 17];
const INTERFACE_WIDTHS = [17, 8, 16, 16, 16, 5];
const DATABASE_WIDTHS = [10, 17, 17, 12, 7, 5, 9, 5];

const FLAGS: Record<OspfState, string> = {
  Down: '0x0',
  Init: '0x1',
  '2Way': '0x2',
  ExStart: '0x4',
  Exchange: '0x8',
  Loading: '0x10',
  Full: '0x2',
};

const NEXT_STATE: Partial<Record<OspfState, OspfState>> = {
  Down: 'Init',
  Init: '2Way',
  '2Way': 'ExStart',
  ExStart: 'Exchange',
  Exchange: 'Loading',
  Loading: 'Full',
};

function formatDeadTime(seconds: number): string {
  const whole = Math.max(0, Math.floor(seconds));
  return `${String(Math.floor(whole / 60)).padStart(2, '0')}:${String(whole % 60).padStart(2, '0')}`;
}

function physicalName(name: string): string {
  return name.split('.')[0];
}

export class OspfEngine {
  routerId: string;
  neighbors: OspfNeighbor[] = [];
  interfaces = new Map<string, OspfInterface>();
  advertisedRoutes: string[] = [];
  onFull?: (neighbor: OspfNeighbor) => void;

  constructor(routerId: string, onFull?: (neighbor: OspfNeighbor) => void) {
    this.routerId = routerId;
    this.onFull = onFull;
  }

  configure(specs: OspfInterfaceSpec[]): void {
    const names = new Set(specs.map((spec) => spec.name));
    const next = new Map<string, OspfInterface>();
    for (const spec of specs) {
      const existing = this.interfaces.get(spec.name);
      next.set(spec.name, {
        name: spec.name,
        area: spec.area,
        mtu: spec.mtu,
        passive: Boolean(spec.passive),
        networkType: spec.networkType ?? 'broadcast',
        state: existing?.state ?? 'Waiting',
        drId: existing?.drId ?? this.routerId,
        bdrId: existing?.bdrId ?? '0.0.0.0',
      });
    }
    this.interfaces = next;
    this.neighbors = this.neighbors.filter((neighbor) => names.has(neighbor.interfaceName));
  }

  findInterfaceForPhysical(name: string): OspfInterface | undefined {
    for (const intf of this.interfaces.values()) {
      if (intf.name === name || physicalName(intf.name) === physicalName(name)) return intf;
    }
    return undefined;
  }

  addNeighbor(options: OspfNeighborOptions): OspfNeighbor {
    const existing = this.neighbors.find(
      (neighbor) =>
        neighbor.address === options.address &&
        neighbor.interfaceName === options.interfaceName,
    );
    const mtu = options.mtu ?? this.interfaces.get(options.interfaceName)?.mtu ?? 1500;
    const remoteArea = options.remoteArea ?? options.area;
    const remoteMtu = options.remoteMtu ?? mtu;
    if (existing) {
      existing.routerId = options.routerId;
      existing.area = options.area;
      existing.mtu = mtu;
      existing.remoteArea = remoteArea;
      existing.remoteMtu = remoteMtu;
      existing.priority = options.priority ?? existing.priority;
      if (options.advertisedRoutes) existing.advertisedRoutes = options.advertisedRoutes;
      return existing;
    }
    const neighbor: OspfNeighbor = {
      address: options.address,
      routerId: options.routerId,
      interfaceName: options.interfaceName,
      area: options.area,
      mtu,
      remoteArea,
      remoteMtu,
      priority: options.priority ?? 1,
      state: 'Down',
      deadTime: 40,
      injected: false,
      advertisedRoutes: options.advertisedRoutes ?? [],
    };
    this.neighbors.push(neighbor);
    return neighbor;
  }

  tick(): void {
    for (const neighbor of this.neighbors) {
      this.advance(neighbor);
    }
    for (const name of this.interfaces.keys()) {
      this.elect(name);
    }
  }

  private advance(neighbor: OspfNeighbor): void {
    neighbor.deadTime = Math.max(1, neighbor.deadTime - 1);
    neighbor.mismatch = this.mismatchReason(neighbor);

    if (neighbor.state === 'Full') return;
    if (neighbor.state === 'ExStart') {
      if (neighbor.mismatch) return;
      neighbor.state = 'Exchange';
      return;
    }
    const next = NEXT_STATE[neighbor.state];
    if (!next) return;
    neighbor.state = next;
    if (next === '2Way') {
      this.elect(neighbor.interfaceName);
    }
    if (next === 'Full' && !neighbor.injected) {
      neighbor.injected = true;
      this.onFull?.(neighbor);
    }
  }

  private mismatchReason(neighbor: OspfNeighbor): string | undefined {
    if (neighbor.remoteArea !== neighbor.area) return 'Area ID mismatch';
    if (neighbor.remoteMtu !== neighbor.mtu) return 'MTU mismatch';
    return undefined;
  }

  private elect(interfaceName: string): void {
    const intf = this.interfaces.get(interfaceName);
    if (!intf) return;
    if (intf.networkType === 'point-to-point') {
      intf.state = 'Point-to-Point';
      intf.drId = '0.0.0.0';
      intf.bdrId = '0.0.0.0';
      return;
    }
    const candidates = [
      this.routerId,
      ...this.neighbors
        .filter(
          (neighbor) =>
            neighbor.interfaceName === interfaceName &&
            neighbor.state !== 'Down' &&
            neighbor.state !== 'Init',
        )
        .map((neighbor) => neighbor.routerId),
    ];
    const unique = [...new Set(candidates)].sort((a, b) =>
      b.localeCompare(a, 'en', { numeric: true }),
    );
    if (
      this.neighbors.every(
        (neighbor) =>
          neighbor.interfaceName !== interfaceName ||
          neighbor.state === 'Down' ||
          neighbor.state === 'Init',
      )
    ) {
      intf.state = 'Waiting';
      intf.drId = '0.0.0.0';
      intf.bdrId = '0.0.0.0';
      return;
    }
    intf.drId = unique[0];
    intf.bdrId = unique[1] ?? '0.0.0.0';
    if (unique[0] === this.routerId) intf.state = 'DR';
    else if (unique[1] === this.routerId) intf.state = 'BDR';
    else intf.state = 'DROther';
  }

  clear(target?: string): void {
    for (const neighbor of this.neighbors) {
      if (target && neighbor.address !== target && neighbor.routerId !== target) continue;
      neighbor.state = 'Down';
      neighbor.injected = false;
      neighbor.deadTime = 40;
    }
    for (const name of this.interfaces.keys()) this.elect(name);
  }

  fullNeighbors(): OspfNeighbor[] {
    return this.neighbors.filter((neighbor) => neighbor.state === 'Full');
  }

  renderNeighbors(): string[] {
    return renderTable(
      ['Address', 'Flags', 'RID', 'Pri', 'State', 'Dead Time', 'Interface'],
      this.neighbors.map((neighbor) => [
        neighbor.address,
        FLAGS[neighbor.state],
        neighbor.routerId,
        String(neighbor.priority),
        neighbor.state + (neighbor.mismatch ? ` (${neighbor.mismatch})` : ''),
        formatDeadTime(neighbor.deadTime),
        neighbor.interfaceName,
      ]),
      NEIGHBOR_WIDTHS,
    );
  }

  renderInterfaces(): string[] {
    const rows = [...this.interfaces.values()].map((intf) => [
      intf.name,
      intf.state,
      intf.area,
      intf.drId,
      intf.bdrId,
      String(
        this.neighbors.filter((neighbor) => neighbor.interfaceName === intf.name).length,
      ),
    ]);
    return renderTable(
      ['Interface', 'State', 'Area', 'DR ID', 'BDR ID', 'Nbrs'],
      rows,
      INTERFACE_WIDTHS,
    );
  }

  renderDatabase(): string[] {
    const areas = new Set<string>();
    for (const intf of this.interfaces.values()) areas.add(intf.area);
    if (areas.size === 0) areas.add('0.0.0.0');

    const lines: string[] = [];
    for (const area of [...areas].sort()) {
      lines.push(`    OSPF database, Area ${area}`);
      const rows: string[][] = [
        ['Router', this.routerId, this.routerId, '0x80000001', '1234', '0x22', '0x5f3c', '48'],
      ];
      for (const neighbor of this.neighbors) {
        if (neighbor.area !== area || neighbor.state !== 'Full') continue;
        rows.push([
          'Router',
          neighbor.routerId,
          neighbor.routerId,
          '0x80000001',
          '1234',
          '0x22',
          '0x9a21',
          '48',
        ]);
      }
      lines.push(
        ...renderTable(
          ['Type', 'ID', 'Adv Rtr', 'Seq', 'Age', 'Opt', 'Cksum', 'Len'],
          rows,
          DATABASE_WIDTHS,
        ),
      );
      lines.push('');
    }
    while (lines[lines.length - 1] === '') lines.pop();
    return lines;
  }
}
