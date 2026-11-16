// Prints the SHA-256 (lowercase hex) of a legal text file, exactly as published,
// for LEGAL_DOCUMENT_CONTENT_SHA256 in src/modules/legal/legal-documents.ts.
//   yarn legal:hash docs/legal/terminos-2026-12-01.md
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';

const file = process.argv[2];
if (!file) {
  process.stderr.write('Uso: yarn legal:hash <archivo>\n');
  process.exit(2);
}
process.stdout.write(`${createHash('sha256').update(readFileSync(file)).digest('hex')}\n`);
