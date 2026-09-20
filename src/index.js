const {
  Client, GatewayIntentBits, Partials, PermissionsBitField, ChannelType,
  ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder,
  ModalBuilder, TextInputBuilder, TextInputStyle, SlashCommandBuilder
} = require('discord.js');
const { Pool } = require('pg');

const DISCORD_TOKEN = process.env.DISCORD_TOKEN;
if (!DISCORD_TOKEN) throw new Error('Missing DISCORD_TOKEN');
const TTS_TOKEN = process.env.TTS_TOKEN || '';

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds, GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildMessages, GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildVoiceStates
  ],
  partials: [Partials.Channel]
});

const pool = process.env.DATABASE_URL
  ? new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } })
  : null;

const STAFF_ROLE_NAMES = ['👑 Owner','🛡️ Admin','🔨 Moderator','🎫 Support','📝 Trial Staff'];
const STAFF_ROLES = new Set(STAFF_ROLE_NAMES);
const MANAGED_ROLES = [
  ['👑 Owner', true], ['🛡️ Admin', true], ['🔨 Moderator', true],
  ['🎫 Support', true], ['📝 Trial Staff', true], ['💎 Booster', false],
  ['🤖 Bots', false], ['👤 Member', false]
];
const CATEGORIES = {
  '📌 INFORMATION': [['📜・rules',0],['📢・announcements',0],['👋・welcome',0],['ℹ️・about-us',0]],
  '💬 COMMUNITY': [['💬・general',0],['🖼️・media',0],['😂・memes',0],['🎮・gaming',0],['📊・levels',0]],
  '🎫 SUPPORT': [['🎫・tickets',0],['📝・apply-for-staff',0],['🤝・partnerships',0]],
  '🎁 GIVEAWAYS': [['🎉・giveaways',0],['💎・nitro-drops',0],['🏆・winners',0]],
  '👮 STAFF': [['📋・activity-check',0],['🏖️・request-loa',0],['💼・staff-panel',0],['📚・staff-info',0]],
  '🔐 STAFF LOGS': [['📋・application-logs',0],['🎫・ticket-logs',0],['🏖️・loa-logs',0],['⚙️・updates-logs',0]],
  '🔊 VOICE': [['👋・Welcome',2],['🔊・General',2],['🎮・Gaming',2],['🔒・Private VC',2]]
};

async function q(sql, params=[]) { if (!pool) return {rows:[]}; return pool.query(sql, params); }

async function dbInit() {
  if (!pool) return;
  await q(`CREATE TABLE IF NOT EXISTS guild_config(
    guild_id TEXT PRIMARY KEY, data JSONB NOT NULL DEFAULT '{}'::jsonb,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  )`);
  await q(`CREATE TABLE IF NOT EXISTS staff_status(
    guild_id TEXT, user_id TEXT, active BOOLEAN NOT NULL DEFAULT TRUE,
    loa_until TIMESTAMPTZ, loa_reason TEXT, updated_at TIMESTAMPTZ DEFAULT NOW(),
    PRIMARY KEY(guild_id,user_id)
  )`);
  await q(`CREATE TABLE IF NOT EXISTS warnings(
    id BIGSERIAL PRIMARY KEY, guild_id TEXT, user_id TEXT, moderator_id TEXT,
    reason TEXT, created_at TIMESTAMPTZ DEFAULT NOW()
  )`);
  await q(`CREATE TABLE IF NOT EXISTS tickets(
    channel_id TEXT PRIMARY KEY, guild_id TEXT, opener_id TEXT, type TEXT,
    claimed_by TEXT, closed BOOLEAN DEFAULT FALSE, created_at TIMESTAMPTZ DEFAULT NOW()
  )`);
  await q(`CREATE TABLE IF NOT EXISTS giveaways(
    message_id TEXT PRIMARY KEY, guild_id TEXT, channel_id TEXT, prize TEXT,
    ends_at TIMESTAMPTZ, winner_id TEXT, participants JSONB NOT NULL DEFAULT '[]'::jsonb,
    status TEXT NOT NULL DEFAULT 'OPEN'
  )`);
  await q(`CREATE TABLE IF NOT EXISTS economy(
    guild_id TEXT, user_id TEXT, balance BIGINT NOT NULL DEFAULT 0,
    xp INT NOT NULL DEFAULT 0, level INT NOT NULL DEFAULT 0,
    PRIMARY KEY(guild_id,user_id)
  )`);
}

async function saveConfig(guildId, data) {
  await q(`INSERT INTO guild_config(guild_id,data) VALUES($1,$2)
    ON CONFLICT(guild_id) DO UPDATE SET data=$2,updated_at=NOW()`, [guildId, JSON.stringify(data)]);
}

async function role(guild,name) {
  return guild.roles.cache.find(r=>r.name===name) ||
    guild.roles.create({name,reason:'Goll managed role'});
}
async function category(guild,name) {
  return guild.channels.cache.find(c=>c.type===ChannelType.GuildCategory&&c.name===name) ||
    guild.channels.create({name,type:ChannelType.GuildCategory,reason:'Goll setup'});
}
async function chan(guild,parent,name,type) {
  return guild.channels.cache.find(c=>c.parentId===parent.id&&c.name===name&&c.type===type) ||
    guild.channels.create({name,type,parent:parent.id,reason:'Goll setup'});
}

async function setupGuild(guild, repair=false) {
  const roles={}; for(const [n] of MANAGED_ROLES) roles[n]=(await role(guild,n)).id;
  const channels={};
  for(const [catName,items] of Object.entries(CATEGORIES)){
    const cat=await category(guild,catName); channels[catName]={};
    for(const [n,t] of items) channels[catName][n]=(await chan(guild,cat,n,t)).id;
  }
  const memberRole=guild.roles.cache.get(roles['👤 Member']);
  if(memberRole) for(const c of guild.channels.cache.values()){
    if(c.isTextBased()&&!c.isThread()) await c.permissionOverwrites.edit(memberRole,{ViewChannel:true}).catch(()=>{});
  }
  const welcome=guild.channels.cache.get(channels['📌 INFORMATION']?.['👋・welcome']);
  if(welcome && welcome.isTextBased()){
    const row=new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId('goll_ticket_menu').setLabel('🎫 Open Ticket').setStyle(ButtonStyle.Primary),
      new ButtonBuilder().setCustomId('goll_apply').setLabel('📝 Staff Application').setStyle(ButtonStyle.Secondary)
    );
    const exists=(await welcome.messages.fetch({limit:20}).catch(()=>new Map())).some(m=>m.author.id===client.user.id&&m.embeds[0]?.title==='👋 Welcome to Goll');
    if(!exists) await welcome.send({embeds:[new EmbedBuilder().setTitle('👋 Welcome to Goll').setDescription('Read the rules, meet the community, or open a ticket when you need help.').setColor(0x5865F2)],components:[row]});
  }
  await saveConfig(guild.id,{roles,channels,repair,updatedAt:new Date().toISOString()});
  return {roles,channels};
}

function isStaff(member){ return member.roles.cache.some(r=>STAFF_ROLES.has(r.name)) || member.permissions.has(PermissionsBitField.Flags.ManageGuild); }
function isAdmin(member){ return member.permissions.has(PermissionsBitField.Flags.ManageGuild) || member.roles.cache.some(r=>['👑 Owner','🛡️ Admin'].includes(r.name)); }

async function openTicket(interaction,type='General Support'){
  const existing=(await q('SELECT channel_id FROM tickets WHERE guild_id=$1 AND opener_id=$2 AND closed=false',[interaction.guild.id,interaction.user.id])).rows[0];
  if(existing){const c=interaction.guild.channels.cache.get(existing.channel_id); return interaction.reply({content:`🎫 You already have ${c||'an open ticket'}.`,ephemeral:true});}
  const support=interaction.guild.roles.cache.find(r=>r.name==='🎫 Support');
  const c=await interaction.guild.channels.create({
    name:`ticket-${interaction.user.username}`,type:ChannelType.GuildText,
    parent:interaction.guild.channels.cache.find(x=>x.name==='🎫 SUPPORT'&&x.type===ChannelType.GuildCategory)?.id,
    permissionOverwrites:[
      {id:interaction.guild.id,deny:[PermissionsBitField.Flags.ViewChannel]},
      {id:interaction.user.id,allow:[PermissionsBitField.Flags.ViewChannel,PermissionsBitField.Flags.SendMessages,PermissionsBitField.Flags.ReadMessageHistory]},
      ...(support?[{id:support.id,allow:[PermissionsBitField.Flags.ViewChannel,PermissionsBitField.Flags.SendMessages,PermissionsBitField.Flags.ReadMessageHistory]}]:[])
    ]
  });
  await q('INSERT INTO tickets(channel_id,guild_id,opener_id,type) VALUES($1,$2,$3,$4)',[c.id,interaction.guild.id,interaction.user.id,type]);
  const row=new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId('ticket_claim').setLabel('🙋 Claim').setStyle(ButtonStyle.Success),
    new ButtonBuilder().setCustomId('ticket_close').setLabel('🔒 Close').setStyle(ButtonStyle.Danger)
  );
  await c.send({content:`${interaction.user} <@&${support?.id||''}>`,embeds:[new EmbedBuilder().setTitle('🎫 '+type).setDescription('A staff member will be with you shortly.').setColor(0x5865F2)],components:[row]});
  return interaction.reply({content:`🎫 Ticket created: ${c}`,ephemeral:true});
}

async function registerCommands(){
  const commands=[
    new SlashCommandBuilder().setName('setup').setDescription('Create or repair Goll').addSubcommand(s=>s.setName('repair').setDescription('Repair missing managed resources')),
    new SlashCommandBuilder().setName('goll').setDescription('Open Goll control center'),
    new SlashCommandBuilder().setName('warn').setDescription('Warn a member').addUserOption(o=>o.setName('user').setDescription('Member').setRequired(true)).addStringOption(o=>o.setName('reason').setDescription('Reason').setRequired(true)),
    new SlashCommandBuilder().setName('warnings').setDescription('Show member warnings').addUserOption(o=>o.setName('user').setDescription('Member').setRequired(true)),
    new SlashCommandBuilder().setName('timeout').setDescription('Timeout a member').addUserOption(o=>o.setName('user').setDescription('Member').setRequired(true)).addIntegerOption(o=>o.setName('minutes').setDescription('Minutes').setRequired(true).setMinValue(1).setMaxValue(40320)).addStringOption(o=>o.setName('reason').setDescription('Reason')),
    new SlashCommandBuilder().setName('kick').setDescription('Kick a member').addUserOption(o=>o.setName('user').setDescription('Member').setRequired(true)).addStringOption(o=>o.setName('reason').setDescription('Reason')),
    new SlashCommandBuilder().setName('ban').setDescription('Ban a member').addUserOption(o=>o.setName('user').setDescription('Member').setRequired(true)).addStringOption(o=>o.setName('reason').setDescription('Reason')),
    new SlashCommandBuilder().setName('loa').setDescription('Request staff leave of absence'),
    new SlashCommandBuilder().setName('active').setDescription('Toggle your staff active status'),
    new SlashCommandBuilder().setName('apply').setDescription('Open staff application'),
    new SlashCommandBuilder().setName('giveaway').setDescription('Create a giveaway').addStringOption(o=>o.setName('prize').setDescription('Prize').setRequired(true)).addIntegerOption(o=>o.setName('minutes').setDescription('Duration').setRequired(true).setMinValue(1).setMaxValue(10080)),
    new SlashCommandBuilder().setName('balance').setDescription('Show balance').addUserOption(o=>o.setName('user').setDescription('Member')),
    new SlashCommandBuilder().setName('daily').setDescription('Claim daily coins'),
    new SlashCommandBuilder().setName('pay').setDescription('Pay coins').addUserOption(o=>o.setName('user').setDescription('Member').setRequired(true)).addIntegerOption(o=>o.setName('amount').setDescription('Amount').setRequired(true).setMinValue(1))
  ];
  await client.application.commands.set(commands.map(x=>x.toJSON()));
}

client.once('ready',async()=>{await dbInit();await registerCommands();console.log(`Goll online as ${client.user.tag} | TTS token: ${TTS_TOKEN?'configured':'not configured'}`);});

client.on('guildMemberAdd',async member=>{
  const r=member.guild.roles.cache.find(x=>x.name==='👤 Member');
  if(r) await member.roles.add(r).catch(()=>{});
  const w=member.guild.channels.cache.find(c=>c.name==='📢・welcome'&&c.type===ChannelType.GuildText);
  if(w) await w.send(`👋 Welcome ${member}!`).catch(()=>{});
});

client.on('interactionCreate',async i=>{
  try{
    if(i.isChatInputCommand()){
      const cmd=i.commandName;
      if(cmd==='setup'){
        if(!isAdmin(i.member)) return i.reply({content:'❌ Manage Server is required.',ephemeral:true});
        await i.deferReply({ephemeral:true}); const r=await setupGuild(i.guild,i.options.getSubcommand()==='repair');
        return i.editReply(`✅ Goll setup complete — ${Object.keys(r.roles).length} roles, ${Object.keys(r.channels).length} categories.`);
      }
      if(cmd==='goll') return i.reply({ephemeral:true,embeds:[new EmbedBuilder().setTitle('🤖 Goll Control Center').setDescription('⚙️ Setup  •  👮 Staff  •  🎫 Tickets  •  🛡️ Moderation  •  🎁 Giveaways  •  💰 Economy  •  🔊 Voice').setColor(0x5865F2)]});
      if(['warn','warnings','timeout','kick','ban'].includes(cmd)){
        if(!isStaff(i.member)) return i.reply({content:'❌ Staff only.',ephemeral:true});
        const u=i.options.getUser('user');
        if(cmd==='warn'){const reason=i.options.getString('reason');await q('INSERT INTO warnings(guild_id,user_id,moderator_id,reason) VALUES($1,$2,$3,$4)',[i.guild.id,u.id,i.user.id,reason]);await u.send(`⚠️ You were warned in ${i.guild.name}: ${reason}`).catch(()=>{});return i.reply(`⚠️ ${u} warned.`);}
        if(cmd==='warnings'){const rows=(await q('SELECT reason,created_at FROM warnings WHERE guild_id=$1 AND user_id=$2 ORDER BY created_at DESC LIMIT 10',[i.guild.id,u.id])).rows;return i.reply({embeds:[new EmbedBuilder().setTitle('⚠️ Warnings').setDescription(rows.length?rows.map((x,n)=>`${n+1}. ${x.reason}`).join('\\n'):'No warnings.').setColor(0xF1C40F)]});}
        const m=await i.guild.members.fetch(u.id).catch(()=>null); if(!m)return i.reply({content:'Member not found.',ephemeral:true});
        if(cmd==='timeout'){const min=i.options.getInteger('minutes');await m.timeout(min*60000,i.options.getString('reason')||'Goll moderation');return i.reply(`⏳ ${u} timed out for ${min} minutes.`);}
        if(cmd==='kick'){await m.kick(i.options.getString('reason')||'Goll moderation');return i.reply(`👢 ${u.tag} kicked.`);}
        if(cmd==='ban'){await m.ban({reason:i.options.getString('reason')||'Goll moderation'});return i.reply(`🔨 ${u.tag} banned.`);}
      }
      if(cmd==='loa'){
        if(!isStaff(i.member)) return i.reply({content:'❌ Staff only.',ephemeral:true});
        const modal=new ModalBuilder().setCustomId('loa_modal').setTitle('🏖️ Leave of Absence')
          .addComponents(
            new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('days').setLabel('Duration (1-14 days)').setStyle(TextInputStyle.Short).setRequired(true)),
            new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('reason').setLabel('Reason').setStyle(TextInputStyle.Paragraph).setRequired(true))
          );
        return i.showModal(modal);
      }
      if(cmd==='active'){
        if(!isStaff(i.member)) return i.reply({content:'❌ Staff only.',ephemeral:true});
        const old=(await q('SELECT active FROM staff_status WHERE guild_id=$1 AND user_id=$2',[i.guild.id,i.user.id])).rows[0]?.active ?? false;
        await q(`INSERT INTO staff_status(guild_id,user_id,active) VALUES($1,$2,$3)
          ON CONFLICT(guild_id,user_id) DO UPDATE SET active=$3,updated_at=NOW()`,[i.guild.id,i.user.id,!old]);
        return i.reply(`${!old?'🟢':'🔴'} Staff status: **${!old?'ACTIVE':'INACTIVE'}**`);
      }
      if(cmd==='apply'){
        const modal=new ModalBuilder().setCustomId('apply_modal').setTitle('📝 Staff Application')
          .addComponents(
            new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('age').setLabel('Age').setStyle(TextInputStyle.Short).setRequired(true)),
            new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('experience').setLabel('Why should we choose you?').setStyle(TextInputStyle.Paragraph).setRequired(true)),
            new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('availability').setLabel('Availability').setStyle(TextInputStyle.Short).setRequired(true))
          );
        return i.showModal(modal);
      }
      if(cmd==='giveaway'){
        if(!isStaff(i.member)) return i.reply({content:'❌ Staff only.',ephemeral:true});
        const prize=i.options.getString('prize'), minutes=i.options.getInteger('minutes'), end=Date.now()+minutes*60000;
        const row=new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId('giveaway_join').setLabel('🎉 ENTER').setStyle(ButtonStyle.Success));
        const msg=await i.channel.send({embeds:[new EmbedBuilder().setTitle('🎁 Giveaway').setDescription(`**Prize:** ${prize}\\n**Ends:** <t:${Math.floor(end/1000)}:R>\\nClick ENTER to participate!`).setColor(0xF1C40F)],components:[row]});
        await q('INSERT INTO giveaways(message_id,guild_id,channel_id,prize,ends_at) VALUES($1,$2,$3,$4,to_timestamp($5/1000.0))',[msg.id,i.guild.id,i.channel.id,prize,end]);
        await i.reply({content:'✅ Giveaway created.',ephemeral:true});
        setTimeout(()=>finishGiveaway(msg.id),minutes*60000);
      }
      if(cmd==='balance'){
        const u=i.options.getUser('user')||i.user;const r=(await q('SELECT balance FROM economy WHERE guild_id=$1 AND user_id=$2',[i.guild.id,u.id])).rows[0];
        return i.reply(`💰 ${u.username}: **${r?.balance||0}** coins`);
      }
      if(cmd==='daily'){
        const r=(await q('SELECT balance FROM economy WHERE guild_id=$1 AND user_id=$2',[i.guild.id,i.user.id])).rows[0]; const amount=250;
        await q(`INSERT INTO economy(guild_id,user_id,balance) VALUES($1,$2,$3) ON CONFLICT(guild_id,user_id) DO UPDATE SET balance=economy.balance+$3`,[i.guild.id,i.user.id,amount]);
        return i.reply(`💰 Daily claimed: **+${amount}** coins.`);
      }
      if(cmd==='pay'){
        const u=i.options.getUser('user'),amount=i.options.getInteger('amount');
        if(u.id===i.user.id) return i.reply({content:'❌ You cannot pay yourself.',ephemeral:true});
        const r=(await q('SELECT balance FROM economy WHERE guild_id=$1 AND user_id=$2',[i.guild.id,i.user.id])).rows[0];
        if((r?.balance||0)<amount)return i.reply({content:'❌ Not enough coins.',ephemeral:true});
        await q('INSERT INTO economy(guild_id,user_id,balance) VALUES($1,$2,0) ON CONFLICT DO NOTHING',[i.guild.id,i.user.id]);
        await q('INSERT INTO economy(guild_id,user_id,balance) VALUES($1,$2,$3) ON CONFLICT(guild_id,user_id) DO UPDATE SET balance=economy.balance-$3',[i.guild.id,i.user.id,amount]);
        await q('INSERT INTO economy(guild_id,user_id,balance) VALUES($1,$2,$3) ON CONFLICT(guild_id,user_id) DO UPDATE SET balance=economy.balance+$3',[i.guild.id,u.id,amount]);
        return i.reply(`💸 Paid **${amount}** coins to ${u}.`);
      }
    }

    if(i.isButton()){
      if(i.customId==='goll_ticket_menu') return openTicket(i);
      if(i.customId==='ticket_claim'){
        if(!isStaff(i.member))return i.reply({content:'❌ Staff only.',ephemeral:true});
        await q('UPDATE tickets SET claimed_by=$1 WHERE channel_id=$2',[i.user.id,i.channel.id]); return i.reply(`🙋 Ticket claimed by ${i.user}.`);
      }
      if(i.customId==='ticket_close'){
        if(!isStaff(i.member))return i.reply({content:'❌ Staff only.',ephemeral:true});
        await q('UPDATE tickets SET closed=true WHERE channel_id=$1',[i.channel.id]); await i.reply('🔒 Closing ticket in 5 seconds...');
        setTimeout(()=>i.channel.delete('Goll ticket closed').catch(()=>{}),5000);
      }
      if(i.customId==='giveaway_join'){
        const r=(await q('SELECT participants,status FROM giveaways WHERE message_id=$1',[i.message.id])).rows[0];
        if(!r||r.status!=='OPEN')return i.reply({content:'❌ Giveaway is closed.',ephemeral:true});
        const p=r.participants||[];if(p.includes(i.user.id))return i.reply({content:'You are already entered!',ephemeral:true});
        p.push(i.user.id);await q('UPDATE giveaways SET participants=$1 WHERE message_id=$2',[JSON.stringify(p),i.message.id]);
        return i.reply({content:'🎉 You entered the giveaway!',ephemeral:true});
      }
      if(i.customId==='goll_apply') return i.showModal(new ModalBuilder().setCustomId('apply_modal').setTitle('📝 Staff Application').addComponents(
        new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('age').setLabel('Age').setStyle(TextInputStyle.Short).setRequired(true)),
        new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('experience').setLabel('Why should we choose you?').setStyle(TextInputStyle.Paragraph).setRequired(true)),
        new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('availability').setLabel('Availability').setStyle(TextInputStyle.Short).setRequired(true))
      ));
    }

    if(i.isModalSubmit()){
      if(i.customId==='loa_modal'){
        const days=Math.max(1,Math.min(14,parseInt(i.fields.getTextInputValue('days'),10)||1)),reason=i.fields.getTextInputValue('reason');
        const until=new Date(Date.now()+days*86400000);
        await q(`INSERT INTO staff_status(guild_id,user_id,active,loa_until,loa_reason) VALUES($1,$2,false,$3,$4)
          ON CONFLICT(guild_id,user_id) DO UPDATE SET active=false,loa_until=$3,loa_reason=$4,updated_at=NOW()`,[i.guild.id,i.user.id,until,reason]);
        const log=i.guild.channels.cache.find(c=>c.name==='🏖️・loa-logs'&&c.type===ChannelType.GuildText);
        if(log) await log.send(`🏖️ ${i.user} requested LOA for **${days} days**. Reason: ${reason}`);
        return i.reply({content:`🏖️ LOA submitted for ${days} days. Awaiting staff review.`,ephemeral:true});
      }
      if(i.customId==='apply_modal'){
        const log=i.guild.channels.cache.find(c=>c.name==='📋・application-logs'&&c.type===ChannelType.GuildText);
        if(log) await log.send({embeds:[new EmbedBuilder().setTitle('📝 New Staff Application').setDescription(`Applicant: ${i.user}\\nAge: ${i.fields.getTextInputValue('age')}\\nAvailability: ${i.fields.getTextInputValue('availability')}\\n\\nWhy: ${i.fields.getTextInputValue('experience')}`).setColor(0x5865F2)]});
        return i.reply({content:'✅ Application submitted. Staff will review it.',ephemeral:true});
      }
    }
  }catch(e){
    console.error(e); if(!i.replied&&!i.deferred) await i.reply({content:'❌ Something went wrong.',ephemeral:true}).catch(()=>{}); else if(i.deferred) await i.editReply('❌ Something went wrong.').catch(()=>{});
  }
});

async function finishGiveaway(messageId){
  const r=(await q('SELECT * FROM giveaways WHERE message_id=$1',[messageId])).rows[0]; if(!r||r.status!=='OPEN')return;
  const p=r.participants||[], channel=client.channels.cache.get(r.channel_id), msg=channel&&await channel.messages.fetch(messageId).catch(()=>null);
  const winner=p.length?p[Math.floor(Math.random()*p.length)]:null;
  await q('UPDATE giveaways SET status=$1,winner_id=$2 WHERE message_id=$3',['CLAIMED',winner,messageId]);
  if(msg) await msg.edit({components:[],embeds:[EmbedBuilder.from(msg.embeds[0]).setDescription(`**Prize:** ${r.prize}\\n**Winner:** ${winner?`<@${winner}>`:'No eligible entries.'}`).setColor(0x57F287)]}).catch(()=>{});
  if(channel) await channel.send(winner?`🎉 Congratulations <@${winner}>! You won **${r.prize}**!`:'⏰ Giveaway expired with no entries.');
}

client.login(DISCORD_TOKEN);