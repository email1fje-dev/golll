const { Client, EmbedBuilder, ChannelType } = require('discord.js');

function install(client) {
  const sendLog = async (guild, title, description, color = 0x5865F2) => {
    const ch = guild?.channels.cache.find(
      c => c.name === '⚙️・updates-logs' && c.type === ChannelType.GuildText
    );
    if (!ch) return;

    await ch.send({
      embeds: [
        new EmbedBuilder()
          .setTitle(title)
          .setDescription(description.slice(0, 4000))
          .setColor(color)
          .setTimestamp()
      ]
    }).catch(() => {});
  };

  client.on('guildMemberAdd', member => {
    sendLog(
      member.guild,
      '👋 Member Joined',
      `**User:** ${member.user} (${member.user.tag})\n**ID:** ${member.id}`,
      0x57F287
    );
  });

  client.on('guildMemberRemove', member => {
    sendLog(
      member.guild,
      '🚪 Member Left',
      `**User:** ${member.user.tag}\n**ID:** ${member.id}`,
      0xED4245
    );
  });

  client.on('guildMemberUpdate', async (oldMember, newMember) => {
    const oldRoles = new Set(oldMember.roles.cache.map(r => r.id));
    const newRoles = new Set(newMember.roles.cache.map(r => r.id));

    const added = newMember.roles.cache
      .filter(r => !oldRoles.has(r.id))
      .map(r => r.name);

    const removed = oldMember.roles.cache
      .filter(r => !newRoles.has(r.id))
      .map(r => r.name);

    if (!added.length && !removed.length && oldMember.nickname === newMember.nickname) {
      return;
    }

    let text = `**User:** ${newMember.user}\n**ID:** ${newMember.id}`;

    if (added.length) {
      text += `\n**Roles added:** ${added.join(', ')}`;
    }

    if (removed.length) {
      text += `\n**Roles removed:** ${removed.join(', ')}`;
    }

    if (oldMember.nickname !== newMember.nickname) {
      text += `\n**Nickname:** ${oldMember.nickname || 'None'} → ${newMember.nickname || 'None'}`;
    }

    await sendLog(newMember.guild, '👤 Member Updated', text, 0x5865F2);
  });

  client.on('messageDelete', message => {
    if (!message.guild || message.author?.bot) return;

    sendLog(
      message.guild,
      '🗑️ Message Deleted',
      `**Author:** ${message.author?.tag || 'Unknown'}\n**Channel:** ${message.channel}\n**Content:** ${(message.content || '[embed/attachment]').slice(0, 1800)}`,
      0xED4245
    );
  });

  client.on('messageUpdate', (oldMessage, newMessage) => {
    if (
      !newMessage.guild ||
      newMessage.author?.bot ||
      oldMessage.content === newMessage.content
    ) {
      return;
    }

    sendLog(
      newMessage.guild,
      '✏️ Message Edited',
      `**Author:** ${newMessage.author?.tag || 'Unknown'}\n**Channel:** ${newMessage.channel}\n**Before:** ${(oldMessage.content || '[empty]').slice(0, 1000)}\n**After:** ${(newMessage.content || '[empty]').slice(0, 1000)}`,
      0xF1C40F
    );
  });

  client.on('channelCreate', channel => {
    if (!channel.guild) return;

    sendLog(
      channel.guild,
      '📁 Channel Created',
      `**Channel:** ${channel}\n**Name:** ${channel.name}\n**Type:** ${channel.type}`,
      0x57F287
    );
  });

  client.on('channelDelete', channel => {
    if (!channel.guild) return;

    sendLog(
      channel.guild,
      '🗑️ Channel Deleted',
      `**Name:** ${channel.name}\n**ID:** ${channel.id}`,
      0xED4245
    );
  });

  client.on('channelUpdate', (oldChannel, newChannel) => {
    if (!newChannel.guild || oldChannel.name === newChannel.name) return;

    sendLog(
      newChannel.guild,
      '✏️ Channel Renamed',
      `**Before:** ${oldChannel.name}\n**After:** ${newChannel.name}\n**ID:** ${newChannel.id}`,
      0xF1C40F
    );
  });

  client.on('roleCreate', role => {
    sendLog(
      role.guild,
      '🛡️ Role Created',
      `**Role:** ${role}\n**Name:** ${role.name}\n**ID:** ${role.id}`,
      0x57F287
    );
  });

  client.on('roleDelete', role => {
    sendLog(
      role.guild,
      '🗑️ Role Deleted',
      `**Name:** ${role.name}\n**ID:** ${role.id}`,
      0xED4245
    );
  });

  client.on('roleUpdate', (oldRole, newRole) => {
    if (
      oldRole.name === newRole.name &&
      oldRole.permissions.bitfield === newRole.permissions.bitfield
    ) {
      return;
    }

    sendLog(
      newRole.guild,
      '✏️ Role Updated',
      `**Before:** ${oldRole.name}\n**After:** ${newRole.name}\n**ID:** ${newRole.id}`,
      0xF1C40F
    );
  });

  client.once('ready', () => console.log('Goll logging system loaded.'));
}

const originalLogin = Client.prototype.login;

Client.prototype.login = function (...args) {
  if (!this.__gollLogging) {
    this.__gollLogging = true;
    install(this);
  }

  return originalLogin.apply(this, args);
};
