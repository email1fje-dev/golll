const { Client, ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder, ModalBuilder, TextInputBuilder, TextInputStyle, ChannelType } = require('discord.js');
const { Pool } = require('pg');
const pool = process.env.DATABASE_URL ? new Pool({connectionString:process.env.DATABASE_URL,ssl:{rejectUnauthorized:false}}) : null;
const q = async (sql,p=[]) => pool ? pool.query(sql,p) : {rows:[]};

async function ensurePanel(client,guild) {
  const category=guild.channels.cache.find(c=>c.name==='🔊 VOICE'&&c.type===ChannelType.GuildCategory);
  if(!category) return;
  let ch=guild.channels.cache.find(c=>c.name==='🎛️・voice-controls'&&c.type===ChannelType.GuildText);
  if(!ch) ch=await guild.channels.create({name:'🎛️・voice-controls',type:ChannelType.GuildText,parent:category.id,reason:'Goll voice controls'}).catch(()=>null);
  if(!ch) return;
  const exists=(await ch.messages.fetch({limit:20}).catch(()=>new Map())).some(m=>m.author.id===client.user.id&&m.embeds[0]?.title==='🔊 Temporary Voice Control');
  if(exists)return;
  const rows=[
    new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId('voice_rename').setLabel('✏️ Rename').setStyle(ButtonStyle.Primary),
      new ButtonBuilder().setCustomId('voice_lock').setLabel('🔒 Lock').setStyle(ButtonStyle.Danger),
      new ButtonBuilder().setCustomId('voice_unlock').setLabel('🔓 Unlock').setStyle(ButtonStyle.Success)
    ),
    new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId('voice_limit').setLabel('👥 Limit').setStyle(ButtonStyle.Secondary),
      new ButtonBuilder().setCustomId('voice_kick').setLabel('👢 Kick').setStyle(ButtonStyle.Danger),
      new ButtonBuilder().setCustomId('voice_transfer').setLabel('👑 Transfer Owner').setStyle(ButtonStyle.Secondary)
    )
  ];
  await ch.send({embeds:[new EmbedBuilder().setTitle('🔊 Temporary Voice Control').setDescription('Join 🔊・General to create your room, then manage it here.\\n\\nOnly the current owner can use these controls.').setColor(0x5865F2)],components:rows});
}

function install(client) {
  client.once('ready',async()=>{
    if(pool) await q('CREATE TABLE IF NOT EXISTS temp_voice(channel_id TEXT PRIMARY KEY,guild_id TEXT,owner_id TEXT,created_at TIMESTAMPTZ DEFAULT NOW())').catch(console.error);
    for(const g of client.guilds.cache.values()) await ensurePanel(client,g);
  });

  client.on('interactionCreate',async i=>{
    const ids=['voice_rename','voice_lock','voice_unlock','voice_limit','voice_kick','voice_transfer'];
    if(!i.isButton()||!ids.includes(i.customId))return;
    try{
      const row=(await q('SELECT channel_id FROM temp_voice WHERE guild_id=$1 AND owner_id=$2',[i.guild.id,i.user.id])).rows[0];
      const ch=row&&i.guild.channels.cache.get(row.channel_id);
      if(!ch)return i.reply({content:'❌ You do not own a temporary voice channel.',ephemeral:true});
      if(i.customId==='voice_lock'){await ch.permissionOverwrites.edit(i.guild.id,{Connect:false});return i.reply({content:'🔒 Room locked.',ephemeral:true});}
      if(i.customId==='voice_unlock'){await ch.permissionOverwrites.edit(i.guild.id,{Connect:true});return i.reply({content:'🔓 Room unlocked.',ephemeral:true});}
      if(i.customId==='voice_rename')return i.showModal(new ModalBuilder().setCustomId('voice_rename_modal').setTitle('✏️ Rename Room').addComponents(new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('name').setLabel('New name').setStyle(TextInputStyle.Short).setMaxLength(90).setRequired(true))));
      if(i.customId==='voice_limit')return i.showModal(new ModalBuilder().setCustomId('voice_limit_modal').setTitle('👥 User Limit').addComponents(new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('limit').setLabel('0 = unlimited, max 99').setStyle(TextInputStyle.Short).setRequired(true))));
      const modalId=i.customId==='voice_kick'?'voice_kick_modal':'voice_transfer_modal';
      return i.showModal(new ModalBuilder().setCustomId(modalId).setTitle(i.customId==='voice_kick'?'👢 Kick Member':'👑 Transfer Ownership').addComponents(new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('user_id').setLabel('Discord User ID').setStyle(TextInputStyle.Short).setRequired(true))));
    }catch(e){console.error('voice button',e);if(!i.replied)await i.reply({content:'❌ Voice action failed.',ephemeral:true}).catch(()=>{});}
  });

  client.on('interactionCreate',async i=>{
    const ids=['voice_rename_modal','voice_limit_modal','voice_kick_modal','voice_transfer_modal'];
    if(!i.isModalSubmit()||!ids.includes(i.customId))return;
    try{
      const row=(await q('SELECT channel_id FROM temp_voice WHERE guild_id=$1 AND owner_id=$2',[i.guild.id,i.user.id])).rows[0];
      const ch=row&&i.guild.channels.cache.get(row.channel_id);
      if(!ch)return i.reply({content:'❌ You do not own a temporary voice channel.',ephemeral:true});
      if(i.customId==='voice_rename_modal'){
        const name=i.fields.getTextInputValue('name').trim().replace(/\s+/g,' ');
        await ch.setName(name.slice(0,100));return i.reply({content:'✏️ Renamed to **'+name.slice(0,100)+'**.',ephemeral:true});
      }
      if(i.customId==='voice_limit_modal'){
        const n=Number(i.fields.getTextInputValue('limit'));if(!Number.isInteger(n)||n<0||n>99)return i.reply({content:'❌ Use a number from 0 to 99.',ephemeral:true});
        await ch.setUserLimit(n);return i.reply({content:n?'👥 Limit: **'+n+'**':'👥 Limit removed.',ephemeral:true});
      }
      const userId=i.fields.getTextInputValue('user_id').trim(),member=await i.guild.members.fetch(userId).catch(()=>null);
      if(!member)return i.reply({content:'❌ Member not found.',ephemeral:true});
      if(i.customId==='voice_kick_modal'){
        if(!ch.members.has(member.id))return i.reply({content:'❌ That member is not in the room.',ephemeral:true});
        await member.voice.disconnect('Goll voice owner kick').catch(()=>{});return i.reply({content:'👢 Removed <@'+member.id+'>.',ephemeral:true});
      }
      if(member.id===i.user.id)return i.reply({content:'❌ Pick another member.',ephemeral:true});
      await q('UPDATE temp_voice SET owner_id=$1 WHERE channel_id=$2',[member.id,ch.id]);
      await ch.permissionOverwrites.edit(i.user.id,{ManageChannels:false});
      await ch.permissionOverwrites.edit(member.id,{ViewChannel:true,Connect:true,ManageChannels:true});
      return i.reply({content:'👑 Ownership transferred to <@'+member.id+'>.',ephemeral:true});
    }catch(e){console.error('voice modal',e);if(!i.replied)await i.reply({content:'❌ Voice action failed.',ephemeral:true}).catch(()=>{});}
  });
}

const originalLogin=Client.prototype.login;
Client.prototype.login=function(...args){
  if(!this.__gollAdvancedVoice){this.__gollAdvancedVoice=true;install(this);}
  return originalLogin.apply(this,args);
};
