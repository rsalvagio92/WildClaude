#!/usr/bin/env node
/**
 * CLI entry point for the WildClaude ACP stdio server.
 *
 * Invocation:
 *   node dist/acp/index.js
 *
 * Then point an ACP-aware IDE (Zed, Cursor, etc.) at this command. The IDE
 * spawns it as a subprocess and talks JSON-RPC over stdin/stdout.
 *
 * No flags yet — keep it simple. If we ever need them, parse from argv here
 * and pass into runStdioServer.
 */

import { runStdioServer } from './server.js';

runStdioServer();
