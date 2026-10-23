'use strict'
// Dev-only startup switches (`DESKPET_OPEN_*`). They exist so a window can be
// opened for a CDP check without clicking; production launches never set them.
//
// M17 P0-1: first run gets the three-step card (once). Installs that never
// dismissed it see it once too; after that `onboarded` is true and the only way
// back in is 设置 → 其他 → 再看一次欢迎引导.
function windows({ windows, store, log }) {
  if (process.env.DESKPET_OPEN_SETTINGS === '1') setTimeout(() => windows.openSettings(), 800)
  if (process.env.DESKPET_OPEN_EDITOR === '1') setTimeout(() => windows.openEditor(), 800)
  if (process.env.DESKPET_OPEN_ONBOARD === '1') {
    setTimeout(() => windows.openOnboard(true), 800)
    return
  }
  if (process.env.DESKPET_NO_ONBOARD === '1') return
  let onboarded = false
  try {
    onboarded = store.readSettings().onboarded === true
  } catch (err) {
    log('onboard-check-failed', err && err.message)
  }
  if (!onboarded) setTimeout(() => windows.openOnboard(false), 1400)
}

module.exports = { windows }