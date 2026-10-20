// Guards migrations/*.sql: the production database is shared with the old
// Instant Site service, so every migration must be additive (CLAUDE.md
// ground rule 1). Comments are stripped before matching.

import fs from 'fs';
import path from 'path';

const dir = path.join(__dirname, '..', 'migrations');
const files = fs.readdirSync(dir).filter((f) => f.endsWith('.sql')).sort();

function sqlOf(file: string): string {
  return fs
    .readFileSync(path.join(dir, file), 'utf8')
    .replace(/--.*$/gm, '')
    .replace(/\/\*[\s\S]*?\*\//g, '');
}

const FORBIDDEN: Array<[string, RegExp]> = [
  ['DROP', /\bDROP\s+(TABLE|COLUMN|INDEX|CONSTRAINT|SCHEMA|TYPE|VIEW)\b/i],
  ['RENAME', /\bRENAME\b/i],
  ['type change', /\bALTER\s+COLUMN\s+\S+\s+(SET\s+DATA\s+)?TYPE\b/i],
  ['SET NOT NULL', /\bSET\s+NOT\s+NULL\b/i],
  ['TRUNCATE', /\bTRUNCATE\b/i],
  ['DELETE', /\bDELETE\s+FROM\b/i],
];

test('there is at least one migration', () => {
  expect(files.length).toBeGreaterThan(0);
});

test('filenames are numbered and ordered', () => {
  for (const f of files) expect(f).toMatch(/^\d{4}_[a-z0-9_]+\.sql$/);
});

describe.each(files)('%s', (file) => {
  const sql = sqlOf(file);

  test.each(FORBIDDEN)('contains no %s', (_label, pattern) => {
    expect(sql).not.toMatch(pattern);
  });

  test('runs in a transaction', () => {
    expect(sql).toMatch(/^\s*BEGIN;/);
    expect(sql).toMatch(/COMMIT;\s*$/);
  });

  test('ADD COLUMN ... NOT NULL always carries a DEFAULT', () => {
    for (const m of sql.matchAll(/ADD\s+COLUMN[^;]*?\bNOT\s+NULL\b[^;]*;/gi)) {
      expect(m[0]).toMatch(/\bDEFAULT\b/i);
    }
  });

  test('is idempotent (IF NOT EXISTS on every ADD COLUMN / CREATE INDEX)', () => {
    expect(sql).not.toMatch(/ADD\s+COLUMN\s+(?!IF\s+NOT\s+EXISTS)/i);
    expect(sql).not.toMatch(/CREATE\s+(UNIQUE\s+)?INDEX\s+(?!IF\s+NOT\s+EXISTS)/i);
  });
});
