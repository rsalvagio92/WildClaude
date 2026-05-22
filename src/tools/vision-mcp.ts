#!/usr/bin/env node
/**
 * Vision MCP tool — Claude vision wrapper.
 *
 * Tools exposed:
 *   describe(path)        → multimodal description of the image
 *   extract_text(path)    → OCR-like extraction
 *   answer(path, question) → answer a question about the image
 *
 * Uses the Anthropic SDK directly (the Claude CLI doesn't expose images
 * easily). Requires ANTHROPIC_API_KEY in env or secrets. Falls back with a
 * clear error message if unavailable.
 */

import fs from 'fs';
import path from 'path';

import Anthropic from '@anthropic-ai/sdk';

import { serveStdio } from './mcp-stdio.js';
import { readEnvFile } from '../env.js';
import { juice } from '../token-juice.js';

function loadClient(): Anthropic | null {
  const secrets = readEnvFile(['ANTHROPIC_API_KEY']);
  const key = process.env.ANTHROPIC_API_KEY || secrets.ANTHROPIC_API_KEY;
  if (!key) return null;
  return new Anthropic({ apiKey: key });
}

function loadImage(p: string): { data: string; mediaType: 'image/png' | 'image/jpeg' | 'image/webp' | 'image/gif' } {
  if (!fs.existsSync(p)) throw new Error(`File not found: ${p}`);
  const buf = fs.readFileSync(p);
  const ext = path.extname(p).toLowerCase();
  const mediaType =
    ext === '.png' ? 'image/png' :
    ext === '.jpg' || ext === '.jpeg' ? 'image/jpeg' :
    ext === '.webp' ? 'image/webp' :
    ext === '.gif' ? 'image/gif' :
    'image/png';
  return { data: buf.toString('base64'), mediaType };
}

async function ask(imagePath: string, prompt: string): Promise<string> {
  const client = loadClient();
  if (!client) {
    return 'Vision tool unavailable: ANTHROPIC_API_KEY is not configured. Set it via /set_secret ANTHROPIC_API_KEY.';
  }
  const img = loadImage(imagePath);
  const resp = await client.messages.create({
    model: 'claude-haiku-4-5',
    max_tokens: 1024,
    messages: [
      {
        role: 'user',
        content: [
          { type: 'image', source: { type: 'base64', media_type: img.mediaType, data: img.data } },
          { type: 'text', text: prompt },
        ],
      },
    ],
  });
  const text = resp.content
    .filter((b): b is Anthropic.TextBlock => b.type === 'text')
    .map((b) => b.text)
    .join('\n')
    .trim();
  return text || '(empty response)';
}

serveStdio({
  name: 'wildclaude-vision',
  version: '0.1.0',
  tools: [
    {
      name: 'describe',
      description: 'Describe the contents of an image file. Returns a multimodal description.',
      inputSchema: { type: 'object', properties: { path: { type: 'string' } }, required: ['path'] },
      handler: async (args) => ({ text: await ask(String(args.path), 'Describe the contents of this image in 2-4 sentences.') }),
    },
    {
      name: 'extract_text',
      description: 'Extract any text visible in the image (OCR-like). Returns extracted text or "(no text)".',
      inputSchema: { type: 'object', properties: { path: { type: 'string' } }, required: ['path'] },
      handler: async (args) => {
        const raw = await ask(String(args.path), 'Extract all readable text from this image, preserving line breaks. If there is no text, reply exactly "(no text)".');
        // Vision OCR often returns repeated headers / page chrome. Run dedup + normalize.
        const r = juice(raw, { html: false, tag: 'vision-extract_text', maxChars: 8_000 });
        return { text: r.text };
      },
    },
    {
      name: 'answer',
      description: 'Answer a specific question about the image.',
      inputSchema: {
        type: 'object',
        properties: { path: { type: 'string' }, question: { type: 'string' } },
        required: ['path', 'question'],
      },
      handler: async (args) => ({ text: await ask(String(args.path), String(args.question ?? 'What can you tell me about this image?')) }),
    },
  ],
});
