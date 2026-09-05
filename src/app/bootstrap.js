'use strict';

const { initializeStorage, FILES, readJson, updateJson } = require('../storage');
const { createEventDefault } = require('../storage/defaults');
const { TOURNAMENT_FORMAT_SIZES } = require('./constants');
const { validateAllStorage } = require('../validation');
const { repairTeamRuntimeData } = require('../domain/teams/team-runtime-repair');

function repairPersistedSaturdayBeforeValidation(now = new Date()) {
  const bomberDate = '2026-09-19';
  const switchAt = new Date(`${bomberDate}T07:00:00+02:00`);
  if (now.getTime() >= switchAt.getTime()) return false;

  const current = readJson(FILES.events.saturday, createEventDefault('saturday'));
  const allowedSizes = [...TOURNAMENT_FORMAT_SIZES];
  const hasBomberFormat = Number(current.format?.minimumRealTeams) === 6
    || JSON.stringify(current.format?.allowedSizes || []) !== JSON.stringify(allowedSizes)
    || current.meta?.eventMode === 'bomber_x_loco'
    || String(current.cycle?.eventDate || '') === bomberDate;

  if (!hasBomberFormat) return false;

  updateJson(FILES.events.saturday, createEventDefault('saturday'), event => {
    event.format = {
      ...(event.format || {}),
      minimumRealTeams: 8,
      allowedSizes,
    };

    // Vor dem Bomber-Wochenende darf der persistierte Saturday-State nicht auf
    // den 19.09. gepinnt bleiben. Die normalen Samstage 05.09. und 12.09. müssen
    // weiter über den normalen Wochenzyklus laufen. Nur Sonder-Metadaten werden
    // zurückgesetzt; echte laufende Turnierdaten werden nicht künstlich gelöscht.
    if (event.meta?.eventMode === 'bomber_x_loco') {
      event.meta = { ...(event.meta || {}), eventMode: 'night_cup', updatedAt: now.toISOString() };
    }
    if (String(event.cycle?.eventDate || '') === bomberDate) {
      event.cycle = { ...(event.cycle || {}), cycleKey: null, eventDate: null };
      event.schedule = {
        ...(event.schedule || {}),
        deadlineAt: null,
        lateWindowUntil: null,
        drawAt: null,
        tournamentStartAt: null,
        resetAt: null,
      };
    }
    return event;
  });

  console.log('[bootstrap] Persistierter Saturday-State vor Validierung auf normalen Night-Cup repariert');
  return true;
}

function bootstrapPhaseOne() {
  initializeStorage();
  repairPersistedSaturdayBeforeValidation();
  repairTeamRuntimeData();
  validateAllStorage();

  return {
    ok: true,
    phase: 'phase-1-storage-foundation',
  };
}

module.exports = {
  bootstrapPhaseOne,
};
