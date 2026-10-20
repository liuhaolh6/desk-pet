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

  function setStatus(text) {
    const node = $('status')
    if (!node) return
    node.textContent = text
    clearTimeout(setStatus.timer)
    setStatus.timer = setTimeout(() => { node.textContent = '改动会自动写入' }, 2200)
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

  function save(patch, immediate) {
    state.settings = Object.assign({}, state.settings, patch)
    if (state.saveTimer) clearTimeout(state.saveTimer)
    const fire = () => {
      api.setSettings(patch).then((next) => {
        state.settings = next
        setStatus('已保存')
      }).catch(() => setStatus('保存失败'))
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
        del.textContent = '删除'
        del.onclick = (ev) => {
          ev.stopPropagation()
          api.deleteRole(role.id).then((result) => {
            state.roles = result.roles || []
            setStatus(result.ok ? '已删除' : '删除失败')
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
      const value = ev.target.value.trim() || '小芳桌宠'
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
      setStatus('选择音频文件…')
      api.importSound().then((result) => {
        if (!result || result.canceled) { setStatus('已取消'); return }
        if (!result.ok) { setStatus(result.error || '导入失败'); return }
        state.sounds = result.files || []
        renderSoundEvents()
        renderSoundFiles()
        setStatus('已导入：' + result.file.name)
      }).catch(() => setStatus('导入失败'))
    })
    $('editorBtn').addEventListener('click', () => api.openEditor())

    $('searchBtn').addEventListener('click', () => search($('city').value))
    $('city').addEventListener('keydown', (ev) => { if (ev.key === 'Enter') search($('city').value) })
    $('locateBtn').addEventListener('click', locate)

    $('importBtn').addEventListener('click', () => {
      setStatus('请选择图片…')
      api.importRole().then((result) => {
        if (!result || result.canceled) { setStatus('已取消'); return }
        if (!result.ok) { setStatus(result.error || '导入失败'); return }
        state.roles = result.roles || []
        return api.getState().then((next) => { fill(next.settings); setStatus('已导入：' + result.role.name) })
      }).catch(() => setStatus('导入失败'))
    })

    $('cutoutBtn').addEventListener('click', () => {
      setStatus('打开抠图窗口…')
      api.openCutout()
    })

    $('resetPosBtn').addEventListener('click', () => { save({ position: null }, true); setStatus('已回到右下角') })
    $('openDirBtn').addEventListener('click', () => api.openDataDir())
    $('quitBtn').addEventListener('click', () => api.quit())
  }

  // ------------------------------------------------------------------ sounds
  function soundState() {
    return sound.normalizeSound(state.settings && state.settings.sound)
  }

  function fragmentOptions(selected) {
    const select = document.createElement('select')
    const groups = [
      { label: '内置音色', items: sound.PRESETS.map((p) => ({ value: p.id, label: p.label })) },
      { label: '导入的片段', items: state.sounds.map((f) => ({ value: 'file:' + f.id, label: f.name })) },
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
      opt.textContent = '（已失效，请重选）'
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
      toggle.title = '该事件是否发声'
      const check = document.createElement('input')
      check.type = 'checkbox'
      check.checked = !!event.enabled
      check.onchange = () => saveSoundEvent(meta.key, { enabled: check.checked })
      toggle.appendChild(check)
      row.appendChild(toggle)

      const name = document.createElement('span')
      name.className = 'name'
      name.textContent = meta.label
      row.appendChild(name)

      const select = fragmentOptions(event.fragment)
      select.onchange = () => saveSoundEvent(meta.key, { fragment: select.value })
      row.appendChild(select)

      const vol = document.createElement('div')
      vol.className = 'vol'
      const range = document.createElement('input')
      range.type = 'range'
      range.min = '0'
      range.max = '100'
      range.step = '5'
      const effective = event.volume == null ? Math.round(s.volume * 100) : Math.round(event.volume * 100)
      range.value = String(effective)
      const label = document.createElement('b')
      label.textContent = event.volume == null ? '—' : effective + '%'
      label.title = event.volume == null ? '跟随总音量' : '单独音量'
      range.oninput = () => { label.textContent = range.value + '%' }
      range.onchange = () => saveSoundEvent(meta.key, { volume: Number(range.value) / 100 })
      vol.appendChild(range)
      vol.appendChild(label)
      row.appendChild(vol)

      const follow = document.createElement('button')
      follow.type = 'button'
      follow.textContent = '跟随'
      follow.title = '音量跟随总音量'
      follow.onclick = () => saveSoundEvent(meta.key, { volume: null })
      row.appendChild(follow)

      const preview = document.createElement('button')
      preview.type = 'button'
      preview.textContent = '试听'
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
      empty.textContent = '暂无导入片段，内置音色已可用'
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
      del.title = '删除这个片段（引用它的音效会回退到内置音色）'
      del.onclick = () => {
        api.deleteSound(file.id).then((result) => {
          state.sounds = result.files || []
          return api.getState().then((next) => {
            fill(next.settings)
            setStatus('已删除片段')
          })
        }).catch(() => setStatus('删除失败'))
      }
      chip.appendChild(del)
      box.appendChild(chip)
    })
  }

  function search(query) {
    const q = String(query || '').trim()
    if (!q) { setStatus('先输入城市名'); return }
    setStatus('搜索中…')
    api.geocode(q).then((data) => {
      const box = $('results')
      box.innerHTML = ''
      if (!data || !data.list || !data.list.length) {
        box.hidden = true
        setStatus(data && data.error ? '搜索失败：' + data.error : '没找到这个城市')
        return
      }
      box.hidden = false
      data.list.forEach((item) => {
        const row = document.createElement('div')
        row.textContent = item.name + (item.admin ? ' · ' + item.admin : '') + (item.country ? ' · ' + item.country : '')
        row.onclick = () => {
          save({ weather: { lat: item.lat, lon: item.lon, city: item.name, label: item.admin || item.country } }, true)
          $('city').value = item.name
          box.hidden = true
          setStatus('已设为 ' + item.name)
          api.refreshWeather()
        }
        box.appendChild(row)
      })
    }).catch(() => setStatus('搜索失败'))
  }

  function locate() {
    if (!navigator.geolocation) { setStatus('系统不支持定位，请搜索城市'); return }
    setStatus('定位中…')
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        save({
          weather: {
            lat: pos.coords.latitude,
            lon: pos.coords.longitude,
            city: '当前位置',
            label: '定位',
          },
        }, true)
        $('city').value = '当前位置'
        setStatus('已定位')
        api.refreshWeather()
      },
      () => setStatus('定位失败，请搜索城市'),
      { timeout: 8000 },
    )
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
    } catch (err) {
      setStatus('读取设置失败')
    }
    api.onSettings((settings) => fill(settings))
    api.onRoles((roles) => {
      state.roles = Array.isArray(roles) ? roles : []
      renderRoles()
    })
  }

  boot()
})()
