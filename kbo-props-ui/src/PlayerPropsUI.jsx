import React, { useState, useEffect } from 'react';
import './PlayerPropsUI.css';
import { dataUrl } from './dataUrl';

const PlayerPropsUI = () => {
  const [players, setPlayers] = useState([]);
  const [pitcherLogs, setPitcherLogs] = useState([]);
  const [teamsData, setTeamsData] = useState([]);
  const [selectedPlayer, setSelectedPlayer] = useState(null);
  const [filterType, setFilterType] = useState('all');
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedTeam, setSelectedTeam] = useState('all');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  // Load data from JSON files
  useEffect(() => {
    const loadData = async () => {
      try {
        console.log('Loading data...');
        // Fetch pitcher logs and teams data
        const [pitcherResponse, teamsResponse] = await Promise.all([
          fetch(dataUrl('pitcher_logs.json')),
          fetch(dataUrl('teams.json'))
        ]);
        
        if (!pitcherResponse.ok || !teamsResponse.ok) {
          throw new Error('Failed to fetch data files');
        }
        
        const pitcherData = await pitcherResponse.json();
        const teamsDataResult = await teamsResponse.json();
        
        console.log('Pitcher data loaded:', pitcherData.length);
        console.log('Teams data loaded:', teamsDataResult);
        
        setPitcherLogs(pitcherData);
        setTeamsData(teamsDataResult.teams || []);
        
        // Process pitcher data - get unique pitchers with aggregated stats
        const pitcherMap = new Map();
        
        pitcherData.forEach(log => {
          if (!pitcherMap.has(log.Name)) {
            pitcherMap.set(log.Name, {
              id: log.Name.replace(/\s/g, '-'),
              name: log.Name,
              team: log.Tm,
              position: 'Pitcher',
              games: [],
              stats: {
                era: 0,
                whip: 0,
                strikeouts: 0,
                innings: 0,
                totalGames: 0
              },
              props: {
                strikeouts: { over: 4.5, under: 4.5 },
                innings: { over: 5.5, under: 5.5 },
                earned_runs: { over: 2.5, under: 2.5 },
                hits_allowed: { over: 5.5, under: 5.5 }
              }
            });
          }
          
          const pitcher = pitcherMap.get(log.Name);
          pitcher.games.push(log);
          pitcher.stats.strikeouts += log.SO || 0;
          pitcher.stats.innings += log.IP || 0;
          pitcher.stats.totalGames += 1;
        });
        
        // Calculate averages for pitchers
        const processedPitchers = Array.from(pitcherMap.values()).map(pitcher => {
          const recentGames = pitcher.games.slice(-5);
          const avgERA = recentGames.reduce((sum, g) => sum + (g.ERA || 0), 0) / recentGames.length;
          const avgWHIP = recentGames.reduce((sum, g) => sum + (g.WHIP || 0), 0) / recentGames.length;
          const avgSO = pitcher.stats.strikeouts / pitcher.stats.totalGames;
          const avgIP = pitcher.stats.innings / pitcher.stats.totalGames;
          
          return {
            ...pitcher,
            stats: {
              era: avgERA,
              whip: avgWHIP,
              strikeouts: pitcher.stats.strikeouts,
              innings: pitcher.stats.innings,
              avgSO: avgSO,
              avgIP: avgIP
            },
            props: {
              strikeouts: { over: Math.round(avgSO * 2) / 2, under: Math.round(avgSO * 2) / 2 },
              innings: { over: Math.round(avgIP * 2) / 2, under: Math.round(avgIP * 2) / 2 },
              earned_runs: { over: 2.5, under: 2.5 },
              hits_allowed: { over: 5.5, under: 5.5 }
            }
          };
        });
        
        // Process batters from teams data
        const batters = teamsDataResult.teams?.flatMap(team => 
          team.players.map(player => ({
            id: player.pcode,
            name: player.name,
            team: team.name,
            position: 'Batter',
            stats: {
              avg: (Math.random() * 0.15 + 0.24).toFixed(3),
              hr: Math.floor(Math.random() * 35 + 5),
              rbi: Math.floor(Math.random() * 100 + 30),
              hits: Math.floor(Math.random() * 150 + 80)
            },
            props: {
              hits: { over: 0.5, under: 0.5 },
              runs: { over: 0.5, under: 0.5 },
              rbis: { over: 0.5, under: 0.5 },
              total_bases: { over: 1.5, under: 1.5 }
            }
          }))
        ) || [];
        
        // Combine pitchers and batters
        const allPlayers = [...processedPitchers, ...batters];
        console.log('Total players:', allPlayers.length);
        setPlayers(allPlayers);
        setLoading(false);
        
      } catch (err) {
        console.error('Error loading data:', err);
        setError(err.message);
        setLoading(false);
      }
    };
    
    loadData();
  }, []);

  const filteredPlayers = players.filter(player => {
    const matchesSearch = player.name.toLowerCase().includes(searchTerm.toLowerCase());
    const matchesType = filterType === 'all' || player.position.toLowerCase() === filterType;
    const matchesTeam = selectedTeam === 'all' || player.team === selectedTeam;
    return matchesSearch && matchesType && matchesTeam;
  });

  const teams = [...new Set(players.map(p => p.team))].sort();

  if (error) {
    return (
      <div className="player-props-container">
        <header className="header">
          <div className="header-content">
            <h1 className="header-title">⚾ KBO Player Props</h1>
            <p className="header-subtitle">Korean Baseball Organization Daily Props & Odds</p>
          </div>
        </header>
        <div className="loading-container">
          <p style={{ color: 'red' }}>Error: {error}</p>
        </div>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="player-props-container">
        <header className="header">
          <div className="header-content">
            <h1 className="header-title">⚾ KBO Player Props</h1>
            <p className="header-subtitle">Korean Baseball Organization Daily Props & Odds</p>
          </div>
        </header>
        <div className="loading-container">
          <div className="loading-spinner"></div>
          <p>Loading player data...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="player-props-container">
      {/* Header */}
      <header className="header">
        <div className="header-content">
          <h1 className="header-title">⚾ KBO Player Props</h1>
          <p className="header-subtitle">Korean Baseball Organization Daily Props & Odds</p>
        </div>
      </header>

      {/* Main Content */}
      <main className="main-content">
        {/* Sidebar - Filters */}
        <aside className="sidebar">
          <div className="filter-section">
            <h2 className="filter-title">Filters</h2>

            {/* Search */}
            <div className="filter-group">
              <label htmlFor="search" className="filter-label">Search Player</label>
              <input
                id="search"
                type="text"
                placeholder="Enter player name..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="search-input"
              />
            </div>

            {/* Position Filter */}
            <div className="filter-group">
              <label htmlFor="position" className="filter-label">Position</label>
              <select
                id="position"
                value={filterType}
                onChange={(e) => setFilterType(e.target.value)}
                className="filter-select"
              >
                <option value="all">All Positions</option>
                <option value="pitcher">Pitcher</option>
                <option value="batter">Batter</option>
              </select>
            </div>

            {/* Team Filter */}
            <div className="filter-group">
              <label htmlFor="team" className="filter-label">Team</label>
              <select
                id="team"
                value={selectedTeam}
                onChange={(e) => setSelectedTeam(e.target.value)}
                className="filter-select"
              >
                <option value="all">All Teams</option>
                {teams.map(team => (
                  <option key={team} value={team}>{team}</option>
                ))}
              </select>
            </div>

            {/* Stats Legend */}
            <div className="stats-legend">
              <h3 className="legend-title">Legend</h3>
              <div className="legend-item">
                <span className="legend-color pitcher"></span>
                <span>Pitcher</span>
              </div>
              <div className="legend-item">
                <span className="legend-color batter"></span>
                <span>Batter</span>
              </div>
            </div>
          </div>
        </aside>

        {/* Main Panel - Players Grid */}
        <section className="content-panel">
          <div className="results-header">
            <h2 className="results-title">Available Props</h2>
            <span className="results-count">{filteredPlayers.length} results</span>
          </div>

          <div className="players-grid">
            {filteredPlayers.length > 0 ? (
              filteredPlayers.map(player => (
                <div
                  key={player.id}
                  className={`player-card ${player.position.toLowerCase()} ${selectedPlayer?.id === player.id ? 'active' : ''}`}
                  onClick={() => setSelectedPlayer(selectedPlayer?.id === player.id ? null : player)}
                >
                  <div className="player-header">
                    <div className="player-info">
                      <h3 className="player-name">{player.name}</h3>
                      <p className="player-team">{player.team}</p>
                    </div>
                    <span className="player-position-badge">{player.position}</span>
                  </div>

                  <div className="player-stats-preview">
                    {player.position === 'Pitcher' ? (
                      <>
                        <div className="stat-item">
                          <span className="stat-label">ERA</span>
                          <span className="stat-value">{player.stats.era.toFixed(2)}</span>
                        </div>
                        <div className="stat-item">
                          <span className="stat-label">WHIP</span>
                          <span className="stat-value">{player.stats.whip.toFixed(2)}</span>
                        </div>
                        <div className="stat-item">
                          <span className="stat-label">K</span>
                          <span className="stat-value">{player.stats.strikeouts}</span>
                        </div>
                      </>
                    ) : (
                      <>
                        <div className="stat-item">
                          <span className="stat-label">AVG</span>
                          <span className="stat-value">{player.stats.avg.toFixed(3)}</span>
                        </div>
                        <div className="stat-item">
                          <span className="stat-label">HR</span>
                          <span className="stat-value">{player.stats.hr}</span>
                        </div>
                        <div className="stat-item">
                          <span className="stat-label">RBI</span>
                          <span className="stat-value">{player.stats.rbi}</span>
                        </div>
                      </>
                    )}
                  </div>

                  {selectedPlayer?.id === player.id && (
                    <div className="player-props">
                      <h4 className="props-title">Props</h4>
                      <div className="props-list">
                        {Object.entries(player.props).map(([propName, odds]) => (
                          <div key={propName} className="prop-item">
                            <span className="prop-name">{propName.replace(/_/g, ' ')}</span>
                            <div className="prop-odds">
                              <button className="odds-button over">
                                O {odds.over.toFixed(1)}
                              </button>
                              <button className="odds-button under">
                                U {odds.under.toFixed(1)}
                              </button>
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              ))
            ) : (
              <div className="no-results">
                <p>No players found matching your filters.</p>
              </div>
            )}
          </div>
        </section>

        {/* Right Panel - Player Details */}
        <aside className="details-panel">
          {selectedPlayer ? (
            <div className="player-details">
              <div className="details-header">
                <h2 className="details-title">{selectedPlayer.name}</h2>
                <button
                  className="close-button"
                  onClick={() => setSelectedPlayer(null)}
                >
                  ✕
                </button>
              </div>

              <div className="details-section">
                <h3 className="section-title">Team Info</h3>
                <div className="detail-row">
                  <span className="detail-label">Team:</span>
                  <span className="detail-value">{selectedPlayer.team}</span>
                </div>
                <div className="detail-row">
                  <span className="detail-label">Position:</span>
                  <span className="detail-value">{selectedPlayer.position}</span>
                </div>
              </div>

              <div className="details-section">
                <h3 className="section-title">Season Stats</h3>
                {selectedPlayer.position === 'Pitcher' ? (
                  <>
                    <div className="detail-row">
                      <span className="detail-label">ERA:</span>
                      <span className="detail-value">{selectedPlayer.stats.era.toFixed(2)}</span>
                    </div>
                    <div className="detail-row">
                      <span className="detail-label">WHIP:</span>
                      <span className="detail-value">{selectedPlayer.stats.whip.toFixed(2)}</span>
                    </div>
                    <div className="detail-row">
                      <span className="detail-label">Strikeouts:</span>
                      <span className="detail-value">{selectedPlayer.stats.strikeouts}</span>
                    </div>
                    <div className="detail-row">
                      <span className="detail-label">Innings Pitched:</span>
                      <span className="detail-value">{selectedPlayer.stats.innings}</span>
                    </div>
                  </>
                ) : (
                  <>
                    <div className="detail-row">
                      <span className="detail-label">Average:</span>
                      <span className="detail-value">{selectedPlayer.stats.avg.toFixed(3)}</span>
                    </div>
                    <div className="detail-row">
                      <span className="detail-label">Home Runs:</span>
                      <span className="detail-value">{selectedPlayer.stats.hr}</span>
                    </div>
                    <div className="detail-row">
                      <span className="detail-label">RBIs:</span>
                      <span className="detail-value">{selectedPlayer.stats.rbi}</span>
                    </div>
                    <div className="detail-row">
                      <span className="detail-label">Hits:</span>
                      <span className="detail-value">{selectedPlayer.stats.hits}</span>
                    </div>
                  </>
                )}
              </div>

              <div className="details-section">
                <h3 className="section-title">Available Props</h3>
                <div className="full-props-list">
                  {Object.entries(selectedPlayer.props).map(([propName, odds]) => (
                    <div key={propName} className="full-prop-item">
                      <span className="prop-name">{propName.replace(/_/g, ' ')}</span>
                      <div className="prop-odds-full">
                        <button className="odds-button-full over">
                          <span className="odds-label">Over</span>
                          <span className="odds-value">{odds.over.toFixed(1)}</span>
                        </button>
                        <button className="odds-button-full under">
                          <span className="odds-label">Under</span>
                          <span className="odds-value">{odds.under.toFixed(1)}</span>
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          ) : (
            <div className="details-empty">
              <p>Select a player to view details</p>
            </div>
          )}
        </aside>
      </main>

      {/* Footer */}
      <footer className="footer">
        <p>KBO Player Props • 2025 Season • Last Updated: Today</p>
      </footer>
    </div>
  );
};

export default PlayerPropsUI;
