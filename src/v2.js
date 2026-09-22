const {
  ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder,
  ModalBuilder, TextInputBuilder, TextInputStyle, StringSelectMenuBuilder,
  UserSelectMenuBuilder, ChannelType, AttachmentBuilder, PermissionsBitField
} = require('discord.js');

const STAFF = ['👑 Owner','🛡️ Admin','🔨 Moderator','🎫 Support','📝 Trial Staff'];
const staff = m => !!m && (m.roles.cache.some(r => STAFF.includes(r.name)) || m.permissions.has(PermissionsBitField.Flags.ManageGuild));
const admin = m => !!m && (m.guild.ownerId === m.id || m.permissions.has(PermissionsBitField.Flags.ManageGuild) || m.roles.cache.some(r => ['👑 Owner','🛡️ Admin'].includes(r.name)));
const owner = m => !!m && m.guild.ownerId === m.id;

function btn(id,label,style=ButtonStyle.Secondary){ return new ButtonBuilder().setCustomId(id).setLabel(label).setStyle(style); }
function row(...b){ return new ActionRowBuilder().addComponents(...b); }
function modal(id,title,fields){
  return new ModalBuilder().setCustomId(id).setTitle(title).addComponents(...fields.map(f =>
    new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId(f.id).setLabel(f.label).setStyle(f.long?TextInputStyle.Paragraph:TextInputStyle.Short).setRequired(f.required!==false).setMaxLength(f.max||1000))
  ));
}
function ts(d){ return '<t:'+Math.floor(new Date(d).getTime()/1000)+':R>'; }

async function dbInit(q){
  await q(`CREATE TABLE IF NOT EXISTS ticket_v2(
    channel_id TEXT PRIMARY KEY,guild_id TEXT,opener_id TEXT,type TEXT,status TEXT DEFAULT 'OPEN',
    claimed_by TEXT,priority TEXT DEFAULT 'NORMAL',sla_at TIMESTAMPTZ,closed_at TIMESTAMPTZ,
    close_reason TEXT,created_at TIMESTAMPTZ DEFAULT NOW()
  )`);
  await q(`CREATE TABLE IF NOT EXISTS ticket_v2_history(
    id BIGSERIAL PRIMARY KEY,channel_id TEXT,guild_id TEXT,actor_id TEXT,action TEXT,details TEXT,created_at TIMESTAMPTZ DEFAULT NOW()
  )`);
  await q(`CREATE TABLE IF NOT EXISTS ticket_v2_members(
    channel_id TEXT,user_id TEXT,added_by TEXT,added_at TIMESTAMPTZ DEFAULT NOW(),PRIMARY KEY(channel_id,user_id)
  )`);
  await q(`CREATE TABLE IF NOT EXISTS ticket_v2_ratings(
    channel_id TEXT PRIMARY KEY,guild_id TEXT,user_id TEXT,rating INT,comment TEXT,created_at TIMESTAMPTZ DEFAULT NOW()
  )`);
  await q(`CREATE TABLE IF NOT EXISTS application_v2(
    id BIGSERIAL PRIMARY KEY,guild_id TEXT,user_id TEXT,age TEXT,experience TEXT,availability TEXT,
    status TEXT DEFAULT 'PENDING',reviewer_id TEXT,interview_notes TEXT,decision_reason TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW(),updated_at TIMESTAMPTZ DEFAULT NOW()
  )`);
  await q(`CREATE TABLE IF NOT EXISTS loa_v2(
    id BIGSERIAL PRIMARY KEY,guild_id TEXT,user_id TEXT,days INT,reason TEXT,status TEXT DEFAULT 'PENDING',
    reviewer_id TEXT,starts_at TIMESTAMPTZ,ends_at TIMESTAMPTZ,created_at TIMESTAMPTZ DEFAULT NOW(),updated_at TIMESTAMPTZ DEFAULT NOW()
  )`);
  await q(`CREATE TABLE IF NOT EXISTS giveaway_v2(
    message_id TEXT PRIMARY KEY,guild_id TEXT,channel_id TEXT,prize TEXT,ends_at TIMESTAMPTZ,
    winners INT DEFAULT 1,required_role_id TEXT,min_level INT DEFAULT 0,min_account_days INT DEFAULT 0,
    entries JSONB NOT NULL DEFAULT '[]'::jsonb,status TEXT DEFAULT 'OPEN',winner_ids JSONB NOT NULL DEFAULT '[]'::jsonb
  )`);
  await q(`CREATE TABLE IF NOT EXISTS staff_v2_history(
    id BIGSERIAL PRIMARY KEY,guild_id TEXT,user_id TEXT,actor_id TEXT,action TEXT,details TEXT,created_at TIMESTAMPTZ DEFAULT NOW()
  )`);
  await q(`CREATE TABLE IF NOT EXISTS staff_v2_profiles(
    guild_id TEXT,user_id TEXT,points INT DEFAULT 0,warnings INT DEFAULT 0,promotions INT DEFAULT 0,
    demotions INT DEFAULT 0,joined_staff_at TIMESTAMPTZ DEFAULT NOW(),PRIMARY KEY(guild_id,user_id)
  )`);
}

async function logTicket(q,guild,channelId,actor,action,details=''){
  await q('INSERT INTO ticket_v2_history(channel_id,guild_id,actor_id,action,details) VALUES($1,$2,$3,$4,$5)',[channelId,guild.id,actor,action,details]);
  const log=guild.channels.cache.find(c=>c.name==='🎫・ticket-logs'&&c.type===ChannelType.GuildText);
  if(log) await log.send({embeds:[new EmbedBuilder().setTitle('🎫 Ticket V2 • '+action).setDescription('Channel: <#'+channelId+'>\nActor: <@'+actor+'>\n'+(details?'Details: '+details:'')).setColor(0x5865F2)]}).catch(()=>{});
}
async function ticketTypes(i){
  return i.reply({content:'🎫 **Choose a ticket category**',components:[row(
    btn('v2_ticket_create:SUPPORT','🛠️ Support',ButtonStyle.Primary),
    btn('v2_ticket_create:REPORT','🚨 Report',ButtonStyle.Danger),
    btn('v2_ticket_create:PARTNERSHIP','🤝 Partnership',ButtonStyle.Secondary),
    btn('v2_ticket_create:PURCHASE','💳 Purchase',ButtonStyle.Success),
    btn('v2_ticket_create:APPEAL','📨 Appeal',ButtonStyle.Secondary)
  )],ephemeral:true});
}
async function createTicket(i,q,type){
  const open=(await q('SELECT channel_id FROM ticket_v2 WHERE guild_id=$1 AND opener_id=$2 AND status IN (\'OPEN\',\'REOPENED\')',[i.guild.id,i.user.id])).rows[0];
  if(open) return i.reply({content:'❌ You already have an open ticket: <#'+open.channel_id+'>',ephemeral:true});
  const support=i.guild.roles.cache.find(r=>r.name==='🎫 Support');
  const mod=i.guild.roles.cache.find(r=>r.name==='🔨 Moderator');
  const cat=i.guild.channels.cache.find(c=>c.name==='🎫 SUPPORT'&&c.type===ChannelType.GuildCategory);
  const c=await i.guild.channels.create({name:('ticket-'+type.toLowerCase()+'-'+i.user.username).slice(0,95),type:ChannelType.GuildText,parent:cat?.id,
    permissionOverwrites:[
      {id:i.guild.id,deny:[PermissionsBitField.Flags.ViewChannel]},
      {id:i.user.id,allow:[PermissionsBitField.Flags.ViewChannel,PermissionsBitField.Flags.SendMessages,PermissionsBitField.Flags.ReadMessageHistory]},
      ...(support?[{id:support.id,allow:[PermissionsBitField.Flags.ViewChannel,PermissionsBitField.Flags.SendMessages,PermissionsBitField.Flags.ReadMessageHistory]}]:[]),
      ...(mod?[{id:mod.id,allow:[PermissionsBitField.Flags.ViewChannel,PermissionsBitField.Flags.SendMessages,PermissionsBitField.Flags.ReadMessageHistory]}]:[])
    ]});
  const sla=new Date(Date.now()+2*60*60*1000);
  await q('INSERT INTO ticket_v2(channel_id,guild_id,opener_id,type,sla_at) VALUES($1,$2,$3,$4,$5)',[c.id,i.guild.id,i.user.id,type,sla]);
  await logTicket(q,i.guild,c.id,i.user.id,'CREATED',type);
  const meta=new EmbedBuilder().setTitle('🎫 '+type+' Ticket').setDescription('Welcome! A staff member will help you here.\n\n**Priority:** 🟡 NORMAL\n**SLA:** '+ts(sla)+'\n**Status:** 🟢 OPEN\n\nUse the controls below.').setColor(0x5865F2);
  await c.send({content:i.user.toString()+(support?' '+support.toString():''),embeds:[meta],
    components:[
      row(btn('v2_ticket_claim','🙋 Claim',ButtonStyle.Success),btn('v2_ticket_priority','⚡ Priority'),btn('v2_ticket_transfer','🔄 Transfer')),
      row(btn('v2_ticket_add','➕ Add'),btn('v2_ticket_remove','➖ Remove'),btn('v2_ticket_transcript','📄 Transcript')),
      row(btn('v2_ticket_close','🔒 Close',ButtonStyle.Danger))
    ]});
  return i.reply({content:'✅ Ticket created: '+c,ephemeral:true});
}
async function transcript(i){
  const msgs=await i.channel.messages.fetch({limit:100}).catch(()=>new Map());
  const lines=[...msgs.values()].sort((a,b)=>a.createdTimestamp-b.createdTimestamp).map(m=>{
    const body=m.content||m.embeds.map(e=>e.title||e.description||'[embed]').join(' | ')||'[attachment]';
    return '['+new Date(m.createdTimestamp).toISOString()+'] '+m.author.tag+': '+body;
  });
  const file=new AttachmentBuilder(Buffer.from(lines.join('\n'),'utf8'),{name:'ticket-'+i.channel.id+'-transcript.txt'});
  return i.reply({content:'📄 Transcript generated (latest 100 messages).',files:[file],ephemeral:true});
}
async function closeTicket(i,q){
  const t=(await q('SELECT * FROM ticket_v2 WHERE channel_id=$1',[i.channel.id])).rows[0];
  if(!t||t.status==='CLOSED') return i.reply({content:'❌ Ticket is already closed.',ephemeral:true});
  await q("UPDATE ticket_v2 SET status='CLOSED',closed_at=NOW(),close_reason=$1,sla_at=NULL WHERE channel_id=$2",['Closed by '+i.user.tag,i.channel.id]);
  await i.channel.permissionOverwrites.edit(t.opener_id,{ViewChannel:true,SendMessages:false,ReadMessageHistory:true}).catch(e=>console.error('Ticket close permission:',e));
  await i.channel.setName(('closed-'+i.channel.name.replace(/^closed-/,'')).slice(0,100)).catch(()=>{});
  await logTicket(q,i.guild,i.channel.id,i.user.id,'CLOSED','Closed by button');
  return i.reply({content:'🔒 **Ticket closed.** The requester can no longer send/view it. Staff can reopen it below.',components:[row(btn('v2_ticket_reopen','🔓 Reopen',ButtonStyle.Success),btn('v2_ticket_rate','⭐ Rate',ButtonStyle.Primary),btn('v2_ticket_transcript','📄 Transcript'))]});
}

function appPanel(){ return {embeds:[new EmbedBuilder().setTitle('📝 Staff Applications V2').setDescription('Application pipeline:\n**Pending → Interview → Accepted / Denied → Archived**\n\nYour application is reviewed through the staff panel.').setColor(0x5865F2)],components:[row(btn('v2_apply','📝 Apply for Staff',ButtonStyle.Primary))]}; }
function loaPanel(){ return {embeds:[new EmbedBuilder().setTitle('🏖️ LOA Manager V2').setDescription('Submit a leave request. Management reviews it, and approved LOA automatically returns the staff member when the period ends.').setColor(0xF1C40F)],components:[row(btn('v2_loa_request','🏖️ Request LOA',ButtonStyle.Secondary))]}; }
function staffPanel(){ return {embeds:[new EmbedBuilder().setTitle('👮 Staff Management V2').setDescription('Staff tools: active status, profile, performance, warnings, promotions, demotions and LOA history.\n\nEverything is button-based — no slash commands needed.').setColor(0x57F287)],components:[row(btn('v2_staff_profile','👤 My Profile',ButtonStyle.Primary),btn('v2_staff_active','🟢 I\'M ACTIVE',ButtonStyle.Success),btn('v2_staff_loa','🏖️ My LOA')),row(btn('v2_staff_stats','📊 Staff Stats',ButtonStyle.Secondary),btn('v2_staff_history','📚 My History',ButtonStyle.Secondary))]}; }
function giveawayPanel(){ return {embeds:[new EmbedBuilder().setTitle('🎁 Giveaway Manager V2').setDescription('Create giveaways with multiple winners and optional role, level and account-age requirements.').setColor(0xF1C40F)],components:[row(btn('v2_gw_create','🎁 Create Giveaway',ButtonStyle.Primary))]}; }

async function ensurePanel(guild,q,repair=false){
  const panels=[
    ['🎫・tickets','🎫 Support Tickets V2',{embeds:[new EmbedBuilder().setTitle('🎫 Support Tickets V2').setDescription('Categories • auto routing • claim • transfer • priority • SLA • transcript • close reason • rating').setColor(0x5865F2)],components:[row(btn('v2_ticket_open','🎫 Open Ticket',ButtonStyle.Primary))]}],
    ['📝・apply-for-staff','📝 Staff Applications V2',appPanel()],
    ['🏖️・request-loa','🏖️ LOA Manager V2',loaPanel()],
    ['💼・staff-panel','👮 Staff Management V2',staffPanel(),giveawayPanel()]
  ];
  for(const [name,title,...payloads] of panels){
    const ch=guild.channels.cache.find(c=>c.name===name&&c.type===ChannelType.GuildText);
    if(!ch) continue;
    const msgs=await ch.messages.fetch({limit:80}).catch(()=>new Map());
    let existing=msgs.find(m=>m.author.id===guild.client.user.id&&m.embeds.some(e=>e.title===title));
    if(repair&&existing){ await existing.delete().catch(()=>{}); existing=null; }
    if(!existing) for(const payload of payloads) await ch.send(payload).catch(()=>{});
  }
}

async function setup(client,q){
  client.on('interactionCreate',async i=>{
    try{
      if(i.isButton()){
        if(i.customId==='v2_ticket_open') return ticketTypes(i);
        if(i.customId.startsWith('v2_ticket_create:')) return createTicket(i,q,i.customId.split(':')[1]);
        if(i.customId==='v2_ticket_claim'){
          if(!staff(i.member)) return i.reply({content:'❌ Staff only.',ephemeral:true});
          const t=(await q('SELECT * FROM ticket_v2 WHERE channel_id=$1',[i.channel.id])).rows[0]; if(!t) return i.reply({content:'❌ Not a V2 ticket.',ephemeral:true});
          await q('UPDATE ticket_v2 SET claimed_by=$1 WHERE channel_id=$2',[i.user.id,i.channel.id]); await q('INSERT INTO staff_v2_profiles(guild_id,user_id,points) VALUES($1,$2,1) ON CONFLICT(guild_id,user_id) DO UPDATE SET points=staff_v2_profiles.points+1',[i.guild.id,i.user.id]); await logTicket(q,i.guild,i.channel.id,i.user.id,'CLAIMED'); return i.reply('🙋 Claimed by '+i.user+'.');
        }
        if(i.customId==='v2_ticket_priority'){
          if(!staff(i.member)) return i.reply({content:'❌ Staff only.',ephemeral:true});
          return i.showModal(modal('v2_priority_modal','⚡ Ticket Priority',[{id:'priority',label:'LOW / NORMAL / HIGH / URGENT',max:10}]));
        }
        if(i.customId==='v2_ticket_transfer'){
          if(!admin(i.member)) return i.reply({content:'❌ Management only.',ephemeral:true});
          return i.reply({content:'🔄 Select the staff member to transfer this ticket to:',components:[row(new UserSelectMenuBuilder().setCustomId('v2_ticket_transfer_user').setPlaceholder('Select staff').setMinValues(1).setMaxValues(1))],ephemeral:true});
        }
        if(i.customId==='v2_ticket_add'||i.customId==='v2_ticket_remove'){
          if(!staff(i.member)) return i.reply({content:'❌ Staff only.',ephemeral:true});
          return i.reply({content:'Select a member:',components:[row(new UserSelectMenuBuilder().setCustomId(i.customId==='v2_ticket_add'?'v2_ticket_add_user':'v2_ticket_remove_user').setPlaceholder('Select member').setMinValues(1).setMaxValues(1))],ephemeral:true});
        }
        if(i.customId==='v2_ticket_transcript') { if(!staff(i.member)) return i.reply({content:'❌ Staff only.',ephemeral:true}); return transcript(i); }
        if(i.customId==='v2_ticket_close') { if(!staff(i.member)) return i.reply({content:'❌ Staff only.',ephemeral:true}); return closeTicket(i,q); }
        if(i.customId==='v2_ticket_reopen'){
          if(!staff(i.member)) return i.reply({content:'❌ Staff only.',ephemeral:true});
          const t=(await q('SELECT * FROM ticket_v2 WHERE channel_id=$1',[i.channel.id])).rows[0]; if(!t||t.status!=='CLOSED') return i.reply({content:'❌ Ticket is not closed.',ephemeral:true});
          await q("UPDATE ticket_v2 SET status='REOPENED',closed_at=NULL,close_reason=NULL WHERE channel_id=$1",[i.channel.id]);
          const opener=i.guild.members.cache.get(t.opener_id); if(opener) await i.channel.permissionOverwrites.edit(opener.id,{SendMessages:true}).catch(()=>{});
          await logTicket(q,i.guild,i.channel.id,i.user.id,'REOPENED'); return i.reply('🔓 Ticket reopened.');
        }
        if(i.customId==='v2_apply') return i.showModal(modal('v2_apply_modal','📝 Staff Application',[{id:'age',label:'Age',max:3},{id:'experience',label:'Experience / why staff?',long:true,max:1500},{id:'availability',label:'Availability',max:300}]));
        if(i.customId==='v2_loa_request'||i.customId==='v2_staff_loa') return i.showModal(modal('v2_loa_modal','🏖️ Request LOA',[{id:'days',label:'Days (1-30)',max:2},{id:'reason',label:'Reason',long:true,max:700}]));
        if(i.customId==='v2_staff_active'){
          if(!staff(i.member)) return i.reply({content:'❌ Staff only.',ephemeral:true});
          await q('INSERT INTO staff_status(guild_id,user_id,active,loa_until) VALUES($1,$2,true,NULL) ON CONFLICT(guild_id,user_id) DO UPDATE SET active=true,loa_until=NULL,updated_at=NOW()',[i.guild.id,i.user.id]);
          await q('INSERT INTO staff_v2_profiles(guild_id,user_id) VALUES($1,$2) ON CONFLICT DO NOTHING',[i.guild.id,i.user.id]);
          await q('INSERT INTO staff_v2_history(guild_id,user_id,actor_id,action,details) VALUES($1,$2,$3,\'ACTIVE\',\'Marked active\')',[i.guild.id,i.user.id,i.user.id]);
          return i.reply({content:'🟢 You are marked ACTIVE.',ephemeral:true});
        }
        if(i.customId==='v2_staff_profile'){
          if(!staff(i.member)) return i.reply({content:'❌ Staff only.',ephemeral:true});
          const p=(await q('SELECT * FROM staff_v2_profiles WHERE guild_id=$1 AND user_id=$2',[i.guild.id,i.user.id])).rows[0]||{};
          const h=(await q('SELECT action,details,created_at FROM staff_v2_history WHERE guild_id=$1 AND user_id=$2 ORDER BY created_at DESC LIMIT 8',[i.guild.id,i.user.id])).rows;
          return i.reply({embeds:[new EmbedBuilder().setTitle('👤 Staff Profile').setDescription('**Member:** '+i.user+'\n**Points:** '+(p.points||0)+'\n**Promotions:** '+(p.promotions||0)+'\n**Demotions:** '+(p.demotions||0)+'\n**Warnings:** '+(p.warnings||0)+'\n\n**Recent:**\n'+(h.map(x=>'• '+x.action+' — '+x.details).join('\n')||'No history yet.')).setColor(0x5865F2)],ephemeral:true});
        }
        if(i.customId==='v2_staff_stats'){
          if(!admin(i.member)) return i.reply({content:'❌ Management only.',ephemeral:true});
          const r=(await q(`SELECT
            COUNT(*) FILTER (WHERE action='ACTIVE') AS active_events,
            COUNT(*) FILTER (WHERE action='PROMOTION') AS promotions,
            COUNT(*) FILTER (WHERE action='DEMOTION') AS demotions
            FROM staff_v2_history WHERE guild_id=$1`,[i.guild.id])).rows[0];
          const staffCount=i.guild.members.cache.filter(m=>staff(m)&&!m.user.bot).size;
          return i.reply({embeds:[new EmbedBuilder().setTitle('📊 Staff Performance Dashboard').setDescription('**Staff members:** '+staffCount+'\n**Active check-ins:** '+(r?.active_events||0)+'\n**Promotions:** '+(r?.promotions||0)+'\n**Demotions:** '+(r?.demotions||0)+'\n\nUse the owner controls for role changes and review history.').setColor(0x57F287)],ephemeral:true});
        }
        if(i.customId==='v2_staff_history'){
          if(!staff(i.member)) return i.reply({content:'❌ Staff only.',ephemeral:true});
          const h=(await q('SELECT action,details,created_at FROM staff_v2_history WHERE guild_id=$1 AND user_id=$2 ORDER BY created_at DESC LIMIT 15',[i.guild.id,i.user.id])).rows;
          return i.reply({content:'📚 **Your Staff History**\n'+(h.map(x=>'<t:'+Math.floor(new Date(x.created_at).getTime()/1000)+':d> — **'+x.action+'** — '+x.details).join('\n')||'No history yet.'),ephemeral:true});
        }
        if(i.customId==='v2_gw_create'){
          if(!admin(i.member)) return i.reply({content:'❌ Management only.',ephemeral:true});
          return i.showModal(modal('v2_gw_modal','🎁 Giveaway V2',[{id:'prize',label:'Prize',max:200},{id:'minutes',label:'Duration in minutes',max:6},{id:'winners',label:'Number of winners (1-10)',max:2},{id:'role',label:'Required role ID (optional)',required:false,max:30},{id:'level',label:'Minimum level (0 optional)',required:false,max:3},{id:'account',label:'Minimum account age in days (0 optional)',required:false,max:5}]));
        }
      }
      if(i.isStringSelectMenu()&&i.customId==='v2_ticket_create') return createTicket(i,q,i.values[0]);
      if(i.isUserSelectMenu()){
        if(i.customId==='v2_ticket_transfer_user'){
          if(!admin(i.member)) return i.reply({content:'❌ Management only.',ephemeral:true});
          const target=await i.guild.members.fetch(i.values[0]).catch(()=>null); if(!target||!staff(target)) return i.reply({content:'❌ Select a staff member.',ephemeral:true});
          await q('UPDATE ticket_v2 SET claimed_by=$1 WHERE channel_id=$2',[target.id,i.channel.id]); await logTicket(q,i.guild,i.channel.id,i.user.id,'TRANSFERRED','To '+target.user.tag); return i.reply({content:'🔄 Ticket transferred to '+target+'.',ephemeral:true});
        }
        if(i.customId==='v2_ticket_add_user'||i.customId==='v2_ticket_remove_user'){
          if(!staff(i.member)) return i.reply({content:'❌ Staff only.',ephemeral:true});
          const target=await i.guild.members.fetch(i.values[0]).catch(()=>null); if(!target) return i.reply({content:'❌ Member not found.',ephemeral:true});
          if(i.customId==='v2_ticket_add_user') { await i.channel.permissionOverwrites.edit(target.id,{ViewChannel:true,SendMessages:true,ReadMessageHistory:true}); await q('INSERT INTO ticket_v2_members(channel_id,user_id,added_by) VALUES($1,$2,$3) ON CONFLICT DO NOTHING',[i.channel.id,target.id,i.user.id]); return i.reply({content:'➕ Added '+target+'.',ephemeral:true}); }
          await i.channel.permissionOverwrites.delete(target.id).catch(()=>{}); await q('DELETE FROM ticket_v2_members WHERE channel_id=$1 AND user_id=$2',[i.channel.id,target.id]); return i.reply({content:'➖ Removed '+target+'.',ephemeral:true});
        }
      }
      if(i.isButton()&&i.customId.startsWith('v2_gw_reroll:')){
        if(!admin(i.member)) return i.reply({content:'❌ Management only.',ephemeral:true});
        const id=i.customId.split(':')[1], r=(await q('SELECT * FROM giveaway_v2 WHERE message_id=$1',[id])).rows[0];
        if(!r||r.status!=='ENDED') return i.reply({content:'❌ Giveaway is not finished.',ephemeral:true});
        const eligible=(Array.isArray(r.entries)?r.entries:[]).filter(x=>!(Array.isArray(r.winner_ids)?r.winner_ids:[]).includes(x));
        if(!eligible.length) return i.reply({content:'❌ No other eligible entries.',ephemeral:true});
        const winner=eligible[Math.floor(Math.random()*eligible.length)];
        await q('UPDATE giveaway_v2 SET winner_ids=$1 WHERE message_id=$2',[JSON.stringify([winner]),id]);
        return i.reply('🔄 New winner: <@'+winner+'> — **'+r.prize+'**!');
      }
      if(i.isButton()&&i.customId==='v2_gw_enter'){
        const r=(await q('SELECT * FROM giveaway_v2 WHERE message_id=$1',[i.message.id])).rows[0];
        if(!r||r.status!=='OPEN') return i.reply({content:'❌ Giveaway is closed.',ephemeral:true});
        if(r.required_role_id&&!i.member.roles.cache.has(r.required_role_id)) return i.reply({content:'❌ You do not have the required role.',ephemeral:true});
        if(r.min_account_days&&((Date.now()-i.user.createdTimestamp)/86400000)<r.min_account_days) return i.reply({content:'❌ Your account is too new for this giveaway.',ephemeral:true});
        if(r.min_level){
          const level=(await q('SELECT level FROM economy WHERE guild_id=$1 AND user_id=$2',[i.guild.id,i.user.id])).rows[0]?.level||0;
          if(level<r.min_level) return i.reply({content:'❌ You do not meet the minimum level.',ephemeral:true});
        }
        const entries=Array.isArray(r.entries)?r.entries:[];
        if(entries.includes(i.user.id)) return i.reply({content:'ℹ️ You are already entered.',ephemeral:true});
        entries.push(i.user.id);
        await q('UPDATE giveaway_v2 SET entries=$1 WHERE message_id=$2',[JSON.stringify(entries),i.message.id]);
        return i.reply({content:'🎉 You are entered!',ephemeral:true});
      }
      if(i.isButton()&&(i.customId.startsWith('v2_loa_approve:')||i.customId.startsWith('v2_loa_deny:'))){
        if(!admin(i.member)) return i.reply({content:'❌ Management only.',ephemeral:true});
        const [action,id]=i.customId.split(':');
        const r=(await q('SELECT * FROM loa_v2 WHERE id=$1 AND guild_id=$2',[id,i.guild.id])).rows[0];
        if(!r||r.status!=='PENDING') return i.reply({content:'❌ This LOA request is no longer pending.',ephemeral:true});
        const approved=action==='v2_loa_approve';
        await q('UPDATE loa_v2 SET status=$1,reviewer_id=$2,starts_at=CASE WHEN $1=\'APPROVED\' THEN NOW() ELSE NULL END,updated_at=NOW() WHERE id=$3',[approved?'APPROVED':'DENIED',i.user.id,id]);
        if(approved) await q('INSERT INTO staff_status(guild_id,user_id,active,loa_until,loa_reason) VALUES($1,$2,false,$3,$4) ON CONFLICT(guild_id,user_id) DO UPDATE SET active=false,loa_until=$3,loa_reason=$4,updated_at=NOW()',[i.guild.id,r.user_id,r.ends_at,r.reason]);
        await q('INSERT INTO staff_v2_history(guild_id,user_id,actor_id,action,details) VALUES($1,$2,$3,$4,$5)',[i.guild.id,r.user_id,i.user.id,approved?'LOA_APPROVED':'LOA_DENIED','Request #'+id]);
        const user=await i.client.users.fetch(r.user_id).catch(()=>null);
        if(user) await user.send('🏖️ Your LOA request #'+id+' was **'+(approved?'approved':'denied')+'** by management.').catch(()=>{});
        return i.update({content:(approved?'✅ LOA approved.':'❌ LOA denied.'),components:[],embeds:[]});
      }
      if(i.isButton()&&i.customId==='v2_ticket_reopen'){
        if(!staff(i.member)) return i.reply({content:'❌ Staff only.',ephemeral:true});
        const t=(await q('SELECT * FROM ticket_v2 WHERE channel_id=$1',[i.channel.id])).rows[0];
        if(!t||t.status!=='CLOSED') return i.reply({content:'❌ Ticket is not closed.',ephemeral:true});
        await q("UPDATE ticket_v2 SET status='REOPENED',closed_at=NULL,close_reason=NULL WHERE channel_id=$1",[i.channel.id]);
        await i.channel.permissionOverwrites.edit(t.opener_id,{ViewChannel:true,SendMessages:true,ReadMessageHistory:true}).catch(()=>{});
        await i.channel.setName(i.channel.name.replace(/^closed-/,'').slice(0,100)).catch(()=>{});
        await logTicket(q,i.guild,i.channel.id,i.user.id,'REOPENED');
        return i.reply('🔓 Ticket reopened.');
      }
      if(i.isModalSubmit()){
        if(i.customId==='v2_priority_modal'){
          if(!staff(i.member)) return i.reply({content:'❌ Staff only.',ephemeral:true});
          const p=i.fields.getTextInputValue('priority').trim().toUpperCase(); if(!['LOW','NORMAL','HIGH','URGENT'].includes(p)) return i.reply({content:'❌ Use LOW, NORMAL, HIGH or URGENT.',ephemeral:true});
          await q('UPDATE ticket_v2 SET priority=$1 WHERE channel_id=$2',[p,i.channel.id]); await logTicket(q,i.guild,i.channel.id,i.user.id,'PRIORITY',p); return i.reply('⚡ Priority changed to **'+p+'**.');
        }
        if(i.customId==='v2_ticket_close_modal'){
          const t=(await q('SELECT * FROM ticket_v2 WHERE channel_id=$1',[i.channel.id])).rows[0];
          if(!t||t.status==='CLOSED') return i.reply({content:'❌ Ticket is already closed.',ephemeral:true});
          const reason=i.fields.getTextInputValue('reason').trim()||'Closed by staff';
          await q("UPDATE ticket_v2 SET status='CLOSED',closed_at=NOW(),close_reason=$1,sla_at=NULL WHERE channel_id=$2",[reason,i.channel.id]);
          await i.channel.permissionOverwrites.edit(t.opener_id,{ViewChannel:true,SendMessages:false,ReadMessageHistory:true}).catch(()=>{});
          await i.channel.setName(('closed-'+i.channel.name.replace(/^closed-/,'')).slice(0,100)).catch(()=>{});
          await logTicket(q,i.guild,i.channel.id,i.user.id,'CLOSED',reason);
          await i.channel.send({embeds:[new EmbedBuilder().setTitle('🔒 Ticket Closed').setDescription('Reason: **'+reason+'**\n\nStaff can reopen this ticket when needed.').setColor(0xED4245)],components:[row(btn('v2_ticket_reopen','🔓 Reopen',ButtonStyle.Success),btn('v2_ticket_rate','⭐ Rate Support',ButtonStyle.Primary),btn('v2_ticket_transcript','📄 Transcript'))]});
          return i.reply('🔒 Ticket closed.');
        }
        if(i.customId==='v2_loa_modal'){
          if(!staff(i.member)) return i.reply({content:'❌ Staff only.',ephemeral:true});
          const days=Math.max(1,Math.min(30,parseInt(i.fields.getTextInputValue('days'),10)||1)),reason=i.fields.getTextInputValue('reason').trim(),end=new Date(Date.now()+days*86400000);
          const active=(await q("SELECT id FROM loa_v2 WHERE guild_id=$1 AND user_id=$2 AND status IN ('PENDING','APPROVED') AND ends_at>NOW() LIMIT 1",[i.guild.id,i.user.id])).rows[0];
          if(active) return i.reply({content:'❌ You already have an active LOA request.',ephemeral:true});
          const r=await q('INSERT INTO loa_v2(guild_id,user_id,days,reason,ends_at) VALUES($1,$2,$3,$4,$5) RETURNING id',[i.guild.id,i.user.id,days,reason,end]);
          const log=i.guild.channels.cache.find(c=>c.name==='🏖️・loa-logs'&&c.type===ChannelType.GuildText);
          if(log) await log.send({embeds:[new EmbedBuilder().setTitle('🏖️ LOA Request V2 #'+r.rows[0].id).setDescription('Staff: '+i.user+'\nDuration: **'+days+' days**\nReturn: '+ts(end)+'\nReason: '+reason).setColor(0xF1C40F)],components:[row(btn('v2_loa_approve:'+r.rows[0].id,'✅ Approve',ButtonStyle.Success),btn('v2_loa_deny:'+r.rows[0].id,'❌ Deny',ButtonStyle.Danger))]});
          return i.reply({content:'🏖️ LOA request submitted for management review.',ephemeral:true});
        }
        if(i.customId==='v2_apply_modal'){
          const age=i.fields.getTextInputValue('age').trim(),experience=i.fields.getTextInputValue('experience').trim(),availability=i.fields.getTextInputValue('availability').trim();
          const active=(await q("SELECT id FROM application_v2 WHERE guild_id=$1 AND user_id=$2 AND status IN ('PENDING','INTERVIEW') LIMIT 1",[i.guild.id,i.user.id])).rows[0];
          if(active) return i.reply({content:'❌ You already have an active application #'+active.id+'.',ephemeral:true});
          const r=await q('INSERT INTO application_v2(guild_id,user_id,age,experience,availability) VALUES($1,$2,$3,$4,$5) RETURNING id',[i.guild.id,i.user.id,age,experience,availability]);
          const log=i.guild.channels.cache.find(c=>c.name==='📋・application-logs'&&c.type===ChannelType.GuildText);
          if(log) await log.send({embeds:[new EmbedBuilder().setTitle('📝 Application V2 #'+r.rows[0].id).setDescription('Applicant: '+i.user+'\n**Age:** '+age+'\n**Availability:** '+availability+'\n\n'+experience).setColor(0x5865F2)],components:[row(btn('v2_app_interview:'+r.rows[0].id,'🎤 Interview'),btn('v2_app_accept:'+r.rows[0].id,'✅ Accept',ButtonStyle.Success),btn('v2_app_deny:'+r.rows[0].id,'❌ Deny',ButtonStyle.Danger),btn('v2_app_archive:'+r.rows[0].id,'📦 Archive'))]});
          return i.reply({content:'✅ Application V2 #'+r.rows[0].id+' submitted.',ephemeral:true});
        }
        if(i.customId.startsWith('v2_app_interview:')||i.customId.startsWith('v2_app_accept:')||i.customId.startsWith('v2_app_deny:')||i.customId.startsWith('v2_app_archive:')){
          if(!admin(i.member)) return i.reply({content:'❌ Management only.',ephemeral:true});
          const [action,id]=i.customId.split(':'),app=(await q('SELECT * FROM application_v2 WHERE id=$1 AND guild_id=$2',[id,i.guild.id])).rows[0]; if(!app) return i.reply({content:'❌ Application not found.',ephemeral:true});
          if(action==='v2_app_interview'&&app.status!=='PENDING') return i.reply({content:'❌ Application is not pending.',ephemeral:true});
          if(action==='v2_app_accept'&&app.status!=='INTERVIEW') return i.reply({content:'❌ Move it to Interview first.',ephemeral:true});
          if(action==='v2_app_deny'&&app.status!=='INTERVIEW') return i.reply({content:'❌ Move it to Interview first.',ephemeral:true});
          if(action==='v2_app_archive'&&app.status==='ARCHIVED') return i.reply({content:'❌ Already archived.',ephemeral:true});
          if(action==='v2_app_deny') return i.showModal(modal('v2_app_deny_modal:'+id,'❌ Deny Application',[{id:'reason',label:'Reason',long:true,max:700}]));
          const status={v2_app_interview:'INTERVIEW',v2_app_accept:'ACCEPTED',v2_app_archive:'ARCHIVED'}[action];
          await q('UPDATE application_v2 SET status=$1,reviewer_id=$2,updated_at=NOW() WHERE id=$3',[status,i.user.id,id]);
          if(status==='ACCEPTED'){const m=await i.guild.members.fetch(app.user_id).catch(()=>null),r=i.guild.roles.cache.find(x=>x.name==='📝 Trial Staff');if(m&&r)await m.roles.add(r).catch(()=>{});}
          await q('INSERT INTO staff_v2_history(guild_id,user_id,actor_id,action,details) VALUES($1,$2,$3,$4,$5)',[i.guild.id,app.user_id,i.user.id,status,'Application #'+id]);
          return i.update({content:'📋 Application #'+id+' → **'+status+'**',embeds:[],components:[]});
        }
        if(i.customId.startsWith('v2_app_deny_modal:')){
          if(!admin(i.member)) return i.reply({content:'❌ Management only.',ephemeral:true});
          const id=i.customId.split(':')[1],reason=i.fields.getTextInputValue('reason').trim(),app=(await q('SELECT * FROM application_v2 WHERE id=$1 AND guild_id=$2',[id,i.guild.id])).rows[0]; if(!app) return i.reply({content:'❌ Not found.',ephemeral:true});
          await q('UPDATE application_v2 SET status=\'DENIED\',reviewer_id=$1,decision_reason=$2,updated_at=NOW() WHERE id=$3',[i.user.id,reason,id]);
          return i.reply({content:'❌ Application #'+id+' denied.',ephemeral:true});
        }
        if(i.customId==='v2_rate_modal'){
          const t=(await q('SELECT opener_id FROM ticket_v2 WHERE channel_id=$1',[i.channel.id])).rows[0];
          const rating=Math.max(1,Math.min(5,parseInt(i.fields.getTextInputValue('rating'),10)||1));
          const comment=i.fields.getTextInputValue('comment').trim();
          if(!t||i.user.id!==t.opener_id) return i.reply({content:'❌ Only the requester can rate this ticket.',ephemeral:true});
          await q('INSERT INTO ticket_v2_ratings(channel_id,guild_id,user_id,rating,comment) VALUES($1,$2,$3,$4,$5) ON CONFLICT(channel_id) DO UPDATE SET rating=$4,comment=$5',[i.channel.id,i.guild.id,i.user.id,rating,comment]);
          return i.reply({content:'⭐ Thanks! Your support rating was recorded.',ephemeral:true});
        }
        if(i.customId==='v2_gw_modal'){
          if(!admin(i.member)) return i.reply({content:'❌ Management only.',ephemeral:true});
          const prize=i.fields.getTextInputValue('prize').trim(),minutes=Math.max(1,Math.min(10080,parseInt(i.fields.getTextInputValue('minutes'),10)||1)),winners=Math.max(1,Math.min(10,parseInt(i.fields.getTextInputValue('winners'),10)||1)),roleId=i.fields.getTextInputValue('role').trim()||null,level=Math.max(0,parseInt(i.fields.getTextInputValue('level'),10)||0),account=Math.max(0,parseInt(i.fields.getTextInputValue('account'),10)||0),end=new Date(Date.now()+minutes*60000);
          const ch=i.guild.channels.cache.find(c=>c.name==='🎉・giveaways'&&c.type===ChannelType.GuildText); if(!ch)return i.reply({content:'❌ Giveaway channel not found.',ephemeral:true});
          const msg=await ch.send({embeds:[new EmbedBuilder().setTitle('🎁 Giveaway V2').setDescription('**Prize:** '+prize+'\n**Winners:** '+winners+'\n**Ends:** '+ts(end)+'\n'+(roleId?'**Role required:** <@&'+roleId+'>\n':'')+'**Min level:** '+level+'\n**Min account age:** '+account+' days\n\nClick ENTER to join!').setColor(0xF1C40F)],components:[row(btn('v2_gw_enter','🎉 ENTER',ButtonStyle.Success))]});
          await q('INSERT INTO giveaway_v2(message_id,guild_id,channel_id,prize,ends_at,winners,required_role_id,min_level,min_account_days) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)',[msg.id,i.guild.id,ch.id,prize,end,winners,roleId,level,account]);
          setTimeout(()=>finishGiveaway(msg.id,q,client),minutes*60000);
          return i.reply({content:'✅ Giveaway V2 created.',ephemeral:true});
        }
        if(i.customId==='v2_ticket_rate'){
          const t=(await q('SELECT opener_id FROM ticket_v2 WHERE channel_id=$1',[i.channel.id])).rows[0]; if(!t)return i.reply({content:'❌ Ticket not found.',ephemeral:true});
          if(i.user.id!==t.opener_id&&!admin(i.member))return i.reply({content:'❌ Only the requester can rate this ticket.',ephemeral:true});
          return i.showModal(modal('v2_rate_modal','⭐ Rate Support',[{id:'rating',label:'Rating 1-5',max:1},{id:'comment',label:'Comment (optional)',long:true,required:false,max:500}]));
        }
      }
      if(i.isUserSelectMenu()){
        if(i.customId==='v2_ticket_transfer_user'){
          if(!admin(i.member)) return i.reply({content:'❌ Management only.',ephemeral:true});
          const target=await i.guild.members.fetch(i.values[0]).catch(()=>null);
          if(!target||!staff(target)) return i.reply({content:'❌ Select a staff member.',ephemeral:true});
          await q('UPDATE ticket_v2 SET claimed_by=$1 WHERE channel_id=$2',[target.id,i.channel.id]);
          await logTicket(q,i.guild,i.channel.id,i.user.id,'TRANSFERRED','To '+target.user.tag);
          return i.reply({content:'🔄 Ticket transferred to '+target+'.',ephemeral:true});
        }
        if(i.customId==='v2_ticket_add_user'||i.customId==='v2_ticket_remove_user'){
          if(!staff(i.member)) return i.reply({content:'❌ Staff only.',ephemeral:true});
          const target=await i.guild.members.fetch(i.values[0]).catch(()=>null);
          if(!target) return i.reply({content:'❌ Member not found.',ephemeral:true});
          if(i.customId==='v2_ticket_add_user'){
            await i.channel.permissionOverwrites.edit(target.id,{ViewChannel:true,SendMessages:true,ReadMessageHistory:true});
            await q('INSERT INTO ticket_v2_members(channel_id,user_id,added_by) VALUES($1,$2,$3) ON CONFLICT DO NOTHING',[i.channel.id,target.id,i.user.id]);
            return i.reply({content:'➕ Added '+target+'.',ephemeral:true});
          }
          await i.channel.permissionOverwrites.delete(target.id).catch(()=>{});
          await q('DELETE FROM ticket_v2_members WHERE channel_id=$1 AND user_id=$2',[i.channel.id,target.id]);
          return i.reply({content:'➖ Removed '+target+'.',ephemeral:true});
        }
      }
    }catch(e){ console.error('Goll V2:',e); if(!i.replied&&!i.deferred) await i.reply({content:'❌ Goll V2 error. Check Railway logs.',ephemeral:true}).catch(()=>{}); }
  });

  const loaTimer=setInterval(async()=>{
    const rows=(await q("SELECT * FROM loa_v2 WHERE status='APPROVED' AND ends_at<=NOW()")).rows;
    for(const r of rows){
      await q("UPDATE loa_v2 SET status='COMPLETED',updated_at=NOW() WHERE id=$1",[r.id]);
      await q("UPDATE staff_status SET active=true,loa_until=NULL,loa_reason=NULL,updated_at=NOW() WHERE guild_id=$1 AND user_id=$2",[r.guild_id,r.user_id]);
      await q("INSERT INTO staff_v2_history(guild_id,user_id,actor_id,action,details) VALUES($1,$2,$3,'LOA_RETURNED',$4)",[r.guild_id,r.user_id,r.user_id,'LOA #'+r.id+' ended automatically']);
      const user=await client.users.fetch(r.user_id).catch(()=>null);
      if(user) await user.send('🟢 Your LOA in **'+(client.guilds.cache.get(r.guild_id)?.name||'the server')+'** has ended. You are marked active again.').catch(()=>{});
      const guild=client.guilds.cache.get(r.guild_id);
      const log=guild?.channels.cache.find(c=>c.name==='🏖️・loa-logs'&&c.type===ChannelType.GuildText);
      if(log) await log.send('🟢 <@'+r.user_id+'> automatically returned from LOA #'+r.id+'.').catch(()=>{});
    }
  },60000);
  client.once('ready',()=>{ if(loaTimer.unref) loaTimer.unref(); });
  const slaTimer=setInterval(async()=>{
    const rows=(await q("SELECT * FROM ticket_v2 WHERE status IN ('OPEN','REOPENED') AND sla_at IS NOT NULL AND sla_at<=NOW()")).rows;
    for(const t of rows){
      await q('UPDATE ticket_v2 SET sla_at=NULL WHERE channel_id=$1',[t.channel_id]);
      const guild=client.guilds.cache.get(t.guild_id);
      const ch=client.channels.cache.get(t.channel_id);
      if(ch) await ch.send({embeds:[new EmbedBuilder().setTitle('⏰ SLA Alert').setDescription('This ticket has passed its 2-hour response window. Staff attention is required.').setColor(0xED4245)]}).catch(()=>{});
      const log=guild?.channels.cache.find(c=>c.name==='🎫・ticket-logs'&&c.type===ChannelType.GuildText);
      if(log) await log.send('⏰ SLA exceeded for <#'+t.channel_id+'>.').catch(()=>{});
    }
  },60000);
  client.once('ready',()=>{ if(slaTimer.unref) slaTimer.unref(); });

  const giveawayRecovery=setInterval(async()=>{
    const rows=(await q("SELECT message_id FROM giveaway_v2 WHERE status='OPEN' AND ends_at<=NOW()")).rows;
    for(const r of rows) await finishGiveaway(r.message_id,q,client).catch(e=>console.error('Giveaway recovery:',e));
  },60000);
  client.once('ready',()=>{ if(giveawayRecovery.unref) giveawayRecovery.unref(); });

  client.on('messageCreate',async m=>{
    if(m.author.bot||!m.guild)return;
    const t=(await q('SELECT * FROM ticket_v2 WHERE channel_id=$1 AND status IN (\'OPEN\',\'REOPENED\')',[m.channel.id])).rows[0];
    if(t&&t.sla_at&&new Date(t.sla_at).getTime()<Date.now()){
      await q('UPDATE ticket_v2 SET sla_at=NULL WHERE channel_id=$1',[m.channel.id]);
      const log=m.guild.channels.cache.find(c=>c.name==='🎫・ticket-logs'&&c.type===ChannelType.GuildText);
      if(log) await log.send('⏰ **SLA alert:** Ticket <#'+m.channel.id+'> has exceeded its response window.');
    }
  });
}
async function finishGiveaway(messageId,q,client){
  const r=(await q('SELECT * FROM giveaway_v2 WHERE message_id=$1',[messageId])).rows[0]; if(!r||r.status!=='OPEN')return;
  const ch=client.channels.cache.get(r.channel_id); if(!ch)return;
  const entries=Array.isArray(r.entries)?r.entries:[];
  const eligible=[];
  for(const id of entries){
    const m=await ch.guild.members.fetch(id).catch(()=>null); if(!m)continue;
    if(r.required_role_id&&!m.roles.cache.has(r.required_role_id))continue;
    if(r.min_account_days&&((Date.now()-m.user.createdTimestamp)/86400000)<r.min_account_days)continue;
    if(r.min_level){
      const x=(await q('SELECT level FROM economy WHERE guild_id=$1 AND user_id=$2',[r.guild_id,id])).rows[0]?.level||0;
      if(x<r.min_level)continue;
    }
    eligible.push(id);
  }
  const shuffled=[...eligible].sort(()=>Math.random()-0.5),winners=shuffled.slice(0,r.winners);
  await q('UPDATE giveaway_v2 SET status=\'ENDED\',winner_ids=$1 WHERE message_id=$2',[JSON.stringify(winners),messageId]);
  await ch.send({embeds:[new EmbedBuilder().setTitle('🏆 Giveaway V2 Finished').setDescription('**Prize:** '+r.prize+'\n'+(winners.length?'**Winners:** '+winners.map(x=>'<@'+x+'>').join(', '):'No eligible winners.')).setColor(0x57F287)],components:[row(btn('v2_gw_reroll:'+messageId,'🔄 Reroll',ButtonStyle.Secondary))]});
}
module.exports={dbInit,setup,ensurePanel};
