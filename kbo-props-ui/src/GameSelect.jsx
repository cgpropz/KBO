import { ALL_GAMES_LABEL } from './gameFilter.js'

export default function GameSelect({ games, value, onChange }) {
  return (
    <label className="game-filter">
      <span className="game-filter-label">Game</span>
      <select
        aria-label="Game"
        data-testid="game-filter"
        value={value || ''}
        onChange={(event) => onChange(event.target.value)}
      >
        <option value="">{ALL_GAMES_LABEL}</option>
        {(games || []).map((game) => (
          <option key={game.id} value={game.id}>{game.label}</option>
        ))}
      </select>
    </label>
  )
}
