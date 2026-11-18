// BB+RSI Mean Reversion Strategy - Step 1: Basic structure from ema-cross
import { BPS, runBars, type Bar, type BarsState, type BuyInput, type SellInput } from './vendor/makefun-bars.ts';

const SYMBOL = 'CBBTC';
const BB_PERIOD = 20;
const BB_MULT = 2.0;
const RSI_PERIOD = 14;
const RSI_OVERSOLD = 15;
const RSI_OVERBOUGHT = 55;
const STOP_LOSS_PCT = 0.008;
const TAKE_PROFIT_PCT = 0.004;
const MAX_POSITION_PCT = 0.3;
const MAX_SLIPPAGE_BPS = 50;

// Lowest low filter
const LL_PERIOD = 50;
const LL_THRESHOLD = 0.015;  // Within 1.5% of lowest low

interface BBState {
  closes: number[];
  sum: number;
  sumSq: number;
  upper: number | null;
  middle: number | null;
  lower: number | null;
}

interface RSIState {
  gains: number[];
  losses: number[];
  avgGain: number | null;
  avgLoss: number | null;
  rsi: number | null;
}

interface PositionState {
  entryPrice: number | null;
  qty: bigint;
  entryBar: number;
}

interface LLState {
  lows: number[];
  lowest: number | null;
}

const bb = new Map<string, BBState>();
const rsi = new Map<string, RSIState>();
const position = new Map<string, PositionState>();
const ll = new Map<string, LLState>();
let lastClose: number | null = null;

function initBB(symbol: string): BBState {
  const s = { closes: [], sum: 0, sumSq: 0, upper: null, middle: null, lower: null };
  bb.set(symbol, s);
  return s;
}

function initRSI(symbol: string): RSIState {
  const s = { gains: [], losses: [], avgGain: null, avgLoss: null, rsi: null };
  rsi.set(symbol, s);
  return s;
}

function initPosition(symbol: string): PositionState {
  const s = { entryPrice: null, qty: 0n, entryBar: -1 };
  position.set(symbol, s);
  return s;
}

function initLL(symbol: string): LLState {
  const s = { lows: [], lowest: null };
  ll.set(symbol, s);
  return s;
}

function updateBB(symbol: string, close: number): BBState {
  let s = bb.get(symbol);
  if (!s) s = initBB(symbol);
  
  if (s.closes.length === BB_PERIOD) {
    const mean = s.sum / BB_PERIOD;
    const variance = s.sumSq / BB_PERIOD - mean * mean;
    const std = Math.sqrt(Math.max(0, variance));
    s.middle = mean;
    s.upper = mean + BB_MULT * std;
    s.lower = mean - BB_MULT * std;
  }
  
  s.closes.push(close);
  s.sum += close;
  s.sumSq += close * close;
  
  if (s.closes.length > BB_PERIOD) {
    const old = s.closes.shift()!;
    s.sum -= old;
    s.sumSq -= old * old;
  }
  
  return s;
}

function updateRSI(symbol: string, close: number, prevClose: number | null): RSIState {
  let s = rsi.get(symbol);
  if (!s) s = initRSI(symbol);
  
  if (prevClose !== null) {
    const change = close - prevClose;
    const gain = Math.max(0, change);
    const loss = Math.max(0, -change);
    
    s.gains.push(gain);
    s.losses.push(loss);
    
    if (s.gains.length > RSI_PERIOD) {
      s.gains.shift();
      s.losses.shift();
    }
    
    if (s.gains.length === RSI_PERIOD) {
      if (s.avgGain === null) {
        s.avgGain = s.gains.reduce((a, b) => a + b, 0) / RSI_PERIOD;
        s.avgLoss = s.losses.reduce((a, b) => a + b, 0) / RSI_PERIOD;
      } else {
        s.avgGain = (s.avgGain * (RSI_PERIOD - 1) + gain) / RSI_PERIOD;
        s.avgLoss = (s.avgLoss * (RSI_PERIOD - 1) + loss) / RSI_PERIOD;
      }
      
      if (s.avgLoss === null || s.avgLoss === 0) {
        s.rsi = 100;
      } else {
        const rs = s.avgGain / s.avgLoss;
        s.rsi = 100 - 100 / (1 + rs);
      }
    }
  }
  
  return s;
}

function updateLL(symbol: string, close: number): LLState {
  let s = ll.get(symbol);
  if (!s) s = initLL(symbol);
  
  s.lows.push(close);
  if (s.lows.length > LL_PERIOD) {
    s.lows.shift();
  }
  
  if (s.lows.length > 0) {
    s.lowest = Math.min(...s.lows);
  }
  
  return s;
}

await runBars({
  onHello(state: BarsState) {
    initBB(SYMBOL);
    initRSI(SYMBOL);
    initPosition(SYMBOL);
    initLL(SYMBOL);
  },
  
  onBatch(state: BarsState, batch: { bars: Bar[]; seq: number }) {
    if (state.warmingUp) return [];
    
    const { caps, fees } = state.hello;
    const sells: SellInput[] = [];
    const buys: BuyInput[] = [];
    
    for (const bar of batch.bars) {
      if (bar.symbol !== SYMBOL) continue;
      
      const close = Number(bar.c);
      const prevClose = lastClose;
      
      const bbState = updateBB(SYMBOL, close);
      const rsiState = updateRSI(SYMBOL, close, prevClose);
      const llState = updateLL(SYMBOL, close);
      const pos = position.get(SYMBOL)!;
      
      // Update lastClose for next batch
      lastClose = close;
      
      // Need enough data
      if (bbState.middle === null || rsiState.rsi === null || llState.lowest === null) continue;
      
      const held = state.positions.get(SYMBOL);
      const inPosition = held !== undefined && held.qty > 0n;
      
      // === EXIT LOGIC ===
      if (inPosition && pos.entryPrice !== null) {
        const pnlPct = (close - pos.entryPrice) / pos.entryPrice;
        const barsHeld = batch.seq - pos.entryBar;
        
        let shouldSell = false;
        if (pnlPct >= TAKE_PROFIT_PCT) shouldSell = true;
        else if (pnlPct <= -STOP_LOSS_PCT) shouldSell = true;
        else if (rsiState.rsi >= RSI_OVERBOUGHT) shouldSell = true;
        else if (close >= bbState.middle!) shouldSell = true;
        else if (barsHeld >= 48) shouldSell = true;
        
        if (shouldSell) {
          sells.push({
            side: 'sell',
            symbol: SYMBOL,
            qty: held.qty,
            max_slippage_bps: MAX_SLIPPAGE_BPS,
            client_id: `sell_${batch.seq}`
          });
          pos.entryPrice = null;
          pos.qty = 0n;
          pos.entryBar = -1;
        }
      }
      
      // === ENTRY LOGIC ===
      if (!inPosition) {
        const atLowerBand = close <= bbState.lower!;
        const rsiOversold = rsiState.rsi <= RSI_OVERSOLD;
        
        // Bounce confirmation: current close > previous close (green bounce bar)
        const bounceConfirm = prevClose !== null && close > prevClose;
        
        // Lowest low filter: only buy near 50-bar low
        const nearLowestLow = llState.lowest !== null && (close - llState.lowest) / llState.lowest <= LL_THRESHOLD;
        
        if (atLowerBand && rsiOversold && bounceConfirm && nearLowestLow) {
          const maxPositionValue = (state.equity * BigInt(Math.floor(MAX_POSITION_PCT * 10000))) / BPS;
          const availableCash = state.cash;
          const positionValue = maxPositionValue < availableCash ? maxPositionValue : availableCash;
          
          if (positionValue >= BigInt(fees.min_notional_quote_units)) {
            buys.push({
              side: 'buy',
              symbol: SYMBOL,
              notional_quote_units: positionValue,
              max_slippage_bps: MAX_SLIPPAGE_BPS,
              client_id: `buy_${batch.seq}`
            });
            pos.entryPrice = close;
            pos.entryBar = batch.seq;
          }
        }
      }
    }
    
    const orders: (SellInput | BuyInput)[] = [
      ...sells.slice(0, caps.max_orders_per_bar),
      ...buys.slice(0, caps.max_orders_per_bar - sells.length)
    ];
    
    return orders;
  },
});