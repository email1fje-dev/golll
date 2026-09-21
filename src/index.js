const {
  Client, GatewayIntentBits, Partials, PermissionsBitField, ChannelType,
  ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder, StringSelectMenuBuilder, AttachmentBuilder,
  ModalBuilder, TextInputBuilder, TextInputStyle, SlashCommandBuilder
} = require('discord.js');
const { Pool } = require('pg');
const { setupNitro } = require('./nitro');
const { setupEconomy } = require('./economy');
const { setupVerification } = require('./verification');
const { setupAutomod } = require('./automod');
const { setupDashboard } = require('./dashboard');
const discordOwner = require('./discord-owner');
const ownerHub = require('./owner-hub');

const DISCORD_TOKEN = process.env.DISCORD_TOKEN;
if (!DISCORD_TOKEN) throw new Error('Missing DISCORD_TOKEN');
const TTS_TOKEN = process.env.TTS_TOKEN || '';
const TTS_VOICE_ID = 'JBFqnCBsd6RMkjVDRZzb';
const { joinVoiceChannel, createAudioPlayer, createAudioResource, AudioPlayerStatus, NoSubscriberBehavior, entersState, VoiceConnectionStatus } = require('@discordjs/voice');
const { Readable } = require('stream');
const ffmpegPath = require('ffmpeg-static');
if (ffmpegPath) process.env.FFMPEG_PATH = ffmpegPath;

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
  '📌 INFORMATION': [['📜・rules',0],['📢・announcements',0],['👋・welcome',0],['ℹ️・about-us',0],['🔐・verify',0]],
  '💬 COMMUNITY': [['💬・general',0],['🖼️・media',0],['😂・memes',0],['🎮・gaming',0],['📊・levels',0]],
  '🎫 SUPPORT': [['🎫・tickets',0],['📝・apply-for-staff',0],['🤝・partnerships',0]],
  '🎁 GIVEAWAYS': [['🎉・giveaways',0],['💎・nitro-drops',0],['🏆・winners',0]],
  '👮 STAFF': [['📋・activity-check',0],['🏖️・request-loa',0],['💼・staff-panel',0],['📚・staff-info',0],['🛡️・automod',0],['📊・dashboard',0]],
  '🔐 STAFF LOGS': [['📋・application-logs',0],['🎫・ticket-logs',0],['🏖️・loa-logs',0],['⚙️・updates-logs',0]],
  '🔊 VOICE': [['👋・Welcome',2],['🔊・General',2],['🎮・Gaming',2],['🔒・Private VC',2]]
};

async function q(sql, params=[]) { if (!pool) return {rows:[]}; return pool.query(sql, params); }
async function playWelcomeTTS(member){
  if(!TTS_TOKEN){
    console.warn('Welcome TTS: TTS_TOKEN is not configured.');
    return;
  }
  if(!member.voice?.channel){
    console.warn('Welcome TTS: member is no longer in a voice channel.');
    return;
  }

  console.log('Welcome TTS: generating audio for', member.user.tag);
  const response=await fetch('https://api.elevenlabs.io/v1/text-to-speech/'+TTS_VOICE_ID+'?output_format=mp3_44100_128',{
    method:'POST',
    headers:{'xi-api-key':TTS_TOKEN,'Content-Type':'application/json'},
    body:JSON.stringify({text:'Welcome to Goll! We are happy to have you here, '+member.displayName+'! Please make sure to read the server rules, have fun, and enjoy your time with everyone.',model_id:'eleven_multilingual_v2'})
  });
  if(!response.ok) throw new Error('ElevenLabs TTS '+response.status+' '+(await response.text()).slice(0,500));

  const audio=Buffer.from(await response.arrayBuffer());
  if(!audio.length) throw new Error('ElevenLabs returned an empty audio file.');
  console.log('Welcome TTS: audio received', audio.length, 'bytes');

  const channel=member.voice.channel;
  const connection=joinVoiceChannel({
    channelId:channel.id,
    guildId:member.guild.id,
    adapterCreator:member.guild.voiceAdapterCreator,
    selfDeaf:false,
    selfMute:false
  });

  await entersState(connection, VoiceConnectionStatus.Ready, 15000);
  console.log('Welcome TTS: voice connection ready');

  const player=createAudioPlayer({behaviors:{noSubscriber:NoSubscriberBehavior.Stop}});
  connection.subscribe(player);
  const resource=createAudioResource(Readable.from(audio), {inputType: 'arbitrary'});
  player.play(resource);

  player.once(AudioPlayerStatus.Playing,()=>console.log('Welcome TTS: playback started'));
  player.once(AudioPlayerStatus.Idle,()=>{console.log('Welcome TTS: playback finished'); connection.destroy();});
  player.on('error',err=>{console.error('Welcome TTS player:',err.message); connection.destroy();});
}


const nitro = setupNitro(q, client);
const economy = setupEconomy(q, client);
const verification = setupVerification(q, client);
const automod = setupAutomod(q, client);
const dashboard = setupDashboard(q, client);

async function initInvites(guild){
  try {
    const invites=await guild.invites.fetch();
    for(const inv of invites.values()) await q('INSERT INTO invite_codes(guild_id,code,inviter_id,uses) VALUES($1,$2,$3,$4) ON CONFLICT(guild_id,code) DO UPDATE SET inviter_id=$3,uses=$4',[guild.id,inv.code,inv.inviterId||null,inv.uses||0]);
  } catch(e){ console.error('Invite init:',e.message); }
}
async function dbInit() {
  if (!pool) return;
  await q(`CREATE TABLE IF NOT EXISTS invite_codes(
    guild_id TEXT, code TEXT, inviter_id TEXT, uses INT NOT NULL DEFAULT 0,
    PRIMARY KEY(guild_id,code)
  )`);
  await q(`CREATE TABLE IF NOT EXISTS invite_uses(
    guild_id TEXT, user_id TEXT, inviter_id TEXT, code TEXT,
    joined_at TIMESTAMPTZ DEFAULT NOW()
  )`);
  await q(`CREATE TABLE IF NOT EXISTS verification_logs(
    id BIGSERIAL PRIMARY KEY, guild_id TEXT, user_id TEXT, status TEXT NOT NULL,
    reason TEXT, created_at TIMESTAMPTZ DEFAULT NOW()
  )`);
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
    claimed_by TEXT, closed BOOLEAN DEFAULT FALSE, closed_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT NOW()
  )`);
  await q(`ALTER TABLE tickets ADD COLUMN IF NOT EXISTS closed_at TIMESTAMPTZ`);
  await q(`CREATE TABLE IF NOT EXISTS giveaways(
    message_id TEXT PRIMARY KEY, guild_id TEXT, channel_id TEXT, prize TEXT,
    ends_at TIMESTAMPTZ, winner_id TEXT, participants JSONB NOT NULL DEFAULT '[]'::jsonb,
    status TEXT NOT NULL DEFAULT 'OPEN'
  )`);
  await q(`ALTER TABLE giveaways ADD COLUMN IF NOT EXISTS reward_coins BIGINT NOT NULL DEFAULT 0`);
  await q(`ALTER TABLE giveaways ADD COLUMN IF NOT EXISTS reward_role_id TEXT`);
  await q(`ALTER TABLE giveaways ADD COLUMN IF NOT EXISTS reward_claimed BOOLEAN NOT NULL DEFAULT FALSE`);
  await q(`CREATE TABLE IF NOT EXISTS applications(
    id BIGSERIAL PRIMARY KEY, guild_id TEXT, user_id TEXT, age TEXT, experience TEXT,
    availability TEXT, status TEXT NOT NULL DEFAULT 'PENDING', reviewer_id TEXT,
    decision_reason TEXT, reviewed_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT NOW(), updated_at TIMESTAMPTZ DEFAULT NOW()
  )`);
  await q(`ALTER TABLE applications ADD COLUMN IF NOT EXISTS decision_reason TEXT`);
  await q(`ALTER TABLE applications ADD COLUMN IF NOT EXISTS reviewed_at TIMESTAMPTZ`);
  await q(`CREATE TABLE IF NOT EXISTS activity_checks(
    id BIGSERIAL PRIMARY KEY, guild_id TEXT, message_id TEXT, channel_id TEXT,
    deadline TIMESTAMPTZ, status TEXT NOT NULL DEFAULT 'OPEN',
    closed_by TEXT, created_at TIMESTAMPTZ DEFAULT NOW()
  )`);
  await q(`CREATE TABLE IF NOT EXISTS activity_responses(
    check_id BIGINT, guild_id TEXT, user_id TEXT, responded_at TIMESTAMPTZ DEFAULT NOW(),
    PRIMARY KEY(check_id,user_id)
  )`);

  await q(`CREATE TABLE IF NOT EXISTS activity_misses(
    check_id BIGINT, guild_id TEXT, user_id TEXT, reason TEXT NOT NULL DEFAULT 'NO_RESPONSE',
    created_at TIMESTAMPTZ DEFAULT NOW(),
    PRIMARY KEY(check_id,user_id)
  )`);  await q(`CREATE TABLE IF NOT EXISTS automod_settings(
    guild_id TEXT PRIMARY KEY,
    anti_spam BOOLEAN NOT NULL DEFAULT TRUE,
    anti_links BOOLEAN NOT NULL DEFAULT TRUE,
    anti_caps BOOLEAN NOT NULL DEFAULT TRUE,
    updated_at TIMESTAMPTZ DEFAULT NOW()
  )`);
  await q(`CREATE TABLE IF NOT EXISTS temp_voice(
    channel_id TEXT PRIMARY KEY, guild_id TEXT, owner_id TEXT, created_at TIMESTAMPTZ DEFAULT NOW()
  )`);
  await q(`CREATE TABLE IF NOT EXISTS welcome_tts_seen(
    guild_id TEXT, user_id TEXT, first_seen_at TIMESTAMPTZ DEFAULT NOW(),
    PRIMARY KEY(guild_id,user_id)
  )`);
  await nitro.dbInit();
  await discordOwner.dbInit(q);
  await ownerHub.dbInit(q);
  await q(`CREATE TABLE IF NOT EXISTS economy(
    guild_id TEXT, user_id TEXT, balance BIGINT NOT NULL DEFAULT 0,
    xp INT NOT NULL DEFAULT 0, level INT NOT NULL DEFAULT 0,
    PRIMARY KEY(guild_id,user_id)
  )`);
}


async function applyManagedPermissions(guild, roles) {
  const everyone = guild.roles.everyone;
  const byName = Object.fromEntries(roles.map(r => [r.name, r]));
  const perms = {
    '👑 Owner': [PermissionsBitField.Flags.Administrator],
    '🛡️ Admin': [PermissionsBitField.Flags.ManageGuild, PermissionsBitField.Flags.ManageChannels, PermissionsBitField.Flags.ManageMessages, PermissionsBitField.Flags.ManageRoles, PermissionsBitField.Flags.KickMembers, PermissionsBitField.Flags.BanMembers, PermissionsBitField.Flags.ModerateMembers],
    '🔨 Moderator': [PermissionsBitField.Flags.ManageMessages, PermissionsBitField.Flags.ModerateMembers, PermissionsBitField.Flags.KickMembers],
    '🎫 Support': [PermissionsBitField.Flags.ManageMessages],
    '📝 Trial Staff': [PermissionsBitField.Flags.ManageMessages]
  };
  for (const [name, flags] of Object.entries(perms)) {
    const r = byName[name];
    if (!r || r.managed) continue;
    await r.setPermissions(flags, 'Goll permission sync').catch(() => {});
  }

  const staffCategory = guild.channels.cache.find(c => c.name === '👮 STAFF' && c.type === ChannelType.GuildCategory);
  const logsCategory = guild.channels.cache.find(c => c.name === '🔐 STAFF LOGS' && c.type === ChannelType.GuildCategory);
  if (staffCategory) {
    await staffCategory.permissionOverwrites.edit(everyone, { ViewChannel: false }).catch(() => {});
    for (const name of STAFF_ROLE_NAMES) {
      const r = byName[name];
      if (r) await staffCategory.permissionOverwrites.edit(r, { ViewChannel: true }).catch(() => {});
    }
  }
  if (logsCategory) {
    await logsCategory.permissionOverwrites.edit(everyone, { ViewChannel: false }).catch(() => {});
    for (const name of ['👑 Owner','🛡️ Admin','🔨 Moderator']) {
      const r = byName[name];
      if (r) await logsCategory.permissionOverwrites.edit(r, { ViewChannel: true }).catch(() => {});
    }
  }
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


async function seedChannelContent(guild, force=false) {
  const cards = [
    ['📜・rules','📜 Server Rules','Please read and follow the server rules before chatting.\n\n• Be respectful.\n• No spam or harmful content.\n• Follow Discord Terms of Service.\n• Staff decisions and support requests should stay respectful.'],
    ['📢・announcements','📢 Announcements','Official server announcements will be posted here. Turn on notifications if you want to keep up with important updates.'],
    ['ℹ️・about-us','ℹ️ About Goll','Welcome to **Goll**! This server is built around community, events, support, staff systems, giveaways and voice features.'],
    ['🤝・partnerships','🤝 Partnerships','Interested in a partnership? Open a support ticket and choose **Partnership** so the team can review your request.'],
    ['🎉・giveaways','🎁 Giveaways','Active giveaways will appear here. Use the **ENTER** button on a giveaway message to participate.'],
    ['💎・nitro-drops','💎 Nitro Drops','Nitro Quick Drops will appear here when the server owner starts one. Keep an eye on this channel for active drops.'],
    ['🏆・winners','🏆 Winners','Winners of giveaways and Nitro Quick Drops will be recorded here. Good luck! 🍀'],
    ['💬・general','💬 General','This is the main community chat. Say hi and start a conversation!'],
    ['🖼️・media','🖼️ Media','Share your favorite screenshots, creations and other community-friendly media here.'],
    ['😂・memes','😂 Memes','The meme zone. Keep it server-friendly. 😂'],
    ['🎮・gaming','🎮 Gaming','Talk about games, find teammates and share your gaming moments. 🎮'],
    ['📊・levels','📊 Levels','Your server XP and level information can be displayed here as the leveling system grows.'],
    ['📚・staff-info','📚 Staff Info','Staff resources, expectations and internal information belong here.'],
    ['🛡️・automod','🛡️ AutoMod','AutoMod protects the server from spam, links and excessive caps. Configuration is handled by management.'],
    ['📊・dashboard','📊 Dashboard','The staff dashboard is reserved for server management and operational information.']
  ];
  for (const [name,title,description] of cards) {
    const ch=guild.channels.cache.find(c=>c.name===name&&c.type===ChannelType.GuildText);
    if (!ch) continue;
    const exists=(await ch.messages.fetch({limit:20}).catch(()=>new Map()))
      .some(m=>m.author.id===client.user.id&&m.embeds[0]?.title===title);
    if (!exists || force) {
      await ch.send({embeds:[new EmbedBuilder().setTitle(title).setDescription(description).setColor(0x5865F2)]}).catch(()=>{});
    }
  }
}

async function sendTicketPanel(guild, force=false) {
  const ch=guild.channels.cache.find(c=>c.name==='🎫・tickets'&&c.type===ChannelType.GuildText);
  if(!ch) return;
  const exists=(await ch.messages.fetch({limit:20}).catch(()=>new Map()))
    .some(m=>m.author.id===client.user.id&&m.embeds[0]?.title==='🎫 Support Tickets');
  if(exists&&!force) return;
  const row=new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId('goll_ticket_menu').setLabel('🎫 Open Ticket').setStyle(ButtonStyle.Primary)
  );
  await ch.send({
    embeds:[new EmbedBuilder()
      .setTitle('🎫 Support Tickets')
      .setDescription('Need help? Click **Open Ticket** and choose the type of support you need. You do not need a slash command.')
      .setColor(0x5865F2)],
    components:[row]
  });
}

async function sendStaffPanel(guild, force=false) {
  const ch=guild.channels.cache.find(c=>c.name==='💼・staff-panel'&&c.type===ChannelType.GuildText); if(!ch) return;
  const exists=(await ch.messages.fetch({limit:30}).catch(()=>new Map())).some(m=>m.author.id===client.user.id&&m.embeds[0]?.title==='👮 Staff Control Panel');
  if(exists&&!force) return;
  const rows=[
    new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId('staff_active').setLabel("🟢 I'M ACTIVE").setStyle(ButtonStyle.Success),
      new ButtonBuilder().setCustomId('staff_loa').setLabel('🏖️ Request LOA').setStyle(ButtonStyle.Secondary),
      new ButtonBuilder().setCustomId('staff_end_loa').setLabel('🔙 End LOA').setStyle(ButtonStyle.Danger)
    ),
    new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId('staff_apply_status').setLabel('📋 My Application').setStyle(ButtonStyle.Primary),
      new ButtonBuilder().setCustomId('staff_refresh').setLabel('🔄 Refresh').setStyle(ButtonStyle.Secondary)
    )
  ];
  await ch.send({embeds:[new EmbedBuilder().setTitle('👮 Staff Control Panel').setDescription("All staff actions are handled here — no slash commands needed.\\n\\n🟢 I'M ACTIVE — mark yourself active\\n🏖️ Request LOA — submit a leave request\\n🔙 End LOA — return early from an approved LOA\\n📋 My Application — check your application").setColor(0x5865F2)],components:rows});
}

async function sendApplicationPanel(guild, force=false) {
  const ch=guild.channels.cache.find(c=>c.name==='📝・apply-for-staff'&&c.type===ChannelType.GuildText); if(!ch) return;
  const exists=(await ch.messages.fetch({limit:20}).catch(()=>new Map())).some(m=>m.author.id===client.user.id&&m.embeds[0]?.title==='📝 Staff Applications');
  if(exists&&!force) return;
  const row=new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId('goll_apply').setLabel('📝 Apply for Staff').setStyle(ButtonStyle.Primary));
  await ch.send({embeds:[new EmbedBuilder().setTitle('📝 Staff Applications').setDescription('Want to join the staff team? Click the button below and complete the application.').setColor(0x5865F2)],components:[row]});
}

async function sendActivityPanel(guild, force=false) {
  const ch=guild.channels.cache.find(c=>c.name==='📋・activity-check'&&c.type===ChannelType.GuildText); if(!ch) return;
  const exists=(await ch.messages.fetch({limit:30}).catch(()=>new Map())).some(m=>m.author.id===client.user.id&&m.embeds[0]?.title==='📋 Staff Activity Control');
  if(exists&&!force) return;
  const row=new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId('activity_start').setLabel('📋 START ACTIVITY CHECK').setStyle(ButtonStyle.Primary),
    new ButtonBuilder().setCustomId('activity_close').setLabel('🔒 CLOSE CURRENT CHECK').setStyle(ButtonStyle.Danger)
  );
  await ch.send({embeds:[new EmbedBuilder().setTitle('📋 Staff Activity Control').setDescription("Management can start or close an activity check here. Staff members only need to press I'M ACTIVE when a check is running.").setColor(0x57F287)],components:[row]});
}
async function sendGiveawayPanel(guild, force=false) {
  const ch=guild.channels.cache.find(c=>c.name==='💼・staff-panel'&&c.type===ChannelType.GuildText); if(!ch) return;
  const exists=(await ch.messages.fetch({limit:30}).catch(()=>new Map())).some(m=>m.author.id===client.user.id&&m.embeds[0]?.title==='🎁 Giveaway Control');
  if(exists&&!force) return;
  const row=new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId('giveaway_create').setLabel('🎁 CREATE GIVEAWAY').setStyle(ButtonStyle.Primary));
  await ch.send({embeds:[new EmbedBuilder().setTitle('🎁 Giveaway Control').setDescription('Staff can create a giveaway from this panel. Members enter from the giveaway button.').setColor(0xF1C40F)],components:[row]});
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

  // Welcome voice is for members; @everyone should not see it before becoming a member.
  const welcomeVoice = guild.channels.cache.find(
    c => c.name === '👋・Welcome' && c.type === ChannelType.GuildVoice
  );
  const memberRoleForWelcome = guild.roles.cache.get(roles['👤 Member']);
  if (welcomeVoice && memberRoleForWelcome) {
    await welcomeVoice.permissionOverwrites.edit(guild.roles.everyone, {
      ViewChannel: false,
      Connect: false
    }).catch(() => {});
    await welcomeVoice.permissionOverwrites.edit(memberRoleForWelcome, {
      ViewChannel: true,
      Connect: true
    }).catch(() => {});
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
  await seedChannelContent(guild, repair);
  await sendTicketPanel(guild, repair);
  await sendStaffPanel(guild, repair);
  await sendApplicationPanel(guild, repair);
  await sendActivityPanel(guild, repair);
  await sendGiveawayPanel(guild, repair);
  await nitro.ensurePanel(guild, repair);
  await verification.ensurePanel(guild);
  await automod.ensurePanel(guild, repair);
  await dashboard.ensurePanel(guild, repair);
  await discordOwner.ensurePanel(guild, q, repair);
  await ownerHub.ensureHub(guild, q, repair);
  await saveConfig(guild.id,{roles,channels,repair,updatedAt:new Date().toISOString()});
  return {roles,channels};
}

client.goll = { setupGuild, query: q };
discordOwner.setup(client, q);
ownerHub.setup(client, q);

function isStaff(member){ return member.roles.cache.some(r=>STAFF_ROLES.has(r.name)) || member.permissions.has(PermissionsBitField.Flags.ManageGuild); }
function isAdmin(member){ return member.permissions.has(PermissionsBitField.Flags.ManageGuild) || member.roles.cache.some(r=>['👑 Owner','🛡️ Admin'].includes(r.name)); }
function isOwner(member){ return member?.guild?.ownerId===member.id; }

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
  const row1=new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId('ticket_claim').setLabel('🙋 Claim').setStyle(ButtonStyle.Success),
    new ButtonBuilder().setCustomId('ticket_add').setLabel('➕ Add Member').setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId('ticket_close').setLabel('🔒 Close').setStyle(ButtonStyle.Danger)
  );
  const row2=new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId('ticket_reopen').setLabel('🔓 Reopen').setStyle(ButtonStyle.Success),
    new ButtonBuilder().setCustomId('ticket_transcript').setLabel('📄 Transcript').setStyle(ButtonStyle.Primary)
  );  await c.send({content:`${interaction.user} <@&${support?.id||''}>`,embeds:[new EmbedBuilder().setTitle('🎫 '+type).setDescription('A staff member will be with you shortly.').setColor(0x5865F2)],components:[row1,row2]});
  return interaction.reply({content:`🎫 Ticket created: ${c}`,ephemeral:true});
}

async function registerCommands(){
  const commands=[
    new SlashCommandBuilder().setName('setup').setDescription('Create or repair Goll').addBooleanOption(o=>o.setName('repair').setDescription('Only repair missing resources')),
    new SlashCommandBuilder().setName('goll').setDescription('Open Goll control center'),
    new SlashCommandBuilder().setName('warn').setDescription('Warn a member').addUserOption(o=>o.setName('user').setDescription('Member').setRequired(true)).addStringOption(o=>o.setName('reason').setDescription('Reason').setRequired(true)),
    new SlashCommandBuilder().setName('warnings').setDescription('Show member warnings').addUserOption(o=>o.setName('user').setDescription('Member').setRequired(true)),
    new SlashCommandBuilder().setName('timeout').setDescription('Timeout a member').addUserOption(o=>o.setName('user').setDescription('Member').setRequired(true)).addIntegerOption(o=>o.setName('minutes').setDescription('Minutes').setRequired(true).setMinValue(1).setMaxValue(40320)).addStringOption(o=>o.setName('reason').setDescription('Reason')),
    new SlashCommandBuilder().setName('kick').setDescription('Kick a member').addUserOption(o=>o.setName('user').setDescription('Member').setRequired(true)).addStringOption(o=>o.setName('reason').setDescription('Reason')),
    new SlashCommandBuilder().setName('ban').setDescription('Ban a member').addUserOption(o=>o.setName('user').setDescription('Member').setRequired(true)).addStringOption(o=>o.setName('reason').setDescription('Reason')),
    new SlashCommandBuilder().setName('modlogs').setDescription('Show recent moderation actions').addUserOption(o=>o.setName('user').setDescription('Member')),
    new SlashCommandBuilder().setName('clear').setDescription('Delete recent messages').addIntegerOption(o=>o.setName('amount').setDescription('1-100').setRequired(true).setMinValue(1).setMaxValue(100)),
    new SlashCommandBuilder().setName('giveaway').setDescription('Create a giveaway').addStringOption(o=>o.setName('prize').setDescription('Prize').setRequired(true)).addIntegerOption(o=>o.setName('minutes').setDescription('Duration').setRequired(true).setMinValue(1).setMaxValue(10080)),
    new SlashCommandBuilder().setName('balance').setDescription('Show balance').addUserOption(o=>o.setName('user').setDescription('Member')),
    new SlashCommandBuilder().setName('daily').setDescription('Claim daily coins'),
    new SlashCommandBuilder().setName('pay').setDescription('Pay coins').addUserOption(o=>o.setName('user').setDescription('Member').setRequired(true)).addIntegerOption(o=>o.setName('amount').setDescription('Amount').setRequired(true).setMinValue(1)),
    new SlashCommandBuilder().setName('invites').setDescription('Show invite stats').addUserOption(o=>o.setName('user').setDescription('Member')),
    new SlashCommandBuilder().setName('voice').setDescription('Create your temporary voice channel')
  ];
  await client.application.commands.set(commands.map(x=>x.toJSON()));
}

client.once('ready',async()=>{await dbInit();await registerCommands();for(const g of client.guilds.cache.values()){ await initInvites(g); try{ await setupGuild(g,false); }catch(e){ console.error('Panel/setup:',e.message); }} console.log(`Goll online as ${client.user.tag} | TTS token: ${TTS_TOKEN?'configured':'not configured'}`);
  await nitro.recover();
  const open=(await q("SELECT message_id,ends_at FROM giveaways WHERE status='OPEN'",[])).rows;
  for(const g of open){const ms=Math.max(1000,new Date(g.ends_at).getTime()-Date.now());setTimeout(()=>finishGiveaway(g.message_id),ms);}
  const checks=(await q("SELECT id,deadline FROM activity_checks WHERE status='OPEN'",[])).rows;
  for(const x of checks){const ms=Math.max(1000,new Date(x.deadline).getTime()-Date.now());setTimeout(()=>closeActivity(x.id),ms);}
});

client.on('guildMemberAdd',async member=>{
  try{
    const before=new Map((await q('SELECT code,uses FROM invite_codes WHERE guild_id=$1',[member.guild.id])).rows.map(x=>[x.code,x.uses]));
    const current=await member.guild.invites.fetch();
    let used=null;
    for(const inv of current.values()){const old=before.get(inv.code)||0;if((inv.uses||0)>old){used=inv;break;}}
    if(used){
      await q('INSERT INTO invite_uses(guild_id,user_id,inviter_id,code) VALUES($1,$2,$3,$4) ON CONFLICT(guild_id,user_id) DO NOTHING',[member.guild.id,member.id,used.inviterId,used.code]);
      await q('UPDATE invite_codes SET uses=$1 WHERE guild_id=$2 AND code=$3',[used.uses||0,member.guild.id,used.code]);
      const ch=member.guild.channels.cache.find(c=>c.name==='📢・announcements'&&c.type===ChannelType.GuildText);
      if(ch&&used.inviterId) await ch.send(`🎉 Welcome <@${member.id}>! Invited by <@${used.inviterId}>.`).catch(()=>{});
    }
    await initInvites(member.guild);
  }catch(e){console.error('Invite tracking:',e.message);}
});
client.on('guildMemberRemove',async member=>{ /* invite attribution remains stored */ });
client.on('voiceStateUpdate',async(oldS,newS)=>{
  if(!newS.channelId||newS.channelId===oldS.channelId) return;
  const cfg=(await q('SELECT data FROM guild_config WHERE guild_id=$1',[newS.guild.id])).rows[0]?.data;
  const trigger=cfg?.channels?.['🔊 VOICE']?.['🔊・General'];
  if(newS.channelId!==trigger) return;
  const existing=(await q('SELECT channel_id FROM temp_voice WHERE guild_id=$1 AND owner_id=$2',[newS.guild.id,newS.member.id])).rows[0];
  if(existing) return;
  const c=await newS.guild.channels.create({name:`🔊・${newS.member.displayName}'s Room`.slice(0,100),type:ChannelType.GuildVoice,parent:newS.channel?.parentId});
  await q('INSERT INTO temp_voice(channel_id,guild_id,owner_id) VALUES($1,$2,$3)',[c.id,newS.guild.id,newS.member.id]);
  await newS.setChannel(c).catch(()=>{});
});
client.on('voiceStateUpdate',async(oldS,newS)=>{
  try{
    if(!oldS.channelId && newS.channelId && newS.channel.name==='👋・Welcome' && !newS.member.user.bot){
      if (pool) {
        const seen = await q('INSERT INTO welcome_tts_seen(guild_id,user_id) VALUES($1,$2) ON CONFLICT(guild_id,user_id) DO NOTHING RETURNING user_id',[newS.guild.id,newS.member.id]);
        if (!seen.rows.length) return;
      }
      await playWelcomeTTS(newS.member).catch(e=>console.error('Welcome TTS:',e.message));
    }
    if(!oldS.channelId && newS.channelId){
      const cfg=(await q('SELECT data FROM guild_config WHERE guild_id=$1',[newS.guild.id])).rows[0]?.data;
      const trigger=cfg?.channels?.['🔊 VOICE']?.['🔊・General'];
      if(trigger && newS.channelId===trigger){
        const existing=(await q('SELECT channel_id FROM temp_voice WHERE guild_id=$1 AND owner_id=$2',[newS.guild.id,newS.member.id])).rows[0];
        if(!existing){
          const c=await newS.guild.channels.create({name:'🔊・'+newS.member.displayName+"'s Room".slice(0,100),type:ChannelType.GuildVoice,parent:newS.channel.parentId});
          await q('INSERT INTO temp_voice(channel_id,guild_id,owner_id) VALUES($1,$2,$3)',[c.id,newS.guild.id,newS.member.id]);
          await newS.member.voice.setChannel(c).catch(()=>{});
        }
      }
    }
  }catch(e){console.error('Voice state:',e.message);}
});;

const spamTracker=new Map();

client.on('messageCreate',async message=>{
  if(!message.guild||message.author.bot||!message.member) return;
  const settings=(await q('SELECT * FROM automod_settings WHERE guild_id=$1',[message.guild.id])).rows[0] || {anti_spam:true,anti_links:true,anti_caps:true};
  if(message.member.permissions.has(PermissionsBitField.Flags.ManageMessages)||isAdmin(message.member)) return;

  let reason=null;
  if(settings.anti_links && /(https?:\/\/|discord\.gg\/|www\.)/i.test(message.content)) reason='Anti-link';
  const letters=(message.content.match(/[A-Za-z]/g)||[]).length;
  const caps=(message.content.match(/[A-Z]/g)||[]).length;
  if(!reason && settings.anti_caps && letters>=8 && caps/letters>=0.8) reason='Anti-caps';

  const now=Date.now(), key=message.guild.id+':'+message.author.id;
  const arr=(spamTracker.get(key)||[]).filter(t=>now-t<7000); arr.push(now); spamTracker.set(key,arr);
  if(!reason && settings.anti_spam && arr.length>=6) reason='Anti-spam';

  if(!reason) return;
  await message.delete().catch(()=>{});
  await q('INSERT INTO moderation_logs(guild_id,target_id,moderator_id,action,reason,metadata) VALUES($1,$2,$3,$4,$5,$6)',[message.guild.id,message.author.id,client.user.id,'AUTOMOD',reason,JSON.stringify({channel_id:message.channel.id})]);
  const key2=message.guild.id+':'+message.author.id+':strikes';
  const strikes=(spamTracker.get(key2)||[]); strikes.push(now); spamTracker.set(key2,strikes.filter(t=>now-t<600000));
  const n=spamTracker.get(key2).length;
  if(n>=3){const member=message.member;await member.timeout(5*60*1000,'Goll AutoMod: repeated violations').catch(()=>{});}
});

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
        await i.deferReply({ephemeral:true}); const r=await setupGuild(i.guild,i.options.getBoolean('repair')===true);
        return i.editReply(`✅ Goll setup complete — ${Object.keys(r.roles).length} roles, ${Object.keys(r.channels).length} categories.`);
      }
      if(cmd==='goll') { if(!isOwner(i.member)) return i.reply({content:'❌ Only the server owner can open Goll Owner Control.',ephemeral:true}); return i.reply({ephemeral:true,embeds:[new EmbedBuilder().setTitle('🤖 Goll Owner Control').setDescription('Use **/gollowner** for the full private owner control panel.').setColor(0x5865F2)]}); }
      if(['warn','warnings','timeout','kick','ban','modlogs','clear'].includes(cmd)){
        if(!isStaff(i.member)) return i.reply({content:'❌ Staff only.',ephemeral:true});
        const u=i.options.getUser('user');
        if(cmd==='modlogs'){
          const filter=i.options.getUser('user');
          const rows=(await q(`SELECT target_id,action,reason,moderator_id,created_at FROM moderation_logs WHERE guild_id=$1 ${filter?'AND target_id=$2':''} ORDER BY created_at DESC LIMIT 15`,filter?[i.guild.id,filter.id]:[i.guild.id])).rows;
          return i.reply({embeds:[new EmbedBuilder().setTitle('🛡️ Moderation Logs').setDescription(rows.length?rows.map(x=>`• **${x.action}** — <@${x.target_id}> — ${x.reason||'No reason'} — <t:${Math.floor(new Date(x.created_at).getTime()/1000)}:R>`).join('\\n'):'No moderation actions found.').setColor(0x5865F2)]});
        }
        if(cmd==='clear'){
          if(!i.member.permissions.has(PermissionsBitField.Flags.ManageMessages)) return i.reply({content:'❌ Manage Messages is required.',ephemeral:true});
          const amount=i.options.getInteger('amount'); const deleted=await i.channel.bulkDelete(amount,true);
          await q('INSERT INTO moderation_logs(guild_id,target_id,moderator_id,action,reason,metadata) VALUES($1,$2,$3,$4,$5,$6)',[i.guild.id,i.user.id,i.user.id,'CLEAR',`Deleted ${deleted.size} messages`,JSON.stringify({amount:deleted.size})]);
          return i.reply({content:`🧹 Deleted **${deleted.size}** messages.`,ephemeral:true});
        }
        if(cmd==='warn'){
          const reason=i.options.getString('reason');
          const target=await i.guild.members.fetch(u.id).catch(()=>null);
          if(!target) return i.reply({content:'❌ Member not found.',ephemeral:true});
          if(u.id===i.user.id || target.permissions.has(PermissionsBitField.Flags.Administrator)) return i.reply({content:'❌ You cannot moderate yourself or an Administrator.',ephemeral:true});
          const count=(await q('SELECT COUNT(*)::int AS n FROM warnings WHERE guild_id=$1 AND user_id=$2',[i.guild.id,u.id])).rows[0].n+1;
          await q('INSERT INTO warnings(guild_id,user_id,moderator_id,reason) VALUES($1,$2,$3,$4)',[i.guild.id,u.id,i.user.id,reason]);
          await q('INSERT INTO moderation_logs(guild_id,target_id,moderator_id,action,reason,metadata) VALUES($1,$2,$3,$4,$5,$6)',[i.guild.id,u.id,i.user.id,'WARN',reason,JSON.stringify({warning_count:count})]);
          let escalation='No automatic escalation';
          if(count===3){await target.timeout(10*60*1000,'Goll: 3 warnings').catch(()=>{});escalation='10 minute timeout';}
          else if(count===5){await target.timeout(60*60*1000,'Goll: 5 warnings').catch(()=>{});escalation='1 hour timeout';}
          else if(count===7){await target.kick('Goll: 7 warnings').catch(()=>{});escalation='kick';}
          else if(count>=10){await target.ban({reason:'Goll: 10+ warnings'}).catch(()=>{});escalation='ban';}
          await u.send(`⚠️ You were warned in ${i.guild.name}: ${reason}\\nWarning #${count}. ${escalation}`).catch(()=>{});
          return i.reply(`⚠️ ${u} warned. Warning #${count}. ${escalation}.`);
        }
        if(cmd==='warnings'){
          const rows=(await q('SELECT reason,created_at FROM warnings WHERE guild_id=$1 AND user_id=$2 ORDER BY created_at DESC LIMIT 10',[i.guild.id,u.id])).rows;
          return i.reply({embeds:[new EmbedBuilder().setTitle('⚠️ Warnings').setDescription(rows.length?rows.map((x,n)=>`${n+1}. ${x.reason} — <t:${Math.floor(new Date(x.created_at).getTime()/1000)}:R>`).join('\\n'):'No warnings.').setColor(0xF1C40F)]});
        }
        const m=await i.guild.members.fetch(u.id).catch(()=>null); if(!m)return i.reply({content:'Member not found.',ephemeral:true});
        if(m.id===i.user.id || m.roles.highest.position>=i.member.roles.highest.position) return i.reply({content:'❌ You cannot moderate yourself or a member with an equal/higher role.',ephemeral:true});
        if(cmd==='timeout'){
          const min=i.options.getInteger('minutes'), reason=i.options.getString('reason')||'Goll moderation';
          await m.timeout(min*60000,reason);
          await q('INSERT INTO moderation_logs(guild_id,target_id,moderator_id,action,reason,metadata) VALUES($1,$2,$3,$4,$5,$6)',[i.guild.id,m.id,i.user.id,'TIMEOUT',reason,JSON.stringify({minutes:min})]);
          return i.reply(`⏳ ${u} timed out for ${min} minutes.`);
        }
        if(cmd==='kick'){
          const reason=i.options.getString('reason')||'Goll moderation'; await m.kick(reason);
          await q('INSERT INTO moderation_logs(guild_id,target_id,moderator_id,action,reason) VALUES($1,$2,$3,$4,$5)',[i.guild.id,m.id,i.user.id,'KICK',reason]);
          return i.reply(`👢 ${u.tag} kicked.`);
        }
        if(cmd==='ban'){
          const reason=i.options.getString('reason')||'Goll moderation'; await m.ban({reason});
          await q('INSERT INTO moderation_logs(guild_id,target_id,moderator_id,action,reason) VALUES($1,$2,$3,$4,$5)',[i.guild.id,m.id,i.user.id,'BAN',reason]);
          return i.reply(`🔨 ${u.tag} banned.`);
        }
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
      if(cmd==='activity'){
        if(!isAdmin(i.member)) return i.reply({content:'❌ Admin only.',ephemeral:true});
        const minutes=i.options.getInteger('minutes'), deadline=Date.now()+minutes*60000;
        const ch=i.guild.channels.cache.find(c=>c.name==='📋・activity-check'&&c.type===ChannelType.GuildText);
        if(!ch) return i.reply({content:'❌ Run /setup first.',ephemeral:true});
        const row=new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId('activity_here').setLabel("I'M ACTIVE").setStyle(ButtonStyle.Success));
        const msg=await ch.send({embeds:[new EmbedBuilder().setTitle('📋 Staff Activity Check').setDescription(`Click I'M ACTIVE before <t:${Math.floor(deadline/1000)}:R>. Approved LOA is exempt.`).setColor(0x57F287)],components:[row]});
        const r=await q('INSERT INTO activity_checks(guild_id,message_id,channel_id,deadline) VALUES($1,$2,$3,to_timestamp($4/1000.0)) RETURNING id',[i.guild.id,msg.id,ch.id,deadline]);
        setTimeout(()=>closeActivity(r.rows[0].id),minutes*60000);
        return i.reply({content:`✅ Activity check started for ${minutes} minutes.`,ephemeral:true});
      }
      if(cmd==='voice') return createTempVoice(i);
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
        if(!isOwner(i.member)) return i.reply({content:'❌ Staff only.',ephemeral:true});
        const prize=i.options.getString('prize'), minutes=i.options.getInteger('minutes'), end=Date.now()+minutes*60000;
        const row=new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId('giveaway_join').setLabel('🎉 ENTER').setStyle(ButtonStyle.Success),
      new ButtonBuilder().setCustomId('giveaway_reroll').setLabel('🔄 REROLL').setStyle(ButtonStyle.Secondary));
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
      if(i.customId==='staff_active'){if(!isStaff(i.member))return i.reply({content:'❌ Staff only.',ephemeral:true});await q('INSERT INTO staff_status(guild_id,user_id,active) VALUES($1,$2,true) ON CONFLICT(guild_id,user_id) DO UPDATE SET active=true,updated_at=NOW()',[i.guild.id,i.user.id]);return i.reply({content:'🟢 You are marked ACTIVE.',ephemeral:true});}
      if(i.customId==='staff_loa'){if(!isStaff(i.member))return i.reply({content:'❌ Staff only.',ephemeral:true});return i.showModal(new ModalBuilder().setCustomId('loa_modal').setTitle('🏖️ Request LOA').addComponents(new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('days').setLabel('Duration (1-14 days)').setStyle(TextInputStyle.Short).setRequired(true)),new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('reason').setLabel('Reason').setStyle(TextInputStyle.Paragraph).setRequired(true)),new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('extra').setLabel('Extra info (optional)').setStyle(TextInputStyle.Paragraph).setRequired(false))));}
      if(i.customId==='staff_refresh'){if(!isStaff(i.member))return i.reply({content:'❌ Staff only.',ephemeral:true});const s=(await q('SELECT active,loa_until FROM staff_status WHERE guild_id=$1 AND user_id=$2',[i.guild.id,i.user.id])).rows[0];return i.reply({content:'📊 Status: '+(s?.active?'ACTIVE':'INACTIVE')+(s?.loa_until?' | LOA until '+new Date(s.loa_until).toLocaleDateString() :''),ephemeral:true});}
      if(i.customId==='staff_apply_status'){
        const a=(await q('SELECT id,status,reviewer_id,decision_reason,created_at,updated_at FROM applications WHERE guild_id=$1 AND user_id=$2 ORDER BY created_at DESC LIMIT 1',[i.guild.id,i.user.id])).rows[0];
        if(!a) return i.reply({content:'📋 You have no application yet.',ephemeral:true});
        return i.reply({content:`📋 Application #${a.id} — **${a.status}**${a.decision_reason?'\\nReason: '+a.decision_reason:''}`,ephemeral:true});
      }

      if(i.customId==='staff_end_loa'){if(!isStaff(i.member))return i.reply({content:'❌ Staff only.',ephemeral:true});await q('UPDATE staff_status SET active=true,loa_until=NULL,loa_reason=NULL,updated_at=NOW() WHERE guild_id=$1 AND user_id=$2',[i.guild.id,i.user.id]);return i.reply({content:'🔙 Your LOA has ended. You are ACTIVE again.',ephemeral:true});}
      if(i.customId==='activity_start'){if(!isAdmin(i.member))return i.reply({content:'❌ Admin only.',ephemeral:true});return i.showModal(new ModalBuilder().setCustomId('activity_modal').setTitle('📋 Start Activity Check').addComponents(new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('minutes').setLabel('Response window (minutes)').setStyle(TextInputStyle.Short).setRequired(true))));}
      if(i.customId==='activity_close'){if(!isAdmin(i.member))return i.reply({content:'❌ Admin only.',ephemeral:true});const open=(await q("SELECT id FROM activity_checks WHERE guild_id=$1 AND status='OPEN' ORDER BY id DESC LIMIT 1",[i.guild.id])).rows[0];if(!open)return i.reply({content:'❌ No open activity check.',ephemeral:true});await closeActivity(open.id,i.user.id);return i.reply({content:'🔒 Activity check closed.',ephemeral:true});}
      if(i.customId==='giveaway_create'){if(!isOwner(i.member))return i.reply({content:'❌ Staff only.',ephemeral:true});return i.showModal(new ModalBuilder().setCustomId('giveaway_modal').setTitle('🎁 Create Giveaway').addComponents(new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('prize').setLabel('Prize').setStyle(TextInputStyle.Short).setRequired(true)),new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('minutes').setLabel('Duration (minutes)').setStyle(TextInputStyle.Short).setRequired(true))));}
      if(i.customId.startsWith('app_')){
        if(!isAdmin(i.member)) return i.reply({content:'❌ Admin only.',ephemeral:true});
        const [action,id]=i.customId.split(':');
        const requested={app_interview:'INTERVIEW',app_accept:'ACCEPTED',app_deny:'DENIED',app_archive:'ARCHIVED'}[action];
        if(!requested) return;
        const app=(await q('SELECT * FROM applications WHERE id=$1 AND guild_id=$2',[id,i.guild.id])).rows[0];
        if(!app) return i.reply({content:'❌ Application not found.',ephemeral:true});

        const allowed =
          requested==='INTERVIEW' ? app.status==='PENDING' :
          requested==='ACCEPTED' || requested==='DENIED' ? app.status==='INTERVIEW' :
          requested==='ARCHIVED' ? app.status!=='ARCHIVED' : false;
        if(!allowed) return i.reply({content:`❌ Invalid status change. Current status: **${app.status}**.`,ephemeral:true});

        let reason='';
        if(requested==='DENIED'){
          const modal=new ModalBuilder().setCustomId(`app_deny_modal:${id}`).setTitle('❌ Deny Application').addComponents(
            new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('reason').setLabel('Reason').setStyle(TextInputStyle.Paragraph).setRequired(true))
          );
          return i.showModal(modal);
        }

        await q('UPDATE applications SET status=$1,reviewer_id=$2,reviewed_at=NOW(),updated_at=NOW() WHERE id=$3',[requested,i.user.id,id]);

        if(requested==='ACCEPTED'){
          const member=await i.guild.members.fetch(app.user_id).catch(()=>null);
          const trial=i.guild.roles.cache.find(r=>r.name==='📝 Trial Staff');
          if(member&&trial) await member.roles.add(trial).catch(()=>{});
        }

        const logText=`📋 Application #${id} → **${requested}**\\nReviewer: ${i.user}\\nApplicant: <@${app.user_id}>`;
        const statusEmoji={INTERVIEW:'🎤',ACCEPTED:'✅',DENIED:'❌',ARCHIVED:'📦'}[requested];
        const updatedEmbed=i.message?.embeds?.[0]
          ? EmbedBuilder.from(i.message.embeds[0]).setTitle(`📝 Staff Application #${id} — ${statusEmoji} ${requested}`)
          : null;
        if(requested==='ARCHIVED'){
          if(i.channel?.isTextBased()) await i.channel.send({content:logText}).catch(()=>{});
        }
        await client.users.fetch(app.user_id).then(u=>u.send(`📋 Your staff application #${id} is now **${requested}**.`).catch(()=>{})).catch(()=>{});

        return i.update({
          content:logText,
          embeds:updatedEmbed?[updatedEmbed]:[],
          components:[]
        });
      }
      if(i.customId==='activity_here'){
        if(!isStaff(i.member)) return i.reply({content:'❌ Staff only.',ephemeral:true});
        const check=(await q('SELECT id,status FROM activity_checks WHERE message_id=$1',[i.message.id])).rows[0];
        if(!check||check.status!=='OPEN') return i.reply({content:'❌ This check is closed.',ephemeral:true});
        await q(`INSERT INTO activity_responses(check_id,guild_id,user_id) VALUES($1,$2,$3) ON CONFLICT DO NOTHING`,[check.id,i.guild.id,i.user.id]);
        await q(`INSERT INTO staff_status(guild_id,user_id,active) VALUES($1,$2,true) ON CONFLICT(guild_id,user_id) DO UPDATE SET active=true,updated_at=NOW()`,[i.guild.id,i.user.id]);
        return i.reply({content:'🟢 Recorded — you are ACTIVE for this check.',ephemeral:true});
      }
      if(i.customId==='goll_ticket_menu') return i.reply({content:'Choose a ticket type:',components:[new ActionRowBuilder().addComponents(new StringSelectMenuBuilder().setCustomId('ticket_type').setPlaceholder('🎫 Select a type').addOptions(
        ['🛠️ General Support','🚨 Report a User','🤝 Partnership','📝 Staff Question','💳 Purchase Support'].map(x=>({label:x.slice(2),value:x}))
      ))],ephemeral:true});
      if(i.customId==='ticket_claim'){
        if(!isStaff(i.member))return i.reply({content:'❌ Staff only.',ephemeral:true});
        await q('UPDATE tickets SET claimed_by=$1 WHERE channel_id=$2',[i.user.id,i.channel.id]); return i.reply(`🙋 Ticket claimed by ${i.user}.`);
      }
      if(i.customId==='ticket_close'){
        if(!isStaff(i.member))return i.reply({content:'❌ Staff only.',ephemeral:true});
        const t=(await q('SELECT opener_id FROM tickets WHERE channel_id=$1',[i.channel.id])).rows[0];
        await q('UPDATE tickets SET closed=true,closed_at=NOW() WHERE channel_id=$1',[i.channel.id]);
        if(t?.opener_id) await i.channel.permissionOverwrites.edit(t.opener_id,{SendMessages:false}).catch(()=>{});
        await i.channel.setName(('closed-'+i.channel.name).slice(0,100)).catch(()=>{});
        return i.reply({content:'🔒 Ticket closed. Use Reopen if needed, or Transcript to export the conversation.'});
      }
      if(i.customId==='ticket_reopen'){
        if(!isStaff(i.member))return i.reply({content:'❌ Staff only.',ephemeral:true});
        const t=(await q('SELECT opener_id,closed FROM tickets WHERE channel_id=$1',[i.channel.id])).rows[0];
        if(!t?.closed)return i.reply({content:'ℹ️ Ticket is already open.',ephemeral:true});
        await q('UPDATE tickets SET closed=false WHERE channel_id=$1',[i.channel.id]);
        if(t.opener_id) await i.channel.permissionOverwrites.edit(t.opener_id,{SendMessages:true}).catch(()=>{});
        await i.channel.setName(i.channel.name.replace(/^closed-/,'').slice(0,100)).catch(()=>{});
        return i.reply('🔓 Ticket reopened.');
      }
      if(i.customId==='ticket_add'){
        if(!isStaff(i.member))return i.reply({content:'❌ Staff only.',ephemeral:true});
        const modal=new ModalBuilder().setCustomId('ticket_add_modal').setTitle('➕ Add Member').addComponents(
          new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('user_id').setLabel('Discord User ID').setStyle(TextInputStyle.Short).setRequired(true))
        );
        return i.showModal(modal);
      }
      if(i.customId==='ticket_transcript'){
        if(!isStaff(i.member))return i.reply({content:'❌ Staff only.',ephemeral:true});
        const msgs=await i.channel.messages.fetch({limit:100}).catch(()=>new Map());
        const lines=[...msgs.values()].sort((a,b)=>a.createdTimestamp-b.createdTimestamp).map(m=>`[${new Date(m.createdTimestamp).toISOString()}] ${m.author.tag}: ${m.content || '[embed/attachment]'}`);
        const file=new AttachmentBuilder(Buffer.from(lines.join('\\n')||'No messages.','utf8'),{name:`transcript-${i.channel.id}.txt`});
        return i.reply({content:'📄 Transcript generated.',files:[file],ephemeral:true});
      }
      if(i.customId==='giveaway_reroll'){
        if(!isOwner(i.member)) return i.reply({content:'❌ Staff only.',ephemeral:true});
        const r=(await q("SELECT * FROM giveaways WHERE message_id=$1",[i.message.id])).rows[0];
        if(!r || r.status==='OPEN') return i.reply({content:'❌ The giveaway must be finished before rerolling.',ephemeral:true});
        const p=(r.participants||[]).filter(x=>x!==r.winner_id);
        if(!p.length) return i.reply({content:'❌ No other eligible entries.',ephemeral:true});
        const winner=p[Math.floor(Math.random()*p.length)];
        await q('UPDATE giveaways SET winner_id=$1,reward_claimed=false WHERE message_id=$2',[winner,i.message.id]);
        const winners=i.guild.channels.cache.find(x=>x.name==='🏆・winners'&&x.type===ChannelType.GuildText);
        if(winners) await winners.send({embeds:[new EmbedBuilder().setTitle('🔄 Giveaway Reroll').setDescription(`Prize: **${r.prize}**\\nNew winner: <@${winner}>\\nRerolled by: ${i.user}`).setColor(0x5865F2)]});
        return i.reply(`🔄 New winner: <@${winner}> — **${r.prize}**!`);
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

    if(i.isStringSelectMenu() && i.customId==='ticket_type') return openTicket(i,i.values[0]);

    if(i.isModalSubmit()){
      if(i.customId==='loa_modal'){
        const days=Math.max(1,Math.min(14,parseInt(i.fields.getTextInputValue('days'),10)||1)),reason=i.fields.getTextInputValue('reason'),extra=i.fields.fields.has('extra')?i.fields.getTextInputValue('extra'):'';
        const until=new Date(Date.now()+days*86400000);
        await q(`INSERT INTO staff_status(guild_id,user_id,active,loa_until,loa_reason) VALUES($1,$2,false,$3,$4) ON CONFLICT(guild_id,user_id) DO UPDATE SET active=false,loa_until=$3,loa_reason=$4,updated_at=NOW()`,[i.guild.id,i.user.id,until,reason+(extra?' | '+extra:'')]);
        const log=i.guild.channels.cache.find(c=>c.name==='🏖️・loa-logs'&&c.type===ChannelType.GuildText);        const row=new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId('loa_accept:'+i.user.id).setLabel('✅ Accept').setStyle(ButtonStyle.Success),new ButtonBuilder().setCustomId('loa_decline:'+i.user.id).setLabel('❌ Decline').setStyle(ButtonStyle.Danger));
        if(log) await log.send({embeds:[new EmbedBuilder().setTitle('🏖️ LOA Request').setDescription(`Staff: ${i.user}\\nDuration: **${days} days**\\nReturn: <t:${Math.floor(until.getTime()/1000)}:F>\\nReason: ${reason}${extra?'\\nExtra: '+extra:''}`).setColor(0xF1C40F)],components:[row]});
        return i.reply({content:`🏖️ LOA submitted for ${days} days. Awaiting staff review.`,ephemeral:true});
      }
      if(i.customId==='ticket_add_modal'){
        const userId=i.fields.getTextInputValue('user_id').trim();
        const member=await i.guild.members.fetch(userId).catch(()=>null);
        if(!member)return i.reply({content:'❌ Member not found.',ephemeral:true});
        await i.channel.permissionOverwrites.edit(member.id,{ViewChannel:true,SendMessages:true,ReadMessageHistory:true});
        return i.reply({content:`➕ Added ${member} to this ticket.`});
      }
      if(i.customId==='activity_modal'){const minutes=Math.max(1,Math.min(10080,parseInt(i.fields.getTextInputValue('minutes'),10)||1)),deadline=Date.now()+minutes*60000;const ch=i.guild.channels.cache.find(c=>c.name==='📋・activity-check'&&c.type===ChannelType.GuildText);const row=new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId('activity_here').setLabel("I'M ACTIVE").setStyle(ButtonStyle.Success));const msg=await ch.send({embeds:[new EmbedBuilder().setTitle('📋 Staff Activity Check').setDescription(`Click I'M ACTIVE before <t:${Math.floor(deadline/1000)}:R>. Approved LOA is exempt.`).setColor(0x57F287)],components:[row]});const r=await q('INSERT INTO activity_checks(guild_id,message_id,channel_id,deadline) VALUES($1,$2,$3,to_timestamp($4/1000.0)) RETURNING id',[i.guild.id,msg.id,ch.id,deadline]);setTimeout(()=>closeActivity(r.rows[0].id),minutes*60000);return i.reply({content:`✅ Activity check started for ${minutes} minutes.`,ephemeral:true});}
      if(i.customId==='giveaway_modal'){const prize=i.fields.getTextInputValue('prize'),minutes=Math.max(1,Math.min(10080,parseInt(i.fields.getTextInputValue('minutes'),10)||1)),end=Date.now()+minutes*60000;const row=new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId('giveaway_join').setLabel('🎉 ENTER').setStyle(ButtonStyle.Success));const ch=i.guild.channels.cache.find(c=>c.name==='🎉・giveaways'&&c.type===ChannelType.GuildText);const msg=await ch.send({embeds:[new EmbedBuilder().setTitle('🎁 Giveaway').setDescription(`**Prize:** ${prize}\\n**Ends:** <t:${Math.floor(end/1000)}:R>\\nClick ENTER to participate!`).setColor(0xF1C40F)],components:[row]});await q('INSERT INTO giveaways(message_id,guild_id,channel_id,prize,ends_at) VALUES($1,$2,$3,$4,to_timestamp($5/1000.0))',[msg.id,i.guild.id,ch.id,prize,end]);setTimeout(()=>finishGiveaway(msg.id),minutes*60000);return i.reply({content:'✅ Giveaway created.',ephemeral:true});}
      if(i.customId==='apply_modal'){
        const age=i.fields.getTextInputValue('age').trim();
        const experience=i.fields.getTextInputValue('experience').trim();
        const availability=i.fields.getTextInputValue('availability').trim();

        const active=(await q("SELECT id FROM applications WHERE guild_id=$1 AND user_id=$2 AND status IN ('PENDING','INTERVIEW') ORDER BY created_at DESC LIMIT 1",[i.guild.id,i.user.id])).rows[0];
        if(active) return i.reply({content:`❌ You already have an active application (#${active.id}).`,ephemeral:true});

        const ins=await q('INSERT INTO applications(guild_id,user_id,age,experience,availability,status) VALUES($1,$2,$3,$4,$5,\'PENDING\') RETURNING id',[i.guild.id,i.user.id,age,experience,availability]);
        const appId=ins.rows[0].id;
        const log=i.guild.channels.cache.find(c=>c.name==='📋・application-logs'&&c.type===ChannelType.GuildText);
        const row=new ActionRowBuilder().addComponents(
          new ButtonBuilder().setCustomId('app_interview:'+appId).setLabel('🎤 Interview').setStyle(ButtonStyle.Secondary),
          new ButtonBuilder().setCustomId('app_accept:'+appId).setLabel('✅ Accept').setStyle(ButtonStyle.Success),
          new ButtonBuilder().setCustomId('app_deny:'+appId).setLabel('❌ Deny').setStyle(ButtonStyle.Danger),
          new ButtonBuilder().setCustomId('app_archive:'+appId).setLabel('📦 Archive').setStyle(ButtonStyle.Secondary)
        );
        const embed=new EmbedBuilder().setTitle(`📝 New Staff Application #${appId}`)
          .setDescription(`**Applicant:** ${i.user}\\n**Age:** ${age}\\n**Availability:** ${availability}\\n\\n**Why should we choose you?**\\n${experience}`)
          .addFields({name:'Status',value:'🟡 PENDING',inline:true},{name:'Submitted',value:'<t:'+Math.floor(Date.now()/1000)+':R>',inline:true})
          .setColor(0x5865F2);
        if(log) await log.send({embeds:[embed],components:[row]});
        return i.reply({content:`✅ Application #${appId} submitted. Staff will review it.`,ephemeral:true});
      }

      if(i.customId.startsWith('app_deny_modal:')){
        if(!isAdmin(i.member)) return i.reply({content:'❌ Admin only.',ephemeral:true});
        const id=i.customId.split(':')[1];
        const reason=i.fields.getTextInputValue('reason').trim();
        const app=(await q('SELECT * FROM applications WHERE id=$1 AND guild_id=$2',[id,i.guild.id])).rows[0];
        if(!app) return i.reply({content:'❌ Application not found.',ephemeral:true});
        if(app.status!=='INTERVIEW') return i.reply({content:`❌ Application is already **${app.status}**.`,ephemeral:true});
        await q('UPDATE applications SET status=\'DENIED\',reviewer_id=$1,decision_reason=$2,reviewed_at=NOW(),updated_at=NOW() WHERE id=$3',[i.user.id,reason,id]);
        const log=i.guild.channels.cache.find(c=>c.name==='📋・application-logs'&&c.type===ChannelType.GuildText);
        if(log) await log.send({embeds:[new EmbedBuilder().setTitle(`❌ Application #${id} Denied`).setDescription(`Applicant: <@${app.user_id}>\\nReviewer: ${i.user}\\nReason: ${reason}`).setColor(0xED4245)]});
        await client.users.fetch(app.user_id).then(u=>u.send(`📋 Your staff application #${id} was denied.\\nReason: ${reason}`).catch(()=>{})).catch(()=>{});
        return i.reply({content:`❌ Application #${id} denied.`,ephemeral:true});
      }
    }
    if(i.isButton() && (i.customId.startsWith('loa_accept:') || i.customId.startsWith('loa_decline:'))){
      if(!isAdmin(i.member)) return i.reply({content:'❌ Admin only.',ephemeral:true});
      const [action,userId]=i.customId.split(':'); const approved=action==='loa_accept';
      if(approved) await q('UPDATE staff_status SET active=false,updated_at=NOW() WHERE guild_id=$1 AND user_id=$2',[i.guild.id,userId]);
      else await q('UPDATE staff_status SET active=true,loa_until=NULL,loa_reason=NULL,updated_at=NOW() WHERE guild_id=$1 AND user_id=$2',[i.guild.id,userId]);
      return i.update({content:`${approved?'✅ LOA approved':'❌ LOA declined'} by ${i.user}.`,components:[]});
    }
  }catch(e){
    console.error(e); if(!i.replied&&!i.deferred) await i.reply({content:'❌ Something went wrong.',ephemeral:true}).catch(()=>{}); else if(i.deferred) await i.editReply('❌ Something went wrong.').catch(()=>{});
  }
});

async function closeActivity(id, closedBy=null){
  const r=(await q("SELECT * FROM activity_checks WHERE id=$1 AND status='OPEN'",[id])).rows[0];
  if(!r) return;
  await q("UPDATE activity_checks SET status='CLOSED',closed_by=$2 WHERE id=$1",[id,closedBy]);
  const guild=client.guilds.cache.get(r.guild_id);
  const ch=client.channels.cache.get(r.channel_id);
  if(!guild) return;
  const staffMembers=guild.members.cache.filter(m=>!m.user.bot && isStaff(m));
  const responses=new Set((await q("SELECT user_id FROM activity_responses WHERE check_id=$1",[id])).rows.map(x=>x.user_id));
  const misses=[];
  for(const member of staffMembers.values()){
    if(responses.has(member.id)) continue;
    const loa=(await q("SELECT loa_until,active FROM staff_status WHERE guild_id=$1 AND user_id=$2",[guild.id,member.id])).rows[0];
    const onApprovedLoa=loa?.loa_until && new Date(loa.loa_until).getTime()>Date.now() && loa.active===false;
    if(onApprovedLoa) continue;
    misses.push(member);
    await q("INSERT INTO activity_misses(check_id,guild_id,user_id,reason) VALUES($1,$2,$3,'NO_RESPONSE') ON CONFLICT DO NOTHING",[id,guild.id,member.id]);
  }
  if(ch){
    const embed=new EmbedBuilder().setTitle('📋 Activity Check Closed').setDescription('**Responded:** '+responses.size+'\\n**Missing:** '+misses.length+'\\n**LOA exempt:** approved LOA members were excluded.'+(closedBy?'\\n**Closed by:** <@'+closedBy+'>':'')).setColor(misses.length?0xED4245:0x57F287);
    await ch.send({embeds:[embed]});
    if(misses.length) await ch.send({content:'⚠️ No response: '+misses.map(m=>m.toString()).join(', ')});
  }
}

async function createTempVoice(i){
  const existing=(await q('SELECT channel_id FROM temp_voice WHERE guild_id=$1 AND owner_id=$2',[i.guild.id,i.user.id])).rows[0];
  if(existing) return i.reply({content:`🔊 You already own <#${existing.channel_id}>.`,ephemeral:true});
  const cat=i.guild.channels.cache.find(c=>c.name==='🔊 VOICE'&&c.type===ChannelType.GuildCategory);
  const c=await i.guild.channels.create({name:`🔊・${i.user.username}'s Room`.slice(0,100),type:ChannelType.GuildVoice,parent:cat?.id,permissionOverwrites:[{id:i.guild.id,allow:[PermissionsBitField.Flags.ViewChannel,PermissionsBitField.Flags.Connect]},{id:i.user.id,allow:[PermissionsBitField.Flags.ViewChannel,PermissionsBitField.Flags.Connect,PermissionsBitField.Flags.ManageChannels]}]});
  await q('INSERT INTO temp_voice(channel_id,guild_id,owner_id) VALUES($1,$2,$3)',[c.id,i.guild.id,i.user.id]);
  return i.reply({content:`🔊 Created ${c}`,ephemeral:true});
}

async function finishGiveaway(messageId){
  const r=(await q('SELECT * FROM giveaways WHERE message_id=$1',[messageId])).rows[0]; if(!r||r.status!=='OPEN')return;
  const p=r.participants||[], channel=client.channels.cache.get(r.channel_id), msg=channel&&await channel.messages.fetch(messageId).catch(()=>null);  const winner=p.length?p[Math.floor(Math.random()*p.length)]:null;
  await q('UPDATE giveaways SET status=$1,winner_id=$2 WHERE message_id=$3',['CLAIMED',winner,messageId]);
  if(msg) await msg.edit({components:[],embeds:[EmbedBuilder.from(msg.embeds[0]).setDescription(`**Prize:** ${r.prize}\\n**Winner:** ${winner?`<@${winner}>`:'No eligible entries.'}`).setColor(0x57F287)]}).catch(()=>{});
  if(channel) await channel.send(winner?`🎉 Congratulations <@${winner}>! You won **${r.prize}**!`:'⏰ Giveaway expired with no entries.');
}

client.login(DISCORD_TOKEN);
