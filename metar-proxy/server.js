// 極簡 METAR 代理服務：伺服器對伺服器呼叫 aviationweather.gov，
// 加上 CORS 標頭後回傳給瀏覽器端的 AMPS 前端，藉此繞過 aviationweather.gov 本身不支援瀏覽器跨網域請求的限制。
// 需要 Node.js 18 以上版本(內建 fetch)。

const express = require('express');
const app = express();
const PORT = process.env.PORT || 3001;

// 允許呼叫這個代理的網域。'*' 代表任何網站都能呼叫；
// 如果想限制只有自己的 AMPS 網站能用，把 '*' 換成實際網域，例如 'https://steven74423.github.io'
const ALLOWED_ORIGIN = process.env.ALLOWED_ORIGIN || '*';

app.use((req, res, next) => {
    res.setHeader('Access-Control-Allow-Origin', ALLOWED_ORIGIN);
    res.setHeader('Access-Control-Allow-Methods', 'GET');
    next();
});

// 簡單記憶體快取：同一組機場代碼在效期內直接回傳快取，不重複打上游 API
const CACHE_TTL_MS = 5 * 60 * 1000; // 5 分鐘
let cache = { ids: null, data: null, timestamp: 0 };

app.get('/metar', async (req, res) => {
    const ids = (req.query.ids || '').trim();
    if (!ids) {
        return res.status(400).json({ error: 'missing "ids" query parameter, e.g. /metar?ids=RCTP,RCSS' });
    }

    const now = Date.now();
    if (cache.data && cache.ids === ids && (now - cache.timestamp) < CACHE_TTL_MS) {
        return res.json(cache.data);
    }

    try {
        const upstreamUrl = `https://aviationweather.gov/api/data/metar?ids=${encodeURIComponent(ids)}&format=json`;
        const upstream = await fetch(upstreamUrl);
        if (!upstream.ok) throw new Error('upstream HTTP ' + upstream.status);
        const data = await upstream.json();

        cache = { ids, data, timestamp: now };
        res.json(data);
    } catch (e) {
        console.error('METAR proxy: 抓取上游資料失敗:', e.message);
        res.status(502).json({ error: 'failed to fetch upstream METAR data' });
    }
});

app.listen(PORT, () => {
    console.log(`METAR proxy listening on port ${PORT} (allowed origin: ${ALLOWED_ORIGIN})`);
});
