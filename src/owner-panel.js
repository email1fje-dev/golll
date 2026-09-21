const http=require('http');
const crypto=require('crypto');
const {EmbedBuilder}=require('discord.js');

const sessions=new Map();
const TTL=12*60*60*1000;

function esc(v){return String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));}
function cookies(req){const out={};for(const p of (req.headers.cookie||'').split(';')){const i=p.indexOf('=');if(i>0)out[p.slice(0,i).trim()]=decodeURIComponent(p.slice(i+1));}return out;}
function cookie(n,v,max){return n+'='+encodeURIComponent(v)+'; Path=/; Max-Age='+max+'; HttpOnly; Secure; SameSite=Lax';}
function page(title,body){
return '<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>'+esc(title)+'</title><style>'+
':root{color-scheme:dark}*{box-sizing:border-box}body{margin:0;background:#07080c;color:#f5f5f7;font-family:Inter,system-ui,sans-serif}a{color:inherit;text-decoration:none}.wrap{max-width:1250px;margin:auto;padding:26px 18px}.top{display:flex;justify-content:space-between;gap:15px;align-items:center;margin-bottom:18px}.brand{font-size:27px;font-weight:900}.brand span{color:#8b5cf6}.muted{color:#a1a1aa}.small{font-size:12px}.grid{display:grid;grid-template-columns:repeat(4,1fr);gap:12px}.layout{display:grid;grid-template-columns:1fr 1fr;gap:14px}.card{background:#11131a;border:1px solid #292d38;border-radius:16px;padding:18px;margin-top:14px}.stat{font-size:27px;font-weight:900;margin-top:5px}.btn{display:inline-block;border:0;border-radius:10px;padding:10px 14px;background:#7c3aed;color:#fff;font-weight:800;cursor:pointer}.btn.green{background:#15803d}.btn.red{background:#be123c}.btn.gray{background:#252936}.btn.yellow{background:#a16207}.actions{display:flex;gap:8px;flex-wrap:wrap}.input,select,textarea{width:100%;padding:11px;border:1px solid #292d38;border-radius:10px;background:#0b0c10;color:#fff;margin:5px 0 10px}label{display:block;margin:8px 0}table{width:100%;border-collapse:collapse;overflow:auto}th,td{text-align:left;padding:9px;border-bottom:1px solid #292d38;vertical-align:top}th{color:#a1a1aa;font-size:12px}.server{display:flex;justify-content:space-between;align-items:center;gap:15px;padding:16px;border:1px solid #292d38;border-radius:14px;margin-top:10px}.notice{padding:12px 14px;border-radius:12px;background:#171923;border:1px solid #292d38}@media(max-width:850px){.grid,.layout{grid-template-columns:1fr 1fr}}@media(max-width:600px){.grid,.layout{grid-template-columns:1fr}.top{align-items:flex-start;flex-direction:column}.server{align-items:flex-start;flex-direction:column}table{display:block;overflow-x:auto;white-space:nowrap}}</style></head><body>'+body+'</body></html>';
}
function cfg(){return{id:process.env.DISCORD_CLIENT_ID,secret:process.env.DISCORD_CLIENT_SECRET,redirect:process.env.PANEL_REDIRECT_URI};}
function ready(){const c=cfg();return!!(c.id&&c.secret&&c.redirect);}
function oauth(state){const c=cfg();const p=new URLSearchParams({client_id:c.id,response_type:'code',redirect_uri:c.redirect,scope:'identify guilds',state});return'https://discord.com/oauth2/authorize?'+p;}
function request(url,opts,body){return new Promise((resolve,reject)=>{const u=new URL(url),mod=require(u.protocol==='https:'?'https':'http');const r=mod.request(u,opts,res=>{let d='';res.on('data',x=>d+=x);res.on('end',()=>{let x=d;try{x=JSON.parse(d)}catch{}if(res.statusCode<200||res.statusCode>=300){const e=new Error('HTTP '+res.statusCode);e.body=x;return reject(e)}resolve(x)})});r.on('error',reject);if(body)r.write(body);r.end()});}
async function token(code){const c=cfg();const b=new URLSearchParams({client_id:c.id,client_secret:c.secret,grant_type:'authorization_code',code,redirect_uri:c.redirect}).toString();return request('https://discord.com/api/oauth2/token',{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded','Content-Length':Buffer.byteLength(b)}},b);}
async function dget(path,t){return request('https://discord.com/api/v10'+path,{headers:{Authorization:'Bearer '+t}});}
function session(req){const id=cookies(req).goll_owner,s=id&&sessions.get(id);if(!s)return null;if(Date.now()-s.at>TTL){sessions.delete(id);return null}return s;}
function owned(s,client,id){const x=s.guilds.find(g=>g.id===id&&g.owner===true);return x?client.guilds.cache.get(id):null;}
function parseBody(req){return new Promise((resolve,reject)=>{let d='';req.on('data',x=>{d+=x;if(d.length>50000)req.destroy()});req.on('end',()=>resolve(new URLSearchParams(d)));req.on('error',reject)});}
function hidden(s){return'<input type="hidden" name="_csrf" value="'+esc(s.csrf)+'">';}
function ok(res,gid,msg){res.writeHead(303,{Location:'/server/'+encodeURIComponent(gid)+'?msg='+encodeURIComponent(msg)});res.end();}

async function serverView(s,client,gid,msg){
const g=owned(s,client,gid);
if(!g)return page('Forbidden','<main class="wrap"><div class="card"><h2>Access denied</h2><a class="btn gray" href="/">Back</a></div></main>');
const q=client.goll&&client.goll.query;
let am={anti_spam:true,anti_links:true,anti_caps:true},tickets=[],apps=[],staff=[],giveaways=[];
if(q){
am=(await q('SELECT anti_spam,anti_links,anti_caps FROM automod_settings WHERE guild_id=$1',[gid])).rows[0]||am;
tickets=(await q('SELECT channel_id,type,claimed_by,closed,created_at FROM tickets WHERE guild_id=$1 ORDER BY created_at DESC LIMIT 20',[gid])).rows;
apps=(await q('SELECT id,user_id,status,availability,created_at FROM applications WHERE guild_id=$1 ORDER BY created_at DESC LIMIT 20',[gid])).rows;
staff=(await q('SELECT user_id,active,loa_until,loa_reason,updated_at FROM staff_status WHERE guild_id=$1 ORDER BY updated_at DESC LIMIT 20',[gid])).rows;
giveaways=(await q('SELECT message_id,prize,status,ends_at,winner_id FROM giveaways WHERE guild_id=$1 ORDER BY ends_at DESC LIMIT 10',[gid])).rows;
}
const row=x=>x.length?x:'<tr><td colspan="6" class="muted">Nothing here yet.</td></tr>';
const msgBox=msg?'<div class="notice">'+esc(msg)+'</div>':'';
return page(g.name+' · Goll','<main class="wrap"><header class="top"><div><div class="brand">Goll <span>/ '+esc(g.name)+'</span></div><div class="muted">Discord owner control center · only you can manage this server here</div></div><div class="actions"><a class="btn gray" href="/">My Servers</a><a class="btn gray" href="/logout">Logout</a></div></header>'+msgBox+
'<section class="grid"><div class="card"><div class="muted">Members</div><div class="stat">'+(g.memberCount||0)+'</div></div><div class="card"><div class="muted">Channels</div><div class="stat">'+g.channels.cache.size+'</div></div><div class="card"><div class="muted">Roles</div><div class="stat">'+Math.max(0,g.roles.cache.size-1)+'</div></div><div class="card"><div class="muted">Bot</div><div class="stat">'+(client.isReady()?'ONLINE':'OFFLINE')+'</div></div></section>'+
'<section class="layout"><div class="card"><h2>⚙️ Server</h2><form method="post" action="/server/'+gid+'/setup">'+hidden(s)+'<button class="btn">⚙️ Setup / Repair</button></form><h3>✏️ Server name</h3><form method="post" action="/server/'+gid+'/settings">'+hidden(s)+'<input class="input" name="name" value="'+esc(g.name)+'" maxlength="100" required><button class="btn gray">Save name</button></form></div>'+
'<div class="card"><h2>📢 Announcement</h2><form method="post" action="/server/'+gid+'/announce">'+hidden(s)+'<select name="channel"><option>📢・announcements</option><option>💬・general</option></select><textarea name="message" rows="5" maxlength="4000" placeholder="Write an announcement..." required></textarea><button class="btn">Send Announcement</button></form></div></section>'+
'<div class="card"><h2>🛡️ AutoMod</h2><form method="post" action="/server/'+gid+'/automod">'+hidden(s)+'<label><input type="checkbox" name="anti_links" '+(am.anti_links?'checked':'')+'> Anti-links</label><label><input type="checkbox" name="anti_spam" '+(am.anti_spam?'checked':'')+'> Anti-spam</label><label><input type="checkbox" name="anti_caps" '+(am.anti_caps?'checked':'')+'> Anti-caps</label><button class="btn">Save AutoMod</button></form></div>'+
'<div class="card"><h2>🛡️ Moderation</h2><form method="post" action="/server/'+gid+'/moderate">'+hidden(s)+'<input class="input" name="user_id" placeholder="Discord User ID" required><select name="action"><option>timeout</option><option>kick</option><option>ban</option><option>warn</option></select><input class="input" name="minutes" type="number" value="10" min="1" max="40320"><input class="input" name="reason" maxlength="512" placeholder="Reason" required><button class="btn red">Apply Moderation</button></form></div>'+
'<div class="card"><h2>🎫 Tickets</h2><table><tr><th>Channel</th><th>Type</th><th>Claimed</th><th>Status</th><th>Action</th></tr>'+row(tickets.map(t=>'<tr><td><a href="https://discord.com/channels/'+gid+'/'+esc(t.channel_id)+'" target="_blank">#'+esc(t.channel_id)+'</a></td><td>'+esc(t.type||'')+'</td><td>'+esc(t.claimed_by||'—')+'</td><td>'+(t.closed?'🔒 Closed':'🟢 Open')+'</td><td><form method="post" action="/server/'+gid+'/ticket">'+hidden(s)+'<input type="hidden" name="channel_id" value="'+esc(t.channel_id)+'"><input type="hidden" name="action" value="'+(t.closed?'reopen':'close')+'"><button class="btn gray">'+(t.closed?'Reopen':'Close')+'</button></form></td></tr>').join(''))+'</table></div>'+
'<div class="card"><h2>📝 Applications</h2><table><tr><th>ID</th><th>User</th><th>Status</th><th>Availability</th><th>Action</th></tr>'+row(apps.map(a=>'<tr><td>#'+a.id+'</td><td>'+esc(a.user_id)+'</td><td>'+esc(a.status)+'</td><td>'+esc(a.availability||'—')+'</td><td><form method="post" action="/server/'+gid+'/application">'+hidden(s)+'<input type="hidden" name="id" value="'+a.id+'"><select name="status"><option>INTERVIEW</option><option>ACCEPTED</option><option>DENIED</option><option>ARCHIVED</option></select><button class="btn gray">Update</button></form></td></tr>').join(''))+'</table></div>'+
'<div class="card"><h2>👮 Staff</h2><table><tr><th>User</th><th>Status</th><th>LOA</th><th>Action</th></tr>'+row(staff.map(x=>'<tr><td>'+esc(x.user_id)+'</td><td>'+(x.active?'🟢 Active':'🔴 Inactive')+'</td><td>'+(x.loa_until?esc(new Date(x.loa_until).toLocaleString()):'—')+'</td><td><form method="post" action="/server/'+gid+'/staff">'+hidden(s)+'<input type="hidden" name="user_id" value="'+esc(x.user_id)+'"><input type="hidden" name="action" value="'+(x.active?'inactive':'active')+'"><button class="btn gray">'+(x.active?'Set inactive':'Set active')+'</button></form></td></tr>').join(''))+'</table></div>'+
'<div class="card"><h2>🎁 Giveaways</h2><form method="post" action="/server/'+gid+'/giveaway">'+hidden(s)+'<input class="input" name="prize" maxlength="200" placeholder="Prize" required><input class="input" name="minutes" type="number" min="1" max="10080" value="60" required><button class="btn yellow">Create Giveaway</button></form><br><table><tr><th>Prize</th><th>Status</th><th>Winner</th><th>Ends</th></tr>'+row(giveaways.map(x=>'<tr><td>'+esc(x.prize)+'</td><td>'+esc(x.status)+'</td><td>'+esc(x.winner_id||'—')+'</td><td>'+esc(x.ends_at||'—')+'</td></tr>').join(''))+'</table></div>'+
'</main>');
}

function home(s,client){
const list=s.guilds.filter(x=>x.owner===true&&client.guilds.cache.has(x.id));
return page('Goll Owner Panel','<main class="wrap"><header class="top"><div><div class="brand">Goll <span>Owner Panel</span></div><div class="muted">Signed in as '+esc(s.user.username)+' · '+list.length+' managed server(s)</div></div><a class="btn gray" href="/logout">Logout</a></header><div class="card"><h2>🏠 Your servers</h2><p class="muted">Only servers you own and where Goll is installed are shown.</p>'+(list.length?list.map(g=>'<div class="server"><div><b>'+esc(g.name)+'</b><div class="muted small">Server ID: '+esc(g.id)+'</div></div><a class="btn" href="/server/'+g.id+'">Manage Server →</a></div>').join(''):'<p class="muted">No owned server with Goll installed.</p>')+'</div></main>');
}

async function start(client){
const host=process.env.HOST||'0.0.0.0';
const handler=async(req,res)=>{
try{
if(req.url==='/health'){res.writeHead(200,{'Content-Type':'application/json'});return res.end(JSON.stringify({ok:true,bot:client.isReady(),oauth:ready()}));}
if(req.url==='/auth/discord'){if(!ready()){res.writeHead(503);return res.end('OAuth not configured');}const state=crypto.randomBytes(24).toString('hex');sessions.set('state:'+state,{at:Date.now(),state});res.writeHead(302,{Location:oauth(state),'Set-Cookie':cookie('goll_state',state,600)});return res.end();}
if(req.url.startsWith('/auth/callback')){
const u=new URL(req.url,'http://localhost'),code=u.searchParams.get('code'),state=u.searchParams.get('state'),sc=cookies(req).goll_state,ss=sc&&sessions.get('state:'+sc);
if(!code||!state||!ss||state!==sc){res.writeHead(400);return res.end('Invalid OAuth state');}
sessions.delete('state:'+sc);
const t=await token(code),[user,guilds]=await Promise.all([dget('/users/@me',t.access_token),dget('/users/@me/guilds',t.access_token)]);
const sid=crypto.randomBytes(32).toString('hex');sessions.set(sid,{at:Date.now(),user,guilds,csrf:crypto.randomBytes(24).toString('hex')});
res.writeHead(302,{Location:'/', 'Set-Cookie':cookie('goll_owner',sid,43200)});return res.end();}
if(req.url==='/login'){if(!ready())return res.end(page('Goll','<main class="wrap"><div class="card"><h2>Discord OAuth is not configured</h2><p class="muted">Set DISCORD_CLIENT_ID, DISCORD_CLIENT_SECRET and PANEL_REDIRECT_URI in Railway.</p></div></main>'));return res.end(page('Goll','<main class="wrap" style="max-width:500px;margin:12vh auto"><div class="card"><h1>Goll Owner Panel</h1><p class="muted">Sign in with Discord. Goll only shows servers where your Discord account is the owner.</p><a class="btn" href="/auth/discord">Continue with Discord</a></div></main>'));}
if(req.url==='/logout'){const id=cookies(req).goll_owner;if(id)sessions.delete(id);res.writeHead(302,{'Location':'/login','Set-Cookie':cookie('goll_owner','',0)});return res.end();}
const s=session(req);if(!s){res.writeHead(302,{Location:'/login'});return res.end();}
const parsed=new URL(req.url,'http://localhost');
if(req.method==='POST'&&parsed.pathname.startsWith('/server/')){
const m=parsed.pathname.match(/^\/server\/([^/]+)\/(setup|announce|automod|moderate|settings|ticket|application|staff|giveaway)$/);
if(!m){res.writeHead(404);return res.end('Not found');}
const gid=decodeURIComponent(m[1]),g=owned(s,client,gid);if(!g){res.writeHead(403);return res.end('Forbidden');}
const f=await parseBody(req);if(f.get('_csrf')!==s.csrf){res.writeHead(403);return res.end('Invalid CSRF token');}
const a=m[2],q=client.goll&&client.goll.query;
if(a==='setup'){if(!client.goll?.setupGuild)throw new Error('Bot management service unavailable');await client.goll.setupGuild(g,true);return ok(res,gid,'Server setup repaired.');}
if(a==='announce'){const c=g.channels.cache.find(x=>x.name===f.get('channel')&&x.isTextBased());if(!c)throw new Error('Channel not found');await c.send({embeds:[new EmbedBuilder().setTitle('📢 Announcement').setDescription(f.get('message')).setColor(0x5865F2)]});return ok(res,gid,'Announcement sent.');}
if(a==='settings'){const name=(f.get('name')||'').trim();if(!name)throw new Error('Name is required');await g.setName(name,'Goll owner panel');return ok(res,gid,'Server name updated.');}
if(a==='automod'){if(!q)throw new Error('Database unavailable');await q('INSERT INTO automod_settings(guild_id,anti_spam,anti_links,anti_caps) VALUES($1,$2,$3,$4) ON CONFLICT(guild_id) DO UPDATE SET anti_spam=$2,anti_links=$3,anti_caps=$4,updated_at=NOW()',[gid,f.has('anti_spam'),f.has('anti_links'),f.has('anti_caps')]);return ok(res,gid,'AutoMod settings saved.');}
if(a==='moderate'){
const mbr=await g.members.fetch(f.get('user_id')).catch(()=>null);if(!mbr)throw new Error('Member not found');if(mbr.id===g.ownerId)throw new Error('Cannot moderate the server owner.');
const reason=(f.get('reason')||'Panel moderation').slice(0,512),type=f.get('action');
if(type==='timeout')await mbr.timeout(Math.max(1,Math.min(40320,Number(f.get('minutes'))||10))*60000,reason);
else if(type==='kick')await mbr.kick(reason);
else if(type==='ban')await mbr.ban({reason});
else if(type==='warn'){if(!q)throw new Error('Database unavailable');await q('INSERT INTO warnings(guild_id,user_id,moderator_id,reason) VALUES($1,$2,$3,$4)',[gid,mbr.id,s.user.id,reason]);await q('INSERT INTO moderation_logs(guild_id,target_id,moderator_id,action,reason) VALUES($1,$2,$3,$4,$5)',[gid,mbr.id,s.user.id,'WARN',reason]);}
return ok(res,gid,'Moderation action applied.');}
if(a==='ticket'){
if(!q)throw new Error('Database unavailable');const cid=f.get('channel_id'),action=f.get('action');const tr=(await q('SELECT opener_id,closed FROM tickets WHERE channel_id=$1 AND guild_id=$2',[cid,gid])).rows[0];if(!tr)throw new Error('Ticket not found');const ch=g.channels.cache.get(cid);if(!ch)throw new Error('Ticket channel not found');
if(action==='close'){await q('UPDATE tickets SET closed=true,closed_at=NOW() WHERE channel_id=$1',[cid]);await ch.permissionOverwrites.edit(tr.opener_id,{SendMessages:false}).catch(()=>{});await ch.setName(('closed-'+ch.name).slice(0,100)).catch(()=>{});return ok(res,gid,'Ticket closed.');}
if(action==='reopen'){await q('UPDATE tickets SET closed=false,closed_at=NULL WHERE channel_id=$1',[cid]);await ch.permissionOverwrites.edit(tr.opener_id,{SendMessages:true}).catch(()=>{});await ch.setName(ch.name.replace(/^closed-/,'').slice(0,100)).catch(()=>{});return ok(res,gid,'Ticket reopened.');}
}
if(a==='application'){
if(!q)throw new Error('Database unavailable');const id=f.get('id'),status=f.get('status');if(!['INTERVIEW','ACCEPTED','DENIED','ARCHIVED'].includes(status))throw new Error('Invalid application status');
const app=(await q('SELECT * FROM applications WHERE id=$1 AND guild_id=$2',[id,gid])).rows[0];if(!app)throw new Error('Application not found');
await q('UPDATE applications SET status=$1,reviewer_id=$2,reviewed_at=NOW(),updated_at=NOW() WHERE id=$3',[status,s.user.id,id]);
if(status==='ACCEPTED'){const member=await g.members.fetch(app.user_id).catch(()=>null),trial=g.roles.cache.find(r=>r.name==='📝 Trial Staff');if(member&&trial)await member.roles.add(trial,'Accepted through Goll owner panel').catch(()=>{});}
return ok(res,gid,'Application #'+id+' updated to '+status+'.');}
if(a==='staff'){
if(!q)throw new Error('Database unavailable');const uid=f.get('user_id'),action=f.get('action');if(!['active','inactive'].includes(action))throw new Error('Invalid staff action');
await q('INSERT INTO staff_status(guild_id,user_id,active) VALUES($1,$2,$3) ON CONFLICT(guild_id,user_id) DO UPDATE SET active=$3,updated_at=NOW()',[gid,uid,action==='active']);return ok(res,gid,'Staff status updated.');}
if(a==='giveaway'){
if(!q)throw new Error('Database unavailable');const prize=(f.get('prize')||'').trim().slice(0,200),minutes=Math.max(1,Math.min(10080,parseInt(f.get('minutes'),10)||60));if(!prize)throw new Error('Prize is required');
const ch=g.channels.cache.find(x=>x.name==='🎉・giveaways'&&x.isTextBased());if(!ch)throw new Error('Giveaway channel not found');const end=Date.now()+minutes*60000;
const msg=await ch.send({embeds:[new EmbedBuilder().setTitle('🎁 Giveaway').setDescription('**Prize:** '+prize+'\\n**Ends:** <t:'+Math.floor(end/1000)+':R>\\nClick ENTER to participate!').setColor(0xF1C40F)]});
await q('INSERT INTO giveaways(message_id,guild_id,channel_id,prize,ends_at) VALUES($1,$2,$3,$4,to_timestamp($5/1000.0))',[msg.id,gid,ch.id,prize,end]);
return ok(res,gid,'Giveaway created.');}
}
if(parsed.pathname==='/'){return res.end(home(s,client));}
const sm=parsed.pathname.match(/^\/server\/([^/?#]+)$/);if(sm){const gid=decodeURIComponent(sm[1]);return res.end(await serverView(s,client,gid,parsed.searchParams.get('msg')));}
res.writeHead(404);res.end('Not found');
}catch(e){console.error('Owner panel:',e);res.writeHead(500,{'Content-Type':'text/html; charset=utf-8'});res.end(page('Error','<main class="wrap"><div class="card"><h2>Action failed</h2><p>'+esc(e.message)+'</p><a class="btn gray" href="/">Back</a></div></main>'));}};
const port=Number(process.env.PANEL_PORT||2020),rail=Number(process.env.PORT||0);
const listen=p=>{const server=http.createServer(handler);server.listen(p,host,()=>console.log('Goll owner panel listening on port '+p));return server;};
const servers=[listen(port)];if(rail&&rail!==port)servers.push(listen(rail));
return servers;
}
module.exports={startWebPanel:start};
