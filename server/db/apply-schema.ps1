#Requires -Version 5.1
<#
.SYNOPSIS
    Áp dụng schema + functions lên ipos_db, dựng đúng mô hình 2 role.

.DESCRIPTION
    Cần mật khẩu superuser (đặt qua biến môi trường PGPASSWORD, hoặc script hỏi).

    Mô hình role — lý do phải làm vậy:
      ipos_owner  NOLOGIN, sở hữu mọi bảng + function. SECURITY DEFINER chạy
                  dưới quyền nó nên bỏ qua được RLS.
      ipos_app    role API kết nối. KHÔNG sở hữu gì → RLS áp dụng đầy đủ.

    Chủ sở hữu bảng trong Postgres mặc định BỎ QUA RLS. Nếu để ipos_app vừa sở
    hữu vừa kết nối thì mọi policy thành trang trí, và một câu query thiếu
    WHERE org_id trong API sẽ làm lộ dữ liệu giữa các tiệm.

.PARAMETER Reset
    DROP SCHEMA public CASCADE rồi dựng lại từ đầu. Mất sạch dữ liệu trong
    ipos_db. Chỉ dùng khi dữ liệu là test.

.EXAMPLE
    $env:PGPASSWORD='...'; .\server\db\apply-schema.ps1 -Reset
#>
[CmdletBinding()]
param(
    [switch]$Reset,
    [string]$DbName    = 'ipos_db',
    [string]$AppRole   = 'ipos_app',
    [string]$OwnerRole = 'ipos_owner',
    [string]$PgHost    = '127.0.0.1',
    [int]   $PgPort    = 5432,
    [string]$SuperUser = 'postgres',
    [string]$PgVersion = '18'
)

$ErrorActionPreference = 'Stop'
$DbDir = $PSScriptRoot
$psql = "C:\Program Files\PostgreSQL\$PgVersion\bin\psql.exe"
if (-not (Test-Path $psql)) { throw "Không thấy $psql" }

if (-not $env:PGPASSWORD) {
    $sec = Read-Host "Mật khẩu superuser '$SuperUser'" -AsSecureString
    $bstr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($sec)
    try { $env:PGPASSWORD = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($bstr) }
    finally { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($bstr) }
}

function Invoke-Sql {
    param([string]$Sql, [string]$Database = $DbName)
    $out = $Sql | & $psql -h $PgHost -p $PgPort -U $SuperUser -d $Database -v ON_ERROR_STOP=1 -A -t -q 2>&1
    if ($LASTEXITCODE -ne 0) { throw "SQL lỗi: $out" }
    return $out
}

function Invoke-SqlFile {
    param([string]$Path, [string]$AsRole)
    # SET ROLE ở đầu phiên → mọi object DDL sau đó thuộc sở hữu của role đó.
    $sql = "set role $AsRole;`n" + (Get-Content -LiteralPath $Path -Raw -Encoding UTF8)
    $out = $sql | & $psql -h $PgHost -p $PgPort -U $SuperUser -d $DbName -v ON_ERROR_STOP=1 -q 2>&1
    if ($LASTEXITCODE -ne 0) { throw "Lỗi khi chạy $(Split-Path $Path -Leaf):`n$out" }
}

Write-Host "=== Áp dụng schema lên $DbName ===" -ForegroundColor Cyan

# --- [1/6] Role owner ---------------------------------------------------------
Write-Host "`n[1/6] Role $OwnerRole..." -ForegroundColor Yellow
Invoke-Sql -Database 'postgres' -Sql @"
do `$`$
begin
  if not exists (select 1 from pg_roles where rolname = '$OwnerRole') then
    create role "$OwnerRole" nologin;
  end if;
end
`$`$;
"@ | Out-Null
Write-Host "  OK (NOLOGIN, không ai kết nối bằng role này)"

# --- [2/6] Reset schema -------------------------------------------------------
$tableCount = (Invoke-Sql -Sql "select count(*) from pg_tables where schemaname='public';").Trim()
if ($tableCount -ne '0') {
    if (-not $Reset) {
        throw "ipos_db đã có $tableCount bảng. Dùng -Reset để xoá sạch và dựng lại (mất dữ liệu)."
    }
    Write-Host "`n[2/6] -Reset: xoá $tableCount bảng cũ..." -ForegroundColor Yellow
    Invoke-Sql -Sql 'drop schema public cascade; create schema public;' | Out-Null
    Write-Host "  Đã xoá"
} else {
    Write-Host "`n[2/6] Schema rỗng, không cần reset" -ForegroundColor Yellow
}

# Schema thuộc owner → bảng tạo trong đó cũng thuộc owner
Invoke-Sql -Sql "alter schema public owner to `"$OwnerRole`";" | Out-Null

# --- [3/6] schema.sql ---------------------------------------------------------
Write-Host "`n[3/6] schema.sql..." -ForegroundColor Yellow
Invoke-SqlFile -Path (Join-Path $DbDir 'schema.sql') -AsRole $OwnerRole
$n = (Invoke-Sql -Sql "select count(*) from pg_tables where schemaname='public';").Trim()
Write-Host "  $n bảng" -ForegroundColor Green

# --- [4/6] functions.sql + auth-functions.sql ---------------------------------
Write-Host "`n[4/6] functions.sql + auth-functions.sql..." -ForegroundColor Yellow
Invoke-SqlFile -Path (Join-Path $DbDir 'functions.sql') -AsRole $OwnerRole
Invoke-SqlFile -Path (Join-Path $DbDir 'auth-functions.sql') -AsRole $OwnerRole
$f = (Invoke-Sql -Sql "select count(*) from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public';").Trim()
Write-Host "  $f function" -ForegroundColor Green

# --- [5/6] Quyền cho ipos_app -------------------------------------------------
Write-Host "`n[5/6] Cấp quyền cho $AppRole..." -ForegroundColor Yellow
Invoke-Sql -Sql @"
grant usage on schema public to "$AppRole";
grant select, insert, update, delete on all tables in schema public to "$AppRole";
grant execute on all functions in schema public to "$AppRole";

-- Object tạo sau này bởi owner cũng tự có quyền, khỏi phải nhớ cấp lại
alter default privileges for role "$OwnerRole" in schema public
  grant select, insert, update, delete on tables to "$AppRole";
alter default privileges for role "$OwnerRole" in schema public
  grant execute on functions to "$AppRole";

-- Helper nội bộ: chỉ RPC khác gọi, client không được gọi trực tiếp
revoke execute on function public.recompute_stock_take_totals(uuid) from "$AppRole";
"@ | Out-Null
Write-Host "  OK"

# --- [6/6] Nghiệm thu ---------------------------------------------------------
Write-Host "`n[6/6] Nghiệm thu..." -ForegroundColor Yellow

$owner = (Invoke-Sql -Sql "select tableowner from pg_tables where schemaname='public' and tablename='products';").Trim()
if ($owner -eq $OwnerRole) {
    Write-Host "  Chủ sở hữu bảng = $owner (KHÔNG phải $AppRole): OK" -ForegroundColor Green
} else {
    Write-Host "  SAI: chủ sở hữu là '$owner' — RLS sẽ bị bỏ qua!" -ForegroundColor Red
}

$noRls = (Invoke-Sql -Sql "select count(*) from pg_tables t join pg_class c on c.relname=t.tablename where t.schemaname='public' and not c.relrowsecurity;").Trim()
if ($noRls -eq '0') {
    Write-Host "  RLS bật trên tất cả bảng: OK" -ForegroundColor Green
} else {
    Write-Host "  CẢNH BÁO: $noRls bảng chưa bật RLS" -ForegroundColor Red
}

Write-Host "`nXong." -ForegroundColor Green
