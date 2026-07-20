# PostToolUse hook: flag the graph as stale when a code file changes.
# Must be fast and silent - it runs after every edit. No rebuild happens here.
$ErrorActionPreference = 'SilentlyContinue'

try {
    $raw = [Console]::In.ReadToEnd()
    if (-not $raw) { exit 0 }
    $payload = $raw | ConvertFrom-Json

    $file = $payload.tool_input.file_path
    if (-not $file) { $file = $payload.tool_input.notebook_path }
    if (-not $file) { exit 0 }

    # Only code changes shift graph topology. Docs/config need semantic
    # re-extraction (an LLM pass), which this hook deliberately never triggers.
    $codeExt = @(
        '.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs', '.py', '.go', '.rs',
        '.java', '.kt', '.rb', '.php', '.cs', '.c', '.h', '.cpp', '.hpp',
        '.swift', '.scala', '.sh', '.sql', '.vue', '.svelte'
    )
    if ($codeExt -notcontains [IO.Path]::GetExtension($file).ToLower()) { exit 0 }

    $root = $env:CLAUDE_PROJECT_DIR
    if (-not $root) { $root = $payload.cwd }
    if (-not $root) { exit 0 }

    $outDir = Join-Path $root 'graphify-out'
    # No graph here means nothing to keep fresh - stay out of the way.
    if (-not (Test-Path (Join-Path $outDir 'graph.json'))) { exit 0 }

    Set-Content -Path (Join-Path $outDir '.graphify_dirty') -Value $file -Encoding utf8
} catch { }

exit 0
