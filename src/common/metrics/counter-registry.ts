import { Global, Injectable, Module } from '@nestjs/common';

const maximumCounterSeries = 200;

type CounterFamily = { help: string; series: Map<string, number> };

/**
 * Process-local Prometheus counters for domain events (e.g. signup verdicts),
 * rendered by `/health/metrics` next to the HTTP series. Callers must use
 * low-cardinality label values (enums), never identifiers or user input.
 */
@Injectable()
export class CounterRegistry {
  private readonly families = new Map<string, CounterFamily>();
  private seriesCount = 0;

  increment(name: string, help: string, labels: Record<string, string>): void {
    let family = this.families.get(name);
    if (!family) {
      family = { help, series: new Map() };
      this.families.set(name, family);
    }
    const key = Object.keys(labels)
      .sort()
      .map((label) => `${label}="${escapeLabel(labels[label])}"`)
      .join(',');
    const current = family.series.get(key);
    if (current === undefined && this.seriesCount >= maximumCounterSeries) return;
    if (current === undefined) this.seriesCount += 1;
    family.series.set(key, (current ?? 0) + 1);
  }

  render(): string[] {
    const lines: string[] = [];
    for (const [name, family] of [...this.families].sort(([left], [right]) => left.localeCompare(right))) {
      lines.push(`# HELP ${name} ${family.help}`, `# TYPE ${name} counter`);
      for (const [labels, value] of [...family.series].sort(([left], [right]) => left.localeCompare(right))) {
        lines.push(`${name}{${labels}} ${value}`);
      }
    }
    return lines;
  }
}

function escapeLabel(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/\n/g, '\\n').replace(/"/g, '\\"');
}

/** Global so every module records into the one registry the metrics endpoint renders. */
@Global()
@Module({ providers: [CounterRegistry], exports: [CounterRegistry] })
export class CounterRegistryModule {}
