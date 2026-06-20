const BOT_URL = "https://crypto-trading-bot-production-0af1.up.railway.app";

export default async function handler(req, res) {
  try {
    const r = await fetch(`${BOT_URL}/status`, {
      signal: AbortSignal.timeout(5000),
    });
    const data = await r.json();
    res.setHeader("Cache-Control", "no-store");
    res.json({ connected: true, ...data });
  } catch (e) {
    res.json({ connected: false, error: e.message });
  }
}
