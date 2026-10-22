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
if (-not $taskDockerExe) { throw 'Docker Desktop was not found. Install Docker Desktop, then run this script again.' }

$taskSettingsPath = Join-Path $PSScriptRoot '.env'
if (-not (Test-Path -LiteralPath $taskSettingsPath)) {
    $taskRandom = [System.Security.Cryptography.RandomNumberGenerator]::Create()
    try {
        $taskBytes = New-Object byte[] 32
        $taskRandom.GetBytes($taskBytes)
        $taskPassword = [BitConverter]::ToString($taskBytes).Replace('-', '').ToLowerInvariant()
        Set-Content -LiteralPath $taskSettingsPath -Value "POSTGRES_PASSWORD=$taskPassword`nPOSTGRES_PORT=5432" -Encoding ascii
    } finally { $taskRandom.Dispose() }
    Write-Output 'Created ignored local database settings with a generated password.'
}

function Test-TaskDockerReady {
    try {
        $null = & $taskDockerExe info --format '{{.ServerVersion}}' 2>$null
        return $LASTEXITCODE -eq 0
    } catch { return $false }
}

if (-not (Test-TaskDockerReady)) {
    $taskDesktopCandidates = @(
        (Join-Path $env:LOCALAPPDATA 'Programs\DockerDesktop\Docker Desktop.exe'),
        (Join-Path $env:ProgramFiles 'Docker\Docker\Docker Desktop.exe')
    )
    $taskDesktopExe = $taskDesktopCandidates | Where-Object { Test-Path -LiteralPath $_ } | Select-Object -First 1
    if ($taskDesktopExe) {
        Start-Process -FilePath $taskDesktopExe -WindowStyle Hidden
        Write-Output 'Waiting for Docker Desktop...'
    }
    $taskDeadline = (Get-Date).AddSeconds($WaitSeconds)
    while (-not (Test-TaskDockerReady)) {
        if ((Get-Date) -ge $taskDeadline) { throw 'Docker Engine is not ready. Check Docker Desktop for a setup or WSL prompt, then run this script again.' }
        Start-Sleep -Seconds 2
    }
}

$taskComposePath = Join-Path $taskProjectRoot 'docker-compose.postgres.yml'
& $taskDockerExe compose --env-file $taskSettingsPath -f $taskComposePath config --quiet
if ($LASTEXITCODE -ne 0) { throw 'Invalid local PostgreSQL configuration.' }
& $taskDockerExe compose --env-file $taskSettingsPath -f $taskComposePath up -d --wait --wait-timeout $WaitSeconds
if ($LASTEXITCODE -ne 0) { throw 'PostgreSQL did not become healthy. Check Docker Desktop and the Compose service status.' }
& node (Join-Path $taskProjectRoot 'server\scripts\checkPostgres.mjs')
if ($LASTEXITCODE -ne 0) { throw 'The database connection or pgvector check failed.' }
