---
name: upgrade
description: Aggiorna WildClaude all'ultima versione — git pull, npm install, build, restart. Usa quando vuoi aggiornare il bot.
user_invocable: true
---

# /upgrade — WildClaude Self-Upgrade

Quando invocato, esegui l'upgrade di WildClaude all'ultima versione da GitHub.

## Step 1: Controlla se ci sono aggiornamenti

Esegui:
```bash
cd ~/WildClaude && git fetch origin master 2>/dev/null
CURRENT=$(git rev-parse HEAD | head -c 7)
REMOTE=$(git rev-parse origin/master | head -c 7)
```

Se `CURRENT == REMOTE`, rispondi: "Già all'ultima versione ($CURRENT)." e fermati.

Altrimenti continua.

## Step 2: Mostra cosa sta per cambiare

Esegui:
```bash
cd ~/WildClaude && git log HEAD..origin/master --oneline
```

Mostra i commit che verranno applicati (max 10 righe).

## Step 3: Avvia upgrade in background

Il build sul Raspberry richiede 2-5 minuti — eseguilo in background per non bloccare il bot:

```bash
nohup bash -c '
  cd ~/WildClaude
  LOG=~/.wild-claude-pi/upgrade.log
  echo "[START] $(date)" >> $LOG
  wildclaude upgrade >> $LOG 2>&1
  echo "[DONE] $(date)" >> $LOG
' > /dev/null 2>&1 &
echo $!
```

Rispondi immediatamente: "Upgrade avviato in background. Il bot si riavvierà tra 2-5 minuti. Puoi seguire i log con /upgrade_log"

## Step 4: (opzionale) Se l'utente usa /upgrade_log

Mostra le ultime 30 righe di `~/.wild-claude-pi/upgrade.log`:
```bash
tail -30 ~/.wild-claude-pi/upgrade.log
```

## Regole

- NON aspettare che il build finisca — va in background subito
- Il bot si riavvierà automaticamente: wildclaude upgrade gestisce lo stop/start
- Se il processo richiede > 10 min qualcosa è andato storto — controlla il log
- Aggiorna log.md dopo il completamento dell'upgrade
