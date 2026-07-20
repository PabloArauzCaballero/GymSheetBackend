# Stop hook: if code changed this turn, rebuild the graph ONCE, detached.
# `graphify update` is pure AST work - no LLM, so this costs zero tokens.
# Launched detached because a rebuild takes ~12s and must not delay the turn.
$ErrorActionPreference = 'SilentlyContinue'

try {
    [Console]::In.ReadToEnd() | Out-Null

    $root = $env:CLAUDE_PROJECT_DIR
    if (-not $root) { $root = (Get-Location).Path }

    $outDir = Join-Path $root 'graphify-out'
    $dirty  = Join-Path $outDir '.graphify_dirty'
    if (-not (Test-Path $dirty)) { exit 0 }

    # A rebuild is already in flight - it will pick up these edits too.
    $lock = Join-Path $outDir '.graphify_rebuild.lock'
    if (Test-Path $lock) {
        $age = (Get-Date) - (Get-Item $lock).LastWriteTime
        if ($age.TotalMinutes -lt 10) { exit 0 }   # stale lock past 10min
    }

    Remove-Item $dirty -Force

    $python = 'python'
    $pin = Join-Path $outDir '.graphify_python'
    if (Test-Path $pin) {
        $pinned = (Get-Content $pin -Raw).Trim()
        if ($pinned -and (Test-Path $pinned)) { $python = $pinned }
    }

    $log = Join-Path $outDir '.graphify_hook.log'
    # Lock is created by the child and removed on exit, so a crashed rebuild
    # cannot wedge the hook permanently (the 10min staleness check covers it).
    $inner = "New-Item -ItemType File -Path '$lock' -Force | Out-Null; " +
             "try { & '$python' -m graphify update '$root' *> '$log' } " +
             "finally { Remove-Item '$lock' -Force -ErrorAction SilentlyContinue }"

    Start-Process powershell `
        -ArgumentList '-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', $inner `
        -WindowStyle Hidden
} catch { }

exit 0
