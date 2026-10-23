/**
 * `lib/cutout-math.js` — 抠图管线的纯数学层（阈值、形态学、连通块、裁剪框）。
 *
 * M12 的“背景半透明”事故就出在这一层的阈值上，所以这里既测正常形状，也钉住
 * 几个历史边界：孤立噪点被丢、封闭小洞被填、空掩膜安全返回 null。
 */
'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
const math = require('../../lib/cutout-math.js')

const {
  clamp01, normalizeMask, hysteresisMask, erode, dilate, openMask, closeMask,
  fillHoles, components, retainComponents, largestComponent, maskBounds, fitRect,
  alphaCoverage, smoothstep,
} = math

/** 3x3 掩膜：`on` 里的下标置 1。 */
function mask3(on) {
  const m = new Uint8Array(9)
  for (const i of on) m[i] = 1
  return m
}

test('clamp01：夹在 0..1', () => {
  assert.equal(clamp01(-1), 0)
  assert.equal(clamp01(2), 1)
  assert.equal(clamp01(0.5), 0.5)
})

test('normalizeMask：垃圾输入返回 null，正常值夹到 0..1 且 NaN 归零', () => {
  assert.equal(normalizeMask(null, 4), null)
  assert.equal(normalizeMask([], 0), null)
  const out = normalizeMask([0.5, 2, -1, NaN], 4)
  assert.deepEqual(Array.from(out), [0.5, 1, 0, 0])
})

test('hysteresisMask：高置信种子连同相连的低置信区一起保留，孤立低置信丢弃', () => {
  // 8x1 条带：两个高置信点夹着 0.4 的低置信点；右侧远处还有一个孤立 0.4。
  const scores = [0.9, 0.4, 0.4, 0.9, 0, 0.4, 0, 0]
  const mask = hysteresisMask(scores, 8, 1, 0.3, 0.55)
  assert.deepEqual(Array.from(mask), [1, 1, 1, 1, 0, 0, 0, 0])
})

test('erode / dilate：居中的 3x3 块腐蚀成中心一点、单点膨胀成 3x3', () => {
  const block = new Uint8Array(25)
  for (const i of [6, 7, 8, 11, 12, 13, 16, 17, 18]) block[i] = 1
  const eroded = erode(block, 5, 5)
  assert.equal(eroded[12], 1)
  assert.equal(eroded.filter((v) => v === 1).length, 1, '只剩中心一点')
  const dot = mask3([4])
  assert.deepEqual(Array.from(dilate(dot, 3, 3)), Array(9).fill(1))
})

test('openMask：开运算去掉孤立噪点', () => {
  assert.deepEqual(Array.from(openMask(mask3([4]), 3, 3)), Array(9).fill(0))
})

test('closeMask：闭运算填平一个小缺口', () => {
  // 一行五个 1，中间缺一个 → 闭运算后连续。
  const line = new Uint8Array([1, 1, 0, 1, 1])
  assert.deepEqual(Array.from(closeMask(line, 5, 1)), [1, 1, 1, 1, 1])
})

test('fillHoles：填掉封闭的小洞，开放区域不动', () => {
  // 5x5 边框 = 1，中心一个 3x3 区域的洞（面积 9）。
  const m = new Uint8Array(25).fill(1)
  for (let y = 1; y <= 3; y++) for (let x = 1; x <= 3; x++) m[y * 5 + x] = 0
  const filled = fillHoles(m, 5, 5, 9)
  assert.equal(filled[12], 1)
  const limited = fillHoles(m, 5, 5, 4)
  assert.equal(limited[12], 0)
})

test('components：两块分离的前景得到两个连通块', () => {
  const m = mask3([0, 1, 2, 6, 7, 8])
  const { sizes } = components(m, 3, 3)
  assert.equal(sizes.length, 2)
  assert.deepEqual(sizes.slice().sort(), [3, 3])
})

test('retainComponents：保留主块，丢掉低于像素下限的碎屑', () => {
  const m = new Uint8Array(16)
  m[0] = 1
  m[1] = 1
  m[4] = 1
  m[5] = 1
  m[15] = 1 // 孤立单点（(3,3)，与 2x2 块不相连）
  const kept = retainComponents(m, 4, 4)
  assert.equal(kept[15], 0)
  assert.equal(kept[0], 1)
})

test('largestComponent：只留下最大的一块', () => {
  const alpha = new Float32Array(16)
  for (const i of [0, 1, 4, 5]) alpha[i] = 0.9
  alpha[15] = 0.9
  const kept = largestComponent(alpha, 4, 4)
  assert.equal(kept[15], 0)
  assert.equal(kept[0], 1)
})

test('largestComponent：全空掩膜返回 null', () => {
  assert.equal(largestComponent(new Float32Array(9), 3, 3), null)
})

test('maskBounds：给出最小外框，空掩膜返回 null', () => {
  const alpha = new Float32Array(16)
  alpha[5] = 1
  alpha[6] = 1
  assert.deepEqual(maskBounds(alpha, 4, 4), { x: 1, y: 1, width: 2, height: 1 })
  assert.equal(maskBounds(new Float32Array(16), 4, 4), null)
})

test('fitRect：横图与竖图都装进 610 画布且底边居中', () => {
  const wide = fitRect(1000, 500)
  assert.ok(wide.width <= 610 * 0.94 + 1)
  assert.ok(wide.height < wide.width)
  assert.ok(wide.y >= 0 && wide.y + wide.height <= 610)

  const tall = fitRect(500, 1000)
  assert.ok(tall.height <= 610 * 0.94 + 1)
  assert.ok(tall.width < tall.height)
  assert.equal(tall.x, Math.round((610 - tall.width) / 2))
})

test('alphaCoverage：全 1、半满与空输入', () => {
  assert.equal(alphaCoverage(new Float32Array([1, 1, 1, 1])), 1)
  assert.equal(alphaCoverage(new Float32Array([1, 0, 1, 0])), 0.5)
  assert.equal(alphaCoverage(null), 0)
})

test('smoothstep：端点与中点', () => {
  assert.equal(smoothstep(0, 1, -1), 0)
  assert.equal(smoothstep(0, 1, 2), 1)
  assert.equal(smoothstep(0, 1, 0.5), 0.5)
  assert.equal(smoothstep(1, 1, 1), 1)
  assert.equal(smoothstep(1, 1, 0), 0)
})