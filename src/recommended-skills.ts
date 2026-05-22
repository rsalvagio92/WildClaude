/**
 * Recommended skills — curated list of third-party skills worth installing.
 *
 * Surfaces in the dashboard Marketplace as a "Curated" tab so users see useful
 * picks even when the agentskills.io search returns nothing relevant.
 *
 * Each entry must point at a fetchable SKILL.md OR be installable via our
 * /skill_install flow (which already handles agentskills.io IDs and any URL).
 */

export interface RecommendedSkill {
  /** Slug used in /skill_install. */
  id: string;
  name: string;
  description: string;
  /** Direct repo or homepage URL (shown in UI). */
  url: string;
  /** Install command shown to the user. */
  install: string;
  /** Why this skill is recommended for WildClaude users. */
  why: string;
  /** Free-form tags for filtering. */
  tags: string[];
}

export const RECOMMENDED_SKILLS: RecommendedSkill[] = [
  {
    id: 'book-to-skill',
    name: 'book-to-skill',
    description: 'Turn any technical book PDF/EPUB/DOCX into a Claude Code skill with on-demand chapter loading.',
    url: 'https://github.com/virgiliojr94/book-to-skill',
    install: '/skill_install https://raw.githubusercontent.com/virgiliojr94/book-to-skill/master/SKILL.md',
    why: 'A 400-page book is ~200K tokens. With this skill only the chapter you need loads, the rest stays on disk. Perfect companion to the WildClaude memory_blocks system — your reference material stays out of context until called.',
    tags: ['learning', 'reference', 'token-efficient'],
  },
  {
    id: 'graphify',
    name: 'graphify',
    description: 'Turn a folder of code/docs/papers/images into a queryable knowledge graph.',
    url: 'https://github.com/safishamsi/graphify',
    install: '/skill_install https://raw.githubusercontent.com/safishamsi/graphify/main/SKILL.md',
    why: 'Best used pointed at the WildClaude codebase itself, so the bot can answer "how does my own router.ts work" without re-grepping every time. Code analysis is local (tree-sitter); non-code files use one LLM pass each.',
    tags: ['codebase', 'self-referential', 'knowledge-graph'],
  },
  {
    id: 'skill-seekers',
    name: 'Skill_Seekers',
    description: 'Convert docs sites, GitHub repos, PDFs, videos, Jupyter notebooks, EPUBs into Claude skills with auto conflict detection.',
    url: 'https://github.com/yusufkaraaslan/Skill_Seekers',
    install: '/skill_install https://raw.githubusercontent.com/yusufkaraaslan/Skill_Seekers/main/SKILL.md',
    why: '18 source types — broader scope than book-to-skill. Use when you need to skill-ify something that isn\'t a clean book PDF (e.g. a docs site or a YouTube playlist).',
    tags: ['skill-generation', 'learning'],
  },
  {
    id: 'awesome-agent-skills',
    name: 'Awesome Agent Skills (catalog)',
    description: 'Curated catalog of 1000+ agent skills from Anthropic, Google Labs, Vercel, Stripe, Cloudflare and community.',
    url: 'https://github.com/VoltAgent/awesome-agent-skills',
    install: 'Browse and pick from the catalog, then /skill_install <name>',
    why: 'Not a single skill but a curated index. Bookmark it as your starting point when looking for new capabilities.',
    tags: ['catalog', 'index'],
  },
  {
    id: 'claude-skills-313',
    name: 'claude-skills (313+)',
    description: '313+ production-ready Claude Code skills covering engineering, marketing, compliance, finance, and more.',
    url: 'https://github.com/alirezarezvani/claude-skills',
    install: 'Browse the repo and /skill_install <skill-name>',
    why: 'High-volume curated collection. Good for filling in domain-specific gaps that the WildClaude default 17 agents don\'t cover.',
    tags: ['catalog', 'professional'],
  },
];

// ── Telegram surface ─────────────────────────────────────────────────

export function registerRecommendedSkillsCommand(
  bot: import('grammy').Bot,
  isAuthorised: (chatId: number) => boolean,
): void {
  bot.command('recommended', async (ctx) => {
    if (!isAuthorised(ctx.chat!.id)) return;
    const tag = (ctx.match ?? '').trim().toLowerCase();
    const filtered = tag
      ? RECOMMENDED_SKILLS.filter((s) => s.tags.some((t) => t.toLowerCase().includes(tag)) || s.name.toLowerCase().includes(tag))
      : RECOMMENDED_SKILLS;
    if (filtered.length === 0) {
      await ctx.reply(`No recommended skills matching "${tag}". Try /recommended (no filter) to see all.`);
      return;
    }
    const lines = ['<b>Recommended skills</b> (curated)', ''];
    for (const s of filtered) {
      lines.push(`<b>${escapeHtml(s.name)}</b>`);
      lines.push(escapeHtml(s.description));
      lines.push(`<i>Why:</i> ${escapeHtml(s.why)}`);
      lines.push(`<code>${escapeHtml(s.install)}</code>`);
      lines.push(`<a href="${s.url}">${escapeHtml(s.url)}</a>`);
      lines.push('');
    }
    await ctx.reply(lines.join('\n'), { parse_mode: 'HTML', link_preview_options: { is_disabled: true } });
  });
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
