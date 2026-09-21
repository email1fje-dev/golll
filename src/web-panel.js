const http = require('http');
const crypto = require('crypto');

const sessions = new Map();
const SESSION_TTL = 1000 * 60 * 60 * 12;

function esc(value) {
  return String(value).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
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

function cookie(name, value, options = {}) {
  let out = name + '=' + encodeURIComponent(value) + '; Path=/';
  if (options.maxAge !== undefined) out += '; Max-Age=' + options.maxAge;
  if (options.httpOnly) out += '; HttpOnly';
  if (options.sameSite) out += '; SameSite=' + options.sameSite;
  if (options.secure) out += '; Secure';
  return out;
}

function htmlPage(title, body) {
  return `<!doctype html>
<html lang="en"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(title)}</title>
<style>
:root{color-scheme:dark;--bg:#08080b;--panel:#11131a;--panel2:#171923;--line:#282c38;--text:#f5f5f7;--muted:#a1a1aa;--accent:#8b5cf6;--accent2:#6d28d9;--good:#34d399;--bad:#fb7185}
*{box-sizing:border-box}body{margin:0;background:radial-gradient(circle at 20% 0,#241650 0,transparent 34%),var(--bg);color:var(--text);font-family:Inter,system-ui,-apple-system,Segoe UI,sans-serif}
a{color:inherit;text-decoration:none}.wrap{max-width:1180px;margin:auto;padding:28px 20px}.top{display:flex;justify-content:space-between;align-items:center;gap:16px;margin-bottom:28px}.brand{font-size:25px;font-weight:850}.brand span{color:#a78bfa}.muted{color:var(--muted)}.small{font-size:12px}.grid{display:grid;grid-template-columns:repeat(4,1fr);gap:14px}.card{background:rgba(17,19,26,.9);border:1px solid var(--line);border-radius:18px;padding:18px;box-shadow:0 14px 45px #0004}.stat{font-size:28px;font-weight:850;margin-top:8px}.label{font-size:13px;color:var(--muted)}.layout{display:grid;grid-template-columns:1.25fr .75fr;gap:16px;margin-top:16px}.guild{display:flex;align-items:center;gap:12px;padding:14px;border:1px solid var(--line);border-radius:14px;margin-top:10px;background:var(--panel2)}.avatar{width:42px;height:42px;border-radius:12px;object-fit:cover;background:#272938}.dot{width:10px;height:10px;border-radius:50%;background:var(--good);box-shadow:0 0 12px var(--good)}.btn{display:inline-block;border:0;border-radius:11px;padding:11px 15px;background:var(--accent);color:white;font-weight:750;cursor:pointer}.btn:hover{background:var(--accent2)}.btn.ghost{background:#222631}.btn.discord{background:#5865f2}.btn.danger{background:#be123c}.login{max-width:460px;margin:12vh auto}.error{background:#3b1218;border:1px solid #7f1d1d;padding:12px;border-radius:10px;color:#fecaca;margin-bottom:12px}.hero{text-align:center;padding:34px 10px}.hero .logo{font-size:48px;font-weight:900}.hero p{line-height:1.6}.actions{display:flex;gap:10px;flex-wrap:wrap}.empty{padding:20px;border:1px dashed var(--line);border-radius:14px;color:var(--muted)}
@media(max-width:850px){.grid{grid-template-columns:repeat(2,1fr)}.layout{grid-template-columns:1fr}}@media(max-width:520px){.grid{grid-template-columns:1fr}.top{align-items:flex-start;flex-direction:column}}
</style></head><body>${body}</body></html>`;
}

function discordConfig() {
  return {
    clientId: process.env.DISCORD_CLIENT_ID || '',
    clientSecret: process.env.DISCORD_CLIENT_SECRET || '',
    redirectUri: process.env.PANEL_REDIRECT_URI || ''
  };
}

function oauthConfigured() {
  const c = discordConfig();
  return Boolean(c.clientId && c.clientSecret && c.redirectUri);
}

function oauthUrl(state) {
  const c = discordConfig();
  const params = new URLSearchParams({
    client_id: c.clientId,
    response_type: 'code',
    redirect_uri: c.redirectUri,
    scope: 'identify guilds',
    state
  });
  return 'https://discord.com/oauth2/authorize?' + params.toString();
}

function httpRequest(url, options = {}, body = null) {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const req = require(u.protocol === 'https:' ? 'https' : 'http').request(u, options, res => {
      let data = '';
      res.setEncoding('utf8');
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        let parsed = data;
        try { parsed = JSON.parse(data); } catch {}
        if (res.statusCode < 200 || res.statusCode >= 300) {
          const err = new Error('HTTP ' + res.statusCode);
          err.statusCode = res.statusCode;
          err.body = parsed;
          return reject(err);
        }
        resolve(parsed);
      });
    });
    req.on('error', reject);
    if (body) req.write(body);
    req.end();
  });
}

async function exchangeCode(code) {
  const c = discordConfig();
  const body = new URLSearchParams({
    client_id: c.clientId,
    client_secret: c.clientSecret,
    grant_type: 'authorization_code',
    code,
    redirect_uri: c.redirectUri
  }).toString();
  return httpRequest('https://discord.com/api/oauth2/token', {
    method: 'POST',
    headers: {'Content-Type':'application/x-www-form-urlencoded','Content-Length':Buffer.byteLength(body)}
  }, body);
}

async function discordGet(path, accessToken) {
  return httpRequest('https://discord.com/api/v10' + path, {
    method: 'GET',
    headers: {Authorization: 'Bearer ' + accessToken}
  });
}

function sessionFor(req) {
  const token = parseCookies(req).goll_session;
  const session = token ? sessions.get(token) : null;
  if (!session) return null;
  if (Date.now() - session.createdAt > SESSION_TTL) {
    sessions.delete(token);
    return null;
  }
  return {token, ...session};
}

function ownerGuilds(session, client) {
  return session.guilds
    .filter(g => g.owner === true)
    .map(g => {
      const botGuild = client.guilds.cache.get(g.id);
      if (!botGuild) return null;
      return {oauth: g, bot: botGuild};
    })
    .filter(Boolean);
}

function loginPage(error = '') {
  if (!oauthConfigured()) {
    return htmlPage('Goll Owner Panel', `<main class="wrap login"><div class="card hero">
      <div class="logo">Goll</div><h2>Owner Panel</h2>
      <p class="muted">Discord OAuth is not configured yet.</p>
      <div class="error">Set DISCORD_CLIENT_ID, DISCORD_CLIENT_SECRET and PANEL_REDIRECT_URI in Railway Variables.</div>
    </div></main>`);
  }
  return htmlPage('Goll Owner Panel', `<main class="wrap login"><div class="card hero">
    <div class="logo">Goll</div><h2>Owner Control Panel</h2>
    <p class="muted">Sign in with Discord. Only servers you actually own and where Goll is installed will appear.</p>
    ${error ? '<div class="error">' + esc(error) + '</div>' : ''}
    <a class="btn discord" href="/auth/discord">Continue with Discord</a>
    <p class="muted small">Goll only uses your Discord identity and server list to verify ownership.</p>
  </div></main>`);
}

function dashboardPage(session, client) {
  const owned = ownerGuilds(session, client);
  const guildHtml = owned.length ? owned.map(({oauth:g,bot}) => {
    const icon = g.icon ? `https://cdn.discordapp.com/icons/${g.id}/${g.icon}.png?size=96` : '';
    return `<div class="guild">
      ${icon ? `<img class="avatar" src="${icon}" alt="">` : '<div class="avatar"></div>'}
      <div style="flex:1"><b>${esc(g.name)}</b><div class="muted small">${g.id} · ${bot.memberCount ?? '?'} members · ${bot.channels.cache.size} channels</div></div>
      <a class="btn" href="/server/${encodeURIComponent(g.id)}">Manage</a>
    </div>`;
  }).join('') : '<div class="empty">No server was found where you are the owner and Goll is installed.</div>';

  const totalMembers = owned.reduce((n,x) => n + (x.bot.memberCount || 0), 0);
  return htmlPage('Goll Owner Panel', `<main class="wrap">
    <header class="top"><div><div class="brand">Goll <span>Owner Panel</span></div><div class="muted">Signed in as ${esc(session.user.username)} · ${esc(session.user.id)}</div></div><a class="btn ghost" href="/logout">Log out</a></header>
    <section class="grid">
      <div class="card"><div class="label">Your servers</div><div class="stat">${owned.length}</div></div>
      <div class="card"><div class="label">Members</div><div class="stat">${totalMembers.toLocaleString()}</div></div>
      <div class="card"><div class="label">Bot status</div><div class="stat">${client.isReady() ? 'ONLINE' : 'OFFLINE'}</div></div>
      <div class="card"><div class="label">Database</div><div class="stat" style="font-size:20px">${process.env.DATABASE_URL ? 'CONFIGURED' : 'MISSING'}</div></div>
    </section>
    <section class="card" style="margin-top:16px"><h2 style="margin-top:0">Servers you own</h2>${guildHtml}</section>
  </main>`);
}

function serverPage(session, client, guildId) {
  const entry = ownerGuilds(session, client).find(x => x.oauth.id === guildId);
  if (!entry) return null;
  const {oauth:g,bot} = entry;
  const roles = [...bot.roles.cache.values()].filter(r => r.id !== bot.id).length;
  const channels = bot.channels.cache;
  return htmlPage(g.name + ' · Goll', `<main class="wrap">
    <header class="top">
      <div><div class="brand">Goll <span>/ ${esc(g.name)}</span></div><div class="muted">Owner-only server dashboard</div></div>
      <div class="actions"><a class="btn ghost" href="/">Servers</a><a class="btn ghost" href="/logout">Log out</a></div>
    </header>
    <section class="grid">
      <div class="card"><div class="label">Members</div><div class="stat">${(bot.memberCount || 0).toLocaleString()}</div></div>
      <div class="card"><div class="label">Channels</div><div class="stat">${channels.size}</div></div>
      <div class="card"><div class="label">Roles</div><div class="stat">${roles}</div></div>
      <div class="card"><div class="label">Bot</div><div class="stat">${client.isReady() ? 'ONLINE' : 'OFFLINE'}</div></div>
    </section>
    <section class="layout">
      <div class="card"><h2 style="margin-top:0">Server controls</h2>
        <div class="actions">
          <button class="btn" disabled>Setup / Repair</button>
          <button class="btn ghost" disabled>Tickets</button>
          <button class="btn ghost" disabled>Applications</button>
          <button class="btn ghost" disabled>Giveaways</button>
        </div>
        <p class="muted small" style="margin-top:16px">The owner authentication and server isolation are live. Management actions are the next control layer.</p>
      </div>
      <div class="card"><h2 style="margin-top:0">Server</h2>
        <p><span class="label">Name</span><br><b>${esc(g.name)}</b></p>
        <p><span class="label">Server ID</span><br><code>${esc(g.id)}</code></p>
        <p><span class="label">Owner</span><br><b>${esc(session.user.username)}</b></p>
      </div>
    </section>
  </main>`);
}

function startWebPanel(client) {
  const panelPassword = process.env.PANEL_PASSWORD;
  const host = process.env.HOST || '0.0.0.0';

  const handler = async (req, res) => {
    try {
      if (req.url === '/health') {
        res.writeHead(200, {'Content-Type':'application/json'});
        return res.end(JSON.stringify({ok:true,bot:client.isReady(),oauth:oauthConfigured()}));
      }

      if (req.url === '/auth/discord') {
        if (!oauthConfigured()) {
          res.writeHead(503, {'Content-Type':'text/plain'});
          return res.end('Discord OAuth is not configured.');
        }
        const state = crypto.randomBytes(24).toString('hex');
        const stateToken = crypto.randomBytes(24).toString('hex');
        sessions.set('state:' + stateToken, {state, createdAt:Date.now()});
        res.writeHead(302, {
          Location: oauthUrl(stateToken),
          'Set-Cookie': cookie('goll_oauth_state', stateToken, {httpOnly:true,sameSite:'Lax',secure:true,maxAge:600})
        });
        return res.end();
      }

      if (req.url.startsWith('/auth/callback')) {
        const url = new URL(req.url, 'http://localhost');
        const code = url.searchParams.get('code');
        const returnedState = url.searchParams.get('state');
        const stateCookie = parseCookies(req).goll_oauth_state;
        const stateSession = stateCookie ? sessions.get('state:' + stateCookie) : null;
        if (!code || !returnedState || !stateCookie || !stateSession || returnedState !== stateCookie) {
          res.writeHead(400, {'Content-Type':'text/plain'});
          return res.end('Invalid OAuth state.');
        }
        sessions.delete('state:' + stateCookie);

        const token = await exchangeCode(code);
        const [user, guilds] = await Promise.all([
          discordGet('/users/@me', token.access_token),
          discordGet('/users/@me/guilds', token.access_token)
        ]);

        const sessionToken = crypto.randomBytes(32).toString('hex');
        sessions.set(sessionToken, {
          createdAt:Date.now(),
          user,
          guilds,
          accessToken:token.access_token
        });

        res.writeHead(302, {
          Location:'/',
          'Set-Cookie':cookie('goll_session',sessionToken,{httpOnly:true,sameSite:'Lax',secure:true,maxAge:43200})
        });
        return res.end();
      }

      if (req.url === '/logout') {
        const token = parseCookies(req).goll_session;
        if (token) sessions.delete(token);
        res.writeHead(302, {
          Location:'/login',
          'Set-Cookie':cookie('goll_session','',{httpOnly:true,sameSite:'Lax',secure:true,maxAge:0})
        });
        return res.end();
      }

      if (req.url === '/login') {
        res.writeHead(200, {'Content-Type':'text/html; charset=utf-8'});
        return res.end(loginPage());
      }

      const session = sessionFor(req);
      if (!session) {
        res.writeHead(302, {'Location':'/login'});
        return res.end();
      }

      if (req.url === '/') {
        res.writeHead(200, {'Content-Type':'text/html; charset=utf-8'});
        return res.end(dashboardPage(session,client));
      }

      const serverMatch = req.url.match(/^\/server\/([^/?#]+)$/);
      if (serverMatch) {
        const guildId = decodeURIComponent(serverMatch[1]);
        const page = serverPage(session,client,guildId);
        if (!page) {
          res.writeHead(403, {'Content-Type':'text/html; charset=utf-8'});
          return res.end(htmlPage('Forbidden','<main class="wrap"><div class="card"><h2>Access denied</h2><p class="muted">You are not the owner of this server, or Goll is not installed there.</p><a class="btn" href="/">Back</a></div></main>'));
        }
        res.writeHead(200, {'Content-Type':'text/html; charset=utf-8'});
        return res.end(page);
      }

      if (req.url === '/api/status') {
        const owned = ownerGuilds(session,client);
        res.writeHead(200, {'Content-Type':'application/json'});
        return res.end(JSON.stringify({ok:true,user:{id:session.user.id,username:session.user.username},servers:owned.map(x=>({id:x.bot.id,name:x.bot.name,members:x.bot.memberCount||0}))}));
      }

      res.writeHead(404, {'Content-Type':'text/plain'});
      res.end('Not found');
    } catch (e) {
      console.error('Web panel:',e);
      res.writeHead(500, {'Content-Type':'text/plain'});
      res.end('Internal server error');
    }
  };

  const listen = port => {
    const server = http.createServer(handler);
    server.listen(port,host,() => console.log('Goll owner panel listening on port ' + port));
    return server;
  };

  const configuredPort = Number(process.env.PANEL_PORT || 2020);
  const railwayPort = Number(process.env.PORT || 0);
  const servers = [listen(configuredPort)];
  if (railwayPort && railwayPort !== configuredPort) servers.push(listen(railwayPort));

  if (panelPassword) console.log('PANEL_PASSWORD is set, but Discord OAuth is the primary owner login.');
  return servers;
}

module.exports = { startWebPanel };
