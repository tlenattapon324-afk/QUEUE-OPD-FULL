; Custom NSIS installer — fully offline, bundles all TTS voices

; Kill running instance silently before installer UI checks for it
!macro customInit
  ; Kill Electron app
  nsExec::Exec 'taskkill /F /IM "Queue-System-Opd.exe" /T'
  ; Kill any process still holding port 3200 (node.exe may outlive Electron on some systems)
  nsExec::Exec 'powershell -NoProfile -NonInteractive -Command "Stop-Process -Id (Get-NetTCPConnection -LocalPort 3200 -EA SilentlyContinue).OwningProcess -Force -EA SilentlyContinue"'
  ; Give OS time to release port before new version starts
  Sleep 1500
!macroend

!macro customInstall

  ; ════════════════════════════════════════════════════════════════
  ; 0. Uninstall previous version silently if found
  ; ════════════════════════════════════════════════════════════════
  ReadRegStr $9 HKLM "Software\Microsoft\Windows\CurrentVersion\Uninstall\Queue-System-Opd" "UninstallString"
  StrCmp $9 "" skip_uninstall
    ; Kill running process first
    ExecWait 'taskkill /F /IM "Queue-System-Opd.exe" /T' $0
    ; Run uninstaller silently, keep $INSTDIR so we install there
    ExecWait '"$9" /S _?=$INSTDIR'
  skip_uninstall:

  ; ════════════════════════════════════════════════════════════════
  ; 1. Microsoft Pattara — Thai (Thailand) OneCore [OFFLINE]
  ; ════════════════════════════════════════════════════════════════
  ReadRegStr $0 HKLM "SOFTWARE\Microsoft\Speech_OneCore\Voices\Tokens\MSTTS_V110_thTH_Pattara" ""
  StrCmp $0 "" 0 skip_pattara

    CreateDirectory "$WINDIR\Speech_OneCore\Engines\TTS\th-TH\NUSData"
    CreateDirectory "$WINDIR\System32\Speech_OneCore\common\th-TH"
    CreateDirectory "$WINDIR\SysWOW64\Speech_OneCore\Common\th-TH"

    SetOutPath "$WINDIR\Speech_OneCore\Engines\TTS\th-TH"
    File /nonfatal "${BUILD_RESOURCES_DIR}\voices\th-TH\M1054Pattara.apm"
    File /nonfatal "${BUILD_RESOURCES_DIR}\voices\th-TH\M1054Pattara.bep"
    File /nonfatal "${BUILD_RESOURCES_DIR}\voices\th-TH\M1054Pattara.heq"
    File /nonfatal "${BUILD_RESOURCES_DIR}\voices\th-TH\M1054Pattara.ini"
    File /nonfatal "${BUILD_RESOURCES_DIR}\voices\th-TH\MSTTSLocThTH.dat"
    File /nonfatal "${BUILD_RESOURCES_DIR}\voices\th-TH\MSTTSLocThTH.INI"

    SetOutPath "$WINDIR\Speech_OneCore\Engines\TTS\th-TH\NUSData"
    File /nonfatal "${BUILD_RESOURCES_DIR}\voices\th-TH\NUSData\M1054Pattara.keyboard.NU2"
    File /nonfatal "${BUILD_RESOURCES_DIR}\voices\th-TH\NUSData\M1054Pattara.keyboard.RAD"
    File /nonfatal "${BUILD_RESOURCES_DIR}\voices\th-TH\NUSData\M1054Pattara.keyboard.unt"
    File /nonfatal "${BUILD_RESOURCES_DIR}\voices\th-TH\NUSData\M1054Pattara.keyboard.WIH"
    File /nonfatal "${BUILD_RESOURCES_DIR}\voices\th-TH\NUSData\M1054Pattara.keyboard.WVE"

    ; These two paths are under System32/SysWOW64 and on some systems carry a
    ; TrustedInstaller-only ACL (Windows Resource Protection) that blocks writes even
    ; from an elevated Administrator — "File" would raise a blocking Abort/Retry/Ignore
    ; dialog in that case (that dialog is NOT silenced by /nonfatal, which only affects
    ; the compiler's behavior when the *source* file is missing at build time, not a
    ; runtime write failure). Route through a plain shell copy instead, whose exit code
    ; we never check, so a protected system fails silently and install just continues.
    SetOutPath "$PLUGINSDIR"
    File "${BUILD_RESOURCES_DIR}\voices\common-th\tokens_TTS_th-TH.xml"
    nsExec::Exec 'cmd /c copy /y "$PLUGINSDIR\tokens_TTS_th-TH.xml" "$WINDIR\System32\Speech_OneCore\common\th-TH\tokens_TTS_th-TH.xml"'
    nsExec::Exec 'cmd /c copy /y "$PLUGINSDIR\tokens_TTS_th-TH.xml" "$WINDIR\SysWOW64\Speech_OneCore\Common\th-TH\tokens_TTS_th-TH.xml"'

    WriteRegStr HKLM "SOFTWARE\Microsoft\Speech_OneCore\Voices\Tokens\MSTTS_V110_thTH_Pattara" "" "Microsoft Pattara - Thai (Thailand)"
    WriteRegStr HKLM "SOFTWARE\Microsoft\Speech_OneCore\Voices\Tokens\MSTTS_V110_thTH_Pattara" "41E" "Microsoft Pattara - Thai (Thailand)"
    WriteRegStr HKLM "SOFTWARE\Microsoft\Speech_OneCore\Voices\Tokens\MSTTS_V110_thTH_Pattara" "CLSID" "{179F3D56-1B0B-42B2-A962-59B7EF59FE1B}"
    WriteRegExpandStr HKLM "SOFTWARE\Microsoft\Speech_OneCore\Voices\Tokens\MSTTS_V110_thTH_Pattara" "LangDataPath" "%windir%\Speech_OneCore\Engines\TTS\th-TH\MSTTSLocThTH.dat"
    WriteRegExpandStr HKLM "SOFTWARE\Microsoft\Speech_OneCore\Voices\Tokens\MSTTS_V110_thTH_Pattara" "VoicePath" "%windir%\Speech_OneCore\Engines\TTS\th-TH\M1054Pattara"
    WriteRegStr HKLM "SOFTWARE\Microsoft\Speech_OneCore\Voices\Tokens\MSTTS_V110_thTH_Pattara\Attributes" "Age" "Adult"
    WriteRegStr HKLM "SOFTWARE\Microsoft\Speech_OneCore\Voices\Tokens\MSTTS_V110_thTH_Pattara\Attributes" "DataVersion" "11.0.2016.1016"
    WriteRegStr HKLM "SOFTWARE\Microsoft\Speech_OneCore\Voices\Tokens\MSTTS_V110_thTH_Pattara\Attributes" "Gender" "Male"
    WriteRegStr HKLM "SOFTWARE\Microsoft\Speech_OneCore\Voices\Tokens\MSTTS_V110_thTH_Pattara\Attributes" "Language" "41E"
    WriteRegStr HKLM "SOFTWARE\Microsoft\Speech_OneCore\Voices\Tokens\MSTTS_V110_thTH_Pattara\Attributes" "Name" "Microsoft Pattara"
    WriteRegStr HKLM "SOFTWARE\Microsoft\Speech_OneCore\Voices\Tokens\MSTTS_V110_thTH_Pattara\Attributes" "SayAsSupport" "spell=NativeSupported; alphanumeric=NativeSupported"
    WriteRegStr HKLM "SOFTWARE\Microsoft\Speech_OneCore\Voices\Tokens\MSTTS_V110_thTH_Pattara\Attributes" "SharedPronunciation" ""
    WriteRegStr HKLM "SOFTWARE\Microsoft\Speech_OneCore\Voices\Tokens\MSTTS_V110_thTH_Pattara\Attributes" "Vendor" "Microsoft"
    WriteRegStr HKLM "SOFTWARE\Microsoft\Speech_OneCore\Voices\Tokens\MSTTS_V110_thTH_Pattara\Attributes" "Version" "11.0"

  skip_pattara:

  ; Register Pattara in SAPI5 registry so System.Speech.Synthesis (PowerShell) can find it.
  ; Done unconditionally — safe if already present, required for SAPI fallback TTS to use Thai voice.
  WriteRegStr HKLM "SOFTWARE\Microsoft\Speech\Voices\Tokens\MSTTS_V110_thTH_Pattara" "" "Microsoft Pattara - Thai (Thailand)"
  WriteRegStr HKLM "SOFTWARE\Microsoft\Speech\Voices\Tokens\MSTTS_V110_thTH_Pattara" "41E" "Microsoft Pattara - Thai (Thailand)"
  WriteRegStr HKLM "SOFTWARE\Microsoft\Speech\Voices\Tokens\MSTTS_V110_thTH_Pattara" "CLSID" "{179F3D56-1B0B-42B2-A962-59B7EF59FE1B}"
  WriteRegExpandStr HKLM "SOFTWARE\Microsoft\Speech\Voices\Tokens\MSTTS_V110_thTH_Pattara" "LangDataPath" "%windir%\Speech_OneCore\Engines\TTS\th-TH\MSTTSLocThTH.dat"
  WriteRegExpandStr HKLM "SOFTWARE\Microsoft\Speech\Voices\Tokens\MSTTS_V110_thTH_Pattara" "VoicePath" "%windir%\Speech_OneCore\Engines\TTS\th-TH\M1054Pattara"
  WriteRegStr HKLM "SOFTWARE\Microsoft\Speech\Voices\Tokens\MSTTS_V110_thTH_Pattara\Attributes" "Age" "Adult"
  WriteRegStr HKLM "SOFTWARE\Microsoft\Speech\Voices\Tokens\MSTTS_V110_thTH_Pattara\Attributes" "DataVersion" "11.0.2016.1016"
  WriteRegStr HKLM "SOFTWARE\Microsoft\Speech\Voices\Tokens\MSTTS_V110_thTH_Pattara\Attributes" "Gender" "Male"
  WriteRegStr HKLM "SOFTWARE\Microsoft\Speech\Voices\Tokens\MSTTS_V110_thTH_Pattara\Attributes" "Language" "41E"
  WriteRegStr HKLM "SOFTWARE\Microsoft\Speech\Voices\Tokens\MSTTS_V110_thTH_Pattara\Attributes" "Name" "Microsoft Pattara"
  WriteRegStr HKLM "SOFTWARE\Microsoft\Speech\Voices\Tokens\MSTTS_V110_thTH_Pattara\Attributes" "Vendor" "Microsoft"
  WriteRegStr HKLM "SOFTWARE\Microsoft\Speech\Voices\Tokens\MSTTS_V110_thTH_Pattara\Attributes" "Version" "11.0"
  WriteRegStr HKLM "SOFTWARE\WOW6432Node\Microsoft\Speech\Voices\Tokens\MSTTS_V110_thTH_Pattara" "" "Microsoft Pattara - Thai (Thailand)"
  WriteRegStr HKLM "SOFTWARE\WOW6432Node\Microsoft\Speech\Voices\Tokens\MSTTS_V110_thTH_Pattara" "41E" "Microsoft Pattara - Thai (Thailand)"
  WriteRegStr HKLM "SOFTWARE\WOW6432Node\Microsoft\Speech\Voices\Tokens\MSTTS_V110_thTH_Pattara" "CLSID" "{179F3D56-1B0B-42B2-A962-59B7EF59FE1B}"
  WriteRegExpandStr HKLM "SOFTWARE\WOW6432Node\Microsoft\Speech\Voices\Tokens\MSTTS_V110_thTH_Pattara" "LangDataPath" "%windir%\Speech_OneCore\Engines\TTS\th-TH\MSTTSLocThTH.dat"
  WriteRegExpandStr HKLM "SOFTWARE\WOW6432Node\Microsoft\Speech\Voices\Tokens\MSTTS_V110_thTH_Pattara" "VoicePath" "%windir%\Speech_OneCore\Engines\TTS\th-TH\M1054Pattara"
  WriteRegStr HKLM "SOFTWARE\WOW6432Node\Microsoft\Speech\Voices\Tokens\MSTTS_V110_thTH_Pattara\Attributes" "Age" "Adult"
  WriteRegStr HKLM "SOFTWARE\WOW6432Node\Microsoft\Speech\Voices\Tokens\MSTTS_V110_thTH_Pattara\Attributes" "Gender" "Male"
  WriteRegStr HKLM "SOFTWARE\WOW6432Node\Microsoft\Speech\Voices\Tokens\MSTTS_V110_thTH_Pattara\Attributes" "Language" "41E"
  WriteRegStr HKLM "SOFTWARE\WOW6432Node\Microsoft\Speech\Voices\Tokens\MSTTS_V110_thTH_Pattara\Attributes" "Name" "Microsoft Pattara"
  WriteRegStr HKLM "SOFTWARE\WOW6432Node\Microsoft\Speech\Voices\Tokens\MSTTS_V110_thTH_Pattara\Attributes" "Vendor" "Microsoft"
  WriteRegStr HKLM "SOFTWARE\WOW6432Node\Microsoft\Speech\Voices\Tokens\MSTTS_V110_thTH_Pattara\Attributes" "Version" "11.0"

  ; ════════════════════════════════════════════════════════════════
  ; 2. en-US OneCore voices — David, Mark, Zira [OFFLINE]
  ; ════════════════════════════════════════════════════════════════
  ReadRegStr $1 HKLM "SOFTWARE\Microsoft\Speech_OneCore\Voices\Tokens\MSTTS_V110_enUS_David" ""
  StrCmp $1 "" 0 skip_enUS_onecore

    CreateDirectory "$WINDIR\Speech_OneCore\Engines\TTS\en-US\NUSData"

    SetOverwrite off
    SetOutPath "$WINDIR\Speech_OneCore\Engines\TTS\en-US"
    File /nonfatal "${BUILD_RESOURCES_DIR}\voices\en-US-onecore\M1033David.APM"
    File /nonfatal "${BUILD_RESOURCES_DIR}\voices\en-US-onecore\M1033David.BEP"
    File /nonfatal "${BUILD_RESOURCES_DIR}\voices\en-US-onecore\M1033David.INI"
    File /nonfatal "${BUILD_RESOURCES_DIR}\voices\en-US-onecore\M1033Mark.APM"
    File /nonfatal "${BUILD_RESOURCES_DIR}\voices\en-US-onecore\M1033Mark.BEP"
    File /nonfatal "${BUILD_RESOURCES_DIR}\voices\en-US-onecore\M1033Mark.INI"
    File /nonfatal "${BUILD_RESOURCES_DIR}\voices\en-US-onecore\M1033Mark.SPEECHUX.NUS"
    File /nonfatal "${BUILD_RESOURCES_DIR}\voices\en-US-onecore\M1033Mark.TBT.NUS"
    File /nonfatal "${BUILD_RESOURCES_DIR}\voices\en-US-onecore\M1033Zira.APM"
    File /nonfatal "${BUILD_RESOURCES_DIR}\voices\en-US-onecore\M1033Zira.BEP"
    File /nonfatal "${BUILD_RESOURCES_DIR}\voices\en-US-onecore\M1033Zira.INI"
    File /nonfatal "${BUILD_RESOURCES_DIR}\voices\en-US-onecore\M1033Zira.SPEECHUX.NUS"
    File /nonfatal "${BUILD_RESOURCES_DIR}\voices\en-US-onecore\M1033Zira.TBT.NUS"
    File /nonfatal "${BUILD_RESOURCES_DIR}\voices\en-US-onecore\M1033Eva.ACL"
    File /nonfatal "${BUILD_RESOURCES_DIR}\voices\en-US-onecore\M1033Eva.APM"
    File /nonfatal "${BUILD_RESOURCES_DIR}\voices\en-US-onecore\M1033Eva.BEP"
    File /nonfatal "${BUILD_RESOURCES_DIR}\voices\en-US-onecore\M1033Eva.BR2"
    File /nonfatal "${BUILD_RESOURCES_DIR}\voices\en-US-onecore\M1033Eva.HEQ"
    File /nonfatal "${BUILD_RESOURCES_DIR}\voices\en-US-onecore\M1033Eva.INI"
    File /nonfatal "${BUILD_RESOURCES_DIR}\voices\en-US-onecore\M1033Eva.NNM"
    File /nonfatal "${BUILD_RESOURCES_DIR}\voices\en-US-onecore\M1033Eva.TDAT"
    File /nonfatal "${BUILD_RESOURCES_DIR}\voices\en-US-onecore\M1033Eva.TON"
    File /nonfatal "${BUILD_RESOURCES_DIR}\voices\en-US-onecore\MSTTSLocEnUS.dat"
    File /nonfatal "${BUILD_RESOURCES_DIR}\voices\en-US-onecore\MSTTSLocEnUS.INI"
    File /nonfatal "${BUILD_RESOURCES_DIR}\voices\en-US-onecore\enUS.Address.dat"
    File /nonfatal "${BUILD_RESOURCES_DIR}\voices\en-US-onecore\enUS.CompanyName.dat"
    File /nonfatal "${BUILD_RESOURCES_DIR}\voices\en-US-onecore\enUS.Computer.dat"
    File /nonfatal "${BUILD_RESOURCES_DIR}\voices\en-US-onecore\enUS.Media.dat"
    File /nonfatal "${BUILD_RESOURCES_DIR}\voices\en-US-onecore\enUS.Message.dat"
    File /nonfatal "${BUILD_RESOURCES_DIR}\voices\en-US-onecore\enUS.Name.dat"

    SetOverwrite on

    WriteRegStr HKLM "SOFTWARE\Microsoft\Speech_OneCore\Voices\Tokens\MSTTS_V110_enUS_David" "" "Microsoft David - English (United States)"
    WriteRegStr HKLM "SOFTWARE\Microsoft\Speech_OneCore\Voices\Tokens\MSTTS_V110_enUS_David" "409" "Microsoft David - English (United States)"
    WriteRegStr HKLM "SOFTWARE\Microsoft\Speech_OneCore\Voices\Tokens\MSTTS_V110_enUS_David" "CLSID" "{179F3D56-1B0B-42B2-A962-59B7EF59FE1B}"
    WriteRegExpandStr HKLM "SOFTWARE\Microsoft\Speech_OneCore\Voices\Tokens\MSTTS_V110_enUS_David" "LangDataPath" "%windir%\Speech_OneCore\Engines\TTS\en-US\MSTTSLocEnUS.dat"
    WriteRegExpandStr HKLM "SOFTWARE\Microsoft\Speech_OneCore\Voices\Tokens\MSTTS_V110_enUS_David" "VoicePath" "%windir%\Speech_OneCore\Engines\TTS\en-US\M1033David"
    WriteRegStr HKLM "SOFTWARE\Microsoft\Speech_OneCore\Voices\Tokens\MSTTS_V110_enUS_David\Attributes" "Age" "Adult"
    WriteRegStr HKLM "SOFTWARE\Microsoft\Speech_OneCore\Voices\Tokens\MSTTS_V110_enUS_David\Attributes" "Gender" "Male"
    WriteRegStr HKLM "SOFTWARE\Microsoft\Speech_OneCore\Voices\Tokens\MSTTS_V110_enUS_David\Attributes" "Language" "409"
    WriteRegStr HKLM "SOFTWARE\Microsoft\Speech_OneCore\Voices\Tokens\MSTTS_V110_enUS_David\Attributes" "Name" "Microsoft David"
    WriteRegStr HKLM "SOFTWARE\Microsoft\Speech_OneCore\Voices\Tokens\MSTTS_V110_enUS_David\Attributes" "Vendor" "Microsoft"
    WriteRegStr HKLM "SOFTWARE\Microsoft\Speech_OneCore\Voices\Tokens\MSTTS_V110_enUS_David\Attributes" "Version" "11.0"

    WriteRegStr HKLM "SOFTWARE\Microsoft\Speech_OneCore\Voices\Tokens\MSTTS_V110_enUS_Mark" "" "Microsoft Mark - English (United States)"
    WriteRegStr HKLM "SOFTWARE\Microsoft\Speech_OneCore\Voices\Tokens\MSTTS_V110_enUS_Mark" "409" "Microsoft Mark - English (United States)"
    WriteRegStr HKLM "SOFTWARE\Microsoft\Speech_OneCore\Voices\Tokens\MSTTS_V110_enUS_Mark" "CLSID" "{179F3D56-1B0B-42B2-A962-59B7EF59FE1B}"
    WriteRegExpandStr HKLM "SOFTWARE\Microsoft\Speech_OneCore\Voices\Tokens\MSTTS_V110_enUS_Mark" "LangDataPath" "%windir%\Speech_OneCore\Engines\TTS\en-US\MSTTSLocEnUS.dat"
    WriteRegExpandStr HKLM "SOFTWARE\Microsoft\Speech_OneCore\Voices\Tokens\MSTTS_V110_enUS_Mark" "VoicePath" "%windir%\Speech_OneCore\Engines\TTS\en-US\M1033Mark"
    WriteRegStr HKLM "SOFTWARE\Microsoft\Speech_OneCore\Voices\Tokens\MSTTS_V110_enUS_Mark\Attributes" "Age" "Adult"
    WriteRegStr HKLM "SOFTWARE\Microsoft\Speech_OneCore\Voices\Tokens\MSTTS_V110_enUS_Mark\Attributes" "Gender" "Male"
    WriteRegStr HKLM "SOFTWARE\Microsoft\Speech_OneCore\Voices\Tokens\MSTTS_V110_enUS_Mark\Attributes" "Language" "409"
    WriteRegStr HKLM "SOFTWARE\Microsoft\Speech_OneCore\Voices\Tokens\MSTTS_V110_enUS_Mark\Attributes" "Name" "Microsoft Mark"
    WriteRegStr HKLM "SOFTWARE\Microsoft\Speech_OneCore\Voices\Tokens\MSTTS_V110_enUS_Mark\Attributes" "Vendor" "Microsoft"
    WriteRegStr HKLM "SOFTWARE\Microsoft\Speech_OneCore\Voices\Tokens\MSTTS_V110_enUS_Mark\Attributes" "Version" "11.0"

    WriteRegStr HKLM "SOFTWARE\Microsoft\Speech_OneCore\Voices\Tokens\MSTTS_V110_enUS_Zira" "" "Microsoft Zira - English (United States)"
    WriteRegStr HKLM "SOFTWARE\Microsoft\Speech_OneCore\Voices\Tokens\MSTTS_V110_enUS_Zira" "409" "Microsoft Zira - English (United States)"
    WriteRegStr HKLM "SOFTWARE\Microsoft\Speech_OneCore\Voices\Tokens\MSTTS_V110_enUS_Zira" "CLSID" "{179F3D56-1B0B-42B2-A962-59B7EF59FE1B}"
    WriteRegExpandStr HKLM "SOFTWARE\Microsoft\Speech_OneCore\Voices\Tokens\MSTTS_V110_enUS_Zira" "LangDataPath" "%windir%\Speech_OneCore\Engines\TTS\en-US\MSTTSLocEnUS.dat"
    WriteRegExpandStr HKLM "SOFTWARE\Microsoft\Speech_OneCore\Voices\Tokens\MSTTS_V110_enUS_Zira" "VoicePath" "%windir%\Speech_OneCore\Engines\TTS\en-US\M1033Zira"
    WriteRegStr HKLM "SOFTWARE\Microsoft\Speech_OneCore\Voices\Tokens\MSTTS_V110_enUS_Zira\Attributes" "Age" "Adult"
    WriteRegStr HKLM "SOFTWARE\Microsoft\Speech_OneCore\Voices\Tokens\MSTTS_V110_enUS_Zira\Attributes" "Gender" "Female"
    WriteRegStr HKLM "SOFTWARE\Microsoft\Speech_OneCore\Voices\Tokens\MSTTS_V110_enUS_Zira\Attributes" "Language" "409"
    WriteRegStr HKLM "SOFTWARE\Microsoft\Speech_OneCore\Voices\Tokens\MSTTS_V110_enUS_Zira\Attributes" "Name" "Microsoft Zira"
    WriteRegStr HKLM "SOFTWARE\Microsoft\Speech_OneCore\Voices\Tokens\MSTTS_V110_enUS_Zira\Attributes" "Vendor" "Microsoft"
    WriteRegStr HKLM "SOFTWARE\Microsoft\Speech_OneCore\Voices\Tokens\MSTTS_V110_enUS_Zira\Attributes" "Version" "11.0"

  skip_enUS_onecore:

  ; ════════════════════════════════════════════════════════════════
  ; 3. en-US SAPI5 Desktop — Microsoft Zira Desktop [OFFLINE]
  ; ════════════════════════════════════════════════════════════════
  ReadRegStr $2 HKLM "SOFTWARE\Microsoft\Speech\Voices\Tokens\TTS_MS_EN-US_ZIRA_11.0" ""
  StrCmp $2 "" 0 skip_zira_desktop

    CreateDirectory "$WINDIR\Speech\Engines\TTS\en-US"

    SetOutPath "$WINDIR\Speech\Engines\TTS\en-US"
    File /nonfatal "${BUILD_RESOURCES_DIR}\voices\en-US-sapi5\M1033ZIR.APM"
    File /nonfatal "${BUILD_RESOURCES_DIR}\voices\en-US-sapi5\M1033ZIR.INI"
    File /nonfatal "${BUILD_RESOURCES_DIR}\voices\en-US-sapi5\M1033ZIR.Keyboard.NUS"
    File /nonfatal "${BUILD_RESOURCES_DIR}\voices\en-US-sapi5\MSTTSLocEnUS.dat"

    WriteRegStr HKLM "SOFTWARE\Microsoft\Speech\Voices\Tokens\TTS_MS_EN-US_ZIRA_11.0" "" "Microsoft Zira Desktop - English (United States)"
    WriteRegStr HKLM "SOFTWARE\Microsoft\Speech\Voices\Tokens\TTS_MS_EN-US_ZIRA_11.0" "409" "Microsoft Zira Desktop - English (United States)"
    WriteRegStr HKLM "SOFTWARE\Microsoft\Speech\Voices\Tokens\TTS_MS_EN-US_ZIRA_11.0" "CLSID" "{0EF96F0B-F0D4-4B42-9A8B-F14E6A4C62CD}"
    WriteRegExpandStr HKLM "SOFTWARE\Microsoft\Speech\Voices\Tokens\TTS_MS_EN-US_ZIRA_11.0" "LangDataPath" "%windir%\Speech\Engines\TTS\en-US\MSTTSLocEnUS.dat"
    WriteRegExpandStr HKLM "SOFTWARE\Microsoft\Speech\Voices\Tokens\TTS_MS_EN-US_ZIRA_11.0" "VoicePath" "%windir%\Speech\Engines\TTS\en-US\M1033ZIR"
    WriteRegStr HKLM "SOFTWARE\Microsoft\Speech\Voices\Tokens\TTS_MS_EN-US_ZIRA_11.0\Attributes" "Age" "Adult"
    WriteRegStr HKLM "SOFTWARE\Microsoft\Speech\Voices\Tokens\TTS_MS_EN-US_ZIRA_11.0\Attributes" "Gender" "Female"
    WriteRegStr HKLM "SOFTWARE\Microsoft\Speech\Voices\Tokens\TTS_MS_EN-US_ZIRA_11.0\Attributes" "Language" "409"
    WriteRegStr HKLM "SOFTWARE\Microsoft\Speech\Voices\Tokens\TTS_MS_EN-US_ZIRA_11.0\Attributes" "Name" "Microsoft Zira Desktop"
    WriteRegStr HKLM "SOFTWARE\Microsoft\Speech\Voices\Tokens\TTS_MS_EN-US_ZIRA_11.0\Attributes" "Vendor" "Microsoft"
    WriteRegStr HKLM "SOFTWARE\Microsoft\Speech\Voices\Tokens\TTS_MS_EN-US_ZIRA_11.0\Attributes" "Version" "11.0"
    WriteRegStr HKLM "SOFTWARE\WOW6432Node\Microsoft\Speech\Voices\Tokens\TTS_MS_EN-US_ZIRA_11.0" "" "Microsoft Zira Desktop - English (United States)"
    WriteRegStr HKLM "SOFTWARE\WOW6432Node\Microsoft\Speech\Voices\Tokens\TTS_MS_EN-US_ZIRA_11.0" "409" "Microsoft Zira Desktop - English (United States)"
    WriteRegStr HKLM "SOFTWARE\WOW6432Node\Microsoft\Speech\Voices\Tokens\TTS_MS_EN-US_ZIRA_11.0" "CLSID" "{0EF96F0B-F0D4-4B42-9A8B-F14E6A4C62CD}"
    WriteRegExpandStr HKLM "SOFTWARE\WOW6432Node\Microsoft\Speech\Voices\Tokens\TTS_MS_EN-US_ZIRA_11.0" "LangDataPath" "%windir%\Speech\Engines\TTS\en-US\MSTTSLocEnUS.dat"
    WriteRegExpandStr HKLM "SOFTWARE\WOW6432Node\Microsoft\Speech\Voices\Tokens\TTS_MS_EN-US_ZIRA_11.0" "VoicePath" "%windir%\Speech\Engines\TTS\en-US\M1033ZIR"
    WriteRegStr HKLM "SOFTWARE\WOW6432Node\Microsoft\Speech\Voices\Tokens\TTS_MS_EN-US_ZIRA_11.0\Attributes" "Age" "Adult"
    WriteRegStr HKLM "SOFTWARE\WOW6432Node\Microsoft\Speech\Voices\Tokens\TTS_MS_EN-US_ZIRA_11.0\Attributes" "Gender" "Female"
    WriteRegStr HKLM "SOFTWARE\WOW6432Node\Microsoft\Speech\Voices\Tokens\TTS_MS_EN-US_ZIRA_11.0\Attributes" "Language" "409"
    WriteRegStr HKLM "SOFTWARE\WOW6432Node\Microsoft\Speech\Voices\Tokens\TTS_MS_EN-US_ZIRA_11.0\Attributes" "Name" "Microsoft Zira Desktop"
    WriteRegStr HKLM "SOFTWARE\WOW6432Node\Microsoft\Speech\Voices\Tokens\TTS_MS_EN-US_ZIRA_11.0\Attributes" "Vendor" "Microsoft"
    WriteRegStr HKLM "SOFTWARE\WOW6432Node\Microsoft\Speech\Voices\Tokens\TTS_MS_EN-US_ZIRA_11.0\Attributes" "Version" "11.0"

  skip_zira_desktop:

  ; ════════════════════════════════════════════════════════════════
  ; 4. Copy pre-built TTS audio cache → AppData (offline, no internet needed)
  ; ════════════════════════════════════════════════════════════════
  SetShellVarContext all
  CreateDirectory "$APPDATA\queue-opd\tts-cache"
  SetOutPath "$APPDATA\queue-opd\tts-cache"
  File /nonfatal /r "${BUILD_RESOURCES_DIR}\tts-cache\*.mp3"

!macroend

!macro customUninstall
  ; Keep voices — system may use them with other programs
!macroend
