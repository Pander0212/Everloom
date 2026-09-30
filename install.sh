#!/usr/bin/env bash
# Everloom one-time installer for a Linux VPS. Run from the repo folder: bash install.sh
set -euo pipefail
cd "$(dirname "$0")"

bold() { printf '\033[1m%s\033[0m\n' "$*"; }
warn() { printf '\033[33m%s\033[0m\n' "$*"; }
die() { printf '\033[31m%s\033[0m\n' "$*" >&2; exit 1; }

SUDO=""
if [ "$(id -u)" -ne 0 ]; then
  command -v sudo >/dev/null || die "Run as root or install sudo."
  SUDO="sudo"
fi

bold "Everloom installer"

# 1. Docker
if ! command -v docker >/dev/null 2>&1; then
  bold "Installing Docker…"
  curl -fsSL https://get.docker.com | $SUDO sh
fi
if ! docker compose version >/dev/null 2>&1; then
  die "Docker Compose v2 is missing. Install the docker-compose-plugin package and re-run."
fi
DOCKER="docker"
if ! docker info >/dev/null 2>&1; then DOCKER="$SUDO docker"; fi

# 2. Ports
for p in 80 443; do
  if (ss -ltn 2>/dev/null || netstat -ltn 2>/dev/null) | grep -qE "[:.]$p\s"; then
    warn "Port $p is already in use. Caddy needs ports 80 and 443 (stop the other web server, or see README → Non-Docker install)."
  fi
done

# 3. Domain or IP
if [ -f .env ]; then
  warn ".env already exists — keeping it. Delete it to reconfigure."
else
  echo
  echo "Enter the domain that points to this server (e.g. rp.example.com)."
  echo "Leave empty to use IP-only mode (self-signed certificate, browser warning)."
  read -r -p "Domain: " DOMAIN
  TLS=""
  if [ -z "$DOMAIN" ]; then
    DOMAIN="$(curl -fsS https://api.ipify.org || hostname -I | awk '{print $1}')"
    TLS="tls internal"
    warn "IP-only mode on https://$DOMAIN"
    warn "Your browser will warn about the certificate. You must accept it once."
    warn "Installing the app to the home screen works best with a real domain."
  else
    echo "Make sure an A record for $DOMAIN points to this server's IP before continuing."
  fi
  KEY="$(openssl rand -hex 32 2>/dev/null || head -c 32 /dev/urandom | od -An -tx1 | tr -d ' \n')"
  ST=""
  for d in "$HOME/SillyTavern/data" "/root/SillyTavern/data" "/opt/SillyTavern/data" "/home/*/SillyTavern/data"; do
    for m in $d; do [ -d "$m" ] && ST="$m" && break 2; done
  done
  cat > .env <<ENV
EVERLOOM_DOMAIN=$DOMAIN
EVERLOOM_TLS=$TLS
EVERLOOM_SECRET_KEY=$KEY
EVERLOOM_SECURE_COOKIES=1
EVERLOOM_TRUST_PROXY=1
SILLYTAVERN_DIR=$ST
LOG_LEVEL=warn
ENV
  chmod 600 .env
  [ -n "$ST" ] && echo "Found SillyTavern data at $ST — it will be available read-only for the import tool at /import/sillytavern."
  bold "Wrote .env (keep it safe: EVERLOOM_SECRET_KEY decrypts your stored API keys)."
fi

mkdir -p data data/empty-st
# The container runs as uid 10001.
$SUDO chown -R 10001:10001 data 2>/dev/null || true

# 4. Build and start
bold "Building and starting (first build takes a few minutes)…"
$DOCKER compose build --build-arg EVERLOOM_COMMIT="$(git rev-parse --short HEAD 2>/dev/null || true)" everloom
$DOCKER compose up -d

# 5. Wait for health
echo -n "Waiting for Everloom"
for i in $(seq 1 60); do
  if $DOCKER compose exec -T everloom curl -fsS http://127.0.0.1:8787/api/health >/dev/null 2>&1; then echo; break; fi
  echo -n "."; sleep 2
done

# 6. Nightly host-side backup copy (in addition to the app's own nightly backup)
if command -v crontab >/dev/null 2>&1 && ! crontab -l 2>/dev/null | grep -q "everloom/backup.sh"; then
  (crontab -l 2>/dev/null; echo "30 4 * * * cd $(pwd) && bash backup.sh >/dev/null 2>&1 # everloom/backup.sh") | crontab - || true
fi

DOMAIN_NOW="$(grep '^EVERLOOM_DOMAIN=' .env | cut -d= -f2)"
echo
bold "Done. Open https://$DOMAIN_NOW on your phone and create your account."
echo "Tip: in Safari/Chrome use “Add to Home Screen” to install the app."
