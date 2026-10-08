# Compila pc\barra\MuralBarra.cs em pc\MuralBarra.exe com o compilador C# que já vem no Windows (.NET Framework 4).
# A versão vem de pc\barra\versao.txt (aumente esse número quando mudar a barrinha: é o que dispara o aviso de atualização).
$raiz = Split-Path $PSScriptRoot -Parent
$csc = Join-Path $env:WINDIR "Microsoft.NET\Framework64\v4.0.30319\csc.exe"
$res = Join-Path $raiz "android\app\src\main\res\drawable-nodpi"
$versao = (Get-Content (Join-Path $raiz "pc\barra\versao.txt") -Raw).Trim()
Set-Content -Path (Join-Path $raiz "pc\barra\Versao.cs") -Encoding UTF8 -Value @"
// Gerado por tools/compilar-barra.ps1 a partir de pc/barra/versao.txt.
namespace Mural { static class Versao { public const int Numero = $versao; } }
"@
& $csc /nologo /target:winexe /optimize+ /codepage:65001 `
    "/out:$raiz\pc\MuralBarra.exe" `
    "/win32icon:$raiz\pc\mural.ico" `
    "/resource:$res\rosto_bjorn.png,Mural.rosto_bjorn.png" `
    "/resource:$res\rosto_yoshiro.png,Mural.rosto_yoshiro.png" `
    /r:System.Web.Extensions.dll /r:System.Security.dll /r:System.Windows.Forms.dll /r:System.Drawing.dll `
    /r:System.IO.Compression.dll /r:System.IO.Compression.FileSystem.dll `
    "$raiz\pc\barra\MuralBarra.cs" "$raiz\pc\barra\Versao.cs"
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
"Compilado: $raiz\pc\MuralBarra.exe (versão $versao)"
