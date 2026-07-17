import { readFile } from 'node:fs/promises';

const auditFilePath = process.argv[2];

if (!auditFilePath) {
  console.error('Usage: node scripts/verify-yarn-audit.mjs <yarn-audit-json-file>');
  process.exit(2);
}

const rawAuditOutput = await readFile(auditFilePath, 'utf8');
const auditEvents = rawAuditOutput
  .split(/\r?\n/)
  .filter(Boolean)
  .map((line, index) => {
    try {
      return JSON.parse(line);
    } catch (error) {
      throw new Error(
        `Invalid Yarn audit JSON at line ${index + 1}: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  });

const auditSummaryEvent = auditEvents.find((event) => event.type === 'auditSummary');

if (!auditSummaryEvent?.data?.vulnerabilities) {
  console.error('Yarn audit did not produce an auditSummary event.');
  process.exit(2);
}

const vulnerabilities = auditSummaryEvent.data.vulnerabilities;
const criticalVulnerabilities = Number(vulnerabilities.critical ?? 0);
const highVulnerabilities = Number(vulnerabilities.high ?? 0);

console.log(
  JSON.stringify(
    {
      productionDependencyAudit: vulnerabilities,
      totalDependencies: auditSummaryEvent.data.totalDependencies,
    },
    null,
    2,
  ),
);

if (criticalVulnerabilities > 0 || highVulnerabilities > 0) {
  console.error(
    `Production dependency audit failed: critical=${criticalVulnerabilities}, high=${highVulnerabilities}.`,
  );
  process.exit(1);
}
