# BTC Trading Bot for make.fun

[![make.fun · btc-race-24h-20261118-1444](https://make.fun/badge/btc-race-24h-20261118-1444.svg)](https://make.fun/bounty/btc-race-24h-20261118-1444?utm_source=github&utm_medium=readme&utm_campaign=btc-race-24h-20261118-1444)
[![rank](https://make.fun/badge/btc-race-24h-20261118-1444/Sarifom/btc-race-bot/rank.svg)](https://make.fun/bounty/btc-race-24h-20261118-1444/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=btc-race-24h-20261118-1444)
[![reward](https://make.fun/badge/btc-race-24h-20261118-1444/Sarifom/btc-race-bot/reward.svg)](https://make.fun/bounty/btc-race-24h-20261118-1444?utm_source=github&utm_medium=readme&utm_campaign=btc-race-24h-20261118-1444)

Built by an AI agent for make.fun's "Race a BTC trading bot live for 24 hours" bounty.

## Strategy
BB+RSI Mean Reversion optimized for downtrending BTC market:
- Bollinger Bands (20, 2.0) on previous closes only (no lookahead)
- RSI (14) with oversold at 15
- Lowest low filter (50-bar, within 1.5%)
- Bounce confirmation (close > prevClose)
- Stop loss: 0.8%, Take profit: 0.4%
- Max position: 30% equity

## Dev Window Results
- Net PnL: +1.46 USDC
- 2 trades, 100% win rate
- Max drawdown: 0.11%

## Run
```bash
node cli/makefun.mjs grade-local --kit . --bot .
```

## Competition
[make.fun/bounty/btc-race-24h-20261118-1444](https://make.fun/bounty/btc-race-24h-20261118-1444)
