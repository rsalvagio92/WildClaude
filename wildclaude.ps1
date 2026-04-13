# WildClaude CLI — Windows entry point
# Run from project root: .\wildclaude <command>
# Or install globally: see wildclaude setup

$env:WILDCLAUDE_DIR = $PSScriptRoot
& "$PSScriptRoot\scripts\wildclaude.ps1" @args
