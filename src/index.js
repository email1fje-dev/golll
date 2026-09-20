const { Client, GatewayIntentBits, Partials, PermissionsBitField, ChannelType, ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder } = require('discord.js');
const { Pool } = require('pg');

const token = process.env.DISCORD_TOKEN;
if (!token) throw new Error('Missing DISCORD_TOKEN');

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildVoiceStates
  ],
  partials: [Partials.Channel]
});

const pool = process.env.DATABASE_URL
  ? new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } })
  : null;

const MANAGED_ROLES = [
  ['👑 Owner', true], ['🛡️ Admin', true], ['🔨 Moderator', true],
  ['🎫 Support', true], ['📝 Trial Staff', true], ['💎 Booster', false],
  ['🤖 Bots', false], ['👤 Member', false]
];

const CATEGORIES = {
  '📌 INFORMATION': [
    ['📜・rules', ChannelType.GuildText], ['📢・announcements', ChannelType.GuildText],
    ['👋・welcome', ChannelType.GuildText], ['ℹ️・about-us', ChannelType.GuildText]
  ],
  '💬 COMMUNITY': [
    ['💬・general', ChannelType.GuildText], ['🖼️・media', ChannelType.GuildText],
    ['😂・memes', ChannelType.GuildText], ['🎮・gaming', ChannelType.GuildText],
    ['📊・levels', ChannelType.GuildText]
  ],
  '🎫 SUPPORT': [
    ['🎫・tickets', ChannelType.GuildText], ['📝・apply-for-staff', ChannelType.GuildText],
    ['🤝・partnerships', ChannelType.GuildText]
  ],
  '🎁 GIVEAWAYS': [
    ['🎉・giveaways', ChannelType.GuildText], ['💎・nitro-drops', ChannelType.GuildText],
    ['🏆・winners', ChannelType.GuildText]
  ],
  '👮 STAFF': [
    ['📋・activity-check', ChannelType.GuildText], ['🏖️・request-loa', ChannelType.GuildText],
    ['💼・staff-panel', ChannelType.GuildText], ['📚・staff-info', ChannelType.GuildText]
  ],
  '🔐 STAFF LOGS': [
    ['📋・application-logs', ChannelType.GuildText], ['🎫・ticket-logs', ChannelType.GuildText],
    ['🏖️・loa-logs', ChannelType.GuildText], ['⚙️・updates-logs', ChannelType.GuildText]
  ],
  '🔊 VOICE': [
    ['👋・Welcome', ChannelType.GuildVoice], ['🔊・General', ChannelType.GuildVoice],
    ['🎮・Gaming', ChannelType.GuildVoice], ['🔒・Private VC', ChannelType.GuildVoice]
  ]
};

async function dbInit() {
  if (!pool) return;
  await pool.query(`CREATE TABLE IF NOT EXISTS guild_config (
    guild_id TEXT PRIMARY KEY,
    configured_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    data JSONB NOT NULL DEFAULT '{}'::jsonb
  )`);
}

async function saveConfig(guildId, data) {
  if (!pool) return;
  await pool.query(
    'INSERT INTO guild_config (guild_id,data) VALUES ($1,$2) ON CONFLICT (guild_id) DO UPDATE SET data=$2',
    [guildId, JSON.stringify(data)]
  );
}

async function ensureRole(guild, name, managed) {
  let role = guild.roles.cache.find(r => r.name === name);
  if (!role) role = await guild.roles.create({ name, reason: 'Goll setup' });
  if (managed) {
    try {
      await role.setPermissions(new PermissionsBitField());
    } catch {}
  }
  return role;
}

async function ensureCategory(guild, name) {
  return guild.channels.cache.find(c => c.type === ChannelType.GuildCategory && c.name === name)
    || guild.channels.create({ name, type: ChannelType.GuildCategory, reason: 'Goll setup' });
}

async function ensureChannel(guild, category, name, type) {
  return guild.channels.cache.find(c => c.parentId === category.id && c.name === name && c.type === type)
    || guild.channels.create({ name, type, parent: category.id, reason: 'Goll setup' });
}

async function setupGuild(guild, repair = false) {
  const roles = {};
  for (const [name, managed] of MANAGED_ROLES) roles[name] = (await ensureRole(guild, name, managed)).id;

  const channels = {};
  for (const [categoryName, children] of Object.entries(CATEGORIES)) {
    const category = await ensureCategory(guild, categoryName);
    channels[categoryName] = {};
    for (const [name, type] of children) {
      channels[categoryName][name] = (await ensureChannel(guild, category, name, type)).id;
    }
  }

  const memberRole = guild.roles.cache.get(roles['👤 Member']);
  if (memberRole) {
    await guild.channels.fetch();
    for (const channel of guild.channels.cache.values()) {
      if (!channel.isTextBased() || channel.isThread()) continue;
      if (channel.name === 'rules' || channel.name === 'announcements') continue;
      try {
        await channel.permissionOverwrites.edit(memberRole, { ViewChannel: true, SendMessages: true });
      } catch {}
    }
  }

  const welcome = guild.channels.cache.find(c => c.name === '📢・welcome' && c.type === ChannelType.GuildText);
  if (welcome) {
    const embed = new EmbedBuilder()
      .setTitle('👋 Welcome to the server!')
      .setDescription('Welcome! Read the rules, chat with the community, and open a ticket if you need help.')
      .setColor(0x5865F2);
    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId('goll_about').setLabel('About').setStyle(ButtonStyle.Secondary),
      new ButtonBuilder().setCustomId('goll_ticket').setLabel('Open Ticket').setStyle(ButtonStyle.Primary)
    );
    const recent = await welcome.messages.fetch({ limit: 10 }).catch(() => null);
    if (!recent?.some(m => m.author.id === client.user.id && m.embeds[0]?.title === '👋 Welcome to the server!')) {
      await welcome.send({ embeds: [embed], components: [row] });
    }
  }

  await saveConfig(guild.id, { roles, channels, repaired: repair, updatedAt: new Date().toISOString() });
  return { roles, channels };
}

client.once('ready', async () => {
  await dbInit();
  console.log(`Goll online as ${client.user.tag}`);
});

client.on('interactionCreate', async interaction => {
  if (interaction.isChatInputCommand()) {
    if (interaction.commandName === 'setup') {
      if (!interaction.memberPermissions?.has(PermissionsBitField.Flags.ManageGuild)) {
        return interaction.reply({ content: '❌ You need Manage Server permission.', ephemeral: true });
      }
      await interaction.deferReply({ ephemeral: true });
      const result = await setupGuild(interaction.guild, interaction.options.getSubcommand() === 'repair');
      return interaction.editReply(`✅ Setup complete. Managed roles: ${Object.keys(result.roles).length}, categories: ${Object.keys(result.channels).length}.`);
    }
    if (interaction.commandName === 'goll') {
      return interaction.reply({
        ephemeral: true,
        embeds: [new EmbedBuilder().setTitle('🤖 Goll Control Center').setDescription('Setup • Staff • Tickets • Moderation • Giveaways • Economy • Voice • Logs').setColor(0x5865F2)]
      });
    }
  }

  if (interaction.isButton()) {
    if (interaction.customId === 'goll_about') {
      return interaction.reply({ ephemeral: true, content: '🤖 Goll is the server management bot.' });
    }
    if (interaction.customId === 'goll_ticket') {
      const existing = interaction.guild.channels.cache.find(c => c.name === `ticket-${interaction.user.username}`);
      if (existing) return interaction.reply({ ephemeral: true, content: `🎫 You already have ${existing}.` });
      const channel = await interaction.guild.channels.create({
        name: `ticket-${interaction.user.username}`,
        type: ChannelType.GuildText,
        reason: 'Goll ticket',
        permissionOverwrites: [
          { id: interaction.guild.id, deny: [PermissionsBitField.Flags.ViewChannel] },
          { id: interaction.user.id, allow: [PermissionsBitField.Flags.ViewChannel, PermissionsBitField.Flags.SendMessages] }
        ]
      });
      return interaction.reply({ ephemeral: true, content: `🎫 Ticket created: ${channel}` });
    }
  }
});

async function registerCommands() {
  const commands = [
    { name: 'setup', description: 'Create or repair the Goll server structure', options: [{
      type: 1, name: 'repair', description: 'Repair missing managed resources', required: false
    }]},
    { name: 'goll', description: 'Open the Goll control center' }
  ];
  await client.application.commands.set(commands);
}

client.login(token).then(registerCommands);