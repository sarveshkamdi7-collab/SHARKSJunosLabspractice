export function padColumns(values: string[], widths: number[]): string {
  return values
    .map((value, index) => {
      const width = widths[index];
      if (width === undefined) return value;
      return value.padEnd(width);
    })
    .join('')
    .replace(/\s+$/, '');
}

export function renderTable(headers: string[], rows: string[][], widths: number[]): string[] {
  return [padColumns(headers, widths), ...rows.map((row) => padColumns(row, widths))];
}
