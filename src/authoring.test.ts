import { describe, it, expect } from 'vitest';

import { validateWorkflowContent } from './workflows.js';
import { validateEvalContent } from './evals.js';
import { normalizeProject } from './projects.js';

describe('workflow validation', () => {
  it('accepts a valid DAG', () => {
    const v = validateWorkflowContent('name: w\nsteps:\n  - id: a\n    prompt: do a\n  - id: b\n    prompt: use {{a.output}}\n    depends_on: [a]\n');
    expect(v.ok).toBe(true);
    expect(v.def?.steps.length).toBe(2);
  });
  it('rejects missing steps', () => {
    expect(validateWorkflowContent('name: w\n').ok).toBe(false);
  });
  it('rejects an unknown dependency', () => {
    const v = validateWorkflowContent('name: w\nsteps:\n  - id: a\n    prompt: p\n    depends_on: [ghost]\n');
    expect(v.ok).toBe(false);
    expect(v.error).toMatch(/unknown/i);
  });
  it('rejects a cycle', () => {
    const v = validateWorkflowContent('name: w\nsteps:\n  - id: a\n    prompt: p\n    depends_on: [b]\n  - id: b\n    prompt: p\n    depends_on: [a]\n');
    expect(v.ok).toBe(false);
    expect(v.error).toMatch(/cycle/i);
  });
  it('rejects duplicate step ids', () => {
    const v = validateWorkflowContent('name: w\nsteps:\n  - id: a\n    prompt: p\n  - id: a\n    prompt: q\n');
    expect(v.ok).toBe(false);
  });
});

describe('eval validation', () => {
  it('accepts a valid eval', () => {
    const v = validateEvalContent('name: e\ncases:\n  - prompt: hi\n    expect:\n      contains: ["hello"]\n');
    expect(v.ok).toBe(true);
    expect(v.def?.cases.length).toBe(1);
  });
  it('rejects empty cases', () => {
    expect(validateEvalContent('name: e\ncases: []\n').ok).toBe(false);
  });
  it('rejects a case without a prompt', () => {
    const v = validateEvalContent('name: e\ncases:\n  - expect:\n      contains: ["x"]\n');
    expect(v.ok).toBe(false);
  });
});

describe('normalizeProject', () => {
  it('uppercases + filters secret refs and defaults status to active', () => {
    const p = normalizeProject({ name: 'My App', secretRefs: ['stripe key', 'GITHUB_TOKEN', ''] });
    expect(p.status).toBe('active');
    expect(p.secretRefs).toContain('GITHUB_TOKEN');
    expect(p.secretRefs).toContain('STRIPEKEY'); // spaces stripped, uppercased
    expect(p.secretRefs).not.toContain('');
    expect(p.id).toMatch(/^my-app-/);
  });
  it('coerces invalid status and clamps array fields', () => {
    const p = normalizeProject({ name: 'P', status: 'bogus' as never, repos: [{ name: 'r' }], links: [{ label: 'L', url: 'https://x.com' }] });
    expect(p.status).toBe('active');
    expect(p.repos[0].name).toBe('r');
    expect(p.links[0].url).toBe('https://x.com');
  });
});
