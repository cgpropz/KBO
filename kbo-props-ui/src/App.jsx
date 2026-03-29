import { useState, useEffect } from 'react'
import PlayerPropsUI from './PlayerPropsUI'
import StrikeoutProjections from './StrikeoutProjections'
import BatterProjections from './BatterProjections'
import PitcherRankings from './PitcherRankings'
import PropTracker from './PropTracker'
import SlipOptimizer from './SlipOptimizer'
import MatchupDeepDive from './MatchupDeepDive'
import LandingPage from './LandingPage'

function App() {
  const [showUI, setShowUI] = useState(false);
  const [view, setView] = useState('home');

  useEffect(() => {
    setTimeout(() => setShowUI(true), 100);
  }, []);

  if (!showUI) {
    return (
      <div style={{ 
        display: 'flex', 
        justifyContent: 'center', 
        alignItems: 'center', 
        height: '100vh',
        background: 'linear-gradient(135deg, #003d7a, #00a8e8)',
        color: 'white',
        fontSize: '24px',
        fontFamily: 'Arial, sans-serif'
      }}>
        ⚾ Loading KBO Player Props...
      </div>
    );
  }

  if (view === 'home') {
    return <LandingPage onNavigate={setView} />;
  }

  return (
    <div>
      <nav style={{
        display: 'flex',
        gap: '0',
        background: '#000',
        padding: '0 1.5rem',
        borderBottom: '2px solid #222',
        alignItems: 'center',
      }}>
        <button
          onClick={() => setView('home')}
          style={{
            padding: '0.75rem 1rem',
            background: 'transparent',
            color: '#c084fc',
            border: 'none',
            cursor: 'pointer',
            fontWeight: '700',
            fontSize: '1.1rem',
            transition: 'all 0.2s',
            letterSpacing: '-0.5px',
            marginRight: '0.5rem',
          }}
          title="Home"
        >
          KBO
        </button>
        <div style={{ width: '1px', height: '1.2rem', background: '#333', marginRight: '0.5rem' }} />
        <button
          onClick={() => setView('projections')}
          style={{
            padding: '0.75rem 1.5rem',
            background: view === 'projections' ? '#7c3aed' : 'transparent',
            color: 'white',
            border: 'none',
            cursor: 'pointer',
            fontWeight: view === 'projections' ? '700' : '400',
            fontSize: '0.95rem',
            borderBottom: view === 'projections' ? '3px solid #c084fc' : '3px solid transparent',
            transition: 'all 0.2s',
          }}
        >
          K Projections
        </button>
        <button
          onClick={() => setView('props')}
          style={{
            padding: '0.75rem 1.5rem',
            background: view === 'props' ? '#7c3aed' : 'transparent',
            color: 'white',
            border: 'none',
            cursor: 'pointer',
            fontWeight: view === 'props' ? '700' : '400',
            fontSize: '0.95rem',
            borderBottom: view === 'props' ? '3px solid #c084fc' : '3px solid transparent',
            transition: 'all 0.2s',
          }}
        >
          Player Props
        </button>
        <button
          onClick={() => setView('batters')}
          style={{
            padding: '0.75rem 1.5rem',
            background: view === 'batters' ? '#7c3aed' : 'transparent',
            color: 'white',
            border: 'none',
            cursor: 'pointer',
            fontWeight: view === 'batters' ? '700' : '400',
            fontSize: '0.95rem',
            borderBottom: view === 'batters' ? '3px solid #c084fc' : '3px solid transparent',
            transition: 'all 0.2s',
          }}
        >
          Batters
        </button>
        <button
          onClick={() => setView('rankings')}
          style={{
            padding: '0.75rem 1.5rem',
            background: view === 'rankings' ? '#7c3aed' : 'transparent',
            color: 'white',
            border: 'none',
            cursor: 'pointer',
            fontWeight: view === 'rankings' ? '700' : '400',
            fontSize: '0.95rem',
            borderBottom: view === 'rankings' ? '3px solid #c084fc' : '3px solid transparent',
            transition: 'all 0.2s',
          }}
        >
          Pitcher Rankings
        </button>
        <button
          onClick={() => setView('tracker')}
          style={{
            padding: '0.75rem 1.5rem',
            background: view === 'tracker' ? '#7c3aed' : 'transparent',
            color: 'white',
            border: 'none',
            cursor: 'pointer',
            fontWeight: view === 'tracker' ? '700' : '400',
            fontSize: '0.95rem',
            borderBottom: view === 'tracker' ? '3px solid #c084fc' : '3px solid transparent',
            transition: 'all 0.2s',
          }}
        >
          Tracker
        </button>
        <button
          onClick={() => setView('optimizer')}
          style={{
            padding: '0.75rem 1.5rem',
            background: view === 'optimizer' ? '#7c3aed' : 'transparent',
            color: 'white',
            border: 'none',
            cursor: 'pointer',
            fontWeight: view === 'optimizer' ? '700' : '400',
            fontSize: '0.95rem',
            borderBottom: view === 'optimizer' ? '3px solid #c084fc' : '3px solid transparent',
            transition: 'all 0.2s',
          }}
        >
          Slip Builder
        </button>
        <button
          onClick={() => setView('matchups')}
          style={{
            padding: '0.75rem 1.5rem',
            background: view === 'matchups' ? '#7c3aed' : 'transparent',
            color: 'white',
            border: 'none',
            cursor: 'pointer',
            fontWeight: view === 'matchups' ? '700' : '400',
            fontSize: '0.95rem',
            borderBottom: view === 'matchups' ? '3px solid #c084fc' : '3px solid transparent',
            transition: 'all 0.2s',
          }}
        >
          Matchups
        </button>
      </nav>
      {view === 'projections' && <StrikeoutProjections />}
      {view === 'batters' && <BatterProjections />}
      {view === 'props' && <PlayerPropsUI />}
      {view === 'rankings' && <PitcherRankings />}
      {view === 'tracker' && <PropTracker />}
      {view === 'optimizer' && <SlipOptimizer />}
      {view === 'matchups' && <MatchupDeepDive />}
    </div>
  );
}

export default App
