/**
 * In-process Vision helper.
 *
 * Same backend as src/tools/vision-mcp.ts but callable directly from other
 * modules without spawning the MCP subprocess. Used by:
 *   - memory-blocks.attachToBlock (image caption)
 *   - bot.ts photo handler (auto-describe Telegram photos)
 */

import fs from 'fs';
import path from 'path';

import Anthropic from '@anthropic-ai/sdk';

import { readEnvFile } from '../env.js';

let client: Anthropic | null = null;

function getClient(): Anthropic | null {
  if (client) return client;
  const secrets = readEnvFile(['ANTHROPIC_API_KEY']);
  const key = process.env.ANTHROPIC_API_KEY || secrets.ANTHROPIC_API_KEY;
  if (!key) return null;
  client = new Anthropic({ apiKey: key });
  return client;
}

function mediaType(p: string): 'image/png' | 'image/jpeg' | 'image/webp' | 'image/gif' {
  const ext = path.extname(p).toLowerCase();
  return ext === '.png' ? 'image/png'
    : ext === '.jpg' || ext === '.jpeg' ? 'image/jpeg'
    : ext === '.webp' ? 'image/webp'
    : ext === '.gif' ? 'image/gif'
    : 'image/png';
}

async function ask(p: string, prompt: string): Promise<string | null> {
  const c = getClient();
  if (!c) return null;
  if (!fs.existsSync(p)) return null;
  const data = fs.readFileSync(p).toString('base64');
  const resp = await c.messages.create({
    model: 'claude-haiku-4-5',
    max_tokens: 512,
    messages: [
      {
        role: 'user',
        content: [
          { type: 'image', source: { type: 'base64', media_type: mediaType(p), data } },
          { type: 'text', text: prompt },
        ],
      },
    ],
  });
  const text = resp.content
    .filter((b): b is Anthropic.TextBlock => b.type === 'text')
    .map((b) => b.text).join('\n').trim();
  return text || null;
}

export async function runVisionDescribe(imagePath: string): Promise<string | null> {
  return ask(imagePath, 'Describe the contents of this image in 1-2 sentences for use as a searchable caption. Be concrete and factual.');
}

export async function runVisionExtractText(imagePath: string): Promise<string | null> {
  return ask(imagePath, 'Extract all readable text from this image, preserving line breaks. If there is no text, reply exactly "(no text)".');
}

export async function runVisionAnswer(imagePath: string, question: string): Promise<string | null> {
  return ask(imagePath, question);
}
