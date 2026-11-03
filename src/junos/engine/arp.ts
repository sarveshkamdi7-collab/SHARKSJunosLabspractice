import { renderTable } from '../render/table';

export interface ArpEntry {
  mac: string;
  address: string;
  name: string;
  interfaceName: string;
  flags: string;
}

const ARP_WIDTHS = [18, 16, 26, 20];

export class ArpTable {
  entries: ArpEntry[] = [];

  clear(): void {
    this.entries = [];
  }

  add(entry: ArpEntry): void {
    const existing = this.entries.findIndex(
      (candidate) =>
        candidate.address === entry.address && candidate.interfaceName === entry.interfaceName,
    );
    if (existing >= 0) this.entries[existing] = entry;
    else this.entries.push(entry);
  }

  remove(address: string): void {
    this.entries = this.entries.filter((entry) => entry.address !== address);
  }

  set(entries: ArpEntry[]): void {
    this.entries = [...entries];
  }

  lookup(address: string): ArpEntry | undefined {
    return this.entries.find((entry) => entry.address === address);
  }

  render(): string[] {
    const rows = this.entries.map((entry) => [
      entry.mac,
      entry.address,
      entry.name,
      entry.interfaceName,
      entry.flags,
    ]);
    return renderTable(
      ['MAC Address', 'Address', 'Name', 'Interface', 'Flags'],
      rows,
      ARP_WIDTHS,
    );
  }
}
