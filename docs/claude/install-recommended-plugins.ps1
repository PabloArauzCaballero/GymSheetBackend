# Instalación del perfil mínimo recomendado de plugins de Claude Code.
#
# NO ejecutado automáticamente: requiere la CLI `claude` en el PATH (ausente en el
# entorno de auditoría) y, para algunos plugins, autenticación externa con permisos
# mínimos. Revisá cada plugin con `claude plugin details <plugin>@claude-plugins-official`
# antes de instalar. Ver docs/claude/plugin-selection-matrix.md.

# Prerrequisito del LSP de TypeScript (omitir si ya está o si la política prohíbe globales):
#   npm install -g typescript-language-server typescript
#   typescript-language-server --version

$plugins = @(
  "typescript-lsp",
  "code-simplifier",
  "security-guidance",
  "context7",
  "github",
  "skill-creator",
  "session-report",
  "redis-development"
)

foreach ($p in $plugins) {
  Write-Host "==> Revisar antes de instalar: $p"
  claude plugin details "$p@claude-plugins-official"
  # Descomentá para instalar tras la revisión:
  # claude plugin install "$p@claude-plugins-official" --scope user
}

# claude plugin list
# Dentro de Claude Code, aplicar sin reiniciar:  /reload-plugins
