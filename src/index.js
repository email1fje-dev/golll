const {
  Client,
  GatewayIntentBits,
  ChannelType,
  PermissionsBitField
} = require('discord.js');
const {
  joinVoiceChannel,
  createAudioPlayer,
  createAudioResource,
  AudioPlayerStatus,
  NoSubscriberBehavior,
  entersState,
  VoiceConnectionStatus
} = require('@discordjs/voice');
const { Readable } = require('stream');
const ffmpegPath = require('ffmpeg-static');

const TOKEN = process.env.DISCORD_TOKEN;
const TTS_TOKEN = process.env.TTS_TOKEN || '';
const TTS_VOICE_ID = 'JBFqnCBsd6RMkjVDRZzb';

if (!TOKEN) throw new Error('Missing DISCORD_TOKEN');
if (ffmpegPath) process.env.FFMPEG_PATH = ffmpegPath;

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildVoiceStates
  ]
});

const WELCOME_NAME = '👋・Welcome';
const MEMBER_ROLE = '👤 Member';

// These are only legacy Goll resources. They are cleaned up so setup leaves
// the server with only the Welcome channel and the single role it needs.
const LEGACY_CHANNEL_NAMES = new Set([
  '📜・rules','📢・announcements','👋・welcome','ℹ️・about-us','🔐・verify',
  '💬・general','🖼️・media','😂・memes','🎮・gaming','📊・levels',
  '🎫・tickets','📝・apply-for-staff','🤝・partnerships',
  '🎉・giveaways','💎・nitro-drops','🏆・winners',
  '📋・activity-check','🏖️・request-loa','💼・staff-panel','📚・staff-info',
  '🛡️・automod','📊・dashboard',
  '📋・application-logs','🎫・ticket-logs','🏖️・loa-logs','⚙️・updates-logs',
  '👋・Welcome','🔊・General','🎮・Gaming','🔒・Private VC'
]);

const LEGACY_CATEGORY_NAMES = new Set([
  '📌 INFORMATION','💬 COMMUNITY','🎫 SUPPORT','🎁 GIVEAWAYS',
  '👮 STAFF','🔐 STAFF LOGS','🔊 VOICE'
]);

const LEGACY_ROLE_NAMES = new Set([
  '👑 Owner','🛡️ Admin','🔨 Moderator','🎫 Support','📝 Trial Staff',
  '💎 Booster','🤖 Bots'
]);

const welcomeSeen = new Set();

async function welcomeTTS(member) {
  if (!TTS_TOKEN || !member.voice?.channel) return true;

  const response = await fetch(
    'https://api.elevenlabs.io/v1/text-to-speech/' +
      TTS_VOICE_ID +
      '?output_format=mp3_44100_128',
    {
      method: 'POST',
      headers: {
        'xi-api-key': TTS_TOKEN,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        text:
          'Welcome to Goll! We are happy to have you here, ' +
          member.displayName +
          '! Please enjoy your time here.',
        model_id: 'eleven_multilingual_v2'
      })
    }
  );

  if (!response.ok) {
    throw new Error(
      'ElevenLabs TTS ' +
        response.status +
        ' ' +
        (await response.text()).slice(0, 300)
    );
  }

  const audio = Buffer.from(await response.arrayBuffer());
  const channel = member.voice.channel;

  const connection = joinVoiceChannel({
    channelId: channel.id,
    guildId: member.guild.id,
    adapterCreator: member.guild.voiceAdapterCreator,
    selfDeaf: false,
    selfMute: false
  });

  await entersState(connection, VoiceConnectionStatus.Ready, 15000);

  const player = createAudioPlayer({
    behaviors: { noSubscriber: NoSubscriberBehavior.Stop }
  });

  connection.subscribe(player);

  return new Promise((resolve, reject) => {
    let done = false;

    const finish = ok => {
      if (done) return;
      done = true;
      connection.destroy();
      resolve(ok);
    };

    player.once(AudioPlayerStatus.Idle, () => finish(true));
    player.once('error', error => {
      if (done) return;
      done = true;
      connection.destroy();
      reject(error);
    });

    player.play(
      createAudioResource(Readable.from(audio), { inputType: 'arbitrary' })
    );
  });
}

async function getOrCreateMemberRole(guild) {
  let role = guild.roles.cache.find(r => r.name === MEMBER_ROLE);

  if (!role) {
    role = await guild.roles.create({
      name: MEMBER_ROLE,
      reason: 'Goll Welcome onboarding'
    });
  }

  return role;
}

async function lockNewMember(member) {
  // Only the Welcome voice channel is visible before onboarding.
  for (const channel of member.guild.channels.cache.values()) {
    if (channel.type === ChannelType.GuildCategory) continue;

    if (
      channel.name === WELCOME_NAME &&
      channel.type === ChannelType.GuildVoice
    ) {
      await channel.permissionOverwrites
        .edit(member.id, {
          ViewChannel: true,
          Connect: true,
          Speak: true
        })
        .catch(() => {});
      continue;
    }

    await channel.permissionOverwrites
      .edit(member.id, { ViewChannel: false })
      .catch(() => {});
  }
}

async function unlockMember(member) {
  for (const channel of member.guild.channels.cache.values()) {
    if (channel.type === ChannelType.GuildCategory) continue;
    await channel.permissionOverwrites.delete(member.id).catch(() => {});
  }
}

async function setupGuild(guild) {
  const memberRole = await getOrCreateMemberRole(guild);

  // Remove old Goll categories.
  for (const channel of [...guild.channels.cache.values()]) {
    if (
      channel.type === ChannelType.GuildCategory &&
      LEGACY_CATEGORY_NAMES.has(channel.name)
    ) {
      await channel.delete('Goll Welcome-only cleanup').catch(() => {});
    }
  }

  // Remove old Goll channels, but keep exactly one Welcome voice channel.
  for (const channel of [...guild.channels.cache.values()]) {
    if (
      LEGACY_CHANNEL_NAMES.has(channel.name) &&
      !(channel.name === WELCOME_NAME && channel.type === ChannelType.GuildVoice)
    ) {
      await channel.delete('Goll Welcome-only cleanup').catch(() => {});
    }
  }

  let welcome = guild.channels.cache.find(
    c => c.name === WELCOME_NAME && c.type === ChannelType.GuildVoice
  );

  if (!welcome) {
    welcome = await guild.channels.create({
      name: WELCOME_NAME,
      type: ChannelType.GuildVoice,
      reason: 'Goll Welcome onboarding'
    });
  }

  await welcome.permissionOverwrites
    .edit(guild.roles.everyone, {
      ViewChannel: true,
      Connect: true,
      Speak: true
    })
    .catch(() => {});

  await welcome.permissionOverwrites
    .edit(memberRole, {
      ViewChannel: true,
      Connect: true,
      Speak: true
    })
    .catch(() => {});

  // Remove every old managed role except the one role required by onboarding.
  for (const role of [...guild.roles.cache.values()]) {
    if (role.managed || !LEGACY_ROLE_NAMES.has(role.name)) continue;
    await role.delete('Goll Welcome-only cleanup').catch(() => {});
  }

  // Existing members keep access. New members are gated by guildMemberAdd.
  for (const member of guild.members.cache.values()) {
    if (member.user.bot) continue;

    if (member.roles.cache.has(memberRole.id)) {
      await unlockMember(member);
    }
  }

  console.log(
    '[Goll] Ready: ' +
      guild.name +
      ' -> only ' +
      WELCOME_NAME +
      ' + ' +
      MEMBER_ROLE
  );
}

client.once('ready', async () => {
  console.log('Goll logged in as ' + client.user.tag);

  for (const guild of client.guilds.cache.values()) {
    await setupGuild(guild).catch(error =>
      console.error('[Goll] Setup error:', error)
    );
  }
});

client.on('guildCreate', guild => {
  setupGuild(guild).catch(error =>
    console.error('[Goll] Guild setup error:', error)
  );
});

client.on('guildMemberAdd', async member => {
  if (member.user.bot) return;

  try {
    const role = await getOrCreateMemberRole(member.guild);

    if (member.roles.cache.has(role.id)) {
      await member.roles.remove(role, 'Goll onboarding gate').catch(() => {});
    }

    await lockNewMember(member);
  } catch (error) {
    console.error('[Goll] Member lock error:', error);
  }
});

client.on('voiceStateUpdate', async (oldState, newState) => {
  if (!newState.channel || newState.channel.name !== WELCOME_NAME) return;
  if (newState.member?.user.bot) return;

  const member = newState.member;
  const key = member.guild.id + ':' + member.id;

  // Prevent repeated TTS/onboarding when a member moves around inside Welcome.
  if (welcomeSeen.has(key) || member.roles.cache.some(r => r.name === MEMBER_ROLE)) {
    await unlockMember(member);
    return;
  }

  welcomeSeen.add(key);

  try {
    await welcomeTTS(member);

    const role = await getOrCreateMemberRole(member.guild);
    await member.roles.add(role, 'Goll Welcome onboarding');
    await unlockMember(member);

    console.log('[Goll] Onboarded ' + member.user.tag);
  } catch (error) {
    welcomeSeen.delete(key);
    console.error('[Goll] Welcome onboarding error:', error);
  }
});

client.on('error', error => console.error('[Goll] Discord error:', error));
process.on('unhandledRejection', error =>
  console.error('[Goll] Unhandled rejection:', error)
);

client.login(TOKEN);
