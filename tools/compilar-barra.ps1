# Compila pc\barra\MuralBarra.cs em pc\MuralBarra.exe com o compilador C# que já vem no Windows (.NET Framework 4).
$raiz = Split-Path $PSScriptRoot -Parent
$csc = Join-Path $env:WINDIR "Microsoft.NET\Framework64\v4.0.30319\csc.exe"
$res = Join-Path $raiz "android\app\src\main\res\drawable-nodpi"
& $csc /nologo /target:winexe /optimize+ /codepage:65001 `
    "/out:$raiz\pc\MuralBarra.exe" `
    "/win32icon:$raiz\pc\mural.ico" `
    "/resource:$res\rosto_bjorn.png,Mural.rosto_bjorn.png" `
    "/resource:$res\rosto_yoshiro.png,Mural.rosto_yoshiro.png" `
    /r:System.Web.Extensions.dll /r:System.Security.dll /r:System.Windows.Forms.dll /r:System.Drawing.dll `
    "$raiz\pc\barra\MuralBarra.cs"
if ($LASTEXITCODE -eq 0) { "Compilado: $raiz\pc\MuralBarra.exe" }
