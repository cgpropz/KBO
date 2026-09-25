"""Phase 3 shadow mode: score frozen memory slates with the Phase 2 candidate
params, grade them against the same actuals as recap.json, and keep a running
scoreboard. Offline only: nothing here is read by the live pipeline or the UI,
and the only files it writes are memory/**/shadow*.json.
"""
