const {
  SlashCommandBuilder,
  EmbedBuilder,
  PermissionsBitField
} = require('discord.js');

function setupEconomy(q, client) {
  const xpCooldown = new Map();

  async function dbInit() {
    await q(`ALTER TABLE economy ADD COLUMN IF NOT EXISTS daily_at TIMESTAMPTZ`);
    await q(`ALTER TABLE economy ADD COLUMN IF NOT EXISTS work_at TIMESTAMPTZ`);
    await q(`CREATE TABLE IF NOT EXISTS economy_items(
      guild_id TEXT, item_id TEXT, name TEXT NOT NULL, price BIGINT NOT NULL,
      description TEXT DEFAULT '', stock INT DEFAULT -1,
      PRIMARY KEY(guild_id,item_id)
    )`);
    await q(`CREATE TABLE IF NOT EXISTS economy_inventory(
      guild_id TEXT, user_id TEXT, item_id TEXT, quantity INT NOT NULL DEFAULT 0,
      PRIMARY KEY(guild_id,user_id,item_id)
    )`);
    await q(`CREATE TABLE IF NOT EXISTS level_rewards(
      guild_id TEXT, level INT, role_id TEXT,
      PRIMARY KEY(guild_id,level)
    )`);
    await q(`CREATE TABLE IF NOT EXISTS economy_settings(
      guild_id TEXT PRIMARY KEY, currency_name TEXT NOT NULL DEFAULT 'coins'
    )`);
  }

  async function ensureUser(guildId, userId) {
    await q(`INSERT INTO economy(guild_id,user_id,balance,xp,level)
      VALUES($1,$2,0,0,0) ON CONFLICT DO NOTHING`, [guildId,userId]);
  }

  async function currency(guildId) {
    return (await q('SELECT currency_name FROM economy_settings WHERE guild_id=$1',[guildId]))
      .rows[0]?.currency_name || 'coins';
  }

  function xpNeeded(level) {
    return 100 + (level * 50);
  }

  async function awardLevelRewards(guild, userId, level) {
    const rewards = (await q(
      'SELECT role_id FROM level_rewards WHERE guild_id=$1 AND level=$2',
      [guild.id,level]
    )).rows;
    if (!rewards.length) return;
    const member = await guild.members.fetch(userId).catch(()=>null);
    if (!member) return;
    for (const r of rewards) {
      const role = guild.roles.cache.get(r.role_id);
      if (role) await member.roles.add(role).catch(()=>{});
    }
  }

  async function addXp(message) {
    if (!message.guild || message.author.bot || !message.member) return;
    const key = message.guild.id + ':' + message.author.id;
    const now = Date.now();
    if (now - (xpCooldown.get(key) || 0) < 60000) return;
    xpCooldown.set(key, now);

    await ensureUser(message.guild.id,message.author.id);
    const row = (await q(
      'SELECT xp,level FROM economy WHERE guild_id=$1 AND user_id=$2',
      [message.guild.id,message.author.id]
    )).rows[0];
    if (!row) return;

    const gain = 10 + Math.floor(Math.random()*11);
    let xp = row.xp + gain;
    let level = row.level;
    let levelsGained = 0;
    while (xp >= xpNeeded(level)) {
      xp -= xpNeeded(level);
      level++;
      levelsGained++;
    }

    await q(
      'UPDATE economy SET xp=$1,level=$2 WHERE guild_id=$3 AND user_id=$4',
      [xp,level,message.guild.id,message.author.id]
    );

    if (levelsGained > 0) {
      const ch = message.guild.channels.cache.find(
        c => c.name === '📊・levels' && c.isTextBased()
      );
      if (ch) {
        await ch.send({
          embeds:[new EmbedBuilder()
            .setTitle('🎉 LEVEL UP!')
            .setDescription(
              `${message.author} reached **Level ${level}**!\\n\\n📈 XP: **${xp}/${xpNeeded(level)}**`
            )
            .setColor(0x5865F2)]
        }).catch(()=>{});
      }
      await awardLevelRewards(message.guild,message.author.id,level);
    }
  }

  async function handle(i) {
    if (!i.isChatInputCommand() || !i.guild) return false;
    const cmd = i.commandName;
    const supported = new Set([
      'balance','daily','work','pay','shop','inventory','leaderboard',
      'level','level-reward','currency'
    ]);
    if (!supported.has(cmd)) return false;

    const name = await currency(i.guild.id);

    if (cmd === 'balance') {
      const user = i.options.getUser('user') || i.user;
      await ensureUser(i.guild.id,user.id);
      const r = (await q(
        'SELECT balance,xp,level FROM economy WHERE guild_id=$1 AND user_id=$2',
        [i.guild.id,user.id]
      )).rows[0];
      return i.reply({
        embeds:[new EmbedBuilder()
          .setTitle('💰 Wallet')
          .setDescription(
            `**${user.username}**\\n\\n💰 Balance: **${r.balance} ${name}**\\n📈 Level: **${r.level}**\\n✨ XP: **${r.xp}/${xpNeeded(r.level)}**`
          )
          .setColor(0x57F287)]
      });
    }

    if (cmd === 'daily') {
      await ensureUser(i.guild.id,i.user.id);
      const row = (await q(
        'SELECT balance,daily_at FROM economy WHERE guild_id=$1 AND user_id=$2',
        [i.guild.id,i.user.id]
      )).rows[0];
      const cooldown = 24*60*60*1000;
      if (row.daily_at) {
        const left = cooldown - (Date.now()-new Date(row.daily_at).getTime());
        if (left > 0) {
          return i.reply({
            content:`⏳ Your daily is ready <t:${Math.floor((Date.now()+left)/1000)}:R>.`,
            ephemeral:true
          });
        }
      }
      const amount = 250;
      await q(
        'UPDATE economy SET balance=balance+$1,daily_at=NOW() WHERE guild_id=$2 AND user_id=$3',
        [amount,i.guild.id,i.user.id]
      );
      return i.reply(`💰 Daily claimed: **+${amount} ${name}**!`);
    }

    if (cmd === 'work') {
      await ensureUser(i.guild.id,i.user.id);
      const row = (await q(
        'SELECT balance,work_at FROM economy WHERE guild_id=$1 AND user_id=$2',
        [i.guild.id,i.user.id]
      )).rows[0];
      const cooldown = 60*60*1000;
      if (row.work_at) {
        const left = cooldown - (Date.now()-new Date(row.work_at).getTime());
        if (left > 0) {
          return i.reply({
            content:`⏳ You can work again <t:${Math.floor((Date.now()+left)/1000)}:R>.`,
            ephemeral:true
          });
        }
      }
      const amount = 100 + Math.floor(Math.random()*201);
      await q(
        'UPDATE economy SET balance=balance+$1,work_at=NOW() WHERE guild_id=$2 AND user_id=$3',
        [amount,i.guild.id,i.user.id]
      );
      return i.reply(`💼 You worked and earned **+${amount} ${name}**!`);
    }

    if (cmd === 'pay') {
      const user = i.options.getUser('user');
      const amount = i.options.getInteger('amount');
      if (user.bot || user.id === i.user.id) {
        return i.reply({content:'❌ Choose another human member.',ephemeral:true});
      }
      if (amount < 1) return i.reply({content:'❌ Amount must be positive.',ephemeral:true});
      await ensureUser(i.guild.id,i.user.id);
      await ensureUser(i.guild.id,user.id);
      const result = await q(
        `UPDATE economy SET balance=balance-$1
         WHERE guild_id=$2 AND user_id=$3 AND balance >= $1
         RETURNING balance`,
        [amount,i.guild.id,i.user.id]
      );
      if (!result.rows.length) return i.reply({content:`❌ Not enough ${name}.`,ephemeral:true});
      await q(
        'UPDATE economy SET balance=balance+$1 WHERE guild_id=$2 AND user_id=$3',
        [amount,i.guild.id,user.id]
      );
      return i.reply(`💸 Paid **${amount} ${name}** to ${user}.`);
    }

    if (cmd === 'shop') {
      const items = (await q(
        'SELECT item_id,name,price,description,stock FROM economy_items WHERE guild_id=$1 ORDER BY price ASC',
        [i.guild.id]
      )).rows;
      if (!items.length) {
        return i.reply({content:'🛒 The shop is empty. Admins can add items later.',ephemeral:true});
      }
      return i.reply({
        embeds:[new EmbedBuilder().setTitle('🛒 Shop')
          .setDescription(items.map(x =>
            `**${x.item_id} — ${x.name}**\\n💰 ${x.price} ${name} • ${x.stock < 0 ? 'Unlimited' : `Stock: ${x.stock}`}\\n${x.description || 'No description.'}`
          ).join('\\n\\n')).setColor(0xF1C40F)]
      });
    }

    if (cmd === 'inventory') {
      const rows = (await q(
        `SELECT i.item_id,i.quantity,COALESCE(s.name,i.item_id) AS name
         FROM economy_inventory i LEFT JOIN economy_items s
         ON s.guild_id=i.guild_id AND s.item_id=i.item_id
         WHERE i.guild_id=$1 AND i.user_id=$2 AND i.quantity>0
         ORDER BY i.item_id`,
        [i.guild.id,i.user.id]
      )).rows;
      return i.reply({
        embeds:[new EmbedBuilder().setTitle('🎒 Inventory')
          .setDescription(rows.length ? rows.map(x=>`• **${x.name}** × ${x.quantity}`).join('\\n') : 'Your inventory is empty.')
          .setColor(0x5865F2)]
      });
    }

    if (cmd === 'leaderboard') {
      const rows = (await q(
        'SELECT user_id,balance,level,xp FROM economy WHERE guild_id=$1 ORDER BY balance DESC LIMIT 10',
        [i.guild.id]
      )).rows;
      return i.reply({
        embeds:[new EmbedBuilder().setTitle('🏆 Economy Leaderboard')
          .setDescription(rows.length ? rows.map((x,n)=>
            `${n+1}. <@${x.user_id}> — **${x.balance} ${name}** • Level ${x.level}`
          ).join('\\n') : 'No economy data yet.')
          .setColor(0xF1C40F)]
      });
    }

    if (cmd === 'level') {
      const user = i.options.getUser('user') || i.user;
      await ensureUser(i.guild.id,user.id);
      const r = (await q(
        'SELECT xp,level FROM economy WHERE guild_id=$1 AND user_id=$2',
        [i.guild.id,user.id]
      )).rows[0];
      return i.reply({
        embeds:[new EmbedBuilder().setTitle('📈 Level')
          .setDescription(`**${user.username}** — Level **${r.level}**\\n✨ XP: **${r.xp}/${xpNeeded(r.level)}**`)
          .setColor(0x5865F2)]
      });
    }

    if (cmd === 'level-reward') {
      if (!i.member.permissions.has(PermissionsBitField.Flags.ManageGuild)) {
        return i.reply({content:'❌ Manage Server is required.',ephemeral:true});
      }
      const level = i.options.getInteger('level');
      const role = i.options.getRole('role');
      await q(
        `INSERT INTO level_rewards(guild_id,level,role_id) VALUES($1,$2,$3)
         ON CONFLICT(guild_id,level) DO UPDATE SET role_id=$3`,
        [i.guild.id,level,role.id]
      );
      return i.reply(`🏅 Level **${level}** reward set to ${role}.`);
    }

    if (cmd === 'currency') {
      if (!i.member.permissions.has(PermissionsBitField.Flags.ManageGuild)) {
        return i.reply({content:'❌ Manage Server is required.',ephemeral:true});
      }
      const value = i.options.getString('name').trim().slice(0,20);
      if (!value) return i.reply({content:'❌ Currency name cannot be empty.',ephemeral:true});
      await q(
        `INSERT INTO economy_settings(guild_id,currency_name) VALUES($1,$2)
         ON CONFLICT(guild_id) DO UPDATE SET currency_name=$2`,
        [i.guild.id,value]
      );
      return i.reply(`⚙️ Currency is now **${value}**.`);
    }

    return false;
  }

  client.once('ready', async () => {
    await dbInit();
    const commands = [
      new SlashCommandBuilder().setName('work').setDescription('Work for coins'),
      new SlashCommandBuilder().setName('shop').setDescription('View the economy shop'),
      new SlashCommandBuilder().setName('inventory').setDescription('View your inventory'),
      new SlashCommandBuilder().setName('leaderboard').setDescription('Show economy leaderboard'),
      new SlashCommandBuilder().setName('level').setDescription('Show your level').addUserOption(o=>o.setName('user').setDescription('Member')),
      new SlashCommandBuilder().setName('level-reward').setDescription('Set a role reward for a level')
        .addIntegerOption(o=>o.setName('level').setDescription('Level').setRequired(true).setMinValue(1).setMaxValue(1000))
        .addRoleOption(o=>o.setName('role').setDescription('Reward role').setRequired(true)),
      new SlashCommandBuilder().setName('currency').setDescription('Set the server currency name')
        .addStringOption(o=>o.setName('name').setDescription('Currency name').setRequired(true)),
    ];
    for (const command of commands) {
      const exists = client.application.commands.cache.find(c=>c.name===command.name);
      if (!exists) await client.application.commands.create(command.toJSON()).catch(()=>{});
    }
  });

  client.on('interactionCreate', async i => {
    try { await handle(i); } catch (e) { console.error('Economy:',e); }
  });

  client.on('messageCreate', message => {
    addXp(message).catch(e=>console.error('XP:',e));
  });

  return { dbInit, handle };
}

module.exports = { setupEconomy };
