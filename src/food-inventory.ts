/**
 * Food inventory helpers — voice and photo parsing.
 * Called by bot.ts to auto-update the inventory from natural language or photos.
 */

import fs from 'fs';
import path from 'path';

import { insertDashboardData, queryDashboardData } from './db.js';
import { runAgent } from './agent.js';
import { MODELS } from './models.js';
import { logger } from './logger.js';
import { USER_DATA_DIR } from './paths.js';

export const FOOD_DASHBOARD_ID = 'food-inventory-xk9m';
export const FOOD_WIDGET_ID = 'add-item';

export interface InventoryItem {
  item: string;
  quantity: number;
  unit: string;
  category: string;
  action: 'aggiunto' | 'rimosso' | 'finito';
  price?: number; // prezzo unitario confezione in EUR
}

/** Returns true if the transcribed voice text is about inventory updates. */
export function isInventoryVoice(text: string): boolean {
  return /\b(ho comprato|ho preso|ho finito|ho acquistato|ho usato|comprato|preso|finito|acquistato|aggiunto|rimosso|messo in frigo|nel frigo|nella dispensa|dispensa|inventario)\b/i.test(text);
}

/** Parse food items from natural language text using Claude Haiku. */
export async function parseInventoryFromText(text: string): Promise<InventoryItem[]> {
  const prompt = `Estrai gli articoli alimentari da questo messaggio e restituisci un JSON array.

Messaggio: "${text}"

Restituisci SOLO un JSON array, niente altro. Formato:
[
  {"item": "pollo", "quantity": 500, "unit": "g", "category": "proteina", "action": "aggiunto"},
  {"item": "riso", "quantity": 1, "unit": "kg", "category": "carbo", "action": "aggiunto"}
]

Regole:
- action: "aggiunto" se l\'utente ha comprato/preso/aggiunto; "finito" se ha finito/esaurito; "rimosso" se ha tolto
- category: proteina / carbo / verdura / grasso / latticino / frutta / altro
- Se quantita non specificata, usa 1 con unita "pz"
- Normalizza unita: g, kg, L, ml, pz
- Se il messaggio non contiene alimenti, restituisci []`;

  try {
    const result = await runAgent(prompt, undefined, () => undefined, undefined, MODELS.haiku);
    const raw = result.text?.trim() ?? '[]';
    const jsonMatch = raw.match(/\[[\s\S]*\]/);
    if (!jsonMatch) return [];
    return JSON.parse(jsonMatch[0]) as InventoryItem[];
  } catch (err) {
    logger.error({ err }, 'Failed to parse inventory from text');
    return [];
  }
}

/**
 * Parse food items from a photo using Claude vision.
 * Handles: fridge/pantry photos, shopping receipts (Italian/German/English),
 * product labels, shopping bags. Multi-language aware.
 */
export async function parseInventoryFromPhoto(localPath: string): Promise<InventoryItem[]> {
  const prompt = `Analizza questa immagine ed estrai tutti gli articoli alimentari. Può essere: foto di frigo/dispensa, scontrino/ricevuta (italiano, tedesco, inglese), etichetta prodotto, busta della spesa.

Immagine salvata in: ${localPath}
Leggi (Read) il file immagine e analizza il contenuto.

Restituisci SOLO un JSON array, niente altro:
[
  {"item": "pollo", "quantity": 500, "unit": "g", "category": "proteina", "action": "aggiunto", "price": 4.99},
  {"item": "uova", "quantity": 30, "unit": "pz", "category": "proteina", "action": "aggiunto", "price": 7.47}
]

Regole generali:
- Normalizza i nomi degli articoli in ITALIANO corretto:
  Hähnchenbrust → petto di pollo | Hähnchenschenkel → cosce di pollo | Hackfleisch → carne macinata
  Lachs → salmone | Thunfisch → tonno | Garnelen → gamberi | Surimi → surimi
  Skyr → skyr | Joghurt → yogurt | Quark → quark | Milch → latte | Käse → formaggio
  Eier → uova | Haferflocken → avena | Reis → riso | Nudeln → pasta | Brot → pane
  Spinat → spinaci | Karotten → carote | Paprika → peperone | Tomaten → pomodori
  Kidneybohnen → fagioli rossi | Hummus → hummus | Olivenöl → olio d'oliva
  Zucker → zucchero | Sojasauce → salsa di soia | Fruchtsaft → succo di frutta
  Trauben → uva | Heidelbeeren → mirtilli | Birne → pera | Äpfel → mele
- category: proteina / carbo / verdura / grasso / latticino / frutta / integratore / altro
- action è sempre "aggiunto"
- price: prezzo UNITARIO della singola confezione in EUR (il numero nella colonna prezzo sulla sinistra, prima del xN)
- SOLO JSON, niente testo prima o dopo
- Se non trovi alimenti, restituisci []

Se è uno SCONTRINO/RICEVUTA:
- Leggi ogni riga prodotto — ignora totali, tasse, servizio, delivery, codici negozio, sconti
- CRITICO — colonna xN = numero confezioni acquistate → moltiplica la quantità unitaria per N:
  "Eier 10 Stück x3" → quantity:30, unit:"pz" | "Skyr 400g x2" → quantity:800, unit:"g"
  "Hähnchenschenkel 400g x2" → quantity:800, unit:"g" | "Thunfisch x2 (stima 150g/lattina)" → quantity:300, unit:"g"
- Se non c'è colonna xN → quantità = 1 confezione
- price = prezzo della SINGOLA confezione (non totale riga)
- Stima quantità standard se non indicata: 1 Packung Hähnchenbrust=500g, Karton Eier=10pz, Dose Thunfisch=150g, Forelle=80g, Lachs-Stäbchen=224g
- Includi solo articoli alimentari, escludi: detersivi, cosmetici, delivery fee, service fee, sconti

Se è una FOTO DI FRIGO/DISPENSA:
- Identifica tutti gli alimenti visibili
- Stima quantità ragionevoli basandoti sulla confezione visibile
- price: 0 (non visibile)`;

  try {
    const result = await runAgent(prompt, undefined, () => undefined, undefined, MODELS.haiku);
    const raw = result.text?.trim() ?? '[]';
    const jsonMatch = raw.match(/\[[\s\S]*\]/);
    if (!jsonMatch) return [];
    return JSON.parse(jsonMatch[0]) as InventoryItem[];
  } catch (err) {
    logger.error({ err }, 'Failed to parse inventory from photo');
    return [];
  }
}

/** Insert items into the inventory, skipping duplicates logged in the last 6 hours. */
export function saveInventoryItems(items: InventoryItem[]): string {
  if (!items.length) return '';

  // Load items logged in the last 6 hours for dedup
  const recent = queryDashboardData(FOOD_DASHBOARD_ID, FOOD_WIDGET_ID, 1)
    .filter(r => r.created_at >= Math.floor(Date.now() / 1000) - 6 * 3600);
  const recentKeys = new Set(recent.map(r => `${String(r.data.item).toLowerCase()}|${r.data.quantity}|${r.data.unit}`));

  const inserted: InventoryItem[] = [];
  const skipped: InventoryItem[] = [];

  for (const item of items) {
    const key = `${item.item.toLowerCase()}|${item.quantity}|${item.unit}`;
    if (recentKeys.has(key)) {
      skipped.push(item);
    } else {
      insertDashboardData(FOOD_DASHBOARD_ID, FOOD_WIDGET_ID, item as unknown as Record<string, unknown>);
      inserted.push(item);
    }
  }

  if (!inserted.length) return `⚠️ *Scontrino già caricato* — ${skipped.length} articoli ignorati (duplicati nelle ultime 6h).`;

  const lines = inserted.map(i => {
    const priceStr = i.price && i.price > 0 ? ` — €${i.price.toFixed(2)}` : '';
    if (i.action === 'finito') return `\u{1F5D1}️ ${i.item} — finito`;
    if (i.action === 'rimosso') return `➖ ${i.quantity}${i.unit} ${i.item} rimosso`;
    return `✅ ${i.quantity}${i.unit} ${i.item} (${i.category})${priceStr}`;
  });

  const skipNote = skipped.length > 0 ? `\n_${skipped.length} duplicati ignorati_` : '';
  return `\u{1F4E6} *Inventario aggiornato:*\n${lines.join('\n')}${skipNote}`;
}

/** Create the Cucina & Fitness dashboard spec if it doesn't exist yet. Called at bot startup. */
export function ensureFoodDashboard(): void {
  const dashDir = path.join(USER_DATA_DIR, 'dashboards');
  const specFile = path.join(dashDir, `${FOOD_DASHBOARD_ID}.json`);
  if (fs.existsSync(specFile)) return;

  fs.mkdirSync(dashDir, { recursive: true });

  const now = Date.now();
  const spec = {
    id: FOOD_DASHBOARD_ID,
    title: 'Cucina & Fitness',
    icon: '🍳',
    description: 'Inventario cucina, pasti, ricette, spesa e allenamenti — tutto in un posto.',
    createdAt: now,
    updatedAt: now,
    widgets: [
      // ── INVENTARIO ───────────────────────────────────────────────────
      {
        id: 'add-item',
        type: 'form',
        title: 'Aggiungi a inventario',
        w: 4,
        source: { kind: 'local' },
        config: {
          fields: [
            { name: 'item', label: 'Alimento', type: 'text' },
            { name: 'quantity', label: 'Quantità', type: 'number' },
            { name: 'unit', label: 'Unità (g/kg/L/ml/pz)', type: 'text' },
            { name: 'category', label: 'Categoria', type: 'text' },
            { name: 'action', label: 'Azione', type: 'text' },
          ],
          submitLabel: 'Aggiungi',
        },
      },
      {
        id: 'inventory-list',
        type: 'table',
        title: 'Inventario cucina',
        w: 8,
        source: { kind: 'local', sinceDays: 60 },
        config: {
          readWidget: 'add-item',
          columns: [
            { key: 'item', label: 'Alimento' },
            { key: 'quantity', label: 'Qtà' },
            { key: 'unit', label: 'Unità' },
            { key: 'category', label: 'Categoria' },
            { key: 'action', label: 'Azione' },
          ],
        },
      },

      // ── PASTI & MACRO ────────────────────────────────────────────────
      {
        id: 'log-meal',
        type: 'form',
        title: 'Logga pasto',
        w: 4,
        source: { kind: 'local' },
        config: {
          fields: [
            { name: 'pasto', label: 'Pasto / Ricetta', type: 'text' },
            { name: 'calorie', label: 'Calorie (kcal)', type: 'number' },
            { name: 'proteina', label: 'Proteine (g)', type: 'number' },
            { name: 'carbo', label: 'Carboidrati (g)', type: 'number' },
            { name: 'grasso', label: 'Grassi (g)', type: 'number' },
          ],
          submitLabel: 'Logga',
        },
      },
      {
        id: 'calories-today',
        type: 'metric',
        title: 'Calorie oggi',
        w: 3,
        source: { kind: 'local', field: 'calorie', agg: 'sum', sinceDays: 1 },
        config: { unit: 'kcal', readWidget: 'log-meal' },
      },
      {
        id: 'protein-today',
        type: 'metric',
        title: 'Proteine oggi',
        w: 3,
        source: { kind: 'local', field: 'proteina', agg: 'sum', sinceDays: 1 },
        config: { unit: 'g', readWidget: 'log-meal' },
      },
      {
        id: 'carbs-today',
        type: 'metric',
        title: 'Carbo oggi',
        w: 3,
        source: { kind: 'local', field: 'carbo', agg: 'sum', sinceDays: 1 },
        config: { unit: 'g', readWidget: 'log-meal' },
      },
      {
        id: 'fat-today',
        type: 'metric',
        title: 'Grassi oggi',
        w: 3,
        source: { kind: 'local', field: 'grasso', agg: 'sum', sinceDays: 1 },
        config: { unit: 'g', readWidget: 'log-meal' },
      },
      {
        id: 'protein-goal',
        type: 'gauge',
        title: 'Proteine giornaliere (obiettivo 150g)',
        w: 4,
        source: { kind: 'local', field: 'proteina', agg: 'sum', sinceDays: 1 },
        config: { unit: 'g', target: 150, readWidget: 'log-meal' },
      },
      {
        id: 'calories-7d',
        type: 'chart',
        title: 'Calorie (7 giorni)',
        w: 8,
        source: { kind: 'local', field: 'calorie', agg: 'sum', groupByDay: true, sinceDays: 7 },
        config: { kind: 'bar', x: 'day', y: 'value', readWidget: 'log-meal' },
      },
      {
        id: 'recent-meals',
        type: 'table',
        title: 'Pasti recenti (7 giorni)',
        w: 12,
        source: { kind: 'local', sinceDays: 7 },
        config: {
          readWidget: 'log-meal',
          columns: [
            { key: 'pasto', label: 'Pasto' },
            { key: 'calorie', label: 'kcal' },
            { key: 'proteina', label: 'Prot (g)' },
            { key: 'carbo', label: 'Carbo (g)' },
            { key: 'grasso', label: 'Grassi (g)' },
          ],
        },
      },

      // ── PESO ─────────────────────────────────────────────────────────
      {
        id: 'log-weight',
        type: 'form',
        title: 'Logga peso',
        w: 4,
        source: { kind: 'local' },
        config: {
          fields: [{ name: 'peso', label: 'Peso (kg)', type: 'number' }],
          submitLabel: 'Logga',
        },
      },
      {
        id: 'latest-weight',
        type: 'metric',
        title: 'Peso attuale',
        w: 4,
        source: { kind: 'local', field: 'peso', agg: 'last' },
        config: { unit: 'kg', readWidget: 'log-weight' },
      },
      {
        id: 'weight-delta',
        type: 'metric',
        title: 'Variazione (30d)',
        w: 4,
        source: { kind: 'local', field: 'peso', agg: 'delta', sinceDays: 30 },
        config: { unit: 'kg', readWidget: 'log-weight' },
      },
      {
        id: 'weight-trend',
        type: 'chart',
        title: 'Trend peso (30 giorni)',
        w: 12,
        source: { kind: 'local', field: 'peso', agg: 'avg', groupByDay: true, sinceDays: 30 },
        config: { kind: 'line', x: 'day', y: 'value', readWidget: 'log-weight' },
      },

      // ── RICETTE ───────────────────────────────────────────────────────
      {
        id: 'log-recipe',
        type: 'form',
        title: 'Salva ricetta',
        w: 4,
        source: { kind: 'local' },
        config: {
          fields: [
            { name: 'nome', label: 'Nome ricetta', type: 'text' },
            { name: 'ingredienti', label: 'Ingredienti', type: 'text' },
            { name: 'porzioni', label: 'Porzioni', type: 'number' },
            { name: 'calorie_pz', label: 'Calorie/porzione', type: 'number' },
            { name: 'proteina_pz', label: 'Proteine/porzione (g)', type: 'number' },
            { name: 'costo', label: 'Costo ingredienti (€)', type: 'number' },
          ],
          submitLabel: 'Salva',
        },
      },
      {
        id: 'recipes-list',
        type: 'table',
        title: 'Ricette salvate',
        w: 8,
        source: { kind: 'local', sinceDays: 365 },
        config: {
          readWidget: 'log-recipe',
          columns: [
            { key: 'nome', label: 'Ricetta' },
            { key: 'calorie_pz', label: 'kcal/pz' },
            { key: 'proteina_pz', label: 'Prot (g)' },
            { key: 'costo', label: 'Costo (€)' },
            { key: 'ingredienti', label: 'Ingredienti' },
          ],
        },
      },
      {
        id: 'avg-recipe-cost',
        type: 'metric',
        title: 'Costo medio ricetta',
        w: 4,
        source: { kind: 'local', field: 'costo', agg: 'avg' },
        config: { unit: '€', format: 'currency', readWidget: 'log-recipe' },
      },

      // ── SPESA ─────────────────────────────────────────────────────────
      {
        id: 'log-spesa',
        type: 'form',
        title: 'Logga spesa',
        w: 4,
        source: { kind: 'local' },
        config: {
          fields: [
            { name: 'negozio', label: 'Negozio', type: 'text' },
            { name: 'totale', label: 'Totale (€)', type: 'number' },
            { name: 'note', label: 'Note', type: 'text' },
          ],
          submitLabel: 'Logga',
        },
      },
      {
        id: 'spesa-settimana',
        type: 'metric',
        title: 'Spesa questa settimana',
        w: 4,
        source: { kind: 'local', field: 'totale', agg: 'sum', sinceDays: 7 },
        config: { unit: '€', format: 'currency', readWidget: 'log-spesa' },
      },
      {
        id: 'spesa-mese',
        type: 'metric',
        title: 'Spesa questo mese',
        w: 4,
        source: { kind: 'local', field: 'totale', agg: 'sum', sinceDays: 30 },
        config: { unit: '€', format: 'currency', readWidget: 'log-spesa' },
      },
      {
        id: 'spesa-chart',
        type: 'chart',
        title: 'Trend spesa (90 giorni)',
        w: 12,
        source: { kind: 'local', field: 'totale', agg: 'sum', groupByDay: true, sinceDays: 90 },
        config: { kind: 'bar', x: 'day', y: 'value', readWidget: 'log-spesa' },
      },

      // ── ALLENAMENTI ───────────────────────────────────────────────────
      {
        id: 'log-workout',
        type: 'form',
        title: 'Logga allenamento',
        w: 4,
        source: { kind: 'local' },
        config: {
          fields: [
            { name: 'attivita', label: 'Attività', type: 'text' },
            { name: 'tipo', label: 'Tipo (forza/cardio/altro)', type: 'text' },
            { name: 'minuti', label: 'Minuti', type: 'number' },
            { name: 'serie', label: 'Serie', type: 'number' },
            { name: 'note', label: 'Note', type: 'text' },
          ],
          submitLabel: 'Logga',
        },
      },
      {
        id: 'active-minutes',
        type: 'gauge',
        title: 'Minuti attivi (obiettivo 150min/sett)',
        w: 4,
        source: { kind: 'local', field: 'minuti', agg: 'sum', sinceDays: 7 },
        config: { unit: 'min', target: 150, readWidget: 'log-workout' },
      },
      {
        id: 'workout-streak',
        type: 'metric',
        title: 'Streak allenamenti',
        w: 4,
        source: { kind: 'local', agg: 'streak' },
        config: { unit: 'giorni', readWidget: 'log-workout' },
      },
      {
        id: 'recent-workouts',
        type: 'table',
        title: 'Allenamenti recenti (30 giorni)',
        w: 12,
        source: { kind: 'local', sinceDays: 30 },
        config: {
          readWidget: 'log-workout',
          columns: [
            { key: 'attivita', label: 'Attività' },
            { key: 'tipo', label: 'Tipo' },
            { key: 'minuti', label: 'Min' },
            { key: 'serie', label: 'Serie' },
            { key: 'note', label: 'Note' },
          ],
        },
      },

      // ── AI INSIGHT ───────────────────────────────────────────────────
      {
        id: 'nutrition-insight',
        type: 'insight',
        title: 'AI: analisi nutrizionale',
        w: 12,
        config: { readWidget: 'log-meal' },
      },
    ],
  };

  fs.writeFileSync(specFile, JSON.stringify(spec, null, 2), { mode: 0o600 });
  logger.info({ id: FOOD_DASHBOARD_ID }, 'Food & Fitness dashboard created');
}
