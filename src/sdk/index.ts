/**
 * @wildclaude/sdk — public types for third-party skills, agents, and integrations.
 *
 * Re-exports the stable surface of WildClaude internals so plugin authors can
 * build against typed contracts. Anything *not* re-exported here is internal
 * and may change without notice.
 *
 * Usage (in a future plugin package):
 *   import type { Sandbox, MemoryBlock, WorkflowDefinition } from '@wildclaude/sdk';
 */

// Sandbox surface
export type { Sandbox, SandboxKind, SandboxOptions, ExecResult } from '../sandbox/index.js';

// Memory blocks
export type { Scope, MemoryBlock, KnowledgeView } from '../memory-blocks.js';

// Evals
export type { EvalCase, EvalDefinition, EvalCaseResult, EvalRun } from '../evals.js';

// Workflows
export type { WorkflowStep, WorkflowDefinition, WorkflowRun, WorkflowSinks } from '../workflows.js';

// Reflection
export type { Reflection } from '../reflection.js';

// Digest
export type { Digest, DigestMetrics } from '../digest.js';

// Debate
export type { DebateOptions, DebateMessage, DebateResult } from '../debate.js';

// Trace inspector
export type { TurnTrace, SessionTrace, CostBreakdown } from '../trace-inspector.js';

// Skill synthesis
export type { ToolUseRecord, ProposalEvent } from '../skill-synthesis.js';

// Tool building blocks
export type { McpTool, ServerInfo } from '../tools/mcp-stdio.js';
