# Instala o Mural neste PC:
#  - abre sozinho com o aviso do dia toda vez que o Windows inicia;
#  - põe a barrinha com os compromissos mais próximos dentro da barra de tarefas (MuralBarra.exe);
#  - cria atalhos na Área de Trabalho e no menu Iniciar (clique direito → "Fixar em Iniciar").
# Para desfazer: rode de novo com -Remover.
param(
    [string]$Site = "https://srbjorn.github.io/mural/",
    [switch]$Remover
)

$pasta = Join-Path $env:LOCALAPPDATA "Mural"
$inicializar = [Environment]::GetFolderPath("Startup")
$atalhos = @(
    @{ Caminho = Join-Path $inicializar "Mural (aviso do dia).lnk"; Hash = "#aviso" },
    @{ Caminho = Join-Path ([Environment]::GetFolderPath("Desktop")) "Mural.lnk"; Hash = "" },
    @{ Caminho = Join-Path ([Environment]::GetFolderPath("Programs")) "Mural.lnk"; Hash = "" }
)
$atalhoBarra = Join-Path $inicializar "Mural na barra de tarefas.lnk"
$barra = Join-Path $pasta "MuralBarra.exe"

# Pede para a barrinha aberta (de qualquer pasta) se fechar e espera ela sair; se não sair em 10 s, encerra.
function Fechar-Barra([string]$exe) {
    if (-not (Get-Process MuralBarra -ErrorAction SilentlyContinue)) { return }
    if (Test-Path $exe) { Start-Process $exe -ArgumentList "--fechar" -Wait }
    for ($i = 0; $i -lt 20 -and (Get-Process MuralBarra -ErrorAction SilentlyContinue); $i++) { Start-Sleep -Milliseconds 500 }
    Get-Process MuralBarra -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue
    Start-Sleep -Milliseconds 500
}

if ($Remover) {
    Fechar-Barra $barra
    foreach ($c in @($atalhos.Caminho) + $atalhoBarra) { if (Test-Path $c) { Remove-Item -LiteralPath $c -Confirm:$false } }
    if (Test-Path $pasta) { Remove-Item -LiteralPath $pasta -Recurse -Confirm:$false }
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

# Barrinha na barra de tarefas: fecha a versão antiga (se houver), copia a nova e abre.
$barraOrigem = Join-Path $PSScriptRoot "MuralBarra.exe"
if (Test-Path $barraOrigem) {
    Fechar-Barra $barraOrigem
    Copy-Item $barraOrigem $barra -Force
    $lnk = $shell.CreateShortcut($atalhoBarra)
    $lnk.TargetPath = $barra
    $lnk.Description = "Compromissos do Mural na barra de tarefas"
    $lnk.Save()
    Start-Process $barra
}

Write-Host "Pronto! O Mural abre sozinho quando o Windows iniciar."
Write-Host "A barrinha com os próximos compromissos fica ao lado do relógio (na primeira vez ela pede o login)."
Write-Host "Atalhos criados na Área de Trabalho e no menu Iniciar."
Write-Host "Para deixar fixo no Iniciar ou na barra de tarefas: clique direito no atalho → Fixar."
