param([ValidateRange(10, 600)][int]$WaitSeconds = 120)
$ErrorActionPreference = 'Stop'
$taskProjectRoot = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot '..\..')).Path
$taskDockerCommand = Get-Command docker -ErrorAction SilentlyContinue
$taskDockerCandidates = @(
    (Join-Path $env:LOCALAPPDATA 'Programs\DockerDesktop\resources\bin\docker.exe'),
    (Join-Path $env:ProgramFiles 'Docker\Docker\resources\bin\docker.exe')
)
$taskDockerExe = if ($taskDockerCommand) { $taskDockerCommand.Source } else {
    $taskDockerCandidates | Where-Object { Test-Path -LiteralPath $_ } | Select-Object -First 1
}
if (-not $taskDockerExe) { throw 'Docker Desktop was not found.' }
$taskComposePath = Join-Path $taskProjectRoot 'docker-compose.embeddings.yml'
& $taskDockerExe compose -f $taskComposePath up -d --wait --wait-timeout $WaitSeconds
if ($LASTEXITCODE -ne 0) { throw 'Start Docker Desktop and check the embeddings service.' }
$taskHasModel = $false
try {
    $null = & $taskDockerExe compose -f $taskComposePath exec -T embeddings ollama show bge-m3 2>$null
    $taskHasModel = $LASTEXITCODE -eq 0
} catch { $taskHasModel = $false }
if (-not $taskHasModel) {
    & $taskDockerExe compose -f $taskComposePath exec -T embeddings ollama pull bge-m3
    if ($LASTEXITCODE -ne 0) { throw 'bge-m3 download failed. Rerun this script to resume the download.' }
} else { Write-Output 'Using the existing local bge-m3 model; no download needed.' }
& node (Join-Path $taskProjectRoot 'server/scripts/configureLocalEmbedding.mjs')
if ($LASTEXITCODE -ne 0) { throw 'Local embedding configuration was not changed.' }
& node (Join-Path $taskProjectRoot 'server/scripts/checkEmbedding.mjs')
if ($LASTEXITCODE -ne 0) { throw 'Local embedding check failed.' }
