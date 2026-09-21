const { ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder, ChannelType, PermissionsBitField } = require('discord.js');

const DEFAULTS = { anti_spam: true, anti_links: true, anti_caps: true };

function setupAutomod(q, client) {
  async function getSettings(guildId) {
    const row = (await q('SELECT * FROM automod_settings WHERE guild_id=$1', [guildId])).rows[0];
    if (row) return row;
    await q('INSERT INTO automod_settings(guild_id,anti_spam,anti_links,anti_caps) VALUES($1,$2,$3,$4) ON CONFLICT(guild_id) DO NOTHING', [guildId, true, true, true]);
    return { guild_id: guildId, ...DEFAULTS };
  }

  function isAdmin(member) {
    return member?.permissions?.has(PermissionsBitField.Flags.ManageGuild) || member?.roles?.cache?.some(r => ['👑 Owner','🛡️ Admin'].includes(r.name));
  }

  function makeEmbed(settings) {
    const on = v => v ? '🟢 ON' : '🔴 OFF';
    return new EmbedBuilder().setTitle('🛡️ AutoMod Control Panel').setDescription('Manage Goll AutoMod from this panel. Changes apply immediately.').addFields(
      { name: '🚫 Anti-Link', value: on(settings.anti_links), inline: true },
      { name: '🔠 Anti-Caps', value: on(settings.anti_caps), inline: true },
      { name: '💬 Anti-Spam', value: on(settings.anti_spam), inline: true }
    ).setFooter({ text: 'Admin / Owner only' }).setColor(0x5865F2);
  }

  function makeRows(settings) {
    return [new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId('automod_toggle:anti_links').setLabel(`${settings.anti_links ? '🔴 Disable' : '🟢 Enable'} Anti-Link`).setStyle(settings.anti_links ? ButtonStyle.Danger : ButtonStyle.Success),
      new ButtonBuilder().setCustomId('automod_toggle:anti_caps').setLabel(`${settings.anti_caps ? '🔴 Disable' : '🟢 Enable'} Anti-Caps`).setStyle(settings.anti_caps ? ButtonStyle.Danger : ButtonStyle.Success),
      new ButtonBuilder().setCustomId('automod_toggle:anti_spam').setLabel(`${settings.anti_spam ? '🔴 Disable' : '🟢 Enable'} Anti-Spam`).setStyle(settings.anti_spam ? ButtonStyle.Danger : ButtonStyle.Success)
    )];
  }

  async function ensurePanel(guild, force=false) {
    const ch = guild.channels.cache.find(c => c.name === '🛡️・automod' && c.type === ChannelType.GuildText);
    if (!ch) return;
    const settings = await getSettings(guild.id);
    const messages = await ch.messages.fetch({ limit: 30 }).catch(() => new Map());
    const existing = messages.find(m => m.author.id === client.user?.id && m.embeds[0]?.title === '🛡️ AutoMod Control Panel');
    if (existing && !force) return;
    if (existing && force) await existing.delete().catch(() => {});
    await ch.send({ embeds: [makeEmbed(settings)], components: makeRows(settings) });
  }

  client.on('interactionCreate', async i => {
    if (!i.isButton() || !i.customId.startsWith('automod_toggle:')) return;
    try {
      if (!isAdmin(i.member)) return i.reply({ content: '❌ Admin / Owner only.', ephemeral: true });
      const setting = i.customId.split(':')[1];
      if (!Object.prototype.hasOwnProperty.call(DEFAULTS, setting)) return i.reply({ content: '❌ Invalid AutoMod setting.', ephemeral: true });
      const current = await getSettings(i.guild.id);
      const next = !current[setting];
      await q(`UPDATE automod_settings SET ${setting}=$1,updated_at=NOW() WHERE guild_id=$2`, [next, i.guild.id]);
      return i.update({ embeds: [makeEmbed({ ...current, [setting]: next })], components: makeRows({ ...current, [setting]: next }) });
    } catch (e) { console.error('AutoMod panel:', e.message); if (!i.replied) await i.reply({ content: '❌ Could not update AutoMod.', ephemeral: true }).catch(() => {}); }
  });

  return { ensurePanel, getSettings };
}

module.exports = { setupAutomod };