try {
  require('dotenv').config();
} catch (error) {
  if (error.code !== 'MODULE_NOT_FOUND') {
    throw error;
  }
}

const fs = require('fs');
const path = require('path');

const TOKEN = process.env.DISCORD_TOKEN;
const CLIENT_ID = process.env.CLIENT_ID;
const GUILD_ID = process.env.GUILD_ID;
const AUTO_ROLE_ID = process.env.AUTO_ROLE_ID;
const DEFAULT_IMAGE_URL = process.env.DEFAULT_IMAGE_URL || '';
const ADMIN_ROLES = (process.env.ADMIN_ROLE_IDS || '')
  .split(',')
  .map(roleId => roleId.trim())
  .filter(Boolean);

if (!TOKEN || !CLIENT_ID || !GUILD_ID) {
  console.error('Missing DISCORD_TOKEN, CLIENT_ID, or GUILD_ID in .env');
  process.exit(1);
}

const STATE_FILE = path.join(__dirname, 'state.json');
const ARCHIVE_FILE = path.join(__dirname, 'archive.json');

const {
  Client,
  GatewayIntentBits,
  SlashCommandBuilder,
  REST,
  Routes,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  StringSelectMenuBuilder,
  EmbedBuilder,
  MessageFlags
} = require('discord.js');

// Fixed seat list: users join these lists, not Discord roles.
const SEAT_CONFIG = [
  { key: 'host', label: '🗿 Host | Самый Главный', capacity: 1 },
  { key: 'solo_stage', label: '⭐ Solo Stage | Танцор Соло', capacity: 10 },
  { key: 'duo_stage', label: '👯 Duo Stage | Танцоры Дуо', capacity: 2 },
  { key: 'sofa', label: '🛋️ Sofa | Диван', capacity: 10 },
  { key: 'group_stage', label: '🧑‍🤝‍🧑 Group Stage | Табун Танцоров', capacity: 4 },
  { key: 'manager', label: '📋 Manager | Заведующий', capacity: 4 },
  { key: 'security', label: '🛡️ Security | Тестостероны', capacity: 2 },
  { key: 'mc', label: '🎤 MC | Тамада', capacity: 2 },
  { key: 'director_staff', label: '🎬 Director Staff | Смотрящие', capacity: 2 },
  { key: 'photographer', label: '📸 Photographer | Чел с Камерой', capacity: 2 },
  { key: 'dj', label: '💿 DJ | Чел за Пультом', capacity: 1 },
];

// ---------- Persistence ----------

function createDefaultState() {
  const now = new Date();

  const eventTime = new Date(now);
  // Always pick the next Wednesday at 22:00 (if today is Wednesday, pick next week)
  const day = eventTime.getDay(); // 0=Sun, 1=Mon, 2=Tue, 3=Wed, 4=Thu, 5=Fri, 6=Sat
  const daysUntilNextWednesday = (3 - day + 7) % 7 || 7;
  eventTime.setDate(eventTime.getDate() + daysUntilNextWednesday);
  eventTime.setHours(22, 0, 0, 0);

  const registrationCloseTime = new Date(eventTime);
  registrationCloseTime.setDate(registrationCloseTime.getDate() - 1); // 1 day before

  const registrationStartTime = new Date(eventTime);
  registrationStartTime.setDate(registrationStartTime.getDate() - 6); // 6 days before

  const durationMinutes = 120; // 2 hours

  return {
    signupMessageId: null,
    signupChannelId: null,
    announcementMessageId: null,
    title: 'Mirax Registration | Lap Dance',
    description: 'Wait until registration start time and then select your role from the menu below',
    descriptionRus: 'Дождитесь начала регистрации и потом выберите свою роль в меню ниже',
    imageUrl: DEFAULT_IMAGE_URL,
    seats: Object.fromEntries(SEAT_CONFIG.map(s => [s.key, []])),
    capacities: Object.fromEntries(SEAT_CONFIG.map(s => [s.key, s.capacity])),

    eventTime: eventTime.toISOString(),
    registrationCloseTime: registrationCloseTime.toISOString(),
    registrationStartTime: registrationStartTime.toISOString(),
    durationMinutes,
	  staffTGathering: 'Staff should gather half an hour before the event start',
    staffTGatheringRus: 'Персонал должен собраться за полчаса до начала мероприятия',
  };
}

function loadState() {
  if (!fs.existsSync(STATE_FILE)) {
    return createDefaultState();
  }

  try {
    const raw = fs.readFileSync(STATE_FILE, 'utf8');
    const parsed = JSON.parse(raw);

    const base = createDefaultState();

    for (const seat of SEAT_CONFIG) {
      if (Array.isArray(parsed.seats?.[seat.key])) {
        base.seats[seat.key] = parsed.seats[seat.key];
      }

	  if (
	    parsed.capacities &&
	    Object.prototype.hasOwnProperty.call(parsed.capacities, seat.key)
	  ) {
	    base.capacities[seat.key] = parsed.capacities[seat.key];
	  }
    }

    base.signupMessageId = parsed.signupMessageId || null;
    base.signupChannelId = parsed.signupChannelId || null;
    base.announcementMessageId = parsed.announcementMessageId || null;
    base.title = parsed.title || base.title;
    base.description = parsed.description || base.description;
    if (typeof parsed.descriptionRus === 'string' && parsed.descriptionRus.trim()) {
      base.descriptionRus = parsed.descriptionRus;
    }
    if (typeof parsed.imageUrl === 'string' && parsed.imageUrl.trim()) {
      base.imageUrl = parsed.imageUrl;
    }
	
	if (parsed.eventTime) {
	  base.eventTime = parsed.eventTime;
	}
	if (parsed.registrationCloseTime) {
	  base.registrationCloseTime = parsed.registrationCloseTime;
	}
	if (!parsed.registrationCloseTime && parsed.eventTime) {
	  const close = new Date(parsed.eventTime);
	  close.setDate(close.getDate() - 1);
	  base.registrationCloseTime = close.toISOString();
	}
	if (!parsed.registrationStartTime && parsed.eventTime) {
	  const start = new Date(parsed.eventTime);
	  start.setDate(start.getDate() - 5);
	  base.registrationStartTime = start.toISOString();
	}
	if (parsed.registrationStartTime) {
	  base.registrationStartTime = parsed.registrationStartTime;
	}
	if (typeof parsed.durationMinutes === 'number') {
	  base.durationMinutes = parsed.durationMinutes;
	}
	if (typeof parsed.staffTGathering === 'string') {
	  base.staffTGathering = parsed.staffTGathering;
	}
	if (typeof parsed.staffTGatheringRus === 'string') {
	  base.staffTGatheringRus = parsed.staffTGatheringRus;
	}

    return base;
  } catch (err) {
    console.error('Failed to load state.json, using default state.', err);
    return createDefaultState();
  }
}

function saveState(state) {
  fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2), 'utf8');
}

function loadArchive() {
  if (!fs.existsSync(ARCHIVE_FILE)) {
    return [];
  }

  try {
    const raw = fs.readFileSync(ARCHIVE_FILE, 'utf8');
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch (err) {
    console.error('Failed to load archive.json, using empty archive.', err);
    return [];
  }
}

function saveArchive(archive) {
  fs.writeFileSync(ARCHIVE_FILE, JSON.stringify(archive, null, 2), 'utf8');
}

function popLatestArchive() {
  const archive = loadArchive();
  const last = archive.pop() || null;
  if (last) {
    saveArchive(archive);
  }
  return last;
}

function resetCurrentState() {
  const nextState = createDefaultState();
  nextState.signupMessageId = null;
  nextState.signupChannelId = null;
  nextState.announcementMessageId = null;
  return nextState;
}

function toMinuteTimestamp(value) {
  const date = value instanceof Date ? value : new Date(value);
  return Math.floor(date.getTime() / 60000);
}

function eventMatchesMinute(eventTime, targetDate) {
  return toMinuteTimestamp(eventTime) === toMinuteTimestamp(targetDate);
}

function takeArchivedEventByDate(targetDate) {
  const archive = loadArchive();
  const index = archive.findIndex(item => eventMatchesMinute(item?.eventTime, targetDate));

  if (index === -1) {
    return null;
  }

  const [event] = archive.splice(index, 1);
  saveArchive(archive);
  return event;
}

function listAllEvents() {
  const archive = loadArchive();
  const items = [];

  if (state.signupMessageId && state.signupChannelId) {
    items.push({
      scope: 'current',
      eventTime: state.eventTime,
    });
  }

  for (const item of archive) {
    items.push({
      scope: 'archive',
      eventTime: item.eventTime,
    });
  }

  items.sort((a, b) => new Date(b.eventTime) - new Date(a.eventTime));
  return items;
}

let state = loadState();

// ---------- Helpers ----------

function getSeatConfig(key) {
  return SEAT_CONFIG.find(s => s.key === key);
}

function getSeatCapacity(seatKey, currentState = state) {
  if (
    currentState.capacities &&
    Object.prototype.hasOwnProperty.call(currentState.capacities, seatKey)
  ) {
    return currentState.capacities[seatKey];
  }

  return getSeatConfig(seatKey)?.capacity ?? 0;
}

function isUserInAnySeat(userId) {
  for (const seat of SEAT_CONFIG) {
    if (state.seats[seat.key].includes(userId)) {
      return true;
    }
  }
  return false;
}

function removeUserFromAllSeats(userId) {
  for (const seat of SEAT_CONFIG) {
    state.seats[seat.key] = state.seats[seat.key].filter(id => id !== userId);
  }
}

function removeUserFromSeat(userId, seatKey) {
  const seat = getSeatConfig(seatKey);
  if (!seat) {
    return { ok: false, message: 'Unknown seat.' };
  }

  const users = state.seats[seatKey] || [];
  if (!users.includes(userId)) {
    return { ok: false, message: `That user is not in ${seat.label}.` };
  }

  state.seats[seatKey] = users.filter(id => id !== userId);
  saveState(state);

  return { ok: true, message: `Removed user from ${seat.label}.` };
}

function removeUserFromEverySeat(userId) {
  const removedFrom = [];

  for (const seat of SEAT_CONFIG) {
    const users = state.seats[seat.key] || [];
    if (users.includes(userId)) {
      state.seats[seat.key] = users.filter(id => id !== userId);
      removedFrom.push(seat.label);
    }
  }

  if (removedFrom.length === 0) {
    return { ok: false, message: 'That user is not in any seat.' };
  }

  saveState(state);

  return {
    ok: true,
    removedFrom,
    message: `Removed user from ${removedFrom.join(', ')}.`,
  };
}

function addUserToSeat(userId, seatKey) {
	const seat = getSeatConfig(seatKey);
	if (!seat) {
	return { ok: false, error: 'Unknown seat.' };
	}

	if (state.seats[seatKey].includes(userId)) {
	  return { ok: true, changed: false, message: 'You are already in that seat.' };
	}

	const capacity = getSeatCapacity(seatKey);
	if (capacity !== null && state.seats[seatKey].length >= capacity) {
	  return { ok: false, error: `That seat is full (${capacity}/${capacity}).` };
	}

	state.seats[seatKey].push(userId);
	saveState(state);

	return { ok: true, changed: true, message: `Joined ${seat.label}.` };
}

function leaveSeats(userId) {
  if (!isUserInAnySeat(userId)) {
    return { ok: true, changed: false, message: 'You are not in any seat.' };
  }

  removeUserFromAllSeats(userId);
  saveState(state);
  return { ok: true, changed: true, message: 'You left the RSVP.' };
}

function seatFieldText(seatKey, currentState = state) {
  const users = currentState.seats[seatKey] || [];

  if (users.length === 0) {
    return '—\n\u200B';
  }

  return users.map(id => `<@${id}>`).join('\n') + '\n\u200B';
}

function buildEmbed(client, currentState = state, statusOverride = null) {
  const guild = client.guilds.cache.get(GUILD_ID);
  const groupName = guild?.name || "Unknown Server";
  const groupIcon = guild?.iconURL({ size: 128, extension: 'png' }) || undefined;
  
  const embed = new EmbedBuilder()
    .setTitle(currentState.title)
    .setDescription(`${currentState.description}\n${currentState.descriptionRus}\n\n${buildEventInfoLines(currentState, statusOverride)}\n\u200B`)
    .setColor(0xb100cd) //purple
	.setImage(currentState.imageUrl)
	.setFooter({
		text: `${groupName}  •  ${formatDateTime(currentState.eventTime)}`,
		iconURL: groupIcon,
	});

  for (const seat of SEAT_CONFIG) {
    const users = currentState.seats[seat.key] || [];
	const capacity = getSeatCapacity(seat.key, currentState);
    embed.addFields({
      name: `${seat.label} (${users.length}/${capacity === null ? '∞' : capacity})`,
      value: seatFieldText(seat.key, currentState),
      inline: true,
    });
  }

  return embed;
}

function buildComponents(currentState = state) {
  if (!isRegistrationOpen(currentState)) {
    return [];
  }

  // Select menu is easier than making 11 separate buttons.
  const select = new StringSelectMenuBuilder()
    .setCustomId('rsvp_select')
    .setPlaceholder('Choose your seat')
	.addOptions(
	  SEAT_CONFIG.filter(seat => {
		const capacity = getSeatCapacity(seat.key, currentState);
		if (capacity === null) return true;
		const count = (currentState.seats[seat.key] || []).length;
		return count < capacity;
	  }).map(seat => {
		const capacity = getSeatCapacity(seat.key, currentState);
		const { labelText, emoji } = splitSeatLabel(seat.label);

		return {
		  label: labelText,
		  ...(emoji ? { emoji } : {}),
		  description: `${(currentState.seats[seat.key] || []).length}/${capacity === null ? '∞' : capacity} occupied`,
		  value: seat.key,
		};
	  })
	);

  const row1 = new ActionRowBuilder().addComponents(select);

  const leaveButton = new ButtonBuilder()
    .setCustomId('rsvp_leave')
    .setLabel('Leave')
    .setStyle(ButtonStyle.Danger);

  const refreshButton = new ButtonBuilder()
    .setCustomId('rsvp_refresh')
    .setLabel('Refresh')
    .setStyle(ButtonStyle.Secondary);

  const row2 = new ActionRowBuilder().addComponents(leaveButton, refreshButton);

  return [row1, row2];
}

async function updateSignupMessage(client) {
  if (!state.signupChannelId || !state.signupMessageId) return;

  try {
    const channel = await client.channels.fetch(state.signupChannelId);
    if (!channel || !channel.isTextBased()) return;

    const msg = await channel.messages.fetch(state.signupMessageId);
    await msg.edit({
      embeds: [buildEmbed(client)],
      components: buildComponents(),
    });
  } catch (err) {
    console.error('Failed to update signup message:', err.message);
  }
}

async function deleteTrackedMessage(client, channelId, messageId, label) {
  if (!channelId || !messageId) {
    return;
  }

  try {
    const channel = await client.channels.fetch(channelId);
    if (!channel || !channel.isTextBased()) return;

    const msg = await channel.messages.fetch(messageId);
    await msg.delete();
  } catch (err) {
    console.error(`Failed to delete ${label}:`, err.message);
  }
}

async function archiveAndCloseCurrentEvent(client) {
  if (!state.signupChannelId || !state.signupMessageId) return;

  const archivedState = JSON.parse(JSON.stringify(state));
  const now = new Date();

  if (now <= new Date(archivedState.eventTime)) {
    archivedState.eventTime = now.toISOString();

    const registrationClose = new Date(now);
    registrationClose.setDate(registrationClose.getDate() - 1);
    archivedState.registrationCloseTime = registrationClose.toISOString();

    const registrationStart = new Date(now);
    registrationStart.setDate(registrationStart.getDate() - 5);
    archivedState.registrationStartTime = registrationStart.toISOString();
  }

  try {
    const channel = await client.channels.fetch(archivedState.signupChannelId);
    if (channel && channel.isTextBased()) {
      const msg = await channel.messages.fetch(archivedState.signupMessageId);
      await msg.edit({
        embeds: [buildEmbed(client, archivedState, 'event_ended')],
        components: [],
      });
    }
  } catch (err) {
    console.error('Failed to archive previous event message:', err.message);
  }

  const archive = loadArchive();
  archive.push(archivedState);
  saveArchive(archive);
}

function formatDateTime(isoString) {
  const d = new Date(isoString);

  const day = String(d.getDate()).padStart(2, '0');
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const year = d.getFullYear();

  const hours = String(d.getHours()).padStart(2, '0');
  const minutes = String(d.getMinutes()).padStart(2, '0');

  return `${day}.${month}.${year} ${hours}:${minutes}`;
}

function getEventEndTime(currentState = state) {
  const start = new Date(currentState.eventTime);
  return new Date(start.getTime() + currentState.durationMinutes * 60 * 1000);
}

function getRegistrationStartTime(currentState = state) {
  if (currentState.registrationStartTime) {
    return new Date(currentState.registrationStartTime);
  }

  const eventStart = new Date(currentState.eventTime);
  return new Date(eventStart.getTime() - 5 * 24 * 60 * 60 * 1000);
}

function isRegistrationOpen(currentState = state) {
  const now = new Date();
  const registrationStart = getRegistrationStartTime(currentState);
  const registrationClose = new Date(currentState.registrationCloseTime);
  return now >= registrationStart && now < registrationClose;
}

function getEventStatusKey(currentState = state, statusOverride = null) {
  if (statusOverride) return statusOverride;
  const now = new Date();
  const eventStart = new Date(currentState.eventTime);
  const registrationClose = new Date(currentState.registrationCloseTime);
  const eventEnd = getEventEndTime(currentState);
  const registrationStart = getRegistrationStartTime(currentState);

  if (now < registrationStart) return 'wait_registration';
  if (now < registrationClose) return 'open_registration';
  if (now < eventStart) return 'registration_closed';
  if (now < eventEnd) return 'event_started';
  return 'event_ended';
}

function getEventStatusText(currentState = state, statusOverride = null) {
  const statusKey = getEventStatusKey(currentState, statusOverride);

  const statuses = {
    wait_registration: {
      en: 'Please wait for registration start',
      ru: 'Пожалуйста дождитесь начала регистрации',
    },
    open_registration: {
      en: 'Open to registration. Choose your role below',
      ru: 'Регистрация открыта. Выберите свою роль ниже',
    },
    registration_closed: {
      en: 'Registration closed. Get ready for the event',
      ru: 'Регистрация закрыта. Ивент скоро начнётся',
    },
    event_started: {
      en: 'Registration closed. Event already started',
      ru: 'Регистрация закрыта. Ивент уже начался',
    },
    event_ended: {
      en: 'Event ended',
      ru: 'Ивент завершен',
    },
  };

  return statuses[statusKey] || {
    en: String(statusKey),
    ru: String(statusKey),
  };
}

function toUnixSeconds(isoString) {
  return Math.floor(new Date(isoString).getTime() / 1000);
}

function discordTimestamp(isoString, style = 'F') {
  return `<t:${toUnixSeconds(isoString)}:${style}>`;
}

function discordTimestampNoWeekday(isoString) {
  // "f" = short date/time without weekday (Discord formatting)
  return discordTimestamp(isoString, 'f');
}

function formatDuration(minutes) {
  const hours = Math.floor(minutes / 60);
  const mins = minutes % 60;

  if (hours && mins) return `${hours}h ${mins}m`;
  if (hours) return `${hours}h`;
  return `${mins}m`;
}

function splitSeatLabel(rawLabel) {
  const trimmed = rawLabel.trim();
  const emojiMatch = trimmed.match(
    /^(\p{Extended_Pictographic}|\p{Emoji_Presentation})(\uFE0F|\u200D\p{Extended_Pictographic})*/u
  );
  const emoji = emojiMatch ? emojiMatch[0] : null;
  const labelText = trimmed
    .replace(
      /^(\p{Extended_Pictographic}|\p{Emoji_Presentation})(\uFE0F|\u200D\p{Extended_Pictographic})*/u,
      ''
    )
    .trim()
    .slice(0, 100);

  return {
    labelText: labelText || trimmed.slice(0, 100),
    emoji,
  };
}

function buildEventInfoLines(currentState = state, statusOverride = null) {
  const registrationStartIso = getRegistrationStartTime(currentState).toISOString();
  const statusText = getEventStatusText(currentState, statusOverride);

  return [
    `**Event start:** ${discordTimestamp(currentState.eventTime, 'F')} (${discordTimestamp(currentState.eventTime, 'R')})`,
    `**Registration start:** ${discordTimestampNoWeekday(registrationStartIso)} (${discordTimestamp(registrationStartIso, 'R')})`,
    `**Registration closes:** ${discordTimestampNoWeekday(currentState.registrationCloseTime)} (${discordTimestamp(currentState.registrationCloseTime, 'R')})`,
    `**Duration:** ${formatDuration(currentState.durationMinutes)}` + '\n\u200B',
    `**For staff:** ${currentState.staffTGathering}`,
    `**Персоналу:** ${currentState.staffTGatheringRus}` + '\n\u200B',
    `**Status:** ${statusText.en}`,
    `**Статус:** ${statusText.ru}`,
  ].join('\n');
}

function parseDateTimeInput(input) {
  const match = input.match(/^(\d{4})-(\d{2})-(\d{2})\s+(\d{2}):(\d{2})$/);
  if (!match) return null;

  const [, year, month, day, hour, minute] = match;
  const date = new Date(
    Number(year),
    Number(month) - 1,
    Number(day),
    Number(hour),
    Number(minute)
  );

  return Number.isNaN(date.getTime()) ? null : date;
}

function isValidHttpUrl(value) {
  try {
    const url = new URL(value);
    return url.protocol === 'http:' || url.protocol === 'https:';
  } catch {
    return false;
  }
}

function isUnlimitedSeat(seatKey) {
  return getSeatCapacity(seatKey) === null;
}

// ---------- Slash command registration ----------

const commands = [
  new SlashCommandBuilder()
    .setName('newevent')
    .setDescription('Post new registration message')
    .addStringOption(opt =>
      opt
        .setName('title')
        .setDescription('Embed title')
        .setRequired(false)
    )
    .addStringOption(opt =>
      opt
        .setName('description')
        .setDescription('Embed description')
        .setRequired(false)
    ),

  new SlashCommandBuilder()
    .setName('deleteevent')
    .setDescription('Delete latest posted event and restore previous one')
    .addBooleanOption(opt =>
      opt
        .setName('confirm')
        .setDescription('Confirm deleting the latest event')
        .setRequired(true)
    )
    .addStringOption(opt =>
      opt
        .setName('datetime')
        .setDescription('Optional target event time: YYYY-MM-DD HH:mm')
        .setRequired(false)
    ),

  new SlashCommandBuilder()
    .setName('eventlist')
    .setDescription('Show current and archived event times'),

  new SlashCommandBuilder()
    .setName('clearseating')
    .setDescription('Clear all RSVP seats')
    .addBooleanOption(opt =>
      opt
        .setName('confirm')
        .setDescription('Confirm clearing all seats')
        .setRequired(true)
    ),
	
	new SlashCommandBuilder()
	.setName('removeuser')
	.setDescription('Remove a user from one seat or from all seats')
	.addUserOption(opt =>
	opt
	  .setName('user')
	  .setDescription('User to remove')
	  .setRequired(true)
	)
	.addStringOption(opt =>
	opt
	  .setName('seat')
	  .setDescription('Optional: remove only from this seat')
	  .setRequired(false)
	  .addChoices(
		...SEAT_CONFIG.map(seat => ({
		  name: seat.label,
		  value: seat.key,
		}))
	  )
	),

	new SlashCommandBuilder()
	  .setName('setseatcapacity')
	  .setDescription('Change how many users a seat can have')
	  .addStringOption(opt =>
		opt
		  .setName('seat')
		  .setDescription('Seat key')
		  .setRequired(true)
		  .addChoices(
			...SEAT_CONFIG.map(seat => ({
			  name: seat.label,
			  value: seat.key,
			}))
		  )
	  )
	  .addIntegerOption(opt =>
		opt
		  .setName('number')
		  .setDescription('New capacity')
		  .setRequired(false)
		  .setMinValue(1)
	  )
	  .addBooleanOption(opt =>
		opt
		  .setName('unlimited')
		  .setDescription('Set this seat to unlimited capacity')
		  .setRequired(false)
	  ),
	
  new SlashCommandBuilder()
  .setName('resetcapacities')
  .setDescription('Reset all seat capacities to default values')
  .addBooleanOption(opt =>
    opt
      .setName('confirm')
      .setDescription('Confirm resetting all capacities')
      .setRequired(true)
  ),
  
  new SlashCommandBuilder()
  .setName('seteventtime')
  .setDescription('Set the event start time')
  .addStringOption(opt =>
    opt
      .setName('datetime')
      .setDescription('Format: YYYY-MM-DD HH:mm')
      .setRequired(true)
  ),
  
  new SlashCommandBuilder()
  .setName('setduration')
  .setDescription('Set event duration in minutes')
  .addIntegerOption(opt =>
    opt
      .setName('minutes')
      .setDescription('Event duration in minutes')
      .setRequired(true)
      .setMinValue(1)
  ),
  
  new SlashCommandBuilder()
  .setName('setregistrationclose')
  .setDescription('Set registration closing time')
  .addStringOption(opt =>
    opt
      .setName('datetime')
      .setDescription('Format: YYYY-MM-DD HH:mm')
      .setRequired(true)
  ),

  new SlashCommandBuilder()
  .setName('setregistrationstart')
  .setDescription('Set registration start time')
  .addStringOption(opt =>
    opt
      .setName('datetime')
      .setDescription('Format: YYYY-MM-DD HH:mm')
      .setRequired(true)
  ),

  new SlashCommandBuilder()
  .setName('setimage')
  .setDescription('Set event image by URL')
  .addStringOption(opt =>
    opt
      .setName('url')
      .setDescription('Direct image URL')
      .setRequired(true)
  ),
].map(cmd => cmd.toJSON());

async function registerCommands() {
  const rest = new REST({ version: '10' }).setToken(TOKEN);
  await rest.put(
    Routes.applicationGuildCommands(CLIENT_ID, GUILD_ID),
    { body: commands }
  );
  console.log('Slash commands registered.');
}

// ---------- Client ----------

const client = new Client({
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMembers],
});

client.once('clientReady', async () => {
	console.log(`Logged in as ${client.user.tag}`);
	await updateSignupMessage(client);
  
	setInterval(() => {
	updateSignupMessage(client).catch(console.error);
	}, 60 * 1000);
});

client.on('guildMemberAdd', async member => {
  if (!AUTO_ROLE_ID) {
    return;
  }

  try {
    await member.roles.add(AUTO_ROLE_ID, 'Auto-role for new members');
  } catch (err) {
    console.error(`Failed to auto-assign role to ${member.user.tag}:`, err.message);
  }
});

client.on('interactionCreate', async interaction => {
  try {
    if (interaction.isChatInputCommand()) {
      await interaction.deferReply({ flags: MessageFlags.Ephemeral });

      const hasRole =
        interaction.inGuild() &&
        interaction.member?.roles?.cache?.some(role =>
          ADMIN_ROLES.includes(role.id)
        );

      if (!hasRole) {
        await interaction.editReply("You don't have permission.");
        return;
      }

      if (interaction.commandName === 'newevent') {
        if (state.signupMessageId && state.signupChannelId) {
          await archiveAndCloseCurrentEvent(client);
        }

        const nextState = createDefaultState();
        const title = interaction.options.getString('title') || nextState.title;
        const description =
          interaction.options.getString('description') || nextState.description;

        nextState.title = title;
        nextState.description = description;

        const sent = await interaction.channel.send({
          content: '@everyone',
          allowedMentions: { parse: ['everyone'] },
          embeds: [buildEmbed(client, nextState)],
          components: buildComponents(nextState),
        });

        nextState.signupMessageId = sent.id;
        nextState.signupChannelId = sent.channel.id;
        nextState.announcementMessageId = null;
        state = nextState;
        saveState(state);

        await interaction.editReply('RSVP message posted.');
        setTimeout(() => {
          interaction.deleteReply().catch(() => {});
        }, 3000);
        return;
      }

      if (interaction.commandName === 'eventlist') {
        const events = listAllEvents();

        if (events.length === 0) {
          await interaction.editReply('No current or archived events found.');
          return;
        }

        const lines = events.map((item, index) => {
          const prefix = item.scope === 'current' ? '[current]' : '[archived]';
          return `${index + 1}. ${prefix} ${formatDateTime(item.eventTime)}`;
        });

        await interaction.editReply(lines.join('\n'));
        return;
      }
	  
	  if (interaction.commandName === 'seteventtime') {
		  const input = interaction.options.getString('datetime');
		  const date = parseDateTimeInput(input);

		  if (!date) {
			await interaction.editReply('Invalid date format. Use: YYYY-MM-DD HH:mm');
			return;
		  }

		  state.eventTime = date.toISOString();

		  // default registration close = 1 day earlier
		  const registrationClose = new Date(date.getTime() - 24 * 60 * 60 * 1000);
		  state.registrationCloseTime = registrationClose.toISOString();
		  // default registration start = 5 days earlier
		  const registrationStart = new Date(date.getTime() - 5 * 24 * 60 * 60 * 1000);
		  state.registrationStartTime = registrationStart.toISOString();

		  saveState(state);
		  await updateSignupMessage(client);

		  await interaction.editReply(
			`Event time set to ${formatDateTime(state.eventTime)}. Registration start was automatically set to ${formatDateTime(state.registrationStartTime)}. Registration close was automatically set to ${formatDateTime(state.registrationCloseTime)}.`
		  );
		  return;
		}
		
		if (interaction.commandName === 'setduration') {
		  const minutes = interaction.options.getInteger('minutes');
		  state.durationMinutes = minutes;

		  saveState(state);
		  await updateSignupMessage(client);

		  await interaction.editReply(`Event duration set to ${formatDuration(minutes)}.`);
		  return;
		}
		
		if (interaction.commandName === 'setregistrationclose') {
		  const input = interaction.options.getString('datetime');
		  const date = parseDateTimeInput(input);

		  if (!date) {
			await interaction.editReply('Invalid date format. Use: YYYY-MM-DD HH:mm');
			return;
		  }

		  state.registrationCloseTime = date.toISOString();

		  saveState(state);
		  await updateSignupMessage(client);

		  await interaction.editReply(
			`Registration close time set to ${formatDateTime(state.registrationCloseTime)}.`
		  );
		  return;
		}

		if (interaction.commandName === 'setregistrationstart') {
		  const input = interaction.options.getString('datetime');
		  const date = parseDateTimeInput(input);

		  if (!date) {
			await interaction.editReply('Invalid date format. Use: YYYY-MM-DD HH:mm');
			return;
		  }

		  state.registrationStartTime = date.toISOString();

		  saveState(state);
		  await updateSignupMessage(client);

		  await interaction.editReply(
			`Registration start time set to ${formatDateTime(state.registrationStartTime)}.`
		  );
		  return;
		}

		if (interaction.commandName === 'setimage') {
		  const imageUrl = interaction.options.getString('url');

		  if (!isValidHttpUrl(imageUrl)) {
			await interaction.editReply('Invalid image URL. Use a full http:// or https:// link.');
			return;
		  }

		  state.imageUrl = imageUrl;
		  saveState(state);
		  await updateSignupMessage(client);

		  await interaction.editReply('Event image updated.');
		  return;
		}

		if (interaction.commandName === 'setseatcapacity') {
		  const seatKey = interaction.options.getString('seat');
		  const newCapacity = interaction.options.getInteger('number');
		  const unlimited = interaction.options.getBoolean('unlimited') ?? false;

		  const currentUsers = state.seats[seatKey]?.length || 0;

		  if (unlimited) {
			state.capacities[seatKey] = null;
			saveState(state);
			await updateSignupMessage(client);

			const seat = getSeatConfig(seatKey);
			await interaction.editReply(`${seat.label} capacity changed to unlimited.`);
			return;
		  }

		  if (newCapacity === null) {
			await interaction.editReply('Provide either a number or set unlimited:true.');
			return;
		  }

		  if (newCapacity < currentUsers) {
			await interaction.editReply(
			  `Cannot set capacity to ${newCapacity}, because ${currentUsers} user(s) are already in that seat.`
			);
			return;
		  }

		  state.capacities[seatKey] = newCapacity;
		  saveState(state);
		  await updateSignupMessage(client);

		  const seat = getSeatConfig(seatKey);
		  await interaction.editReply(`${seat.label} capacity changed to ${newCapacity}.`);
		  return;
		}

      if (interaction.commandName === 'deleteevent') {
        const confirm = interaction.options.getBoolean('confirm');
        const datetime = interaction.options.getString('datetime');

        if (!confirm) {
          await interaction.editReply(
            'Delete cancelled. You must set confirm:true to delete an event.'
          );
          return;
        }

        let targetDate = null;
        let targetScope = 'current';

        if (datetime) {
          const parsedDate = parseDateTimeInput(datetime);
          if (!parsedDate) {
            await interaction.editReply('Invalid date format. Use: YYYY-MM-DD HH:mm');
            return;
          }

          targetDate = parsedDate;
          if (!eventMatchesMinute(state.eventTime, parsedDate)) {
            targetScope = 'archive';
          }
        } else if (!state.signupMessageId || !state.signupChannelId) {
          const archive = loadArchive();
          const latestArchived = archive[archive.length - 1] || null;

          if (!latestArchived) {
            await interaction.editReply('No current or archived events to delete.');
            return;
          }

          targetDate = new Date(latestArchived.eventTime);
          targetScope = 'archive';
        }

        if (targetScope === 'current') {
          if (!state.signupChannelId || !state.signupMessageId) {
            await interaction.editReply('There is no current event to delete.');
            return;
          }

          await deleteTrackedMessage(
            client,
            state.signupChannelId,
            state.signupMessageId,
            'current event message'
          );

          const previous = popLatestArchive();
          state = previous || resetCurrentState();
          saveState(state);

          await updateSignupMessage(client);

          await interaction.editReply(
            previous
              ? 'Current event deleted and previous event restored.'
              : 'Current event deleted. No archived event remained, so state was reset.'
          );
          return;
        }

        const archivedEvent = takeArchivedEventByDate(targetDate);

        if (!archivedEvent) {
          await interaction.editReply('Archived event not found for that date-time.');
          return;
        }

        await deleteTrackedMessage(
          client,
          archivedEvent.signupChannelId,
          archivedEvent.signupMessageId,
          'archived event message'
        );

        await interaction.editReply(
          `Archived event deleted: ${formatDateTime(archivedEvent.eventTime)}.`
        );
        return;
      }

      if (interaction.commandName === 'resetcapacities') {
        const confirm = interaction.options.getBoolean('confirm');

        if (!confirm) {
          await interaction.editReply(
            'Reset cancelled. You must set confirm:true to reset capacities.'
          );
          return;
        }

        state.capacities = Object.fromEntries(
          SEAT_CONFIG.map(s => [s.key, s.capacity])
        );

        saveState(state);
        await updateSignupMessage(client);

        await interaction.editReply(
          'All seat capacities were reset to default values.'
        );
        return;
      }

      if (interaction.commandName === 'clearseating') {
        const confirm = interaction.options.getBoolean('confirm');

        if (!confirm) {
          await interaction.editReply(
            'Clear cancelled. You must set confirm:true to clear seating.'
          );
          return;
        }

        state.seats = Object.fromEntries(SEAT_CONFIG.map(s => [s.key, []]));
        saveState(state);
        await updateSignupMessage(client);

        await interaction.editReply('All seats cleared.');
        return;
      }
	  
	if (interaction.commandName === 'removeuser') {
	  const user = interaction.options.getUser('user');
	  const seatKey = interaction.options.getString('seat');

	  if (seatKey) {
		const result = removeUserFromSeat(user.id, seatKey);

		if (!result.ok) {
		  await interaction.editReply(result.message);
		  return;
		}

		await updateSignupMessage(client);

		const seat = getSeatConfig(seatKey);
		await interaction.editReply(`Removed ${user.tag} from ${seat.label}.`);
		return;
	  }

	  const result = removeUserFromEverySeat(user.id);

	  if (!result.ok) {
		await interaction.editReply(result.message);
		return;
	  }

	  await updateSignupMessage(client);

	  await interaction.editReply(
		`Removed ${user.tag} from all seats: ${result.removedFrom.join(', ')}.`
	  );
	  return;
	}

      await interaction.editReply('Unknown command.');
      return;
    }

    if (interaction.isStringSelectMenu()) {
      if (interaction.customId !== 'rsvp_select') return;

      const seatKey = interaction.values[0];
      const result = addUserToSeat(interaction.user.id, seatKey);

      if (!result.ok) {
        await interaction.reply({
          content: result.error,
          flags: MessageFlags.Ephemeral,
        });
        return;
      }

      await interaction.update({
        embeds: [buildEmbed(client)],
        components: buildComponents(),
      });
      return;
    }

    if (interaction.isButton()) {
      if (interaction.customId === 'rsvp_leave') {
        const result = leaveSeats(interaction.user.id);

        await interaction.update({
          embeds: [buildEmbed(client)],
          components: buildComponents(),
        });
        return;
      }

      if (interaction.customId === 'rsvp_refresh') {
        await interaction.update({
          embeds: [buildEmbed(client)],
          components: buildComponents(),
        });
        return;
      }
    }
  } catch (err) {
    console.error('Interaction error:', err);

    try {
      if (interaction.isRepliable()) {
        if (interaction.deferred) {
          await interaction.editReply('Something went wrong.');
        } else if (!interaction.replied) {
          await interaction.reply({
            content: 'Something went wrong.',
            flags: MessageFlags.Ephemeral,
          });
        }
      }
    } catch (replyErr) {
      console.error('Failed to send error response:', replyErr);
    }
  }
});

// ---------- Start ----------

(async () => {
  await registerCommands();
  await client.login(TOKEN);
})();
