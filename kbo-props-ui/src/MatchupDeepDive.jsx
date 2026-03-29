import { useState, useEffect } from 'react';
import './MatchupDeepDive.css';

const TEAMS = {
  Doosan:  { color: '#9595d3', full: 'Doosan Bears' },
  Hanwha:  { color: '#ff8c00', full: 'Hanwha Eagles' },
  Kia:     { color: '#ff4444', full: 'Kia Tigers' },
  Kiwoom:  { color: '#d4a76a', full: 'Kiwoom Heroes' },
  KT:      { color: '#e0e0e0', full: 'KT Wiz' },
  LG:      { color: '#e8557a', full: 'LG Twins' },
  Lotte:   { color: '#ff6666', full: 'Lotte Giants' },
  NC:      { color: '#5b9bd5', full: 'NC Dinos' },
  Samsung: { color: '#60a5fa', full: 'Samsung Lions' },
  SSG:     { color: '#ff5555', full: 'SSG Landers' },
};

function MatchupDeepDive() {
  const [data, setData] = useState(null);
  const [selectedIdx, setSelectedIdx] = useState(0);
  const [expandedSection, setExpandedSection] = useState({
    pitchers: true, batting: true, park: true, props: true,
  });

  useEffect(() => {
    fetch('/data/matchup_data.json')
      .then(r => r.ok ? r.json() : null)
      .then(d => setData(d))
      .catch(() => null);
  }, []);

  if (!data || !data.matchups || data.matchups.length === 0) {
    return (
      <div className="mdd">
        <div className="mdd-empty">
          <div className="mdd-empty-icon">⚔️</div>
          <h2>No Matchups Available</h2>
          <p>Run the pipeline to generate today's matchup data.</p>
        </div>
      </div>
    );
  }

  const matchups = data.matchups;
  const game = matchups[selectedIdx];

  const toggle = (section) => {
    setExpandedSection(prev => ({ ...prev, [section]: !prev[section] }));
  };

  const awayColor = TEAMS[game.away]?.color || '#888';
  const homeColor = TEAMS[game.home]?.color || '#888';

  return (
    <div className="mdd">
      <header className="mdd-header">
        <h1 className="mdd-title">⚔️ Matchup Deep Dive</h1>
        <p className="mdd-subtitle">{matchups.length} games today</p>
      </header>

      {/* Game Selector */}
      <div className="mdd-game-selector">
        {matchups.map((m, i) => (
          <button
            key={i}
            className={`mdd-game-tab ${i === selectedIdx ? 'active' : ''}`}
            onClick={() => setSelectedIdx(i)}
          >
            <span style={{ color: TEAMS[m.away]?.color }}>{m.away}</span>
            <span className="mdd-at">@</span>
            <span style={{ color: TEAMS[m.home]?.color }}>{m.home}</span>
          </button>
        ))}
      </div>

      {/* Game Header */}
      <div className="mdd-game-header">
        <div className="mdd-team-side mdd-away">
          <div className="mdd-team-label">AWAY</div>
          <div className="mdd-team-name" style={{ color: awayColor }}>
            {TEAMS[game.away]?.full || game.away}
          </div>
        </div>
        <div className="mdd-vs-block">
          <div className="mdd-vs">VS</div>
          <div className="mdd-stadium">📍 {game.stadium}</div>
        </div>
        <div className="mdd-team-side mdd-home">
          <div className="mdd-team-label">HOME</div>
          <div className="mdd-team-name" style={{ color: homeColor }}>
            {TEAMS[game.home]?.full || game.home}
          </div>
        </div>
      </div>

      {/* Pitching Matchup */}
      <section className="mdd-section">
        <button className="mdd-section-toggle" onClick={() => toggle('pitchers')}>
          <span className="mdd-section-icon">⚡</span>
          <span>Starting Pitchers</span>
          <span className="mdd-chevron">{expandedSection.pitchers ? '▼' : '▶'}</span>
        </button>
        {expandedSection.pitchers && (
          <div className="mdd-pitchers">
            <PitcherCard
              pitcher={game.away_pitcher}
              team={game.away}
              teamColor={awayColor}
              side="away"
            />
            <div className="mdd-pitcher-divider" />
            <PitcherCard
              pitcher={game.home_pitcher}
              team={game.home}
              teamColor={homeColor}
              side="home"
            />
          </div>
        )}
      </section>

      {/* Team Batting Comparison */}
      <section className="mdd-section">
        <button className="mdd-section-toggle" onClick={() => toggle('batting')}>
          <span className="mdd-section-icon">🏏</span>
          <span>Team Batting</span>
          <span className="mdd-chevron">{expandedSection.batting ? '▼' : '▶'}</span>
        </button>
        {expandedSection.batting && (
          <BattingComparison
            away={game.away}
            home={game.home}
            awayBatting={game.away_batting}
            homeBatting={game.home_batting}
            awayRates={game.away_batting_rates}
            homeRates={game.home_batting_rates}
            awayColor={awayColor}
            homeColor={homeColor}
          />
        )}
      </section>

      {/* Park Factor */}
      {game.park_factor && (
        <section className="mdd-section">
          <button className="mdd-section-toggle" onClick={() => toggle('park')}>
            <span className="mdd-section-icon">🏟️</span>
            <span>Park Factor — {game.park_factor.stadium}</span>
            <span className="mdd-chevron">{expandedSection.park ? '▼' : '▶'}</span>
          </button>
          {expandedSection.park && (
            <ParkFactor park={game.park_factor} />
          )}
        </section>
      )}

      {/* Game Props */}
      <section className="mdd-section">
        <button className="mdd-section-toggle" onClick={() => toggle('props')}>
          <span className="mdd-section-icon">🎯</span>
          <span>Game Props ({game.props.length})</span>
          <span className="mdd-chevron">{expandedSection.props ? '▼' : '▶'}</span>
        </button>
        {expandedSection.props && game.props.length > 0 && (
          <div className="mdd-props-list">
            {game.props.map((p, i) => (
              <div key={i} className="mdd-prop-row">
                <div className="mdd-prop-player">
                  <span className="mdd-prop-name">{p.name}</span>
                  <span className="mdd-prop-team" style={{ color: TEAMS[p.team]?.color }}>{p.team}</span>
                </div>
                <div className="mdd-prop-type">{p.prop}</div>
                <div className="mdd-prop-line">
                  <span className="mdd-pp-badge">PP</span> {p.line}
                </div>
                <div className="mdd-prop-proj">Proj: {p.projection?.toFixed(1)}</div>
                <div className={`mdd-prop-edge ${p.edge > 0 ? 'pos' : p.edge < 0 ? 'neg' : ''}`}>
                  {p.edge > 0 ? '+' : ''}{p.edge?.toFixed(2)}
                </div>
                <div className={`mdd-prop-rec rec-${(p.recommendation || '').toLowerCase()}`}>
                  {p.recommendation}
                </div>
              </div>
            ))}
          </div>
        )}
        {expandedSection.props && game.props.length === 0 && (
          <div className="mdd-no-data">No props available for this game</div>
        )}
      </section>
    </div>
  );
}

function PitcherCard({ pitcher, team, teamColor, side }) {
  if (!pitcher || !pitcher.name) {
    return (
      <div className={`mdd-pitcher-card ${side}`}>
        <div className="mdd-pitcher-unknown">TBD</div>
      </div>
    );
  }

  const profile = pitcher.profile;
  const recent = profile?.recent || [];

  return (
    <div className={`mdd-pitcher-card ${side}`}>
      <div className="mdd-pitcher-header">
        <div className="mdd-pitcher-name" style={{ color: teamColor }}>{pitcher.name}</div>
        <div className="mdd-pitcher-team">{TEAMS[team]?.full || team}</div>
      </div>

      {profile && (
        <>
          <div className="mdd-pitcher-stats">
            <StatBox label="ERA" value={profile.era.toFixed(2)} highlight={profile.era < 3.5} />
            <StatBox label="WHIP" value={profile.whip.toFixed(2)} highlight={profile.whip < 1.2} />
            <StatBox label="K/9" value={profile.k_per_9.toFixed(1)} highlight={profile.k_per_9 > 8} />
            <StatBox label="IP/G" value={profile.ip_per_g.toFixed(1)} />
            <StatBox label="Starts" value={profile.starts} />
          </div>

          {pitcher.k_projection && (
            <div className="mdd-pitcher-kline">
              <span className="mdd-pp-badge">PP</span>
              <span className="mdd-k-label">K Line: {pitcher.line}</span>
              <span className="mdd-k-proj">Proj: {pitcher.k_projection.toFixed(1)}</span>
            </div>
          )}

          {recent.length > 0 && (
            <div className="mdd-recent">
              <div className="mdd-recent-title">Last {recent.length} Starts</div>
              <table className="mdd-recent-table">
                <thead>
                  <tr>
                    <th>Date</th>
                    <th>Opp</th>
                    <th>IP</th>
                    <th>ER</th>
                    <th>K</th>
                    <th>ERA</th>
                  </tr>
                </thead>
                <tbody>
                  {recent.map((g, i) => (
                    <tr key={i}>
                      <td>{g.date}</td>
                      <td style={{ color: TEAMS[g.opp]?.color || '#aaa' }}>{g.opp}</td>
                      <td>{g.ip}</td>
                      <td>{g.er}</td>
                      <td className="mdd-k-val">{g.so}</td>
                      <td className={g.era <= 3.0 ? 'mdd-good' : g.era >= 6.0 ? 'mdd-bad' : ''}>{g.era.toFixed(1)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}
    </div>
  );
}

function StatBox({ label, value, highlight }) {
  return (
    <div className={`mdd-stat-box ${highlight ? 'mdd-stat-highlight' : ''}`}>
      <div className="mdd-stat-val">{value}</div>
      <div className="mdd-stat-label">{label}</div>
    </div>
  );
}

function BattingComparison({ away, home, awayBatting, homeBatting, awayRates, homeRates, awayColor, homeColor }) {
  const stats = [
    { key: 'ba', label: 'BA', fmt: v => v || '—' },
    { key: 'obp', label: 'OBP', fmt: v => v || '—' },
    { key: 'slg', label: 'SLG', fmt: v => v || '—' },
    { key: 'ops', label: 'OPS', fmt: v => v || '—' },
    { key: 'r_per_g', label: 'R/G', fmt: v => v?.toFixed(1) || '—' },
    { key: 'hr_per_g', label: 'HR/G', fmt: v => v?.toFixed(2) || '—' },
    { key: 'so_per_g', label: 'SO/G', fmt: v => v?.toFixed(1) || '—' },
    { key: 'h_per_g', label: 'H/G', fmt: v => v?.toFixed(1) || '—' },
  ];

  const getWinner = (aVal, hVal, inverse) => {
    const a = parseFloat(aVal) || 0;
    const h = parseFloat(hVal) || 0;
    if (a === h) return 'tie';
    if (inverse) return a < h ? 'away' : 'home';
    return a > h ? 'away' : 'home';
  };

  return (
    <div className="mdd-batting">
      <div className="mdd-batting-header">
        <span style={{ color: awayColor }}>{away}</span>
        <span className="mdd-batting-vs">STAT</span>
        <span style={{ color: homeColor }}>{home}</span>
      </div>
      {stats.map(s => {
        const aVal = awayBatting?.[s.key];
        const hVal = homeBatting?.[s.key];
        const winner = getWinner(aVal, hVal, s.key === 'so_per_g');
        return (
          <div key={s.key} className="mdd-batting-row">
            <div className={`mdd-bat-val ${winner === 'away' ? 'mdd-winner' : ''}`}>
              {s.fmt(aVal)}
            </div>
            <div className="mdd-bat-label">{s.label}</div>
            <div className={`mdd-bat-val ${winner === 'home' ? 'mdd-winner' : ''}`}>
              {s.fmt(hVal)}
            </div>
          </div>
        );
      })}
      {(awayRates?.hrr_per_g || homeRates?.hrr_per_g) && (
        <>
          <div className="mdd-batting-row mdd-batting-divider">
            <div className={`mdd-bat-val ${(awayRates?.hrr_per_g || 0) > (homeRates?.hrr_per_g || 0) ? 'mdd-winner' : ''}`}>
              {awayRates?.hrr_per_g?.toFixed(1) || '—'}
            </div>
            <div className="mdd-bat-label">HRR/G</div>
            <div className={`mdd-bat-val ${(homeRates?.hrr_per_g || 0) > (awayRates?.hrr_per_g || 0) ? 'mdd-winner' : ''}`}>
              {homeRates?.hrr_per_g?.toFixed(1) || '—'}
            </div>
          </div>
          <div className="mdd-batting-row">
            <div className={`mdd-bat-val ${(awayRates?.tb_per_g || 0) > (homeRates?.tb_per_g || 0) ? 'mdd-winner' : ''}`}>
              {awayRates?.tb_per_g?.toFixed(1) || '—'}
            </div>
            <div className="mdd-bat-label">TB/G</div>
            <div className={`mdd-bat-val ${(homeRates?.tb_per_g || 0) > (awayRates?.tb_per_g || 0) ? 'mdd-winner' : ''}`}>
              {homeRates?.tb_per_g?.toFixed(1) || '—'}
            </div>
          </div>
        </>
      )}
    </div>
  );
}

function ParkFactor({ park }) {
  const rfLabel = park.r_factor >= 1.05 ? 'Hitter-friendly' : park.r_factor <= 0.95 ? 'Pitcher-friendly' : 'Neutral';
  const rfClass = park.r_factor >= 1.05 ? 'park-hot' : park.r_factor <= 0.95 ? 'park-cold' : 'park-neutral';

  return (
    <div className="mdd-park">
      <div className={`mdd-park-badge ${rfClass}`}>{rfLabel}</div>
      <div className="mdd-park-stats">
        <div className="mdd-park-stat">
          <div className="mdd-park-val">{park.r_per_g}</div>
          <div className="mdd-park-label">R/G</div>
        </div>
        <div className="mdd-park-stat">
          <div className="mdd-park-val">{park.r_factor.toFixed(2)}x</div>
          <div className="mdd-park-label">Run Factor</div>
        </div>
        <div className="mdd-park-stat">
          <div className="mdd-park-val">{park.hr_per_g}</div>
          <div className="mdd-park-label">HR/G</div>
        </div>
        <div className="mdd-park-stat">
          <div className="mdd-park-val">{park.hr_factor.toFixed(2)}x</div>
          <div className="mdd-park-label">HR Factor</div>
        </div>
        <div className="mdd-park-stat">
          <div className="mdd-park-val">{park.h_per_g}</div>
          <div className="mdd-park-label">H/G</div>
        </div>
      </div>
    </div>
  );
}

export default MatchupDeepDive;
