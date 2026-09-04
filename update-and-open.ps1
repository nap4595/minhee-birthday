param(
    [switch]$GenerateOnly
)

$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest

$root = $PSScriptRoot
$imageDirectory = Join-Path $root "img"
$previewDirectory = Join-Path $root "img-preview"
$frameDirectory = Join-Path $root "frame"
$cakeDirectory = Join-Path $root "과거생일케이크"
$dataPath = Join-Path $root "site-data.js"
$previewBuilderPath = Join-Path $root "build-previews.py"
$maximumFrameNumber = 200
$supportedPreviewExtensions = @(".webp", ".avif", ".jpg", ".jpeg", ".png", ".gif")
$supportedFrameExtensions = @(".png", ".webp")

if (-not (Test-Path -LiteralPath $imageDirectory)) {
    New-Item -ItemType Directory -Path $imageDirectory | Out-Null
}

if (-not (Test-Path -LiteralPath $frameDirectory)) {
    New-Item -ItemType Directory -Path $frameDirectory | Out-Null
}

if (-not (Test-Path -LiteralPath $previewDirectory)) {
    New-Item -ItemType Directory -Path $previewDirectory | Out-Null
}

if (-not (Test-Path -LiteralPath $cakeDirectory)) {
    New-Item -ItemType Directory -Path $cakeDirectory | Out-Null
}

$pythonCommand = Get-Command python -ErrorAction SilentlyContinue
if ($pythonCommand -and (Test-Path -LiteralPath $previewBuilderPath)) {
    & $pythonCommand.Source $previewBuilderPath --source $imageDirectory --destination $previewDirectory
    if ($LASTEXITCODE -ne 0) {
        Write-Warning "배경 미리보기를 갱신하지 못했습니다. 기존 미리보기 또는 원본 사진을 사용합니다."
    }
}

function Get-NumberedAssets {
    param(
        [string]$Directory,
        [string[]]$Extensions
    )

    $existingFiles = @{}
    Get-ChildItem -LiteralPath $Directory -File | ForEach-Object {
        $existingFiles[$_.Name.ToLowerInvariant()] = $_.Name
    }

    $found = [System.Collections.Generic.List[string]]::new()
    foreach ($number in 1..$maximumFrameNumber) {
        $stem = $number.ToString("D2")
        foreach ($extension in $Extensions) {
            $candidate = ($stem + $extension).ToLowerInvariant()
            if ($existingFiles.ContainsKey($candidate)) {
                $found.Add($existingFiles[$candidate])
                break
            }
        }
    }
    return $found.ToArray()
}

$media = @(
    Get-ChildItem -LiteralPath $previewDirectory -File |
        Where-Object { $supportedPreviewExtensions -contains $_.Extension.ToLowerInvariant() } |
        Sort-Object Name |
        ForEach-Object { $_.Name }
)
$frames = @(Get-NumberedAssets -Directory $frameDirectory -Extensions $supportedFrameExtensions)
$cakes = @(
    Get-ChildItem -LiteralPath $cakeDirectory -File |
        Where-Object { @(".webp", ".avif", ".jpg", ".jpeg", ".png") -contains $_.Extension.ToLowerInvariant() } |
        Sort-Object Name |
        ForEach-Object { $_.Name }
)

$siteData = [ordered]@{
    media = $media
    frames = $frames
    cakes = $cakes
}

$json = $siteData | ConvertTo-Json -Compress -Depth 4
$javascript = "window.SITE_DATA = $json;"
$utf8WithoutBom = [System.Text.UTF8Encoding]::new($false)
[System.IO.File]::WriteAllText($dataPath, $javascript, $utf8WithoutBom)

Write-Host "사진과 프레임 목록을 반영했습니다." -ForegroundColor Green
Write-Host "배포용 사진 $($media.Count)개" -ForegroundColor DarkGray
Write-Host "사진 프레임 $($frames.Count)개" -ForegroundColor DarkGray
Write-Host "과거 케이크 $($cakes.Count)개" -ForegroundColor DarkGray
Write-Host "사진 개수 제한 없음 / 프레임 번호 01-$maximumFrameNumber" -ForegroundColor DarkGray

if ($GenerateOnly) {
    return
}

$mimeTypes = @{
    ".html" = "text/html; charset=utf-8"
    ".css" = "text/css; charset=utf-8"
    ".js" = "text/javascript; charset=utf-8"
    ".md" = "text/markdown; charset=utf-8"
    ".txt" = "text/plain; charset=utf-8"
    ".jpg" = "image/jpeg"
    ".jpeg" = "image/jpeg"
    ".png" = "image/png"
    ".webp" = "image/webp"
    ".gif" = "image/gif"
    ".avif" = "image/avif"
    ".mp4" = "video/mp4"
    ".webm" = "video/webm"
    ".mov" = "video/quicktime"
    ".m4v" = "video/x-m4v"
    ".mp3" = "audio/mpeg"
}

function Send-Response {
    param(
        [System.Net.Sockets.NetworkStream]$Stream,
        [int]$StatusCode,
        [string]$StatusText,
        [string]$ContentType,
        [byte[]]$Body,
        [hashtable]$ExtraHeaders = @{}
    )

    $headerLines = @(
        "HTTP/1.1 $StatusCode $StatusText"
        "Content-Type: $ContentType"
        "Content-Length: $($Body.Length)"
        "Cache-Control: no-cache"
        "Connection: close"
    )
    foreach ($key in $ExtraHeaders.Keys) {
        $headerLines += "$key`: $($ExtraHeaders[$key])"
    }
    $header = ($headerLines -join "`r`n") + "`r`n`r`n"
    $headerBytes = [System.Text.Encoding]::ASCII.GetBytes($header)
    $Stream.Write($headerBytes, 0, $headerBytes.Length)
    if ($Body.Length -gt 0) {
        $Stream.Write($Body, 0, $Body.Length)
    }
}

function Send-FileResponse {
    param(
        [System.Net.Sockets.NetworkStream]$Stream,
        [string]$Path,
        [string]$ContentType,
        [string]$RangeHeader
    )

    $fileInfo = Get-Item -LiteralPath $Path
    $fileLength = $fileInfo.Length
    $rangeStart = [long]0
    $rangeEnd = [long]($fileLength - 1)
    $statusCode = 200
    $statusText = "OK"

    if (-not [string]::IsNullOrWhiteSpace($RangeHeader) -and $RangeHeader -match "^bytes=(\d+)-(\d*)$") {
        $rangeStart = [long]$Matches[1]
        if (-not [string]::IsNullOrWhiteSpace($Matches[2])) {
            $rangeEnd = [Math]::Min([long]$Matches[2], $fileLength - 1)
        }
        if ($rangeStart -ge $fileLength -or $rangeStart -gt $rangeEnd) {
            $header = "HTTP/1.1 416 Range Not Satisfiable`r`nContent-Range: bytes */$fileLength`r`nContent-Length: 0`r`nConnection: close`r`n`r`n"
            $headerBytes = [System.Text.Encoding]::ASCII.GetBytes($header)
            $Stream.Write($headerBytes, 0, $headerBytes.Length)
            return
        }
        $statusCode = 206
        $statusText = "Partial Content"
    }

    $contentLength = $rangeEnd - $rangeStart + 1
    $headerLines = @(
        "HTTP/1.1 $statusCode $statusText"
        "Content-Type: $ContentType"
        "Content-Length: $contentLength"
        "Accept-Ranges: bytes"
        "Cache-Control: no-cache"
        "Connection: close"
    )
    if ($statusCode -eq 206) {
        $headerLines += "Content-Range: bytes $rangeStart-$rangeEnd/$fileLength"
    }
    $header = ($headerLines -join "`r`n") + "`r`n`r`n"
    $headerBytes = [System.Text.Encoding]::ASCII.GetBytes($header)
    $Stream.Write($headerBytes, 0, $headerBytes.Length)

    $fileStream = [System.IO.File]::OpenRead($Path)
    try {
        [void]$fileStream.Seek($rangeStart, [System.IO.SeekOrigin]::Begin)
        $buffer = [byte[]]::new(65536)
        $remaining = $contentLength
        while ($remaining -gt 0) {
            $requested = [int][Math]::Min($buffer.Length, $remaining)
            $read = $fileStream.Read($buffer, 0, $requested)
            if ($read -le 0) { break }
            $Stream.Write($buffer, 0, $read)
            $remaining -= $read
        }
    }
    finally {
        $fileStream.Dispose()
    }
}

$port = 8765
$listener = $null
while ($port -le 8775) {
    try {
        $listener = [System.Net.Sockets.TcpListener]::new([System.Net.IPAddress]::Loopback, $port)
        $listener.Start()
        break
    }
    catch {
        if ($listener) { $listener.Stop() }
        $listener = $null
        $port += 1
    }
}

if (-not $listener) {
    throw "사용 가능한 로컬 포트를 찾지 못했습니다."
}

$rootFullPath = [System.IO.Path]::GetFullPath($root)
$rootPrefix = $rootFullPath.TrimEnd([System.IO.Path]::DirectorySeparatorChar) + [System.IO.Path]::DirectorySeparatorChar
$url = "http://localhost:$port/"
Write-Host "웹페이지를 열었습니다: $url" -ForegroundColor Cyan
Write-Host "페이지를 보는 동안 이 창을 닫지 마세요. 종료하려면 Ctrl+C를 누르세요." -ForegroundColor DarkGray
Start-Process $url

try {
    while ($true) {
        $client = $listener.AcceptTcpClient()
        $networkStream = $null
        try {
            $networkStream = $client.GetStream()
            $reader = [System.IO.StreamReader]::new($networkStream, [System.Text.Encoding]::ASCII, $false, 4096, $true)
            $requestLine = $reader.ReadLine()
            $headers = @{}
            while ($true) {
                $line = $reader.ReadLine()
                if ([string]::IsNullOrEmpty($line)) { break }
                $separator = $line.IndexOf(":")
                if ($separator -gt 0) {
                    $headers[$line.Substring(0, $separator).Trim().ToLowerInvariant()] = $line.Substring($separator + 1).Trim()
                }
            }

            if ([string]::IsNullOrWhiteSpace($requestLine)) { continue }
            $requestParts = $requestLine.Split(" ")
            if ($requestParts.Length -lt 2 -or $requestParts[0] -ne "GET") {
                Send-Response $networkStream 405 "Method Not Allowed" "text/plain; charset=utf-8" ([System.Text.Encoding]::UTF8.GetBytes("GET 요청만 지원합니다."))
                continue
            }

            $requestPath = [System.Uri]::UnescapeDataString($requestParts[1].Split("?")[0]).TrimStart([char[]]"/")
            if ([string]::IsNullOrWhiteSpace($requestPath)) { $requestPath = "index.html" }
            $localPath = [System.IO.Path]::GetFullPath((Join-Path $root $requestPath.Replace([char]'/', [System.IO.Path]::DirectorySeparatorChar)))

            if (-not $localPath.StartsWith($rootPrefix, [System.StringComparison]::OrdinalIgnoreCase) -and $localPath -ne $rootFullPath) {
                Send-Response $networkStream 403 "Forbidden" "text/plain; charset=utf-8" ([System.Text.Encoding]::UTF8.GetBytes("접근할 수 없습니다."))
                continue
            }
            if (-not (Test-Path -LiteralPath $localPath -PathType Leaf)) {
                Send-Response $networkStream 404 "Not Found" "text/plain; charset=utf-8" ([System.Text.Encoding]::UTF8.GetBytes("파일을 찾을 수 없습니다."))
                continue
            }

            $extension = [System.IO.Path]::GetExtension($localPath).ToLowerInvariant()
            $contentType = if ($mimeTypes.ContainsKey($extension)) { $mimeTypes[$extension] } else { "application/octet-stream" }
            $rangeHeader = if ($headers.ContainsKey("range")) { $headers["range"] } else { "" }
            Send-FileResponse $networkStream $localPath $contentType $rangeHeader
        }
        catch {
            Write-Host "요청 처리 중 오류: $($_.Exception.Message)" -ForegroundColor DarkYellow
        }
        finally {
            if ($networkStream) { $networkStream.Dispose() }
            $client.Close()
        }
    }
}
finally {
    $listener.Stop()
}
