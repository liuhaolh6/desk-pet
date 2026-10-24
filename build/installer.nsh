; 安装器兜底（electron-builder 的 customInit 钩子）
;
; 背景：electron-builder 的 installUtil.nsh 会读注册表里的旧卸载器路径，
; 复制到临时目录后静默执行。若卸载器文件已不存在（用户删了安装目录、
; 或残留了注册表项），流程会走进重试循环，最终弹出「DeskPet 无法关闭」
; ——文案与真实原因无关（该 message id 也被解包失败分支复用）。
;
; 这里在初始化阶段把「有安装记录、但没有卸载器」的残留清掉，
; 让安装器走全新安装路径，不进入上面那条弯路。

!macro customInit
  ReadRegStr $0 HKCU "${INSTALL_REGISTRY_KEY}" InstallLocation
  ${If} $0 != ""
    ${IfNot} ${FileExists} "$0\Uninstall ${PRODUCT_FILENAME}.exe"
      DeleteRegKey HKCU "${INSTALL_REGISTRY_KEY}"
      DeleteRegKey HKCU "${UNINSTALL_REGISTRY_KEY}"
      !ifdef UNINSTALL_REGISTRY_KEY_2
        DeleteRegKey HKCU "${UNINSTALL_REGISTRY_KEY_2}"
      !endif
    ${EndIf}
  ${EndIf}
!macroend