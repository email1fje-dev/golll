const {
  ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder, ModalBuilder,
  TextInputBuilder, TextInputStyle, StringSelectMenuBuilder, ChannelType,
  PermissionsBitField
} = require('discord.js');

const OWNER_CATEGORY='👑 OWNER';
const HUB_CHANNEL='👑・owner-hub';
const STAFF_NAMES=['👑 Owner','🛡️ Admin','🔨 Moderator','🎫 Support','📝 Trial Staff'];

function owner(m){ return !!m && m.guild.ownerId===m.id; }

async function dbInit(q){
  await q(`CREATE TABLE IF NOT EXISTS owner_polls(
    id BIGSERIAL PRIMARY KEY,guild_id TEXT NOT NULL,channel_id TEXT NOT NULL,message_id TEXT,
    question TEXT NOT NULL,options JSONB NOT NULL,created_by TEXT NOT NULL,created_at TIMESTAMPTZ DEFAULT NOW(),closed BOOLEAN DEFAULT FALSE
  )`);
  await q(`CREATE TABLE IF NOT EXISTS owner_poll_votes(
    poll_id BIGINT,user_id TEXT NOT NULL,option_index INT NOT NULL,voted_at TIMESTAMPTZ DEFAULT NOW(),
    PRIMARY KEY(poll_id,user_id)
  )`);
  await q(`CREATE TABLE IF NOT EXISTS owner_events(
    id BIGSERIAL PRIMARY KEY,guild_id TEXT NOT NULL,channel_id TEXT NOT NULL,name TEXT NOT NULL,
    starts_at TIMESTAMPTZ NOT NULL,description TEXT,created_by TEXT NOT NULL,created_at TIMESTAMPTZ DEFAULT NOW()
  )`);
  await q(`CREATE TABLE IF NOT EXISTS owner_event_rsvps(
    event_id BIGINT,user_id TEXT NOT NULL,rsvp_at TIMESTAMPTZ DEFAULT NOW(),PRIMARY KEY(event_id,user_id)
  )`);
  await q(`CREATE TABLE IF NOT EXISTS owner_achievements(
    id BIGSERIAL PRIMARY KEY,guild_id TEXT NOT NULL,name TEXT NOT NULL,description TEXT,emoji TEXT DEFAULT '🏆',
    UNIQUE(guild_id,name)
  )`);
  await q(`CREATE TABLE IF NOT EXISTS owner_user_achievements(
    guild_id TEXT NOT NULL,achievement_id BIGINT,user_id TEXT NOT NULL,unlocked_at TIMESTAMPTZ DEFAULT NOW(),
    PRIMARY KEY(achievement_id,user_id)
  )`);
  await q(`CREATE TABLE IF NOT EXISTS owner_custom_commands(
    guild_id TEXT NOT NULL,name TEXT NOT NULL,response TEXT NOT NULL,created_by TEXT NOT NULL,created_at TIMESTAMPTZ DEFAULT NOW(),
    PRIMARY KEY(guild_id,name)
  )`);
  await q(`CREATE TABLE IF NOT EXISTS owner_audit(
    id BIGSERIAL PRIMARY KEY,guild_id TEXT NOT NULL,actor_id TEXT,action TEXT NOT NULL,target_id TEXT,details TEXT,created_at TIMESTAMPTZ DEFAULT NOW()
  )`);
  await q(`CREATE TABLE IF NOT EXISTS owner_emergency(
    guild_id TEXT PRIMARY KEY,active BOOLEAN NOT NULL DEFAULT FALSE,changed_by TEXT,changed_at TIMESTAMPTZ
  )`);
}

function hub(){
  const e=new EmbedBuilder().setTitle('👑 Goll Owner Hub')
    .setDescription('Private control center — only the **Server Owner** can use these controls.\\n\\n📊 Analytics — server activity overview\\n🗳️ Polls — create and manage polls\\n📅 Events — create events and collect RSVPs\\n🏆 Achievements — create and award achievements\\n🧩 Commands — create custom text commands\\n🕵️ Audit — owner-only action timeline\\n📈 Stats — live server stat channels\\n🚨 Emergency — lockdown mode')
    .setColor(0x5865F2);
  return {embeds:[e],components:[
    new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId('hub:analytics').setLabel('📊 Analytics').setStyle(ButtonStyle.Primary),
      new ButtonBuilder().setCustomId('hub:poll').setLabel('🗳️ Polls').setStyle(ButtonStyle.Primary),
      new ButtonBuilder().setCustomId('hub:event').setLabel('📅 Events').setStyle(ButtonStyle.Primary),
      new ButtonBuilder().setCustomId('hub:achievement').setLabel('🏆 Achievements').setStyle(ButtonStyle.Success)
    ),
    new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId('hub:command').setLabel('🧩 Commands').setStyle(ButtonStyle.Secondary),
      new ButtonBuilder().setCustomId('hub:audit').setLabel('🕵️ Audit').setStyle(ButtonStyle.Secondary),
      new ButtonBuilder().setCustomId('hub:stats').setLabel('📈 Stats').setStyle(ButtonStyle.Secondary),
      new ButtonBuilder().setCustomId('hub:emergency').setLabel('🚨 Emergency').setStyle(ButtonStyle.Danger)
    )
  ]};
}

async function ensureHub(guild,q,force=false){
  let cat=guild.channels.cache.find(c=>c.type===ChannelType.GuildCategory&&c.name===OWNER_CATEGORY);
  if(!cat) cat=await guild.channels.create({name:OWNER_CATEGORY,type:ChannelType.GuildCategory,reason:'Goll Owner Hub'});
  await cat.permissionOverwrites.edit(guild.roles.everyone,{ViewChannel:false}).catch(()=>{});
  const ow=await guild.fetchOwner().catch(()=>null);
  if(ow) await cat.permissionOverwrites.edit(ow,{ViewChannel:true,SendMessages:true,ReadMessageHistory:true}).catch(()=>{});
  let ch=guild.channels.cache.find(c=>c.type===ChannelType.GuildText&&c.name===HUB_CHANNEL);
  if(!ch) ch=await guild.channels.create({name:HUB_CHANNEL,type:ChannelType.GuildText,parent:cat.id,permissionOverwrites:[
    {id:guild.roles.everyone.id,deny:[PermissionsBitField.Flags.ViewChannel]},
    ...(ow?[{id:ow.id,allow:[PermissionsBitField.Flags.ViewChannel,PermissionsBitField.Flags.SendMessages,PermissionsBitField.Flags.ReadMessageHistory]}]:[])
  ],reason:'Goll Owner Hub'});
  else if(ch.parentId!==cat.id) await ch.setParent(cat.id).catch(()=>{});
  const exists=(await ch.messages.fetch({limit:20}).catch(()=>new Map())).some(m=>m.author.id===guild.client.user.id&&m.embeds[0]?.title==='👑 Goll Owner Hub');
  if(!exists||force) await ch.send(hub()).catch(()=>{});
  await ensureStats(guild);
}

async function ensureStats(guild){
  let cat=guild.channels.cache.find(c=>c.type===ChannelType.GuildCategory&&c.name===OWNER_CATEGORY);
  if(!cat) cat=await guild.channels.create({name:OWNER_CATEGORY,type:ChannelType.GuildCategory,reason:'Goll Owner Hub'});
  const ow=await guild.fetchOwner().catch(()=>null);
  await cat.permissionOverwrites.edit(guild.roles.everyone,{ViewChannel:false}).catch(()=>{});
  if(ow) await cat.permissionOverwrites.edit(ow,{ViewChannel:true,Connect:true,ViewChannel:true}).catch(()=>{});

  const counts=[
    ['📈 Members',guild.memberCount],
    ['💬 Channels',guild.channels.cache.size],
    ['👮 Staff',guild.members.cache.filter(m=>m.roles.cache.some(r=>STAFF_NAMES.includes(r.name))).size]
  ];
  for(const [name,value] of counts){
    let ch=guild.channels.cache.find(c=>c.type===ChannelType.GuildVoice&&c.name.startsWith(name));
    if(!ch) ch=await guild.channels.create({
      name:name+' • '+value,type:ChannelType.GuildVoice,parent:cat.id,
      permissionOverwrites:[
        {id:guild.roles.everyone.id,deny:[PermissionsBitField.Flags.ViewChannel,PermissionsBitField.Flags.Connect]},
        ...(ow?[{id:ow.id,allow:[PermissionsBitField.Flags.ViewChannel,PermissionsBitField.Flags.Connect]}]:[])
      ],
      reason:'Goll server stats'
    });
    else {
      if(ch.parentId!==cat.id) await ch.setParent(cat.id).catch(()=>{});
      await ch.permissionOverwrites.edit(guild.roles.everyone,{ViewChannel:false,Connect:false}).catch(()=>{});
      if(ow) await ch.permissionOverwrites.edit(ow,{ViewChannel:true,Connect:true}).catch(()=>{});
      if(ch.name!==name+' • '+value) await ch.setName(name+' • '+value).catch(()=>{});
    }
  }
}

function modal(id,title,fields){
  return new ModalBuilder().setCustomId(id).setTitle(title).addComponents(fields.map(f=>new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId(f[0]).setLabel(f[1]).setStyle(f[2]||TextInputStyle.Short).setRequired(true).setMaxLength(f[3]||1000))));
}

async function analytics(i,q){
  const tickets=(await q('SELECT COUNT(*)::int n FROM tickets WHERE guild_id=$1',[i.guild.id])).rows[0]?.n||0;
  const apps=(await q('SELECT COUNT(*)::int n FROM applications WHERE guild_id=$1',[i.guild.id])).rows[0]?.n||0;
  const warns=(await q('SELECT COUNT(*)::int n FROM warnings WHERE guild_id=$1',[i.guild.id])).rows[0]?.n||0;
  const giveaways=(await q('SELECT COUNT(*)::int n FROM giveaways WHERE guild_id=$1',[i.guild.id])).rows[0]?.n||0;
  return i.reply({embeds:[new EmbedBuilder().setTitle('📊 Server Analytics').setDescription('**Members:** '+i.guild.memberCount+'\\n**Channels:** '+i.guild.channels.cache.size+'\\n**Tickets created:** '+tickets+'\\n**Applications:** '+apps+'\\n**Warnings:** '+warns+'\\n**Giveaways:** '+giveaways).setColor(0x5865F2)],ephemeral:true});
}

async function setup(client,q){
  client.on('messageDelete',async m=>{ if(!m.guild||m.author?.bot) return; await q('INSERT INTO owner_audit(guild_id,actor_id,action,target_id,details) VALUES($1,$2,$3,$4,$5)',[m.guild.id,null,'MESSAGE_DELETED',m.author?.id||null,'channel='+m.channel?.id]).catch(()=>{}); });
  client.on('guildMemberAdd',async m=>{ await q('INSERT INTO owner_audit(guild_id,actor_id,action,target_id,details) VALUES($1,$2,$3,$4,$5)',[m.guild.id,null,'MEMBER_JOIN',m.id,null]).catch(()=>{}); await ensureStats(m.guild).catch(()=>{}); });
  client.on('messageCreate',async m=>{
    if(!m.guild||m.author.bot||!m.content.startsWith('!')) return;
    const name=m.content.slice(1).trim().split(/\\s+/)[0].toLowerCase();
    if(!name) return;
    const row=(await q('SELECT response FROM owner_custom_commands WHERE guild_id=$1 AND name=$2',[m.guild.id,name])).rows[0];
    if(row) await m.reply(row.response.replaceAll('{user}',m.author.toString()).replaceAll('{server}',m.guild.name).replaceAll('{members}',String(m.guild.memberCount))).catch(()=>{});
  });
  client.on('interactionCreate',async i=>{
    try{
      if(i.isButton()&&i.customId.startsWith('hub:')){
        if(!owner(i.member)) return i.reply({content:'❌ Owner only.',ephemeral:true});
        const type=i.customId.slice(4);
        if(type==='analytics') return analytics(i,q);
        if(type==='poll') return i.reply({content:'🗳️ Create a poll:',components:[new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId('hub:poll_new').setLabel('➕ New Poll').setStyle(ButtonStyle.Primary))],ephemeral:true});
        if(type==='poll_new') return i.showModal(modal('hub:poll_modal','🗳️ New Poll',[['question','Question',TextInputStyle.Short,200],['options','Options (separate with |)',TextInputStyle.Paragraph,500]]));
        if(type==='event') return i.showModal(modal('hub:event_modal','📅 New Event',[['name','Event name',TextInputStyle.Short,100],['when','Date/time (ISO, e.g. 2026-10-01T18:00:00+02:00)',TextInputStyle.Short,60],['description','Description',TextInputStyle.Paragraph,1000]]));
        if(type==='achievement') return i.reply({content:'🏆 Achievement Manager',components:[new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId('hub:ach_new').setLabel('➕ Create').setStyle(ButtonStyle.Success),new ButtonBuilder().setCustomId('hub:ach_award').setLabel('🏅 Award to Member').setStyle(ButtonStyle.Primary))],ephemeral:true});
        if(type==='ach_new') return i.showModal(modal('hub:ach_modal','🏆 New Achievement',[['name','Name',TextInputStyle.Short,80],['description','Description',TextInputStyle.Paragraph,500],['emoji','Emoji',TextInputStyle.Short,10]]));
        if(type==='ach_award') return i.showModal(modal('hub:ach_award_modal','🏅 Award Achievement',[['user','Member ID',TextInputStyle.Short,30],['achievement','Achievement name',TextInputStyle.Short,80]]));
        if(type==='command') return i.showModal(modal('hub:cmd_modal','🧩 Custom Command',[['name','Command name (without !)',TextInputStyle.Short,40],['response','Response. Variables: {user} {server} {members}',TextInputStyle.Paragraph,1500]]));
        if(type==='audit'){ const rows=(await q('SELECT action,target_id,details,created_at FROM owner_audit WHERE guild_id=$1 ORDER BY id DESC LIMIT 15',[i.guild.id])).rows; return i.reply({embeds:[new EmbedBuilder().setTitle('🕵️ Audit Timeline').setDescription(rows.length?rows.map(x=>'**'+x.action+'** '+(x.target_id?'<@'+x.target_id+'> ':'')+'\\n'+(x.details||'')+' • <t:'+Math.floor(new Date(x.created_at).getTime()/1000)+':R>').join('\\n\\n'):'No audit events yet.').setColor(0x5865F2)],ephemeral:true});}
        if(type==='stats'){ await ensureStats(i.guild); return i.reply({content:'📈 Stats channels updated.',ephemeral:true}); }
        if(type==='emergency') return i.reply({content:'🚨 Emergency Mode',components:[new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId('hub:lockdown').setLabel('🔒 Lockdown').setStyle(ButtonStyle.Danger),new ButtonBuilder().setCustomId('hub:unlock').setLabel('🔓 Unlock').setStyle(ButtonStyle.Success))],ephemeral:true});
        if(type==='lockdown'){
          const changed=[]; for(const ch of i.guild.channels.cache.values()){if(!ch.isTextBased()||ch.isThread()||ch.name===HUB_CHANNEL) continue; const ow=ch.permissionOverwrites.cache.get(i.guild.roles.everyone.id); if(ow?.deny.has(PermissionsBitField.Flags.SendMessages)) continue; await ch.permissionOverwrites.edit(i.guild.roles.everyone,{SendMessages:false}).catch(()=>{}); changed.push(ch.id);}
          await q('INSERT INTO owner_emergency(guild_id,active,changed_by,changed_at) VALUES($1,true,$2,NOW()) ON CONFLICT(guild_id) DO UPDATE SET active=true,changed_by=$2,changed_at=NOW()',[i.guild.id,i.user.id]); await q('INSERT INTO owner_audit(guild_id,actor_id,action,details) VALUES($1,$2,$3,$4)',[i.guild.id,i.user.id,'EMERGENCY_LOCKDOWN','channels='+changed.length]); return i.reply({content:'🔒 Emergency lockdown enabled for '+changed.length+' text channels.',ephemeral:true});
        }
        if(type==='unlock'){
          const active=(await q('SELECT active FROM owner_emergency WHERE guild_id=$1',[i.guild.id])).rows[0]; if(!active?.active) return i.reply({content:'ℹ️ Emergency Mode is not active.',ephemeral:true});
          for(const ch of i.guild.channels.cache.values()){if(!ch.isTextBased()||ch.isThread()||ch.name===HUB_CHANNEL) continue; await ch.permissionOverwrites.edit(i.guild.roles.everyone,{SendMessages:null}).catch(()=>{});}
          await q('UPDATE owner_emergency SET active=false,changed_by=$2,changed_at=NOW() WHERE guild_id=$1',[i.guild.id,i.user.id]); return i.reply({content:'🔓 Emergency Mode disabled.',ephemeral:true});
        }
      }
      if(i.isModalSubmit()){
        if(!owner(i.member)) return i.reply({content:'❌ Owner only.',ephemeral:true});
        if(i.customId==='hub:poll_modal'){
          const opts=i.fields.getTextInputValue('options').split('|').map(x=>x.trim()).filter(Boolean).slice(0,5); const question=i.fields.getTextInputValue('question'); if(opts.length<2) return i.reply({content:'❌ Add at least 2 options.',ephemeral:true});
          const e=new EmbedBuilder().setTitle('🗳️ '+question).setDescription(opts.map((x,n)=>'**'+(n+1)+'.** '+x).join('\\n')).setColor(0x5865F2);
          const rows=[new ActionRowBuilder().addComponents(...opts.map((x,n)=>new ButtonBuilder().setCustomId('poll:'+Date.now()+':'+n).setLabel(String(n+1)).setStyle(ButtonStyle.Primary)))];
          const msg=await i.channel.send({embeds:[e],components:rows}); const ins=await q('INSERT INTO owner_polls(guild_id,channel_id,message_id,question,options,created_by) VALUES($1,$2,$3,$4,$5,$6) RETURNING id',[i.guild.id,i.channel.id,msg.id,question,JSON.stringify(opts),i.user.id]); const pid=ins.rows[0].id; await q('UPDATE owner_polls SET message_id=$1 WHERE id=$2',[msg.id,pid]); return i.reply({content:'✅ Poll created.',ephemeral:true});
        }
        if(i.customId==='hub:event_modal'){
          const name=i.fields.getTextInputValue('name'),when=i.fields.getTextInputValue('when'),description=i.fields.getTextInputValue('description'); const d=new Date(when); if(Number.isNaN(d.getTime())) return i.reply({content:'❌ Invalid date/time. Use ISO with timezone.',ephemeral:true});
          const row=await q('INSERT INTO owner_events(guild_id,channel_id,name,starts_at,description,created_by) VALUES($1,$2,$3,$4,$5,$6) RETURNING id',[i.guild.id,i.channel.id,name,d,description,i.user.id]); const id=row.rows[0].id; const e=new EmbedBuilder().setTitle('📅 '+name).setDescription(description+'\\n\\n🕒 <t:'+Math.floor(d.getTime()/1000)+':F>\\n👥 RSVPs: 0').setColor(0x57F287); await i.channel.send({embeds:[e],components:[new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId('event:rsvp:'+id).setLabel('✅ RSVP').setStyle(ButtonStyle.Success))]}); return i.reply({content:'✅ Event created.',ephemeral:true});
        }
        if(i.customId==='hub:ach_modal'){const n=i.fields.getTextInputValue('name'),d=i.fields.getTextInputValue('description'),e=i.fields.getTextInputValue('emoji')||'🏆'; await q('INSERT INTO owner_achievements(guild_id,name,description,emoji) VALUES($1,$2,$3,$4) ON CONFLICT(guild_id,name) DO UPDATE SET description=$3,emoji=$4',[i.guild.id,n,d,e]); return i.reply({content:'✅ Achievement saved.',ephemeral:true});}
        if(i.customId==='hub:ach_award_modal'){const uid=i.fields.getTextInputValue('user').trim(),n=i.fields.getTextInputValue('achievement').trim(); const a=(await q('SELECT id,emoji,name FROM owner_achievements WHERE guild_id=$1 AND name=$2',[i.guild.id,n])).rows[0]; if(!a) return i.reply({content:'❌ Achievement not found.',ephemeral:true}); await q('INSERT INTO owner_user_achievements(guild_id,achievement_id,user_id) VALUES($1,$2,$3) ON CONFLICT DO NOTHING',[i.guild.id,a.id,uid]); return i.reply({content:'🏅 Achievement awarded to <@'+uid+'>.',ephemeral:true});}
        if(i.customId==='hub:cmd_modal'){const n=i.fields.getTextInputValue('name').trim().toLowerCase().replace(/[^a-z0-9_-]/g,''); const r=i.fields.getTextInputValue('response'); if(!n) return i.reply({content:'❌ Invalid command name.',ephemeral:true}); await q('INSERT INTO owner_custom_commands(guild_id,name,response,created_by) VALUES($1,$2,$3,$4) ON CONFLICT(guild_id,name) DO UPDATE SET response=$3',[i.guild.id,n,r,i.user.id]); return i.reply({content:'✅ Custom command saved. Members can use **!'+n+'**.',ephemeral:true});}
      }
      if(i.isButton()&&i.customId.startsWith('poll:')){const [,key,opt]=i.customId.split(':'); const p=(await q('SELECT id,question,options,closed FROM owner_polls WHERE guild_id=$1 AND message_id=$2',[i.guild.id,i.message.id])).rows[0]; if(!p||p.closed) return i.reply({content:'❌ Poll closed.',ephemeral:true}); await q('INSERT INTO owner_poll_votes(poll_id,user_id,option_index) VALUES($1,$2,$3) ON CONFLICT(poll_id,user_id) DO UPDATE SET option_index=$3,voted_at=NOW()',[p.id,i.user.id,Number(opt)]); return i.reply({content:'✅ Vote recorded.',ephemeral:true});}
      if(i.isButton()&&i.customId.startsWith('event:rsvp:')){const id=i.customId.split(':')[2]; await q('INSERT INTO owner_event_rsvps(event_id,user_id) VALUES($1,$2) ON CONFLICT DO NOTHING',[id,i.user.id]); const n=(await q('SELECT COUNT(*)::int n FROM owner_event_rsvps WHERE event_id=$1',[id])).rows[0]?.n||0; return i.reply({content:'✅ RSVP recorded. Current RSVPs: '+n,ephemeral:true});}
    }catch(e){console.error('Owner Hub:',e); if(!i.replied&&!i.deferred) await i.reply({content:'❌ Owner Hub error.',ephemeral:true}).catch(()=>{});}
  });
}
module.exports={setup,dbInit,ensureHub};
