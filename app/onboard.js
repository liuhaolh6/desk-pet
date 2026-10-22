/**
 * First-run welcome card.
 *
 * Three steps, one primary action. Everything is keyboard reachable: Enter on
 * 「知道啦」 dismisses, Escape dismisses too, and dismissal is what writes the
 * `onboarded` flag so the card never comes back on its own.
 */
(function () {
  const api = window.deskPet
  const $ = (id) => document.getElementById(id)

  /** Greet the user with whatever name the pet actually has. */
  function greet() {
    const node = $('obName')
    if (!node || !api || typeof api.getState !== 'function') return
    api.getState().then((state) => {
      const name = state && state.settings && state.settings.name
      if (name) node.textContent = String(name).slice(0, 20)
    }).catch(() => { /* keep the default name */ })
  }

  function dismiss(then) {
    if (typeof then === 'function') {
      try { then() } catch (err) { /* the window is closing anyway */ }
    }
    if (api && typeof api.dismissOnboard === 'function') api.dismissOnboard()
  }

  function wire() {
    const done = $('doneBtn')
    const settings = $('settingsBtn')
    if (done) done.addEventListener('click', () => dismiss())
    if (settings) {
      settings.addEventListener('click', () => {
        // Opening settings first, then dismissing, so the new window lands on
        // top of the card instead of behind it.
        dismiss(() => api.openSettings())
      })
    }
    document.addEventListener('keydown', (ev) => {
      if (ev.key !== 'Escape') return
      ev.preventDefault()
      dismiss()
    })
  }

  window.addEventListener('load', () => {
    // `autofocus` is not enough on every platform (the window may still be
    // hidden at parse time), so land the caret on the primary action.
    const done = $('doneBtn')
    if (done) {
      try { done.focus({ preventScroll: true }) } catch (err) { done.focus() }
    }
  })

  wire()
  greet()
})()