# Prepare a local OptionScout checkout. Does not create a shared password,
# does not read an existing database, and does not start a market scan.
param(
  [switch]$Start,
  [int]$Port = 0,
  [string]$Container = "",
  [string]$Project = ""
)

$ErrorActionPreference = "Stop"
$Root = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
Set-Location $Root

function Fail([string]$Message) {
  Write-Host ""
  Write-Host "Setup stopped: $Message" -ForegroundColor Red
  exit 1
}

if (-not (Get-Command docker -ErrorAction SilentlyContinue)) {
  Fail "Docker was not found. Install Docker Desktop, start it, and run this script again."
}

try {
  docker compose version | Out-Null
} catch {
  Fail "Docker Compose v2 is not available. Install Docker Desktop, or the Compose plugin, and run this script again."
}

$example = Join-Path $Root "secrets.example\tastytrade.env.example"
$destination = Join-Path $Root "secrets\tastytrade.env"
if (-not (Test-Path $example)) {
  Fail "The blank template secrets.example\tastytrade.env.example is missing."
}

if (Test-Path $destination) {
  Write-Host "secrets/tastytrade.env already exists. It was left unchanged."
} else {
  New-Item -ItemType Directory -Force -Path (Split-Path $destination) | Out-Null
  Copy-Item $example $destination
  Write-Host "Created secrets/tastytrade.env from the blank template. Leave it blank for the demo."
}

if ($Port -gt 0) { $env:OPTIONSCOUT_PORT = "$Port" }
if ($Container -ne "") { $env:OPTIONSCOUT_CONTAINER = $Container }
if ($Project -ne "") { $env:COMPOSE_PROJECT_NAME = $Project }

$publishedPort = if ($env:OPTIONSCOUT_PORT) { $env:OPTIONSCOUT_PORT } else { "3180" }

Write-Host ""
Write-Host "OptionScout is ready to start."
Write-Host "Demo mode does not need tastytrade credentials."
Write-Host "The published address will be http://127.0.0.1:$publishedPort"
Write-Host ""
Write-Host "Start:"
Write-Host "  docker compose up -d --build"
Write-Host ""
Write-Host "After the container is healthy, create your own passphrase (12 or more characters)."
Write-Host "The prompt is masked. Do not put the passphrase in a file or on the command line."
Write-Host "  docker compose exec -it optionscout node apps/api/dist/owner-setup.js"
Write-Host ""
Write-Host "Then open http://127.0.0.1:$publishedPort and sign in on Broker & Data."

if ($Start) {
  docker compose up -d --build
  if ($LASTEXITCODE -ne 0) {
    Fail "Docker Compose did not start OptionScout. Run 'docker compose logs optionscout' in this directory."
  }
}
