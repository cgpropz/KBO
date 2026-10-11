import { teamColor, teamLogoUrl } from './nflTeams'
import { GAME_CARD_PROBS_ENABLED, cardView, scoreText } from './gameCardModel'

const WIDTH = 1080
const HEIGHT = 1350
const GREEN = '#22c55e'
const GREY = '#a1a1aa'
const WHITE = '#ffffff'
const INK = '#080c0a'

async function loadLogo(team) {
  const url = teamLogoUrl(team)
  if (!url) return null
  try {
    const response = await fetch(url)
    if (!response.ok) return null
    const blob = await response.blob()
    return await createImageBitmap(blob)
  } catch {
    return null
  }
}

function roundedRect(ctx, x, y, w, h, r) {
  const radius = Math.min(r, w / 2, h / 2)
  ctx.beginPath()
  ctx.moveTo(x + radius, y)
  ctx.arcTo(x + w, y, x + w, y + h, radius)
  ctx.arcTo(x + w, y + h, x, y + h, radius)
  ctx.arcTo(x, y + h, x, y, radius)
  ctx.arcTo(x, y, x + w, y, radius)
  ctx.closePath()
}

function drawMark(ctx, team, image, x, y, size) {
  if (image) {
    ctx.drawImage(image, x, y, size, size)
    return
  }
  ctx.fillStyle = teamColor(team)
  ctx.beginPath()
  ctx.arc(x + size / 2, y + size / 2, size / 2, 0, Math.PI * 2)
  ctx.fill()
  ctx.fillStyle = WHITE
  ctx.font = `700 ${Math.round(size * 0.28)}px ui-monospace, monospace`
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.fillText(team || '—', x + size / 2, y + size / 2 + 1)
}

function fillSplitBar(ctx, x, y, w, h, awayPct, leadAway) {
  ctx.save()
  roundedRect(ctx, x, y, w, h, h / 2)
  ctx.clip()
  const awayW = Math.round(w * (awayPct / 100))
  ctx.fillStyle = leadAway ? GREEN : '#3f3f46'
  ctx.fillRect(x, y, Math.max(awayW, 0), h)
  ctx.fillStyle = leadAway ? '#3f3f46' : GREEN
  ctx.fillRect(x + awayW, y, Math.max(w - awayW, 0), h)
  ctx.restore()
}

function drawTile(ctx, x, y, w, h, label, value, tone, book) {
  ctx.fillStyle = tone === 'over' ? 'rgba(34,197,94,0.16)' : tone === 'under' ? 'rgba(248,113,113,0.16)' : 'rgba(255,255,255,0.03)'
  roundedRect(ctx, x, y, w, h, 28)
  ctx.fill()
  ctx.strokeStyle = 'rgba(255,255,255,0.06)'
  ctx.lineWidth = 2
  ctx.stroke()
  ctx.fillStyle = GREY
  ctx.font = '700 28px ui-monospace, monospace'
  ctx.textAlign = 'left'
  ctx.textBaseline = 'top'
  ctx.fillText(label, x + 28, y + 26)
  ctx.fillStyle = book ? GREY : WHITE
  ctx.font = '700 64px ui-monospace, monospace'
  ctx.fillText(value, x + 28, y + 78)
}

export async function renderGameCardPng(game, probsEnabled = GAME_CARD_PROBS_ENABLED) {
  const view = cardView(game, probsEnabled)
  const [awayLogo, homeLogo] = await Promise.all([loadLogo(view.away), loadLogo(view.home)])
  const canvas = document.createElement('canvas')
  canvas.width = WIDTH
  canvas.height = HEIGHT
  const ctx = canvas.getContext('2d')
  ctx.fillStyle = INK
  ctx.fillRect(0, 0, WIDTH, HEIGHT)

  const cardX = 48
  const cardY = 48
  const cardW = WIDTH - 96
  const cardH = HEIGHT - 96
  roundedRect(ctx, cardX, cardY, cardW, cardH, 40)
  ctx.fillStyle = INK
  ctx.fill()
  ctx.strokeStyle = 'rgba(255,255,255,0.08)'
  ctx.lineWidth = 2
  ctx.stroke()

  ctx.font = '700 28px ui-monospace, monospace'
  const pill = view.status
  const pillW = Math.ceil(ctx.measureText(pill).width) + 36
  const pillH = 48
  const pillX = cardX + cardW - 40 - pillW
  const pillY = cardY + 36
  roundedRect(ctx, pillX, pillY, pillW, pillH, 24)
  ctx.fillStyle = GREEN
  ctx.fill()
  ctx.fillStyle = '#052e16'
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.fillText(pill, pillX + pillW / 2, pillY + pillH / 2 + 1)

  const mark = 120
  const rowY = 160
  drawMark(ctx, view.away, awayLogo, cardX + 48, rowY, mark)
  ctx.fillStyle = WHITE
  ctx.textAlign = 'left'
  ctx.textBaseline = 'top'
  ctx.font = '700 42px ui-monospace, monospace'
  ctx.fillText(view.away || '—', cardX + 48 + mark + 18, rowY + 22)
  ctx.fillStyle = GREY
  ctx.font = '700 22px ui-monospace, monospace'
  ctx.fillText('away', cardX + 48 + mark + 18, rowY + 74)

  const homeMarkX = cardX + cardW - 48 - mark
  drawMark(ctx, view.home, homeLogo, homeMarkX, rowY, mark)
  ctx.textAlign = 'right'
  ctx.fillStyle = WHITE
  ctx.font = '700 42px ui-monospace, monospace'
  ctx.fillText(view.home || '—', homeMarkX - 18, rowY + 22)
  ctx.fillStyle = GREY
  ctx.font = '700 22px ui-monospace, monospace'
  ctx.fillText('home', homeMarkX - 18, rowY + 74)

  ctx.textAlign = 'center'
  ctx.fillStyle = GREY
  ctx.font = '700 22px ui-monospace, monospace'
  ctx.fillText('OUR NUMBER', WIDTH / 2, rowY + 18)
  if (view.scores) {
    ctx.fillStyle = WHITE
    ctx.font = '700 54px ui-monospace, monospace'
    ctx.fillText(`${scoreText(view.scores.away)}   ${scoreText(view.scores.home)}`, WIDTH / 2, rowY + 58)
  }

  let cursor = rowY + mark + 36
  if (view.wins) {
    const barX = cardX + 48
    const barW = cardW - 96
    const leadAway = view.wins.awayPct >= view.wins.homePct
    fillSplitBar(ctx, barX, cursor, barW, 14, view.wins.awayPct, leadAway)
    ctx.font = '700 24px ui-monospace, monospace'
    ctx.textBaseline = 'top'
    ctx.textAlign = 'left'
    ctx.fillStyle = GREY
    ctx.fillText(`${view.wins.awayPct}% win`, barX, cursor + 26)
    ctx.textAlign = 'right'
    ctx.fillText(`${view.wins.homePct}% win`, barX + barW, cursor + 26)
    cursor += 80
  }

  const gap = 22
  const tileW = (cardW - 96 - gap) / 2
  const tileH = 250
  const gridX = cardX + 48
  drawTile(ctx, gridX, cursor, tileW, tileH, 'BOOK SPREAD', view.spreadBook, '', true)
  drawTile(ctx, gridX + tileW + gap, cursor, tileW, tileH, 'OUR SPREAD', view.spreadOurs, view.spreadTone, false)
  drawTile(ctx, gridX, cursor + tileH + gap, tileW, tileH, 'BOOK TOTAL', view.totalBook, '', true)
  drawTile(ctx, gridX + tileW + gap, cursor + tileH + gap, tileW, tileH, 'OUR TOTAL', view.totalOurs, view.totalTone, false)

  ctx.fillStyle = GREY
  ctx.font = '500 26px ui-monospace, monospace'
  ctx.textAlign = 'left'
  ctx.textBaseline = 'top'
  ctx.fillText(view.footer, cardX + 48, cursor + tileH * 2 + gap + 36)

  const brandY = cardY + cardH - 132
  ctx.strokeStyle = 'rgba(255,255,255,0.08)'
  ctx.lineWidth = 2
  ctx.beginPath()
  ctx.moveTo(cardX + 48, brandY - 36)
  ctx.lineTo(cardX + cardW - 48, brandY - 36)
  ctx.stroke()
  ctx.fillStyle = WHITE
  ctx.font = '700 32px ui-monospace, monospace'
  ctx.textAlign = 'center'
  ctx.textBaseline = 'top'
  ctx.fillText('@Cgpropz', WIDTH / 2, brandY)
  ctx.fillStyle = GREEN
  ctx.font = '700 28px ui-monospace, monospace'
  ctx.fillText('cgpropz.com', WIDTH / 2, brandY + 46)
  ctx.fillStyle = GREY
  ctx.font = '500 22px ui-monospace, monospace'
  ctx.fillText('21+ · Play responsibly · Entertainment only', WIDTH / 2, brandY + 92)
  return canvas
}

export async function downloadGameCardPng(game, probsEnabled = GAME_CARD_PROBS_ENABLED) {
  const canvas = await renderGameCardPng(game, probsEnabled)
  const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/png'))
  if (!blob) throw new Error('Could not export this card')
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  const away = game?.awayTeam || 'away'
  const home = game?.homeTeam || 'home'
  link.href = url
  link.download = `cgpropz-${away}-at-${home}.png`
  document.body.appendChild(link)
  link.click()
  link.remove()
  URL.revokeObjectURL(url)
  return blob
}
