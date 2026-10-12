// Sport stylesheets load in their own chunks after the entry CSS. Equal-specificity
// rules in those chunks would beat a shared phone layout. Wrapping every project
// stylesheet except mobile.css in @layer components makes the unlayered entry
// sheet win on phones, no matter which chunk arrives last.

// Font URLs put semicolons inside the quoted family list, so a scan has to
// track quotes instead of stopping at the first semicolon.
function splitImports(css) {
  const imports = []
  let rest = ''
  let i = 0
  while (i < css.length) {
    const start = css.indexOf('@import', i)
    if (start === -1) {
      rest += css.slice(i)
      break
    }
    rest += css.slice(i, start)
    let j = start + '@import'.length
    let quote = ''
    while (j < css.length) {
      const ch = css[j]
      if (quote) {
        if (ch === '\\') {
          j += 2
          continue
        }
        if (ch === quote) quote = ''
        j += 1
        continue
      }
      if (ch === '"' || ch === "'") {
        quote = ch
        j += 1
        continue
      }
      if (ch === ';') {
        j += 1
        break
      }
      j += 1
    }
    imports.push(css.slice(start, j).trim())
    i = j
  }
  return { imports, rest }
}

export function wrapCssInComponentsLayer(code, id) {
  if (typeof code !== 'string' || typeof id !== 'string') return null
  const clean = id.split('?')[0].replace(/\\/g, '/')
  if (!clean.endsWith('.css')) return null
  if (clean.includes('/node_modules/') || clean.includes('\0')) return null
  if (clean.endsWith('/mobile.css')) return null

  const { imports, rest } = splitImports(code)
  const body = rest.trim()
  if (!body) return imports.length ? `${imports.join('\n')}\n` : null
  if (body.startsWith('@layer components')) {
    return `${imports.join('\n')}${imports.length ? '\n' : ''}${rest}`
  }
  return `${imports.join('\n')}${imports.length ? '\n' : ''}@layer components {\n${rest}\n}\n`
}

export function cssLayerPlugin() {
  return {
    name: 'css-layer-components',
    enforce: 'pre',
    transform(code, id) {
      const next = wrapCssInComponentsLayer(code, id)
      if (next == null) return null
      return { code: next, map: null }
    },
  }
}
