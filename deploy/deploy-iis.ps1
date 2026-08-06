#Requires -Version 5.1
<#
.SYNOPSIS
    Build + deploy Tạp Hóa POS lên IIS site ipos123.vn (Windows Server).

.DESCRIPTION
    Server production chạy Windows + IIS, KHÔNG phải Docker/Caddy như
    HOSTING.md giả định. Script này thay thế deploy-prod.sh cho môi trường đó.

    Chạy được bằng user thường (không cần Administrator) — chỉ ghi file vào
    thư mục site. Việc tạo site/binding/cert cần admin, xem setup-iis-site.ps1
    (chỉ chạy MỘT lần).

.PARAMETER SiteRoot
    Thư mục gốc của IIS site. Mặc định theo quy ước server: D:\Hosting\_iis_sites\<domain>

.PARAMETER SkipBuild
    Bỏ qua npm run build, chỉ copy dist hiện có lên site.

.EXAMPLE
    .\deploy\deploy-iis.ps1
    .\deploy\deploy-iis.ps1 -SkipBuild
#>
[CmdletBinding()]
param(
    [string]$SiteRoot = 'D:\Hosting\_iis_sites\ipos123.vn',
    [switch]$SkipBuild
)

$ErrorActionPreference = 'Stop'
$ProjectRoot = Split-Path -Parent $PSScriptRoot
$DistDir = Join-Path $ProjectRoot 'dist'

Write-Host "=== Deploy Tạp Hóa POS → $SiteRoot ===" -ForegroundColor Cyan
Write-Host "Project: $ProjectRoot"

# --- [1/5] Kiểm tra env trước khi build -------------------------------------
# Vite inline VITE_* vào bundle LÚC BUILD. Thiếu là app throw ngay khi load
# (src/integrations/supabase.ts), ra trang trắng — nên chặn từ đây.
Write-Host "`n[1/5] Kiểm tra biến môi trường..." -ForegroundColor Yellow

$envFile = Join-Path $ProjectRoot '.env.local'
if (-not (Test-Path $envFile)) {
    throw "Thiếu .env.local. Copy .env.example → .env.local và điền VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY."
}
$envText = Get-Content $envFile -Raw
foreach ($key in 'VITE_SUPABASE_URL', 'VITE_SUPABASE_ANON_KEY') {
    if ($envText -notmatch "(?m)^\s*$key\s*=\s*\S+") {
        throw "Thiếu $key trong .env.local — build ra sẽ là app trắng màn hình."
    }
}
Write-Host "  OK"

# --- [2/5] Build ------------------------------------------------------------
if ($SkipBuild) {
    Write-Host "`n[2/5] Bỏ qua build (-SkipBuild)" -ForegroundColor Yellow
} else {
    Write-Host "`n[2/5] npm run build..." -ForegroundColor Yellow
    Push-Location $ProjectRoot
    try {
        & npm run build
        if ($LASTEXITCODE -ne 0) { throw "npm run build fail (exit $LASTEXITCODE)" }
    } finally {
        Pop-Location
    }
}

# --- [3/5] Nghiệm thu bundle ------------------------------------------------
Write-Host "`n[3/5] Kiểm tra bundle..." -ForegroundColor Yellow

if (-not (Test-Path (Join-Path $DistDir 'index.html'))) {
    throw "Không thấy dist\index.html — build chưa xong hoặc đã fail."
}

# Xác nhận Supabase URL thực sự nằm trong bundle, không chỉ tin vào .env.local
$supaHit = Select-String -Path (Join-Path $DistDir 'assets\*.js') `
    -Pattern 'supabase\.co' -List -ErrorAction SilentlyContinue
if (-not $supaHit) {
    throw "Bundle không chứa Supabase URL — biến VITE_* không được inline. Kiểm tra .env.local rồi build lại."
}
Write-Host "  index.html + Supabase config: OK"

# Chốt chặn hồi quy: PWA từng hỏng âm thầm suốt thời gian dài vì build vẫn
# pass khi service worker bị tắt. Không có sw.js = mất bán hàng offline.
foreach ($pwaFile in 'sw.js', 'manifest.webmanifest') {
    if (-not (Test-Path (Join-Path $DistDir $pwaFile))) {
        Write-Host "  CẢNH BÁO: thiếu $pwaFile — PWA hỏng." -ForegroundColor Red
        Write-Host "  App sẽ KHÔNG bán được khi mất mạng và KHÔNG cài được vào" -ForegroundColor Red
        Write-Host "  màn hình chính. Kiểm tra strategies:'injectManifest' trong" -ForegroundColor Red
        Write-Host "  vite.config.ts. Xem docs/DOMAIN_SETUP.md mục 'PWA — đã fix'." -ForegroundColor Red
    }
}
if ((Test-Path (Join-Path $DistDir 'sw.js')) -and (Test-Path (Join-Path $DistDir 'manifest.webmanifest'))) {
    Write-Host "  Service worker + manifest: OK"
}

# --- [4/5] Đồng bộ lên site -------------------------------------------------
Write-Host "`n[4/5] Copy lên $SiteRoot..." -ForegroundColor Yellow

if (-not (Test-Path $SiteRoot)) {
    New-Item -ItemType Directory -Path $SiteRoot -Force | Out-Null
    Write-Host "  Đã tạo thư mục site"
}

# /MIR để xoá file cũ của bản build trước (tên file có hash, không xoá thì rác
# tích tụ). /XF web.config /XD .well-known để không đụng cấu hình + cert challenge.
$rc = robocopy $DistDir $SiteRoot /MIR /NFL /NDL /NJH /NJS /NP /R:2 /W:2 /XF web.config /XD .well-known
if ($LASTEXITCODE -ge 8) {
    throw "robocopy fail (exit $LASTEXITCODE)"
}
$global:LASTEXITCODE = 0
Write-Host "  Đã đồng bộ dist"

# web.config quản lý trong git, luôn ghi đè từ deploy/
Copy-Item (Join-Path $PSScriptRoot 'web.config') (Join-Path $SiteRoot 'web.config') -Force
Write-Host "  Đã cập nhật web.config"

# Thư mục cho ACME HTTP-01 challenge (win-acme / Certify The Web)
$acmeDir = Join-Path $SiteRoot '.well-known\acme-challenge'
if (-not (Test-Path $acmeDir)) {
    New-Item -ItemType Directory -Path $acmeDir -Force | Out-Null
}
# File challenge không có phần mở rộng → IIS trả 404 nếu không khai MIME
$acmeConfig = @'
<?xml version="1.0" encoding="UTF-8"?>
<configuration>
  <system.webServer>
    <staticContent>
      <mimeMap fileExtension="." mimeType="text/plain" />
    </staticContent>
    <security>
      <requestFiltering>
        <fileExtensions allowUnlisted="true" />
      </requestFiltering>
    </security>
  </system.webServer>
</configuration>
'@
Set-Content -Path (Join-Path $acmeDir 'web.config') -Value $acmeConfig -Encoding UTF8
Write-Host "  Đã cấu hình .well-known/acme-challenge"

# --- [5/5] Health check -----------------------------------------------------
Write-Host "`n[5/5] Health check..." -ForegroundColor Yellow

$fileCount = (Get-ChildItem $SiteRoot -Recurse -File).Count
Write-Host "  $fileCount file trong site root"

try {
    $res = Invoke-WebRequest -Uri 'https://ipos123.vn' -UseBasicParsing -TimeoutSec 15
    Write-Host "  https://ipos123.vn → HTTP $($res.StatusCode)" -ForegroundColor Green
    Write-Host "`nDeploy xong. App live tại https://ipos123.vn" -ForegroundColor Green
} catch {
    Write-Host "  Chưa gọi được https://ipos123.vn: $($_.Exception.Message)" -ForegroundColor Yellow
    Write-Host "`nFile đã copy xong. Nếu site chưa dựng, chạy (Administrator):" -ForegroundColor Yellow
    Write-Host "    .\deploy\setup-iis-site.ps1" -ForegroundColor Yellow
}
