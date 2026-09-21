const { ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder, ChannelType, PermissionsBitField } = require('discord.js');

function setupDashboard(q, client) {
  function isStaff(member) {
    return member?.permissions?.has(PermissionsBitField.Flags.ManageGuild) || member?.roles?.cache?.some(r => ['👑 Owner','🛡️ Admin','🔨 Moderator','🎫 Support','📝 Trial Staff'].includes(r.name));
  }

  async function stats(guild) {
    const [members, staff, tickets, apps, warnings, giveaways, activeChecks] = await Promise.all([
      guild.members.fetch().then(m => m.filter(x => !x.user.bot).size).catch(() => guild.memberCount || 0),
      guild.members.fetch().then(m => m.filter(x => !x.user.bot && isStaff(x)).size).catch(() => 0),
      q("SELECT COUNT(*)::int AS n FROM tickets WHERE guild_id=$1 AND closed=false", [guild.id]),
      q("SELECT COUNT(*)::int AS n FROM applications WHERE guild_id=$1 AND status IN ('PENDING','INTERVIEW')", [guild.id]),
      q("SELECT COUNT(*)::int AS n FROM warnings WHERE guild_id=$1 AND created_at > NOW() - INTERVAL '30 days'", [guild.id]),
      q("SELECT COUNT(*)::int AS n FROM giveaways WHERE guild_id=$1 AND status='OPEN'", [guild.id]),
      q("SELECT COUNT(*)::int AS n FROM activity_checks WHERE guild_id=$1 AND status='OPEN'", [guild.id])
    ]);
    return { members, staff, tickets: tickets.rows[0]?.n || 0, apps: apps.rows[0]?.n || 0, warnings: warnings.rows[0]?.n || 0, giveaways: giveaways.rows[0]?.n || 0, activeChecks: activeChecks.rows[0]?.n || 0 };
  }

  async function makeEmbed(guild) {
    const s = await stats(guild);
    return new EmbedBuilder().setTitle('📊 Goll Staff Dashboard')
      .setDescription('Live overview of the server. Press **Refresh** to update the numbers.')
      .addFields(
        { name: '👥 Members', value: `**${s.members}**`, inline: true },
        { name: '👮 Staff', value: `**${s.staff}**`, inline: true },
        { name: '🎫 Open Tickets', value: `**${s.tickets}**`, inline: true },
        { name: '📝 Pending Applications', value: `**${s.apps}**`, inline: true },
        { name: '⚠️ Warnings (30d)', value: `**${s.warnings}**`, inline: true },
        { name: '🎁 Active Giveaways', value: `**${s.giveaways}**`, inline: true },
        { name: '📋 Active Checks', value: `**${s.activeChecks}**`, inline: true },
        { name: '🟢 Bot Status', value: client.ws.status === 0 ? '**ONLINE**' : '**CONNECTING**', inline: true }
      ).setFooter({ text: `Updated • ${new Date().toLocaleString('en-US', { hour: '2-digit', minute: '2-digit' })}` }).setColor(0x5865F2);
  }

  function rows() {
    return [new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId('dashboard_refresh').setLabel('🔄 Refresh').setStyle(ButtonStyle.Primary),
      new ButtonBuilder().setCustomId('dashboard_staff').setLabel('👮 Staff Panel').setStyle(ButtonStyle.Secondary),
      new ButtonBuilder().setCustomId('dashboard_automod').setLabel('🛡️ AutoMod').setStyle(ButtonStyle.Secondary)
    )];
  }

  async function ensurePanel(guild, force=false) {
    const ch = guild.channels.cache.find(c => c.name === '📊・dashboard' && c.type === ChannelType.GuildText);
    if (!ch) return;
    const existing = (await ch.messages.fetch({ limit: 30 }).catch(() => new Map())).find(m => m.author.id === client.user?.id && m.embeds[0]?.title === '📊 Goll Staff Dashboard');
    if (existing && !force) return;
    if (existing && force) await existing.delete().catch(() => {});
    await ch.send({ embeds: [await makeEmbed(guild)], components: rows() });
  }

  client.on('interactionCreate', async i => {
    if (!i.isButton() || !['dashboard_refresh','dashboard_staff','dashboard_automod'].includes(i.customId)) return;
    if (!isStaff(i.member)) return i.reply({ content: '❌ Staff only.', ephemeral: true });
    if (i.customId === 'dashboard_refresh') return i.update({ embeds: [await makeEmbed(i.guild)], components: rows() });
    if (i.customId === 'dashboard_staff') {
      const ch = i.guild.channels.cache.find(c => c.name === '💼・staff-panel' && c.type === ChannelType.GuildText);
      return i.reply({ content: ch ? `👮 Staff controls: ${ch}` : '❌ Staff panel is missing.', ephemeral: true });
    }
    const ch = i.guild.channels.cache.find(c => c.name === '🛡️・automod' && c.type === ChannelType.GuildText);
    return i.reply({ content: ch ? `🛡️ AutoMod controls: ${ch}` : '❌ AutoMod panel is missing.', ephemeral: true });
  });

  return { ensurePanel, stats };
}

module.exports = { setupDashboard };