/**
 * Worker puente: FastAPI local -> Cloudflare D1.
 * La UI Electron sigue hablando con Python; Python consulta D1 a traves de este Worker.
 */

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "Authorization, Content-Type",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
};

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json", ...CORS },
  });
}

function isAuthorized(request, env) {
  const header = request.headers.get("Authorization") || "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : "";
  return Boolean(env.WORKER_API_KEY) && token === env.WORKER_API_KEY;
}

function isRead(sql) {
  return /^\s*(SELECT|WITH|PRAGMA|EXPLAIN)/i.test(sql);
}

async function runStatement(db, sql, params = []) {
  const stmt = params.length ? db.prepare(sql).bind(...params) : db.prepare(sql);
  if (isRead(sql)) {
    return await stmt.all();
  }
  return await stmt.run();
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: CORS });
    }

    if (request.method === "GET" && url.pathname === "/health") {
      return json({ status: "ok", service: "tintoreria-d1", database: "tintoreria" });
    }

    if (!isAuthorized(request, env)) {
      return json({ error: "No autorizado" }, 401);
    }

    if (request.method === "POST" && url.pathname === "/query") {
      let body;
      try {
        body = await request.json();
      } catch {
        return json({ error: "JSON invalido" }, 400);
      }

      const sql = String(body.sql || "").trim();
      const params = Array.isArray(body.params) ? body.params : [];
      if (!sql) return json({ error: "sql requerido" }, 400);

      try {
        const result = await runStatement(env.DB, sql, params);
        return json({
          success: result.success !== false,
          results: result.results || [],
          meta: result.meta || {},
        });
      } catch (err) {
        return json({ error: String(err.message || err) }, 400);
      }
    }

    if (request.method === "POST" && url.pathname === "/batch") {
      let body;
      try {
        body = await request.json();
      } catch {
        return json({ error: "JSON invalido" }, 400);
      }

      const statements = Array.isArray(body.statements) ? body.statements : [];
      if (!statements.length) return json({ error: "statements requerido" }, 400);

      try {
        const prepared = statements.map((item) => {
          const sql = String(item.sql || "").trim();
          const params = Array.isArray(item.params) ? item.params : [];
          return params.length ? env.DB.prepare(sql).bind(...params) : env.DB.prepare(sql);
        });
        const results = await env.DB.batch(prepared);
        return json({
          success: true,
          results: results.map((result) => ({
            success: result.success !== false,
            results: result.results || [],
            meta: result.meta || {},
          })),
        });
      } catch (err) {
        return json({ error: String(err.message || err) }, 400);
      }
    }

    return json({ error: "No encontrado" }, 404);
  },
};
