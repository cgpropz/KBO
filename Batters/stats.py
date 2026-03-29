"""
KBO Batter Statistics Utility Functions
Contains helper functions for calculating batting statistics.
"""


def calculate_batting_stats(game_data: dict) -> dict:
    """
    Calculate derived batting statistics from raw game data.
    
    Args:
        game_data: Dictionary containing at minimum:
            - AB (At Bats)
            - H (Hits)
            - 2B (Doubles)
            - 3B (Triples)
            - HR (Home Runs)
            - R (Runs)
            - RBI (Runs Batted In)
            - Walks
            - HBP (Hit By Pitch)
    
    Returns:
        Dictionary with calculated stats: BA, OBP, SLG, OPS, 1B, TB, HRR
    """
    singles = game_data['H'] - (game_data['2B'] + game_data['3B'] + game_data['HR'])
    tb = singles + (game_data['2B'] * 2) + (game_data['3B'] * 3) + (game_data['HR'] * 4)
    hrr = game_data['H'] + game_data['R'] + game_data['RBI']
    
    ba = game_data['H'] / game_data['AB'] if game_data['AB'] > 0 else 0
    plate_appearances = game_data['AB'] + game_data['Walks'] + game_data['HBP']
    obp = (game_data['H'] + game_data['Walks'] + game_data['HBP']) / plate_appearances if plate_appearances > 0 else 0
    slg = tb / game_data['AB'] if game_data['AB'] > 0 else 0
    ops = obp + slg
    
    return {
        'BA': round(ba, 3),
        'OBP': round(obp, 3),
        'SLG': round(slg, 3),
        'OPS': round(ops, 3),
        '1B': singles,
        'TB': tb,
        'HRR': hrr
    }


def convert_date(date_str: str, year: int = 2025) -> str:
    """
    Convert date from MM.DD format to MM/DD/YEAR format.
    
    Args:
        date_str: Date string in MM.DD format (e.g., "04.15")
        year: Year to append (default 2025)
    
    Returns:
        Date string in MM/DD/YEAR format (e.g., "04/15/2025")
    """
    month, day = date_str.split('.')
    return f"{month}/{day}/{year}"


def calculate_woba(game_data: dict, weights: dict = None) -> float:
    """
    Calculate weighted on-base average (wOBA).
    
    Args:
        game_data: Dictionary with hitting stats
        weights: Custom weights (default uses standard weights)
    
    Returns:
        wOBA value
    """
    if weights is None:
        weights = {
            'BB': 0.69,
            'HBP': 0.72,
            '1B': 0.88,
            '2B': 1.25,
            '3B': 1.58,
            'HR': 2.03
        }
    
    singles = game_data['H'] - (game_data['2B'] + game_data['3B'] + game_data['HR'])
    
    numerator = (
        weights['BB'] * game_data.get('Walks', 0) +
        weights['HBP'] * game_data.get('HBP', 0) +
        weights['1B'] * singles +
        weights['2B'] * game_data['2B'] +
        weights['3B'] * game_data['3B'] +
        weights['HR'] * game_data['HR']
    )
    
    denominator = (
        game_data['AB'] + 
        game_data.get('Walks', 0) + 
        game_data.get('HBP', 0) + 
        game_data.get('SF', 0)
    )
    
    return round(numerator / denominator, 3) if denominator > 0 else 0
