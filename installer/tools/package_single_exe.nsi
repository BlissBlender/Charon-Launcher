Unicode true
!define PRODUCT_NAME "Charon Game Launcher"
!define PRODUCT_VERSION "1.0.0"
!define PRODUCT_PUBLISHER "Charon Technologies"

SetCompressor /SOLID lzma

RequestExecutionLevel user
SilentInstall silent

Icon "e:\Charon Launcher\launcher\build\icon.ico"

VIProductVersion "1.0.0.0"
VIAddVersionKey "ProductName" "Charon Game Launcher Setup"
VIAddVersionKey "CompanyName" "Charon Technologies"
VIAddVersionKey "FileDescription" "Charon Game Launcher Custom Installer"
VIAddVersionKey "FileVersion" "1.0.0.0"
VIAddVersionKey "LegalCopyright" "(c) 2026 Charon Technologies"

OutFile "e:\Charon Launcher\installer\out\Charon-Custom-Installer.exe"

!include "FileFunc.nsh"

Section "MainSection" SEC01
    InitPluginsDir
    SetOutPath "$PLUGINSDIR\app"
    File /r "e:\Charon Launcher\installer\out\CharonSetup-dist\*.*"

    ${GetParameters} $R0
    ExecWait '"$PLUGINSDIR\app\CharonSetup.exe" $R0'
SectionEnd
