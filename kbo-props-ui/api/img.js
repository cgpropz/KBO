import sharp from 'sharp'
import { fetchableImageUrl, parseImageQuery } from '../src/fitImage.js'

const MAX_BYTES = 2_000_000

function one(value) {
  return Array.isArray(value) ? '' : String(value || '')
}

async function readUpstream(url) {
  const response = await fetch(fetchableImageUrl(url), {
    redirect: 'manual',
    signal: AbortSignal.timeout(8000),
    headers: { Accept: 'image/png,image/jpeg,image/webp' },
  })
  if (response.status !== 200) return null
  const bytes = Buffer.from(await response.arrayBuffer())
  if (bytes.length === 0 || bytes.length > MAX_BYTES) return null
  return bytes
}

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET')
    res.statusCode = 405
    res.end('Method not allowed')
    return
  }

  const target = parseImageQuery(one(req.query?.src), one(req.query?.w))
  if (!target) {
    res.statusCode = 400
    res.end('Bad image request')
    return
  }

  try {
    const original = await readUpstream(target.src)
    if (!original) {
      res.statusCode = 502
      res.end('Image unavailable')
      return
    }
    const logo = /\/teamlogos\//i.test(target.src)
    const webp = await sharp(original, { animated: false, limitInputPixels: 8_000_000 })
      .resize(target.width, target.width, {
        fit: logo ? 'inside' : 'cover',
        position: logo ? 'centre' : 'north',
        background: { r: 0, g: 0, b: 0, alpha: 0 },
      })
      .webp({ quality: 68 })
      .toBuffer()
    res.statusCode = 200
    res.setHeader('Content-Type', 'image/webp')
    res.setHeader('Cache-Control', 'public, max-age=86400, stale-while-revalidate=604800')
    res.end(webp)
  } catch (err) {
    console.error('[api/img] resize failed:', err?.message || err)
    res.statusCode = 502
    res.end('Image unavailable')
  }
}
