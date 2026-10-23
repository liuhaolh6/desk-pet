'use strict'
// Applies the active theme pack inside a renderer (ROADMAP P2-7).
//
// The CSS string is produced and validated in the main process; this file only
// owns the `<style>` node. Main-process `insertCSS` was tried first and does not
// reach later-created windows reliably, so the pack is applied from the page.

;(function () {
  if (!window.deskPet || !window.deskPet.getTheme) return

  const style = document.createElement('style')
  style.id = 'theme-pack'
  ;(document.head || document.documentElement).appendChild(style)

  let applied = null

  async function apply() {
    let res = null
    try {
      res = await window.deskPet.getTheme()
    } catch (err) {
      return
    }
    const css = (res && res.css) || ''
    if (css === applied) return
    applied = css
    style.textContent = css
  }

  apply()
  if (window.deskPet.onThemeChanged) window.deskPet.onThemeChanged(apply)
})()