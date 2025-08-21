;Inspired by:
; https://gist.github.com/bogdibota/062919938e1ed388b3db5ea31f52955c
; https://stackoverflow.com/questions/34177547/detect-if-visual-c-redistributable-for-visual-studio-2013-is-installed
; https://stackoverflow.com/a/54391388
; https://github.com/GitCommons/cpp-redist-nsis/blob/main/installer.nsh

;Find latests downloads here:
; https://learn.microsoft.com/en-us/cpp/windows/latest-supported-vc-redist

!include LogicLib.nsh
!include x64.nsh

; https://github.com/electron-userland/electron-builder/issues/1122
!ifndef BUILD_UNINSTALLER
  Function checkVCRedist
    ; $1: arch (e.g., "x64", "arm64")
    ; returns $0: "1" if installed, "0" otherwise
    ${If} $1 == "arm64"
      ReadRegDWORD $0 HKLM "SOFTWARE\Microsoft\VisualStudio\14.0\VC\Runtimes\arm64" "Installed"
    ${Else}
      ReadRegDWORD $0 HKLM "SOFTWARE\Microsoft\VisualStudio\14.0\VC\Runtimes\x64" "Installed"
    ${EndIf}
  FunctionEnd

  Function checkArchitectureCompatibility
    ; returns $0: "1" if compatible, "0" otherwise
    ; returns $1: system architecture ("x64", "arm64", "x86")
    ; returns $3: app architecture ("x64", "arm64", "universal")
    StrCpy $0 "0"
    StrCpy $1 ""
    StrCpy $3 ""

    ; Check system architecture
    ${If} ${RunningX64}
      ReadEnvStr $2 "PROCESSOR_ARCHITECTURE"
      ReadEnvStr $4 "PROCESSOR_ARCHITEW6432"
      ${If} $2 == "ARM64"
      ${OrIf} $4 == "ARM64"
        StrCpy $1 "arm64"
      ${Else}
        StrCpy $1 "x64"
      ${EndIf}
    ${Else}
      StrCpy $1 "x86"
    ${EndIf}

    ; Determine app architecture from build variables
    !ifdef APP_ARM64_NAME
      !ifdef APP_64_NAME
        StrCpy $3 "universal"
      !else
        StrCpy $3 "arm64"
      !endif
    !else
      !ifdef APP_64_NAME
        StrCpy $3 "x64"
      !endif
    !endif

    ; Default to x64 if no specific app architecture is defined
    ${If} $3 == ""
      StrCpy $3 "x64"
    ${EndIf}

    ; Compare system and app architectures
    ${If} $3 == "universal"
      StrCpy $0 "1"
    ${ElseIf} $1 == $3
      StrCpy $0 "1"
    ${Else}
      StrCpy $0 "0"
    ${EndIf}
  FunctionEnd
!endif

!macro customInit
  Push $0
  Push $1
  Push $2
  Push $3
  Push $4
  Push $5 ; For redist URL
  Push $6 ; For redist file path

  ; 1. Check architecture compatibility
  Call checkArchitectureCompatibility
  ; $0="1" for compatible, $1=system arch, $3=app arch
  ${If} $0 != "1"
    MessageBox MB_ICONEXCLAMATION "\
      Architecture Mismatch$\r$\n$\r$\n\
      This installer is not compatible with your system architecture.$\r$\n\
      Your system: $1$\r$\n\
      App architecture: $3$\r$\n$\r$\n\
      Please download the correct version from:$\r$\n\
      https://deepchat.thinkinai.xyz/"
    ExecShell "open" "https://deepchat.thinkinai.xyz/"
    Abort
  ${EndIf}

  ; 2. Check for VC++ Redistributable based on the determined architecture
  ; If the app is universal, check based on the system arch. Otherwise, app arch.
  ${If} $3 == "universal"
    StrCpy $2 $1
  ${Else}
    StrCpy $2 $3
  ${EndIf}

  ; Don't check for x86 systems as we don't ship redist for it
  ${If} $2 == "x86"
    Goto ContinueInstall
  ${EndIf}

  Push $2 ; Pass arch to checkVCRedist
  Call checkVCRedist
  Pop $2
  ${If} $0 == "1"
    Goto ContinueInstall
  ${EndIf}

  ; 3. If not installed, prompt to download and install
  MessageBox MB_YESNO "\
    NOTE: ${PRODUCT_NAME} requires $\r$\n\
    'Microsoft Visual C++ Redistributable' ($2)$\r$\n\
    to function properly.$\r$\n$\r$\n\
    Download and install now?" /SD IDYES IDYES InstallVCRedist IDNO DontInstall

  InstallVCRedist:
    StrCpy $5 "https://aka.ms/vs/17/release/vc_redist.$2.exe"
    StrCpy $6 "$TEMP\vc_redist.$2.exe"
    inetc::get /CAPTION " " /BANNER "Downloading Microsoft Visual C++ Redistributable ($2)..." "$5" "$6"
    ExecWait "$6 /install /norestart"
    ; vc_redist exit code is unreliable, so we re-check registry
    
    Push $2 ; Pass arch to checkVCRedist again
    Call checkVCRedist
    Pop $2
    ${If} $0 == "1"
      Goto ContinueInstall
    ${EndIf}

    MessageBox MB_ICONSTOP "\
      There was an unexpected error installing$\r$\n\
      Microsoft Visual C++ Redistributable.$\r$\n\
      The installation of ${PRODUCT_NAME} cannot continue."
    Abort ; Abort if installation failed

  DontInstall:
    Abort ; Abort if user chose not to install

  ContinueInstall:
    Pop $6
    Pop $5
    Pop $4
    Pop $3
    Pop $2
    Pop $1
    Pop $0
!macroend
