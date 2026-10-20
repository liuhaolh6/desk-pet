'use strict'

/**
 * Minimal PNG encoder/decoder for 8-bit RGB/RGBA images.
 *
 * The cutout pipeline needs an exact, dependency-free way to hand straight
 * (non-premultiplied) RGBA pixels to disk. Electron's `nativeImage` stores
 * premultiplied alpha internally, and `createFromBitmap()` interprets its
 * input as premultiplied too; round-tripping partial alpha through it loses
 * colour precision and, worse, any `resize()` of such an image fuzzes fully
 * transparent pixels into semi-transparent ones. Encoding the final canvas
 * ourselves keeps alpha semantics under our control and makes the output
 * testable from plain Node.
 */

const zlib = require('zlib')

const SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])

const CRC_TABLE = (() => {
  const table = new Uint32Array(256)
  for (let n = 0; n < 256; n++) {
    let c = n
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    table[n] = c >>> 0
  }
  return table
})()

function crc32(buf) {
  let c = 0xffffffff
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}

function chunk(type, data) {
  const head = Buffer.alloc(8)
  head.writeUInt32BE(data.length, 0)
  head.write(type, 4, 4, 'ascii')
  const crc = Buffer.alloc(4)
  crc.writeUInt32BE(crc32(Buffer.concat([head.subarray(4), data])), 0)
  return Buffer.concat([head, data, crc])
}

/** Encode straight RGBA bytes (width*height*4) as an 8-bit RGBA PNG. */
function encodePNG(width, height, rgba) {
  const w = Number(width) | 0
  const h = Number(height) | 0
  if (w <= 0 || h <= 0) throw new Error('invalid PNG size')
  if (!Buffer.isBuffer(rgba) && !(rgba instanceof Uint8Array)) throw new Error('rgba must be a Buffer')
  if (rgba.length < w * h * 4) throw new Error('rgba buffer too small')

  const stride = w * 4
  const raw = Buffer.alloc((stride + 1) * h)
  for (let y = 0; y < h; y++) {
    raw[y * (stride + 1)] = 0 // filter: none
    Buffer.from(rgba.buffer, rgba.byteOffset + y * stride, stride).copy(raw, y * (stride + 1) + 1)
  }
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(w, 0)
  ihdr.writeUInt32BE(h, 4)
  ihdr[8] = 8 // bit depth
  ihdr[9] = 6 // colour type: truecolour + alpha
  ihdr[10] = 0
  ihdr[11] = 0
  ihdr[12] = 0
  return Buffer.concat([
    SIGNATURE,
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ])
}

function paeth(a, b, c) {
  const p = a + b - c
  const pa = Math.abs(p - a)
  const pb = Math.abs(p - b)
  const pc = Math.abs(p - c)
  if (pa <= pb && pa <= pc) return a
  if (pb <= pc) return b
  return c
}

/**
 * Decode an 8-bit non-interlaced RGB/RGBA PNG into straight RGBA bytes.
 * Returns { width, height, data }.
 */
function decodePNG(buffer) {
  if (!Buffer.isBuffer(buffer) || buffer.length < 8 || !buffer.subarray(0, 8).equals(SIGNATURE)) {
    throw new Error('not a PNG')
  }
  let pos = 8
  let header = null
  const idat = []
  while (pos + 8 <= buffer.length) {
    const len = buffer.readUInt32BE(pos)
    const type = buffer.toString('ascii', pos + 4, pos + 8)
    const start = pos + 8
    const end = start + len
    if (end > buffer.length) throw new Error('truncated PNG chunk')
    if (type === 'IHDR') {
      header = {
        width: buffer.readUInt32BE(start),
        height: buffer.readUInt32BE(start + 4),
        bitDepth: buffer[start + 8],
        colorType: buffer[start + 9],
        interlace: buffer[start + 12],
      }
    } else if (type === 'IDAT') {
      idat.push(buffer.subarray(start, end))
    } else if (type === 'IEND') {
      break
    }
    pos = end + 4 // skip CRC
  }
  if (!header) throw new Error('PNG missing IHDR')
  if (header.bitDepth !== 8) throw new Error('unsupported PNG bit depth ' + header.bitDepth)
  if (header.interlace !== 0) throw new Error('interlaced PNG not supported')
  if (header.colorType !== 6 && header.colorType !== 2) {
    throw new Error('unsupported PNG colour type ' + header.colorType)
  }
  const bpp = header.colorType === 6 ? 4 : 3
  const stride = header.width * bpp
  const raw = zlib.inflateSync(Buffer.concat(idat))
  if (raw.length < (stride + 1) * header.height) throw new Error('truncated PNG data')

  const pixels = Buffer.alloc(stride * header.height)
  for (let y = 0; y < header.height; y++) {
    const filter = raw[y * (stride + 1)]
    const src = y * (stride + 1) + 1
    const dst = y * stride
    const prev = dst - stride
    for (let i = 0; i < stride; i++) {
      const x = raw[src + i]
      const a = i >= bpp ? pixels[dst + i - bpp] : 0
      const b = y > 0 ? pixels[prev + i] : 0
      const c = i >= bpp && y > 0 ? pixels[prev + i - bpp] : 0
      let value
      switch (filter) {
        case 0: value = x; break
        case 1: value = x + a; break
        case 2: value = x + b; break
        case 3: value = x + ((a + b) >> 1); break
        case 4: value = x + paeth(a, b, c); break
        default: throw new Error('bad PNG filter ' + filter)
      }
      pixels[dst + i] = value & 0xff
    }
  }
  if (bpp === 4) return { width: header.width, height: header.height, data: pixels }
  const rgba = Buffer.alloc(header.width * header.height * 4)
  for (let i = 0, j = 0; i < pixels.length; i += 3, j += 4) {
    rgba[j] = pixels[i]
    rgba[j + 1] = pixels[i + 1]
    rgba[j + 2] = pixels[i + 2]
    rgba[j + 3] = 255
  }
  return { width: header.width, height: header.height, data: rgba }
}

module.exports = { encodePNG, decodePNG, crc32 }