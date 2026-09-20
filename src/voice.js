const {
  ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder,
  ModalBuilder, TextInputBuilder, TextInputStyle,
  ChannelType, PermissionsBitField
} = require('discord.js');

function setupVoice(q, client) {
  async function getOwned(guild, userId) {
    return (await q('SELECT channel_id,owner_id FROM temp_voice WHERE guild_id=$1 AND owner_id=$2 LIMIT 1',[guild.id,userId])).rows[0] || null;
  }

  async function ensurePanel(guild, force=false) {
    const category = guild.channels.cache.find(c=>c.name==='🔊 VOICE' && c.type===ChannelType.GuildCategory);
    if (!category) return;
    let ch = guild.channels.cache.find(c=>c.name==='🎛️・voice-controls' && c.type===ChannelType.GuildText);
    if (!ch) {
      ch = await guild.channels.create({
        name:'🎛️・voice-controls',
        type:ChannelType.GuildText,
        parent:category.id,
        reason:'Goll temporary voice controls'
      }).catch(()=>null);
    }
    if (!ch) return;
    const exists = (await ch.messages.fetch({limit:20}).catch(()=>new Map()))
      .some(m=>m.author.id===client.user.id && m.embeds[0]?.title==='🔊 Temporary Voice Control');
    if (exists && !force) return;
    const row1 = new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId('voice_rename').setLabel('✏️ Rename').setStyle(ButtonStyle.Primary),
      new ButtonBuilder().setCustomId('voice_lock').setLabel('🔒 Lock').setStyle(ButtonStyle.Danger),
      new ButtonBuilder().setCustomId('voice_unlock').setLabel('🔓 Unlock').setStyle(ButtonStyle.Success)
    );
    const row2 = new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId('voice_limit').setLabel('👥 Limit').setStyle(ButtonStyle.Secondary),
      new ButtonBuilder().setCustomId('voice_kick').setLabel('👢 Kick').setStyle(ButtonStyle.Danger),
      new ButtonBuilder().setCustomId('voice_transfer').setLabel('👑 Transfer Owner').setStyle(ButtonStyle.Secondary)
    );
    await ch.send({
      embeds:[new EmbedBuilder().setTitle('🔊 Temporary Voice Control')
        .setDescription('Create a temporary room by joining **🔊・General**.\n\nThen use these buttons to manage your own room — no slash commands needed.')
        .setColor(0x5865F2)],
      components:[row1,row2]
    });
  }

  async function ownerInteraction(i) {
    const row = await getOwned(i.guild,i.user.id);
    if (!row) return i.reply({content:'❌ You do not own a temporary voice channel.',ephemeral:true});
    const ch = i.guild.channels.cache.get(row.channel_id);
    if (!ch) {
      await q('DELETE FROM temp_voice WHERE channel_id=$1',[row.channel_id]);
      return i.reply({content:'❌ Your temporary channel no longer exists.',ephemeral:true});
    }
    return {row,ch};
  }

  client.once('ready', async () => {
    for (const guild of client.guilds.cache.values()) await ensurePanel(guild);
  });

  client.on('interactionCreate', async i => {
    try {
      if (!i.isButton() || !['voice_rename','voice_lock','voice_unlock','voice_limit','voice_kick','voice_transfer'].includes(i.customId)) return;
      const own = await ownerInteraction(i);
      if (!own || !own.ch) return;

      if (i.customId==='voice_rename') {
        return i.showModal(new ModalBuilder().setCustomId('voice_rename_modal').setTitle('✏️ Rename Room').addComponents(
          new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('name').setLabel('New channel name').setStyle(TextInputStyle.Short).setMaxLength(90).setRequired(true))
        ));
      }
      if (i.customId==='voice_limit') {
        return i.showModal(new ModalBuilder().setCustomId('voice_limit_modal').setTitle('👥 User Limit').addComponents(
          new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('limit').setLabel('Limit (0 = unlimited)').setStyle(TextInputStyle.Short).setRequired(true))
        ));
      }
      if (i.customId==='voice_kick' || i.customId==='voice_transfer') {
        const modal = new ModalBuilder().setCustomId(i.customId==='voice_kick'?'voice_kick_modal':'voice_transfer_modal')
          .setTitle(i.customId==='voice_kick'?'👢 Kick Member':'👑 Transfer Ownership')
          .addComponents(new ActionRowBuilder().addComponents(
            new TextInputBuilder().setCustomId('user_id').setLabel('Discord User ID').setStyle(TextInputStyle.Short).setRequired(true)
          ));
        return i.showModal(modal);
      }
      if (i.customId==='voice_lock') {
        await own.ch.permissionOverwrites.edit(i.guild.id,{Connect:false});
        return i.reply({content:'🔒 Your voice room is now locked.',ephemeral:true});
      }
      if (i.customId==='voice_unlock') {
        await own.ch.permissionOverwrites.edit(i.guild.id,{Connect:true});
        return i.reply({content:'🔓 Your voice room is now unlocked.',ephemeral:true});
      }
    } catch(e) {
      console.error('Voice control:',e);
      if (!i.replied && !i.deferred) await i.reply({content:'❌ Voice control failed.',ephemeral:true}).catch(()=>{});
    }
  });

  client.on('interactionCreate', async i => {
    if (!i.isModalSubmit() || !['voice_rename_modal','voice_limit_modal','voice_kick_modal','voice_transfer_modal'].includes(i.customId)) return;
    try {
      const own = await ownerInteraction(i);
      if (!own || !own.ch) return;

      if (i.customId==='voice_rename_modal') {
        const name=i.fields.getTextInputValue('name').trim().replace(/\\s+/g,' ');
        if (!name) return i.reply({content:'❌ Name cannot be empty.',ephemeral:true});
        await own.ch.setName(name.slice(0,100));
        return i.reply({content:`✏️ Room renamed to **${name.slice(0,100)}**.`,ephemeral:true});
      }

      if (i.customId==='voice_limit_modal') {
        const n=parseInt(i.fields.getTextInputValue('limit'),10);
        if (!Number.isInteger(n) || n<0 || n>99) return i.reply({content:'❌ Enter a number from 0 to 99.',ephemeral:true});
        await own.ch.setUserLimit(n);
        return i.reply({content:n===0?'👥 User limit removed.':`👥 User limit set to **${n}**.`,ephemeral:true});
      }

      const userId=i.fields.getTextInputValue('user_id').trim();
      const member=await i.guild.members.fetch(userId).catch(()=>null);
      if (!member) return i.reply({content:'❌ Member not found.',ephemeral:true});

      if (i.customId==='voice_kick_modal') {
        if (!own.ch.members.has(member.id)) return i.reply({content:'❌ That member is not in your room.',ephemeral:true});
        await member.voice.disconnect('Goll temporary voice owner kick').catch(()=>{});
        return i.reply({content:`👢 Removed <@${member.id}> from your room.`,ephemeral:true});
      }

      if (member.id===i.user.id) return i.reply({content:'❌ You cannot transfer ownership to yourself.',ephemeral:true});
      await q('UPDATE temp_voice SET owner_id=$1 WHERE channel_id=$2',[member.id,own.ch.id]);
      await own.ch.permissionOverwrites.edit(i.guild.id,{Connect:true});
      await own.ch.permissionOverwrites.edit(i.user.id,{ManageChannels:false});
      await own.ch.permissionOverwrites.edit(member.id,{ViewChannel:true,Connect:true,ManageChannels:true});
      return i.reply({content:`👑 Ownership transferred to <@${member.id}>.`,ephemeral:true});
    } catch(e) {
      console.error('Voice modal:',e);
      if (!i.replied && !i.deferred) await i.reply({content:'❌ Voice action failed.',ephemeral:true}).catch(()=>{});
    }
  });

  return {ensurePanel};
}

module.exports = {setupVoice};
