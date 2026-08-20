/**
 * The specimen PNG encoder.
 *
 * The buffer `quantise` returns is one byte per pixel, 0 for ground and 1 for ink,
 * which is exactly a 1 bit indexed image: the pixel byte is its own palette index.
 * So the file is written as colour type 3 at bit depth 1, with a two entry palette,
 * and a 512 by 512 specimen lands in a few kilobytes.
 *
 * Hand written on purpose. The only import is Node's built in zlib for the IDAT
 * stream, so the certificate depends on nothing that can go missing, and every
 * byte in the file is one this repo can account for.
 */

import { constants, deflateSync } from 'node:zlib'
import { GROUND, INK } from './render'

export type SpecimenPalette = { ink: string; ground: string }

const SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]

const CRC_TABLE = (() => {
  const table = new Uint32Array(256)
  for (let n = 0; n < 256; n++) {
    let c = n
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    table[n] = c >>> 0
  }
  return table
})()

function crc32(bytes: Uint8Array): number {
  let c = 0xffffffff
  for (let i = 0; i < bytes.length; i++) c = CRC_TABLE[(c ^ bytes[i]) & 0xff] ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}

/** Length, type, data, CRC over type and data. The one shape every PNG chunk takes. */
function chunk(type: string, data: Uint8Array): Uint8Array {
  const out = new Uint8Array(12 + data.length)
  const view = new DataView(out.buffer)
  view.setUint32(0, data.length)
  for (let i = 0; i < 4; i++) out[4 + i] = type.charCodeAt(i)
  out.set(data, 8)
  view.setUint32(8 + data.length, crc32(out.subarray(4, 8 + data.length)))
  return out
}

/**
 * A palette colour as three bytes.
 *
 * Throws rather than falling back to a default, because a specimen printed in a
 * colour no operator asked for misreports what was measured, and it does it in the
 * one place a reader would never think to check.
 */
function rgb(path: string, value: string): [number, number, number] {
  const hex = String(value).trim().replace(/^#/, '')
  const full =
    hex.length === 3
      ? hex[0] + hex[0] + hex[1] + hex[1] + hex[2] + hex[2]
      : hex
  if (!/^[0-9a-f]{6}$/i.test(full)) {
    throw new Error(
      `encodePng cannot read ${path} "${value}". Expected a hex colour such as #0b0b0c or #fff.`,
    )
  }
  return [
    parseInt(full.slice(0, 2), 16),
    parseInt(full.slice(2, 4), 16),
    parseInt(full.slice(4, 6), 16),
  ]
}

/**
 * Pack the pixels into PNG scanlines: one filter byte of 0 per row, then the row's
 * bits packed most significant bit first, tail padded with zeros.
 *
 * Filter 0 on every row is deliberate. The image is two colours on a dither grid, so
 * the predictive filters win almost nothing here and cost the reader a decoder.
 */
function scanlines(pixels: Uint8Array, size: number): Uint8Array {
  const stride = Math.ceil(size / 8)
  const raw = new Uint8Array(size * (stride + 1))

  for (let y = 0; y < size; y++) {
    const rowStart = y * (stride + 1)
    const src = y * size
    for (let x = 0; x < size; x++) {
      const value = pixels[src + x]
      if (value !== GROUND && value !== INK) {
        throw new Error(
          `encodePng found ${value} at index ${src + x}. The quantised buffer holds ` +
            `${GROUND} for ground and ${INK} for ink, and nothing else.`,
        )
      }
      if (value === INK) raw[rowStart + 1 + (x >> 3)] |= 0x80 >> (x & 7)
    }
  }

  return raw
}

/**
 * Encode one quantised specimen as a PNG.
 *
 * `pixels` is the `size * size` buffer from `renderSpecimen`, row major, top left
 * origin. Deterministic: the same pixels and palette always produce the same bytes.
 */
export function encodePng(pixels: Uint8Array, size: number, palette: SpecimenPalette): Uint8Array {
  if (!Number.isInteger(size) || size < 1) {
    throw new Error(`encodePng needs a whole size of 1 or more, got ${size}.`)
  }
  if (pixels.length !== size * size) {
    throw new Error(
      `encodePng got ${pixels.length} pixels for a ${size} by ${size} specimen, which needs ${size * size}.`,
    )
  }

  const ground = rgb('palette.ground', palette.ground)
  const ink = rgb('palette.ink', palette.ink)

  const ihdr = new Uint8Array(13)
  const header = new DataView(ihdr.buffer)
  header.setUint32(0, size)
  header.setUint32(4, size)
  ihdr[8] = 1 // bit depth: one bit per pixel
  ihdr[9] = 3 // colour type: indexed
  ihdr[10] = 0 // compression: deflate, the only one PNG defines
  ihdr[11] = 0 // filter method: the adaptive set, of which every row here uses 0
  ihdr[12] = 0 // interlace: none

  // Index 0 is ground and index 1 is ink, so the quantised byte needs no remapping.
  const plte = Uint8Array.from([...ground, ...ink])
  const idat = deflateSync(scanlines(pixels, size), { level: constants.Z_BEST_COMPRESSION })

  const parts = [
    Uint8Array.from(SIGNATURE),
    chunk('IHDR', ihdr),
    chunk('PLTE', plte),
    chunk('IDAT', new Uint8Array(idat.buffer, idat.byteOffset, idat.byteLength)),
    chunk('IEND', new Uint8Array(0)),
  ]

  const total = parts.reduce((sum, p) => sum + p.length, 0)
  const png = new Uint8Array(total)
  let at = 0
  for (const part of parts) {
    png.set(part, at)
    at += part.length
  }
  return png
}

/** The same bytes as a data url, so a page can show and offer the file without a route. */
export function pngDataUrl(png: Uint8Array): string {
  return `data:image/png;base64,${Buffer.from(png).toString('base64')}`
}
