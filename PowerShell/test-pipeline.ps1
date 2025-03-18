[CmdletBinding()]
param (
    [Alias("m")]
    [string]$commitMessage = "WIP",

    [Alias("n")]
    [string]$name = "dotnet-docker-nightly-playground",

    [switch]$DebugMode
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version 2.0

function Write-Info {
    param ([string]$message)
    Write-Host "[Info] $message"
}

# Infer branch name. If it does not start with dev/, error out
$branchName = (git rev-parse --abbrev-ref HEAD).Trim()
Write-Info "Current branch: $branchName"
if ($branchName -notmatch "^dev/") {
    Write-Error "Branch name must start with 'dev/'"
    exit 1
}

$uncommittedChanges = $(git status --porcelain)?.Split("`n")
$untrackedFiles = $uncommittedChanges | Where-Object { $_ -match "^\?\?" }

# If there are any changes, commit them
if (-not $uncommittedChanges) {
    Write-Info "No uncommitted changes found."
} else {
    Write-Info "Unstaged changes found: $uncommittedChanges"
    Write-Host "Committing changes..."
    git commit -am $commitMessage

    if ($untrackedFiles.Count -gt 0) {
        Write-Info "There are untracked files in this repo. You may want to add them."
    }
}

$project = "internal"

Write-Host "Pushing changes..."
git push

Write-Host "Starting pipeline $name using branch $branchName"
$debugFlag = if ($DebugMode) { "--debug" } else { "" }
az pipelines run $debugFlag `
    --org "https://dev.azure.com/dnceng" `
    --project $project `
    --name $name `
    --branch $branchName `
    --open
