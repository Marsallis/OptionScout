#!/usr/bin/env sh
# Prepare a local OptionScout checkout. Does not create a shared password,
# does not read an existing database, and does not start a market scan.
set -eu

ROOT=$(CDPATH= cd -- "$(dirname "$0")/.." && pwd)
cd "$ROOT"

fail() {
  printf '\nSetup stopped: %s\n' "$1" >&2
  exit 1
}

command -v docker >/dev/null 2>&1 || fail "Docker was not found. Install Docker and run this script again."
docker compose version >/dev/null 2>&1 || fail "Docker Compose v2 is not available. Install the Compose plugin and run this script again."

EXAMPLE="$ROOT/secrets.example/tastytrade.env.example"
DEST="$ROOT/secrets/tastytrade.env"
[ -f "$EXAMPLE" ] || fail "The blank template secrets.example/tastytrade.env.example is missing."

if [ -f "$DEST" ]; then
  printf 'secrets/tastytrade.env already exists. It was left unchanged.\n'
else
  mkdir -p "$ROOT/secrets"
  cp "$EXAMPLE" "$DEST"
  printf 'Created secrets/tastytrade.env from the blank template. Leave it blank for the demo.\n'
fi

START=0
while [ $# -gt 0 ]; do
  case "$1" in
    --start) START=1 ;;
    --port)
      shift
      [ $# -gt 0 ] || fail "Missing value after --port."
      OPTIONSCOUT_PORT=$1
      export OPTIONSCOUT_PORT
      ;;
    --container)
      shift
      [ $# -gt 0 ] || fail "Missing value after --container."
      OPTIONSCOUT_CONTAINER=$1
      export OPTIONSCOUT_CONTAINER
      ;;
    --project)
      shift
      [ $# -gt 0 ] || fail "Missing value after --project."
      COMPOSE_PROJECT_NAME=$1
      export COMPOSE_PROJECT_NAME
      ;;
    *) fail "Unknown option: $1" ;;
  esac
  shift
done

PORT=${OPTIONSCOUT_PORT:-3180}
CONTAINER=${OPTIONSCOUT_CONTAINER:-optionscout}

printf '\nOptionScout is ready to start.\n'
printf 'Demo mode does not need tastytrade credentials.\n'
printf 'The published address will be http://127.0.0.1:%s\n\n' "$PORT"
printf 'Start now with:\n  sh scripts/setup.sh --start\n'
printf 'Or start later with:\n  docker compose up -d --build\n\n'
printf 'The simulated Overview does not need a passphrase.\n'
printf 'A passphrase is required for saved rules, bookmarks, and searches unless you set PUBLIC_SIMULATED_DEMO=true.\n'
printf 'That flag serves only the simulated book, allows a DEMO search without sign-in, and still refuses orders and broker changes.\n'
printf 'When you want a passphrase, use 12 or more characters. The prompt is masked. Do not put it in a file or on the command line.\n'
printf '  docker exec -it %s node apps/api/dist/owner-setup.js\n\n' "$CONTAINER"
printf 'Then open http://127.0.0.1:%s\n' "$PORT"

if [ "$START" -eq 1 ]; then
  docker compose up -d --build || fail "Docker Compose did not start OptionScout. Run 'docker compose logs optionscout' in this directory."
fi
