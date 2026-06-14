import Head from "next/head";
import { useState, useEffect, useRef } from "react";

// ── Simulated live market data ─────────────────────────────
const generateCandles = (base, count = 60) => {
  const candles = [];
  let price = base;
  for (let i = 0; i < count; i++) {
    const change = (Math.random() - 0.48) * price * 0.015;
    const open = price;
    const close = price + change;
    const high = Math.max(open, close) * (1 + Math.random() * 0.008);
    const low = Math.min(open, close) * (1 - Math.random() * 0.008);
    candles.push({ open, high, low, close, volume: 50 + Math.random() * 200 });
    price = close;
  }
  return candles;
};

const computeRSI = (candles, period = 14) => {
  const closes = candles.map((c) => c.close);
  const deltas = closes.slice(1).map((c, i) => c - closes[i]);
  const gains = deltas.map((d) => Math.max(d, 0));
  const losses = deltas.map((d) => Math.max(-d, 0));
  const avgGain = gains.slice(-period).reduce((a, b) => a + b, 0) / period;
  const avgLoss = losses.slice(-period).reduce((a, b) => a + b, 0) / period;
  const rs = avgGain / (avgLoss || 0.001);
  return 100 - 100 / (1 + rs);
};

const computeEMA = (candles, span) => {
  const closes = candles.map((c) => c.close);
  const k = 2 / (span + 1);
  let ema = closes[0];
  for (let i = 1; i < closes.length; i++) ema = closes[i] * k + ema * (1 - k);
  return ema;
};

const computeMACD = (candles) => {
  const ema12 = computeEMA(candles, 12);
  const ema26 = computeEMA(candles, 26);
  return ema12 - ema26;
};

// ── Claude Analysis — calls our server-side proxy ──────────
const analyzeWithClaude = async (pair, price, indicators) => {
  const prompt = `You are a crypto trading analyst. Analyze ${pair} and respond ONLY with valid JSON.

Current price: $${price.toFixed(2)}
RSI: ${indicators.rsi.toFixed(1)}
EMA Trend: ${indicators.emaTrend}
MACD: ${indicators.macd > 0 ? "BULLISH" : "BEARISH"} (${indicators.macd.toFixed(2)})
1h change: ${indicators.change1h.toFixed(2)}%
Volume ratio: ${indicators.volumeRatio.toFixed(2)}x avg

Respond ONLY with this JSON (no markdown):
{
  "action": "BUY" | "SELL" | "HOLD",
  "confidence": 1-10,
  "reasoning": "2 sentences max",
  "risk": "LOW" | "MEDIUM" | "HIGH",
  "signal": "one key factor"
}`;

  try {
    const res = await fetch("/api/analyze", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ prompt }),
    });
    const data = await res.json();
    const text = data.content?.[0]?.text || "{}";
    const clean = text.replace(/```json|```/g, "").trim();
    return JSON.parse(clean);
  } catch {
    return { action: "HOLD", confidence: 5, reasoning: "Analysis pending...", risk: "MEDIUM", signal: "Awaiting data" };
  }
};

// ── Sparkline SVG ──────────────────────────────────────────
const Sparkline = ({ data, color, height = 40 }) => {
  if (!data || data.length < 2) return null;
  const min = Math.min(...data);
  const max = Math.max(...data);
  const range = max - min || 1;
  const w = 120, h = height;
  const points = data
    .map((v, i) => `${(i / (data.length - 1)) * w},${h - ((v - min) / range) * h}`)
    .join(" ");
  return (
    <svg width={w} height={h} style={{ overflow: "visible" }}>
      <defs>
        <linearGradient id={`sg-${color}`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={color} stopOpacity="0.3" />
          <stop offset="100%" stopColor={color} stopOpacity="0" />
        </linearGradient>
      </defs>
      <polygon points={`0,${h} ${points} ${w},${h}`} fill={`url(#sg-${color})`} />
      <polyline points={points} fill="none" stroke={color} strokeWidth="1.5" strokeLinejoin="round" />
    </svg>
  );
};

// ── Mini Candle Chart ──────────────────────────────────────
const CandleChart = ({ candles }) => {
  if (!candles || candles.length === 0) return null;
  const last = candles.slice(-30);
  const allPrices = last.flatMap((c) => [c.high, c.low]);
  const min = Math.min(...allPrices);
  const max = Math.max(...allPrices);
  const range = max - min || 1;
  const W = 300, H = 80;
  const cw = W / last.length;

  return (
    <svg width="100%" viewBox={`0 0 ${W} ${H}`} style={{ display: "block" }}>
      {last.map((c, i) => {
        const x = i * cw + cw * 0.1;
        const bw = cw * 0.7;
        const bull = c.close >= c.open;
        const color = bull ? "#00d4aa" : "#ff4757";
        const bodyTop = H - ((Math.max(c.open, c.close) - min) / range) * H;
        const bodyBot = H - ((Math.min(c.open, c.close) - min) / range) * H;
        const wickTop = H - ((c.high - min) / range) * H;
        const wickBot = H - ((c.low - min) / range) * H;
        return (
          <g key={i}>
            <line x1={x + bw / 2} y1={wickTop} x2={x + bw / 2} y2={wickBot} stroke={color} strokeWidth="1" />
            <rect x={x} y={bodyTop} width={bw} height={Math.max(bodyBot - bodyTop, 1)} fill={color} opacity="0.85" />
          </g>
        );
      })}
    </svg>
  );
};

// ── Main Dashboard ─────────────────────────────────────────
export default function CryptoBotDashboard() {
  const PAIRS = ["BTC/USDT", "ETH/USDT", "SOL/USDT", "BNB/USDT"];
  const BASE_PRICES = { "BTC/USDT": 67800, "ETH/USDT": 3540, "SOL/USDT": 172, "BNB/USDT": 598 };

  const [selectedPair, setSelectedPair] = useState("BTC/USDT");
  const [candles, setCandles] = useState({});
  const [prices, setPrices] = useState({ ...BASE_PRICES });
  const [analysis, setAnalysis] = useState(null);
  const [analyzing, setAnalyzing] = useState(false);
  const [botActive, setBotActive] = useState(false);
  const [position, setPosition] = useState(null);
  const [tradeLog, setTradeLog] = useState([]);
  const [priceHistory, setPriceHistory] = useState({});
  const intervalRef = useRef(null);
  const [isMobile, setIsMobile] = useState(false);
  useEffect(() => {
    const check = () => setIsMobile(window.innerWidth < 768);
    check();
    window.addEventListener("resize", check);
    return () => window.removeEventListener("resize", check);
  }, []);

  useEffect(() => {
    const c = {};
    const ph = {};
    PAIRS.forEach((p) => {
      c[p] = generateCandles(BASE_PRICES[p]);
      ph[p] = c[p].slice(-20).map((x) => x.close);
    });
    setCandles(c);
    setPriceHistory(ph);
  }, []);

  useEffect(() => {
    const t = setInterval(() => {
      setPrices((prev) => {
        const next = { ...prev };
        PAIRS.forEach((p) => {
          const drift = (Math.random() - 0.495) * next[p] * 0.003;
          next[p] = Math.max(next[p] + drift, 1);
        });
        return next;
      });
      setPriceHistory((prev) => {
        const next = { ...prev };
        PAIRS.forEach((p) => {
          const hist = [...(prev[p] || [])];
          hist.push(prices[p] || BASE_PRICES[p]);
          if (hist.length > 40) hist.shift();
          next[p] = hist;
        });
        return next;
      });
    }, 2000);
    return () => clearInterval(t);
  }, [prices]);

  useEffect(() => {
    if (botActive) {
      intervalRef.current = setInterval(() => runAnalysis(), 30000);
    } else {
      clearInterval(intervalRef.current);
    }
    return () => clearInterval(intervalRef.current);
  }, [botActive, selectedPair, prices]);

  const getIndicators = (pair) => {
    const c = candles[pair] || generateCandles(BASE_PRICES[pair]);
    const liveClose = { ...c[c.length - 1], close: prices[pair] || c[c.length - 1].close };
    const updated = [...c.slice(0, -1), liveClose];
    const rsi = computeRSI(updated);
    const ema9 = computeEMA(updated, 9);
    const ema21 = computeEMA(updated, 21);
    const ema50 = computeEMA(updated, 50);
    const macd = computeMACD(updated);
    const closes = updated.map((x) => x.close);
    const change1h = ((closes[closes.length - 1] - closes[closes.length - 4]) / closes[closes.length - 4]) * 100;
    const volumes = updated.map((x) => x.volume);
    const avgVol = volumes.slice(-20).reduce((a, b) => a + b, 0) / 20;
    const lastVol = volumes[volumes.length - 1];
    return {
      rsi, ema9, ema21, ema50, macd,
      emaTrend: ema9 > ema21 && ema21 > ema50 ? "BULLISH" : ema9 < ema21 && ema21 < ema50 ? "BEARISH" : "MIXED",
      change1h,
      volumeRatio: lastVol / avgVol,
    };
  };

  const runAnalysis = async () => {
    setAnalyzing(true);
    const ind = getIndicators(selectedPair);
    const result = await analyzeWithClaude(selectedPair, prices[selectedPair], ind);
    setAnalysis(result);
    setAnalyzing(false);

    if (botActive && result) {
      if (result.action === "BUY" && !position && result.confidence >= 7 && result.risk !== "HIGH") {
        const entry = prices[selectedPair];
        setPosition({ pair: selectedPair, entry, stop: entry * 0.98, target: entry * 1.04, qty: 0.001 });
        setTradeLog((prev) => [
          { time: new Date().toLocaleTimeString(), action: "BUY", price: entry.toFixed(2), pair: selectedPair, reason: result.signal },
          ...prev.slice(0, 9),
        ]);
      } else if (result.action === "SELL" && position) {
        const exitPrice = prices[selectedPair];
        const pnl = ((exitPrice - position.entry) / position.entry) * 100;
        setTradeLog((prev) => [
          { time: new Date().toLocaleTimeString(), action: "SELL", price: exitPrice.toFixed(2), pair: selectedPair, pnl: pnl.toFixed(2), reason: result.signal },
          ...prev.slice(0, 9),
        ]);
        setPosition(null);
      }
    }
  };

  const ind = candles[selectedPair] ? getIndicators(selectedPair) : null;
  const currentPrice = prices[selectedPair] || BASE_PRICES[selectedPair];
  const base = BASE_PRICES[selectedPair];
  const sessionChange = ((currentPrice - base) / base) * 100;
  const positionPnL = position ? ((currentPrice - position.entry) / position.entry) * 100 : null;

  return (
    <>
      <Head>
        <title>Claude Trade — AI Crypto Bot Dashboard</title>
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link href="https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@300;400;500;600&family=Orbitron:wght@700;900&display=swap" rel="stylesheet" />
      </Head>

      <div style={{
        fontFamily: "'IBM Plex Mono', 'Courier New', monospace",
        background: "#080c14",
        minHeight: "100vh",
        color: "#c8d8e8",
        padding: "0",
        overflowX: "hidden",
      }}>
        <style>{`
          * { box-sizing: border-box; margin: 0; padding: 0; }
          ::-webkit-scrollbar { width: 4px; }
          ::-webkit-scrollbar-track { background: #0d1520; }
          ::-webkit-scrollbar-thumb { background: #1a3050; border-radius: 2px; }
          .grid-bg {
            background-image: linear-gradient(rgba(0,180,255,0.03) 1px, transparent 1px),
                              linear-gradient(90deg, rgba(0,180,255,0.03) 1px, transparent 1px);
            background-size: 32px 32px;
          }
          @keyframes pulse { 0%,100% { opacity:1 } 50% { opacity:0.4 } }
          @keyframes slideIn { from { opacity:0; transform:translateY(-8px); } to { opacity:1; transform:none; } }
          @keyframes scanline { 0% { transform:translateY(-100%); } 100% { transform:translateY(100vh); } }
          .live-dot { animation: pulse 1.4s ease-in-out infinite; }
          .slide-in { animation: slideIn 0.4s ease; }
          .btn-hover:hover { filter: brightness(1.2); transform: translateY(-1px); transition: all 0.15s; }
          .pair-btn:hover { background: #0d2035 !important; }
          @media (max-width: 768px) {
            .header-title-sub { display: none; }
            .header-status-label { display: none; }
            .orbitron-title { font-size: 11px !important; letter-spacing: 1px !important; }
            .pair-selector { overflow-x: auto; padding-bottom: 6px; -webkit-overflow-scrolling: touch; }
            .pair-selector::-webkit-scrollbar { display: none; }
          }
        `}</style>

        {/* Scanline overlay */}
        <div style={{ position:"fixed", inset:0, pointerEvents:"none", zIndex:0, overflow:"hidden" }}>
          <div style={{
            position:"absolute", left:0, right:0, height:"2px",
            background:"linear-gradient(transparent, rgba(0,200,255,0.05), transparent)",
            animation:"scanline 8s linear infinite"
          }}/>
        </div>

        {/* Header */}
        <div style={{
          borderBottom:"1px solid #0d2035", padding: isMobile ? "10px 14px" : "16px 24px",
          display:"flex", alignItems:"center", justifyContent:"space-between",
          background:"rgba(8,12,20,0.95)", backdropFilter:"blur(10px)",
          position:"sticky", top:0, zIndex:10,
        }}>
          <div style={{ display:"flex", alignItems:"center", gap:"14px" }}>
            <div style={{
              width:32, height:32, borderRadius:"6px",
              background:"linear-gradient(135deg, #00b4d8, #0077b6)",
              display:"flex", alignItems:"center", justifyContent:"center",
              fontSize:"16px", fontWeight:"bold",
            }}>⚡</div>
            <div>
              <div className="orbitron-title" style={{ fontFamily:"'Orbitron', monospace", fontSize:"14px", fontWeight:900, color:"#00d4ff", letterSpacing:"2px" }}>
                CLAUDE·TRADE
              </div>
              <div className="header-title-sub" style={{ fontSize:"9px", color:"#3a5570", letterSpacing:"3px", textTransform:"uppercase" }}>AI Crypto Bot Dashboard</div>
            </div>
          </div>

          <div style={{ display:"flex", alignItems:"center", gap: isMobile ? "8px" : "20px" }}>
            <div style={{ display:"flex", alignItems:"center", gap:"6px", fontSize:"11px" }}>
              <div className="live-dot" style={{
                width:7, height:7, borderRadius:"50%",
                background: botActive ? "#00d4aa" : "#3a5570",
                boxShadow: botActive ? "0 0 8px #00d4aa" : "none",
              }}/>
              <span className="header-status-label" style={{ color: botActive ? "#00d4aa" : "#3a5570" }}>
                {botActive ? "BOT ACTIVE" : "STANDBY"}
              </span>
            </div>

            <button className="btn-hover" onClick={() => setBotActive((b) => !b)} style={{
              background: botActive ? "rgba(255,71,87,0.15)" : "rgba(0,212,170,0.15)",
              border: `1px solid ${botActive ? "#ff4757" : "#00d4aa"}`,
              color: botActive ? "#ff4757" : "#00d4aa",
              padding: isMobile ? "7px 10px" : "6px 16px", borderRadius:"4px",
              fontSize: isMobile ? "14px" : "11px", cursor:"pointer", letterSpacing:"1px", transition:"all 0.2s",
            }}>
              {isMobile ? (botActive ? "⬛" : "▶") : (botActive ? "⬛ STOP BOT" : "▶ START BOT")}
            </button>

            <button className="btn-hover" onClick={runAnalysis} disabled={analyzing} style={{
              background: analyzing ? "rgba(0,116,217,0.1)" : "rgba(0,116,217,0.2)",
              border:"1px solid #0074d9",
              color: analyzing ? "#3a5570" : "#4da6ff",
              padding: isMobile ? "7px 10px" : "6px 16px", borderRadius:"4px",
              fontSize: isMobile ? "14px" : "11px", cursor: analyzing ? "not-allowed" : "pointer", letterSpacing:"1px", transition:"all 0.2s",
            }}>
              {isMobile ? (analyzing ? "⟳" : "🤖") : (analyzing ? "⟳ ANALYZING..." : "🤖 ASK CLAUDE")}
            </button>
          </div>
        </div>

        <div className="grid-bg" style={{ padding: isMobile ? "12px" : "20px 24px", position:"relative", zIndex:1 }}>

          {/* Pair selector */}
          <div className="pair-selector" style={{ display:"flex", gap:"8px", marginBottom:"16px", flexWrap: isMobile ? "nowrap" : "wrap" }}>
            {PAIRS.map((pair) => {
              const p = prices[pair] || BASE_PRICES[pair];
              const chg = ((p - BASE_PRICES[pair]) / BASE_PRICES[pair]) * 100;
              const active = pair === selectedPair;
              return (
                <button key={pair} className="pair-btn" onClick={() => { setSelectedPair(pair); setAnalysis(null); }} style={{
                  background: active ? "rgba(0,180,255,0.12)" : "rgba(13,21,32,0.8)",
                  border: `1px solid ${active ? "#00b4d8" : "#0d2035"}`,
                  borderRadius:"8px", padding:"10px 16px", cursor:"pointer", transition:"all 0.2s",
                  display:"flex", flexDirection:"column", alignItems:"flex-start", gap:"4px", minWidth:"130px",
                }}>
                  <span style={{ fontSize:"11px", color: active ? "#00d4ff" : "#3a6080", letterSpacing:"1px" }}>{pair}</span>
                  <span style={{ fontFamily:"'Orbitron',monospace", fontSize:"14px", color: active ? "#fff" : "#8ab0c8", fontWeight:700 }}>
                    ${p.toLocaleString("en-US", { maximumFractionDigits: 2 })}
                  </span>
                  <span style={{ fontSize:"10px", color: chg >= 0 ? "#00d4aa" : "#ff4757" }}>
                    {chg >= 0 ? "▲" : "▼"} {Math.abs(chg).toFixed(2)}%
                  </span>
                </button>
              );
            })}
          </div>

          <div style={{ display:"grid", gridTemplateColumns: isMobile ? "1fr" : "1fr 320px", gap:"16px" }}>

            {/* LEFT COLUMN */}
            <div style={{ display:"flex", flexDirection:"column", gap:"16px" }}>

              {/* Main price card */}
              <div style={{ background:"rgba(13,21,32,0.9)", border:"1px solid #0d2035", borderRadius:"10px", padding:"20px" }}>
                <div style={{ display:"flex", justifyContent:"space-between", alignItems:"flex-start" }}>
                  <div>
                    <div style={{ fontSize:"11px", color:"#3a6080", letterSpacing:"2px", marginBottom:"6px" }}>{selectedPair} · LIVE</div>
                    <div style={{ fontFamily:"'Orbitron',monospace", fontSize: isMobile ? "22px" : "32px", fontWeight:900, color:"#fff", letterSpacing:"1px" }}>
                      ${currentPrice.toLocaleString("en-US", { maximumFractionDigits: 2 })}
                    </div>
                    <div style={{ marginTop:"6px" }}>
                      <span style={{ fontSize:"13px", color: sessionChange >= 0 ? "#00d4aa" : "#ff4757" }}>
                        {sessionChange >= 0 ? "▲" : "▼"} {Math.abs(sessionChange).toFixed(3)}% session
                      </span>
                    </div>
                  </div>
                  <Sparkline data={priceHistory[selectedPair]} color={sessionChange >= 0 ? "#00d4aa" : "#ff4757"} height={52} />
                </div>
                <div style={{ marginTop:"16px", borderTop:"1px solid #0d2035", paddingTop:"12px" }}>
                  <div style={{ fontSize:"9px", color:"#3a5570", letterSpacing:"2px", marginBottom:"8px" }}>30-PERIOD CANDLES · 1H</div>
                  <CandleChart candles={candles[selectedPair]} />
                </div>
              </div>

              {/* Indicators */}
              {ind && (
                <div style={{ display:"grid", gridTemplateColumns: isMobile ? "repeat(2,1fr)" : "repeat(3,1fr)", gap:"10px" }}>
                  {[
                    { label:"RSI (14)", value: ind.rsi.toFixed(1), sub: ind.rsi > 70 ? "OVERBOUGHT" : ind.rsi < 30 ? "OVERSOLD" : "NEUTRAL", color: ind.rsi > 70 ? "#ff4757" : ind.rsi < 30 ? "#ffa502" : "#00d4aa" },
                    { label:"EMA TREND", value: ind.emaTrend, sub: `9: ${ind.ema9.toFixed(0)}`, color: ind.emaTrend === "BULLISH" ? "#00d4aa" : ind.emaTrend === "BEARISH" ? "#ff4757" : "#ffa502" },
                    { label:"MACD", value: ind.macd > 0 ? "BULLISH" : "BEARISH", sub: ind.macd.toFixed(2), color: ind.macd > 0 ? "#00d4aa" : "#ff4757" },
                    { label:"1H CHANGE", value: `${ind.change1h >= 0 ? "+" : ""}${ind.change1h.toFixed(3)}%`, sub: "price action", color: ind.change1h >= 0 ? "#00d4aa" : "#ff4757" },
                    { label:"VOLUME", value: `${ind.volumeRatio.toFixed(2)}x`, sub: ind.volumeRatio > 1.5 ? "HIGH" : ind.volumeRatio < 0.7 ? "LOW" : "AVERAGE", color: ind.volumeRatio > 1.5 ? "#00d4ff" : "#8ab0c8" },
                    { label:"SIGNAL", value: ind.emaTrend === "BULLISH" && ind.macd > 0 ? "BUY ZONE" : ind.emaTrend === "BEARISH" && ind.macd < 0 ? "SELL ZONE" : "NEUTRAL", sub: "composite", color: ind.emaTrend === "BULLISH" && ind.macd > 0 ? "#00d4aa" : ind.emaTrend === "BEARISH" && ind.macd < 0 ? "#ff4757" : "#ffa502" },
                  ].map((item) => (
                    <div key={item.label} style={{ background:"rgba(13,21,32,0.9)", border:"1px solid #0d2035", borderRadius:"8px", padding:"14px" }}>
                      <div style={{ fontSize:"9px", color:"#3a5570", letterSpacing:"2px", marginBottom:"6px" }}>{item.label}</div>
                      <div style={{ fontSize:"16px", fontWeight:600, color: item.color, fontFamily:"'Orbitron',monospace" }}>{item.value}</div>
                      <div style={{ fontSize:"9px", color:"#3a5570", marginTop:"4px" }}>{item.sub}</div>
                    </div>
                  ))}
                </div>
              )}

              {/* Position */}
              {position && (
                <div className="slide-in" style={{ background:"rgba(0,212,170,0.05)", border:"1px solid rgba(0,212,170,0.3)", borderRadius:"10px", padding:"16px" }}>
                  <div style={{ fontSize:"10px", color:"#00d4aa", letterSpacing:"2px", marginBottom:"12px" }}>◉ OPEN POSITION</div>
                  <div style={{ display:"grid", gridTemplateColumns: isMobile ? "repeat(2,1fr)" : "repeat(4,1fr)", gap:"12px" }}>
                    {[
                      { label:"PAIR", value: position.pair },
                      { label:"ENTRY", value: `$${Number(position.entry).toFixed(2)}` },
                      { label:"STOP", value: `$${position.stop.toFixed(2)}`, color:"#ff4757" },
                      { label:"TARGET", value: `$${position.target.toFixed(2)}`, color:"#00d4aa" },
                    ].map((f) => (
                      <div key={f.label}>
                        <div style={{ fontSize:"9px", color:"#3a5570", letterSpacing:"1px" }}>{f.label}</div>
                        <div style={{ fontSize:"14px", color: f.color || "#fff", fontFamily:"'Orbitron',monospace", marginTop:"3px" }}>{f.value}</div>
                      </div>
                    ))}
                  </div>
                  <div style={{ marginTop:"12px" }}>
                    <div style={{
                      display:"inline-block", padding:"4px 12px", borderRadius:"4px",
                      background: positionPnL >= 0 ? "rgba(0,212,170,0.15)" : "rgba(255,71,87,0.15)",
                      border: `1px solid ${positionPnL >= 0 ? "#00d4aa" : "#ff4757"}`,
                      fontSize:"12px", color: positionPnL >= 0 ? "#00d4aa" : "#ff4757",
                      fontFamily:"'Orbitron',monospace",
                    }}>
                      P&L: {positionPnL >= 0 ? "+" : ""}{positionPnL?.toFixed(3)}%
                    </div>
                  </div>
                </div>
              )}
            </div>

            {/* RIGHT COLUMN */}
            <div style={{ display:"flex", flexDirection:"column", gap:"16px" }}>

              {/* Claude Analysis */}
              <div style={{ background:"rgba(13,21,32,0.9)", border:"1px solid #0d2035", borderRadius:"10px", padding:"16px", minHeight:"200px" }}>
                <div style={{ display:"flex", alignItems:"center", gap:"8px", marginBottom:"14px" }}>
                  <span style={{ fontSize:"14px" }}>🤖</span>
                  <span style={{ fontSize:"9px", color:"#3a5570", letterSpacing:"2px" }}>CLAUDE AI ANALYSIS</span>
                  {analyzing && <div className="live-dot" style={{ marginLeft:"auto", width:6, height:6, borderRadius:"50%", background:"#00d4ff" }}/>}
                </div>

                {analyzing && (
                  <div style={{ textAlign:"center", padding:"30px 0", color:"#3a5570", fontSize:"11px" }}>
                    <div style={{ fontSize:"20px", marginBottom:"8px" }}>⟳</div>
                    Consulting Claude...
                  </div>
                )}

                {!analyzing && !analysis && (
                  <div style={{ textAlign:"center", padding:"30px 0", color:"#3a5570", fontSize:"11px" }}>
                    Click &quot;ASK CLAUDE&quot; to analyze {selectedPair}
                  </div>
                )}

                {!analyzing && analysis && (
                  <div className="slide-in">
                    <div style={{
                      display:"inline-block", padding:"8px 20px", borderRadius:"6px", marginBottom:"14px",
                      background: analysis.action === "BUY" ? "rgba(0,212,170,0.15)" : analysis.action === "SELL" ? "rgba(255,71,87,0.15)" : "rgba(255,165,2,0.12)",
                      border: `1px solid ${analysis.action === "BUY" ? "#00d4aa" : analysis.action === "SELL" ? "#ff4757" : "#ffa502"}`,
                    }}>
                      <span style={{
                        fontFamily:"'Orbitron',monospace", fontSize:"20px", fontWeight:900,
                        color: analysis.action === "BUY" ? "#00d4aa" : analysis.action === "SELL" ? "#ff4757" : "#ffa502",
                      }}>
                        {analysis.action === "BUY" ? "▲ BUY" : analysis.action === "SELL" ? "▼ SELL" : "⏸ HOLD"}
                      </span>
                    </div>

                    <div style={{ marginBottom:"12px" }}>
                      <div style={{ display:"flex", justifyContent:"space-between", fontSize:"9px", color:"#3a5570", marginBottom:"4px" }}>
                        <span>CONFIDENCE</span><span>{analysis.confidence}/10</span>
                      </div>
                      <div style={{ height:4, background:"#0d2035", borderRadius:"2px" }}>
                        <div style={{
                          height:"100%", borderRadius:"2px", width:`${analysis.confidence * 10}%`,
                          background: analysis.confidence >= 7 ? "#00d4aa" : analysis.confidence >= 5 ? "#ffa502" : "#ff4757",
                          transition:"width 0.6s ease",
                        }}/>
                      </div>
                    </div>

                    <div style={{ display:"flex", gap:"6px", marginBottom:"12px", alignItems:"center" }}>
                      <span style={{ fontSize:"9px", color:"#3a5570" }}>RISK:</span>
                      <span style={{
                        fontSize:"10px", padding:"2px 8px", borderRadius:"3px",
                        color: analysis.risk === "LOW" ? "#00d4aa" : analysis.risk === "HIGH" ? "#ff4757" : "#ffa502",
                        background: analysis.risk === "LOW" ? "rgba(0,212,170,0.1)" : analysis.risk === "HIGH" ? "rgba(255,71,87,0.1)" : "rgba(255,165,2,0.1)",
                      }}>{analysis.risk}</span>
                    </div>

                    <div style={{ marginBottom:"10px" }}>
                      <div style={{ fontSize:"9px", color:"#3a5570", letterSpacing:"1px", marginBottom:"4px" }}>KEY SIGNAL</div>
                      <div style={{ fontSize:"11px", color:"#00d4ff", background:"rgba(0,180,255,0.06)", padding:"6px 8px", borderRadius:"4px", borderLeft:"2px solid #00b4d8" }}>
                        {analysis.signal}
                      </div>
                    </div>

                    <div>
                      <div style={{ fontSize:"9px", color:"#3a5570", letterSpacing:"1px", marginBottom:"4px" }}>REASONING</div>
                      <div style={{ fontSize:"11px", color:"#8ab0c8", lineHeight:"1.6" }}>{analysis.reasoning}</div>
                    </div>
                  </div>
                )}
              </div>

              {/* Trade Log */}
              <div style={{ background:"rgba(13,21,32,0.9)", border:"1px solid #0d2035", borderRadius:"10px", padding:"16px" }}>
                <div style={{ fontSize:"9px", color:"#3a5570", letterSpacing:"2px", marginBottom:"12px" }}>📋 TRADE LOG</div>
                {tradeLog.length === 0 ? (
                  <div style={{ fontSize:"11px", color:"#3a5570", textAlign:"center", padding:"16px 0" }}>No trades yet</div>
                ) : (
                  <div style={{ display:"flex", flexDirection:"column", gap:"6px", maxHeight:"200px", overflowY:"auto" }}>
                    {tradeLog.map((t, i) => (
                      <div key={i} className="slide-in" style={{
                        display:"flex", justifyContent:"space-between", alignItems:"center",
                        padding:"6px 10px", borderRadius:"4px",
                        background: t.action === "BUY" ? "rgba(0,212,170,0.05)" : "rgba(255,71,87,0.05)",
                        border: `1px solid ${t.action === "BUY" ? "rgba(0,212,170,0.15)" : "rgba(255,71,87,0.15)"}`,
                      }}>
                        <div>
                          <span style={{ fontSize:"10px", color: t.action === "BUY" ? "#00d4aa" : "#ff4757", fontWeight:600 }}>
                            {t.action === "BUY" ? "▲" : "▼"} {t.action}
                          </span>
                          <span style={{ fontSize:"9px", color:"#3a5570", marginLeft:"6px" }}>{t.pair}</span>
                        </div>
                        <div style={{ textAlign:"right" }}>
                          <div style={{ fontSize:"10px", color:"#c8d8e8" }}>${t.price}</div>
                          {t.pnl && <div style={{ fontSize:"9px", color: t.pnl >= 0 ? "#00d4aa" : "#ff4757" }}>{t.pnl >= 0 ? "+" : ""}{t.pnl}%</div>}
                          <div style={{ fontSize:"8px", color:"#3a5570" }}>{t.time}</div>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* Disclaimer */}
              <div style={{
                background:"rgba(255,165,2,0.05)", border:"1px solid rgba(255,165,2,0.2)",
                borderRadius:"8px", padding:"12px",
                fontSize:"9px", color:"#7a6020", lineHeight:"1.6",
              }}>
                ⚠️ EDUCATIONAL PURPOSES ONLY. This dashboard uses simulated prices. No real trades are executed here. Crypto trading carries extreme risk.
              </div>
            </div>
          </div>
        </div>
      </div>
    </>
  );
}
