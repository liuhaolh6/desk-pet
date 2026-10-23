'use strict'
// Fills in the user-data defaults that ship with a language (ROADMAP P2-6).
// Kept out of main.js so the assembly file stays readable.
function seedDefaults(store, i18n) {
  const tr = (k) => i18n.t(k)
  const cfg = store.readSettings()
  const patch = {}
  if (!cfg.name) patch.name = tr('defaults.name')
  if (cfg.weather && !cfg.weather.label) {
    patch.weather = Object.assign({}, cfg.weather, { label: tr('defaults.cityAuto') })
  }
  if (!Array.isArray(cfg.roles) || !cfg.roles.length) {
    patch.roles = [{ id: 'default', name: tr('defaults.roleName'), builtin: true, createdAt: 0 }]
  }
  if (Object.keys(patch).length) {
    try {
      store.writeSettings(patch)
    } catch (err) {
      // 默认值补不上不影响启动
    }
  }
}

module.exports = { seedDefaults }