#!/usr/bin/env node
/**
 * Accessibility audit (automatable part) for the deskpet windows.
 *
 * Connects to a running app started with --remote-debugging-port and audits
 * the pet / settings / cutout / editor renderers:
 *   - accessible names from the real accessibility tree
 *   - text contrast (WCAG 1.4.3 / 1.4.6 approx.)
 *   - target size (WCAG 2.2 AA 2.5.8, 24x24)
 *   - keyboard focus visibility and focus order (WCAG 2.4.7 / 2.4.3)
 *   - keyboard-only activation of the cutout flow (2.1.1)
 *   - reflow at 320 CSS px (WCAG 1.4.10)
 *   - forced-colors and prefers-reduced-motion emulation
 *
 * It CANNOT replace a real screen-reader (NVDA/VoiceOver) or OS high-contrast
 * run; see A11Y-AUDIT.md.
 *
 *   node tools/a11y-audit.js --port 9229 [--out report.json] [--json]
 */
'use strict'

const fs = require('node:fs')
const path = require('node:path')

function parseArgs(argv) {
  const out = { port: 9229, json: false }
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--port') out.port = Number(argv[++i]) || 9229
    else if (argv[i] === '--out') out.out = argv[++i]
    else if (argv[i] === '--json') out.json = true
    else if (argv[i] === '--flow') out.flow = true
    else if (argv[i] === '--flow-only') out.flowOnly = true
    else if (argv[i] === '--help') out.help = true
  }
  return out
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

async function targets(port) {
  return (await (await fetch('http://127.0.0.1:' + port + '/json/list')).json())
}

async function connect(target) {
  const ws = new WebSocket(target.webSocketDebuggerUrl)
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej })
  let id = 0
  const pending = new Map()
  ws.onmessage = (ev) => {
    const m = JSON.parse(String(ev.data))
    if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id) }
  }
  const send = (method, params = {}) => new Promise((res, rej) => {
    const n = ++id
    const timer = setTimeout(() => { pending.delete(n); rej(new Error(method + ': timed out')) }, 20000)
    pending.set(n, (m) => {
      clearTimeout(timer)
      return m.error ? rej(new Error(method + ': ' + JSON.stringify(m.error))) : res(m.result)
    })
    ws.send(JSON.stringify({ id: n, method, params }))
  })
  const evaluate = async (expression) => {
    const r = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true })
    if (r.exceptionDetails) throw new Error('EVAL ' + JSON.stringify(r.exceptionDetails))
    return r.result && r.result.value
  }
  return { ws, send, evaluate }
}

// Page-side helpers, installed with Runtime.evaluate.
const HELPERS = `
window.__a11y = (() => {
  const parseColor = (str) => {
    const m = String(str || '').match(/rgba?\\(\\s*(\\d+)[,\\s]+(\\d+)[,\\s]+(\\d+)(?:[,\\s\\/]+([\\d.]+))?\\s*\\)/);
    return m ? [+m[1], +m[2], +m[3], m[4] === undefined ? 1 : +m[4]] : null;
  };
  const lum = (c) => {
    const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); };
    return 0.2126 * f(c[0]) + 0.7152 * f(c[1]) + 0.0722 * f(c[2]);
  };
  const contrast = (a, b) => {
    const l1 = lum(a), l2 = lum(b);
    const hi = Math.max(l1, l2), lo = Math.min(l1, l2);
    return (hi + 0.05) / (lo + 0.05);
  };
  const isVisible = (el) => {
    const r = el.getBoundingClientRect();
    if (r.width <= 0 || r.height <= 0) return false;
    const s = getComputedStyle(el);
    return s.display !== 'none' && s.visibility !== 'hidden' && s.opacity !== '0';
  };
  // Keyboard reachability: an element may be opacity:0 until it is focused
  // (the pet menu button does exactly that), so do not filter those out.
  const isFocusable = (el) => {
    const r = el.getBoundingClientRect();
    if (r.width <= 0 || r.height <= 0) return false;
    const s = getComputedStyle(el);
    return s.display !== 'none' && s.visibility !== 'hidden' && !el.disabled;
  };
  const desc = (el) => {
    const id = el.id ? '#' + el.id : '';
    let cls = '';
    if (typeof el.className === 'string' && el.className.trim()) cls = '.' + el.className.trim().split(/\\s+/).slice(0, 2).join('.');
    return el.tagName.toLowerCase() + id + cls;
  };
  const accessibleName = (el) => {
    const aria = el.getAttribute && el.getAttribute('aria-label');
    if (aria && aria.trim()) return aria.trim();
    if (el.getAttribute && el.getAttribute('aria-labelledby')) {
      const ref = document.getElementById(el.getAttribute('aria-labelledby'));
      if (ref && ref.textContent.trim()) return ref.textContent.trim();
    }
    const tag = el.tagName;
    if (tag === 'IMG') return (el.getAttribute('alt') || '').trim();
    if (tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA') {
      if (el.id) {
        const lab = document.querySelector('label[for="' + el.id + '"]');
        if (lab && lab.textContent.trim()) return lab.textContent.trim();
      }
      if (el.closest('label')) return el.closest('label').textContent.trim();
      return (el.getAttribute('placeholder') || '').trim();
    }
    return (el.textContent || '').replace(/\\s+/g, ' ').trim().slice(0, 60);
  };
  const effectiveBg = (el) => {
    let e = el;
    while (e) {
      const c = parseColor(getComputedStyle(e).backgroundColor);
      if (c && c[3] > 0.9) return c.slice(0, 3);
      e = e.parentElement;
    }
    return [255, 255, 255];
  };
  const interactive = (includeTransparent) => Array.from(document.querySelectorAll(
    'a[href],button,input,select,textarea,[tabindex]:not([tabindex="-1"]),[role="button"],[role="switch"],[role="tab"],[role="slider"]'
  )).filter(includeTransparent ? isFocusable : isVisible);
  // The effective pointer target is the control itself or its label, whichever
// is larger: a checkbox may be 16px inside a large label, while a text field is
// larger than its (short) field label.
  const targetBox = (el) => {
    const boxes = [el.getBoundingClientRect()];
    if (el.id) {
      const lab = document.querySelector('label[for="' + el.id + '"]');
      if (lab && isVisible(lab)) boxes.push(lab.getBoundingClientRect());
    }
    const wrap = el.closest('label');
    if (wrap && isVisible(wrap)) boxes.push(wrap.getBoundingClientRect());
    return boxes.reduce((a, b) => (b.width * b.height > a.width * a.height ? b : a));
  };

  return {
    desc, accessibleName, isVisible, isFocusable, interactive, contrast, effectiveBg, parseColor, targetBox,
    contrastReport: () => {
      const findings = [];
      const els = Array.from(document.querySelectorAll('body *'));
      for (const el of els) {
        if (!isVisible(el)) continue;
        if (el.closest('[aria-hidden="true"]')) continue;
        const hasText = Array.from(el.childNodes).some((n) => n.nodeType === 3 && n.textContent.trim().length > 0);
        if (!hasText) continue;
        const cs = getComputedStyle(el);
        const fg = parseColor(cs.color);
        if (!fg) continue;
        const bg = effectiveBg(el);
        const size = parseFloat(cs.fontSize);
        const weight = parseInt(cs.fontWeight, 10) || 400;
        const large = size >= 24 || (size >= 18.66 && weight >= 600);
        const min = large ? 3 : 4.5;
        const ratio = contrast(fg.slice(0, 3), bg);
        if (ratio < min) {
          findings.push({
            el: desc(el), text: (el.textContent || '').trim().slice(0, 40),
            ratio: Math.round(ratio * 100) / 100, min, fontSize: size, weight,
            color: cs.color, bg: 'rgb(' + bg.join(',') + ')',
          });
        }
      }
      return findings;
    },
    targetSizeReport: (min) => {
      const findings = [];
      for (const el of interactive(false)) {
        const candidates = [el.getBoundingClientRect()];
        if (el.id) {
          const lab = document.querySelector('label[for="' + el.id + '"]');
          if (lab && isVisible(lab)) candidates.push(lab.getBoundingClientRect());
        }
        const wrap = el.closest('label');
        if (wrap && isVisible(wrap)) candidates.push(wrap.getBoundingClientRect());
        // Pass if any candidate box (control or its label) meets the minimum.
        if (candidates.some((r) => r.width + 0.5 >= min && r.height + 0.5 >= min)) continue;
        const best = candidates.reduce((a, b) => (b.width * b.height > a.width * a.height ? b : a));
        findings.push({ el: desc(el), name: accessibleName(el), w: Math.round(best.width), h: Math.round(best.height) });
      }
      return findings;
    },
    focusOrder: () => interactive(true).map((el) => desc(el) + ' [' + accessibleName(el) + ']'),
    // reduced motion: anything that still animates for more than 50ms.
    motionReport: () => {
      const toMs = (v) => {
        const out = [];
        for (const part of String(v).split(',')) {
          const s = part.trim();
          const n = parseFloat(s);
          if (!isFinite(n)) continue;
          out.push(s.endsWith('ms') ? n : n * 1000);
        }
        return out.length ? Math.max.apply(null, out) : 0;
      };
      const findings = [];
      for (const el of Array.from(document.querySelectorAll('body *')).slice(0, 300)) {
        const cs = getComputedStyle(el);
        const ms = Math.max(toMs(cs.transitionDuration), toMs(cs.animationDuration));
        if (ms > 50) findings.push({ el: desc(el), ms: Math.round(ms) });
      }
      return findings;
    },
    unnamedInteractive: () => interactive().filter((el) => !accessibleName(el)).map(desc),
    overflow: () => ({
      innerWidth: window.innerWidth,
      docScrollWidth: document.documentElement.scrollWidth,
      bodyScrollWidth: document.body.scrollWidth,
      overflowing: Array.from(document.querySelectorAll('body *')).filter((el) => {
        const r = el.getBoundingClientRect();
        return isVisible(el) && r.right > window.innerWidth + 1;
      }).slice(0, 8).map(desc),
    }),
    forcedColorsReport: () => {
      const findings = [];
      const els = Array.from(document.querySelectorAll('button,[role="button"],.pill,.seg,[aria-pressed]'));
      for (const el of els) {
        if (!isVisible(el)) continue;
        const cs = getComputedStyle(el);
        const fg = parseColor(cs.color);
        const bg = parseColor(cs.backgroundColor);
        const border = parseColor(cs.borderTopColor);
        const bgImage = cs.backgroundImage && cs.backgroundImage !== 'none';
        const distinct = !fg || !bg || contrast(fg.slice(0, 3), bg.slice(0, 3)) >= 1.2 || (border && cs.borderTopWidth !== '0px');
        if (!distinct && !bgImage) findings.push({ el: desc(el), color: cs.color, bg: cs.backgroundColor });
      }
      return findings;
    },
  };
})();
'ok'
`

function section(title) {
  console.log('\n== ' + title + ' ==')
}

async function auditPage(conn, label, report, options) {
  await conn.send('Runtime.enable')
  await conn.send('Page.enable')
  try { await conn.send('Accessibility.enable') } catch (err) {}
  await conn.evaluate(HELPERS)

  section(label)

  // 1. accessibility tree: named interactive nodes / images
  try {
    const tree = await conn.send('Accessibility.getFullAXTree')
    const nodes = tree.nodes || []
    const interactiveRoles = new Set(['button', 'link', 'textbox', 'checkbox', 'switch', 'tab', 'combobox', 'slider', 'menuitem', 'radio'])
    const unnamed = nodes.filter((n) => {
      if (n.ignored) return false
      const role = n.role && n.role.value
      if (!interactiveRoles.has(role)) return false
      const name = (n.name && n.name.value) || ''
      return !String(name).trim()
    }).map((n) => (n.role && n.role.value) + '#' + (n.backendDOMNodeId || ''))
    const images = nodes.filter((n) => !n.ignored && (n.role && n.role.value) === 'image')
    const unnamedImages = images.filter((n) => !String((n.name && n.name.value) || '').trim()).length
    report.push({ page: label, check: 'AX：交互元素可访问名称', ok: unnamed.length === 0, detail: unnamed.slice(0, 5) })
    report.push({ page: label, check: 'AX：图片可访问名称', ok: unnamedImages === 0, detail: images.length + ' 个 image 节点' })
    console.log((unnamed.length === 0 ? '  PASS  ' : '  FAIL  ') + 'AX 交互元素名称' + (unnamed.length ? ' -> ' + JSON.stringify(unnamed.slice(0, 5)) : ''))
    console.log((unnamedImages === 0 ? '  PASS  ' : '  FAIL  ') + 'AX 图片名称（' + images.length + ' 个 image 节点）')
  } catch (err) {
    console.log('  SKIP  AX 树不可用: ' + err.message)
  }

  // 2. contrast
  const contrast = await conn.evaluate('JSON.stringify(window.__a11y.contrastReport())').then(JSON.parse)
  report.push({ page: label, check: '对比度', ok: contrast.length === 0, detail: contrast.slice(0, 8) })
  console.log((contrast.length === 0 ? '  PASS  ' : '  FAIL  ') + '文本对比度（' + contrast.length + ' 处低于门槛）')
  for (const f of contrast.slice(0, 8)) console.log('        ' + f.el + ' ratio=' + f.ratio + ' min=' + f.min + ' "' + f.text + '" ' + f.color + ' on ' + f.bg)

  // 3. target size (24x24)
  const targets = await conn.evaluate('JSON.stringify(window.__a11y.targetSizeReport(24))').then(JSON.parse)
  report.push({ page: label, check: '目标尺寸 ≥24×24', ok: targets.length === 0, detail: targets })
  console.log((targets.length === 0 ? '  PASS  ' : '  FAIL  ') + '目标尺寸 ≥24×24（' + targets.length + ' 个小目标）')
  for (const t of targets.slice(0, 8)) console.log('        ' + t.el + ' ' + t.w + 'x' + t.h + ' "' + t.name + '"')

  // 4. unnamed interactive from DOM (cross-check)
  const unnamedDom = await conn.evaluate('JSON.stringify(window.__a11y.unnamedInteractive())').then(JSON.parse)
  report.push({ page: label, check: 'DOM：交互元素可访问名称', ok: unnamedDom.length === 0, detail: unnamedDom })
  console.log((unnamedDom.length === 0 ? '  PASS  ' : '  FAIL  ') + 'DOM 交互元素名称（' + unnamedDom.length + ' 个无名）')

  // 5. keyboard focus visibility + order
  const order = await conn.evaluate('JSON.stringify(window.__a11y.focusOrder())').then(JSON.parse)
  report.push({ page: label, check: '键盘焦点顺序', ok: order.length > 0, detail: order })
  console.log('  INFO  焦点顺序 ' + order.length + ' 项: ' + order.slice(0, 10).join(' | '))

  await conn.evaluate('(() => { document.body.focus(); if (document.activeElement !== document.body) document.activeElement.blur(); return 1 })()')
  const invis = []
  let seen = 0
  for (let i = 0; i < Math.min(order.length + 3, 40); i++) {
    await conn.send('Input.dispatchKeyEvent', { type: 'rawKeyDown', key: 'Tab', code: 'Tab', windowsVirtualKeyCode: 9 })
    await conn.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Tab', code: 'Tab', windowsVirtualKeyCode: 9 })
    await sleep(60)
    const info = await conn.evaluate(`JSON.stringify((() => {
      const el = document.activeElement;
      if (!el || el === document.body || el === document.documentElement) return null;
      const cs = getComputedStyle(el);
      const outline = cs.outlineStyle + ' ' + cs.outlineWidth + ' ' + cs.outlineColor;
      const shadow = cs.boxShadow;
      const border = cs.borderTopColor;
      const visible = (cs.outlineStyle !== 'none' && parseFloat(cs.outlineWidth) > 0) || (shadow && shadow !== 'none') || !el.matches(':focus');
      return { el: window.__a11y.desc(el), outline, shadow, border };
    })())`).then((s) => (s ? JSON.parse(s) : null))
    if (!info) continue
    seen++
    if (info.outline.startsWith('none 0px') && (!info.shadow || info.shadow === 'none')) invis.push(info)
  }
  report.push({ page: label, check: '焦点可见性', ok: invis.length === 0, detail: invis.slice(0, 6) })
  console.log((invis.length === 0 ? '  PASS  ' : '  FAIL  ') + '焦点可见性（走过 ' + seen + ' 个焦点，' + invis.length + ' 个无可视指示）')
  for (const f of invis.slice(0, 6)) console.log('        ' + f.el + ' outline=' + f.outline + ' shadow=' + f.shadow)

  // 6. reflow at 320 CSS px
  await conn.send('Emulation.setDeviceMetricsOverride', { width: 320, height: 640, deviceScaleFactor: 1, mobile: false })
  await sleep(150)
  const reflow = await conn.evaluate('JSON.stringify(window.__a11y.overflow())').then(JSON.parse)
  await conn.send('Emulation.clearDeviceMetricsOverride')
  await sleep(100)
  const reflowOk = reflow.docScrollWidth <= reflow.innerWidth + 1 && reflow.overflowing.length === 0
  report.push({ page: label, check: '320px 回流', ok: reflowOk, detail: reflow })
  console.log((reflowOk ? '  PASS  ' : '  FAIL  ') + '320px 回流 innerWidth=' + reflow.innerWidth + ' scrollWidth=' + reflow.docScrollWidth +
    (reflow.overflowing.length ? ' overflow=' + JSON.stringify(reflow.overflowing) : ''))

  // 7. forced colors
  await conn.send('Emulation.setEmulatedMedia', { media: 'screen', features: [{ name: 'forced-colors', value: 'active' }] })
  await sleep(120)
  const forced = await conn.evaluate('JSON.stringify(window.__a11y.forcedColorsReport())').then(JSON.parse)
  await conn.send('Emulation.setEmulatedMedia', { media: '', features: [] })
  await sleep(80)
  report.push({ page: label, check: 'forced-colors', ok: forced.length === 0, detail: forced.slice(0, 6) })
  console.log((forced.length === 0 ? '  PASS  ' : '  FAIL  ') + 'forced-colors 下控件仍可辨（' + forced.length + ' 处）')

  // 8. reduced motion
  await conn.send('Emulation.setEmulatedMedia', { media: 'screen', features: [{ name: 'prefers-reduced-motion', value: 'reduce' }] })
  await sleep(150)
  const motion = await conn.evaluate('JSON.stringify(window.__a11y.motionReport())').then(JSON.parse)
  await conn.send('Emulation.setEmulatedMedia', { media: '', features: [] })
  await sleep(80)
  report.push({ page: label, check: 'reduced-motion', ok: motion.length === 0, detail: motion.slice(0, 8) })
  console.log((motion.length === 0 ? '  PASS  ' : '  FAIL  ') + 'reduced-motion 下无 >50ms 过渡（' + motion.length + ' 个元素）')
  for (const m of motion.slice(0, 5)) console.log('        ' + m.el + ' ' + m.ms + 'ms')
// 9. sweep every panel/tab: contrast and target size can differ per section.
  if (label === 'settings.html' || label === 'editor.html') {
    const sel = label === 'settings.html' ? '.nav-item' : '#tabs .tab'
    const count = await conn.evaluate('document.querySelectorAll(' + JSON.stringify(sel) + ').length')
    for (let i = 0; i < count; i++) {
      const title = await conn.evaluate('(() => { const els = document.querySelectorAll(' + JSON.stringify(sel) + '); const el = els[' + i + ']; if (!el) return null; el.click(); return (el.textContent || "").trim().slice(0, 20) })()')
      await sleep(250)
      const c = await conn.evaluate('JSON.stringify(window.__a11y.contrastReport())').then(JSON.parse)
      const t = await conn.evaluate('JSON.stringify(window.__a11y.targetSizeReport(24))').then(JSON.parse)
      const unnamed = await conn.evaluate('JSON.stringify(window.__a11y.unnamedInteractive())').then(JSON.parse)
      report.push({ page: label + ' / ' + title, check: '对比度', ok: c.length === 0, detail: c.slice(0, 6) })
      report.push({ page: label + ' / ' + title, check: '目标尺寸 ≥24×24', ok: t.length === 0, detail: t.slice(0, 6) })
      report.push({ page: label + ' / ' + title, check: '可访问名称', ok: unnamed.length === 0, detail: unnamed.slice(0, 6) })
      console.log('  ' + (c.length === 0 ? 'PASS  ' : 'FAIL  ') + '面板「' + title + '」对比度 ' + (c.length ? c.length + ' 处' : 'ok'))
      if (unnamed.length) console.log('  FAIL  面板「' + title + '」无名控件: ' + JSON.stringify(unnamed.slice(0, 5)))
      for (const f of c.slice(0, 4)) console.log('        ' + f.el + ' ratio=' + f.ratio + ' "' + f.text + '" ' + f.color + ' on ' + f.bg)
      if (t.length) {
        console.log('  FAIL  面板「' + title + '」小目标 ' + t.length + ' 个')
        for (const f of t.slice(0, 4)) console.log('        ' + f.el + ' ' + f.w + 'x' + f.h + ' "' + f.name + '"')
      }
    }
  }
}



/**
 * Keyboard-only operation of the cutout window (WCAG 2.1.1). The photo is
 * loaded through the same IPC the drag/drop path uses, because the native file
 * dialog cannot be driven from CDP; everything after that is keyboard only.
 */

async function openWindow(pet, method, urlPart, port, timeout = 8000) {
  await pet.evaluate('window.deskPet.' + method + '()')
  const start = Date.now()
  while (Date.now() - start < timeout) {
    const all = await targets(port)
    const t = all.filter((x) => x.url.includes(urlPart)).pop()
    if (t) return t
    await sleep(200)
  }
  throw new Error('window ' + urlPart + ' did not open')
}

async function main() {
  const opts = parseArgs(process.argv.slice(2))
  const watchdog = setTimeout(() => { console.error('audit watchdog: giving up after 240s'); process.exit(3) }, 240000)
  watchdog.unref && watchdog.unref()
  if (opts.help) { console.log(fs.readFileSync(__filename, 'utf8').split('*/')[0]); return }
  if (opts.flow || opts.flowOnly) {
    console.log('键盘-only 流程已拆成单独的工具，请运行: node tools/a11y-keyboard.js --port ' + opts.port)
  }
  const list = await targets(opts.port)
  const petTarget = list.find((x) => x.url.includes('pet.html'))
  if (!petTarget) throw new Error('pet window not found on port ' + opts.port + '; start the app with --remote-debugging-port')

  const report = []
  const pet = await connect(petTarget)
  await pet.send('Runtime.enable')

  const pages = []
  pages.push(['pet.html', pet, petTarget])
  try {
    pages.push(['cutout.html', await connect(await openWindow(pet, 'openCutout', 'cutout.html', opts.port)), null])
  } catch (err) { console.error('cutout window:', err.message) }
  try {
    pages.push(['settings.html', await connect(await openWindow(pet, 'openSettings', 'settings.html', opts.port)), null])
  } catch (err) { console.error('settings window:', err.message) }
  try {
    pages.push(['editor.html', await connect(await openWindow(pet, 'openEditor', 'editor.html', opts.port)), null])
  } catch (err) { console.error('editor window:', err.message) }

  for (const [label, conn] of pages) {
    try {
      await auditPage(conn, label, report)
    } catch (err) {
      console.error('audit failed for ' + label + ': ' + err.message)
      report.push({ page: label, check: 'audit', ok: false, detail: err.message })
    }
  }

  console.log('\n== 汇总 ==')
  const failed = report.filter((r) => !r.ok)
  console.log('检查项 ' + report.length + '，失败 ' + failed.length)
  for (const f of failed) console.log('  FAIL  ' + f.page + ' / ' + f.check)

  if (opts.out) {
    fs.mkdirSync(path.dirname(opts.out), { recursive: true })
    fs.writeFileSync(opts.out, JSON.stringify({ at: new Date().toISOString(), report }, null, 2))
    console.log('report written to ' + opts.out)
  }
  process.exitCode = failed.length ? 1 : 0
  process.exit(process.exitCode)
}

main().catch((err) => { console.error(err && err.stack || err); process.exit(2) })