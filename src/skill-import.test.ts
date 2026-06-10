import { describe, it, expect, vi, afterEach } from 'vitest';

// skill-import.ts only imports fs/path, paths.js (no db), and logger.js —
// no better-sqlite3 in the chain, so no db mock needed.
import { fetchSkill } from './skill-import.js';

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('fetchSkill URL guard (no network)', () => {
  it('rejects plain http URLs', async () => {
    const result = await fetchSkill('http://example.com/x.md');
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/https/);
  });

  const privateUrls = [
    'https://localhost/skill.md',
    'https://127.0.0.1/x',
    'https://192.168.1.5/x',
    'https://10.0.0.1/x',
    'https://internal/x', // hostname without a dot
  ];

  for (const url of privateUrls) {
    it(`rejects private/internal host: ${url}`, async () => {
      const result = await fetchSkill(url);
      expect(result.ok).toBe(false);
      expect(result.error).toMatch(/private|internal/i);
    });
  }

  it('never touches the network for rejected URLs', async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);
    await fetchSkill('http://example.com/x.md');
    await fetchSkill('https://localhost/skill.md');
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('accepts a valid https public URL and parses frontmatter', async () => {
    const markdown = '---\nname: test-skill\n---\nbody';
    const fetchSpy = vi.fn(async () => ({
      ok: true,
      status: 200,
      statusText: 'OK',
      text: async () => markdown,
    }));
    vi.stubGlobal('fetch', fetchSpy);

    const result = await fetchSkill('https://example.com/skill.md');
    expect(fetchSpy).toHaveBeenCalledOnce();
    expect(result.ok).toBe(true);
    expect(result.name).toBe('test-skill');
    expect(result.skillPath).toContain('test-skill');
    expect(result.redactedBlocks).toBe(0);
    // Frontmatter is annotated with the source URL
    expect(result.rawContent).toContain('source: https://example.com/skill.md');
    expect(result.rawContent).toContain('body');
  });
});
