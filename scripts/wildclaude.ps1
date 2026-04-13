# WildClaude CLI for Windows
#
# Install globally (run as admin):
#   Copy-Item scripts\wildclaude.ps1 "$env:LOCALAPPDATA\Microsoft\WindowsApps\wildclaude.ps1"
#
# Or add to PowerShell profile:
#   Set-Alias wildclaude "C:\path\to\WildClaude\scripts\wildclaude.ps1"
#
# Usage:
#   wildclaude <command> [options]

param(
    [Parameter(Position=0)]
    [string]$Command = "help",
    [Parameter(Position=1, ValueFromRemainingArguments)]
    [string[]]$Args
)

$ErrorActionPreference = "Continue"

function Ok($msg)   { Write-Host "  $([char]0x2713) $msg" -ForegroundColor Green }
function Warn($msg) { Write-Host "  ! $msg" -ForegroundColor Yellow }
function Fail($msg) { Write-Host "  X $msg" -ForegroundColor Red; exit 1 }
function Info($msg) { Write-Host "  > $msg" -ForegroundColor Cyan }

# Find project root
function Find-Root {
    if ($env:WILDCLAUDE_DIR -and (Test-Path "$env:WILDCLAUDE_DIR\package.json")) {
        return $env:WILDCLAUDE_DIR
    }
    $dir = $PWD.Path
    while ($dir -ne [System.IO.Path]::GetPathRoot($dir)) {
        if ((Test-Path "$dir\package.json") -and (Select-String -Path "$dir\package.json" -Pattern '"wildclaude"' -Quiet -ErrorAction SilentlyContinue)) {
            return $dir
        }
        $dir = Split-Path $dir -Parent
    }
    foreach ($d in @("$env:USERPROFILE\WildClaude", "$env:USERPROFILE\wildclaude", "C:\WildClaude")) {
        if ((Test-Path "$d\package.json") -and (Select-String -Path "$d\package.json" -Pattern '"wildclaude"' -Quiet -ErrorAction SilentlyContinue)) {
            return $d
        }
    }
    return $null
}

$ProjectRoot = Find-Root
$DataDir = if ($env:WILD_DATA_DIR) { $env:WILD_DATA_DIR } else { "$env:USERPROFILE\.wild-claude-pi" }

function Get-LocalIp {
    try {
        $ip = (Get-NetIPAddress -AddressFamily IPv4 | Where-Object { $_.PrefixOrigin -ne "WellKnown" -and $_.IPAddress -ne "127.0.0.1" } | Select-Object -First 1).IPAddress
        if ($ip) { return $ip }
    } catch {}
    return "localhost"
}

function Test-Running {
    $pidFile = "$DataDir\store\wildclaude.pid"
    if (Test-Path $pidFile) {
        $pid = Get-Content $pidFile -ErrorAction SilentlyContinue
        if ($pid) {
            try { Get-Process -Id $pid -ErrorAction Stop | Out-Null; return $true } catch {}
        }
    }
    $procs = Get-Process -Name "node" -ErrorAction SilentlyContinue | Where-Object { $_.CommandLine -match "dist[/\\]index.js" }
    return ($null -ne $procs -and $procs.Count -gt 0)
}

# ── Commands ─────────────────────────────────────────────────────────

function Cmd-Install {
    Write-Host ""
    Write-Host "  WildClaude - Install" -ForegroundColor White
    Write-Host ""

    if ($ProjectRoot) {
        Warn "WildClaude already installed at $ProjectRoot"
        Write-Host "  Use 'wildclaude upgrade' to update."
        return
    }

    $installDir = if ($Args[0]) { $Args[0] } else { "$env:USERPROFILE\WildClaude" }
    Info "Installing to $installDir..."

    git clone https://github.com/rsalvagio92/WildClaude.git $installDir
    Set-Location $installDir
    powershell -ExecutionPolicy Bypass -File scripts\bootstrap.ps1
}

function Cmd-Uninstall {
    Write-Host ""
    Write-Host "  WildClaude - Uninstall" -ForegroundColor White
    Write-Host ""

    if (-not $ProjectRoot) { Fail "WildClaude not found." }

    Write-Host "  This will remove:" -ForegroundColor Red
    Write-Host "    - Project: $ProjectRoot"
    Write-Host "    - User data: $DataDir"
    Write-Host ""
    $confirm = Read-Host "  Are you sure? (yes/no)"
    if ($confirm -ne "yes") { Write-Host "  Cancelled."; return }

    Cmd-Stop 2>$null
    Start-Sleep -Seconds 1

    Remove-Item -Recurse -Force $ProjectRoot -ErrorAction SilentlyContinue
    Ok "Project removed: $ProjectRoot"

    if (Test-Path $DataDir) {
        $confirmData = Read-Host "  Also delete user data ($DataDir)? (yes/no)"
        if ($confirmData -eq "yes") {
            Remove-Item -Recurse -Force $DataDir
            Ok "User data removed"
        } else {
            Warn "User data kept at $DataDir"
        }
    }

    Write-Host ""
    Ok "WildClaude uninstalled."
}

function Cmd-Start {
    if (-not $ProjectRoot) { Fail "WildClaude not found. Run 'wildclaude install' first." }

    if (Test-Running) { Warn "WildClaude is already running."; return }

    Set-Location $ProjectRoot
    Start-Process -NoNewWindow -FilePath "node" -ArgumentList "dist/index.js" -RedirectStandardOutput "$env:TEMP\wildclaude.log" -RedirectStandardError "$env:TEMP\wildclaude-err.log"
    Ok "WildClaude started"

    $ip = Get-LocalIp
    $port = "3141"
    try { $port = (Select-String -Path "$ProjectRoot\.env" -Pattern "^DASHBOARD_PORT=(.+)" -ErrorAction SilentlyContinue).Matches[0].Groups[1].Value } catch {}
    Info "Dashboard: http://${ip}:${port}"
    Info "Logs: $env:TEMP\wildclaude.log"
}

function Cmd-Stop {
    $pidFile = "$DataDir\store\wildclaude.pid"
    if (Test-Path $pidFile) {
        $pid = Get-Content $pidFile -ErrorAction SilentlyContinue
        if ($pid) {
            try {
                Stop-Process -Id $pid -Force -ErrorAction Stop
                Ok "WildClaude stopped (PID: $pid)"
                return
            } catch {}
        }
    }
    $procs = Get-Process -Name "node" -ErrorAction SilentlyContinue | Where-Object { $_.CommandLine -match "dist[/\\]index.js" }
    if ($procs) {
        $procs | Stop-Process -Force
        Ok "WildClaude stopped"
    } else {
        Warn "WildClaude not running"
    }
}

function Cmd-Restart {
    Cmd-Stop 2>$null
    Start-Sleep -Seconds 1
    Cmd-Start
}

function Cmd-Status {
    Write-Host ""
    Write-Host "  WildClaude Status" -ForegroundColor White
    Write-Host ""

    if ($ProjectRoot) {
        Ok "Project: $ProjectRoot"
        try { $version = (node -e "console.log(require('$($ProjectRoot -replace '\\','/')/package.json').version)" 2>$null); Info "Version: $version" } catch {}
    } else {
        Warn "Project: not found"
    }

    if (Test-Path $DataDir) {
        Ok "User data: $DataDir"
        $memCount = (Get-ChildItem -Path "$DataDir\memories" -Filter "*.md" -Recurse -ErrorAction SilentlyContinue | Measure-Object).Count
        Info "Memories: $memCount files"
    } else {
        Warn "User data: not initialized"
    }

    if (Test-Running) {
        Ok "Status: running"
    } else {
        Warn "Status: stopped"
    }

    $ip = Get-LocalIp
    $port = "3141"
    try { $port = (Select-String -Path "$ProjectRoot\.env" -Pattern "^DASHBOARD_PORT=(.+)" -ErrorAction SilentlyContinue).Matches[0].Groups[1].Value } catch {}
    Info "Dashboard: http://${ip}:${port}"

    try {
        $token = (Select-String -Path "$ProjectRoot\.env" -Pattern "^TELEGRAM_BOT_TOKEN=(.+)" -ErrorAction SilentlyContinue).Matches[0].Groups[1].Value
        if ($token -and $token -ne "your_token_from_botfather") { Ok "Telegram: configured" } else { Warn "Telegram: not configured" }
    } catch { Warn "Telegram: not configured" }

    try {
        $apiKey = (Select-String -Path "$ProjectRoot\.env" -Pattern "^ANTHROPIC_API_KEY=(.+)" -ErrorAction SilentlyContinue).Matches[0].Groups[1].Value
        if ($apiKey) { Info "AI backend: Anthropic API" } else { Info "AI backend: Claude subscription (CLI)" }
    } catch { Info "AI backend: Claude subscription (CLI)" }

    Write-Host ""
}

function Cmd-Upgrade {
    if (-not $ProjectRoot) { Fail "WildClaude not found. Run 'wildclaude install' first." }

    Write-Host ""
    Write-Host "  WildClaude - Upgrade" -ForegroundColor White
    Write-Host ""

    Set-Location $ProjectRoot

    $current = git rev-parse HEAD 2>$null
    git fetch origin master 2>$null
    $remote = git rev-parse origin/master 2>$null

    if ($current -eq $remote) { Ok "Already up to date."; return }

    Info "Updating..."

    $wasRunning = Test-Running
    if ($wasRunning) { Cmd-Stop; Start-Sleep -Seconds 1 }

    git pull origin master 2>&1 | Select-Object -Last 3
    Ok "Code updated"

    npm install 2>&1 | Select-Object -Last 1
    Ok "Dependencies updated"

    npm run build 2>&1 | Select-Object -Last 1
    Ok "Build complete"

    if ($wasRunning) { Cmd-Start }

    Write-Host ""
    Ok "Upgrade complete!"
}

function Cmd-Logs {
    $logFile = "$env:TEMP\wildclaude.log"
    if (Test-Path $logFile) {
        if ($Args -contains "-f" -or $Args -contains "--follow") {
            Get-Content $logFile -Tail 20 -Wait
        } else {
            Get-Content $logFile -Tail 50
        }
    } else {
        Warn "No logs found. Is WildClaude running?"
    }
}

function Cmd-Config {
    if (-not $ProjectRoot) { Fail "WildClaude not found." }
    notepad "$ProjectRoot\.env"
}

function Cmd-Reset {
    Write-Host ""
    Write-Host "  WildClaude - Reset" -ForegroundColor White
    Write-Host ""

    Write-Host "  This will delete all user data and re-run onboarding:" -ForegroundColor Yellow
    Write-Host "    - Life data, memories, personalities, sessions, config"
    Write-Host "  Secrets and database will be KEPT."
    Write-Host ""
    $confirm = Read-Host "  Continue? (yes/no)"
    if ($confirm -ne "yes") { Write-Host "  Cancelled."; return }

    if (Test-Running) { Cmd-Stop; Start-Sleep -Seconds 1 }

    Remove-Item -Recurse -Force "$DataDir\life" -ErrorAction SilentlyContinue
    Remove-Item -Recurse -Force "$DataDir\memories" -ErrorAction SilentlyContinue
    Remove-Item -Recurse -Force "$DataDir\personalities" -ErrorAction SilentlyContinue
    Remove-Item -Recurse -Force "$DataDir\session-handoffs" -ErrorAction SilentlyContinue
    Remove-Item -Force "$DataDir\config.json" -ErrorAction SilentlyContinue
    Remove-Item -Force "$DataDir\reflections.jsonl" -ErrorAction SilentlyContinue
    Remove-Item -Force "$DataDir\evolution.log.json" -ErrorAction SilentlyContinue
    Ok "User data reset"

    Write-Host "  Run 'wildclaude start' - onboarding will run again."
    Write-Host ""
}

function Cmd-Dashboard {
    $ip = Get-LocalIp
    $port = "3141"
    try { $port = (Select-String -Path "$ProjectRoot\.env" -Pattern "^DASHBOARD_PORT=(.+)" -ErrorAction SilentlyContinue).Matches[0].Groups[1].Value } catch {}
    Write-Host ""
    Write-Host "  Dashboard: http://${ip}:${port}"
    Write-Host "  Access from anywhere with Tailscale: https://tailscale.com"
    Write-Host ""
    Start-Process "http://${ip}:${port}" -ErrorAction SilentlyContinue
}

function Cmd-Dev {
    if (-not $ProjectRoot) { Fail "WildClaude not found." }
    Set-Location $ProjectRoot
    npm run dev
}

function Cmd-Build {
    if (-not $ProjectRoot) { Fail "WildClaude not found." }
    Set-Location $ProjectRoot
    npm run build
    Ok "Build complete"
}

function Cmd-Setup {
    if (-not $ProjectRoot) { Fail "Run this from the WildClaude project directory." }

    $source = "$ProjectRoot\wildclaude.cmd"
    if (-not (Test-Path $source)) { $source = "$ProjectRoot\wildclaude.ps1" }

    # Option 1: copy .cmd to a directory in PATH
    $targetDir = "$env:LOCALAPPDATA\Microsoft\WindowsApps"
    if (Test-Path $targetDir) {
        Copy-Item "$ProjectRoot\wildclaude.cmd" "$targetDir\wildclaude.cmd" -Force
        Copy-Item "$ProjectRoot\wildclaude.ps1" "$targetDir\wildclaude.ps1" -Force
        Ok "CLI installed globally: wildclaude"
        Info "Run 'wildclaude help' from anywhere"
        return
    }

    # Option 2: add project root to PATH
    $currentPath = [Environment]::GetEnvironmentVariable("Path", "User")
    if ($currentPath -notlike "*$ProjectRoot*") {
        [Environment]::SetEnvironmentVariable("Path", "$currentPath;$ProjectRoot", "User")
        $env:Path += ";$ProjectRoot"
        Ok "Added $ProjectRoot to PATH"
        Info "Restart your terminal, then run 'wildclaude help' from anywhere"
    } else {
        Ok "Already in PATH"
    }
}

function Cmd-Help {
    Write-Host ""
    Write-Host "  WildClaude CLI" -ForegroundColor White
    Write-Host ""
    Write-Host "  Usage: wildclaude <command> [options]"
    Write-Host ""
    Write-Host "  Setup" -ForegroundColor White
    Write-Host "    setup               Install CLI globally (adds 'wildclaude' to PATH)"
    Write-Host "    install [dir]       Clone and set up WildClaude"
    Write-Host "    uninstall           Remove WildClaude completely"
    Write-Host "    upgrade             Pull latest code, rebuild, restart"
    Write-Host "    reset               Reset user data (re-run onboarding)"
    Write-Host ""
    Write-Host "  Running" -ForegroundColor White
    Write-Host "    start               Start WildClaude"
    Write-Host "    stop                Stop WildClaude"
    Write-Host "    restart             Stop + start"
    Write-Host "    status              Show status, config, versions"
    Write-Host "    dev                 Start in development mode"
    Write-Host "    build               Rebuild TypeScript"
    Write-Host ""
    Write-Host "  System" -ForegroundColor White
    Write-Host "    logs [-f]           Show logs (-f to follow)"
    Write-Host "    config              Edit .env in notepad"
    Write-Host "    dashboard           Open dashboard in browser"
    Write-Host ""
    Write-Host "  Environment"
    Write-Host "    WILDCLAUDE_DIR      Override project directory"
    Write-Host "    WILD_DATA_DIR       Override user data directory"
    Write-Host ""
    Write-Host "  https://github.com/rsalvagio92/WildClaude"
    Write-Host ""
}

# ── Main ─────────────────────────────────────────────────────────────

switch ($Command) {
    "setup"     { Cmd-Setup }
    "install"   { Cmd-Install }
    "uninstall" { Cmd-Uninstall }
    "start"     { Cmd-Start }
    "stop"      { Cmd-Stop }
    "restart"   { Cmd-Restart }
    "status"    { Cmd-Status }
    { $_ -in "upgrade","update" } { Cmd-Upgrade }
    { $_ -in "logs","log" }       { Cmd-Logs }
    "config"    { Cmd-Config }
    "reset"     { Cmd-Reset }
    { $_ -in "dashboard","dash","ui" } { Cmd-Dashboard }
    "dev"       { Cmd-Dev }
    "build"     { Cmd-Build }
    { $_ -in "help","--help","-h" } { Cmd-Help }
    { $_ -in "version","--version","-v" } {
        if ($ProjectRoot) {
            node -e "console.log('WildClaude v' + require('$($ProjectRoot -replace '\\','/')/package.json').version)" 2>$null
        } else { Write-Host "WildClaude (not installed)" }
    }
    default {
        Write-Host "  Unknown command: $Command" -ForegroundColor Red
        Write-Host "  Run 'wildclaude help' for usage."
        exit 1
    }
}
