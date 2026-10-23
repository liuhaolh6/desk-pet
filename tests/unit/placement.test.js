/**
 * `lib/placement.js` — 多显示器恢复、夹取与边缘吸附（纯函数）。
 *
 * 这些是“桌宠跑到屏幕外/换显示器后消失”类 bug 的护栏：用例都按 pet 矩形
 * 思考，窗口坐标比 pet 多一个左侧 `pad`。
 */
'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
const placement = require('../../lib/placement.js')

const {
  clamp, normalizeDisplays, petRectOf, winFromPet, contains, intersectionArea,
  displayForRect, displayAt, clampPet, snapPet, defaultPet, resolveSaved, ensureVisible,
} = placement

const SIZE = 220
const PAD = 54

const displays = [
  { id: 1, primary: true, workArea: { x: 0, y: 0, width: 1920, height: 1040 } },
  { id: 2, primary: false, workArea: { x: 1920, y: 0, width: 1280, height: 984 } },
]

test('clamp：夹在区间内', () => {
  assert.equal(clamp(5, 0, 3), 3)
  assert.equal(clamp(-1, 0, 3), 0)
  assert.equal(clamp(2, 0, 3), 2)
})

test('normalizeDisplays：丢掉没有 workArea 的项，id 转字符串', () => {
  const list = normalizeDisplays([{ id: 1, primary: 1, workArea: { x: 0, y: 0, width: 800, height: 600 } }, { id: 2 }, null])
  assert.equal(list.length, 1)
  assert.equal(list[0].id, '1')
  assert.equal(list[0].primary, true)
  assert.deepEqual(normalizeDisplays(null), [])
})

test('petRectOf / winFromPet：互相抵消 pad', () => {
  assert.deepEqual(petRectOf({ x: 100, y: 50 }, SIZE, PAD), { x: 154, y: 50, width: SIZE, height: SIZE })
  assert.deepEqual(winFromPet({ x: 154, y: 50 }, PAD), { x: 100, y: 50 })
})

test('contains / intersectionArea：完全包含与部分相交', () => {
  const area = { x: 0, y: 0, width: 100, height: 100 }
  assert.equal(contains({ x: 0, y: 0, width: 100, height: 100 }, area), true)
  assert.equal(contains({ x: 90, y: 0, width: 20, height: 20 }, area), false)
  assert.equal(intersectionArea({ x: 0, y: 0, width: 10, height: 10 }, { x: 5, y: 5, width: 10, height: 10 }), 25)
  assert.equal(intersectionArea({ x: 0, y: 0, width: 10, height: 10 }, { x: 50, y: 50, width: 10, height: 10 }), 0)
})

test('displayForRect：按重叠面积选，完全在外时选最近的', () => {
  assert.equal(displayForRect(displays, { x: 2000, y: 100, width: 200, height: 200 }).id, '2')
  assert.equal(displayForRect(displays, { x: 5000, y: 5000, width: 10, height: 10 }).id, '2')
  assert.equal(displayForRect(displays, { x: 100, y: 100, width: 10, height: 10 }).id, '1')
  assert.equal(displayForRect([], { x: 0, y: 0, width: 1, height: 1 }), null)
})

test('displayAt：命中点所在屏幕，屏外回退最近屏', () => {
  assert.equal(displayAt(displays, { x: 2000, y: 500 }).id, '2')
  assert.equal(displayAt(displays, { x: -500, y: -500 }).id, '1')
})

test('clampPet：贴边时夹回工作区，屏幕比宠物小时左上优先', () => {
  assert.deepEqual(clampPet({ x: 1900, y: 1000, width: SIZE, height: SIZE }, displays[0].workArea), {
    x: 1920 - SIZE, y: 1040 - SIZE, width: SIZE, height: SIZE,
  })
  assert.deepEqual(clampPet({ x: 50, y: 50, width: SIZE, height: SIZE }, { x: 0, y: 0, width: 100, height: 100 }), {
    x: 0, y: 0, width: SIZE, height: SIZE,
  })
})

test('snapPet：阈值内吸附左边与上边，并标记吸附方向', () => {
  const res = snapPet({ x: 5, y: 3, width: SIZE, height: SIZE }, displays[0].workArea, 10)
  assert.equal(res.x, 0)
  assert.equal(res.y, 0)
  assert.deepEqual(res.snapped, { left: true, right: false, top: true, bottom: false })
})

test('snapPet：阈值外不动，右边与下边也能吸', () => {
  const area = displays[0].workArea
  const far = snapPet({ x: 300, y: 300, width: SIZE, height: SIZE }, area, 10)
  assert.equal(far.x, 300)
  assert.deepEqual(far.snapped, { left: false, right: false, top: false, bottom: false })

  const right = snapPet({ x: area.width - SIZE - 4, y: area.height - SIZE - 6, width: SIZE, height: SIZE }, area, 10)
  assert.equal(right.x, area.width - SIZE)
  assert.equal(right.y, area.height - SIZE)
  assert.deepEqual(right.snapped, { left: false, right: true, top: false, bottom: true })
})

test('defaultPet：默认落在右下角，留 margin', () => {
  assert.deepEqual(defaultPet({ x: 0, y: 0, width: 1920, height: 1040 }, SIZE, 28), {
    x: 1920 - SIZE - 28, y: 1040 - SIZE - 28, width: SIZE, height: SIZE,
  })
})

test('resolveSaved：没有存档时给主屏默认位，moved=false', () => {
  const res = resolveSaved(null, displays, SIZE, PAD, 28)
  assert.equal(res.displayId, '1')
  assert.equal(res.moved, false)
  assert.equal(res.x + PAD, 1920 - SIZE - 28)
})

test('resolveSaved：存档在屏幕外时夹回来并标记 moved', () => {
  const res = resolveSaved({ x: 5000, y: -500, displayId: '1' }, displays, SIZE, PAD, 28)
  assert.equal(res.displayId, '1')
  assert.equal(res.moved, true)
  assert.ok(res.x >= 0 && res.x <= 1920 - SIZE)
  assert.ok(res.y >= 0 && res.y <= 1040 - SIZE)
})

test('resolveSaved：存档的显示器被拔掉时落到最近的屏幕', () => {
  const res = resolveSaved({ x: 2500, y: 100, displayId: '9' }, displays, SIZE, PAD, 28)
  assert.equal(res.displayId, '2')
  assert.equal(res.moved, false)
})

test('resolveSaved：合法存档原样返回', () => {
  const res = resolveSaved({ x: 100, y: 100, displayId: '1' }, displays, SIZE, PAD, 28)
  assert.deepEqual({ x: res.x, y: res.y }, { x: 100, y: 100 })
  assert.equal(res.moved, false)
})

test('ensureVisible：已被移出屏幕的窗口会被拉回最近那块屏', () => {
  const res = ensureVisible({ x: 4000, y: 2000 }, displays, SIZE, PAD, 28)
  assert.equal(res.displayId, '2')
  assert.deepEqual({ x: res.x, y: res.y }, { x: 3200 - SIZE - PAD, y: 984 - SIZE })
})

test('resolveSaved：没有任何显示器时不会崩，退回 margin 位置', () => {
  const res = resolveSaved({ x: 10, y: 10 }, [], SIZE, PAD, 28)
  assert.deepEqual(res, { x: 28, y: 28, displayId: null, moved: true })
})