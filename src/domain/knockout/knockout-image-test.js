'use strict';

const { EmbedBuilder } = require('discord.js');
const { listVisibleTeams } = require('../teams/team-service');
const { HALL_OF_FAME_TEST_CHANNEL_ID } = require('../ceremony/ceremony-test-service');
const { renderKoImage } = require('../../../utils/ko-image-renderer');

const TEST_VARIANTS = Object.freeze({
  qualification_4: { phase: 'qualification_overview', teams: 4, label: 'K.O.-Uebersicht 4 Teams' },
  qualification_8: { phase: 'qualification_overview', teams: 8, label: 'K.O.-Uebersicht 8 Teams' },
  qualification_16: { phase: 'qualification_overview', teams: 16, label: 'K.O.-Uebersicht 16 Teams' },
  round_of_16: { phase: 'round_of_16', matches: 8, label: 'Achtelfinale' },
  quarter_final: { phase: 'quarter_final', matches: 4, label: 'Viertelfinale' },
  semi_final: { phase: 'semi_final', matches: 2, label: 'Halbfinale' },
  third_place: { phase: 'third_place', matches: 1, label: 'Platz 3' },
  final: { phase: 'final', matches: 1, label: 'Finale' },
});

function testParticipants(count) {
  const real = listVisibleTeams()
    .filter(team => team.status === 'active' && team.registrationStatus === 'complete')
    .map(team => ({ type: 'team', teamId: String(team.id), displayName: team.clubName, participantKey: `team:${team.id}` }));
  const fallback = [
    { type: 'team', teamId: 'ko_image_test_missing_logo', displayName: 'Ein Sehr Langer Testteamname Ohne Logo', participantKey: 'team:ko_image_test_missing_logo' },
    { type: 'team', teamId: 'ko_image_test_short', displayName: 'FC Test', participantKey: 'team:ko_image_test_short' },
  ];
  const pool = [...real.slice(0, Math.max(0, count - 2)), ...fallback];
  while (pool.length < count) pool.push({ ...fallback[pool.length % fallback.length], participantKey: `team:test-${pool.length}` });
  return pool.slice(0, count);
}

function testMatches(count) {
  const participants = testParticipants(count * 2);
  return Array.from({ length: count }, (_, index) => ({
    id: `ko_image_test_${index + 1}`,
    matchIndex: index + 1,
    home: participants[index * 2],
    away: participants[index * 2 + 1],
    status: index % 3 === 0 ? 'open' : 'confirmed',
    result: index % 3 === 0 ? null : { homeGoals: index + 1, awayGoals: index % 2, source: 'test' },
  }));
}

async function postKoImageTest({ guild, variantKey }) {
  const variant = TEST_VARIANTS[variantKey];
  if (!variant) throw new Error('Unbekannter K.O.-Bildtest.');
  const qualifiedTeams = variant.teams ? testParticipants(variant.teams) : [];
  const matches = variant.matches ? testMatches(variant.matches) : [];
  const image = await renderKoImage({
    phase: variant.phase,
    qualifiedTeams,
    matches,
    eventId: `test-${variantKey}`,
  });
  const channel = await guild.channels.fetch(HALL_OF_FAME_TEST_CHANNEL_ID).catch(() => null);
  if (!channel?.isTextBased?.()) throw new Error(`Testkanal nicht gefunden: ${HALL_OF_FAME_TEST_CHANNEL_ID}`);
  const message = await channel.send({
    embeds: [new EmbedBuilder().setTitle(`K.O.-Bildtest: ${variant.label}`).setImage(`attachment://${image.fileName}`)],
    files: [{ attachment: image.buffer, name: image.fileName }],
    allowedMentions: { parse: [] },
  });
  return { channelId: channel.id, messageId: message.id, label: variant.label };
}

module.exports = { TEST_VARIANTS, postKoImageTest };
