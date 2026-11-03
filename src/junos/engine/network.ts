import type { JunosDevice } from './device';
import type { DeviceInterface, LogicalUnit } from './interfaces';
import { stableCounter } from './profiles';

export interface Link {
  a: { device: JunosDevice; interface: string };
  b: { device: JunosDevice; interface: string };
}

export interface TraceHop {
  address: string;
  ttl: number;
}

export interface TraceResult {
  ok: boolean;
  hops: TraceHop[];
  ttl: number;
  reason?: string;
}

function physicalName(name: string): string {
  return name.split('.')[0];
}

function formatMs(value: number): string {
  return value.toFixed(3);
}

export class Network {
  devices: JunosDevice[] = [];
  links: Link[] = [];

  addDevice(device: JunosDevice): void {
    if (!this.devices.includes(device)) {
      this.devices.push(device);
      device.network = this;
    }
  }

  connect(
    a: JunosDevice,
    aInterface: string,
    b: JunosDevice,
    bInterface: string,
  ): void {
    const aName = physicalName(aInterface);
    const bName = physicalName(bInterface);
    this.addDevice(a);
    this.addDevice(b);
    this.links.push({ a: { device: a, interface: aName }, b: { device: b, interface: bName } });
    a.connect(aName);
    b.connect(bName);
    this.populateArp(a, aName, b, bName);
    this.populateArp(b, bName, a, aName);
    this.discoverOspf();
  }

  disconnect(a: JunosDevice, aInterface: string, b: JunosDevice, bInterface: string): void {
    const aName = physicalName(aInterface);
    const bName = physicalName(bInterface);
    this.links = this.links.filter(
      (link) =>
        !(
          link.a.device === a &&
          link.a.interface === aName &&
          link.b.device === b &&
          link.b.interface === bName
        ) &&
        !(
          link.a.device === b &&
          link.a.interface === bName &&
          link.b.device === a &&
          link.b.interface === aName
        ),
    );
    if (!this.hasLink(a, aName)) a.disconnect(aName);
    if (!this.hasLink(b, bName)) b.disconnect(bName);
    this.discoverOspf();
  }

  discoverOspf(): void {
    for (const link of this.links) {
      const aOspf = link.a.device.ospf.findInterfaceForPhysical(link.a.interface);
      const bOspf = link.b.device.ospf.findInterfaceForPhysical(link.b.interface);
      if (!aOspf || !bOspf || aOspf.passive || bOspf.passive) continue;
      const aAddress = this.interfaceAddress(link.a.device, aOspf.name)?.address;
      const bAddress = this.interfaceAddress(link.b.device, bOspf.name)?.address;
      if (!aAddress || !bAddress) continue;
      link.a.device.ospf.addNeighbor({
        address: bAddress,
        routerId: link.b.device.ospf.routerId,
        interfaceName: aOspf.name,
        area: aOspf.area,
        mtu: aOspf.mtu,
        remoteArea: bOspf.area,
        remoteMtu: bOspf.mtu,
        advertisedRoutes: link.b.device.ospf.advertisedRoutes,
      });
      link.b.device.ospf.addNeighbor({
        address: aAddress,
        routerId: link.a.device.ospf.routerId,
        interfaceName: bOspf.name,
        area: bOspf.area,
        mtu: bOspf.mtu,
        remoteArea: aOspf.area,
        remoteMtu: aOspf.mtu,
        advertisedRoutes: link.a.device.ospf.advertisedRoutes,
      });
    }
  }

  private hasLink(device: JunosDevice, interfaceName: string): boolean {
    return this.links.some(
      (link) =>
        (link.a.device === device && link.a.interface === interfaceName) ||
        (link.b.device === device && link.b.interface === interfaceName),
    );
  }

  peer(
    device: JunosDevice,
    interfaceName: string,
  ): { device: JunosDevice; interfaceName: string } | undefined {
    const physical = physicalName(interfaceName);
    for (const link of this.links) {
      if (link.a.device === device && link.a.interface === physical) {
        return { device: link.b.device, interfaceName: link.b.interface };
      }
      if (link.b.device === device && link.b.interface === physical) {
        return { device: link.a.device, interfaceName: link.a.interface };
      }
    }
    return undefined;
  }

  interfaceAddress(
    device: JunosDevice,
    interfaceName: string,
  ): { intf: DeviceInterface; unit: LogicalUnit; address: string } | undefined {
    const physical = physicalName(interfaceName);
    const intf = device.interfaces.all().find((candidate) => candidate.name === physical);
    if (!intf) return undefined;
    const requestedUnit = interfaceName.includes('.')
      ? Number(interfaceName.split('.')[1])
      : undefined;
    const unit =
      requestedUnit === undefined
        ? intf.units[0]
        : intf.units.find((candidate) => candidate.unit === requestedUnit);
    if (!unit || unit.addresses.length === 0) return undefined;
    return { intf, unit, address: unit.addresses[0].address };
  }

  private populateArp(
    local: JunosDevice,
    localInterface: string,
    remote: JunosDevice,
    remoteInterface: string,
  ): void {
    const localAddr = this.interfaceAddress(local, localInterface);
    const remoteAddr = this.interfaceAddress(remote, remoteInterface);
    if (!localAddr || !remoteAddr) return;
    local.arp.add({
      mac: remoteAddr.intf.mac,
      address: remoteAddr.address,
      name: remoteAddr.address,
      interfaceName: localAddr.unit.name,
      flags: 'none',
    });
    remote.arp.add({
      mac: localAddr.intf.mac,
      address: localAddr.address,
      name: localAddr.address,
      interfaceName: remoteAddr.unit.name,
      flags: 'none',
    });
  }

  isLocal(device: JunosDevice, address: string): boolean {
    return Boolean(device.interfaces.findByAddress(address));
  }

  trace(source: JunosDevice, destination: string, maxHops = 30): TraceResult {
    let device = source;
    const hops: TraceHop[] = [];
    const visited = new Set<string>([source.name]);
    let ttl = 64;

    if (this.isLocal(source, destination)) {
      return { ok: true, hops, ttl };
    }

    for (let count = 0; count < maxHops; count++) {
      device.refresh();
      const route = device.rib.lookup(destination);
      if (!route) {
        return { ok: false, hops, ttl, reason: 'No route to host' };
      }
      if (route.kind === 'discard' || route.kind === 'reject') {
        return { ok: false, hops, ttl, reason: 'No route to host' };
      }
      if (!route.interfaceName) {
        return { ok: false, hops, ttl, reason: 'No route to host' };
      }
      const next = this.peer(device, route.interfaceName);
      if (!next) {
        return { ok: false, hops, ttl, reason: 'Destination Host Unreachable' };
      }
      const nextAddress = this.interfaceAddress(next.device, next.interfaceName)?.address;
      const hopAddress = nextAddress ?? route.nextHop ?? destination;
      const nextIsDestination = this.isLocal(next.device, destination);
      if (!nextIsDestination) ttl = Math.max(1, ttl - 1);
      hops.push({ address: hopAddress, ttl });
      if (visited.has(next.device.name)) {
        return { ok: false, hops, ttl, reason: 'Routing loop' };
      }
      visited.add(next.device.name);
      device = next.device;
      if (nextIsDestination) {
        return { ok: true, hops, ttl };
      }
    }

    return { ok: false, hops, ttl, reason: 'TTL expired' };
  }

  ping(source: JunosDevice, destination: string, count = 5): string[] {
    const result = this.trace(source, destination);
    const lines = [`PING ${destination} (${destination}): 56 data bytes`];

    if (!result.ok) {
      for (let seq = 0; seq < count; seq++) {
        lines.push(`ping: sendto: ${result.reason ?? 'No route to host'}`);
      }
      lines.push(
        `--- ${destination} ping statistics ---`,
        `${count} packets transmitted, 0 packets received, 100% packet loss`,
      );
      return lines;
    }

    const times: number[] = [];
    for (let seq = 0; seq < count; seq++) {
      const base = stableCounter(`${source.name}:${destination}:${seq}`, 200, 800) / 1000;
      const time = Number((base + Math.max(0, result.hops.length - 1) * 0.25).toFixed(3));
      times.push(time);
      lines.push(
        `64 bytes from ${destination}: icmp_seq=${seq} ttl=${result.ttl} time=${formatMs(time)} ms`,
      );
    }

    const min = Math.min(...times);
    const max = Math.max(...times);
    const avg = times.reduce((sum, value) => sum + value, 0) / times.length;
    const variance =
      times.reduce((sum, value) => sum + (value - avg) ** 2, 0) / times.length;
    const stddev = Math.sqrt(variance);
    lines.push(
      `--- ${destination} ping statistics ---`,
      `${count} packets transmitted, ${count} packets received, 0% packet loss`,
      `round-trip min/avg/max/stddev = ${min.toFixed(3)}/${avg.toFixed(3)}/${max.toFixed(3)}/${stddev.toFixed(3)} ms`,
    );
    return lines;
  }

  traceroute(source: JunosDevice, destination: string): string[] {
    const result = this.trace(source, destination);
    if (!result.ok) {
      return [`traceroute: sendto: ${result.reason ?? 'No route to host'}`];
    }

    const lines = [
      `traceroute to ${destination} (${destination}), 30 hops max, 40 byte packets`,
    ];
    const addresses = result.hops.map((hop) => hop.address);
    if (addresses[addresses.length - 1] !== destination) addresses.push(destination);
    if (addresses.length === 0) addresses.push(destination);

    addresses.forEach((address, index) => {
      const base = stableCounter(`${source.name}:${destination}:trace:${index}`, 300, 900) / 1000;
      const times = [base, base + 0.02, base + 0.04].map((value) => formatMs(value));
      lines.push(
        ` ${String(index + 1).padStart(2)}  ${address} (${address})  ${times[0]} ms  ${times[1]} ms  ${times[2]} ms`,
      );
    });
    return lines;
  }
}
