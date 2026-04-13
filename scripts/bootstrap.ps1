# WildClaude — One-Command Setup for Windows
#
# Run: powershell -ExecutionPolicy Bypass -File scripts\bootstrap.ps1
#
# This script handles:
# 1. Checks Node.js
# 2. Checks/installs Claude CLI
# 3. Authenticates with Claude
# 4. Installs dependencies and builds
# 5. AI backend choice (subscription vs API key)
# 6. Telegram bot token setup
# 7. Launches WildClaude

$ErrorActionPreference = "Stop"

function Ok($msg)   { Write-Host "  $([char]0x2713) $msg" -ForegroundColor Green }
function Warn($msg) { Write-Host "  ! $msg" -ForegroundColor Yellow }
function Fail($msg) { Write-Host "  X $msg" -ForegroundColor Red; exit 1 }

Write-Host ""
Write-Host "  +======================================+"
Write-Host "  |        WildClaude - Setup             |"
Write-Host "  +======================================+"
Write-Host ""
Write-Host "  Windows $([System.Environment]::OSVersion.Version)"
Write-Host ""

# -- 1. Node.js -------------------------------------------------------
$nodeVersion = $null
try {
    $nodeVersion = (node --version 2>$null)
    if ($nodeVersion) {
        $major = [int]($nodeVersion -replace 'v','').Split('.')[0]
        if ($major -ge 20) {
            Ok "Node.js $nodeVersion"
        } else {
            Fail "Node.js $major found but 20+ required. Download: https://nodejs.org/"
        }
    }
} catch {}

if (-not $nodeVersion) {
    Fail "Node.js not found. Download from https://nodejs.org/ (LTS 22 recommended)"
}

# -- 2. Claude CLI -----------------------------------------------------
$claudeCmd = $null
$candidates = @("claude", "$env:APPDATA\npm\claude.cmd", "$env:LOCALAPPDATA\npm-global\claude.cmd")
foreach ($cmd in $candidates) {
    try {
        $ver = & $cmd --version 2>$null
        if ($LASTEXITCODE -eq 0 -or $ver) {
            $claudeCmd = $cmd
            break
        }
    } catch {}
}

if ($claudeCmd) {
    $cliVer = & $claudeCmd --version 2>$null
    Ok "Claude CLI ($cliVer)"
} else {
    Write-Host "  Installing Claude CLI..."
    npm install -g @anthropic-ai/claude-code 2>$null
    $claudeCmd = "claude"
    try {
        $cliVer = & claude --version 2>$null
        Ok "Claude CLI installed ($cliVer)"
    } catch {
        Warn "Claude CLI install may need a new terminal. Run: npm install -g @anthropic-ai/claude-code"
    }
}

# -- 3. Claude auth ----------------------------------------------------
$claudeDir = Join-Path $env:USERPROFILE ".claude"
if ((Test-Path $claudeDir) -and (Get-ChildItem $claudeDir -Filter "*.json" -ErrorAction SilentlyContinue)) {
    Ok "Claude authenticated"
} else {
    Write-Host ""
    Write-Host "  Claude needs to be authenticated with your Anthropic account."
    Write-Host "  This will open a browser - log in and come back here."
    Write-Host ""
    try {
        & $claudeCmd login
    } catch {
        Warn "Login skipped. Run 'claude login' later before using the bot."
    }
    Write-Host ""
}

# -- 4. Dependencies ---------------------------------------------------
Write-Host "  Installing dependencies..."
npm install 2>&1 | Select-Object -Last 1
Ok "Dependencies installed"

Write-Host "  Building..."
npm run build 2>&1 | Select-Object -Last 1
Ok "Build complete"

# -- 5. Configuration -------------------------------------------------
if (-not (Test-Path ".env")) {
    if (Test-Path ".env.example") {
        Copy-Item ".env.example" ".env"
    } else {
        "TELEGRAM_BOT_TOKEN=" | Out-File -FilePath ".env" -Encoding utf8
    }
}

# -- 5a. AI Backend ----------------------------------------------------
Write-Host ""
Write-Host "  How should WildClaude connect to Claude?"
Write-Host ""
Write-Host "    1. Claude subscription (via 'claude login' - recommended)"
Write-Host "       Uses your existing Claude Pro/Max subscription."
Write-Host ""
Write-Host "    2. Anthropic API key (pay-per-use)"
Write-Host "       Uses the Anthropic API directly. You pay per token."
Write-Host "       Get a key at: https://console.anthropic.com/settings/keys"
Write-Host ""
$aiMode = Read-Host "  (1/2)"

if ($aiMode -eq "2") {
    $currentApiKey = (Select-String -Path ".env" -Pattern "^ANTHROPIC_API_KEY=" -ErrorAction SilentlyContinue)
    $keyValue = if ($currentApiKey) { ($currentApiKey.Line -split "=",2)[1] } else { "" }
    if (-not $keyValue) {
        Write-Host ""
        $apiKey = Read-Host "  Paste your Anthropic API key (sk-ant-...)"
        if ($apiKey) {
            $envContent = Get-Content ".env" -Raw
            if ($envContent -match "ANTHROPIC_API_KEY=") {
                $envContent = $envContent -replace "ANTHROPIC_API_KEY=.*", "ANTHROPIC_API_KEY=$apiKey"
            } else {
                $envContent += "`nANTHROPIC_API_KEY=$apiKey`n"
            }
            $envContent | Set-Content ".env" -NoNewline
            Ok "API key saved"
        } else {
            Warn "No API key. Set ANTHROPIC_API_KEY in .env before running."
        }
    } else {
        Ok "Anthropic API key already configured"
    }
} else {
    if ($claudeCmd -and (Test-Path $claudeDir) -and (Get-ChildItem $claudeDir -Filter "*.json" -ErrorAction SilentlyContinue)) {
        Ok "Claude subscription mode (CLI authenticated)"
    } else {
        Warn "Claude CLI not logged in. Run: claude login"
    }
}

# -- 5b. Interface mode ------------------------------------------------
Write-Host ""
Write-Host "  WildClaude can be used via Telegram, the web dashboard, or both."
Write-Host ""
Write-Host "    1. Telegram + Dashboard (recommended)"
Write-Host "    2. Dashboard only (no Telegram)"
Write-Host "    3. Skip configuration (set up later)"
Write-Host ""
$useMode = Read-Host "  (1/2/3)"

if ($useMode -eq "3") {
    Warn "Configuration skipped. Edit .env and run: npm run dev"
} elseif ($useMode -eq "2") {
    Ok "Dashboard-only mode."
    Write-Host "  The dashboard will be available at http://localhost:3141"
} else {
    # Telegram setup
    $currentToken = (Select-String -Path ".env" -Pattern "^TELEGRAM_BOT_TOKEN=" -ErrorAction SilentlyContinue)
    $tokenValue = if ($currentToken) { ($currentToken.Line -split "=",2)[1] } else { "" }
    if (-not $tokenValue) {
        Write-Host ""
        Write-Host "  You need a Telegram bot token."
        Write-Host "  Open Telegram -> @BotFather -> /newbot -> copy the token."
        Write-Host ""
        $botToken = Read-Host "  Paste your bot token (or Enter to skip Telegram)"
        if ($botToken) {
            $envContent = Get-Content ".env" -Raw
            $envContent = $envContent -replace "TELEGRAM_BOT_TOKEN=.*", "TELEGRAM_BOT_TOKEN=$botToken"
            $envContent | Set-Content ".env" -NoNewline
            Ok "Bot token saved"
            $tokenValue = $botToken
        } else {
            Warn "No Telegram token. Dashboard will still work."
        }
    } else {
        Ok "Bot token already configured"
    }

    # Chat ID detection
    $currentChatId = (Select-String -Path ".env" -Pattern "^ALLOWED_CHAT_ID=" -ErrorAction SilentlyContinue)
    $chatIdValue = if ($currentChatId) { ($currentChatId.Line -split "=",2)[1] } else { "" }
    if ((-not $chatIdValue) -and $tokenValue) {
        try {
            $botInfo = Invoke-RestMethod -Uri "https://api.telegram.org/bot$tokenValue/getMe" -ErrorAction Stop
            if ($botInfo.ok) {
                $botName = $botInfo.result.username
                Ok "Bot verified: @$botName"
                Write-Host ""
                Write-Host "  Send any message to @$botName on Telegram (e.g. type 'hello')."
                Write-Host "  Your chat ID will be detected automatically..."
                Write-Host ""

                # Clear pending updates
                Invoke-RestMethod -Uri "https://api.telegram.org/bot$tokenValue/getUpdates?offset=-1" -ErrorAction SilentlyContinue | Out-Null

                $chatId = $null
                for ($i = 1; $i -le 12; $i++) {
                    try {
                        $response = Invoke-RestMethod -Uri "https://api.telegram.org/bot$tokenValue/getUpdates?timeout=5&limit=1" -TimeoutSec 10 -ErrorAction Stop
                        if ($response.ok -and $response.result.Count -gt 0) {
                            $chatId = $response.result[-1].message.chat.id
                            if ($chatId) { break }
                        }
                    } catch {}
                    Write-Host "`r  Waiting... ($($i * 5)s)" -NoNewline
                }

                if ($chatId) {
                    Write-Host ""
                    $envContent = Get-Content ".env" -Raw
                    $envContent = $envContent -replace "ALLOWED_CHAT_ID=.*", "ALLOWED_CHAT_ID=$chatId"
                    $envContent | Set-Content ".env" -NoNewline
                    Ok "Chat ID detected and saved: $chatId"
                    Ok "Only YOU can use this bot now."

                    # Send welcome message
                    $welcomeText = "Welcome to WildClaude! / Benvenuto! / Bienvenido!`n`nSelect your language:`n1. English`n2. Italiano`n3. Espanol`n`nReply with 1, 2 or 3"
                    $body = @{ chat_id = $chatId; text = $welcomeText } | ConvertTo-Json
                    Invoke-RestMethod -Uri "https://api.telegram.org/bot$tokenValue/sendMessage" -Method Post -Body $body -ContentType "application/json" -ErrorAction SilentlyContinue | Out-Null
                    Ok "Welcome message sent to your Telegram!"
                    Invoke-RestMethod -Uri "https://api.telegram.org/bot$tokenValue/getUpdates?offset=-1" -ErrorAction SilentlyContinue | Out-Null
                } else {
                    Write-Host ""
                    Warn "Timeout. Send /chatid to the bot after starting, then add to .env."
                }
            } else {
                Warn "Bot token invalid. Check and update in .env."
            }
        } catch {
            Warn "Could not verify bot token. Check your internet connection."
        }
    }
}

# -- 6. Launch ---------------------------------------------------------
Write-Host ""
Write-Host "  +======================================+"
Write-Host "  |          Setup Complete!              |"
Write-Host "  +======================================+"
Write-Host ""

$finalToken = (Select-String -Path ".env" -Pattern "^TELEGRAM_BOT_TOKEN=" -ErrorAction SilentlyContinue)
$finalTokenValue = if ($finalToken) { ($finalToken.Line -split "=",2)[1] } else { "" }

if ($finalTokenValue -and $finalTokenValue -ne "your_token_from_botfather") {
    Write-Host "  Starting WildClaude..."
    Write-Host "  (First run will ask you a few setup questions)"
    Write-Host ""
    npm run dev
} else {
    Write-Host "  To start WildClaude:"
    Write-Host "    1. Edit .env: notepad .env"
    Write-Host "       Set TELEGRAM_BOT_TOKEN=your_token"
    Write-Host "    2. Run: npm run dev"
    Write-Host "    3. Send /chatid in Telegram, add to .env, restart"
    Write-Host ""
}
