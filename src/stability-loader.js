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
