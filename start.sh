#!/usr/bin/env bash
# ==============================================================================
# Vishrea Studio - Self-Hosted Bootstrap & Startup Script (Linux / macOS / VPS)
# ==============================================================================

set -e

echo ""
echo "=========================================================="
echo "      Vishrea Studio - Self-Hosted Launcher (Linux/VPS)   "
echo "=========================================================="
echo ""

# 1. Check if .env file exists; create from .env.example if missing
if [ ! -f .env ]; then
  echo "[!] .env file not found. Initializing from .env.example..."
  if [ -f .env.example ]; then
    cp .env.example .env
    echo "[✓] Created .env with default values."
  else
    cat <<EOF > .env
PORT=3000
NODE_ENV=development
JWT_SECRET=$(node -e "console.log(require('crypto').randomBytes(48).toString('hex'))")
DEFAULT_ADMIN_EMAIL=
DATABASE_URL=postgresql://postgres:postgres@localhost:5432/vishrea
DATABASE_SSL=false
RAZORPAY_KEY_ID=
RAZORPAY_KEY_SECRET=
OPENAI_API_KEY=
OPENAI_BASE_URL=https://api.openai.com/v1
AI_MODEL=gpt-4o-mini
EOF
    echo "[✓] Generated fresh .env file."
  fi
fi

# 2. Check Node.js and NPM
if ! command -v node &> /dev/null; then
  echo "[✗] Node.js is not installed. Please install Node.js (v18+) to run locally."
  exit 1
fi

echo "[✓] Node.js $(node -v) detected."

# 3. Check and install dependencies
if [ ! -d "node_modules" ] || [ package.json -nt node_modules ]; then
  echo "[*] Installing dependencies (npm install)..."
  npm install
else
  echo "[✓] Dependencies are up to date."
fi

# 4. Check React Client Build
if [ ! -f "vishrea-react/dist/index.html" ]; then
  echo "[*] Building React frontend (vishrea-react)..."
  (cd vishrea-react && [ ! -d "node_modules" ] && npm install; npm run build)
  echo "[✓] React production bundle built."
else
  echo "[✓] React production bundle verified."
fi

# 5. Run database migrations
echo "[*] Verifying database connectivity and executing migrations..."
if npm run migrate; then
  echo "[✓] Database migrations completed."
else
  echo "[!] Database migration returned an error. Ensure PostgreSQL is running."
  echo "    Tip: If using Docker, run: docker compose up -d db"
fi

# 6. Boot Application
echo ""
echo "[✓] Starting Vishrea Studio server..."
echo "    React Storefront: http://localhost:${PORT:-3000}"
echo "    React Admin:      http://localhost:${PORT:-3000}/admin"
echo ""
npm start
