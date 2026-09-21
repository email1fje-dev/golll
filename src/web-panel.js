const http = require('http');
const crypto = require('crypto');

const sessions = new Map();
const SESSION_TTL = 1000 * 60 * 60 * 12;

function cookie(name, value, options = {}) {
  let out = name + '=' + encodeURIComponent(value);
  if (options.maxAge !== undefined) out += '; Max-Age=' + options.maxAge;
  out += '; Path=/';
  if (options.httpOnly) out += '; HttpOnly';
  if (options.sameSite) out += '; SameSite=' + options.sameSite;
  if (options.secure) out += '; Secure';
  return out;
}

function parseCookies(req) {
  const raw = req.headers.cookie || '';
  const result = {};
  for (const part of raw.split(';')) {
    const i = part.indexOf('=');
    if (i < 0) continue;
    result[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return result;
}

function htmlPage(title, body, extra = '') {
  return `<!doctype html>
<html lang="en"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${title}</title>
<style>
:root{color-scheme:dark;--bg:#09090b;--panel:#111318;--panel2:#171922;--line:#272b36;--text:#f4f4f5;--muted:#a1a1aa;--accent:#8b5cf6;--accent2:#6d28d9;--good:#34d399}
*{box-sizing:border-box}body{margin:0;background:radial-gradient(circle at 20% 0,#21154a 0,transparent 35%),var(--bg);color:var(--text);font-family:Inter,system-ui,-apple-system,Segoe UI,sans-serif}
a{color:inherit;text-decoration:none}.wrap{max-width:1180px;margin:auto;padding:28px 20px}.top{display:flex;justify-content:space-between;align-items:center;gap:16px;margin-bottom:28px}.brand{font-size:24px;font-weight:800}.brand span{color:#a78bfa}.muted{color:var(--muted)}.grid{display:grid;grid-template-columns:repeat(4,1fr);gap:14px}.card{background:rgba(17,19,24,.88);border:1px solid var(--line);border-radius:18px;padding:18px;box-shadow:0 12px 40px #0003}.stat{font-size:28px;font-weight:800;margin-top:8px}.label{font-size:13px;color:var(--muted)}.layout{display:grid;grid-template-columns:1.3fr .7fr;gap:16px;margin-top:16px}.guild{display:flex;align-items:center;gap:12px;padding:14px;border:1px solid var(--line);border-radius:14px;margin-top:10px;background:var(--panel2)}.dot{width:10px;height:10px;border-radius:50%;background:var(--good);box-shadow:0 0 12px var(--good)}.btn{display:inline-block;border:0;border-radius:10px;padding:10px 14px;background:var(--accent);color:white;font-weight:700;cursor:pointer}.btn:hover{background:var(--accent2)}.btn.ghost{background:#222631}.logout{color:#c4b5fd}.login{max-width:420px;margin:12vh auto}.input{width:100%;padding:13px 14px;border:1px solid var(--line);border-radius:11px;background:#0c0d11;color:white;outline:none;margin:8px 0 14px}.input:focus{border-color:#8b5cf6}.error{background:#3b1218;border:1px solid #7f1d1d;padding:12px;border-radius:10px;color:#fecaca;margin-bottom:12px}.small{font-size:12px}.list{margin:0;padding-left:20px;line-height:1.8}@media(max-width:850px){.grid{grid-template-columns:repeat(2,1fr)}.layout{grid-template-columns:1fr}}@media(max-width:520px){.grid{grid-template-columns:1fr}.top{align-items:flex-start;flex-direction:column}}
${extra}</style></head><body>${body}</body></html>`;
}

function loginPage(error = '') {
  return htmlPage('Goll Panel', `<main class="wrap login">
  <div class="card">
    <div class="brand">Goll <span>Control Panel</span></div>
    <p class="muted">Private server management panel.</p>
    ${error ? '<div class="error">' + error + '</div>' : ''}
    <form method="POST" action="/login">
      <label class="label">Panel password</label>
      <input class="input" name="password" type="password" autocomplete="current-password" required>
      <button class="btn" type="submit">Sign in</button>
    </form>
    <p class="muted small">This panel is private and protected by a server-side password.</p>
  </div>
</main>`);
}

function dashboardPage(client) {
  const guilds = [...client.guilds.cache.values()];
  const users = guilds.reduce((n, g) => n + (g.memberCount || 0), 0);
  const channels = guilds.reduce((n, g) => n + g.channels.cache.size, 0);
  const roles = guilds.reduce((n, g) => n + g.roles.cache.size, 0);
  const guildHtml = guilds.length ? guilds.map(g => `
    <div class="guild">
      <div class="dot"></div>
      <div style="flex:1"><b>${escapeHtml(g.name)}</b><div class="muted small">${g.id} · ${g.memberCount ?? '?'} members</div></div>
      <span class="muted small">${g.channels.cache.size} channels</span>
    </div>`).join('') : '<p class="muted">The bot is not connected to any server yet.</p>';

  return htmlPage('Goll Control Panel', `<main class="wrap">
    <header class="top">
      <div><div class="brand">Goll <span>Control Panel</span></div><div class="muted">Private management dashboard</div></div>
      <a class="btn ghost" href="/logout">Log out</a>
    </header>
    <section class="grid">
      <div class="card"><div class="label">Bot status</div><div class="stat">ONLINE</div><div class="muted small">${escapeHtml(client.user?.tag || 'Connecting...')}</div></div>
      <div class="card"><div class="label">Servers</div><div class="stat">${guilds.length}</div></div>
      <div class="card"><div class="label">Members</div><div class="stat">${users.toLocaleString()}</div></div>
      <div class="card"><div class="label">Channels</div><div class="stat">${channels}</div></div>
    </section>
    <section class="layout">
      <div class="card"><h2 style="margin-top:0">Your servers</h2>${guildHtml}</div>
      <div class="card"><h2 style="margin-top:0">System</h2>
        <p><span class="label">Node</span><br><b>${process.version}</b></p>
        <p><span class="label">Roles cached</span><br><b>${roles}</b></p>
        <p><span class="label">Database</span><br><b>${process.env.DATABASE_URL ? 'Connected/configured' : 'Not configured'}</b></p>
        <p><span class="label">TTS</span><br><b>${process.env.TTS_TOKEN ? 'Configured' : 'Not configured'}</b></p>
      </div>
    </section>
  </main>`);
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
}

function startWebPanel(client) {
  const password = process.env.PANEL_PASSWORD;
  const port = Number(process.env.PORT || 3000);
  const host = process.env.HOST || '0.0.0.0';

  const server = http.createServer(async (req, res) => {
    try {
      if (req.url === '/health') {
        res.writeHead(200, {'Content-Type':'application/json'});
        return res.end(JSON.stringify({ok:true, bot:client.isReady()}));
      }

      if (!password) {
        res.writeHead(503, {'Content-Type':'text/html; charset=utf-8'});
        return res.end(htmlPage('Goll Panel', '<main class="wrap"><div class="card"><h2>Panel password is not configured</h2><p class="muted">Set <code>PANEL_PASSWORD</code> in Railway Variables, then redeploy.</p></div></main>'));
      }

      if (req.method === 'POST' && req.url === '/login') {
        let data = '';
        req.on('data', chunk => { data += chunk; if (data.length > 10000) req.destroy(); });
        req.on('end', () => {
          const form = new URLSearchParams(data);
          const supplied = form.get('password') || '';
          const ok = supplied.length === password.length &&
            crypto.timingSafeEqual(Buffer.from(supplied), Buffer.from(password));
          if (!ok) {
            res.writeHead(401, {'Content-Type':'text/html; charset=utf-8'});
            return res.end(loginPage('Incorrect password.'));
          }
          const token = crypto.randomBytes(32).toString('hex');
          sessions.set(token, Date.now());
          res.writeHead(302, {'Location':'/', 'Set-Cookie':cookie('goll_session',token,{httpOnly:true,sameSite:'Lax',secure:true,maxAge:43200})});
          res.end();
        });
        return;
      }

      if (req.url === '/login' && req.method === 'GET') {
        res.writeHead(200, {'Content-Type':'text/html; charset=utf-8'});
        return res.end(loginPage());
      }

      if (req.url === '/logout') {
        const token = parseCookies(req).goll_session;
        if (token) sessions.delete(token);
        res.writeHead(302, {'Location':'/login','Set-Cookie':cookie('goll_session','',{httpOnly:true,sameSite:'Lax',secure:true,maxAge:0})});
        return res.end();
      }

      const token = parseCookies(req).goll_session;
      const created = token && sessions.get(token);
      if (!created || Date.now() - created > SESSION_TTL) {
        if (token) sessions.delete(token);
        res.writeHead(302, {'Location':'/login'});
        return res.end();
      }

      if (req.url === '/api/status') {
        res.writeHead(200, {'Content-Type':'application/json'});
        return res.end(JSON.stringify({ok:true,ready:client.isReady(),user:client.user?.tag||null,servers:client.guilds.cache.size}));
      }

      if (req.url === '/') {
        res.writeHead(200, {'Content-Type':'text/html; charset=utf-8'});
        return res.end(dashboardPage(client));
      }

      res.writeHead(404, {'Content-Type':'text/plain'});
      res.end('Not found');
    } catch (e) {
      console.error('Web panel:', e);
      res.writeHead(500, {'Content-Type':'text/plain'});
      res.end('Internal server error');
    }
  });

  server.listen(port, host, () => console.log('Goll web panel listening on port ' + port));
  return server;
}

module.exports = { startWebPanel };
