import { describe, it, expect, beforeEach } from 'vitest';

import { _initTestDatabase } from './db.js';
import { upsertArticle, recallForText, listArticles, approveArticle, getArticleByTopic } from './wiki.js';

describe('wiki', () => {
  beforeEach(() => { _initTestDatabase(); });

  it('publishes and lists articles', () => {
    upsertArticle({ topic: 'WildClaude', body: 'A personal AI OS that runs on a Pi.' });
    const arts = listArticles();
    expect(arts.map((a) => a.topic)).toContain('WildClaude');
    expect(arts[0].draft).toBe(false);
  });

  it('recallForText injects a published article when its topic is mentioned', () => {
    upsertArticle({ topic: 'WildClaude', body: 'Runs on a Raspberry Pi.' });
    const hit = recallForText('how is the WildClaude project going?');
    expect(hit).toContain('WildClaude');
    expect(hit).toContain('Raspberry Pi');
  });

  it('does not recall when the topic is absent', () => {
    upsertArticle({ topic: 'WildClaude', body: 'x' });
    expect(recallForText('what is the weather today')).toBe('');
  });

  it('matches on word boundary, not substring', () => {
    upsertArticle({ topic: 'Wild', body: 'the wild article' });
    expect(recallForText('a Wild idea')).toContain('Wild');     // whole word
    expect(recallForText('the wilderness trail')).toBe('');      // substring must NOT match
  });

  it('ignores topics shorter than 4 chars (noise guard)', () => {
    upsertArticle({ topic: 'API', body: 'too short to recall' });
    expect(recallForText('tell me about the API')).toBe('');
  });

  it('drafts are not recalled until approved', () => {
    const a = upsertArticle({ topic: 'Hermes Stack', body: 'advanced layer', draft: true });
    expect(recallForText('the Hermes Stack layer')).toBe('');
    expect(approveArticle(a.id)).toBe(true);
    expect(recallForText('the Hermes Stack layer')).toContain('Hermes Stack');
    expect(getArticleByTopic('Hermes Stack')?.draft).toBe(false);
  });
});
