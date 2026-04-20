import crypto from 'crypto';
import axios from 'axios';

const SCOREBOARD_BASE = 'https://site.api.espn.com/apis/site/v2/sports/soccer';
const STANDINGS_BASE = 'https://site.api.espn.com/apis/v2/sports/soccer';
const USER_AGENT = 'DottMedia-BwinPredictionEngine/1.0';

export const BWIN_PREDICTION_LEAGUES = [
  { id: 'eng.1', label: 'Premier League', priority: 1 },
  { id: 'esp.1', label: 'La Liga', priority: 2 },
  { id: 'ita.1', label: 'Serie A', priority: 3 },
  { id: 'ger.1', label: 'Bundesliga', priority: 4 },
  { id: 'fra.1', label: 'Ligue 1', priority: 5 },
  { id: 'uefa.champions', label: 'UEFA Champions League', priority: 0 },
  { id: 'fifa.world', label: 'FIFA World Cup', priority: 0 },
];

const DEFAULT_TEAM_COUNT = 20;

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

const toDateKey = value => {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return '';
  return parsed.toISOString().slice(0, 10).replace(/-/g, '');
};

const addDays = (value, days) => {
  const date = new Date(value);
  date.setUTCDate(date.getUTCDate() + days);
  return date;
};

const clamp = (value, min, max) => Math.max(min, Math.min(max, value));

const round2 = value => Math.round(value * 100) / 100;

const normalizeName = value =>
  String(value || '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();

const formatKickoff = value => {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return '';
  return parsed.toLocaleString('en-GB', {
    weekday: 'short',
    day: '2-digit',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
    timeZone: 'Africa/Kampala',
  });
};

async function fetchScoreboard(leagueId, dateKey) {
  const response = await axios.get(`${SCOREBOARD_BASE}/${leagueId}/scoreboard`, {
    params: { dates: dateKey },
    timeout: 15000,
    headers: { 'User-Agent': USER_AGENT },
  });
  return response.data || {};
}

async function fetchStandings(leagueId) {
  try {
    const response = await axios.get(`${STANDINGS_BASE}/${leagueId}/standings`, {
      timeout: 15000,
      headers: { 'User-Agent': USER_AGENT },
    });
    const entries = Array.isArray(response.data?.children?.[0]?.standings?.entries)
      ? response.data.children[0].standings.entries
      : [];
    const map = new Map();
    entries.forEach((entry, index) => {
      const team = entry?.team || {};
      const stats = Array.isArray(entry?.stats) ? entry.stats : [];
      const pointsStat = stats.find(stat => String(stat?.name || '').toLowerCase() === 'points');
      const goalDiffStat = stats.find(stat => String(stat?.name || '').toLowerCase() === 'pointdifferential');
      const playedStat = stats.find(stat => String(stat?.name || '').toLowerCase() === 'gamesplayed');
      const rank = index + 1;
      const payload = {
        rank,
        points: Number(pointsStat?.value ?? pointsStat?.displayValue ?? 0) || 0,
        goalDiff: Number(goalDiffStat?.value ?? goalDiffStat?.displayValue ?? 0) || 0,
        played: Number(playedStat?.value ?? playedStat?.displayValue ?? 0) || 0,
      };
      [team.displayName, team.name, team.shortDisplayName].forEach(name => {
        const normalized = normalizeName(name);
        if (normalized) map.set(normalized, payload);
      });
    });
    return {
      teamCount: Math.max(entries.length, DEFAULT_TEAM_COUNT),
      entries: map,
    };
  } catch (error) {
    console.warn('[bwin-prediction] standings fetch failed', leagueId, error?.message || error);
    return {
      teamCount: DEFAULT_TEAM_COUNT,
      entries: new Map(),
    };
  }
}

function getCompetitor(competitors, side) {
  return competitors.find(entry => String(entry?.homeAway || '').toLowerCase() === side) || null;
}

function computeMarket(homeTeam, awayTeam, standings) {
  const teamCount = standings.teamCount || DEFAULT_TEAM_COUNT;
  const midpoint = Math.ceil(teamCount / 2);
  const homeStats = standings.entries.get(normalizeName(homeTeam.name)) || standings.entries.get(normalizeName(homeTeam.shortName));
  const awayStats = standings.entries.get(normalizeName(awayTeam.name)) || standings.entries.get(normalizeName(awayTeam.shortName));
  const homeRank = homeStats?.rank || midpoint;
  const awayRank = awayStats?.rank || midpoint;
  const homePoints = homeStats?.points || 0;
  const awayPoints = awayStats?.points || 0;
  const homeGoalDiff = homeStats?.goalDiff || 0;
  const awayGoalDiff = awayStats?.goalDiff || 0;
  const gap = awayRank - homeRank;
  const pointsGap = homePoints - awayPoints;
  const goalGap = homeGoalDiff - awayGoalDiff;
  const edge = gap * 1.4 + pointsGap * 0.18 + goalGap * 0.08 + 2.2;

  let marketType = 'OVER_1_5';
  let marketLabel = 'Over 1.5 Goals';
  let probability = 0.69;
  let confidence = 'Solid';
  let rationale = 'Balanced fixture with enough attacking upside for a goals angle.';

  if (edge >= 16) {
    marketType = 'HOME_WIN';
    marketLabel = 'Home Win';
    probability = clamp(0.68 + (edge - 16) * 0.008, 0.68, 0.84);
    confidence = probability >= 0.76 ? 'High' : 'Solid';
    rationale = `${homeTeam.shortName} carry the stronger table edge plus home advantage.`;
  } else if (edge >= 8) {
    marketType = 'DOUBLE_CHANCE_1X';
    marketLabel = '1X Double Chance';
    probability = clamp(0.74 + (edge - 8) * 0.007, 0.74, 0.88);
    confidence = probability >= 0.82 ? 'High' : 'Solid';
    rationale = `${homeTeam.shortName} look more likely to avoid defeat on home turf.`;
  } else if (edge <= -16) {
    marketType = 'AWAY_WIN';
    marketLabel = 'Away Win';
    probability = clamp(0.65 + (Math.abs(edge) - 16) * 0.008, 0.65, 0.81);
    confidence = probability >= 0.74 ? 'High' : 'Solid';
    rationale = `${awayTeam.shortName} rate clearly stronger even after the away-game adjustment.`;
  } else if (edge <= -8) {
    marketType = 'DOUBLE_CHANCE_X2';
    marketLabel = 'X2 Double Chance';
    probability = clamp(0.73 + (Math.abs(edge) - 8) * 0.007, 0.73, 0.87);
    confidence = probability >= 0.81 ? 'High' : 'Solid';
    rationale = `${awayTeam.shortName} should have enough quality to come away with something.`;
  } else {
    const combinedQuality = clamp((Math.abs(pointsGap) + Math.abs(goalGap)) / 50, 0, 0.08);
    probability = clamp(0.68 + combinedQuality, 0.68, 0.76);
    confidence = probability >= 0.73 ? 'Solid' : 'Lean';
  }

  const estimatedOdds = round2(clamp(1 / probability, 1.18, 4.6)).toFixed(2);
  return {
    marketType,
    marketLabel,
    probability: round2(probability),
    estimatedOdds,
    confidence,
    rationale,
    modelEdge: round2(edge),
    homeRank,
    awayRank,
  };
}

function buildFixtureCandidate(league, event, standings) {
  const competition = Array.isArray(event?.competitions) ? event.competitions[0] : null;
  const competitors = Array.isArray(competition?.competitors) ? competition.competitors : [];
  const home = getCompetitor(competitors, 'home');
  const away = getCompetitor(competitors, 'away');
  if (!home || !away) return null;

  const kickoff = event?.date || competition?.date;
  const kickoffDate = new Date(kickoff);
  if (Number.isNaN(kickoffDate.getTime())) return null;
  const eventId = String(event?.id || '').trim();
  if (!eventId) return null;

  const homeTeam = {
    name: String(home?.team?.displayName || home?.team?.name || 'Home').trim(),
    shortName: String(home?.team?.shortDisplayName || home?.team?.abbreviation || home?.team?.displayName || 'Home').trim(),
  };
  const awayTeam = {
    name: String(away?.team?.displayName || away?.team?.name || 'Away').trim(),
    shortName: String(away?.team?.shortDisplayName || away?.team?.abbreviation || away?.team?.displayName || 'Away').trim(),
  };
  const market = computeMarket(homeTeam, awayTeam, standings);
  const interest =
    (standings.teamCount - market.homeRank) +
    (standings.teamCount - market.awayRank) -
    Math.abs(market.homeRank - market.awayRank) * 0.35 -
    league.priority * 0.5;

  return {
    eventId,
    leagueId: league.id,
    leagueLabel: league.label,
    dateKey: toDateKey(kickoffDate),
    kickoff: kickoffDate.toISOString(),
    kickoffLabel: formatKickoff(kickoffDate),
    fixture: `${homeTeam.name} vs ${awayTeam.name}`,
    homeTeam,
    awayTeam,
    interest: round2(interest),
    ...market,
  };
}

export async function buildPredictionBatch(options = {}) {
  const excludedEventIds = options.excludedEventIds instanceof Set ? options.excludedEventIds : new Set();
  const pickLimit = Math.max(Number(options.pickLimit ?? 5), 3);
  const daysAhead = Math.max(Number(options.daysAhead ?? 2), 1);
  const horizonHours = Math.max(Number(options.horizonHours ?? 36), 6);
  const now = new Date();
  const deadline = new Date(now.getTime() + horizonHours * 60 * 60 * 1000);
  const standingsCache = new Map();
  const candidates = [];

  for (const league of BWIN_PREDICTION_LEAGUES) {
    const standings = await fetchStandings(league.id);
    standingsCache.set(league.id, standings);
    for (let dayOffset = 0; dayOffset < daysAhead; dayOffset += 1) {
      const dateKey = toDateKey(addDays(now, dayOffset));
      try {
        const payload = await fetchScoreboard(league.id, dateKey);
        const events = Array.isArray(payload?.events) ? payload.events : [];
        for (const event of events) {
          const eventId = String(event?.id || '').trim();
          if (!eventId || excludedEventIds.has(eventId)) continue;
          const competition = Array.isArray(event?.competitions) ? event.competitions[0] : null;
          const completed = Boolean(competition?.status?.type?.completed);
          if (completed) continue;
          const kickoff = new Date(event?.date || competition?.date || '');
          if (Number.isNaN(kickoff.getTime())) continue;
          if (kickoff <= now || kickoff > deadline) continue;
          const fixture = buildFixtureCandidate(league, event, standings);
          if (fixture) candidates.push(fixture);
        }
      } catch (error) {
        console.warn('[bwin-prediction] scoreboard fetch failed', league.id, dateKey, error?.message || error);
      }
      await sleep(125);
    }
  }

  const picks = candidates
    .sort((left, right) => {
      const kickoffDiff = new Date(left.kickoff).getTime() - new Date(right.kickoff).getTime();
      if (kickoffDiff !== 0) return kickoffDiff;
      if (right.interest !== left.interest) return right.interest - left.interest;
      return left.leagueLabel.localeCompare(right.leagueLabel);
    })
    .slice(0, pickLimit);

  if (!picks.length) return null;

  const hash = crypto
    .createHash('sha1')
    .update(picks.map(pick => pick.eventId).join('|'))
    .digest('hex')
    .slice(0, 10);
  const marketDate = picks[0].dateKey;

  return {
    batchKey: `${marketDate}-${hash}`,
    generatedAt: now.toISOString(),
    marketDate,
    leagues: Array.from(new Set(picks.map(pick => pick.leagueLabel))),
    picks,
  };
}

async function fetchScoreboardCached(cache, leagueId, dateKey) {
  const key = `${leagueId}:${dateKey}`;
  if (cache.has(key)) return cache.get(key);
  try {
    const payload = await fetchScoreboard(leagueId, dateKey);
    cache.set(key, payload);
    return payload;
  } catch (error) {
    console.warn('[bwin-prediction] cached scoreboard fetch failed', leagueId, dateKey, error?.message || error);
    cache.set(key, null);
    return null;
  }
}

function settleMarket(pick, homeScore, awayScore) {
  switch (pick.marketType) {
    case 'HOME_WIN':
      return homeScore > awayScore ? 'won' : 'lost';
    case 'AWAY_WIN':
      return awayScore > homeScore ? 'won' : 'lost';
    case 'DOUBLE_CHANCE_1X':
      return homeScore >= awayScore ? 'won' : 'lost';
    case 'DOUBLE_CHANCE_X2':
      return awayScore >= homeScore ? 'won' : 'lost';
    case 'OVER_1_5':
      return homeScore + awayScore >= 2 ? 'won' : 'lost';
    default:
      return 'pending';
  }
}

async function resolveEventResult(cache, pick) {
  const dateKeys = [pick.dateKey];
  const parsed = new Date(pick.kickoff);
  if (!Number.isNaN(parsed.getTime())) {
    dateKeys.push(toDateKey(addDays(parsed, -1)));
    dateKeys.push(toDateKey(addDays(parsed, 1)));
  }

  for (const dateKey of Array.from(new Set(dateKeys)).filter(Boolean)) {
    const payload = await fetchScoreboardCached(cache, pick.leagueId, dateKey);
    const events = Array.isArray(payload?.events) ? payload.events : [];
    const event = events.find(entry => String(entry?.id || '') === pick.eventId);
    if (!event) continue;
    const competition = Array.isArray(event?.competitions) ? event.competitions[0] : null;
    const status = competition?.status?.type || {};
    const competitors = Array.isArray(competition?.competitors) ? competition.competitors : [];
    const home = getCompetitor(competitors, 'home');
    const away = getCompetitor(competitors, 'away');
    if (!home || !away) return { status: 'pending' };
    if (!status.completed) return { status: 'pending' };
    const homeScore = Number(home?.score ?? 0) || 0;
    const awayScore = Number(away?.score ?? 0) || 0;
    return {
      status: settleMarket(pick, homeScore, awayScore),
      homeScore,
      awayScore,
      scoreLine: `${homeScore}-${awayScore}`,
      homeName: String(home?.team?.displayName || home?.team?.name || pick.homeTeam?.name || 'Home').trim(),
      awayName: String(away?.team?.displayName || away?.team?.name || pick.awayTeam?.name || 'Away').trim(),
      completedAt: new Date().toISOString(),
    };
  }
  return { status: 'pending' };
}

export async function settlePredictionBatch(batch, options = {}) {
  const picks = Array.isArray(batch?.picks) ? batch.picks : [];
  if (!picks.length) {
    return {
      ready: false,
      batchKey: batch?.batchKey || null,
      winners: [],
    };
  }

  const cache = new Map();
  const settledPicks = [];
  for (const pick of picks) {
    const result = await resolveEventResult(cache, pick);
    settledPicks.push({
      ...pick,
      ...result,
    });
    await sleep(80);
  }

  const won = settledPicks.filter(pick => pick.status === 'won');
  const lost = settledPicks.filter(pick => pick.status === 'lost');
  const pending = settledPicks.filter(pick => pick.status === 'pending');
  const lastKickoff = picks.reduce((latest, pick) => {
    const kickoff = new Date(pick.kickoff).getTime();
    return Number.isFinite(kickoff) && kickoff > latest ? kickoff : latest;
  }, 0);
  const graceHours = Math.max(Number(options.graceHours ?? 18), 3);
  const deadlinePassed = lastKickoff > 0 ? Date.now() >= lastKickoff + graceHours * 60 * 60 * 1000 : false;
  const ready = pending.length === 0 || deadlinePassed;
  const totalCount = picks.length;
  const resolvedCount = won.length + lost.length;

  return {
    batchKey: batch.batchKey,
    generatedAt: batch.generatedAt,
    marketDate: batch.marketDate,
    totalCount,
    resolvedCount,
    wonCount: won.length,
    lostCount: lost.length,
    pendingCount: pending.length,
    allWon: won.length === totalCount && totalCount > 0,
    ready,
    winners: won,
    settledPicks,
  };
}
