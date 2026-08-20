import { describe, expect, it } from 'vitest'
import { createHash } from 'node:crypto'
import { inflateSync } from 'node:zlib'
import { encodePng, pngDataUrl } from './png'
import { renderSpecimen } from './render'
import type { RenderParams } from '../types'

/**
 * The encoder is hand written, so the tests decode what it produced rather than
 * trusting it. Everything here reads the bytes back: chunk layout, an independent
 * CRC, the inflated scanlines, and the pixels those scanlines carry.
 */

const params = (over: Partial<RenderParams> = {}): RenderParams => ({
  field: { type: 'bloom', scale: 1, warpAmp: 0.2, warpFreq: 3, octaves: 4 },
  primitives: { count: 9, arrangement: 'radial', sizeBias: 0.5 },
  dither: { matrix: 4, levels: 3, contrast: 1.2, bias: 0 },
  palette: { ink: '#e8e6e1', ground: '#0b0b0c' },
  frame: { fill: 0.6, bleed: false },
  seed: 1234567,
  ...over,
})

type Chunk = { type: string; data: Buffer; crc: number; crcOk: boolean }

/** Bit by bit, deliberately not the table the encoder uses. Two implementations, one answer. */
function crc32Bitwise(bytes: Buffer): number {
  let c = 0xffffffff
  for (const b of bytes) {
    c ^= b
    for (let k = 0; k < 8; k++) c = c & 1 ? (c >>> 1) ^ 0xedb88320 : c >>> 1
  }
  return (c ^ 0xffffffff) >>> 0
}

function readChunks(png: Buffer): Chunk[] {
  const out: Chunk[] = []
  let p = 8
  while (p + 12 <= png.length) {
    const len = png.readUInt32BE(p)
    const type = png.toString('ascii', p + 4, p + 8)
    const data = png.subarray(p + 8, p + 8 + len)
    const crc = png.readUInt32BE(p + 8 + len)
    out.push({ type, data, crc, crcOk: crc === crc32Bitwise(png.subarray(p + 4, p + 8 + len)) })
    p += 12 + len
  }
  return out
}

function decode(bytes: Uint8Array) {
  const png = Buffer.from(bytes)
  const chunks = readChunks(png)
  const ihdr = chunks.find(c => c.type === 'IHDR')
  const plte = chunks.find(c => c.type === 'PLTE')
  if (!ihdr || !plte) throw new Error('the file is missing IHDR or PLTE')

  const width = ihdr.data.readUInt32BE(0)
  const height = ihdr.data.readUInt32BE(4)
  const palette: number[][] = []
  for (let i = 0; i + 2 < plte.data.length; i += 3) {
    palette.push([plte.data[i], plte.data[i + 1], plte.data[i + 2]])
  }

  const raw = inflateSync(Buffer.concat(chunks.filter(c => c.type === 'IDAT').map(c => c.data)))
  const stride = Math.ceil(width / 8)
  const pixels = new Uint8Array(width * height)
  for (let y = 0; y < height; y++) {
    const row = y * (stride + 1)
    if (raw[row] !== 0) throw new Error(`row ${y} declares filter ${raw[row]}, expected 0`)
    for (let x = 0; x < width; x++) {
      pixels[y * width + x] = (raw[row + 1 + (x >> 3)] >> (7 - (x & 7))) & 1
    }
  }

  return {
    width,
    height,
    bitDepth: ihdr.data[8],
    colourType: ihdr.data[9],
    interlace: ihdr.data[12],
    palette,
    pixels,
    raw,
    chunks,
  }
}

const sha256 = (bytes: Uint8Array) => createHash('sha256').update(Buffer.from(bytes)).digest('hex')

describe('encodePng', () => {
  it('starts with the PNG signature', () => {
    const png = encodePng(new Uint8Array(4), 2, { ink: '#ffffff', ground: '#000000' })
    expect([...png.subarray(0, 8)]).toEqual([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
  })

  it('lays the chunks out as IHDR, PLTE, IDAT, IEND', () => {
    const png = encodePng(new Uint8Array(9), 3, { ink: '#ffffff', ground: '#000000' })
    expect(decode(png).chunks.map(c => c.type)).toEqual(['IHDR', 'PLTE', 'IDAT', 'IEND'])
  })

  it('declares a 1 bit indexed image at the given size', () => {
    const d = decode(encodePng(new Uint8Array(64), 8, { ink: '#ffffff', ground: '#000000' }))
    expect([d.width, d.height, d.bitDepth, d.colourType, d.interlace]).toEqual([8, 8, 1, 3, 0])
  })

  it('writes ground at index 0 and ink at index 1, so a pixel byte is its own palette index', () => {
    const d = decode(encodePng(new Uint8Array(4), 2, { ink: '#e8e6e1', ground: '#0b0b0c' }))
    expect(d.palette).toEqual([
      [0x0b, 0x0b, 0x0c],
      [0xe8, 0xe6, 0xe1],
    ])
  })

  it('reads three digit hex shorthand', () => {
    const d = decode(encodePng(new Uint8Array(4), 2, { ink: '#FFF', ground: '#048' }))
    expect(d.palette).toEqual([
      [0x00, 0x44, 0x88],
      [0xff, 0xff, 0xff],
    ])
  })

  it('round trips the exact pixel buffer', () => {
    const pixels = renderSpecimen(params(), 64)
    const d = decode(encodePng(pixels, 64, params().palette))
    expect(d.pixels).toEqual(pixels)
  })

  it('round trips a width that is not a multiple of eight', () => {
    for (const size of [5, 13]) {
      const pixels = new Uint8Array(size * size)
      for (let i = 0; i < pixels.length; i++) pixels[i] = (i * 7) % 3 === 0 ? 1 : 0
      const d = decode(encodePng(pixels, size, { ink: '#ffffff', ground: '#000000' }))
      expect(d.pixels, `size ${size}`).toEqual(pixels)
      expect(d.raw.length, `size ${size} scanlines`).toBe(size * (Math.ceil(size / 8) + 1))
    }
  })

  it('pads the tail of a short scanline with zero bits', () => {
    const pixels = new Uint8Array(9).fill(1)
    const raw = decode(encodePng(pixels, 3, { ink: '#ffffff', ground: '#000000' })).raw
    // Three ink pixels, then five bits of padding: 1110 0000.
    expect(raw[1]).toBe(0b11100000)
  })

  it('gives every chunk a CRC that an independent implementation agrees with', () => {
    const png = encodePng(renderSpecimen(params(), 32), 32, params().palette)
    const chunks = decode(png).chunks
    expect(chunks.length).toBeGreaterThan(0)
    expect(chunks.map(c => `${c.type}:${c.crcOk}`)).toEqual(chunks.map(c => `${c.type}:true`))
  })

  it('corrupting one byte breaks the CRC the tests check', () => {
    const png = encodePng(new Uint8Array(4), 2, { ink: '#ffffff', ground: '#000000' })
    // Inside PLTE, so the file still decodes and the CRC is the only thing that objects.
    const at = Buffer.from(png).indexOf('PLTE') + 4
    png[at] = png[at] ^ 0xff
    expect(decode(png).chunks.some(c => !c.crcOk)).toBe(true)
  })

  it('gives two different specimens two different files', () => {
    const a = encodePng(renderSpecimen(params(), 64), 64, params().palette)
    const b = encodePng(renderSpecimen(params({ seed: 987654321 }), 64), 64, params().palette)
    expect(Buffer.from(a).equals(Buffer.from(b))).toBe(false)
  })

  it('gives the same input byte identical output', () => {
    const pixels = renderSpecimen(params(), 64)
    const a = encodePng(pixels, 64, params().palette)
    const b = encodePng(pixels, 64, params().palette)
    expect(Buffer.from(a).equals(Buffer.from(b))).toBe(true)
  })

  it('strikes the golden specimen', () => {
    const png = encodePng(renderSpecimen(params(), 64), 64, params().palette)
    const d = decode(png)
    // The scanline hash is the real golden: it covers the pixels and the packing, and
    // nothing about which deflate implementation ran.
    expect(sha256(d.raw)).toBe('b76774d3c1611ff1cf0ffe4ecd8be546fd44695cc87d2d8302570536bf63f65c')
    // The file hash also covers the compressed bytes. If a zlib upgrade moves it and
    // every other test here still passes, this is the line to re-take.
    expect(sha256(png)).toBe('f7cd84d5cb786ebb1545fde5701feeb1fd6b2ff7179252daf61bf28db41634b2')
  })

  it('refuses a palette colour it cannot read, naming the path', () => {
    expect(() => encodePng(new Uint8Array(4), 2, { ink: 'burnt orange', ground: '#000000' })).toThrow(
      /palette\.ink/,
    )
    expect(() => encodePng(new Uint8Array(4), 2, { ink: '#ffffff', ground: '#12345' })).toThrow(
      /palette\.ground/,
    )
  })

  it('refuses a buffer that is not size by size', () => {
    expect(() => encodePng(new Uint8Array(15), 4, { ink: '#ffffff', ground: '#000000' })).toThrow(
      /got 15 pixels/,
    )
    expect(() => encodePng(new Uint8Array(15), 4, { ink: '#ffffff', ground: '#000000' })).toThrow(
      /needs 16/,
    )
  })

  it('refuses a size that is not a positive whole number', () => {
    expect(() => encodePng(new Uint8Array(0), 0, { ink: '#ffffff', ground: '#000000' })).toThrow(/size/i)
    expect(() => encodePng(new Uint8Array(6), 2.5, { ink: '#ffffff', ground: '#000000' })).toThrow(
      /size/i,
    )
  })

  it('refuses a pixel byte that is neither ground nor ink', () => {
    const pixels = new Uint8Array(4)
    pixels[2] = 2
    expect(() => encodePng(pixels, 2, { ink: '#ffffff', ground: '#000000' })).toThrow(/index 2/)
  })
})

describe('pngDataUrl', () => {
  it('wraps the bytes as a base64 image data url', () => {
    const png = encodePng(new Uint8Array(4), 2, { ink: '#ffffff', ground: '#000000' })
    const url = pngDataUrl(png)
    expect(url.startsWith('data:image/png;base64,')).toBe(true)
    const back = Buffer.from(url.slice('data:image/png;base64,'.length), 'base64')
    expect(back.equals(Buffer.from(png))).toBe(true)
  })
})
