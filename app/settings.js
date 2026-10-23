/**
 * Settings window. Every control writes the whole patch through
 * `deskPet.setSettings`, which persists and broadcasts to the pet window.
 */
(function () {
  const api = window.deskPet
  const sound = window.DeskPetSound
  const $ = (id) => document.getElementById(id)
  // P2-6 stage 3: this window's copy comes from the dictionary too.
  const i18nLib = window.deskPetI18n
  const i18nBridge = (api && api.i18n) || null
  const t = (key, vars) => (i18nBridge ? i18nBridge.t(key, vars) : key)
  /** Dictionary value, or the markup's own text when the key is not translated. */
  const tOr = (key, fallback) => {
    const value = t(key)
    return value && value !== key ? value : fallback
  }
  if (i18nLib && i18nBridge) i18nLib.applyStatic(document, i18nBridge)

  const state = { settings: null, roles: [], sounds: [], saveTimer: 0 }

  const clamp = (n, lo, hi) => Math.min(hi, Math.max(lo, n))

  function setStatus(text, hold) {
    const node = $('status')
    if (!node) return
    node.textContent = text
    clearTimeout(setStatus.timer)
    if (hold === 0) return // keep it until something else happens
    setStatus.timer = setTimeout(() => { node.textContent = t('settings.statusDefault') }, hold || 2200)
  }

  /** Persistent reminder of which place the weather is actually using. */
  function renderCityNow(settings) {
    const node = $('cityNow')
    if (!node) return
    const w = (settings && settings.weather) || {}
    if (!w.city) { node.textContent = t('weather.cityNowEmpty'); return }
    const where = w.city + (w.label ? ' · ' + w.label : '')
    node.textContent = Number.isFinite(Number(w.lat))
      ? t('weather.cityNowCoords', { city: where, lat: Number(w.lat).toFixed(2), lon: Number(w.lon).toFixed(2) })
      : t('weather.cityNow', { city: where })
  }

  // --------------------------------------------------------------- panel nav
  function selectPanel(id) {
    const nav = Array.from(document.querySelectorAll('.nav-item'))
    const target = nav.find((btn) => btn.dataset.panel === id) || nav[0]
    if (!target) return
    const panelId = target.dataset.panel
    nav.forEach((btn) => {
      const on = btn === target
      btn.classList.toggle('active', on)
      btn.setAttribute('aria-current', on ? 'page' : 'false')
    })
    document.querySelectorAll('.panel').forEach((panel) => {
      const on = panel.dataset.panel === panelId
      panel.classList.toggle('active', on)
      panel.hidden = !on
    })
    if (panelId === 'reminder') refreshWaterStats()
    const title = $('panelTitle')
    const hint = $('panelHint')
    // Titles/hints live in the dictionary; the markup carries no Chinese any more.
    if (title) title.textContent = tOr('panel.' + panelId + '.title', target.dataset.title || '')
    if (hint) hint.textContent = tOr('panel.' + panelId + '.hint', '')
    // Focus the first control so keyboard users don't have to tab through the
    // whole sidebar after switching sections.
    const first = document.querySelector('.panel.active input, .panel.active select, .panel.active textarea, .panel.active button')
    if (first && document.activeElement && document.activeElement.classList.contains('nav-item')) {
      first.focus({ preventScroll: true })
    }
  }

  function wireNav() {
    document.querySelectorAll('.nav-item').forEach((btn) => {
      btn.addEventListener('click', () => selectPanel(btn.dataset.panel))
    })
  }

  function save(patch, immediate, message) {
    state.settings = Object.assign({}, state.settings, patch)
    if (state.saveTimer) clearTimeout(state.saveTimer)
    const fire = () => {
      api.setSettings(patch).then((next) => {
        state.settings = next
        setStatus(message || t('settings.saved'))
      }).catch(() => setStatus(t('settings.saveFailed')))
    }
    if (immediate) fire()
    else state.saveTimer = setTimeout(fire, 350)
  }

  // ------------------------------------------------------------------- form
  function fill(settings) {
    state.settings = settings
    const active = document.activeElement
    const setIfIdle = (id, value) => {
      const node = $(id)
      if (!node || node === active) return
      node.value = value
    }
    setIfIdle('name', settings.name || '')
    setIfIdle('localeSelect', settings.locale || '')
    setIfIdle('size', settings.size)
    $('sizeVal').textContent = settings.size + 'px'
    $('alwaysOnTop').checked = !!settings.alwaysOnTop
    $('autostart').checked = !!settings.autostart
    $('snapEnabled').checked = !!(settings.snap && settings.snap.enabled)
    if (document.activeElement !== $('snapGap')) {
      $('snapGap').value = String((settings.snap && settings.snap.gap) == null ? 18 : settings.snap.gap)
    }
    $('mode').value = settings.mode || 'normal'
    setIfIdle('city', settings.weather && settings.weather.city ? settings.weather.city : '')
    renderCityNow(settings)
    $('refreshMinutes').value = String((settings.weather && settings.weather.refreshMinutes) || 15)
    $('interval').value = String((settings.water && settings.water.intervalMinutes) || 60)
    setIfIdle('quietFrom', settings.water ? settings.water.quietFrom : 23)
    setIfIdle('quietTo', settings.water ? settings.water.quietTo : 8)
    const nudge = settings.nudge || {}
    $('nudgeEnabled').checked = nudge.enabled !== false
    $('updateBootToggle').checked = !(settings.update && settings.update.checkOnBoot === false)
    $('nudgeLongUse').checked = nudge.longUse !== false
    $('nudgeLateNight').checked = nudge.lateNight !== false
    $('nudgeAway').checked = nudge.away !== false
    setIfIdle('cupMl', (settings.water && settings.water.cupMl) || 200)
    setIfIdle('autoHide', settings.bubble ? settings.bubble.autoHideSeconds : 20)
    setIfIdle('cooldown', settings.bubble ? settings.bubble.cooldownMinutes : 30)
    if (document.activeElement !== $('phrases')) {
      $('phrases').value = ((settings.bubble && settings.bubble.phrases) || []).join('\n')
    }
    $('sound').checked = !!(settings.sound && settings.sound.enabled)
    const soundVolume = Math.round((Number(settings.sound && settings.sound.volume) || 0.45) * 100)
    $('soundVolume').value = String(soundVolume)
    $('soundVolumeVal').textContent = soundVolume + '%'
    renderSoundEvents()
    renderSoundFiles()
    renderRoles()
    renderRecentCities(settings)
  }

  function renderRoles() {
    const box = $('roles')
    box.innerHTML = ''
    const current = state.settings && state.settings.roleId
    state.roles.forEach((role) => {
      const card = document.createElement('div')
      card.className = 'role' + (role.id === current ? ' current' : '')
      const img = document.createElement('img')
      img.src = role.url
      img.alt = role.name
      card.appendChild(img)
      if (role.cutout === false) {
        const badge = document.createElement('em')
        badge.className = 'role-badge'
        badge.textContent = t('role.wholePhoto')
        badge.title = t('role.wholePhotoTitle')
        card.appendChild(badge)
      }
      const label = document.createElement('span')
      label.textContent = role.name
      card.appendChild(label)
      card.onclick = () => {
        save({ roleId: role.id }, true)
        renderRoles()
      }
      if (!role.builtin) {
        const del = document.createElement('button')
        del.className = 'remove'
        del.textContent = t('role.delete')
        del.onclick = (ev) => {
          ev.stopPropagation()
          api.deleteRole(role.id).then((result) => {
            state.roles = result.roles || []
            setStatus(result.ok ? t('role.deleted') : t('settings.deleteFailed'))
            renderRoles()
          })
        }
        card.appendChild(del)
      }
      box.appendChild(card)
    })
  }

  function renderThemes(packs, current) {
    const sel = $('themeSelect')
    if (!sel) return
    const usable = (packs || []).filter((p) => p.ok)
    sel.innerHTML = ''
    for (const pack of usable) {
      const opt = document.createElement('option')
      opt.value = pack.id
      // Unknown packs (user import) fall back to their id so the row is usable.
      opt.textContent = t(pack.nameKey || 'theme.' + pack.id) || pack.id
      if (pack.id === current) opt.selected = true
      sel.appendChild(opt)
    }
    sel.value = current
  }

  async function loadThemes() {
    try {
      const res = await api.getThemes()
      renderThemes(res && res.packs, res && res.current)
    } catch (err) {
      /* a broken theme folder must not block the rest of the page */
    }
  }

  function wire() {
    wireFind()
    wireReset()
    $('name').addEventListener('input', (ev) => {
      const value = ev.target.value.trim() || t('appearance.namePlaceholder')
      save({ name: value })
    })

    $('size').addEventListener('input', (ev) => {
      const value = Number(ev.target.value)
      $('sizeVal').textContent = value + 'px'
      save({ size: value })
    })

    const themeSel = $('themeSelect')
    if (themeSel) {
      themeSel.addEventListener('change', async (ev) => {
        const id = ev.target.value
        const res = await api.setTheme(id)
        if (res && res.ok) setStatus(t('settings.saved').replace('{what}', t('theme.' + id)))
        else setStatus(t('settings.saveFailed'))
      })
    }

    $('alwaysOnTop').addEventListener('change', (ev) => save({ alwaysOnTop: ev.target.checked }, true))
    $('autostart').addEventListener('change', (ev) => save({ autostart: ev.target.checked }, true))
    $('snapEnabled').addEventListener('change', (ev) => save({ snap: { enabled: ev.target.checked } }, true))
    $('snapGap').addEventListener('change', (ev) => {
      const gap = clamp(Number(ev.target.value) || 0, 0, 80)
      ev.target.value = String(gap)
      save({ snap: { gap } }, true)
    })
    $('mode').addEventListener('change', (ev) => save({ mode: ev.target.value }, true))
    // P2-6：语言只在启动时读一次字典，所以这里明确告诉用户要重开。
    const localeSelect = $('localeSelect')
    if (localeSelect) {
      localeSelect.addEventListener('change', () => save({ locale: localeSelect.value }, true, t('settings.localeChanged')))
    }
    $('refreshMinutes').addEventListener('change', (ev) => {
      save({ weather: { refreshMinutes: Number(ev.target.value) } }, true)
    })
    $('interval').addEventListener('change', (ev) => {
      save({ water: { intervalMinutes: Number(ev.target.value) } }, true)
    })
    $('quietFrom').addEventListener('change', (ev) => {
      save({ water: { quietFrom: clamp(Number(ev.target.value) || 0, 0, 23) } }, true)
    })
    $('quietTo').addEventListener('change', (ev) => {
      save({ water: { quietTo: clamp(Number(ev.target.value) || 0, 0, 23) } }, true)
    })
    $('nudgeEnabled').addEventListener('change', (ev) => save({ nudge: { enabled: ev.target.checked } }, true))
    $('nudgeLongUse').addEventListener('change', (ev) => save({ nudge: { longUse: ev.target.checked } }, true))
    $('nudgeLateNight').addEventListener('change', (ev) => save({ nudge: { lateNight: ev.target.checked } }, true))
    $('nudgeAway').addEventListener('change', (ev) => save({ nudge: { away: ev.target.checked } }, true))
    $('cupMl').addEventListener('change', (ev) => {
      const cupMl = clamp(Number(ev.target.value) || 200, 50, 1000)
      ev.target.value = String(cupMl)
      save({ water: { cupMl } }, true)
    })
    $('exportWaterBtn').addEventListener('click', () => {
      const btn = $('exportWaterBtn')
      btn.disabled = true
      api.exportWaterCsv().then((result) => {
        if (!result || !result.ok) {
          setStatus(t('other.exportFailed'))
          $('waterExportHint').textContent = (result && result.error) || t('other.exportFailedShort')
          return
        }
        $('waterExportHint').textContent = t('other.exported', { path: result.path || '', rows: result.rows || 0 })
        setStatus(t('other.exportedStatus'))
      }).catch(() => setStatus(t('other.exportFailed'))).finally(() => { btn.disabled = false })
    })
    $('autoHide').addEventListener('change', (ev) => {
      save({ bubble: { autoHideSeconds: clamp(Number(ev.target.value) || 0, 0, 120) } }, true)
    })
    $('cooldown').addEventListener('change', (ev) => {
      save({ bubble: { cooldownMinutes: clamp(Number(ev.target.value) || 0, 0, 240) } }, true)
    })
    if ($('phrases')) $('phrases').placeholder = t('settings.bubble.phrasesPlaceholder')
  $('phrases').addEventListener('change', (ev) => {
      const phrases = ev.target.value.split('\n').map((s) => s.trim()).filter(Boolean).slice(0, 30)
      save({ bubble: { phrases } }, true)
    })
    $('sound').addEventListener('change', (ev) => save({ sound: { enabled: ev.target.checked } }, true))
    $('soundVolume').addEventListener('input', (ev) => {
      const value = Number(ev.target.value)
      $('soundVolumeVal').textContent = value + '%'
      save({ sound: { volume: value / 100 } })
    })
    $('soundImportBtn').addEventListener('click', () => {
      setStatus(t('sound.pickAudio'))
      api.importSound().then((result) => {
        if (!result || result.canceled) { setStatus(t('settings.canceled')); return }
        if (!result.ok) { setStatus(result.error || t('settings.importFailed')); return }
        state.sounds = result.files || []
        renderSoundEvents()
        renderSoundFiles()
        setStatus(t('settings.imported', { name: result.file.name }))
      }).catch(() => setStatus(t('settings.importFailed')))
    })
    $('editorBtn').addEventListener('click', () => api.openEditor())
    $('onboardBtn').addEventListener('click', () => api.openOnboard())

    $('searchBtn').addEventListener('click', () => search($('city').value))
    $('city').addEventListener('keydown', (ev) => { if (ev.key === 'Enter') search($('city').value) })
    $('locateBtn').addEventListener('click', locate)

    $('importBtn').addEventListener('click', () => {
      setStatus(t('role.pickImage'))
      api.importRole().then((result) => {
        if (!result || result.canceled) { setStatus(t('settings.canceled')); return }
        if (!result.ok) { setStatus(result.error || t('settings.importFailed')); return }
        state.roles = result.roles || []
        return api.getState().then((next) => { fill(next.settings); setStatus(t('settings.imported', { name: result.role.name })) })
      }).catch(() => setStatus(t('settings.importFailed')))
    })

    $('cutoutBtn').addEventListener('click', () => {
      setStatus(t('role.openingCutout'))
      api.openCutout()
    })

    $('resetPosBtn').addEventListener('click', () => { save({ position: null }, true); setStatus(t('role.positionReset')) })
    $('openDirBtn').addEventListener('click', () => api.openDataDir())
    // P0-5: one click writes a redacted diagnostics txt next to the settings.
    $('diagBtn').addEventListener('click', async () => {
      const btn = $('diagBtn')
      const hint = $('diagStatus')
      btn.disabled = true
      hint.textContent = t('other.diagCollecting')
      try {
        const result = await api.exportDiagnostics()
        hint.textContent = t('other.diagDone', { path: result.path })
        setStatus(t('other.diagExported'))
      } catch (err) {
        hint.textContent = t('other.diagFailed', { message: (err && err.message) || String(err) })
        setStatus(t('other.diagFailedStatus'))
      } finally {
        btn.disabled = false
      }
    })
    // P2-3: 更新检查。自动检查只提示；静默安装要等签名版本，这里只给“去下载”。
    $('updateBtn').addEventListener('click', async () => {
      const btn = $('updateBtn')
      const hint = $('updateStatus')
      btn.disabled = true
      hint.textContent = t('other.updateChecking')
      try {
        const decision = await api.checkUpdate(true)
        if (decision && decision.kind !== 'none' && decision.url) {
          const info = await api.getUpdateStatus().catch(() => null)
          hint.textContent = t('other.updateAvailable', { version: decision.version, current: (info && info.version) || '' })
          btn.textContent = t('other.updateDownload', { version: decision.version })
          btn.disabled = false
          btn.onclick = () => api.openUpdate(decision.url)
          setStatus(t('other.updateFound', { version: decision.version }))
          return
        }
        const reasons = {
          'up-to-date': t('other.updateReasonUpToDate'),
          throttled: t('other.updateReasonThrottled'),
          'no-feed': t('other.updateReasonNoFeed'),
          skipped: t('other.updateReasonSkipped'),
          error: t('other.updateReasonError'),
        }
        hint.textContent = reasons[decision && decision.reason] || t('other.updateReasonUpToDate')
        setStatus(hint.textContent)
      } catch (err) {
        hint.textContent = t('other.updateCheckFailed', { message: (err && err.message) || String(err) })
      } finally {
        btn.disabled = false
      }
    })
    // P2-4: 数据与隐私。数字全部来自磁盘实测，清理只动日志/轨迹/缓存。
    async function refreshPrivacy() {
      let info = null
      try { info = await api.privacySummary() } catch { info = null }
      if (!info || !info.files) return
      const size = (bytes) => {
        if (!bytes) return t('other.sizeEmpty')
        if (bytes < 1024) return bytes + ' B'
        if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB'
        return (bytes / 1024 / 1024).toFixed(1) + ' MB'
      }
      $('privSettings').textContent = size(info.files.settings && info.files.settings.bytes)
      const photos = info.files.photos || { count: 0, bytes: 0 }
      $('privPhotos').textContent = t('other.photoCount', { count: photos.count }) + ' · ' + size(photos.bytes)
      const logs = (info.files.log && info.files.log.bytes) + (info.files.trace && info.files.trace.bytes)
      $('privLogs').textContent = size(logs)
      const caches = info.files.caches || { count: 0, bytes: 0 }
      $('privCaches').textContent = caches.count ? size(caches.bytes) : t('other.none')
      const cleanBtn = $('privacyCleanBtn')
      cleanBtn.textContent = logs || caches.bytes
        ? t('other.cleanupWithSize', { size: size(info.junkBytes) })
        : t('other.cleanupNothing')
      cleanBtn.disabled = !info.junkBytes
      return info
    }
    function resetPrivacyConfirm() {
      $('privacyConfirmBtn').hidden = true
      $('privacyCancelBtn').hidden = true
      $('privacyCleanBtn').hidden = false
    }
    $('privacyCleanBtn').addEventListener('click', () => {
      $('privacyCleanBtn').hidden = true
      $('privacyConfirmBtn').hidden = false
      $('privacyCancelBtn').hidden = false
      $('privacyStatus').textContent = t('other.privacyCleanNote')
    })
    $('privacyCancelBtn').addEventListener('click', () => { resetPrivacyConfirm(); $('privacyStatus').textContent = '' })
    $('privacyConfirmBtn').addEventListener('click', async () => {
      const btn = $('privacyConfirmBtn')
      btn.disabled = true
      $('privacyStatus').textContent = t('other.cleaning')
      try {
        const result = await api.privacyCleanup()
        resetPrivacyConfirm()
        await refreshPrivacy()
        $('privacyStatus').textContent = t('other.cleaned', { count: result.removed })
        setStatus(t('other.cleanedStatus'))
      } catch (err) {
        $('privacyStatus').textContent = t('other.cleanupFailed', { message: (err && err.message) || String(err) })
      } finally {
        btn.disabled = false
      }
    })
    $('privacyBox').addEventListener('toggle', () => { if ($('privacyBox').open) refreshPrivacy() })

    const bootToggle = $('updateBootToggle')
    if (bootToggle) {
      // wire() 在 state.settings 就绪前跑，这里不能假设它已经有值。
      bootToggle.checked = !(state.settings && state.settings.update && state.settings.update.checkOnBoot === false)
      bootToggle.addEventListener('change', () => {
        save({ update: { checkOnBoot: !!bootToggle.checked } }, true, bootToggle.checked ? t('other.updateBootOn') : t('other.updateBootOff'))
      })
    }

    $('quitBtn').addEventListener('click', () => api.quit())
  }

  // ------------------------------------------------------------------ sounds
  function soundState() {
    return sound.normalizeSound(state.settings && state.settings.sound)
  }

  function fragmentOptions(selected) {
    const select = document.createElement('select')
    const groups = [
      { label: t('sound.builtinGroup'), items: sound.PRESETS.map((p) => ({ value: p.id, label: t(p.labelKey) })) },
      { label: t('sound.mineGroup'), items: state.sounds.map((f) => ({ value: 'file:' + f.id, label: f.name })) },
    ]
    groups.forEach((group) => {
      if (!group.items.length) return
      const optgroup = document.createElement('optgroup')
      optgroup.label = group.label
      group.items.forEach((item) => {
        const opt = document.createElement('option')
        opt.value = item.value
        opt.textContent = item.label
        optgroup.appendChild(opt)
      })
      select.appendChild(optgroup)
    })
    if (selected && !sound.isKnownFragment(selected, state.sounds)) {
      const opt = document.createElement('option')
      opt.value = selected
      opt.textContent = t('sound.missingFragment')
      select.insertBefore(opt, select.firstChild)
    }
    select.value = selected
    return select
  }

  function saveSoundEvent(key, patch) {
    const s = soundState()
    s.events[key] = Object.assign({}, s.events[key], patch)
    state.settings = Object.assign({}, state.settings, { sound: s })
    renderSoundEvents()
    save({ sound: { events: { [key]: s.events[key] } } }, true)
  }

  function previewEvent(key) {
    const s = soundState()
    const event = s.events[key]
    const volume = event.volume == null ? s.volume : event.volume
    sound.playFragment(event.fragment, Math.max(0.08, volume), state.sounds)
  }

  function renderSoundEvents() {
    const box = $('soundEvents')
    if (!box || !state.settings) return
    const s = soundState()
    box.innerHTML = ''
    sound.EVENT_META.forEach((meta) => {
      const event = s.events[meta.key]
      const row = document.createElement('div')
      row.className = 'sound-row'

      const toggle = document.createElement('label')
      toggle.className = 'check'
      toggle.title = t('sound.toggleTitle')
      const check = document.createElement('input')
      check.type = 'checkbox'
      check.checked = !!event.enabled
      check.setAttribute('aria-label', t('sound.toggleAria', { name: t(meta.labelKey) }))
      check.onchange = () => saveSoundEvent(meta.key, { enabled: check.checked })
      toggle.appendChild(check)
      row.appendChild(toggle)

      const name = document.createElement('span')
      name.className = 'name'
      name.textContent = t(meta.labelKey)
      row.appendChild(name)

      const select = fragmentOptions(event.fragment)
      select.setAttribute('aria-label', t('sound.fragmentAria', { name: t(meta.labelKey) }))
      select.onchange = () => saveSoundEvent(meta.key, { fragment: select.value })
      row.appendChild(select)

      const vol = document.createElement('div')
      vol.className = 'vol'
      const range = document.createElement('input')
      range.type = 'range'
      range.setAttribute('aria-label', t('sound.volumeAria', { name: t(meta.labelKey) }))
      range.min = '0'
      range.max = '100'
      range.step = '5'
      const effective = event.volume == null ? Math.round(s.volume * 100) : Math.round(event.volume * 100)
      range.value = String(effective)
      const label = document.createElement('b')
      label.textContent = event.volume == null ? '—' : effective + '%'
      label.title = event.volume == null ? t('sound.followsMaster') : t('sound.customVolume')
      range.oninput = () => { label.textContent = range.value + '%' }
      range.onchange = () => saveSoundEvent(meta.key, { volume: Number(range.value) / 100 })
      vol.appendChild(range)
      vol.appendChild(label)
      row.appendChild(vol)

      const follow = document.createElement('button')
      follow.type = 'button'
      follow.textContent = t('sound.follow')
      follow.title = t('sound.followTitle')
      follow.onclick = () => saveSoundEvent(meta.key, { volume: null })
      row.appendChild(follow)

      const preview = document.createElement('button')
      preview.type = 'button'
      preview.textContent = t('sound.preview')
      preview.onclick = () => previewEvent(meta.key)
      row.appendChild(preview)

      box.appendChild(row)
    })
  }

  function renderSoundFiles() {
    const box = $('soundFiles')
    if (!box) return
    box.innerHTML = ''
    if (!state.sounds.length) {
      const empty = document.createElement('span')
      empty.className = 'muted'
      empty.textContent = t('sound.filesEmpty')
      box.appendChild(empty)
      return
    }
    state.sounds.forEach((file) => {
      const chip = document.createElement('span')
      chip.className = 'chip-file'
      chip.appendChild(document.createTextNode(file.name))
      const del = document.createElement('button')
      del.type = 'button'
      del.textContent = '×'
      del.title = t('sound.deleteTitle')
      del.onclick = () => {
        api.deleteSound(file.id).then((result) => {
          state.sounds = result.files || []
          return api.getState().then((next) => {
            fill(next.settings)
            setStatus(t('sound.deleted'))
          })
        }).catch(() => setStatus(t('settings.deleteFailed')))
      }
      chip.appendChild(del)
      box.appendChild(chip)
    })
  }

  // --------------------------------------------------- P1-5: water log
  /** Draws today's timeline + the last seven days; called on every panel entry. */
  function refreshWaterStats() {
    const todayNode = $('waterToday')
    const timeNode = $('waterTimeline')
    const weekNode = $('waterWeek')
    if (!todayNode || !timeNode || !weekNode) return
    api.getWaterStats().then((stats) => {
      if (!stats) return
      const today = stats.today || { cups: 0, ml: 0, items: [] }
      todayNode.textContent = today.cups
        ? t('reminder.waterToday', { cups: today.cups, ml: today.ml })
        : t('reminder.waterTodayEmpty')
      timeNode.textContent = ''
      ;(today.items || []).forEach((item) => {
        const li = document.createElement('li')
        li.textContent = item.time
        li.title = item.time + ' · ' + item.ml + 'ml'
        timeNode.appendChild(li)
      })
      const week = stats.week || []
      const max = Math.max(1, ...week.map((day) => day.cups))
      weekNode.textContent = ''
      week.forEach((day) => {
        const li = document.createElement('li')
        if (day.isToday) li.setAttribute('aria-current', 'true')
        const label = document.createElement('span')
        label.className = 'day-label'
        label.textContent = day.isToday ? t('reminder.today') : day.label
        const bar = document.createElement('span')
        bar.className = 'bar'
        const fill = document.createElement('i')
        fill.style.width = Math.round((day.cups / max) * 100) + '%'
        bar.appendChild(fill)
        const count = document.createElement('span')
        count.className = 'day-count'
        count.textContent = t('reminder.cups', { count: day.cups })
        li.appendChild(label)
        li.appendChild(bar)
        li.appendChild(count)
        weekNode.appendChild(li)
      })
    }).catch(() => {
      todayNode.textContent = t('reminder.waterReadFailed')
    })
  }

  // ------------------------------------------------- P1-4: find a setting
  // A hand-written index beats scraping the DOM: it can carry the words
  // people actually type ("音量/响度/大声"), and smoke can check that every
  // target id still exists in settings.html.
  // 索引只留「面板 + 控件 id」，文案与关键词全部来自语言包（settings.find.<id>.*），
  // 这样 en 下按 city/volume 搜得到，zh 下按「城市」「音量」也搜得到，代码里不再留中文。
  const FIND_SLOTS = [
  ['appearance', 'name'],
  ['appearance', 'size'],
  ['appearance', 'alwaysOnTop'],
  ['appearance', 'autostart'],
  ['appearance', 'snapEnabled'],
  ['appearance', 'snapGap'],
  ['appearance', 'themeSelect'],
  ['role', 'importBtn'],
  ['role', 'cutoutBtn'],
  ['role', 'resetPosBtn'],
  ['bubble', 'autoHide'],
  ['bubble', 'cooldown'],
  ['bubble', 'phrases'],
  ['bubble', 'editorBtn'],
  ['reminder', 'mode'],
  ['reminder', 'interval'],
  ['reminder', 'quietFrom'],
  ['reminder', 'nudgeEnabled'],
  ['reminder', 'nudgeLongUse'],
  ['reminder', 'nudgeLateNight'],
  ['reminder', 'nudgeAway'],
  ['reminder', 'quietTo'],
  ['reminder', 'waterTimeline'],
  ['reminder', 'cupMl'],
  ['reminder', 'exportWaterBtn'],
  ['weather', 'city'],
  ['weather', 'locateBtn'],
  ['weather', 'refreshMinutes'],
  ['sound', 'sound'],
  ['sound', 'soundVolume'],
  ['sound', 'soundEvents'],
  ['sound', 'soundImportBtn'],
  ['other', 'diagBtn'],
  ['other', 'updateBtn'],
  ['other', 'privacyCleanBtn'],
  ['other', 'onboardBtn'],
  ['other', 'openDirBtn'],
  ['other', 'quitBtn'],
  ]
  const FIND_INDEX = FIND_SLOTS.map(([panel, id]) => ({
    panel: panel,
    id: id,
    label: t('settings.find.' + id + '.label'),
    hint: t('settings.find.' + id + '.desc'),
    keys: t('settings.find.' + id + '.keywords')
  }))

  const PANEL_TITLE = {}
  document.querySelectorAll('.nav-item').forEach((btn) => {
    PANEL_TITLE[btn.dataset.panel] = btn.dataset.title || btn.textContent.trim()
  })


  const reduceMotion = () => {
    try { return window.matchMedia('(prefers-reduced-motion: reduce)').matches } catch (err) { return false }
  }

  function findMatches(query) {
    const q = String(query || '').trim().toLowerCase()
    if (!q) return []
    const scored = []
    FIND_INDEX.forEach((entry) => {
      const label = entry.label.toLowerCase()
      const keys = entry.keys.toLowerCase()
      const panelName = String(PANEL_TITLE[entry.panel] || '').toLowerCase()
      let score = 0
      if (label.includes(q)) score = 3
      else if (keys.includes(q)) score = 2
      else if (panelName.includes(q) || entry.hint.toLowerCase().includes(q)) score = 1
      if (score) scored.push({ entry: entry, score: score })
    })
    scored.sort((a, b) => b.score - a.score)
    return scored.slice(0, 8).map((item) => item.entry)
  }

  function renderFindResults(query) {
    const box = $('searchResults')
    const input = $('settingSearch')
    if (!box || !input) return
    const matches = findMatches(query)
    box.innerHTML = ''
    if (!String(query || '').trim()) {
      box.hidden = true
      input.setAttribute('aria-expanded', 'false')
      return
    }
    if (!matches.length) {
      const empty = document.createElement('p')
      empty.className = 'search-empty'
      empty.textContent = t('settings.findEmpty')
      box.appendChild(empty)
      box.hidden = false
      input.setAttribute('aria-expanded', 'true')
      return
    }
    matches.forEach((entry) => {
      const row = document.createElement('button')
      row.type = 'button'
      row.className = 'search-result'
      row.dataset.target = entry.id
      const strong = document.createElement('b')
      strong.textContent = entry.label
      const span = document.createElement('span')
      span.textContent = (PANEL_TITLE[entry.panel] || entry.panel) + ' · ' + entry.hint
      row.append(strong, span)
      row.addEventListener('click', () => revealSetting(entry))
      box.appendChild(row)
    })
    box.hidden = false
    input.setAttribute('aria-expanded', 'true')
  }

  /** Jump to the panel holding the control, bring it into view, flash it. */
  function revealSetting(entry) {
    selectPanel(entry.panel)
    const node = $(entry.id)
    if (!node) return
    const field = node.closest('.field') || node
    field.scrollIntoView({ block: 'center', behavior: reduceMotion() ? 'auto' : 'smooth' })
    field.classList.remove('field-flash')
    void field.offsetWidth // restart the one-shot animation
    field.classList.add('field-flash')
    setTimeout(() => field.classList.remove('field-flash'), 1400)
    if (typeof node.focus === 'function') node.focus({ preventScroll: true })
    $('searchResults').hidden = true
    $('settingSearch').setAttribute('aria-expanded', 'false')
    setStatus(t('settings.found', { label: entry.label }), 1800)
  }

  function wireFind() {
    const input = $('settingSearch')
    const box = $('searchResults')
    if (!input || !box) return
    input.addEventListener('input', () => renderFindResults(input.value))
    input.addEventListener('keydown', (ev) => {
      if (ev.key === 'Escape') { input.value = ''; renderFindResults(''); return }
      if (ev.key === 'ArrowDown' || ev.key === 'Enter') {
        const first = box.querySelector('.search-result')
        if (!first) return
        ev.preventDefault()
        if (ev.key === 'Enter') first.click()
        else first.focus()
      }
    })
    input.addEventListener('blur', () => {
      setTimeout(() => {
        const active = document.activeElement
        if (active && active.classList && active.classList.contains('search-result')) return
        box.hidden = true
        input.setAttribute('aria-expanded', 'false')
      }, 120)
    })
  }

  // ------------------------------------------------ P1-4: per-panel reset
  /** The patch that puts one panel back to its factory values. */
  function panelResetPatch(panel) {
    const d = state.defaults
    if (!d) return null
    if (panel === 'appearance') {
      return {
        name: d.name,
        size: d.size,
        alwaysOnTop: d.alwaysOnTop,
        autostart: d.autostart,
        snap: { enabled: d.snap.enabled, gap: d.snap.gap },
      }
    }
    if (panel === 'bubble') {
      return {
        bubble: {
          autoHideSeconds: d.bubble.autoHideSeconds,
          cooldownMinutes: d.bubble.cooldownMinutes,
          phrases: d.bubble.phrases,
        },
      }
    }
    if (panel === 'reminder') {
      return {
        mode: d.mode,
        water: {
          intervalMinutes: d.water.intervalMinutes,
          quietFrom: d.water.quietFrom,
          quietTo: d.water.quietTo,
        },
      }
    }
    if (panel === 'weather') {
      return {
        weather: {
          lat: null,
          lon: null,
          city: '',
          label: t('settings.weatherAutoLabel'),
          refreshMinutes: d.weather.refreshMinutes,
          recent: [],
        },
      }
    }
    if (panel === 'sound') return { sound: JSON.parse(JSON.stringify(d.sound)) }
    return null
  }

  function currentPanel() {
    const active = document.querySelector('.panel.active')
    return active ? active.dataset.panel : 'appearance'
  }

  function closeResetConfirm() {
    const box = $('resetConfirm')
    const btn = $('resetPanelBtn')
    if (!box || !btn) return
    box.hidden = true
    btn.setAttribute('aria-expanded', 'false')
  }

  function wireReset() {
    const btn = $('resetPanelBtn')
    const box = $('resetConfirm')
    if (!btn || !box) return
    btn.addEventListener('click', () => {
      const panel = currentPanel()
      if (!panelResetPatch(panel)) { setStatus(t('settings.resetUnavailable'), 2600); return }
      $('resetPanelName').textContent = PANEL_TITLE[panel] || panel
      const willShow = box.hidden
      box.hidden = !willShow
      btn.setAttribute('aria-expanded', String(willShow))
      if (willShow) $('resetOk').focus({ preventScroll: true })
    })
    $('resetCancel').addEventListener('click', () => {
      closeResetConfirm()
      btn.focus({ preventScroll: true })
    })
    $('resetOk').addEventListener('click', () => {
      const panel = currentPanel()
      const patch = panelResetPatch(panel)
      closeResetConfirm()
      if (!patch) return
      save(patch, true, t('settings.resetDone', { panel: PANEL_TITLE[panel] || panel }))
    })
    box.addEventListener('keydown', (ev) => {
      if (ev.key === 'Escape') {
        ev.preventDefault()
        closeResetConfirm()
        btn.focus({ preventScroll: true })
      }
    })
    document.addEventListener('click', (ev) => {
      if (box.hidden) return
      if (box.contains(ev.target) || btn.contains(ev.target)) return
      closeResetConfirm()
    })
  }

  // ------------------------------------------------- P1-4: recent cities
  function renderRecentCities(settings) {
    const box = $('recentCities')
    if (!box) return
    const list = (settings && settings.weather && settings.weather.recent) || []
    box.innerHTML = ''
    if (!list.length) { box.hidden = true; return }
    const current = settings.weather && settings.weather.city
    list.slice(0, 5).forEach((name) => {
      const chip = document.createElement('button')
      chip.type = 'button'
      chip.className = 'chip-city'
      chip.textContent = name
      chip.setAttribute('aria-pressed', String(name === current))
      chip.addEventListener('click', () => {
        $('city').value = name
        search(name)
      })
      box.appendChild(chip)
    })
    box.hidden = false
  }

  /** 定位拿到的城市用同一个哨兵值，界面文案走字典。 */
  const geoCityName = () => t('settings.geoCityName')

  /** Moves a freshly picked city to the front of the recent list. */
  function noteRecentCity(name) {
    const clean = String(name || '').trim()
    if (!clean || clean === geoCityName()) return
    const weather = (state.settings && state.settings.weather) || {}
    const list = [clean].concat((weather.recent || []).filter((item) => item !== clean)).slice(0, 5)
    save({ weather: { recent: list } }, true, t('settings.saved'))
  }

  function search(query) {
    const q = String(query || '').trim()
    if (!q) { setStatus(t('settings.status.cityEmpty'), 4000); $('city').focus(); return }
    setStatus(t('settings.status.searching'), 0)
    api.geocode(q).then((data) => {
      const box = $('results')
      box.innerHTML = ''
      if (!data || !data.list || !data.list.length) {
        box.hidden = true
        setStatus(
          data && data.error
            ? t('settings.status.searchError', { error: data.error })
            : t('settings.status.searchNone'),
          6000
        )
        return
      }
      box.hidden = false
      setStatus(t('settings.status.searchFound', { count: data.list.length }), 6000)
      data.list.forEach((item) => {
        const row = document.createElement('div')
        row.textContent = item.name + (item.admin ? ' · ' + item.admin : '') + (item.country ? ' · ' + item.country : '')
        row.onclick = () => {
          save(
            { weather: { lat: item.lat, lon: item.lon, city: item.name, label: item.admin || item.country } },
            true,
            t('settings.status.citySaved', {
              city: item.name + (item.admin ? ' · ' + item.admin : '')
            })
          )
          $('city').value = item.name
          noteRecentCity(item.name)
          box.hidden = true
          renderCityNow({ weather: { lat: item.lat, lon: item.lon, city: item.name, label: item.admin || item.country } })
          api.refreshWeather()
        }
        box.appendChild(row)
      })
    }).catch(() => setStatus(t('settings.status.searchFailed')))
  }

  function locate() {
    if (!navigator.geolocation) { setStatus(t('settings.status.geoUnavailable')); return }
    setStatus(t('settings.status.locating'))
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        save({
          weather: {
            lat: pos.coords.latitude,
            lon: pos.coords.longitude,
            city: geoCityName(),
            label: t('settings.geoCityLabel'),
          },
        }, true)
        $('city').value = geoCityName()
        setStatus(t('settings.status.located'))
        api.refreshWeather()
      },
      () => setStatus(t('settings.status.geoFailed')),
      { timeout: 8000 },
    )
  }

  // P0-3: the tray icon is not guaranteed to be visible in every Windows shell,
  // so the page states plainly which fallbacks work instead of pretending.
  // P2-6: “现在的语言”来自主进程（设置里存的是偏好，可能是“跟随系统”）。
  async function renderLocaleStatus() {
    const now = $('localeNow')
    if (!now) return
    try {
      const info = await api.getI18n()
      const names = { 'zh-CN': t('other.localeZh'), 'en-US': 'English' }
      now.textContent = t('other.localeStatus', {
        locale: names[info.locale] || info.locale,
        available: (info.available || []).join(' / '),
        count: info.keys || 0
      })
    } catch (err) {
      now.textContent = t('other.localeUnreadable')
    }
  }

  async function renderAppStatus() {
    const trayEl = $('trayStatus')
    const keyEl = $('shortcutStatus')
    try {
      const info = await api.getAppStatus()
      const tray = info.tray || {}
      const key = info.shortcut || {}
      trayEl.textContent = tray.ok
        ? t('other.trayOk')
        : t(tray.reason ? 'other.trayFailedWithReason' : 'other.trayFailed', { reason: tray.reason || '' })
      keyEl.textContent = key.ok
        ? t('other.shortcutOk')
        : t(key.reason ? 'other.shortcutFailedWithReason' : 'other.shortcutFailed', { reason: key.reason || '' })
    } catch (err) {
      trayEl.textContent = t('other.trayUnreadable')
      keyEl.textContent = t('other.shortcutUnreadable')
    }
  }

  async function renderUpdateStatus() {
    const hint = $('updateStatus')
    if (!hint) return
    try {
      const info = await api.getUpdateStatus()
      const last = info && info.lastCheckAt ? new Date(info.lastCheckAt).toLocaleString() : t('other.updateNever')
      hint.textContent = t('other.updateStatus', { version: (info && info.version) || '', last: last })
    } catch (err) {
      hint.textContent = t('other.updateUnreadable')
    }
  }

  async function boot() {
    wireNav()
    wire()
    // The header follows the active section; before, it was baked into the markup.
    const firstPanel = document.querySelector('.nav-item.active')
    if (firstPanel) selectPanel(firstPanel.dataset.panel)
    try {
      try { state.defaults = await api.getDefaults() } catch (err) { state.defaults = null }
      const state0 = await api.getState()
      state.roles = state0.roles || []
      try { state.sounds = await api.listSounds() } catch (err) { state.sounds = [] }
      $('version').textContent = 'v' + state0.version
      $('dataDir').textContent = state0.dataDir || ''
      $('dataDir').title = state0.dataDir || ''
      fill(state0.settings)
      renderAppStatus()
      renderLocaleStatus()
      renderUpdateStatus()
      loadThemes()
    } catch (err) {
      setStatus(t('settings.loadFailed'))
    }
    api.onSettings((settings) => fill(settings))
    api.onRoles((roles) => {
      state.roles = Array.isArray(roles) ? roles : []
      renderRoles()
    })
  }

  boot()
})()
