import React from 'react';

interface CandleData {
  open: number;
  close: number;
  high: number;
  low: number;
}

// 24-candle realistic structural price action cycle:
// - Liquidity sweep down to Lower Low (LL) with extended wick
// - Break of Structure (BOS) explosive institutional displacement (large green candles)
// - Higher High (HH1) with shooting star rejection wick
// - Retrace to demand zone forming confirmed Higher Low (HL) hammer
// - Second expansion wave breaking out to fresh swing Higher High (HH2)
// - Distribution & peak exhaustion doji
// - Rapid markdown displacement & equal low liquidity grab
// - Smooth mean reversion connecting back to open=68
// Cycle starts at open=68 and terminates at close=68 for seamless infinite looping.
const REALISTIC_CYCLE_CANDLES: CandleData[] = [
  // Phase 1: Tight range consolidation & micro-compression
  { open: 68, close: 71, high: 66, low: 73 }, // Small bearish
  { open: 71, close: 70, high: 67, low: 73 }, // Micro indecision doji

  // Phase 2: Liquidity sweep flush to Lower Low (LL) - long lower pinbar / hammer
  { open: 70, close: 72, high: 68, low: 104 }, // Extended lower rejection wick to 104!

  // Phase 3: Explosive Break of Structure (BOS) displacement (long green candle)
  { open: 72, close: 46, high: 43, low: 73 }, // Strong institutional green candle (body: 26px)

  // Phase 4: Follow-through momentum expansion
  { open: 46, close: 28, high: 25, low: 48 }, // Long green continuation (body: 18px)

  // Phase 5: Swing High rejection (HH1) - shooting star pinbar with long upper wick
  { open: 28, close: 32, high: 14, low: 34 }, // Rejection wick reaching 14 (HH1)

  // Phase 6: Controlled pullback / retrace
  { open: 32, close: 48, high: 30, low: 50 }, // Solid red retrace (body: 16px)
  { open: 48, close: 51, high: 46, low: 53 }, // Small inside pause bar

  // Phase 7: Demand mitigation & Higher Low (HL) confirmation hammer
  { open: 51, close: 47, high: 45, low: 66 }, // Lower wick to 66 (confirmed HL well above 104)

  // Phase 8: Momentum expansion out of demand
  { open: 47, close: 31, high: 29, low: 48 }, // Bullish impulse (body: 16px)

  // Phase 9: Massive breakout to fresh Higher High (HH2)
  { open: 31, close: 15, high: 11, low: 33 }, // Long expansion candle reaching peak 11

  // Phase 10: Peak exhaustion micro-doji at HH2
  { open: 15, close: 16, high: 10, low: 18 }, // Micro doji at extreme top 10

  // Phase 11: Sharp distribution / bearish displacement
  { open: 16, close: 36, high: 14, low: 38 }, // Bearish engulfing (body: 20px)
  { open: 36, close: 52, high: 34, low: 54 }, // Continuation red (body: 16px)

  // Phase 12: Equilibrium pause
  { open: 52, close: 49, high: 45, low: 56 }, // Small spinning top

  // Phase 13: Breakdown continuation
  { open: 49, close: 66, high: 48, low: 68 }, // Solid red drop (body: 17px)

  // Phase 14: Minor counter-trend relief push
  { open: 66, close: 59, high: 57, low: 68 }, // Small green recovery
  { open: 59, close: 52, high: 50, low: 61 }, // Second green push

  // Phase 15: Lower High (LH) rejection
  { open: 52, close: 61, high: 46, low: 64 }, // Upper wick rejection at 46 (LH)

  // Phase 16: Heavy flush down / capitulation
  { open: 61, close: 88, high: 59, low: 92 }, // Long red flush (body: 27px)

  // Phase 17: Institutional absorption hammer with long lower wick
  { open: 88, close: 82, high: 80, low: 106 }, // Deep lower wick to 106

  // Phase 18: Strong V-reversal green expansion
  { open: 82, close: 66, high: 63, low: 84 }, // Strong green recovery (body: 16px)

  // Phase 19: Gentle consolidation pullback
  { open: 66, close: 71, high: 64, low: 73 }, // Small red pause

  // Phase 20: Smooth transition candle back to cycle origin
  { open: 71, close: 68, high: 66, low: 74 }, // Close = 68 (matches Candle 0 open!)
];

const CANDLE_STEP = 18;
const CANDLE_WIDTH = 9;

// Repeat 3 full cycles (72 candles total = 1296px) for infinite seamless conveyor motion
const MOVING_CANDLES: CandleData[] = [
  ...REALISTIC_CYCLE_CANDLES,
  ...REALISTIC_CYCLE_CANDLES,
  ...REALISTIC_CYCLE_CANDLES,
];

export const HeroVisual: React.FC = () => {
  return (
    <div
      className="w-full max-w-[480px] mx-auto select-none pointer-events-none my-2 sm:my-3.5 relative flex items-center justify-center"
      aria-label="Realistic moving trading chart candlesticks"
    >
      {/* Subtle ambient emerald glow behind transparent candles */}
      <div className="absolute inset-0 bg-radial from-emerald-500/10 via-transparent to-transparent blur-xl -z-10" />

      {/* Transparent moving chart canvas with soft left/right edge fade */}
      <div
        className="w-full h-[90px] xs:h-[105px] sm:h-[120px] md:h-[130px] overflow-hidden"
        style={{
          maskImage:
            'linear-gradient(to right, transparent 0%, black 8%, black 92%, transparent 100%)',
          WebkitMaskImage:
            'linear-gradient(to right, transparent 0%, black 8%, black 92%, transparent 100%)',
        }}
      >
        <svg
          viewBox="0 0 480 120"
          fill="none"
          xmlns="http://www.w3.org/2000/svg"
          className="w-full h-full"
          preserveAspectRatio="xMidYMid meet"
        >
          {/* Continuous seamlessly moving candlestick track */}
          <g className="chart-moving-track">
            {MOVING_CANDLES.map((c, idx) => {
              const x = idx * CANDLE_STEP + 8;
              // In SVG coordinates: smaller Y = higher price (top of screen)
              const isBullish = c.close <= c.open;
              const bodyTop = Math.min(c.open, c.close);
              const bodyHeight = Math.max(Math.abs(c.close - c.open), 1.5);
              const candleColor = isBullish ? '#059669' : '#EF4444';
              const wickColor = isBullish ? '#047857' : '#DC2626';

              return (
                <g key={`candle-${idx}`}>
                  {/* Full High-Low Wick */}
                  <line
                    x1={x + CANDLE_WIDTH / 2}
                    y1={c.high}
                    x2={x + CANDLE_WIDTH / 2}
                    y2={c.low}
                    stroke={wickColor}
                    strokeWidth="1.3"
                    strokeLinecap="round"
                    opacity={0.9}
                  />

                  {/* Real Candlestick Body */}
                  <rect
                    x={x}
                    y={bodyTop}
                    width={CANDLE_WIDTH}
                    height={bodyHeight}
                    rx="1"
                    fill={candleColor}
                    stroke={wickColor}
                    strokeWidth="0.8"
                    fillOpacity={0.95}
                  />
                </g>
              );
            })}
          </g>
        </svg>
      </div>
    </div>
  );
};
