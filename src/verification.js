const { ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder, ChannelType } = require('discord.js');

function setupVerification(q, client) {
  const VERIFY_CHANNEL = '🔐・verify';
  const MEMBER_ROLE = '👤 Member';

  async function ensurePanel(guild) {
    let ch = guild.channels.cache.find(c => c.name === VERIFY_CHANNEL && c.type === ChannelType.GuildText);
    if (!ch) {
      const cat = guild.channels.cache.find(c => c.name === '📌 INFORMATION' && c.type === ChannelType.GuildCategory);
      ch = await guild.channels.create({name: VERIFY_CHANNEL, type: ChannelType.GuildText, parent: cat?.id, reason: 'Goll verification system'}).catch(() => null);
    }
    if (!ch) return;
    const exists = (await ch.messages.fetch({limit: 20}).catch(() => new Map())).some(m => m.author.id === client.user.id && m.embeds[0]?.title === '🔐 Server Verification');
    if (exists) return;
    const row = new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId('goll_verify').setLabel('✅ VERIFY').setStyle(ButtonStyle.Success));
    await ch.send({embeds: [new EmbedBuilder().setTitle('🔐 Server Verification').setDescription('Click **VERIFY** to unlock the member role and access the server.\n\nYour Discord account must be at least 24 hours old.').setColor(0x57F287)], components: [row]});
  }

  client.on('ready', async () => { for (const guild of client.guilds.cache.values()) await ensurePanel(guild); });

  client.on('interactionCreate', async i => {
    if (!i.isButton() || i.customId !== 'goll_verify') return;
    try {
      if (!i.guild) return i.reply({content: '❌ This can only be used inside a server.', ephemeral: true});
      if (i.user.bot) return i.reply({content: '❌ Bots cannot use verification.', ephemeral: true});
      const member = await i.guild.members.fetch(i.user.id);
      const role = i.guild.roles.cache.find(r => r.name === MEMBER_ROLE);
      if (!role) return i.reply({content: '❌ Member role is missing. Run `/setup repair`.', ephemeral: true});
      const accountAge = Date.now() - i.user.createdTimestamp;
      if (accountAge < 24 * 60 * 60 * 1000) {
        const hours = Math.max(1, Math.ceil((24 * 60 * 60 * 1000 - accountAge) / 3600000));
        await q('INSERT INTO verification_logs(guild_id,user_id,status,reason) VALUES($1,$2,$3,$4)', [i.guild.id, i.user.id, 'BLOCKED', 'ACCOUNT_TOO_NEW']);
        return i.reply({content: '⚠️ Your Discord account is too new for automatic verification. Please try again in about **' + hours + ' hour(s)**.', ephemeral: true});
      }
      if (member.roles.cache.has(role.id)) return i.reply({content: '✅ You are already verified!', ephemeral: true});
      await member.roles.add(role, 'Goll verification').catch(() => { throw new Error('MISSING_ROLE_PERMISSION'); });
      await q('INSERT INTO verification_logs(guild_id,user_id,status,reason) VALUES($1,$2,$3,$4)', [i.guild.id, i.user.id, 'VERIFIED', 'BUTTON']);
      const log = i.guild.channels.cache.find(c => c.name === '⚙️・updates-logs' && c.type === ChannelType.GuildText);
      if (log) await log.send({embeds: [new EmbedBuilder().setTitle('🔐 Member Verified').setDescription('Member: ' + i.user + '\nAccount age: <t:' + Math.floor(i.user.createdTimestamp / 1000) + ':R>').setColor(0x57F287)]}).catch(() => {});
      return i.reply({content: '✅ Verification complete! Welcome to the server.', ephemeral: true});
    } catch (e) {
      console.error('Verification:', e.message);
      return i.reply({content: '❌ Verification could not be completed. Please contact staff.', ephemeral: true}).catch(() => {});
    }
  });

  return { ensurePanel };
}

module.exports = { setupVerification };