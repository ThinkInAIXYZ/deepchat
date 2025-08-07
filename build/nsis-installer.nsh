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
    ; Check for Visual Studio 2015-2022 redistributables (version 14.x)
    ; First check x64 runtime
    ReadRegDWORD $0 HKLM "SOFTWARE\Microsoft\VisualStudio\14.0\VC\Runtimes\x64" "Installed"
    ${If} $0 == "1"
      Return
    ${EndIf}
    
    ; If x64 not found, check arm64 runtime (for ARM64 systems)
    ReadRegDWORD $0 HKLM "SOFTWARE\Microsoft\VisualStudio\14.0\VC\Runtimes\arm64" "Installed"
    ${If} $0 == "1"
      Return
    ${EndIf}
    
    ; If neither found, check x86 runtime (for compatibility)
    ReadRegDWORD $0 HKLM "SOFTWARE\Microsoft\VisualStudio\14.0\VC\Runtimes\x86" "Installed"
  FunctionEnd

  Function checkArchitectureCompatibility
    ; Initialize variables
    StrCpy $0 "0"  ; Default to incompatible
    StrCpy $1 ""   ; System architecture
    StrCpy $3 ""   ; App architecture

    ; Check system architecture using built-in NSIS functions
    ${If} ${RunningX64}
      ; Check if it's ARM64 by looking at processor architecture
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

    ; Determine app architecture based on build variables
    !ifdef APP_ARM64_NAME
      !ifndef APP_64_NAME
        StrCpy $3 "arm64"  ; App is ARM64 only
      !endif
    !endif
    !ifdef APP_64_NAME
      !ifndef APP_ARM64_NAME
        StrCpy $3 "x64"    ; App is x64 only
      !endif
    !endif
    !ifdef APP_64_NAME
      !ifdef APP_ARM64_NAME
        StrCpy $3 "universal"  ; Both architectures available
      !endif
    !endif

    ; If no architecture variables are defined, assume x64
    ${If} $3 == ""
      StrCpy $3 "x64"
    ${EndIf}

    ; Compare system and app architectures
    ${If} $3 == "universal"
      ; Universal build, compatible with all architectures
      StrCpy $0 "1"
    ${ElseIf} $1 == $3
      ; Architectures match exactly
      StrCpy $0 "1"
    ${ElseIf} $1 == "x64"
    ${AndIf} $3 == "x86"
      ; x86 apps can run on x64 systems
      StrCpy $0 "1"
    ${ElseIf} $1 == "arm64"
    ${AndIf} $3 == "x86"
      ; x86 apps can run on ARM64 systems with emulation
      StrCpy $0 "1"
    ${ElseIf} $1 == "arm64"
    ${AndIf} $3 == "x64"
      ; x64 apps can run on ARM64 systems with emulation
      StrCpy $0 "1"
    ${Else}
      ; Architectures don't match and no compatibility
      StrCpy $0 "0"
    ${EndIf}
  FunctionEnd

  ; Add function to determine correct VC Redist URL
  Function getVCRedistURL
    ; $1 contains system architecture from checkArchitectureCompatibility
    ${If} $1 == "arm64"
      StrCpy $5 "https://aka.ms/vs/17/release/vc_redist.arm64.exe"
      StrCpy $6 "vc_redist.arm64.exe"
    ${ElseIf} $1 == "x86"
      StrCpy $5 "https://aka.ms/vs/17/release/vc_redist.x86.exe"
      StrCpy $6 "vc_redist.x86.exe"
    ${Else}
      ; Default to x64
      StrCpy $5 "https://aka.ms/vs/17/release/vc_redist.x64.exe"
      StrCpy $6 "vc_redist.x64.exe"
    ${EndIf}
  FunctionEnd

  ; Add function to clean up temporary files
  Function cleanupTempFiles
    ${If} ${FileExists} "$TEMP\$6"
      Delete "$TEMP\$6"
    ${EndIf}
  FunctionEnd

!endif

!macro customInit
  Push $0
  Push $1
  Push $2
  Push $3
  Push $4
  Push $5  ; VC Redist URL
  Push $6  ; VC Redist filename

  ; Check architecture compatibility first
  Call checkArchitectureCompatibility
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

  Call checkVCRedist
  ${If} $0 != "1"
    ; Get the correct VC Redist URL for the system architecture
    Call getVCRedistURL
    
    MessageBox MB_YESNO "\
      NOTE: ${PRODUCT_NAME} requires $\r$\n\
      'Microsoft Visual C++ Redistributable'$\r$\n\
      to function properly.$\r$\n$\r$\n\
      Download and install now?" /SD IDYES IDYES InstallVCRedist IDNO DontInstall
    InstallVCRedist:
      ; Download the appropriate version for the system architecture
      inetc::get /CAPTION "Downloading VC++ Redistributable" /BANNER "Downloading Microsoft Visual C++ Redistributable for $1..." "$5" "$TEMP\$6"
      Pop $7  ; Get download result
      ${If} $7 != "OK"
        MessageBox MB_ICONSTOP "\
          Failed to download Microsoft Visual C++ Redistributable.$\r$\n\
          Error: $7$\r$\n$\r$\n\
          Please check your internet connection and try again.$\r$\n\
          You can also download it manually from:$\r$\n\
          https://learn.microsoft.com/en-us/cpp/windows/latest-supported-vc-redist"
        Call cleanupTempFiles
        Abort
      ${EndIf}
      
      ; Install the redistributable
      ExecWait "$TEMP\$6 /install /quiet /norestart" $8
      ${If} $8 != 0
      ${AndIf} $8 != 3010  ; 3010 = success but reboot required
        MessageBox MB_ICONEXCLAMATION "\
          Microsoft Visual C++ Redistributable installation completed with code: $8$\r$\n\
          This may indicate a non-critical issue.$\r$\n$\r$\n\
          ${PRODUCT_NAME} installation will continue."
      ${EndIf}
      
      ; Clean up downloaded file
      Call cleanupTempFiles
      
      ; Verify installation
      Call checkVCRedist
      ${If} $0 == "1"
        Goto ContinueInstall
      ${Else}
        MessageBox MB_ICONEXCLAMATION "\
          Microsoft Visual C++ Redistributable verification failed.$\r$\n\
          ${PRODUCT_NAME} may not function properly.$\r$\n$\r$\n\
          Installation will continue, but you may need to install$\r$\n\
          the redistributable manually if issues occur."
        Goto ContinueInstall
      ${EndIf}

    DontInstall:
      MessageBox MB_ICONINFORMATION "\
        ${PRODUCT_NAME} installation will continue without$\r$\n\
        Microsoft Visual C++ Redistributable.$\r$\n$\r$\n\
        Note: The application may not function properly$\r$\n\
        without this component."
  ${EndIf}
  ContinueInstall:
    Pop $6
    Pop $5
    Pop $4
    Pop $3
    Pop $2
    Pop $1
    Pop $0
!macroend