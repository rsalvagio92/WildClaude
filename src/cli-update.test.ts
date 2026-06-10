import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('child_process', () => ({
  execSync: vi.fn(),
}));

import { execSync } from 'child_process';
import { checkClaudeCliVersion, runCliUpdateCheck } from './cli-update.js';

const execSyncMock = vi.mocked(execSync);

/** Configure execSync responses per command. A value of Error makes it throw. */
function mockCommands(map: Record<string, string | Error>): void {
  execSyncMock.mockImplementation(((cmd: string) => {
    for (const [prefix, value] of Object.entries(map)) {
      if (cmd.startsWith(prefix)) {
        if (value instanceof Error) throw value;
        return value;
      }
    }
    throw new Error(`Unexpected command in test: ${cmd}`);
  }) as typeof execSync);
}

const savedAutoUpdate = process.env.CLAUDE_CLI_AUTO_UPDATE;

beforeEach(() => {
  execSyncMock.mockReset();
});

afterEach(() => {
  if (savedAutoUpdate === undefined) delete process.env.CLAUDE_CLI_AUTO_UPDATE;
  else process.env.CLAUDE_CLI_AUTO_UPDATE = savedAutoUpdate;
});

describe('checkClaudeCliVersion', () => {
  it('parses "2.1.170 (Claude Code)" to "2.1.170"', () => {
    mockCommands({
      'claude --version': '2.1.170 (Claude Code)',
      'npm view': '2.1.170',
    });
    const status = checkClaudeCliVersion();
    expect(status.installed).toBe('2.1.170');
    expect(status.latest).toBe('2.1.170');
  });

  it('updateAvailable is true when installed differs from latest', () => {
    mockCommands({
      'claude --version': '2.1.170 (Claude Code)',
      'npm view': '2.2.0',
    });
    const status = checkClaudeCliVersion();
    expect(status.installed).toBe('2.1.170');
    expect(status.latest).toBe('2.2.0');
    expect(status.updateAvailable).toBe(true);
  });

  it('updateAvailable is false when versions are equal', () => {
    mockCommands({
      'claude --version': '2.1.170 (Claude Code)',
      'npm view': '2.1.170',
    });
    expect(checkClaudeCliVersion().updateAvailable).toBe(false);
  });

  it('missing CLI (execSync throws) yields installed null and updateAvailable false', () => {
    mockCommands({
      'claude --version': new Error('command not found: claude'),
      'npm view': '2.2.0',
    });
    const status = checkClaudeCliVersion();
    expect(status.installed).toBeNull();
    expect(status.latest).toBe('2.2.0');
    expect(status.updateAvailable).toBe(false);
  });
});

describe('runCliUpdateCheck', () => {
  it('with CLAUDE_CLI_AUTO_UPDATE=false returns the check-only message when an update exists', () => {
    process.env.CLAUDE_CLI_AUTO_UPDATE = 'false';
    mockCommands({
      'claude --version': '2.1.170 (Claude Code)',
      'npm view': '2.2.0',
    });
    const msg = runCliUpdateCheck();
    expect(msg).toContain('2.1.170');
    expect(msg).toContain('2.2.0');
    expect(msg).toContain('auto-update disabled');
    // Check-only: no update command was attempted
    const cmds = execSyncMock.mock.calls.map((c) => String(c[0]));
    expect(cmds.some((c) => c.startsWith('claude update') || c.includes('npm install'))).toBe(false);
  });

  it('with CLAUDE_CLI_AUTO_UPDATE=false reports up-to-date when versions match', () => {
    process.env.CLAUDE_CLI_AUTO_UPDATE = 'false';
    mockCommands({
      'claude --version': '2.1.170 (Claude Code)',
      'npm view': '2.1.170',
    });
    expect(runCliUpdateCheck()).toBe('Claude CLI up to date (2.1.170)');
  });
});
