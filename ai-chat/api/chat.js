// Serverless function: receives the chat, calls Gemini with your SECRET key, streams the answer back.
// The key lives in a Vercel environment variable, never in the browser.
const MODEL = process.env.GEMINI_MODEL || "gemini-3.8-flash";
const SYSTEM = "You are a friendly demo assistant on Sofiene Ben Fekih's portfolio. Answer clearly and concisely. Reply in the same language the user writes in (Arabic, French or English).";

module.exports = async (req, res) => {
  if (req.method !== "POST") return res.status(405).send("Use POST");
  if (!process.env.GEMINI_API_KEY) return res.status(500).send("Server is missing GEMINI_API_KEY.");

  // Basic limits so nobody can burn your free quota with huge requests
  const msgs = Array.isArray(req.body?.messages) ? req.body.messages.slice(-12) : [];
  const contents = msgs
    .filter(m => typeof m.text === "string" && m.text.trim())
    .map(m => ({ role: m.role === "user" ? "user" : "model", parts: [{ text: m.text.slice(0, 2000) }] }));
  if (!contents.length || contents[contents.length - 1].role !== "user") return res.status(400).send("Bad request.");

  const url = `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:streamGenerateContent?alt=sse`;
  const upstream = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-goog-api-key": process.env.GEMINI_API_KEY },
    body: JSON.stringify({ systemInstruction: { parts: [{ text: SYSTEM }] }, contents })
  });
  if (!upstream.ok) {
    console.error("Gemini error", upstream.status, await upstream.text());
    const msg = upstream.status === 429 ? "The free quota is used up for now. Try again later." : "The AI service returned an error (" + upstream.status + ").";
    return res.status(502).send(msg);
  }

  res.setHeader("Content-Type", "text/plain; charset=utf-8");
  res.setHeader("Cache-Control", "no-cache");
  const reader = upstream.body.getReader(), dec = new TextDecoder();
  let buf = "";
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
    const lines = buf.split("\n"); buf = lines.pop();
    for (const line of lines) {
      if (!line.startsWith("data:")) continue;
      try {
        const parts = JSON.parse(line.slice(5)).candidates?.[0]?.content?.parts || [];
        for (const p of parts) if (p.text) res.write(p.text);
      } catch (e) { /* ignore partial lines */ }
    }
  }
  res.end();
};
