import { Injectable } from '@nestjs/common';
import { Sequelize } from 'sequelize-typescript';

const durationBucketsSeconds = [0.05, 0.1, 0.25, 0.5, 1, 2.5, 5] as const;
const maximumHttpSeries = 250;

type HttpMetricSeries = {
  method: string;
  route: string;
  statusCode: number;
  count: number;
  durationSecondsSum: number;
  buckets: number[];
};

type PoolSnapshot = {
  size: number;
  available: number;
  using: number;
  waiting: number;
};

/**
 * Stores only low-cardinality HTTP series and renders a Prometheus-compatible
 * snapshot without introducing a second logging or telemetry dependency.
 */
@Injectable()
export class HttpMetricsService {
  private readonly httpSeries = new Map<string, HttpMetricSeries>();
  private droppedSeries = 0;

  constructor(private readonly sequelize: Sequelize) {}

  recordHttpRequest(
    method: string,
    route: string,
    statusCode: number,
    durationMilliseconds: number,
  ): void {
    const normalizedMethod = method.toUpperCase().slice(0, 12);
    const normalizedRoute = route.slice(0, 240);
    const seriesKey = `${normalizedMethod}|${normalizedRoute}|${statusCode}`;
    let series = this.httpSeries.get(seriesKey);

    if (!series) {
      if (this.httpSeries.size >= maximumHttpSeries) {
        this.droppedSeries += 1;
        return;
      }

      series = {
        method: normalizedMethod,
        route: normalizedRoute,
        statusCode,
        count: 0,
        durationSecondsSum: 0,
        buckets: durationBucketsSeconds.map(() => 0),
      };
      this.httpSeries.set(seriesKey, series);
    }

    const durationSeconds = Math.max(0, durationMilliseconds / 1000);
    series.count += 1;
    series.durationSecondsSum += durationSeconds;
    durationBucketsSeconds.forEach((bucket, index) => {
      if (durationSeconds <= bucket) {
        series!.buckets[index] += 1;
      }
    });
  }

  /** Returns a point-in-time metrics document without retaining request payloads. */
  renderPrometheus(): string {
    const memoryUsage = process.memoryUsage();
    const pool = this.readPoolSnapshot();
    const lines = [
      '# HELP gym_sheet_process_uptime_seconds Process uptime in seconds.',
      '# TYPE gym_sheet_process_uptime_seconds gauge',
      `gym_sheet_process_uptime_seconds ${process.uptime().toFixed(3)}`,
      '# HELP gym_sheet_process_resident_memory_bytes Resident memory size in bytes.',
      '# TYPE gym_sheet_process_resident_memory_bytes gauge',
      `gym_sheet_process_resident_memory_bytes ${memoryUsage.rss}`,
      '# HELP gym_sheet_node_heap_used_bytes Node.js heap used in bytes.',
      '# TYPE gym_sheet_node_heap_used_bytes gauge',
      `gym_sheet_node_heap_used_bytes ${memoryUsage.heapUsed}`,
      '# HELP gym_sheet_database_pool_connections Sequelize pool connections by state.',
      '# TYPE gym_sheet_database_pool_connections gauge',
      `gym_sheet_database_pool_connections{state="size"} ${pool.size}`,
      `gym_sheet_database_pool_connections{state="available"} ${pool.available}`,
      `gym_sheet_database_pool_connections{state="using"} ${pool.using}`,
      `gym_sheet_database_pool_connections{state="waiting"} ${pool.waiting}`,
      '# HELP gym_sheet_http_metric_series_dropped_total HTTP observations dropped after the bounded series limit.',
      '# TYPE gym_sheet_http_metric_series_dropped_total counter',
      `gym_sheet_http_metric_series_dropped_total ${this.droppedSeries}`,
      '# HELP gym_sheet_http_requests_total Completed HTTP requests.',
      '# TYPE gym_sheet_http_requests_total counter',
      '# HELP gym_sheet_http_request_duration_seconds HTTP request duration.',
      '# TYPE gym_sheet_http_request_duration_seconds histogram',
    ];

    for (const series of [...this.httpSeries.values()].sort((left, right) =>
      `${left.route}|${left.method}|${left.statusCode}`.localeCompare(
        `${right.route}|${right.method}|${right.statusCode}`,
      ),
    )) {
      const labels = this.formatLabels(series);
      lines.push(`gym_sheet_http_requests_total{${labels}} ${series.count}`);
      durationBucketsSeconds.forEach((bucket, index) => {
        lines.push(
          `gym_sheet_http_request_duration_seconds_bucket{${labels},le="${bucket}"} ${series.buckets[index]}`,
        );
      });
      lines.push(
        `gym_sheet_http_request_duration_seconds_bucket{${labels},le="+Inf"} ${series.count}`,
      );
      lines.push(
        `gym_sheet_http_request_duration_seconds_sum{${labels}} ${series.durationSecondsSum.toFixed(6)}`,
      );
      lines.push(`gym_sheet_http_request_duration_seconds_count{${labels}} ${series.count}`);
    }

    return `${lines.join('\n')}\n`;
  }

  private formatLabels(series: HttpMetricSeries): string {
    return [
      `method="${this.escapeLabel(series.method)}"`,
      `route="${this.escapeLabel(series.route)}"`,
      `status="${series.statusCode}"`,
    ].join(',');
  }

  private escapeLabel(value: string): string {
    return value.replace(/\\/g, '\\\\').replace(/\n/g, '\\n').replace(/"/g, '\\"');
  }

  private readPoolSnapshot(): PoolSnapshot {
    const connectionManager = this.sequelize.connectionManager as unknown as {
      pool?: Partial<PoolSnapshot>;
    };
    const pool = connectionManager.pool;

    return {
      size: Number(pool?.size ?? 0),
      available: Number(pool?.available ?? 0),
      using: Number(pool?.using ?? 0),
      waiting: Number(pool?.waiting ?? 0),
    };
  }
}
