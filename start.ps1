# ==============================================================================
# Vishrea Studio - Self-Hosted Bootstrap & Startup Script (Windows PowerShell)
# ==============================================================================

Write-Host ""
Write-Host "==========================================================" -ForegroundColor Cyan
Write-Host "      Vishrea Studio - Self-Hosted Launcher (Windows)     " -ForegroundColor Cyan
Write-Host "==========================================================" -ForegroundColor Cyan
Write-Host ""

# 1. Check if .env exists
if (-not (Test-Path ".env")) {
    Write-Host "[!] .env file not found. Initializing from .env.example..." -ForegroundColor Yellow
    if (Test-Path ".env.example") {
        Copy-Item ".env.example" ".env"
        Write-Host "[OK] Created .env with default values." -ForegroundColor Green
    } else {
        $bytes = New-Object byte[] 48
        [System.Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($bytes)
        $jwt = ($bytes | ForEach-Object { $_.ToString('x2') }) -join ''
        Set-Content -Path ".env" -Value "PORT=3000`nNODE_ENV=development`nJWT_SECRET=$jwt`nDEFAULT_ADMIN_EMAIL=`nDATABASE_URL=postgresql://postgres:postgres@localhost:5432/vishrea`nDATABASE_SSL=false`nRAZORPAY_KEY_ID=`nRAZORPAY_KEY_SECRET=`nOPENAI_API_KEY=`nOPENAI_BASE_URL=https://api.openai.com/v1`nAI_MODEL=gpt-4o-mini"
        Write-Host "[OK] Generated fresh .env file with a random JWT_SECRET." -ForegroundColor Green
    }
}
if (Select-String -Path ".env" -Pattern '^JWT_SECRET=\s*$' -Quiet) {
    Write-Host "[!] JWT_SECRET is empty in .env. Generate one with:" -ForegroundColor Yellow
    Write-Host "    node -e ""console.log(require('crypto').randomBytes(48).toString('hex'))""" -ForegroundColor Yellow
}

# 2. Check Node.js
if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
    $userPath = [Environment]::GetEnvironmentVariable('Path', 'User')
    $sysPath = [Environment]::GetEnvironmentVariable('Path', 'Machine')
    $env:PATH = "$userPath;$sysPath;$env:PATH"
}
try {
    $nodeVer = node -v
    Write-Host "[OK] Node.js $nodeVer detected." -ForegroundColor Green
} catch {
    Write-Host "[ERROR] Node.js is not found in PATH. Please install Node.js (v18+) to proceed." -ForegroundColor Red
    exit 1
}

# 3. Install dependencies
if (-not (Test-Path "node_modules")) {
    Write-Host "[*] Installing dependencies (npm install)..." -ForegroundColor Yellow
    npm install
} else {
    Write-Host "[OK] Node modules verified." -ForegroundColor Green
}

# 4. Check React Client Build
if (-not (Test-Path "vishrea-react\dist\index.html")) {
    Write-Host "[*] Building React frontend (vishrea-react)..." -ForegroundColor Yellow
    Push-Location "vishrea-react"
    if (-not (Test-Path "node_modules")) {
        npm install
    }
    npm run build
    Pop-Location
    Write-Host "[OK] React production bundle built." -ForegroundColor Green
} else {
    Write-Host "[OK] React production bundle verified." -ForegroundColor Green
}

# 5. Run migrations
Write-Host "[*] Running database migrations..." -ForegroundColor Yellow
& node scripts/migrate.js
if ($LASTEXITCODE -ne 0) {
    Write-Host "[WARN] Database migration note: could not connect or apply with current credentials." -ForegroundColor Yellow
    Write-Host "       Please verify your DATABASE_URL in .env (e.g. your local postgres password)." -ForegroundColor Yellow
} else {
    Write-Host "[OK] Database migrations completed." -ForegroundColor Green
}

# 6. Boot application
Write-Host ""
Write-Host "[OK] Starting Vishrea Studio server..." -ForegroundColor Green
Write-Host "    React Storefront: http://localhost:3000" -ForegroundColor Cyan
Write-Host "    React Admin:      http://localhost:3000/admin" -ForegroundColor Cyan
Write-Host ""

npm start
