; Primera instalacion: carpeta + copiar + finalizar.
; Actualizacion desde la app (--updated): solo copiar archivos, sin Siguiente.
; No usar !insertmacro StartApp aqui: declara startAppArgs otra vez y rompe makensis.

!macro customFinishPage
  !insertmacro skipPageIfUpdated
  !ifndef HIDE_RUN_AFTER_FINISH
    Function StartApp
      ${if} ${isUpdated}
        StrCpy $1 "--updated"
      ${else}
        StrCpy $1 ""
      ${endif}
      ${StdUtils.ExecShellAsUser} $0 "$launchLink" "open" "$1"
    FunctionEnd
    !define MUI_FINISHPAGE_RUN
    !define MUI_FINISHPAGE_RUN_FUNCTION "StartApp"
  !endif
  !insertmacro MUI_PAGE_FINISH
!macroend

!macro customInstall
  ${if} ${isUpdated}
    HideWindow
    ${StdUtils.ExecShellAsUser} $0 "$launchLink" "open" "--updated"
  ${endif}
!macroend
