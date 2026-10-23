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
    if (panelId === 'reminder') refreshWaterStats()
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
    wireFind()
    wireReset()
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
    // P2-6：语言只在启动时读一次字典，所以这里明确告诉用户要重开。
    const localeSelect = $('localeSelect')
    if (localeSelect) {
      localeSelect.addEventListener('change', () => save({ locale: localeSelect.value }, true, '记下了，重开桌宠后换成这个语言'))
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
          setStatus('导出没成功，再试一次？')
          $('waterExportHint').textContent = (result && result.error) || '导出失败'
          return
        }
        $('waterExportHint').textContent = '已导出 ' + (result.path || '') + '（' + (result.rows || 0) + ' 行）'
        setStatus('导出好啦')
      }).catch(() => setStatus('导出没成功，再试一次？')).finally(() => { btn.disabled = false })
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
    // P2-3: 更新检查。自动检查只提示；静默安装要等签名版本，这里只给“去下载”。
    $('updateBtn').addEventListener('click', async () => {
      const btn = $('updateBtn')
      const hint = $('updateStatus')
      btn.disabled = true
      hint.textContent = '正在问服务器…'
      try {
        const decision = await api.checkUpdate(true)
        if (decision && decision.kind !== 'none' && decision.url) {
          const info = await api.getUpdateStatus().catch(() => null)
          hint.textContent = '有新版本 ' + decision.version + '（现在是 ' + ((info && info.version) || '') + '）'
          btn.textContent = '去下载 ' + decision.version
          btn.disabled = false
          btn.onclick = () => api.openUpdate(decision.url)
          setStatus('发现新版本 ' + decision.version)
          return
        }
        const reasons = { 'up-to-date': '已经是最新版', throttled: '刚查过，过会儿再看', 'no-feed': '还没配更新地址（开发版正常）', skipped: '这个版本你之前跳过了', error: '连不上更新服务器，稍后再试' }
        hint.textContent = reasons[decision && decision.reason] || '已经是最新版'
        setStatus(hint.textContent)
      } catch (err) {
        hint.textContent = '检查失败：' + ((err && err.message) || String(err))
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
        if (!bytes) return '空'
        if (bytes < 1024) return bytes + ' B'
        if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB'
        return (bytes / 1024 / 1024).toFixed(1) + ' MB'
      }
      $('privSettings').textContent = size(info.files.settings && info.files.settings.bytes)
      const photos = info.files.photos || { count: 0, bytes: 0 }
      $('privPhotos').textContent = photos.count + ' 张 · ' + size(photos.bytes)
      const logs = (info.files.log && info.files.log.bytes) + (info.files.trace && info.files.trace.bytes)
      $('privLogs').textContent = size(logs)
      const caches = info.files.caches || { count: 0, bytes: 0 }
      $('privCaches').textContent = caches.count ? size(caches.bytes) : '没有'
      const cleanBtn = $('privacyCleanBtn')
      cleanBtn.textContent = logs || caches.bytes ? '清理日志和缓存（' + size(info.junkBytes) + '）' : '暂时没有可清理的'
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
      $('privacyStatus').textContent = '只删日志、抠图轨迹和浏览器缓存；设置、角色图和照片都留着。'
    })
    $('privacyCancelBtn').addEventListener('click', () => { resetPrivacyConfirm(); $('privacyStatus').textContent = '' })
    $('privacyConfirmBtn').addEventListener('click', async () => {
      const btn = $('privacyConfirmBtn')
      btn.disabled = true
      $('privacyStatus').textContent = '正在清理…'
      try {
        const result = await api.privacyCleanup()
        resetPrivacyConfirm()
        await refreshPrivacy()
        $('privacyStatus').textContent = '清理完了，删掉 ' + result.removed + ' 项'
        setStatus('日志和缓存已清理')
      } catch (err) {
        $('privacyStatus').textContent = '清理失败：' + ((err && err.message) || String(err))
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
        save({ update: { checkOnBoot: !!bootToggle.checked } }, true, bootToggle.checked ? '下次启动会看一眼' : '启动时不再检查更新')
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
        ? '今天第 ' + today.cups + ' 杯，共约 ' + today.ml + ' 毫升'
        : '今天还没喝呢，等第一杯'
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
        label.textContent = day.isToday ? '今天' : day.label
        const bar = document.createElement('span')
        bar.className = 'bar'
        const fill = document.createElement('i')
        fill.style.width = Math.round((day.cups / max) * 100) + '%'
        bar.appendChild(fill)
        const count = document.createElement('span')
        count.className = 'day-count'
        count.textContent = day.cups + ' 杯'
        li.appendChild(label)
        li.appendChild(bar)
        li.appendChild(count)
        weekNode.appendChild(li)
      })
    }).catch(() => {
      todayNode.textContent = '没读到喝水记录'
    })
  }

  // ------------------------------------------------- P1-4: find a setting
  // A hand-written index beats scraping the DOM: it can carry the words
  // people actually type ("音量/响度/大声"), and smoke can check that every
  // target id still exists in settings.html.
  const FIND_INDEX = [
    { panel: 'appearance', id: 'name', label: '它叫什么', hint: '改名字', keys: '名字 称呼 改名 昵称' },
    { panel: 'appearance', id: 'size', label: '多大一只', hint: '窗口大小', keys: '大小 尺寸 变大 变小 缩放' },
    { panel: 'appearance', id: 'alwaysOnTop', label: '一直看得见', hint: '不被别的窗口盖住', keys: '置顶 最前面 挡住' },
    { panel: 'appearance', id: 'autostart', label: '开机就出现', hint: '登录后自动启动', keys: '开机 自启 启动 登录' },
    { panel: 'appearance', id: 'snapEnabled', label: '靠边停好', hint: '拖到屏幕边缘吸住', keys: '吸附 吸住 边缘 贴边' },
    { panel: 'appearance', id: 'snapGap', label: '离边多远开始吸', hint: '吸附距离（px）', keys: '吸附 距离 像素' },
    { panel: 'role', id: 'importBtn', label: '换一张图当样子', hint: '选自己的图片', keys: '角色 形象 图片 换装 皮肤' },
    { panel: 'role', id: 'cutoutBtn', label: '用照片做个我', hint: '抠图做新角色', keys: '抠图 照片 去背 剪影' },
    { panel: 'role', id: 'resetPosBtn', label: '回到右下角', hint: '重置桌宠位置', keys: '位置 归位 右下角 跑丢' },
    { panel: 'bubble', id: 'autoHide', label: '气泡留多久', hint: '停留秒数', keys: '气泡 停留 几秒 消失' },
    { panel: 'bubble', id: 'cooldown', label: '两次天气之间', hint: '天气气泡间隔', keys: '天气 间隔 频率 多久' },
    { panel: 'bubble', id: 'phrases', label: '想对我说的话', hint: '每行一句台词', keys: '台词 说话 句子 文案 语录' },
    { panel: 'bubble', id: 'editorBtn', label: '气泡长什么样', hint: '排版与样式', keys: '气泡 样式 排版 布局 外观' },
    { panel: 'reminder', id: 'mode', label: '唠叨程度', hint: '提醒频率', keys: '唠叨 提醒 频率 少说 多说' },
    { panel: 'reminder', id: 'interval', label: '多久提醒喝水', hint: '喝水间隔分钟', keys: '喝水 几杯 间隔 提醒' },
    { panel: 'reminder', id: 'quietFrom', label: '安静时间（开始）', hint: '这个点以后不吵你', keys: '安静 免打扰 别吵 睡觉' },
    { panel: 'reminder', id: 'nudgeEnabled', label: '主动说话（总开关）', hint: '让它偶尔主动冒一句', keys: '主动 说话 搭话 提醒 唠叨 nudge' },
    { panel: 'reminder', id: 'nudgeLongUse', label: '坐太久了起来走走', hint: '连着用满 50 分钟提醒', keys: '久坐 站起来 休息 腰 眼睛' },
    { panel: 'reminder', id: 'nudgeLateNight', label: '深夜还在忙', hint: '23 点后劝你睡觉', keys: '深夜 熬夜 睡觉 早睡 晚' },
    { panel: 'reminder', id: 'nudgeAway', label: '好久没见你', hint: '两小时没互动打个招呼', keys: '好久 离开 回来 招呼' },
    { panel: 'reminder', id: 'quietTo', label: '安静时间（结束）', hint: '这个点以后恢复提醒', keys: '安静 免打扰 起床' },
    { panel: 'reminder', id: 'waterTimeline', label: '今天的喝水时间轴', hint: '几点喝了一杯', keys: '喝水 记录 时间轴 今天 几杯' },
    { panel: 'reminder', id: 'cupMl', label: '一杯多少毫升', hint: '导出 CSV 用', keys: '毫升 一杯 容量 导出' },
    { panel: 'reminder', id: 'exportWaterBtn', label: '导出喝水记录', hint: '生成 CSV', keys: '导出 csv 表格 记录 备份' },
    { panel: 'weather', id: 'city', label: '你在哪座城市', hint: '搜城市名', keys: '城市 定位 地点 在哪 天气' },
    { panel: 'weather', id: 'locateBtn', label: '用我的位置', hint: '自动定位', keys: '定位 位置 gps 自动' },
    { panel: 'weather', id: 'refreshMinutes', label: '多久看一眼天气', hint: '刷新间隔', keys: '天气 刷新 间隔 更新' },
    { panel: 'sound', id: 'sound', label: '让我出声', hint: '总开关', keys: '声音 静音 出声 音效' },
    { panel: 'sound', id: 'soundVolume', label: '音量', hint: '响度', keys: '音量 响度 大声 小声' },
    { panel: 'sound', id: 'soundEvents', label: '什么时候响', hint: '各事件音效', keys: '声音 事件 点击 提醒' },
    { panel: 'sound', id: 'soundImportBtn', label: '添加一段音频', hint: '自定义音效', keys: '音效 音频 自定义 导入' },
    { panel: 'other', id: 'diagBtn', label: '导出诊断信息', hint: '日志与状态，坐标打码', keys: '诊断 日志 报错 反馈 导出' },
    { panel: 'other', id: 'updateBtn', label: '检查更新', hint: '有新版本时提示，不会偷偷装', keys: '更新 升级 版本 新版 update' },
    { panel: 'other', id: 'privacyCleanBtn', label: '清理日志和缓存', hint: '数据与隐私，照片和设置不会动', keys: '隐私 清理 数据 缓存 日志 删除 privacy' },
    { panel: 'other', id: 'onboardBtn', label: '再看一次欢迎引导', hint: '重新走一遍引导', keys: '引导 欢迎 新手 教程' },
    { panel: 'other', id: 'openDirBtn', label: '东西放哪', hint: '打开数据文件夹', keys: '数据 文件夹 备份 目录' },
    { panel: 'other', id: 'quitBtn', label: '先退出啦', hint: '关掉桌宠', keys: '退出 关闭 结束' },
  ]

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
      empty.textContent = '没找到有关的设置，试试「气泡」「城市」「音量」'
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
    setStatus('找到了：' + entry.label, 1800)
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
          label: '自动定位',
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
      if (!panelResetPatch(panel)) { setStatus('这一页没有可以恢复的默认值', 2600); return }
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
      save(patch, true, '「' + (PANEL_TITLE[panel] || panel) + '」已经回到默认啦')
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

  /** Moves a freshly picked city to the front of the recent list. */
  function noteRecentCity(name) {
    const clean = String(name || '').trim()
    if (!clean || clean === '我找到的位置') return
    const weather = (state.settings && state.settings.weather) || {}
    const list = [clean].concat((weather.recent || []).filter((item) => item !== clean)).slice(0, 5)
    save({ weather: { recent: list } }, true, '记住啦')
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
          noteRecentCity(item.name)
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
  // P2-6: “现在的语言”来自主进程（设置里存的是偏好，可能是“跟随系统”）。
  async function renderLocaleStatus() {
    const now = $('localeNow')
    if (!now) return
    try {
      const info = await api.getI18n()
      const names = { 'zh-CN': '简体中文', 'en-US': 'English' }
      now.textContent = (names[info.locale] || info.locale) + '（可用：' + (info.available || []).join(' / ') + '，共 ' + (info.keys || 0) + ' 条）'
    } catch (err) {
      now.textContent = '读不到'
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

  async function renderUpdateStatus() {
    const hint = $('updateStatus')
    if (!hint) return
    try {
      const info = await api.getUpdateStatus()
      const last = info && info.lastCheckAt ? new Date(info.lastCheckAt).toLocaleString() : '还没查过'
      hint.textContent = '当前 ' + ((info && info.version) || '') + ' · 上次检查：' + last + '。有新版会在这里和气泡里说一声。'
    } catch (err) {
      hint.textContent = '读不到更新信息，不影响使用。'
    }
  }

  async function boot() {
    wireNav()
    wire()
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
