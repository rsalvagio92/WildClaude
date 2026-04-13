/**
 * Onboarding module for WildClaude.
 *
 * On first interaction (or when kernel files have [FILL IN] placeholders),
 * the bot proactively asks the user questions to build their profile.
 * No manual file editing required.
 */

import fs from 'fs';
import os from 'os';
import path from 'path';
import { Bot, Context } from 'grammy';

import { ALLOWED_CHAT_ID, DASHBOARD_PORT } from './config.js';
import { logger } from './logger.js';
import { updateUserConfig } from './overlay.js';
import { lifePath } from './paths.js';

interface OnboardingState {
  phase: 'language' | 'identity' | 'work-style' | 'goals' | 'complete';
  lang: 'en' | 'it' | 'es';
  answers: Record<string, string>;
}

/** Get the machine's local network IP (first non-internal IPv4). */
function getLocalIp(): string {
  const nets = os.networkInterfaces();
  for (const addrs of Object.values(nets)) {
    for (const addr of addrs || []) {
      if (!addr.internal && addr.family === 'IPv4') {
        return addr.address;
      }
    }
  }
  return 'localhost';
}

const TG_STRINGS: Record<string, Record<string, string>> = {
  en: {
    welcome: "Great! Let's set up your profile (~1 min).\n\n1. What's your name and where are you based?",
    q2: '2. Languages you speak? (e.g. "English, Italian")',
    q3: '3. How do you work best? Peak hours, challenges?',
    q4: '4. Top 2-3 goals right now?',
    q5: '5. Current projects or focus areas?',
    q6: '6. Give me a name! (default: "WildClaude", or pick your own, e.g. "Jarvis", "Wildy")',
    q7: '7. What personality should I have?\n1. Direct (no fluff)\n2. Friendly (warm, casual)\n3. Professional (formal)\n4. Coach (supportive, pushes you)\nReply 1-4 or describe your own.',
    done: '✅ Profile saved!\n\n' +
      '🐺 I\'m WildClaude, your personal AI operating system.\n\n' +
      'Here\'s what I can do:\n' +
      '• Answer questions, write code, research, analyze\n' +
      '• Manage your goals, habits, and daily routines\n' +
      '• Run autonomous dev tasks (/ralph)\n' +
      '• Connect to 30+ services (Notion, GitHub, Vercel...)\n' +
      '• Remember everything across sessions\n\n' +
      '📱 Examples:\n' +
      '• "plan my week" — get organized\n' +
      '• "@coder build a landing page" — delegate to a dev agent\n' +
      '• "@finance log 50 euro lunch" — track expenses\n' +
      '• /morning — daily briefing\n' +
      '• /personality — change how I communicate\n\n' +
      '🔌 Want to connect services (Notion, GitHub, Slack...)?\n' +
      'Just ask me "install Notion" or use /mcp from the dashboard.\n\n' +
      '🌐 Dashboard: http://{IP}:{PORT}\n' +
      'Access from anywhere with Tailscale: https://tailscale.com\n\n' +
      '/help for all 35+ commands',
  },
  it: {
    welcome: "Perfetto! Configuriamo il tuo profilo (~1 min).\n\n1. Come ti chiami e dove ti trovi?",
    q2: '2. Lingue parlate? (es. "Italiano nativo, Inglese fluente")',
    q3: '3. Come lavori meglio? Orari, sfide?',
    q4: '4. I tuoi 2-3 obiettivi principali?',
    q5: '5. Progetti o aree di focus attuali?',
    q6: '6. Dammi un nome! (default: "WildClaude", o scegline uno, es. "Jarvis", "Wildy")',
    q7: '7. Che personalità devo avere?\n1. Diretto (niente fronzoli)\n2. Amichevole (caldo, casual)\n3. Professionale (formale)\n4. Coach (supportivo, ti sprona)\nRispondi 1-4 o descrivi la tua.',
    done: '✅ Profilo salvato!\n\n' +
      '🐺 Sono WildClaude, il tuo sistema operativo AI personale.\n\n' +
      'Cosa posso fare:\n' +
      '• Rispondere, scrivere codice, ricercare, analizzare\n' +
      '• Gestire obiettivi, abitudini e routine quotidiane\n' +
      '• Eseguire task di sviluppo autonomi (/ralph)\n' +
      '• Collegarmi a 30+ servizi (Notion, GitHub, Vercel...)\n' +
      '• Ricordare tutto tra le sessioni\n\n' +
      '📱 Esempi:\n' +
      '• "pianifica la mia settimana" — organizzati\n' +
      '• "@coder crea una landing page" — delega a un agente dev\n' +
      '• "@finance registra 50 euro pranzo" — traccia le spese\n' +
      '• /morning — briefing mattutino\n' +
      '• /personality — cambia come comunico\n\n' +
      '🔌 Vuoi collegare servizi (Notion, GitHub, Slack...)?\n' +
      'Chiedimelo o usa /mcp dalla dashboard.\n\n' +
      '🌐 Dashboard: http://{IP}:{PORT}\n' +
      'Accedi da ovunque con Tailscale: https://tailscale.com\n\n' +
      '/help per tutti i 35+ comandi',
  },
  es: {
    welcome: "¡Perfecto! Configuremos tu perfil (~1 min).\n\n1. ¿Cómo te llamas y dónde estás?",
    q2: '2. ¿Idiomas que hablas? (ej. "Español nativo, Inglés fluido")',
    q3: '3. ¿Cómo trabajas mejor? Horarios, desafíos?',
    q4: '4. ¿Tus 2-3 objetivos principales?',
    q5: '5. ¿Proyectos o áreas de enfoque actuales?',
    q6: '6. ¡Ponme un nombre! (default: "WildClaude", o elige uno, ej. "Jarvis", "Wildy")',
    q7: '7. ¿Qué personalidad debo tener?\n1. Directo (sin rodeos)\n2. Amigable (cálido, casual)\n3. Profesional (formal)\n4. Coach (motivador, te empuja)\nResponde 1-4 o describe la tuya.',
    done: '✅ ¡Perfil guardado!\n\n' +
      '🐺 Soy WildClaude, tu sistema operativo AI personal.\n\n' +
      'Lo que puedo hacer:\n' +
      '• Responder, escribir código, investigar, analizar\n' +
      '• Gestionar objetivos, hábitos y rutinas diarias\n' +
      '• Ejecutar tareas de desarrollo autónomas (/ralph)\n' +
      '• Conectar con 30+ servicios (Notion, GitHub, Vercel...)\n' +
      '• Recordar todo entre sesiones\n\n' +
      '📱 Ejemplos:\n' +
      '• "planifica mi semana" — organízate\n' +
      '• "@coder crea una landing page" — delega a un agente dev\n' +
      '• "@finance registra 50 euros almuerzo" — rastrea gastos\n' +
      '• /morning — resumen matutino\n' +
      '• /personality — cambiar cómo me comunico\n\n' +
      '🔌 ¿Quieres conectar servicios (Notion, GitHub, Slack...)?\n' +
      'Pídemelo o usa /mcp desde el dashboard.\n\n' +
      '🌐 Dashboard: http://{IP}:{PORT}\n' +
      'Accede desde cualquier lugar con Tailscale: https://tailscale.com\n\n' +
      '/help para todos los 35+ comandos',
  },
};

const onboardingState = new Map<string, OnboardingState>();

/**
 * Check if onboarding is needed (kernel files have [FILL IN] placeholders).
 */
export function needsOnboarding(): boolean {
  const keyFile = lifePath( 'me', '_kernel', 'key.md');
  try {
    if (!fs.existsSync(keyFile)) return true;
    const content = fs.readFileSync(keyFile, 'utf-8');
    return content.includes('[FILL IN]');
  } catch {
    return true;
  }
}

/**
 * Get the onboarding greeting message — starts with language selection.
 */
function getOnboardingGreeting(): string {
  return (
    'Welcome to WildClaude! / Benvenuto! / ¡Bienvenido!\n\n' +
    'Select your language:\n' +
    '1. English\n' +
    '2. Italiano\n' +
    '3. Español\n\n' +
    'Reply with 1, 2 or 3'
  );
}

// 7 questions: name_location, languages, work_style, top_goals, current_projects, bot_name, bot_personality
const QUESTION_KEYS = ['name_location', 'languages', 'work_style', 'top_goals', 'current_projects', 'bot_name', 'bot_personality'];
const QUESTION_MAP: Record<string, string[]> = {
  en: ['welcome', 'q2', 'q3', 'q4', 'q5', 'q6', 'q7'],
  it: ['welcome', 'q2', 'q3', 'q4', 'q5', 'q6', 'q7'],
  es: ['welcome', 'q2', 'q3', 'q4', 'q5', 'q6', 'q7'],
};

/**
 * Process an onboarding answer and return the next question or completion message.
 */
export function processOnboardingAnswer(chatId: string, answer: string): string | null {
  let state = onboardingState.get(chatId);
  if (!state) {
    state = { phase: 'language', lang: 'en', answers: {} };
    onboardingState.set(chatId, state);
  }

  // Language selection phase
  if (state.phase === 'language') {
    if (answer === '2') state.lang = 'it';
    else if (answer === '3') state.lang = 'es';
    else state.lang = 'en';
    state.phase = 'identity';
    return TG_STRINGS[state.lang]!.welcome;
  }

  const t = TG_STRINGS[state.lang]!;
  const questionIdx = Object.keys(state.answers).length;

  // Save the answer
  if (questionIdx < QUESTION_KEYS.length) {
    state.answers[QUESTION_KEYS[questionIdx]!] = answer;
  }

  // Next question
  const nextIdx = questionIdx + 1;
  if (nextIdx < QUESTION_KEYS.length) {
    const qKey = QUESTION_MAP[state.lang]![nextIdx]!;
    return t[qKey]!;
  }

  // All done — write kernel files
  writeKernelFiles(state.answers);
  const botName = state.answers['bot_name']?.trim() || 'WildClaude';
  onboardingState.delete(chatId);

  // Replace hardcoded "WildClaude" with the chosen bot name
  // Replace {IP} and {PORT} with actual values
  const ip = getLocalIp();
  const port = String(DASHBOARD_PORT || 3141);
  return t.done
    .replace(/WildClaude/g, botName)
    .replace(/\{IP\}/g, ip)
    .replace(/\{PORT\}/g, port);
}

/**
 * Check if a chat is currently in onboarding.
 */
export function isOnboarding(chatId: string): boolean {
  return onboardingState.has(chatId);
}

/**
 * Start onboarding for a chat.
 */
export function startOnboarding(chatId: string): string {
  onboardingState.set(chatId, { phase: 'language', lang: 'en', answers: {} });
  return getOnboardingGreeting();
}

/**
 * Write user answers to the appropriate kernel files.
 */
function writeKernelFiles(answers: Record<string, string>): void {
  // Parse name and location
  const nameLoc = answers['name_location'] || '';
  const parts = nameLoc.split(',').map(s => s.trim());
  const name = parts[0] || 'User';
  const location = parts.slice(1).join(', ') || '';

  // Write me/key.md
  const meKernel = `# me -- identity kernel

## Who I Am
- Name: ${name}
- Location: ${location}
- Languages: ${answers['languages'] || ''}

## How I Work Best
${answers['work_style'] || ''}

## Current Projects
${answers['current_projects'] || ''}

## Notes for Agents
Respond in the same language the user writes in. Keep things concise and actionable.
`;

  const meDir = lifePath( 'me', '_kernel');
  fs.mkdirSync(meDir, { recursive: true });
  fs.writeFileSync(path.join(meDir, 'key.md'), meKernel);

  // Write goals/key.md
  const goals = answers['top_goals'] || '';
  const goalLines = goals.split(/[,;\n]/).map(g => g.trim()).filter(Boolean);

  const goalsKernel = `# goals -- active goals

${goalLines.map((g, i) => `## Goal ${i + 1}: ${g}
- Status: In Progress
- Next Action: Define first milestone
- Target Date: TBD
`).join('\n')}
`;

  const goalsDir = lifePath( 'goals', '_kernel');
  fs.mkdirSync(goalsDir, { recursive: true });
  fs.writeFileSync(path.join(goalsDir, 'key.md'), goalsKernel);

  // Create empty log.md if it doesn't exist
  const logPath = lifePath( 'me', '_kernel', 'log.md');
  if (!fs.existsSync(logPath)) {
    fs.writeFileSync(logPath, `# Life Log\n\n`);
  }

  // Write bot identity and personality to config.json via overlay
  const botName = answers['bot_name']?.trim() || 'WildClaude';
  const personalityChoice = answers['bot_personality']?.trim() || '1';

  const PERSONALITY_MAP: Record<string, string> = {
    '1': 'default',
    '2': 'casual',
    '3': 'professional',
    '4': 'coach',
  };
  // Accept both number ("2") and preset name ("casual")
  const presetId = PERSONALITY_MAP[personalityChoice] || personalityChoice.toLowerCase();
  const validPresets = ['default', 'professional', 'casual', 'coach', 'debug', 'creative'];
  const preset = validPresets.includes(presetId) ? presetId : 'default';

  updateUserConfig({
    botIdentity: {
      name: botName,
      emoji: '🐺',
      tagline: 'Personal AI Operating System',
    },
    personality: {
      preset,
    },
  });

  logger.info({ name, botName, preset, goalCount: goalLines.length }, 'Onboarding complete, kernel files written');
}

/**
 * Register onboarding middleware on the bot.
 * Intercepts messages when onboarding is active.
 */
export function registerOnboarding(bot: Bot<Context>): void {
  // Middleware: if this chat is in onboarding, intercept the message
  bot.on('message:text', async (ctx, next) => {
    const chatId = String(ctx.chat.id);

    // Only for the authorized user
    if (ALLOWED_CHAT_ID && chatId !== ALLOWED_CHAT_ID) {
      return next();
    }

    // If in onboarding flow, process the answer
    if (isOnboarding(chatId)) {
      const text = ctx.message.text?.trim();
      if (!text) return next();

      // Skip if it's a command
      if (text.startsWith('/')) {
        onboardingState.delete(chatId);
        return next();
      }

      const response = processOnboardingAnswer(chatId, text);
      if (response) {
        await ctx.reply(response);
      }
      return; // Don't pass to next handlers
    }

    return next();
  });
}
