#Requires -Version 5.1
#Requires -RunAsAdministrator
<#
.SYNOPSIS
    Dựng IIS site cho ipos123.vn. CHỈ CHẠY MỘT LẦN, cần Administrator.

.DESCRIPTION
    Server này đang chạy nhiều site thật khác (bdcbanking.com, laitot.com,
    themarisvip.com, alaw.vn...). Script chỉ THÊM site mới, không sửa gì của
    site đang có. Mọi thao tác đều idempotent — chạy lại không hỏng.

    Sau script này còn 1 bước thủ công: xin cert HTTPS (xem phần in ra cuối).

.PARAMETER SiteRoot
    Thư mục gốc site, theo quy ước D:\Hosting\_iis_sites\<domain>

.EXAMPLE
    # Mở PowerShell bằng "Run as Administrator" rồi:
    .\deploy\setup-iis-site.ps1
#>
[CmdletBinding()]
param(
    [string]$SiteName = 'ipos123.vn',
    [string]$SiteRoot = 'D:\Hosting\_iis_sites\ipos123.vn',
    [string]$Domain   = 'ipos123.vn',
    [string]$WwwHost  = 'www.ipos123.vn'
)

$ErrorActionPreference = 'Stop'
Import-Module WebAdministration

Write-Host "=== Dựng IIS site $SiteName ===" -ForegroundColor Cyan

# --- [1/5] Kiểm tra tiền đề -------------------------------------------------
Write-Host "`n[1/5] Kiểm tra tiền đề..." -ForegroundColor Yellow

if (-not (Test-Path 'HKLM:\SOFTWARE\Microsoft\IIS Extensions\URL Rewrite')) {
    throw "Chưa cài module URL Rewrite — SPA fallback sẽ không chạy. Tải: https://www.iis.net/downloads/microsoft/url-rewrite"
}
Write-Host "  URL Rewrite: OK"

if (-not (Test-Path (Join-Path $SiteRoot 'index.html'))) {
    throw "Chưa có nội dung tại $SiteRoot. Chạy .\deploy\deploy-iis.ps1 trước."
}
Write-Host "  Nội dung site: OK"

# Cảnh báo nếu domain/www đang được site khác giữ — tránh cướp binding
foreach ($h in $Domain, $WwwHost) {
    $conflict = Get-Website | Where-Object { $_.Name -ne $SiteName } | Where-Object {
        $_.Bindings.Collection | Where-Object { $_.bindingInformation -like "*:$h" }
    }
    if ($conflict) {
        throw "Host $h đã được site '$($conflict.Name)' dùng. Dừng lại để không phá site đang chạy."
    }
}
Write-Host "  Không đụng binding của site khác: OK"

# --- [2/5] Application pool -------------------------------------------------
Write-Host "`n[2/5] Application pool..." -ForegroundColor Yellow

if (-not (Test-Path "IIS:\AppPools\$SiteName")) {
    New-WebAppPool -Name $SiteName | Out-Null
    Write-Host "  Đã tạo app pool $SiteName"
} else {
    Write-Host "  App pool đã có"
}
# Site tĩnh thuần — không cần .NET runtime
Set-ItemProperty "IIS:\AppPools\$SiteName" -Name managedRuntimeVersion -Value ''
Set-ItemProperty "IIS:\AppPools\$SiteName" -Name startMode -Value 'AlwaysRunning'

# --- [3/5] Website + binding HTTP ------------------------------------------
Write-Host "`n[3/5] Website + binding..." -ForegroundColor Yellow

if (-not (Test-Path "IIS:\Sites\$SiteName")) {
    New-Website -Name $SiteName -PhysicalPath $SiteRoot -ApplicationPool $SiteName `
                -HostHeader $Domain -Port 80 | Out-Null
    Write-Host "  Đã tạo site, binding http://$Domain"
} else {
    Set-ItemProperty "IIS:\Sites\$SiteName" -Name physicalPath -Value $SiteRoot
    Write-Host "  Site đã có, đã cập nhật physicalPath"
}

$bindings = (Get-Website -Name $SiteName).Bindings.Collection
foreach ($h in $Domain, $WwwHost) {
    $exists = $bindings | Where-Object { $_.bindingInformation -eq "*:80:$h" }
    if (-not $exists) {
        New-WebBinding -Name $SiteName -Protocol http -Port 80 -HostHeader $h
        Write-Host "  Đã thêm binding http://$h"
    } else {
        Write-Host "  Binding http://$h đã có"
    }
}

# --- [4/5] Quyền đọc thư mục ------------------------------------------------
Write-Host "`n[4/5] Quyền NTFS..." -ForegroundColor Yellow

# App pool identity + IUSR cần quyền đọc để IIS serve file tĩnh
foreach ($account in "IIS AppPool\$SiteName", 'IUSR') {
    try {
        $acl = Get-Acl $SiteRoot
        $rule = New-Object System.Security.AccessControl.FileSystemAccessRule(
            $account, 'ReadAndExecute', 'ContainerInherit,ObjectInherit', 'None', 'Allow')
        $acl.SetAccessRule($rule)
        Set-Acl -Path $SiteRoot -AclObject $acl
        Write-Host "  Đã cấp quyền đọc cho $account"
    } catch {
        Write-Host "  Không cấp được cho ${account}: $($_.Exception.Message)" -ForegroundColor Yellow
    }
}

Start-Website -Name $SiteName -ErrorAction SilentlyContinue
Write-Host "  Site đã start"

# --- [5/5] Hướng dẫn xin cert ----------------------------------------------
Write-Host "`n[5/5] Còn lại: cert HTTPS" -ForegroundColor Yellow
Write-Host @"

  Site đang chạy HTTP. Camera quét mã vạch CHỈ hoạt động trên HTTPS, nên
  bước này bắt buộc, không phải tuỳ chọn.

  Server đã có sẵn 2 công cụ, chọn một:

  Cách 1 — Certify The Web (GUI, đang quản lý các domain khác trên máy này):
    Mở Certify The Web → New Certificate → chọn site "$SiteName"
    → tick cả $Domain và $WwwHost → Request Certificate.
    Tự động gia hạn, không cần làm gì thêm.

  Cách 2 — win-acme (dòng lệnh):
    C:\win-acme\wacs.exe --target iissite --siteid (Get-Website -Name '$SiteName').Id

  LƯU Ý: web.config đã cấu hình sẵn để HTTP-01 challenge đi lọt
  (.well-known/acme-challenge không bị redirect HTTPS, không bị SPA fallback).

  Sau khi có cert, kiểm tra:
    curl.exe -I https://$Domain
    curl.exe -I https://$WwwHost      # phải trả 301 về https://$Domain

"@ -ForegroundColor Cyan

Write-Host "Xong phần IIS." -ForegroundColor Green
