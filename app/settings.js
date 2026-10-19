/**
 * Settings window. Every control writes the whole patch through
 * `deskPet.setSettings`, which persists and broadcasts to the pet window.
 */
(function () {
  const api = window.deskPet
  const $ = (id) => document.getElementById(id)

  const state = { settings: null, roles: [], saveTimer: 0 }

  const clamp = (n, lo, hi) => Math.min(hi, Math.max(lo, n))

  function setStatus(text) {
    const node = $('status')
    if (!node) return
    node.textContent = text
    clearTimeout(setStatus.timer)
    setStatus.timer = setTimeout(() => { node.textContent = '' }, 2200)
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

    $('resetPosBtn').addEventListener('click', () => { save({ position: null }, true); setStatus('已回到右下角') })
    $('openDirBtn').addEventListener('click', () => api.openDataDir())
    $('quitBtn').addEventListener('click', () => api.quit())
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
    wire()
    try {
      const state0 = await api.getState()
      state.roles = state0.roles || []
      $('version').textContent = 'v' + state0.version
      $('dataDir').textContent = state0.dataDir || ''
      $('dataDir').title = state0.dataDir || ''
      fill(state0.settings)
    } catch (err) {
      setStatus('读取设置失败')
    }
    api.onSettings((settings) => fill(settings))
  }

  boot()
})()
