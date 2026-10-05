; Uninstall: ask whether to delete the data in %APPDATA%\Everloom (chats, characters, media,
; backups). The answer defaults to keeping it; a silent uninstall (/S) always keeps it.
!macro customUnInstall
  IfSilent keep_data
  ; An update reinstalls over the old version: never delete data then.
  ${ifNot} ${isUpdated}
    MessageBox MB_YESNO|MB_ICONQUESTION|MB_DEFBUTTON2 "Also delete your Everloom data (chats, characters, pictures and backups in $APPDATA\Everloom)?$\r$\n$\r$\nChoose No to keep it for a later install." IDYES delete_data IDNO keep_data
  ${endIf}
  Goto keep_data
  delete_data:
    RMDir /r "$APPDATA\Everloom"
  keep_data:
!macroend
