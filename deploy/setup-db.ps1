#Requires -Version 5.1
<#
.SYNOPSIS
    Tạo database + role riêng cho Tạp Hóa POS trên PostgreSQL 18 có sẵn.

.DESCRIPTION
    Chạy MỘT lần. Hai chế độ:

    1. Mặc định — bạn biết mật khẩu superuser: script hỏi tại chỗ (nhập ẩn).

    2. -Bootstrap — KHÔNG ai biết mật khẩu superuser (trường hợp máy này):
       tạm thời cho phép kết nối từ 127.0.0.1 không cần mật khẩu, tạo role +
       database, rồi trả pg_hba.conf về nguyên trạng. Cần Administrator.

       Vì sao an toàn:
       - Chỉ mở cho 127.0.0.1, không mở ra ngoài. Firewall vẫn chặn 5432.
       - Dùng `pg_ctl reload` (SIGHUP), KHÔNG restart → các app khác đang dùng
         Postgres (bdc_holding_db...) không bị rớt kết nối.
       - pg_hba.conf được backup kèm timestamp trước khi sửa.
       - Khối try/finally đảm bảo khôi phục kể cả khi giữa chừng lỗi.
       - Cửa sổ mở chỉ vài giây.

       KHÔNG đụng tới mật khẩu của role nào đang có. Chỉ thêm mới.

.EXAMPLE
    .\deploy\setup-db.ps1 -Bootstrap
#>
[CmdletBinding()]
param(
    [switch]$Bootstrap,
    [string]$DbName    = 'ipos_db',
    [string]$DbUser    = 'ipos_app',
    [string]$PgHost    = '127.0.0.1',
    [int]   $PgPort    = 5432,
    [string]$SuperUser = 'postgres',
    [string]$PgVersion = '18'
)

$ErrorActionPreference = 'Stop'
$ProjectRoot = Split-Path -Parent $PSScriptRoot

Write-Host "=== Tạo database cho Tạp Hóa POS ===" -ForegroundColor Cyan

$pgBin = "C:\Program Files\PostgreSQL\$PgVersion\bin"
$psql  = Join-Path $pgBin 'psql.exe'
$pgCtl = Join-Path $pgBin 'pg_ctl.exe'
if (-not (Test-Path $psql)) { throw "Không thấy $psql" }

# --- Sinh sẵn mật khẩu cho role app -------------------------------------------
# Chỉ chữ + số: khỏi phải escape trong connection URL.
$alphabet = 'abcdefghijkmnopqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789'
$rng = [System.Security.Cryptography.RandomNumberGenerator]::Create()
$bytes = [byte[]]::new(40); $rng.GetBytes($bytes)
$appPass = -join ($bytes | ForEach-Object { $alphabet[$_ % $alphabet.Length] })
$jwtBytes = [byte[]]::new(48); $rng.GetBytes($jwtBytes)
$jwtSecret = [Convert]::ToBase64String($jwtBytes)

# --- SQL cấp DB ---------------------------------------------------------------
# Idempotent: DO block cho role, kiểm tra tồn tại cho database.
$sqlCluster = @"
DO `$`$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = '$DbUser') THEN
    ALTER ROLE "$DbUser" WITH LOGIN PASSWORD '$appPass';
  ELSE
    CREATE ROLE "$DbUser" WITH LOGIN PASSWORD '$appPass';
  END IF;
END
`$`$;
SELECT 'role_ok';
"@

# Postgres 15+ thu hồi CREATE trên schema public của mọi role → phải cấp lại.
$sqlDb = @"
GRANT ALL ON SCHEMA public TO "$DbUser";
ALTER SCHEMA public OWNER TO "$DbUser";
CREATE EXTENSION IF NOT EXISTS pgcrypto;
SELECT 'db_ok';
"@

$hbaPath   = $null
$hbaBackup = $null

function Invoke-Psql {
    param([string]$Sql, [string]$Database = 'postgres', [string]$User = $SuperUser)
    $out = $Sql | & $psql -h $PgHost -p $PgPort -U $User -d $Database -v ON_ERROR_STOP=1 -A -t -q 2>&1
    if ($LASTEXITCODE -ne 0) { throw "psql lỗi: $out" }
    return $out
}

try {
    if ($Bootstrap) {
        # --- Xác định data directory từ cấu hình service ----------------------
        $svcName = "postgresql-x64-$PgVersion"
        $imagePath = (Get-ItemProperty "HKLM:\SYSTEM\CurrentControlSet\Services\$svcName" -ErrorAction Stop).ImagePath
        if ($imagePath -match '-D\s+"([^"]+)"') {
            $dataDir = $matches[1]
        } else {
            $dataDir = "C:\Program Files\PostgreSQL\$PgVersion\data"
        }
        $hbaPath = Join-Path $dataDir 'pg_hba.conf'
        if (-not (Test-Path $hbaPath)) { throw "Không thấy $hbaPath — chạy bằng Administrator chưa?" }
        Write-Host "data dir: $dataDir"

        # --- Backup rồi mở trust tạm thời -------------------------------------
        $stamp = Get-Date -Format 'yyyyMMdd-HHmmss'
        $hbaBackup = "$hbaPath.bak-ipos-$stamp"
        Copy-Item -LiteralPath $hbaPath -Destination $hbaBackup -Force
        Write-Host "Đã backup pg_hba.conf → $(Split-Path $hbaBackup -Leaf)" -ForegroundColor Green

        $original = Get-Content -LiteralPath $hbaPath -Raw
        # Dòng trust phải nằm TRƯỚC các dòng khác — pg_hba khớp theo thứ tự.
        $tempLine = "# TAM THOI - ipos setup $stamp - se bi xoa ngay sau khi tao xong`nhost    all             all             127.0.0.1/32            trust`n"
        # UTF-8 không BOM: BOM sẽ làm Postgres không parse được pg_hba.conf.
        [System.IO.File]::WriteAllText($hbaPath, ($tempLine + $original), (New-Object System.Text.UTF8Encoding($false)))

        # reload = SIGHUP, KHÔNG restart → app khác không rớt kết nối
        $reloadOut = & $pgCtl reload -D "$dataDir" 2>&1
        if ($LASTEXITCODE -ne 0) { throw "pg_ctl reload thất bại: $reloadOut" }
        Start-Sleep -Seconds 2
        Write-Host "Đã mở trust tạm thời cho 127.0.0.1" -ForegroundColor Yellow
    } elseif ($env:PGPASSWORD) {
        # Hook cho automation: caller set sẵn PGPASSWORD thì không hỏi nữa.
        # Đặt qua biến môi trường chứ không phải tham số dòng lệnh — tham số sẽ
        # lộ trong danh sách tiến trình và lịch sử shell.
        Write-Host "Dùng PGPASSWORD có sẵn trong biến môi trường"
    } else {
        $sec = Read-Host "Mật khẩu superuser '$SuperUser'" -AsSecureString
        $bstr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($sec)
        try { $env:PGPASSWORD = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($bstr) }
        finally { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($bstr) }
    }

    # --- Tạo role ------------------------------------------------------------
    $v = Invoke-Psql -Sql 'SELECT version();'
    Write-Host "Kết nối OK: $((($v -split ',')[0]).Trim())" -ForegroundColor Green

    Invoke-Psql -Sql $sqlCluster | Out-Null
    Write-Host "Role '$DbUser': OK" -ForegroundColor Green

    # --- Tạo database (không chạy được trong transaction block) ---------------
    $dbExists = Invoke-Psql -Sql "SELECT 1 FROM pg_database WHERE datname = '$DbName';"
    if ($dbExists -match '1') {
        Write-Host "Database '$DbName' đã có" -ForegroundColor Yellow
    } else {
        Invoke-Psql -Sql "CREATE DATABASE `"$DbName`" OWNER `"$DbUser`" ENCODING 'UTF8';" | Out-Null
        Write-Host "Đã tạo database '$DbName'" -ForegroundColor Green
    }

    Invoke-Psql -Sql $sqlDb -Database $DbName | Out-Null
    Write-Host "Quyền schema + pgcrypto: OK" -ForegroundColor Green

} finally {
    # --- Khôi phục pg_hba.conf dù thành công hay lỗi -------------------------
    $env:PGPASSWORD = $null
    if ($Bootstrap -and $hbaBackup -and (Test-Path $hbaBackup)) {
        Copy-Item -LiteralPath $hbaBackup -Destination $hbaPath -Force
        & $pgCtl reload -D "$dataDir" 2>&1 | Out-Null
        Start-Sleep -Seconds 2
        Write-Host "Đã trả pg_hba.conf về nguyên trạng" -ForegroundColor Green

        # Nghiệm thu: kết nối không mật khẩu phải bị TỪ CHỐI trở lại
        $probe = 'SELECT 1;' | & $psql -h $PgHost -p $PgPort -U $SuperUser -d postgres -A -t 2>&1
        if ($LASTEXITCODE -eq 0) {
            Write-Host "CẢNH BÁO: vẫn vào được không cần mật khẩu. Kiểm tra $hbaPath ngay." -ForegroundColor Red
        } else {
            Write-Host "Xác nhận: cửa trust đã đóng" -ForegroundColor Green
        }
    }
}

# --- Ghi server\.env -----------------------------------------------------------
$serverDir = Join-Path $ProjectRoot 'server'
if (-not (Test-Path $serverDir)) { New-Item -ItemType Directory -Path $serverDir -Force | Out-Null }
$envPath = Join-Path $serverDir '.env'

$content = @"
# Sinh tự động bởi deploy/setup-db.ps1 — KHÔNG commit file này.
# Chạy lại script sẽ đặt lại mật khẩu DB và ghi đè file này.

DATABASE_URL=postgresql://$DbUser`:$appPass@$PgHost`:$PgPort/$DbName

# Bí mật ký JWT. Đổi giá trị này = đăng xuất toàn bộ phiên đang mở.
JWT_SECRET=$jwtSecret

# Cổng nội bộ, IIS reverse-proxy /api/* vào đây. Không mở ra firewall.
PORT=8210
NODE_ENV=production
"@

# Không dùng Set-Content -Encoding utf8NoBOM: tên encoding đó chỉ có ở PowerShell 7,
# script phải chạy được cả trên Windows PowerShell 5.1. Dotnet API thì giống nhau.
[System.IO.File]::WriteAllText($envPath, $content, (New-Object System.Text.UTF8Encoding($false)))

Write-Host ""
Write-Host "Đã ghi $envPath" -ForegroundColor Green
Write-Host "Xong. Báo lại để tôi chạy migration." -ForegroundColor Cyan
