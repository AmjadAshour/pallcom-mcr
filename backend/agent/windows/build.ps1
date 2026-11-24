param([string]$OutputDirectory)

$ErrorActionPreference = 'Stop'
$root = (Resolve-Path (Join-Path $PSScriptRoot '../../..')).Path
$node = (Get-Command node.exe -CommandType Application | Select-Object -First 1).Source
if ((& $node -p 'process.arch') -ne 'x64') { throw 'Use x64 Node.js to build the Windows x64 package.' }
$compiler = Join-Path $env:SystemRoot 'Microsoft.NET/Framework64/v4.0.30319/csc.exe'
$output = if ($OutputDirectory) { $OutputDirectory } else { Join-Path $root 'dist' }
$tempRoot = [IO.Path]::GetTempPath().TrimEnd('\')
$stage = Join-Path $tempRoot ('mcr-agent-build-' + [Guid]::NewGuid())
$zip = Join-Path $stage 'AgentPayload.zip'
New-Item -Path $stage, $output -ItemType Directory -Force | Out-Null
Add-Type -AssemblyName System.IO.Compression.FileSystem

Push-Location $root
try {
    & $node (Join-Path $PSScriptRoot 'bundle.mjs') $stage
    if ($LASTEXITCODE -ne 0) { throw 'Agent bundling failed.' }
    $bundle = Join-Path $stage 'agent.mjs'
    & $node $bundle --help
    if ($LASTEXITCODE -ne 0) { throw 'The packaged agent could not load.' }

    $ffprobe = Join-Path $root 'node_modules/@ffprobe-installer/win32-x64'
    $files = [ordered]@{
        'backend/agent/src/agent.mjs' = $bundle
        'node.exe' = $node
        'Node-LICENSE.txt' = Join-Path (Split-Path $node) 'LICENSE'
        'ffprobe.exe' = Join-Path $ffprobe 'ffprobe.exe'
        'notices/ffprobe/package.json' = Join-Path $ffprobe 'package.json'
        'notices/ffprobe/README.md' = Join-Path $ffprobe 'README.md'
    }
    $packages = & npm.cmd ls --omit=dev --all --parseable --workspace=@mcr/agent
    if ($LASTEXITCODE -ne 0) { throw 'Install the project dependencies before building.' }
    foreach ($package in $packages) {
        if ($package -eq $root -or $package -notlike "$root\*") { continue }
        $relative = $package.Substring($root.Length + 1).Replace('\', '/')
        foreach ($license in Get-ChildItem -LiteralPath $package -File | Where-Object Name -Match '^(license|copying|notice)(\.|$)') {
            $files["notices/$relative/$($license.Name)"] = $license.FullName
        }
    }

    $archive = [IO.Compression.ZipFile]::Open($zip, 'Create')
    try {
        foreach ($file in $files.GetEnumerator()) {
            [void][IO.Compression.ZipFileExtensions]::CreateEntryFromFile($archive, $file.Value, $file.Key, 'Fastest')
        }
    } finally {
        $archive.Dispose()
    }

    $exe = Join-Path $output 'MCR-Agent-Windows-x64.exe'
    & $compiler /nologo /target:winexe /platform:x64 "/out:$exe" "/resource:$zip,AgentPayload.zip" /reference:System.Drawing.dll /reference:System.Windows.Forms.dll /reference:System.Web.Extensions.dll /reference:System.IO.Compression.dll /reference:System.IO.Compression.FileSystem.dll (Join-Path $PSScriptRoot 'Launcher.cs')
    if ($LASTEXITCODE -ne 0) { throw 'Launcher compilation failed.' }
    Get-Item -LiteralPath $exe
} finally {
    Pop-Location
    $resolvedStage = (Resolve-Path -LiteralPath $stage).Path
    if ($resolvedStage.StartsWith($tempRoot + '\mcr-agent-build-', [StringComparison]::OrdinalIgnoreCase)) {
        Remove-Item -LiteralPath $resolvedStage -Recurse -Force
    }
}
