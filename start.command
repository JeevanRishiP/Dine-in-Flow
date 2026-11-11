#!/bin/zsh

# ==============================================================================
# DineFlow - One-Click Launcher for macOS
# ==============================================================================

# Ensure Terminal runs from the directory where this script lives
cd "$(dirname "$0")"

# Set window title
echo -ne "\033]0;DineFlow Launcher\007"

# Color codes for terminal output
GREEN='\033[0;32m'
BLUE='\033[0;34m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
RED='\033[0;31m'
BOLD='\033[1m'
NC='\033[0m'

clear
echo "${BLUE}${BOLD}================================================================${NC}"
echo "${CYAN}${BOLD}                 DINEFLOW SYSTEM LAUNCHER                       ${NC}"
echo "${BLUE}${BOLD}================================================================${NC}"
echo ""

# 1. Ensure Node, pnpm, and Docker are in PATH
export PATH="/Users/jeevanriship/.local/bin:/opt/homebrew/bin:/opt/homebrew/sbin:/usr/local/bin:$HOME/.local/bin:$PATH"
[ -f "$HOME/.zprofile" ] && source "$HOME/.zprofile" 2>/dev/null
[ -f "$HOME/.zshrc" ] && source "$HOME/.zshrc" 2>/dev/null

# 2. Check for pnpm
if ! command -v pnpm &> /dev/null; then
  echo "${RED}❌ 'pnpm' was not found in your PATH.${NC}"
  echo "Please install or enable it with: corepack enable"
  echo ""
  read -k 1 "?Press any key to exit..."
  exit 1
fi

# 3. Check and start Docker Desktop
echo "${BLUE}🔍 Checking Docker status...${NC}"
if ! docker info >/dev/null 2>&1; then
  echo "${YELLOW}🐳 Docker is not running. Launching Docker Desktop...${NC}"
  open -a Docker
  
  echo -n "${YELLOW}⏳ Waiting for Docker daemon to become ready${NC}"
  MAX_RETRIES=45
  COUNT=0
  until docker info >/dev/null 2>&1 || [ $COUNT -ge $MAX_RETRIES ]; do
    echo -n "."
    sleep 2
    COUNT=$((COUNT + 1))
  done
  echo ""

  if ! docker info >/dev/null 2>&1; then
    echo "${RED}❌ Docker did not start in time. Please start Docker Desktop manually and retry.${NC}"
    echo ""
    read -k 1 "?Press any key to exit..."
    exit 1
  fi
fi
echo "${GREEN}✅ Docker is active!${NC}"
echo ""

# 4. Check for .env.local
if [ ! -f .env.local ]; then
  echo "${YELLOW}⚙️  .env.local not found. Creating from .env.example...${NC}"
  cp .env.example .env.local
  echo "${GREEN}✅ .env.local created.${NC}"
  echo ""
fi

# 5. Check if node_modules exist
if [ ! -d "node_modules" ]; then
  echo "${YELLOW}📦 node_modules missing. Installing dependencies with pnpm...${NC}"
  pnpm install
  echo "${GREEN}✅ Dependencies installed.${NC}"
  echo ""
fi

# 6. Start Docker background infrastructure
echo "${BLUE}🚀 Starting database & cache services (Postgres, Redis, Mailpit)...${NC}"
docker compose -f infra/docker/docker-compose.dev.yml up -d

# Wait for Postgres to be ready for queries
echo -n "${YELLOW}⏳ Waiting for PostgreSQL database to be healthy${NC}"
COUNT=0
until docker exec dineflow_postgres pg_isready -U postgres >/dev/null 2>&1 || [ $COUNT -ge 20 ]; do
  echo -n "."
  sleep 1
  COUNT=$((COUNT + 1))
done
echo ""
echo "${GREEN}✅ PostgreSQL is ready!${NC}"
echo ""

# 7. Run database migrations & seed pilot data
echo "${BLUE}🔄 Ensuring database schema and seeds are up to date...${NC}"
pnpm db:migrate
pnpm seed:pilot
echo "${GREEN}✅ Database is ready!${NC}"
echo ""

# 8. Display links
echo "${BLUE}${BOLD}================================================================${NC}"
echo "${GREEN}${BOLD} All services ready! Starting web and API development servers...${NC}"
echo "${BLUE}${BOLD}================================================================${NC}"
echo ""
echo "  📱 ${BOLD}Customer Web App:${NC}      ${CYAN}http://localhost:3003${NC}"
echo "  💻 ${BOLD}Staff/Owner Console:${NC}   ${CYAN}http://localhost:3004${NC}"
echo "  🔌 ${BOLD}Backend API Docs:${NC}      ${CYAN}http://localhost:3000/v1/docs${NC}"
echo "  📬 ${BOLD}Mailpit (Mock Emails):${NC} ${CYAN}http://localhost:8025${NC}"
echo ""
echo "  ${YELLOW}Press Ctrl+C at any time in this window to stop the servers.${NC}"
echo "${BLUE}================================================================${NC}"
echo ""

# 9. Start Turbo dev server (handles API, customer-web, console-web concurrently)
pnpm dev
