#!/bin/zsh

# ==============================================================================
# DineFlow - One-Click Shutdown for macOS
# ==============================================================================

cd "$(dirname "$0")"

# Set window title
echo -ne "\033]0;DineFlow Shutdown\007"

RED='\033[0;31m'
GREEN='\033[0;32m'
BLUE='\033[0;34m'
YELLOW='\033[1;33m'
BOLD='\033[1m'
NC='\033[0m'

clear
echo "${BLUE}${BOLD}================================================================${NC}"
echo "${RED}${BOLD}                 DINEFLOW SYSTEM SHUTDOWN                       ${NC}"
echo "${BLUE}${BOLD}================================================================${NC}"
echo ""

export PATH="/Users/jeevanriship/.local/bin:/opt/homebrew/bin:/opt/homebrew/sbin:/usr/local/bin:$HOME/.local/bin:$PATH"

echo "${YELLOW}🛑 Stopping Docker containers (Postgres, Redis, Mailpit)...${NC}"
docker compose -f infra/docker/docker-compose.dev.yml down

echo ""
echo "${GREEN}✅ All DineFlow Docker containers stopped.${NC}"
echo ""
echo "${BLUE}================================================================${NC}"
echo "You can close this window now."
sleep 2
exit 0
