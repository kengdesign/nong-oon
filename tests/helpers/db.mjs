import { DatabaseSync } from 'node:sqlite';
import { readFileSync, readdirSync } from 'node:fs';

/** Real SQLite with a small D1-shaped adapter. No network or Cloudflare mocks. */
export function createTestDb({ migrations } = {}) {
  const sql = new DatabaseSync(':memory:');
  sql.exec('PRAGMA foreign_keys=ON');
  const directory = new URL('../../migrations/', import.meta.url);
  const files = migrations ?? readdirSync(directory).filter(file => file.endsWith('.sql')).sort();
  for (const file of files) sql.exec(readFileSync(new URL(file, directory), 'utf8'));
  const execute = (query, values, mode) => {
    const statement = sql.prepare(query);
    const returning = statement.columns().length > 0;
    if (mode === 'first') return statement.get(...values) ?? null;
    if (returning) {
      const results = statement.all(...values);
      return { success: true, results, meta: { changes: sql.prepare('SELECT changes() AS n').get().n } };
    }
    const result = statement.run(...values);
    return { success: true, results: [], meta: { changes: Number(result.changes), last_row_id: Number(result.lastInsertRowid) } };
  };
  const prepare = query => {
    const bound = values => ({ query, values,
      async run() { return execute(query, values, 'run'); },
      async all() { return execute(query, values, 'all'); },
      async first(column) { const row = execute(query, values, 'first'); return column ? row?.[column] ?? null : row; },
    });
    return { ...bound([]), bind: (...values) => bound(values) };
  };
  const db = { prepare, async batch(statements) {
    sql.exec('BEGIN IMMEDIATE');
    try {
      const results = statements.map(({ query, values }) => execute(query, values, 'all'));
      sql.exec('COMMIT'); return results;
    } catch (error) { sql.exec('ROLLBACK'); throw error; }
  } };
  return { sql, db, close() { sql.close(); } };
}
