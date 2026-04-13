---
name: learnlesson
description: Capture a lesson learned or error to avoid, right after it happened. Saves to memory, lessons file, and self-reflection log so future sessions don't repeat the same mistake. Use immediately after making an error or misunderstanding.
user_invocable: true
---

# /learnlesson -- Capture a Lesson Learned

Invocato subito dopo un errore o malinteso. L'utente vuole che tu memorizzi cosa è andato storto in modo permanente.

## Step 1: Ricostruisci l'errore dal contesto

Guarda la conversazione attuale (ultimi 5-10 scambi). Identifica:

- **Cosa hai fatto di sbagliato** — la risposta/azione esatta che era errata
- **Cosa avrebbe dovuto fare** — la risposta/azione corretta
- **Perché è successo** — assunzione sbagliata, malinteso del contesto, pattern errato
- **Categoria** — scegli una: `misunderstanding` | `code_bug` | `workflow` | `communication` | `memory` | `context_missing`

Se l'utente ha fornito testo aggiuntivo con il comando (es. `/learnlesson non usare mai X quando Y`), usa quello come descrizione principale. Altrimenti ricavalo dal contesto.

## Step 2: Scrivi la lezione

Formato standardizzato:

```
QUANDO: [trigger — cosa diceva o chiedeva l'utente, o situazione che si è verificata]
ERRORE: [cosa hai fatto/risposto di sbagliato — specifico]
CORRETTO: [cosa fare invece — specifico e azionabile]
PERCHÉ: [causa radice dell'errore]
CATEGORIA: [misunderstanding | code_bug | workflow | communication | memory | context_missing]
```

Sii specifico. "Non rispondere con X quando Y" è meglio di "fare attenzione al contesto".

## Step 3: Salva in 3 posti

### 3a. Memory file (persistenza cross-sessione)
Scrivi un file in `~/.wild-claude-pi/memories/YYYY-MM/YYYY-MM-DD-lesson-<slug>.md`:

```markdown
---
type: lesson_learned
date: YYYY-MM-DD
category: [categoria]
importance: 0.95
pinned: true
---

# Lezione: [titolo breve]

**QUANDO:** [trigger]
**ERRORE:** [cosa sbagliato]
**CORRETTO:** [cosa fare]
**PERCHÉ:** [causa]
```

### 3b. Self-reflection log
Appendi a `~/.wild-claude-pi/reflections.jsonl` (una riga JSON):

```json
{"date": "YYYY-MM-DD", "category": "CATEGORIA", "trigger": "...", "wrong": "...", "correct": "...", "why": "..."}
```

### 3c. Lessons file (dati utente — NON nella repo)
Salva in `~/.wild-claude-pi/lessons-learned.md`. Non scrivere mai nella cartella `docs/` del repo — è codice, non dati personali.

Se il file esiste, appendi:

```markdown
## YYYY-MM-DD — [Titolo]
- **Categoria:** [categoria]
- **Trigger:** [quando]
- **Errore:** [cosa sbagliato]
- **Corretto:** [cosa fare]
- **Causa:** [perché]
```

Se il file non esiste, crealo con header:
```markdown
# Lessons Learned

Errori e pattern da evitare, catturati in tempo reale.
```

## Step 4: Conferma

Rispondi in modo conciso:

```
✅ Lezione salvata.

**Errore:** [una riga]
**Regola:** [una riga — cosa fare d'ora in poi]
```

Niente altro. Breve e concreto.

## Regole

- Salva SEMPRE tutte e 3 le destinazioni (memory file, reflections.jsonl, ~/.wild-claude-pi/lessons-learned.md)
- Importanza 0.95 e `pinned: true` — questa memoria non decade mai
- Se non riesci a identificare l'errore dal contesto, chiedi all'utente di descriverlo in una riga
- Non moralizzare o fare lunghe analisi — cattura e vai avanti
- Il file `reflections.jsonl` viene iniettato automaticamente nel system prompt delle sessioni future — è il meccanismo principale di auto-miglioramento
