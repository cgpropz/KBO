import Highcharts from 'highcharts'
import HighchartsReactModule from 'highcharts-react-official'
import { formatDate } from '../utils/formatters'

const HighchartsReact = HighchartsReactModule.default || HighchartsReactModule

const PROP_GAME_VALUE = {
  Points: game => game.pts ?? 0,
  Rebounds: game => game.reb ?? 0,
  Assists: game => game.ast ?? 0,
  'FG Made': game => game.fgm ?? 0,
  'FG Attempted': game => game.fga ?? 0,
  'Two Pointers Made': game => game.fg2m ?? Math.max((game.fgm ?? 0) - (game.fg3m ?? 0), 0),
  'Two Pointers Attempted': game => game.fg2a ?? Math.max((game.fga ?? 0) - (game.fg3a ?? 0), 0),
  '3-PT Made': game => game.fg3m ?? 0,
  '3-PT Attempted': game => game.fg3a ?? 0,
  'Free Throws Made': game => game.ftm ?? 0,
  'Free Throws Attempted': game => game.fta ?? 0,
  'Blocked Shots': game => game.blk ?? 0,
  'Blks+Stls': game => (game.blk ?? 0) + (game.stl ?? 0),
  'Reb+Asts': game => (game.reb ?? 0) + (game.ast ?? 0),
  'Rebs+Asts': game => (game.reb ?? 0) + (game.ast ?? 0),
  'Pts+Rebs': game => (game.pts ?? 0) + (game.reb ?? 0),
  'Pts+Asts': game => (game.pts ?? 0) + (game.ast ?? 0),
  'Pts+Rebs+Asts': game => (game.pts ?? 0) + (game.reb ?? 0) + (game.ast ?? 0),
}

function getGameValue(game, stat) {
  const getter = PROP_GAME_VALUE[stat]
  return getter ? getter(game) : null
}

function formatShortGameDate(dateStr) {
  if (!dateStr) return ''
  const date = new Date(dateStr)
  if (Number.isNaN(date.getTime())) return dateStr
  return `${date.getMonth() + 1}/${date.getDate()}`
}

export default function L10HitRateChart({ games = [], stat, line }) {
  const numericLine = Number(line)
  const chartGames = [...games]
    .slice(0, 10)
    .reverse()
    .map(game => {
      const value = getGameValue(game, stat)
      let result = 'miss'
      if (value != null && Number.isFinite(numericLine)) {
        if (value > numericLine) result = 'hit'
        else if (value === numericLine) result = 'push'
      }
      const hit = result === 'hit'
      return {
        xLabel: formatShortGameDate(game.date),
        dateLabel: formatDate(game.date),
        matchup: game.matchup || 'Unknown matchup',
        y: value,
        color: result === 'hit' ? '#7efc6a' : result === 'push' ? '#9ca3af' : '#ef4444',
        result,
        hit,
      }
    })
    .filter(point => point.y != null)

  if (!chartGames.length || !Number.isFinite(numericLine)) {
    return (
      <div className="edge-hit-chart-empty">
        No standard line available
      </div>
    )
  }

  const hitCount = chartGames.reduce((sum, point) => sum + (point.hit ? 1 : 0), 0)
  const hitRate = Math.round((hitCount / chartGames.length) * 100)

  const options = {
    chart: {
      type: 'column',
      backgroundColor: 'transparent',
      height: 156,
      spacing: [4, 2, 24, 0],
      animation: false,
    },
    title: { text: null },
    credits: { enabled: false },
    legend: { enabled: false },
    exporting: { enabled: false },
    accessibility: { enabled: false },
    xAxis: {
      categories: chartGames.map(point => point.xLabel),
      lineColor: '#173130',
      tickLength: 0,
      tickmarkPlacement: 'on',
      labels: {
        autoRotation: false,
        rotation: -45,
        staggerLines: 1,
        reserveSpace: true,
        align: 'right',
        x: 2,
        y: 16,
        style: { color: '#67827c', fontSize: '7px', fontWeight: '700', textOutline: 'none' },
      },
    },
    yAxis: {
      title: { text: null },
      gridLineColor: 'rgba(103, 130, 124, 0.16)',
      labels: {
        style: { color: '#67827c', fontSize: '9px' },
      },
      plotLines: [{
        value: numericLine,
        color: '#38bdf8',
        width: 1,
        dashStyle: 'ShortDash',
        zIndex: 4,
        label: {
          text: `Line ${numericLine}`,
          align: 'right',
          x: -2,
          y: 10,
          style: {
            color: '#8fdcff',
            fontSize: '9px',
            fontWeight: '700',
          },
        },
      }],
    },
    tooltip: {
      backgroundColor: '#091116',
      borderColor: '#1f3f3d',
      borderRadius: 10,
      shadow: false,
      style: { color: '#e6f3ce', fontSize: '11px' },
      useHTML: true,
      formatter() {
        const point = this.point
        return `
          <div style="padding:4px 6px;min-width:110px">
            <div style="color:#8fdcff;font-size:10px;font-weight:700;margin-bottom:4px">${point.dateLabel}</div>
            <div style="color:#d7fbe0;font-weight:700;margin-bottom:3px">${point.matchup}</div>
            <div style="color:#e6f3ce">Actual: <strong>${point.y.toFixed(1)}</strong></div>
            <div style="color:#8fdcff">Line: <strong>${numericLine}</strong></div>
            <div style="color:${point.result === 'hit' ? '#7efc6a' : point.result === 'push' ? '#9ca3af' : '#fda4af'};font-weight:700;margin-top:4px">${point.result === 'hit' ? 'Hit' : point.result === 'push' ? 'Push' : 'Miss'}</div>
          </div>
        `
      },
    },
    plotOptions: {
      series: {
        animation: false,
        borderWidth: 0,
        pointPadding: 0.08,
        groupPadding: 0.08,
        states: {
          inactive: { opacity: 1 },
        },
      },
      column: {
        borderRadius: 3,
      },
    },
    series: [{
      data: chartGames,
      maxPointWidth: 18,
    }],
  }

  return (
    <div className="edge-hit-chart-wrap">
      <div className="edge-hit-chart-header">
        <div>
          <p className="edge-hit-chart-kicker">L10 Hit Rate</p>
          <p className="edge-hit-chart-rate">{hitCount}/{chartGames.length} <span>{hitRate}%</span></p>
        </div>
        <p className="edge-hit-chart-subtext">Vs standard PP line</p>
      </div>
      <HighchartsReact highcharts={Highcharts} options={options} />
    </div>
  )
}
