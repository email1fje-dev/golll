const { Client, EmbedBuilder, ChannelType } = require('discord.js');
const { Pool } = require('pg');

const pool = process.env.DATABASE_URL
  ? new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } })
  : null;
const q = async (sql, params = []) => pool ? pool.query(sql, params) : { rows: [] };

function install(client) {
  // Repair legacy invite tracking schema so invite stats are isolated per guild.
  client.once('ready', async () => {
    if (pool) {
      try {
        await q('ALTER TABLE invite_uses DROP CONSTRAINT IF EXISTS invite_uses_pkey');
        await q('ALTER TABLE invite_uses ADD CONSTRAINT invite_uses_pkey PRIMARY KEY (guild_id,user_id)');
      } catch (e) {
        console.error('Goll invite schema repair:', e.message);
      }

      // Remove DB records for temporary voice channels that no longer exist.
      try {
        const rows = (await q('SELECT channel_id FROM temp_voice')).rows;
        for (const row of rows) {
          if (!client.channels.cache.has(row.channel_id)) {
            await q('DELETE FROM temp_voice WHERE channel_id=$1', [row.channel_id]);
          }
        }
      } catch (e) {
        console.error('Goll temp voice cleanup:', e.message);
      }
    }
  });

  // The main command handler has an old target_id selection bug in /modlogs.
  // Handle the command here first; the original handler safely ignores the
  // already-replied interaction when it reaches the same command.
  client.on('interactionCreate', async i => {
    if (!i.isChatInputCommand() || i.commandName !== 'modlogs' || !i.guild) return;

    const staff = i.member.permissions.has('ManageGuild') ||
      i.member.roles.cache.some(r => ['👑 Owner','🛡️ Admin','🔨 Moderator','🎫 Support','📝 Trial Staff'].includes(r.name));
    if (!staff) return i.reply({ content: '❌ Staff only.', ephemeral: true });

    try {
      const user = i.options.getUser('user');
      const rows = (await q(
        `SELECT target_id,action,reason,moderator_id,created_at
         FROM moderation_logs
         WHERE guild_id=$1 ${user ? 'AND target_id=$2' : ''}
         ORDER BY created_at DESC LIMIT 15`,
        user ? [i.guild.id, user.id] : [i.guild.id]
      )).rows;

      const description = rows.length
        ? rows.map(x => `• **${x.action}** — <@${x.target_id}> — ${x.reason || 'No reason'} — <t:${Math.floor(new Date(x.created_at).getTime() / 1000)}:R>`).join('\\n')
        : 'No moderation actions found.';

      return i.reply({
        embeds: [new EmbedBuilder()
          .setTitle('🛡️ Moderation Logs')
          .setDescription(description.slice(0, 4000))
          .setColor(0x5865F2)]
      });
    } catch (e) {
      console.error('Goll modlogs:', e.message);
      if (!i.replied) await i.reply({ content: '❌ Could not load moderation logs.', ephemeral: true }).catch(() => {});
    }
  });

  process.on('unhandledRejection', err => console.error('Goll unhandled rejection:', err));
  process.on('uncaughtException', err => console.error('Goll uncaught exception:', err));
}

const originalLogin = Client.prototype.login;
Client.prototype.login = function(...args) {
  if (!this.__gollStability) {
    this.__gollStability = true;
    install(this);
  }
  return originalLogin.apply(this, args);
};
