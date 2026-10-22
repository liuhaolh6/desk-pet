/**
 * Settings window. Every control writes the whole patch through
 * `deskPet.setSettings`, which persists and broadcasts to the pet window.
 */
(function () {
  const api = window.deskPet
  const sound = window.DeskPetSound
  const $ = (id) => document.getElementById(id)

  const state = { settings: null, roles: [], sounds: [], saveTimer: 0 }

  const clamp = (n, lo, hi) => Math.min(hi, Math.max(lo, n))

  function setStatus(text, hold) {
    const node = $('status')
    if (!node) return
    node.textContent = text
    clearTimeout(setStatus.timer)
    if (hold === 0) return // keep it until something else happens
    setStatus.timer = setTimeout(() => { node.textContent = '不用点保存就行' }, hold || 2200)
  }

  /** Persistent reminder of which place the weather is actually using. */
  function renderCityNow(settings) {
    const node = $('cityNow')
    if (!node) return
    const w = (settings && settings.weather) || {}
    if (!w.city) { node.textContent = '现在还没告诉我你在哪座城市'; return }
    node.textContent = '现在用的是：' + w.city + (w.label ? ' · ' + w.label : '') +
      (Number.isFinite(Number(w.lat)) ? '（' + Number(w.lat).toFixed(2) + ', ' + Number(w.lon).toFixed(2) + '）' : '')
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
    const title = $('panelTitle')
    const hint = $('panelHint')
    if (title) title.textContent = target.dataset.title || ''
    if (hint) hint.textContent = target.dataset.hint || ''
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
        setStatus(message || '记住啦')
      }).catch(() => setStatus('刚才没记下来，再试一次好吗'))
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
        badge.textContent = '整张照片'
        badge.title = '这张是用「不用抠，直接用整张」保存的照片，背景还在'
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
        del.textContent = '删掉'
        del.onclick = (ev) => {
          ev.stopPropagation()
          api.deleteRole(role.id).then((result) => {
            state.roles = result.roles || []
            setStatus(result.ok ? '删掉啦' : '删不掉呢，再试一次？')
            renderRoles()
          })
        }
        card.appendChild(del)
      }
      box.appendChild(card)
    })
  }

  function wire() {
    $('name').addEventListener('input', (ev) => {
      const value = ev.target.value.trim() || '小芳'
      save({ name: value })
    })

    $('size').addEventListener('input', (ev) => {
      const value = Number(ev.target.value)
      $('sizeVal').textContent = value + 'px'
      save({ size: value })
    })

    $('alwaysOnTop').addEventListener('change', (ev) => save({ alwaysOnTop: ev.target.checked }, true))
    $('autostart').addEventListener('change', (ev) => save({ autostart: ev.target.checked }, true))
    $('snapEnabled').addEventListener('change', (ev) => save({ snap: { enabled: ev.target.checked } }, true))
    $('snapGap').addEventListener('change', (ev) => {
      const gap = clamp(Number(ev.target.value) || 0, 0, 80)
      ev.target.value = String(gap)
      save({ snap: { gap } }, true)
    })
    $('mode').addEventListener('change', (ev) => save({ mode: ev.target.value }, true))
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
    $('autoHide').addEventListener('change', (ev) => {
      save({ bubble: { autoHideSeconds: clamp(Number(ev.target.value) || 0, 0, 120) } }, true)
    })
    $('cooldown').addEventListener('change', (ev) => {
      save({ bubble: { cooldownMinutes: clamp(Number(ev.target.value) || 0, 0, 240) } }, true)
    })
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
      setStatus('挑一段音频…')
      api.importSound().then((result) => {
        if (!result || result.canceled) { setStatus('好，那先不选'); return }
        if (!result.ok) { setStatus(result.error || '没收进来，再试一次？'); return }
        state.sounds = result.files || []
        renderSoundEvents()
        renderSoundFiles()
        setStatus('收好啦：' + result.file.name)
      }).catch(() => setStatus('没收进来，再试一次？'))
    })
    $('editorBtn').addEventListener('click', () => api.openEditor())
    $('onboardBtn').addEventListener('click', () => api.openOnboard())

    $('searchBtn').addEventListener('click', () => search($('city').value))
    $('city').addEventListener('keydown', (ev) => { if (ev.key === 'Enter') search($('city').value) })
    $('locateBtn').addEventListener('click', locate)

    $('importBtn').addEventListener('click', () => {
      setStatus('挑一张图片吧…')
      api.importRole().then((result) => {
        if (!result || result.canceled) { setStatus('好，那先不选'); return }
        if (!result.ok) { setStatus(result.error || '没收进来，再试一次？'); return }
        state.roles = result.roles || []
        return api.getState().then((next) => { fill(next.settings); setStatus('收好啦：' + result.role.name) })
      }).catch(() => setStatus('没收进来，再试一次？'))
    })

    $('cutoutBtn').addEventListener('click', () => {
      setStatus('打开「用照片做个我」…')
      api.openCutout()
    })

    $('resetPosBtn').addEventListener('click', () => { save({ position: null }, true); setStatus('回到右下角啦') })
    $('openDirBtn').addEventListener('click', () => api.openDataDir())
    // P0-5: one click writes a redacted diagnostics txt next to the settings.
    $('diagBtn').addEventListener('click', async () => {
      const btn = $('diagBtn')
      const hint = $('diagStatus')
      btn.disabled = true
      hint.textContent = '正在收集…'
      try {
        const result = await api.exportDiagnostics()
        hint.textContent = '写好啦：' + result.path + '（已打开文件夹）'
        setStatus('诊断信息已导出')
      } catch (err) {
        hint.textContent = '导出失败：' + ((err && err.message) || String(err))
        setStatus('没导出成')
      } finally {
        btn.disabled = false
      }
    })
    $('quitBtn').addEventListener('click', () => api.quit())
  }

  // ------------------------------------------------------------------ sounds
  function soundState() {
    return sound.normalizeSound(state.settings && state.settings.sound)
  }

  function fragmentOptions(selected) {
    const select = document.createElement('select')
    const groups = [
      { label: '自带的声音', items: sound.PRESETS.map((p) => ({ value: p.id, label: p.label })) },
      { label: '我收下的音频', items: state.sounds.map((f) => ({ value: 'file:' + f.id, label: f.name })) },
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
      opt.textContent = '（这段找不到了，重新选一个吧）'
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
      toggle.title = '这件事要不要出声'
      const check = document.createElement('input')
      check.type = 'checkbox'
      check.checked = !!event.enabled
      check.setAttribute('aria-label', meta.label + '：要不要出声')
      check.onchange = () => saveSoundEvent(meta.key, { enabled: check.checked })
      toggle.appendChild(check)
      row.appendChild(toggle)

      const name = document.createElement('span')
      name.className = 'name'
      name.textContent = meta.label
      row.appendChild(name)

      const select = fragmentOptions(event.fragment)
      select.setAttribute('aria-label', meta.label + '：用哪段声音')
      select.onchange = () => saveSoundEvent(meta.key, { fragment: select.value })
      row.appendChild(select)

      const vol = document.createElement('div')
      vol.className = 'vol'
      const range = document.createElement('input')
      range.type = 'range'
      range.setAttribute('aria-label', meta.label + '：多大声')
      range.min = '0'
      range.max = '100'
      range.step = '5'
      const effective = event.volume == null ? Math.round(s.volume * 100) : Math.round(event.volume * 100)
      range.value = String(effective)
      const label = document.createElement('b')
      label.textContent = event.volume == null ? '—' : effective + '%'
      label.title = event.volume == null ? '跟着总音量' : '单独调'
      range.oninput = () => { label.textContent = range.value + '%' }
      range.onchange = () => saveSoundEvent(meta.key, { volume: Number(range.value) / 100 })
      vol.appendChild(range)
      vol.appendChild(label)
      row.appendChild(vol)

      const follow = document.createElement('button')
      follow.type = 'button'
      follow.textContent = '跟着'
      follow.title = '音量跟着总音量'
      follow.onclick = () => saveSoundEvent(meta.key, { volume: null })
      row.appendChild(follow)

      const preview = document.createElement('button')
      preview.type = 'button'
      preview.textContent = '听一下'
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
      empty.textContent = '还没添加自己的音频，自带的声音已经能用啦'
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
      del.title = '删掉这段音频（用到它的地方会回到自带声音）'
      del.onclick = () => {
        api.deleteSound(file.id).then((result) => {
          state.sounds = result.files || []
          return api.getState().then((next) => {
            fill(next.settings)
            setStatus('删掉啦片段')
          })
        }).catch(() => setStatus('删不掉呢，再试一次？'))
      }
      chip.appendChild(del)
      box.appendChild(chip)
    })
  }

  function search(query) {
    const q = String(query || '').trim()
    if (!q) { setStatus('先写下城市名呀', 4000); $('city').focus(); return }
    setStatus('我找找看…', 0)
    api.geocode(q).then((data) => {
      const box = $('results')
      box.innerHTML = ''
      if (!data || !data.list || !data.list.length) {
        box.hidden = true
        setStatus(data && data.error
          ? '没找到（' + data.error + '），也可以直接写拼音试试'
          : '没找到这座城市，换个写法试试（比如「衡阳」）', 6000)
        return
      }
      box.hidden = false
      setStatus('找到 ' + data.list.length + ' 个地方，点下面那一行就用它', 6000)
      data.list.forEach((item) => {
        const row = document.createElement('div')
        row.textContent = item.name + (item.admin ? ' · ' + item.admin : '') + (item.country ? ' · ' + item.country : '')
        row.onclick = () => {
          save({ weather: { lat: item.lat, lon: item.lon, city: item.name, label: item.admin || item.country } }, true,
            '记住啦：' + item.name + (item.admin ? ' · ' + item.admin : '') + '，正在换天气…')
          $('city').value = item.name
          box.hidden = true
          renderCityNow({ weather: { lat: item.lat, lon: item.lon, city: item.name, label: item.admin || item.country } })
          api.refreshWeather()
        }
        box.appendChild(row)
      })
    }).catch(() => setStatus('搜索失败'))
  }

  function locate() {
    if (!navigator.geolocation) { setStatus('这台电脑不让定位，手动写下城市名吧'); return }
    setStatus('看看你在哪…')
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        save({
          weather: {
            lat: pos.coords.latitude,
            lon: pos.coords.longitude,
            city: '我找到的位置',
            label: '用我的位置',
          },
        }, true)
        $('city').value = '我找到的位置'
        setStatus('找到啦')
        api.refreshWeather()
      },
      () => setStatus('没定上位，手动写下城市名吧'),
      { timeout: 8000 },
    )
  }

  // P0-3: the tray icon is not guaranteed to be visible in every Windows shell,
  // so the page states plainly which fallbacks work instead of pretending.
  async function renderAppStatus() {
    const trayEl = $('trayStatus')
    const keyEl = $('shortcutStatus')
    try {
      const info = await api.getAppStatus()
      const tray = info.tray || {}
      const key = info.shortcut || {}
      trayEl.textContent = tray.ok
        ? '托盘图标已经交给系统了：右键有设置和退出，单击能显示或隐藏。要是右下角没看到它，那是被折叠了，用 Ctrl+Alt+P 或鼠标悬停照样能叫出来。'
        : '托盘这次没显示出来' + (tray.reason ? '（' + tray.reason + '）' : '') + '：把鼠标放到桌宠身上就会浮出菜单，设置和退出都在里面。'
      keyEl.textContent = key.ok
        ? 'Ctrl+Alt+P 可以用：按一下显示桌宠，再按一下收起来。'
        : 'Ctrl+Alt+P 没注册上' + (key.reason ? '（' + key.reason + '）' : '') + '：把鼠标放到桌宠上仍然能叫出菜单。'
    } catch (err) {
      trayEl.textContent = '没读到托盘状态，不过把鼠标放到桌宠身上仍然能打开设置和退出。'
      keyEl.textContent = '没读到快捷键状态。'
    }
  }

  async function boot() {
    wireNav()
    wire()
    try {
      const state0 = await api.getState()
      state.roles = state0.roles || []
      try { state.sounds = await api.listSounds() } catch (err) { state.sounds = [] }
      $('version').textContent = 'v' + state0.version
      $('dataDir').textContent = state0.dataDir || ''
      $('dataDir').title = state0.dataDir || ''
      fill(state0.settings)
      renderAppStatus()
    } catch (err) {
      setStatus('没读到设置，稍后再试')
    }
    api.onSettings((settings) => fill(settings))
    api.onRoles((roles) => {
      state.roles = Array.isArray(roles) ? roles : []
      renderRoles()
    })
  }

  boot()
})()
