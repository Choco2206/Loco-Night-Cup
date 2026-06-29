'use strict';

const CHAMPION_ROLE_LEVELS = [
  { key: 'champion', threshold: 1, name: '🥇 Loco Night Champion', color: 0xf1c40f },
  { key: 'elite', threshold: 3, name: '🏆 Loco Night Elite', color: 0xe67e22 },
  { key: 'master', threshold: 5, name: '👑 Loco Night Master', color: 0x992d22 },
  { key: 'legend', threshold: 10, name: '💎 Loco Night Legend', color: 0x9b59b6 },
  { key: 'immortal', threshold: 25, name: '🌟 Loco Night Immortal', color: 0xecf0f1 },
];

function getChampionLevelForGold(goldCount) {
  const count = Number.isInteger(goldCount) ? goldCount : 0;
  return [...CHAMPION_ROLE_LEVELS].reverse().find(level => count >= level.threshold) || null;
}

function getChampionPromotion(previousGold, nextGold) {
  const previousLevel = getChampionLevelForGold(previousGold);
  const nextLevel = getChampionLevelForGold(nextGold);
  if (!nextLevel) return null;
  if (previousLevel?.key === nextLevel.key) return null;
  return {
    previousGold,
    nextGold,
    previousLevelKey: previousLevel?.key || null,
    levelKey: nextLevel.key,
    threshold: nextLevel.threshold,
    name: nextLevel.name,
  };
}

module.exports = {
  CHAMPION_ROLE_LEVELS,
  getChampionLevelForGold,
  getChampionPromotion,
};
