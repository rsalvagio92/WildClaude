/**
 * CLI onboarding — runs in terminal on first launch before the bot starts.
 *
 * Flow:
 * 1. Detect if onboarding is needed (no user profile)
 * 2. Check Claude CLI is installed and logged in
 * 3. Ask if user wants to import data from previous assistants
 * 4. Ask profile questions (or skip)
 * 5. Save to ~/.wild-claude-pi/life/me/_kernel/key.md
 * 6. Return control to the bot
 */

import fs from 'fs';
import path from 'path';
import readline from 'readline';
import { execSync } from 'child_process';

import { lifePath } from './paths.js';
import { ALLOWED_CHAT_ID } from './config.js';
import { logger } from './logger.js';
import { updateUserConfig } from './overlay.js';

// Create readline ONLY when needed (not at module load)
let rl: readline.Interface | null = null;

function getRL(): readline.Interface {
  if (!rl) {
    rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  }
  return rl;
}

function ask(question: string): Promise<string> {
  return new Promise((resolve) => {
    getRL().question(question, (answer) => resolve(answer.trim()));
  });
}

function print(text: string): void {
  console.log(text);
}

/**
 * Check if Claude CLI is installed and logged in.
 * Returns { installed, loggedIn, version }.
 */
function checkClaudeCli(): { installed: boolean; loggedIn: boolean; version: string } {
  try {
    const version = execSync('claude --version 2>&1', { timeout: 5000 }).toString().trim();
    // Try a quick no-op to verify auth (fails if not logged in)
    try {
      execSync('claude -p "ping" --output-format stream-json 2>&1 | head -1', { timeout: 10000, shell: '/bin/bash' });
      return { installed: true, loggedIn: true, version };
    } catch {
      return { installed: true, loggedIn: false, version };
    }
  } catch {
    return { installed: false, loggedIn: false, version: '' };
  }
}

/**
 * Check if CLI onboarding is needed.
 */
export function needsCliOnboarding(): boolean {
  const keyFile = lifePath('me', '_kernel', 'key.md');
  try {
    if (!fs.existsSync(keyFile)) return true;
    const content = fs.readFileSync(keyFile, 'utf-8');
    return content.includes('[FILL IN]') || content.length < 50;
  } catch {
    return true;
  }
}

// ── Translations ──────────────────────────────────────────────────
const T: Record<string, Record<string, string>> = {
  en: {
    banner1: '  ╔══════════════════════════════════════════════╗',
    banner2: '  ║        WildClaude — First Run Setup          ║',
    banner3: '  ╚══════════════════════════════════════════════╝',
    proceed: '  Set up your profile now? (Y/n/skip) ',
    skipped: '  Skipped. Set up later via Telegram (/start) or the dashboard.',
    checkingCli: '  Checking Claude CLI...',
    cliNotFound: '  ⚠  Claude CLI not found. Install: npm install -g @anthropic-ai/claude-code && claude login',
    cliNotLogged: '  ⚠  Claude CLI found but not logged in. Run: claude login',
    cliReady: '  ✓ Claude CLI ready',
    scanning: '  Scanning for data from previous assistants...',
    foundSources: '  Found %d importable source(s):',
    importNow: '  Import this data now? (Y/n) ',
    importing: 'Importing...',
    importDone: '  ✓ Import complete!',
    noSources: '  No previous assistant data found.',
    profileSetup: '  Profile setup — press Enter to skip any question.',
    askName: '  Your name: ',
    askLocation: '  Where are you based? (e.g. "Berlin, Germany"): ',
    askLanguages: '  Languages you speak (e.g. "English, Italian"): ',
    askWorkStyle: '  How do you work best? (e.g. "mornings, deep focus"): ',
    askCommunication: '  How should I respond? (e.g. "direct, no fluff"): ',
    askGoals: '  Top 2-3 goals right now (comma-separated): ',
    askProjects: '  Current projects or focus areas: ',
    askBotName: '  Give me a name! (default: "WildClaude"): ',
    askPersonality: '  What personality should I have?\n    1. Direct (no fluff)  2. Casual (like a friend)\n    3. Professional       4. Coach (supportive, pushes you)\n  (1-4): ',
    aiBackend: '  How should WildClaude connect to Claude?\n    1. Claude subscription (via claude login — recommended)\n    2. Anthropic API key (pay-per-use)\n  (1/2): ',
    aiSubscriptionOk: '  ✓ Using Claude subscription (CLI mode)',
    aiSubscriptionWarn: '  ⚠  Claude CLI not logged in. Run: claude login',
    aiApiPrompt: '  Paste your Anthropic API key (sk-ant-...): ',
    aiApiSaved: '  ✓ API key saved',
    aiApiSkipped: '  ⚠  No API key set. Add ANTHROPIC_API_KEY to .env later.',
    dashboardAsk: '  Generate a dashboard access token? (Y/n) ',
    dashboardDone: '  ✓ Dashboard: http://localhost:3141',
    setupComplete: '  ╔══════════════════════════════════════════════╗\n  ║          Setup Complete!                     ║\n  ╚══════════════════════════════════════════════╝',
    updateLater: '  Update anytime from Telegram or the dashboard Settings.',
  },
  it: {
    banner1: '  ╔══════════════════════════════════════════════╗',
    banner2: '  ║     WildClaude — Configurazione Iniziale     ║',
    banner3: '  ╚══════════════════════════════════════════════╝',
    proceed: '  Configurare il profilo ora? (S/n/salta) ',
    skipped: '  Saltato. Configura dopo via Telegram (/start) o la dashboard.',
    checkingCli: '  Verifica Claude CLI...',
    cliNotFound: '  ⚠  Claude CLI non trovato. Installa: npm install -g @anthropic-ai/claude-code && claude login',
    cliNotLogged: '  ⚠  Claude CLI trovato ma non autenticato. Esegui: claude login',
    cliReady: '  ✓ Claude CLI pronto',
    scanning: '  Ricerca dati da assistenti precedenti...',
    foundSources: '  Trovate %d sorgenti importabili:',
    importNow: '  Importare questi dati ora? (S/n) ',
    importing: 'Importazione...',
    importDone: '  ✓ Importazione completata!',
    noSources: '  Nessun dato precedente trovato.',
    profileSetup: '  Configurazione profilo — premi Invio per saltare.',
    askName: '  Il tuo nome: ',
    askLocation: '  Dove ti trovi? (es. "Roma, Italia"): ',
    askLanguages: '  Lingue parlate (es. "Italiano nativo, Inglese fluente"): ',
    askWorkStyle: '  Come lavori meglio? (es. "mattina, focus profondo"): ',
    askCommunication: '  Come devo risponderti? (es. "diretto, niente fronzoli"): ',
    askGoals: '  I tuoi 2-3 obiettivi principali (separati da virgola): ',
    askProjects: '  Progetti o aree di focus attuali: ',
    askBotName: '  Dammi un nome! (default: "WildClaude"): ',
    askPersonality: '  Che personalità devo avere?\n    1. Diretto (niente fronzoli)  2. Casual (come un amico)\n    3. Professionale              4. Coach (supportivo, ti sprona)\n  (1-4): ',
    aiBackend: '  Come deve connettersi WildClaude a Claude?\n    1. Abbonamento Claude (via claude login — consigliato)\n    2. API key Anthropic (pay-per-use)\n  (1/2): ',
    aiSubscriptionOk: '  ✓ Usando abbonamento Claude (modalità CLI)',
    aiSubscriptionWarn: '  ⚠  Claude CLI non autenticato. Esegui: claude login',
    aiApiPrompt: '  Incolla la tua API key Anthropic (sk-ant-...): ',
    aiApiSaved: '  ✓ API key salvata',
    aiApiSkipped: '  ⚠  Nessuna API key. Aggiungi ANTHROPIC_API_KEY a .env dopo.',
    dashboardAsk: '  Generare un token per la dashboard? (S/n) ',
    dashboardDone: '  ✓ Dashboard: http://localhost:3141',
    setupComplete: '  ╔══════════════════════════════════════════════╗\n  ║       Configurazione Completata!             ║\n  ╚══════════════════════════════════════════════╝',
    updateLater: '  Aggiorna quando vuoi da Telegram o dalle impostazioni dashboard.',
  },
  es: {
    banner1: '  ╔══════════════════════════════════════════════╗',
    banner2: '  ║   WildClaude — Configuración Inicial         ║',
    banner3: '  ╚══════════════════════════════════════════════╝',
    proceed: '  ¿Configurar tu perfil ahora? (S/n/saltar) ',
    skipped: '  Saltado. Configura después en Telegram (/start) o el dashboard.',
    checkingCli: '  Verificando Claude CLI...',
    cliNotFound: '  ⚠  Claude CLI no encontrado. Instala: npm install -g @anthropic-ai/claude-code && claude login',
    cliNotLogged: '  ⚠  Claude CLI encontrado pero no autenticado. Ejecuta: claude login',
    cliReady: '  ✓ Claude CLI listo',
    scanning: '  Buscando datos de asistentes anteriores...',
    foundSources: '  Encontradas %d fuentes importables:',
    importNow: '  ¿Importar estos datos ahora? (S/n) ',
    importing: 'Importando...',
    importDone: '  ✓ ¡Importación completada!',
    noSources: '  No se encontraron datos anteriores.',
    profileSetup: '  Configuración de perfil — pulsa Enter para saltar.',
    askName: '  Tu nombre: ',
    askLocation: '  ¿Dónde estás? (ej. "Madrid, España"): ',
    askLanguages: '  Idiomas que hablas (ej. "Español nativo, Inglés fluido"): ',
    askWorkStyle: '  ¿Cómo trabajas mejor? (ej. "mañanas, enfoque profundo"): ',
    askCommunication: '  ¿Cómo debo responderte? (ej. "directo, sin rodeos"): ',
    askGoals: '  Tus 2-3 objetivos principales (separados por coma): ',
    askProjects: '  Proyectos o áreas de enfoque actuales: ',
    askBotName: '  ¡Ponme un nombre! (default: "WildClaude"): ',
    askPersonality: '  ¿Qué personalidad debo tener?\n    1. Directo (sin rodeos)  2. Casual (como un amigo)\n    3. Profesional            4. Coach (motivador, te empuja)\n  (1-4): ',
    aiBackend: '  ¿Cómo debe conectarse WildClaude a Claude?\n    1. Suscripción Claude (via claude login — recomendado)\n    2. API key Anthropic (pago por uso)\n  (1/2): ',
    aiSubscriptionOk: '  ✓ Usando suscripción Claude (modo CLI)',
    aiSubscriptionWarn: '  ⚠  Claude CLI no autenticado. Ejecuta: claude login',
    aiApiPrompt: '  Pega tu API key Anthropic (sk-ant-...): ',
    aiApiSaved: '  ✓ API key guardada',
    aiApiSkipped: '  ⚠  Sin API key. Añade ANTHROPIC_API_KEY a .env después.',
    dashboardAsk: '  ¿Generar un token para el dashboard? (S/n) ',
    dashboardDone: '  ✓ Dashboard: http://localhost:3141',
    setupComplete: '  ╔══════════════════════════════════════════════╗\n  ║      ¡Configuración Completada!              ║\n  ╚══════════════════════════════════════════════╝',
    updateLater: '  Actualiza cuando quieras desde Telegram o la configuración del dashboard.',
  },
};

/**
 * Run the CLI onboarding flow. Returns true if completed, false if skipped.
 */
export async function runCliOnboarding(): Promise<boolean> {
  const origLevel = logger.level;
  logger.level = 'silent';

  // ── Language selection (first thing!) ─────────────────────────────
  print('');
  print('  ╔══════════════════════════════════════════════╗');
  print('  ║        WildClaude — Setup                    ║');
  print('  ╚══════════════════════════════════════════════╝');
  print('');
  print('  Select your language / Seleziona la lingua / Selecciona el idioma:');
  print('');
  print('    1. English');
  print('    2. Italiano');
  print('    3. Español');
  print('');
  const langChoice = await ask('  (1/2/3): ');
  const lang = langChoice === '2' ? 'it' : langChoice === '3' ? 'es' : 'en';
  const t = T[lang]!;
  const yes = lang === 'en' ? 'y' : 's';

  print('');
  print(t.banner1);
  print(t.banner2);
  print(t.banner3);
  print('');

  // ── Skip option ──────────────────────────────────────────────────
  const proceed = await ask(t.proceed);
  if (proceed.toLowerCase() === 'skip' || proceed.toLowerCase() === 'salta' || proceed.toLowerCase() === 'saltar' || proceed.toLowerCase() === 'n') {
    print(`\n${t.skipped}\n`);
    getRL().close();
    logger.level = origLevel;
    return false;
  }

  // ── Claude CLI check ─────────────────────────────────────────────
  print(`\n${t.checkingCli}`);
  const cli = checkClaudeCli();

  if (!cli.installed) {
    print(`\n${t.cliNotFound}\n`);
  } else if (!cli.loggedIn) {
    print(`\n${t.cliNotLogged}\n`);
  } else {
    print(`${t.cliReady} (${cli.version})`);
  }

  // ── AI Backend choice ────────────────────────────────────────────
  print('');
  const aiChoice = await ask(t.aiBackend);
  if (aiChoice === '2') {
    // API key mode
    const envPath = path.join(process.cwd(), '.env');
    const currentKey = process.env.ANTHROPIC_API_KEY || '';
    if (!currentKey) {
      const apiKey = await ask(t.aiApiPrompt);
      if (apiKey) {
        // Write to .env
        if (fs.existsSync(envPath)) {
          let envContent = fs.readFileSync(envPath, 'utf-8');
          if (envContent.includes('ANTHROPIC_API_KEY=')) {
            envContent = envContent.replace(/ANTHROPIC_API_KEY=.*/, `ANTHROPIC_API_KEY=${apiKey}`);
          } else {
            envContent += `\nANTHROPIC_API_KEY=${apiKey}\n`;
          }
          fs.writeFileSync(envPath, envContent);
        }
        // Also save to encrypted secrets store
        try {
          const { setSecret } = await import('./secrets.js');
          setSecret('ANTHROPIC_API_KEY', apiKey);
        } catch { /* secrets store not ready yet, .env is enough */ }
        // Set in process.env so it's available immediately
        process.env.ANTHROPIC_API_KEY = apiKey;
        print(t.aiApiSaved);
      } else {
        print(t.aiApiSkipped);
      }
    } else {
      print(t.aiApiSaved);
    }
  } else {
    // Subscription mode — just verify CLI is ready
    if (cli.installed && cli.loggedIn) {
      print(t.aiSubscriptionOk);
    } else {
      print(t.aiSubscriptionWarn);
    }
  }

  // ── Import detection ─────────────────────────────────────────────
  print(`\n${t.scanning}`);

  let detectSources: (() => Array<{ type: string; path: string; description: string; size: string }>) | null = null;
  let autoImport: ((chatId: string) => Promise<Array<{ memoriesImported: number; conversationsImported: number; errors: string[] }>>) | null = null;
  let initDatabase: (() => void) | null = null;

  try {
    const importerMod = await import('./importer.js');
    const dbMod = await import('./db.js');
    detectSources = importerMod.detectSources;
    autoImport = importerMod.autoImport;
    initDatabase = dbMod.initDatabase;
  } catch {
    // import scanner unavailable
  }

  if (detectSources) {
    const sources = detectSources();
    if (sources.length > 0) {
      print(`\n${t.foundSources.replace('%d', String(sources.length))}\n`);
      sources.forEach((s, i) => {
        print(`    ${i + 1}. [${s.type}] ${s.description} (${s.size})`);
      });
      const importChoice = await ask(`\n${t.importNow}`);
      if (importChoice.toLowerCase() !== 'n' && autoImport && initDatabase) {
        initDatabase();
        const chatId = ALLOWED_CHAT_ID || 'onboarding';
        const frames = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];
        let frame = 0;
        const spinner = setInterval(() => {
          process.stdout.write(`\r  ${frames[frame++ % frames.length]} ${t.importing}`);
        }, 100);
        const results = await autoImport(chatId);
        clearInterval(spinner);
        process.stdout.write('\r');
        const totalMem = results.reduce((s, r) => s + r.memoriesImported, 0);
        print(`${t.importDone} (${totalMem} memories)`);
        print('');
      }
    } else {
      print(`${t.noSources}\n`);
    }
  }

  // ── Profile questions ────────────────────────────────────────────
  print(`\n${t.profileSetup}\n`);

  const name       = await ask(t.askName);
  const location   = await ask(t.askLocation);
  const languages  = await ask(t.askLanguages);
  const workStyle  = await ask(t.askWorkStyle);
  const communication = await ask(t.askCommunication);
  const goals      = await ask(t.askGoals);
  const projects   = await ask(t.askProjects);
  print('');
  const botName    = await ask(t.askBotName);
  const personality = await ask(t.askPersonality);

  // ── Step 4: Write kernel files ───────────────────────────────────
  const meKernel = `# me -- identity kernel

## Who I Am
- Name: ${name || 'User'}
- Location: ${location || ''}
- Languages: ${languages || ''}

## How I Work Best
${workStyle || 'Not specified'}

## Communication Preferences
${communication || 'Direct, concise'}

## Current Projects
${projects || ''}

## Notes for Agents
Respond in the same language the user writes in. Keep things concise and actionable.
`;

  const meDir = lifePath('me', '_kernel');
  fs.mkdirSync(meDir, { recursive: true });
  fs.writeFileSync(lifePath('me', '_kernel', 'key.md'), meKernel);

  // Write goals
  const goalLines = goals ? goals.split(/[,;]/).map(g => g.trim()).filter(Boolean) : [];
  if (goalLines.length > 0) {
    const goalsKernel = `# goals -- active goals

${goalLines.map((g, i) => `## Goal ${i + 1}: ${g}
- Status: In Progress
- Next Action: Define first milestone
- Target Date: TBD
`).join('\n')}
`;
    const goalsDir = lifePath('goals', '_kernel');
    fs.mkdirSync(goalsDir, { recursive: true });
    fs.writeFileSync(lifePath('goals', '_kernel', 'key.md'), goalsKernel);
  }

  // Create log.md if it doesn't exist
  const logPath = lifePath('me', '_kernel', 'log.md');
  if (!fs.existsSync(logPath)) {
    fs.writeFileSync(logPath, `# Life Log\n\n## ${new Date().toISOString().slice(0, 10)} -- Setup\n\nWildClaude first run. Profile created.\n\n---\n`);
  }

  // ── Step 4b: Write bot identity and personality to config.json ───
  const chosenBotName = botName || 'WildClaude';
  const PERSONALITY_MAP: Record<string, string> = {
    '1': 'default', '2': 'casual', '3': 'professional', '4': 'coach',
  };
  const presetId = PERSONALITY_MAP[personality] || personality?.toLowerCase() || 'default';
  const validPresets = ['default', 'professional', 'casual', 'coach', 'debug', 'creative'];
  const preset = validPresets.includes(presetId) ? presetId : 'default';

  updateUserConfig({
    botIdentity: {
      name: chosenBotName,
      emoji: '🐺',
      tagline: 'Personal AI Operating System',
    },
    personality: { preset },
  });

  // ── Step 5: Dashboard token ──────────────────────────────────────
  const dashboardChoice = await ask(`\n${t.dashboardAsk}`);
  let dashToken = '';
  if (dashboardChoice.toLowerCase() !== 'n') {
    const crypto = await import('crypto');
    dashToken = crypto.randomBytes(24).toString('hex');

    // Save to secrets store
    try {
      const { setSecret } = await import('./secrets.js');
      setSecret('DASHBOARD_TOKEN', dashToken);
    } catch { /* fallback to .env only */ }

    // Also write to .env for immediate use
    const envPath = path.join(process.cwd(), '.env');
    if (fs.existsSync(envPath)) {
      let envContent = fs.readFileSync(envPath, 'utf-8');
      if (envContent.includes('DASHBOARD_TOKEN=')) {
        envContent = envContent.replace(/DASHBOARD_TOKEN=.*/, `DASHBOARD_TOKEN=${dashToken}`);
      } else {
        envContent += `\nDASHBOARD_TOKEN=${dashToken}\n`;
      }
      fs.writeFileSync(envPath, envContent);
    }
  }

  // ── Summary ──────────────────────────────────────────────────────
  print('');
  print(t.setupComplete);
  print('');
  print(`  Profile:   ${name || 'User'} (${location || ''})`);
  print(`  Bot name:  ${chosenBotName} 🐺`);
  print(`  Style:     ${preset}`);
  if (goalLines.length > 0) print(`  Goals:     ${goalLines.join(', ')}`);
  if (dashToken) {
    print(`${t.dashboardDone}`);
    print(`  Token:     ${dashToken}`);
    print('');
    print('  The dashboard is accessible from your local network.');
    print('  To access from anywhere, install Tailscale: https://tailscale.com');
  }
  print(`\n${t.updateLater}`);
  print('    - File: ~/.wild-claude-pi/life/me/_kernel/key.md');
  print('');

  getRL().close();
  logger.level = origLevel;
  logger.info({ name: name || 'User', goals: goals || 'none' }, 'CLI onboarding complete');
  return true;
}
