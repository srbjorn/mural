# Instala o Mural neste PC:
#  - abre sozinho com o aviso do dia toda vez que o Windows inicia;
#  - cria atalhos na Área de Trabalho e no menu Iniciar (clique direito → "Fixar em Iniciar").
# Para desfazer: rode de novo com -Remover.
param(
    [string]$Site = "https://srbjorn.github.io/mural/",
    [switch]$Remover
)

$pasta = Join-Path $env:LOCALAPPDATA "Mural"
$atalhos = @(
    @{ Caminho = Join-Path ([Environment]::GetFolderPath("Startup")) "Mural (aviso do dia).lnk"; Hash = "#aviso" },
    @{ Caminho = Join-Path ([Environment]::GetFolderPath("Desktop")) "Mural.lnk"; Hash = "" },
    @{ Caminho = Join-Path ([Environment]::GetFolderPath("Programs")) "Mural.lnk"; Hash = "" }
)

if ($Remover) {
    foreach ($a in $atalhos) { if (Test-Path $a.Caminho) { Remove-Item $a.Caminho -Confirm:$false } }
    if (Test-Path $pasta) { Remove-Item $pasta -Recurse -Confirm:$false }
    Write-Host "Mural removido deste PC."
    return
}

# Chrome se tiver, senão Edge (vem com o Windows).
$candidatos = @(
    "$env:ProgramFiles\Google\Chrome\Application\chrome.exe",
    "${env:ProgramFiles(x86)}\Google\Chrome\Application\chrome.exe",
    "$env:LOCALAPPDATA\Google\Chrome\Application\chrome.exe",
    "${env:ProgramFiles(x86)}\Microsoft\Edge\Application\msedge.exe",
    "$env:ProgramFiles\Microsoft\Edge\Application\msedge.exe"
)
$navegador = $candidatos | Where-Object { Test-Path $_ } | Select-Object -First 1
if (-not $navegador) { Write-Error "Não achei Chrome nem Edge neste PC."; return }

New-Item -ItemType Directory -Force $pasta | Out-Null
$icone = Join-Path $pasta "mural.ico"
Copy-Item (Join-Path $PSScriptRoot "mural.ico") $icone -Force

$shell = New-Object -ComObject WScript.Shell
foreach ($a in $atalhos) {
    $lnk = $shell.CreateShortcut($a.Caminho)
    $lnk.TargetPath = $navegador
    $lnk.Arguments = "--app=`"$Site$($a.Hash)`" --window-size=1500,950"
    $lnk.IconLocation = $icone
    $lnk.Description = "Mural Bjørn & Yoshiro"
    $lnk.Save()
}

Write-Host "Pronto! O Mural abre sozinho quando o Windows iniciar."
Write-Host "Atalhos criados na Área de Trabalho e no menu Iniciar."
Write-Host "Para deixar fixo no Iniciar ou na barra de tarefas: clique direito no atalho → Fixar."
