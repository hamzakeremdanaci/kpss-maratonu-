const ALLOWED_ORIGIN = "https://site-755558ac1aeb46a082b6be91f83dd59e.freebuff.page";

const SECURITY_HEADERS = {
  "X-Content-Type-Options": "nosniff",
  "X-Frame-Options": "DENY",
  "Referrer-Policy": "no-referrer",
  "Content-Security-Policy":
    "default-src 'self'; " +
    "script-src 'self' https://www.gstatic.com https://fonts.googleapis.com https://fonts.gstatic.com; " +
    "style-src 'self' 'unsafe-inline'; " +
    "connect-src 'self' https://*.googleapis.com; " +
    "img-src 'self' data:; " +
    "font-src https://fonts.gstatic.com; " +
    "base-uri 'self'; " +
    "form-action 'self'; " +
    "frame-ancestors 'none';",
  "Permissions-Policy": "geolocation=(), microphone=(), camera=()",
};

function corsHeaders(origin) {
  const allow = origin === ALLOWED_ORIGIN ? origin : ALLOWED_ORIGIN;
  return {
    "Access-Control-Allow-Origin": allow,
    "Access-Control-Allow-Headers": "Content-Type, X-Admin-Pass",
    "Access-Control-Allow-Methods": "GET, POST, DELETE, OPTIONS",
    "Access-Control-Max-Age": "86400",
    ...SECURITY_HEADERS,
  };
}

function json(data, status = 200, origin = "*") {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8", ...corsHeaders(origin) },
  });
}

// Rate limit: daha sıkı
const rateMap = new Map();
function limited(key, max, windowMs) {
  const now = Date.now();
  const rec = rateMap.get(key);
  if (!rec || now - rec.start > windowMs) {
    rateMap.set(key, { start: now, count: 1 });
    return false;
  }
  rec.count += 1;
  return rec.count > max;
}

let dbReady = false;
async function ensureSchema(db) {
  if (dbReady) return;
  const stmts = [
    `CREATE TABLE IF NOT EXISTS results (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      class_name TEXT DEFAULT '',
      score INTEGER DEFAULT 0,
      rank_title TEXT DEFAULT '',
      correct INTEGER DEFAULT 0,
      wrong INTEGER DEFAULT 0,
      accuracy INTEGER DEFAULT 0,
      weak_topics TEXT DEFAULT '',
      streak INTEGER DEFAULT 0,
      badges TEXT DEFAULT '[]',
      date TEXT DEFAULT (datetime('now'))
    )`,
    `CREATE TABLE IF NOT EXISTS questions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      stage INTEGER NOT NULL,
      branch TEXT DEFAULT '',
      topic TEXT DEFAULT '',
      icon TEXT DEFAULT '📘',
      question TEXT NOT NULL,
      options TEXT NOT NULL,
      correct INTEGER NOT NULL,
      explanation TEXT DEFAULT '',
      created_at TEXT DEFAULT (datetime('now'))
    )`,
    `CREATE INDEX IF NOT EXISTS idx_results_score ON results(score DESC)`,
    `CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    )`
  ];
  for (const sql of stmts) {
    await db.prepare(sql).run();
  }
  dbReady = true;
}

let adminPassCache = null;
async function isAdmin(env, request) {
  const pass = request.headers.get("X-Admin-Pass") || "";
  if (!pass) return false;
  if (pass === (env.ADMIN_PASSWORD || "")) return true;
  try {
    if (adminPassCache === null) {
      const row = await env.DB.prepare(`SELECT value FROM settings WHERE key = 'admin_password'`).first();
      adminPassCache = row ? row.value : "";
    }
    return adminPassCache !== "" && pass === adminPassCache;
  } catch (e) {
    return false;
  }
}

async function readBody(request) {
  try { return await request.json(); } catch { return null; }
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const path = url.pathname;
    const origin = request.headers.get("Origin") || "*";

    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: corsHeaders(origin) });
    }

    if (!path.startsWith("/api/")) {
      return env.ASSETS.fetch(request);
    }

    if (!env.DB) {
      return json({ error: "Veritabanı bağlı değil", hasDB: false }, 503, origin);
    }

    const ip = request.headers.get("CF-Connecting-IP") || "unknown";

    try {
      await ensureSchema(env.DB);

      // ---------- SONUÇ KAYDI ----------
      if (path === "/api/results" && request.method === "POST") {
        if (limited("r:" + ip, 5, 60000)) return json({ error: "Çok istek" }, 429, origin);
        const b = await readBody(request);
        if (!b || typeof b.name !== "string" || !b.name.trim()) {
          return json({ error: "Geçersiz veri" }, 400, origin);
        }
        const name = b.name.trim().slice(0, 60);
        const cls = String(b.className || "").trim().slice(0, 40);
        const score = Math.max(0, Math.min(999999, parseInt(b.score) || 0));
        const rank = String(b.rank || "").slice(0, 60);
        const correct = Math.max(0, parseInt(b.correct) || 0);
        const wrong = Math.max(0, parseInt(b.wrong) || 0);
        const accuracy = Math.max(0, Math.min(100, parseInt(b.accuracy) || 0));
        const weak = Array.isArray(b.weakTopics) ? b.weakTopics.join(", ") : String(b.weakTopics || "").slice(0, 2000);
        const streak = Math.max(0, parseInt(b.streak) || 0);
        const badges = JSON.stringify(Array.isArray(b.badges) ? b.badges.slice(0, 50) : []);

        await env.DB.prepare(
          `INSERT INTO results (name, class_name, score, rank_title, correct, wrong, accuracy, weak_topics, streak, badges)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
        ).bind(name, cls, score, rank, correct, wrong, accuracy, weak, streak, badges).run();

        return json({ ok: true }, 200, origin);
      }

      // ---------- TÜM SONUÇ KAYITLARINI SİL (admin) ----------
      if (path === "/api/results" && request.method === "DELETE") {
        if (!(await isAdmin(env, request))) return json({ error: "Yetkisiz" }, 401, origin);
        if (limited("rd:" + ip, 3, 60000)) return json({ error: "Çok istek" }, 429, origin);
        const res = await env.DB.prepare(`DELETE FROM results`).run();
        return json({ ok: true, deleted: res.meta ? res.meta.changes : 0 }, 200, origin);
      }

      // ---------- SIRALAMA (herkese açık, en iyi 10) ----------
      if (path === "/api/leaderboard" && request.method === "GET") {
        const limit = Math.min(50, parseInt(url.searchParams.get("limit")) || 10);
        const res = await env.DB.prepare(
          `SELECT name, class_name, score, rank_title, date FROM results ORDER BY score DESC, date ASC LIMIT ?`
        ).bind(limit).all();
        return json({ rows: res.results || [] }, 200, origin);
      }

      // ---------- SONUÇ LİSTESİ (admin) ----------
      if (path === "/api/results" && request.method === "GET") {
        if (!(await isAdmin(env, request))) return json({ error: "Yetkisiz" }, 401, origin);
        const res = await env.DB.prepare(
          `SELECT id, name, class_name, score, rank_title, correct, wrong, accuracy, weak_topics, streak, date
           FROM results ORDER BY id DESC LIMIT 1000`
        ).all();
        return json({ rows: res.results || [] }, 200, origin);
      }

      // ---------- ÖZEL SORU LİSTESİ ----------
      if (path === "/api/questions" && request.method === "GET") {
        const res = await env.DB.prepare(
          `SELECT id, stage, branch, topic, icon, question, options FROM questions ORDER BY id ASC LIMIT 500`
        ).all();
        const rows = (res.results || []).map(r => ({
          ...r,
          qid: 1000000 + r.id,
          options: JSON.parse(r.options),
          custom: true
        }));
        return json({ rows }, 200, origin);
      }

      // ---------- SORU EKLE (admin) ----------
      if (path === "/api/questions" && request.method === "POST") {
        if (!(await isAdmin(env, request))) return json({ error: "Yetkisiz" }, 401, origin);
        if (limited("q:" + ip, 10, 60000)) return json({ error: "Çok istek" }, 429, origin);
        const b = await readBody(request);
        if (!b || typeof b.question !== "string" || !b.question.trim()) {
          return json({ error: "Soru metni eksik" }, 400, origin);
        }
        if (!Array.isArray(b.options) || b.options.length !== 4 || b.options.some(o => typeof o !== "string" || !o.trim())) {
          return json({ error: "4 şık gerekiyor" }, 400, origin);
        }
        const correct = parseInt(b.correct);
        if (!(correct >= 0 && correct <= 3)) return json({ error: "Doğru şık 0-3 arası olmalı" }, 400, origin);
        const stage = parseInt(b.stage);
        if (!(stage >= 1 && stage <= 4)) return json({ error: "Aşama 1-4 arası olmalı" }, 400, origin);

        await env.DB.prepare(
          `INSERT INTO questions (stage, branch, topic, icon, question, options, correct, explanation)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
        ).bind(
          stage,
          String(b.branch || "Genel").slice(0, 40),
          String(b.topic || "Genel").slice(0, 60),
          String(b.icon || "📘").slice(0, 8),
          b.question.trim().slice(0, 700),
          JSON.stringify(b.options.map(o => o.trim().slice(0, 300))),
          correct,
          String(b.explanation || "").slice(0, 1000)
        ).run();

        return json({ ok: true }, 200, origin);
      }

      // ---------- SORU SİL (admin) ----------
      if (path === "/api/questions" && request.method === "DELETE") {
        if (!(await isAdmin(env, request))) return json({ error: "Yetkisiz" }, 401, origin);
        if (limited("qd:" + ip, 10, 60000)) return json({ error: "Çok istek" }, 429, origin);
        const b = await readBody(request);
        const id = parseInt(b && b.id);
        if (!(id > 0)) return json({ error: "Geçersiz soru" }, 400, origin);
        const res = await env.DB.prepare(`DELETE FROM questions WHERE id = ?`).bind(id).run();
        if (!res.meta || !res.meta.changes) return json({ error: "Soru bulunamadı" }, 404, origin);
        return json({ ok: true }, 200, origin);
      }

      // ---------- CEVAP DOĞRULA ----------
      if (path === "/api/check" && request.method === "POST") {
        if (limited("c:" + ip, 30, 60000)) return json({ error: "Çok istek" }, 429, origin);
        const b = await readBody(request);
        const qid = parseInt(b && b.qid);
        const choice = parseInt(b && b.choice);
        if (!(qid >= 1000001) || !(choice >= 0 && choice <= 3)) return json({ error: "Geçersiz" }, 400, origin);

        const row = await env.DB.prepare(
          `SELECT correct, explanation, question, options FROM questions WHERE id = ?`
        ).bind(qid - 1000000).first();
        if (!row) return json({ error: "Soru bulunamadı" }, 404, origin);

        return json({
          isCorrect: row.correct === choice,
          correctIndex: row.correct,
          explanation: row.explanation
        }, 200, origin);
      }

      // ---------- ANALİZ (admin) ----------
      if (path === "/api/analysis" && request.method === "GET") {
        if (!(await isAdmin(env, request))) return json({ error: "Yetkisiz" }, 401, origin);
        const res = await env.DB.prepare(`SELECT weak_topics FROM results`).all();
        const counts = {};
        for (const row of (res.results || [])) {
          for (const t of String(row.weak_topics || "").split(",")) {
            const topic = t.trim();
            if (topic) counts[topic] = (counts[topic] || 0) + 1;
          }
        }
        const sorted = Object.entries(counts)
          .map(([topic, count]) => ({ topic, count }))
          .sort((a, b) => b.count - a.count)
          .slice(0, 30);
        return json({ topics: sorted }, 200, origin);
      }

      // ---------- ADMIN ŞİFRE DOĞRULA ----------
      if (path === "/api/admin/verify" && request.method === "POST") {
        if (limited("a:" + ip, 10, 60000)) return json({ error: "Çok istek" }, 429, origin);
        return json({ ok: await isAdmin(env, request) }, 200, origin);
      }

      // ---------- ADMIN ŞİFRE DEĞİŞTİR ----------
      if (path === "/api/admin/password" && request.method === "POST") {
        if (!(await isAdmin(env, request))) return json({ error: "Mevcut şifre hatalı" }, 401, origin);
        const b = await readBody(request);
        const np = String((b && b.newPass) || "").trim();
        if (np.length < 12) return json({ error: "En az 12 karakter gerekli" }, 400, origin);
        await env.DB.prepare(
          `INSERT INTO settings (key, value) VALUES ('admin_password', ?)
           ON CONFLICT(key) DO UPDATE SET value = excluded.value`
        ).bind(np).run();
        adminPassCache = np;
        return json({ ok: true }, 200, origin);
      }

      return json({ error: "Bulunamadı" }, 404, origin);
    } catch (err) {
      // Stack trace güvenlik nedeniyle dışarı çıkarılamaz
      return json({ error: "Sunucu hatası" }, 500, origin);
    }
  }
};
