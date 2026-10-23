'use strict'

const test = require('node:test')
const assert = require('node:assert')
const metrics = require('../../lib/cutout-eval')

function mask(w, h, on) {
  const m = new Uint8Array(w * h)
  for (const i of on) m[i] = 1
  return m
}

test('iou：完全一致为 1，完全不相交为 0', () => {
  const a = mask(4, 1, [0, 1])
  assert.strictEqual(metrics.iou(a, mask(4, 1, [0, 1])), 1)
  assert.strictEqual(metrics.iou(a, mask(4, 1, [2, 3])), 0)
})

test('iou：一半重叠 = 1/3', () => {
  const a = mask(4, 1, [0, 1])
  const b = mask(4, 1, [1, 2])
  assert.ok(Math.abs(metrics.iou(a, b) - 1 / 3) < 1e-9)
})

test('iou：两边都空算完全一致', () => {
  assert.strictEqual(metrics.iou(mask(2, 1, []), mask(2, 1, [])), 1)
})

test('iou：长度不同返回 0（不抛）', () => {
  assert.strictEqual(metrics.iou(mask(2, 1, [0]), mask(3, 1, [0])), 0)
})

test('boundaryLength：统计“有背景邻居”的前景像素数', () => {
  assert.strictEqual(metrics.boundaryLength(mask(3, 3, [4]), 3, 3), 1)
  assert.strictEqual(metrics.boundaryLength(mask(2, 2, [0, 1, 2, 3]), 2, 2), 4)
  assert.strictEqual(metrics.boundaryLength(mask(3, 3, []), 3, 3), 0)
})

test('edgeSharpness：硬边 255，软边更小', () => {
  const w = 8
  const hard = new Uint8Array(w * 2)
  for (let y = 0; y < 2; y++) for (let x = 0; x < w; x++) hard[y * w + x] = x < 4 ? 255 : 0
  assert.strictEqual(metrics.edgeSharpness(hard, w, 2), 255)
  const soft = new Uint8Array(w * 2)
  for (let y = 0; y < 2; y++) for (let x = 0; x < w; x++) soft[y * w + x] = x < 4 ? 200 : 60
  const value = metrics.edgeSharpness(soft, w, 2)
  assert.ok(value > 0 && value < 255, 'soft edge 应小于 255，实际 ' + value)
})

test('edgeSharpness：全透明/全不透明没有边界时返回 0', () => {
  assert.strictEqual(metrics.edgeSharpness(new Uint8Array(64), 8, 8), 0)
})

test('greyChannel：alpha 恒定（抠图蒙版写在 RGB）时取亮度', () => {
  const rgba = Buffer.from([0, 0, 0, 255, 255, 255, 255, 255])
  assert.deepStrictEqual(Array.from(metrics.greyChannel(rgba)), [0, 255])
})

test('greyChannel：alpha 变化时优先取 alpha', () => {
  const rgba = Buffer.from([10, 10, 10, 0, 10, 10, 10, 200])
  assert.deepStrictEqual(Array.from(metrics.greyChannel(rgba)), [0, 200])
})

test('maskFromImage：阈值 127 分界，两条通道都能出 0/1', () => {
  const rgbMask = Buffer.from([128, 128, 128, 255, 127, 127, 127, 255])
  assert.deepStrictEqual(Array.from(metrics.maskFromImage(rgbMask, 127)), [1, 0])
  const alphaMask = Buffer.from([0, 0, 0, 200, 0, 0, 0, 10])
  assert.deepStrictEqual(Array.from(metrics.maskFromImage(alphaMask, 127)), [1, 0])
})

test('percentile：最近秩，不做插值', () => {
  assert.strictEqual(metrics.percentile([10, 20, 30, 40], 50), 20)
  assert.strictEqual(metrics.percentile([10, 20, 30, 40], 100), 40)
  assert.strictEqual(metrics.percentile([], 50), 0)
})

test('summarize：汇总 IoU 均值/最低、ms 分位、edge 均值', () => {
  const s = metrics.summarize([
    { iou: 0.9, ms: 100, edge: 200 },
    { iou: 0.8, ms: 300, edge: 250 },
    { iou: 1, ms: 200, edge: 255 },
  ])
  assert.strictEqual(s.count, 3)
  assert.strictEqual(s.iouCount, 3)
  assert.ok(Math.abs(s.iouMean - 0.9) < 1e-9)
  assert.strictEqual(s.iouMin, 0.8)
  assert.strictEqual(s.msP50, 200)
  assert.strictEqual(s.msP95, 300)
  assert.ok(Math.abs(s.edgeMean - 235) < 1e-9)
})

test('summarize：没有 IoU 时 iouCount=0 且不除零', () => {
  const s = metrics.summarize([{ ms: 50, edge: 255 }, { error: 'NO_PERSON' }])
  assert.strictEqual(s.count, 2)
  assert.strictEqual(s.iouCount, 0)
  assert.strictEqual(s.iouMean, 0)
  assert.strictEqual(s.msP50, 50)
})