const {
  ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder,
  ModalBuilder, TextInputBuilder, TextInputStyle, ChannelType
} = require('discord.js');

const STAFF_ROLE_NAMES = ['👑 Owner','🛡️ Admin','🔨 Moderator','🎫 Support','📝 Trial Staff'];

function isStaff(member) {
  return member.roles.cache.some(r => STAFF_ROLE_NAMES.includes(r.name)) ||
    member.permissions.has('ManageGuild');
}
function isAdmin(member) {
  return member.permissions.has('ManageGuild') ||
    member.roles.cache.some(r => ['👑 Owner','🛡️ Admin'].includes(r.name));
}

function setupNitro(q, client) {
  async function dbInit() {
    await q(`CREATE TABLE IF NOT EXISTS nitro_drops(
      id BIGSERIAL PRIMARY KEY,
      guild_id TEXT NOT NULL,
      channel_id TEXT NOT NULL,
      message_id TEXT,
      prize TEXT NOT NULL,
      creator_id TEXT NOT NULL,
      ready_required INT NOT NULL DEFAULT 1,
      ready_count INT NOT NULL DEFAULT 0,
      drop_at TIMESTAMPTZ NOT NULL,
      status TEXT NOT NULL DEFAULT 'OPEN',
      winner_id TEXT,
      created_at TIMESTAMPTZ DEFAULT NOW()
    )`);
    await q(`CREATE TABLE IF NOT EXISTS nitro_drop_ready(
      drop_id BIGINT NOT NULL,
      guild_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      ready_at TIMESTAMPTZ DEFAULT NOW(),
      PRIMARY KEY(drop_id,user_id)
    )`);
  }

  async function ensurePanel(guild, force=false) {
    const ch = guild.channels.cache.find(c => c.name === '💎・nitro-drops' && c.type === ChannelType.GuildText);
    if (!ch) return;
    const exists = (await ch.messages.fetch({limit:30}).catch(()=>new Map()))
      .some(m => m.author.id === client.user.id && m.embeds[0]?.title === '⚡ Nitro Quick Drop Control');
    if (exists && !force) return;
    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId('nitro_create').setLabel('⚡ CREATE QUICK DROP').setStyle(ButtonStyle.Primary)
    );
    await ch.send({
      embeds:[new EmbedBuilder()
        .setTitle('⚡ Nitro Quick Drop Control')
        .setDescription('Staff can create a timed Quick Drop here. Members press **READY** to join the drop. The first eligible READY member wins when the drop goes live.')
        .setColor(0x5865F2)],
      components:[row]
    });
  }

  async function renderDrop(row) {
    const ch = client.channels.cache.get(row.channel_id);
    if (!ch) return;
    const msg = row.message_id ? await ch.messages.fetch(row.message_id).catch(()=>null) : null;
    if (!msg) return;
    const status = row.status === 'OPEN'
      ? `🟢 OPEN\\n**Ready:** ${row.ready_count}/${row.ready_required}\\n**Drops:** <t:${Math.floor(new Date(row.drop_at).getTime()/1000)}:R>`
      : row.status === 'CLAIMED'
        ? `🏆 CLAIMED\\n**Winner:** <@${row.winner_id}>`
        : '⏰ EXPIRED';
    await msg.edit({
      embeds:[new EmbedBuilder()
        .setTitle('⚡ Nitro Quick Drop')
        .setDescription(`**Prize:** ${row.prize}\\n**Creator:** <@${row.creator_id}>\\n\\n${status}`)
        .setColor(row.status === 'OPEN' ? 0x5865F2 : row.status === 'CLAIMED' ? 0x57F287 : 0xED4245)],
      components: row.status === 'OPEN'
        ? [new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId('nitro_ready:'+row.id).setLabel('⚡ READY').setStyle(ButtonStyle.Success))]
        : []
    }).catch(()=>{});
  }

  async function resolveDrop(id) {
    const r = (await q(`SELECT * FROM nitro_drops WHERE id=$1`,[id])).rows[0];
    if (!r || r.status !== 'OPEN') return;
    const ready = (await q(`SELECT user_id FROM nitro_drop_ready WHERE drop_id=$1 ORDER BY ready_at ASC`,[id])).rows;
    const winner = ready[0]?.user_id || null;
    const status = winner ? 'CLAIMED' : 'EXPIRED';
    await q(`UPDATE nitro_drops SET status=$1,winner_id=$2 WHERE id=$3`,[status,winner,id]);
    const updated = (await q('SELECT * FROM nitro_drops WHERE id=$1',[id])).rows[0];
    await renderDrop(updated);
    const ch = client.channels.cache.get(r.channel_id);
    if (ch) {
      if (winner) {
        await ch.send(`🎉 <@${winner}> won the Nitro Quick Drop **${r.prize}**!`);
        const winners = ch.guild.channels.cache.find(c => c.name === '🏆・winners' && c.type === ChannelType.GuildText);
        if (winners) await winners.send(`🏆 **Nitro Quick Drop Winner**\\nPrize: **${r.prize}**\\nWinner: <@${winner}>`);
      } else {
        await ch.send(`⏰ Quick Drop **${r.prize}** expired with no READY members.`);
      }
    }
  }

  function schedule(row) {
    const ms = Math.max(1000, new Date(row.drop_at).getTime() - Date.now());
    setTimeout(() => resolveDrop(row.id).catch(console.error), ms);
  }

  async function recover() {
    const rows = (await q(`SELECT * FROM nitro_drops WHERE status='OPEN'`)).rows;
    for (const row of rows) {
      if (new Date(row.drop_at).getTime() <= Date.now()) await resolveDrop(row.id);
      else schedule(row);
    }
  }

  client.on('interactionCreate', async i => {
    try {
      if (i.isButton() && i.customId === 'nitro_create') {
        if (!isStaff(i.member)) return i.reply({content:'❌ Staff only.',ephemeral:true});
        return i.showModal(new ModalBuilder().setCustomId('nitro_create_modal').setTitle('⚡ Create Quick Drop')
          .addComponents(
            new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('prize').setLabel('Prize').setStyle(TextInputStyle.Short).setRequired(true)),
            new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('seconds').setLabel('Drop time (seconds)').setStyle(TextInputStyle.Short).setRequired(true)),
            new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('ready').setLabel('Ready count required').setStyle(TextInputStyle.Short).setRequired(true))
          ));
      }

      if (i.isButton() && i.customId.startsWith('nitro_ready:')) {
        const id = i.customId.split(':')[1];
        const r = (await q('SELECT * FROM nitro_drops WHERE id=$1',[id])).rows[0];
        if (!r || r.status !== 'OPEN') return i.reply({content:'❌ This Quick Drop is no longer active.',ephemeral:true});
        if (new Date(r.drop_at).getTime() <= Date.now()) {
          await resolveDrop(id);
          return i.reply({content:'⏰ The drop just ended.',ephemeral:true});
        }
        const ins = await q('INSERT INTO nitro_drop_ready(drop_id,guild_id,user_id) VALUES($1,$2,$3) ON CONFLICT DO NOTHING RETURNING user_id',[id,i.guild.id,i.user.id]);
        if (!ins.rows.length) return i.reply({content:'⚡ You are already READY!',ephemeral:true});
        const count = (await q('SELECT COUNT(*)::int AS count FROM nitro_drop_ready WHERE drop_id=$1',[id])).rows[0].count;
        await q('UPDATE nitro_drops SET ready_count=$1 WHERE id=$2',[count,id]);
        const updated = (await q('SELECT * FROM nitro_drops WHERE id=$1',[id])).rows[0];
        await renderDrop(updated);
        return i.reply({content:`⚡ READY recorded! You are #${count} in the queue.`,ephemeral:true});
      }

      if (i.isModalSubmit() && i.customId === 'nitro_create_modal') {
        if (!isStaff(i.member)) return i.reply({content:'❌ Staff only.',ephemeral:true});
        const prize = i.fields.getTextInputValue('prize').trim();
        const seconds = Math.max(5, Math.min(86400, parseInt(i.fields.getTextInputValue('seconds'),10) || 5));
        const ready = Math.max(1, Math.min(1000, parseInt(i.fields.getTextInputValue('ready'),10) || 1));
        const ch = i.guild.channels.cache.find(c => c.name === '💎・nitro-drops' && c.type === ChannelType.GuildText);
        if (!ch) return i.reply({content:'❌ Nitro Drops channel is missing. Run /setup repair.',ephemeral:true});
        const dropAt = Date.now() + seconds*1000;
        const ins = await q(`INSERT INTO nitro_drops(guild_id,channel_id,prize,creator_id,ready_required,drop_at)
          VALUES($1,$2,$3,$4,$5,to_timestamp($6/1000.0)) RETURNING id`,
          [i.guild.id,ch.id,prize,i.user.id,ready,dropAt]);
        const id = ins.rows[0].id;
        const row = (await q('SELECT * FROM nitro_drops WHERE id=$1',[id])).rows[0];
        const msg = await ch.send({
          embeds:[new EmbedBuilder().setTitle('⚡ Nitro Quick Drop')
            .setDescription(`**Prize:** ${prize}\\n**Creator:** <@${i.user.id}>\\n\\n🟢 OPEN\\n**Ready:** 0/${ready}\\n**Drops:** <t:${Math.floor(dropAt/1000)}:R>`)
            .setColor(0x5865F2)],
          components:[new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId('nitro_ready:'+id).setLabel('⚡ READY').setStyle(ButtonStyle.Success))]
        });
        await q('UPDATE nitro_drops SET message_id=$1 WHERE id=$2',[msg.id,id]);
        schedule({...row,message_id:msg.id});
        return i.reply({content:`✅ Quick Drop created for **${seconds}s** with **${ready} READY** required.`,ephemeral:true});
      }
    } catch (e) {
      console.error('Nitro drop error:',e);
      if (!i.replied && !i.deferred) await i.reply({content:'❌ Something went wrong with the Quick Drop.',ephemeral:true}).catch(()=>{});
    }
  });

  return { dbInit, ensurePanel, recover };
}

module.exports = { setupNitro };
