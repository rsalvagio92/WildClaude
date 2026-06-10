import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';

import { _initTestDatabase, getDb } from './db.js';
import { exportTrajectories, scrubContent } from './trajectory-export.js';

function insertTurn(chatId: string, content: string, createdAtSec: number): void {
  getDb().prepare(
    `INSERT INTO conversation_log (chat_id, session_id, role, content, created_at, agent_id)
     VALUES (?, ?, ?, ?, ?, ?)`,
  ).run(chatId, 'sess-1', 'user', content, createdAtSec, 'main');
}

describe('trajectory-export', () => {
  let outDir: string;

  beforeEach(() => {
    _initTestDatabase();
    outDir = fs.mkdtempSync(path.join(os.tmpdir(), 'traj-export-'));
  });

  afterEach(() => {
    fs.rmSync(outDir, { recursive: true, force: true });
  });

  function readLines(file: string): Array<Record<string, unknown>> {
    return fs
      .readFileSync(file, 'utf8')
      .split('\n')
      .filter(Boolean)
      .map((l) => JSON.parse(l));
  }

  it('since/until filters (ms epoch) match seconds-stored rows', async () => {
    // conversation_log.created_at is stored in SECONDS.
    const jan1Sec = Math.floor(new Date('2026-01-01T00:00:00Z').getTime() / 1000);
    const jun1Sec = Math.floor(new Date('2026-06-01T00:00:00Z').getTime() / 1000);
    insertTurn('chat1', 'hello from january', jan1Sec);
    insertTurn('chat1', 'hello from june', jun1Sec);

    // --since passed as ms epoch (the public contract / how the CLI builds it).
    const sinceMs = new Date('2026-03-01T00:00:00Z').getTime();
    const out = path.join(outDir, 'since.jsonl');
    const r = await exportTrajectories({ since: sinceMs, outputPath: out });

    expect(r.rowsExported).toBe(1);
    const lines = readLines(out);
    expect(lines).toHaveLength(1);
    expect(lines[0].content).toContain('june');
  });

  it('exports all rows when no filter is given', async () => {
    insertTurn('chat1', 'one', 1_700_000_000);
    insertTurn('chat1', 'two', 1_700_000_100);
    const out = path.join(outDir, 'all.jsonl');
    const r = await exportTrajectories({ outputPath: out });
    expect(r.rowsExported).toBe(2);
  });

  it('scrubs PII by default', () => {
    const { content, redactions } = scrubContent('reach me at jane@example.com');
    expect(content).toContain('[EMAIL]');
    expect(redactions).toBe(1);
  });
});
