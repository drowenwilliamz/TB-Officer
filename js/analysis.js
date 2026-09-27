export const DEFAULT_SETTINGS = Object.freeze({
  minAnalysisPhase: 2,
  minDeploymentAssessmentPhase: 3,
  platoonThreshold: 5,
  combatWaveTargetPerPhase: 8,
  weights: { points: 0.45, waves: 0.45, platoons: 0.10 },
  rawPointScale: 1e6,
  rawPlatoonScale: 0,
  expectedScale: 0.95,
  aboveExpectedRatio: 1.05,
  belowExpectedRatio: 0.90,
  performanceHistoryWindow: 5,
  performanceConcernWindow: 5,
  performanceConcernThreshold: 3,
  performanceWatchWindow: 3,
  performanceWatchThreshold: 2,
  performanceTailOffDrop: 0.20,
});

const RISK_ORDER = { Red: 0, Amber: 1, Green: 2 };
const STATUS_ORDER = { Concern: 0, Watch: 1, Stable: 2 };

export function detectPhases(rows) {
  if (!rows.length) return [];
  const phases = Object.keys(rows[0]).flatMap((name) => {
    const match = name.match(/^P(\d+) Territory Points$/);
    return match ? [Number(match[1])] : [];
  });
  return [...new Set(phases)].sort((a, b) => a - b);
}

export function analyseTerritoryBattle(tbRows, rosterRows, selectedPhases, overrides = {}) {
  if (!tbRows.length) throw new Error('The TB activity CSV has no player rows.');
  if (!rosterRows.length) throw new Error('The guild roster CSV has no unit rows.');
  const settings = mergeSettings(DEFAULT_SETTINGS, overrides);
  const detectedPhases = detectPhases(tbRows);
  if (!detectedPhases.length) throw new Error('No phase columns were found. Expected headings such as "P2 Territory Points".');

  const analysisPhases = [...new Set(selectedPhases.map(Number))]
    .filter((phase) => detectedPhases.includes(phase) && phase >= settings.minAnalysisPhase)
    .sort((a, b) => a - b);
  if (!analysisPhases.length) throw new Error('Select at least one detected phase from P2 onwards.');

  requireColumns(tbRows[0], ['Name', 'Combat Waves', 'Platoon Units'], 'TB activity CSV');
  for (const phase of detectedPhases) {
    requireColumns(tbRows[0], [`P${phase} Deployed`, `P${phase} Territory Points`], 'TB activity CSV');
  }
  requireColumns(rosterRows[0], ['Name', 'Power'], 'guild roster CSV');

  const deploymentPhases = analysisPhases.filter((phase) => phase >= settings.minDeploymentAssessmentPhase);
  const powerByPlayer = aggregateRosterPower(rosterRows);
  const phaseActivity = buildPhaseActivity(tbRows, analysisPhases);
  const hasAllDeployGp = analysisPhases.every((phase) => Object.hasOwn(tbRows[0], `P${phase} Deployed GP`));

  const players = tbRows.map((row, index) => {
    const name = String(row.Name ?? '').trim() || `Unknown player ${index + 1}`;
    const territoryPoints = sum(analysisPhases.map((phase) => number(row[`P${phase} Territory Points`])));
    const combatWaves = sum(analysisPhases.map((phase) => phaseActivity.values.get(phase)[index]));
    const platoonUnits = number(row['Platoon Units']);
    const rogueActions = number(row['Rogue Actions']);
    const missedDeployments = sum(deploymentPhases.map((phase) => isNo(row[`P${phase} Deployed`]) ? 1 : 0));
    const totalPower = powerByPlayer.get(name) ?? 0;
    const totalDeployedGP = hasAllDeployGp
      ? sum(analysisPhases.map((phase) => number(row[`P${phase} Deployed GP`])))
      : null;
    return {
      Name: name,
      TotalPower: totalPower,
      TotalTerritoryPoints: territoryPoints,
      TotalCombatWaves: combatWaves,
      PlatoonUnits: platoonUnits,
      RogueActions: rogueActions,
      MissedDeployments: missedDeployments,
      SuccessfulDeployments: deploymentPhases.length - missedDeployments,
      TotalDeployedGP: totalDeployedGP,
      DeployGPShare: hasAllDeployGp && totalPower > 0 ? totalDeployedGP / (totalPower * analysisPhases.length) : null,
    };
  });

  const maxPoints = max(players.map((player) => player.TotalTerritoryPoints));
  const maxWaves = max(players.map((player) => player.TotalCombatWaves));
  const maxPlatoons = max(players.map((player) => player.PlatoonUnits));
  for (const player of players) {
    player.PointScore = maxPoints > 0 ? player.TotalTerritoryPoints / maxPoints : 0;
    player.WaveScore = maxWaves > 0 ? player.TotalCombatWaves / maxWaves : 0;
    player.PlatoonScore = maxPlatoons > 0 ? player.PlatoonUnits / maxPlatoons : 0;
    player.ContributionScore =
      settings.weights.points * player.PointScore +
      settings.weights.waves * player.WaveScore +
      settings.weights.platoons * player.PlatoonScore;
    player.RawContributionScore =
      player.TotalTerritoryPoints / settings.rawPointScale +
      player.TotalCombatWaves +
      settings.rawPlatoonScale * player.PlatoonUnits;
    player.PowerEfficiency = player.TotalPower > 0
      ? 1e6 * player.RawContributionScore / player.TotalPower
      : 0;
  }

  const trend = linearRegression(
    players.filter((player) => player.TotalPower > 0 && Number.isFinite(player.RawContributionScore))
      .map((player) => ({ x: player.TotalPower / 1e6, y: player.RawContributionScore })),
  );
  const fallbackExpected = mean(players.map((player) => player.RawContributionScore));
  const waveThreshold = settings.combatWaveTargetPerPhase * analysisPhases.length;

  for (const player of players) {
    const predicted = trend
      ? (trend.slope * (player.TotalPower / 1e6) + trend.intercept) * settings.expectedScale
      : fallbackExpected;
    player.ExpectedContribution = Math.max(predicted, Number.EPSILON);
    player.ContributionResidual = player.RawContributionScore - player.ExpectedContribution;
    player.ExpectedRatio = player.RawContributionScore / player.ExpectedContribution;
    player.Flag_MissedDeployment = player.MissedDeployments > 0;
    player.Flag_LowWaves = player.TotalCombatWaves < waveThreshold;
    player.Flag_LowPlatoons = player.PlatoonUnits < settings.platoonThreshold;
    player.Flag_AboveExpected = player.ExpectedRatio >= settings.aboveExpectedRatio;
    player.Flag_BelowExpected = player.ExpectedRatio < settings.belowExpectedRatio;
    player.Flag_CloseExpected = !player.Flag_AboveExpected && !player.Flag_BelowExpected;
    assignRisk(player);
  }

  const phaseSummary = analysisPhases.map((phase) => {
    const points = sum(tbRows.map((row) => number(row[`P${phase} Territory Points`])));
    const waves = sum(phaseActivity.values.get(phase));
    const deployValues = tbRows.map((row) => row[`P${phase} Deployed`]);
    return {
      Phase: phase,
      Points: points,
      PointsMillions: points / 1e6,
      Waves: waves,
      AvgWavesPerPlayer: waves / Math.max(1, tbRows.length),
      DeployedPlayers: deployValues.filter(isYes).length,
      MissedDeployments: deploymentPhases.includes(phase) ? deployValues.filter(isNo).length : 0,
      TotalDeployedGP: sum(tbRows.map((row) => number(row[`P${phase} Deployed GP`]))),
      ActivitySource: phaseActivity.sources.get(phase),
    };
  });

  const playerSummary = [...players].sort(compareRiskPlayers);
  const topContributors = [...players].sort((a, b) => b.ContributionScore - a.ContributionScore).slice(0, 10);
  const bottomContributors = [...players].sort((a, b) => a.ContributionScore - b.ContributionScore).slice(0, 10);
  const topEfficiency = [...players].sort((a, b) => b.PowerEfficiency - a.PowerEfficiency).slice(0, 10);
  const followUpList = players
    .filter((player) => player.FollowUpPriority > 0)
    .sort((a, b) => b.FollowUpPriority - a.FollowUpPriority || a.ExpectedRatio - b.ExpectedRatio);

  return {
    settings,
    detectedPhases,
    analysisPhases,
    deploymentPhases,
    waveThreshold,
    waveSource: `phase activity: ${analysisPhases.map((phase) => phaseActivity.sources.get(phase)).join('; ')}`,
    players,
    playerSummary,
    topContributors,
    bottomContributors,
    topEfficiency,
    followUpList,
    phaseSummary,
    riskCounts: {
      Green: players.filter((player) => player.RiskGroup === 'Green').length,
      Amber: players.filter((player) => player.RiskGroup === 'Amber').length,
      Red: players.filter((player) => player.RiskGroup === 'Red').length,
    },
    canLogCompletedRun: [2, 3, 4, 5, 6].every((phase) => analysisPhases.includes(phase)),
  };
}

export function makeSnapshot(result, generatedAt = new Date()) {
  const SnapshotId = buildSnapshotId(result);
  const GeneratedAt = formatDateTime(generatedAt);
  const AnalysisPhases = `[${result.analysisPhases.join(' ')}]`;
  const DetectedPhases = `[${result.detectedPhases.join(' ')}]`;
  return result.players.map((player) => ({
    SnapshotId,
    GeneratedAt,
    AnalysisPhases,
    DetectedPhases,
    Name: player.Name,
    RiskGroup: player.RiskGroup,
    RiskReason: player.RiskReason,
    FollowUpPriority: player.FollowUpPriority,
    TotalPower: player.TotalPower,
    TotalTerritoryPoints: player.TotalTerritoryPoints,
    TotalCombatWaves: player.TotalCombatWaves,
    PlatoonUnits: player.PlatoonUnits,
    RogueActions: player.RogueActions,
    MissedDeployments: player.MissedDeployments,
    SuccessfulDeployments: player.SuccessfulDeployments,
    ContributionScore: player.ContributionScore,
    ExpectedRatio: player.ExpectedRatio,
    PowerEfficiency: player.PowerEfficiency,
    PresentInRun: true,
  }));
}

export function mergeSnapshot(history, snapshot) {
  if (!snapshot.length) return history;
  const snapshotId = snapshot[0].SnapshotId;
  return [...history.filter((row) => String(row.SnapshotId) !== snapshotId), ...snapshot];
}

export function normaliseHistory(rows) {
  const numeric = new Set([
    'FollowUpPriority', 'TotalPower', 'TotalTerritoryPoints', 'TotalCombatWaves',
    'PlatoonUnits', 'RogueActions', 'MissedDeployments', 'SuccessfulDeployments',
    'ContributionScore', 'ExpectedRatio', 'PowerEfficiency',
  ]);
  return rows
    .filter((row) => row.SnapshotId && row.Name)
    .map((row) => Object.fromEntries(Object.entries(row).map(([key, value]) => [key, numeric.has(key) ? number(value) : value])));
}

export function buildPerformanceInsights(history, settings = DEFAULT_SETTINGS) {
  if (!history.length) return emptyInsights();
  const snapshotIds = unique(history.map((row) => String(row.SnapshotId)));
  const currentSnapshotId = snapshotIds.at(-1);
  const currentRows = history
    .filter((row) => String(row.SnapshotId) === currentSnapshotId)
    .sort((a, b) => number(b.ContributionScore) - number(a.ContributionScore));
  const historyIds = tail(snapshotIds, settings.performanceHistoryWindow);
  const watchIds = tail(snapshotIds, settings.performanceWatchWindow);
  const concernIds = tail(snapshotIds, settings.performanceConcernWindow);

  const watchlist = currentRows.map((current) => {
    const playerRows = history.filter((row) => String(row.Name) === String(current.Name));
    const recentRows = playerRows.filter((row) => historyIds.includes(String(row.SnapshotId)));
    const watchRows = playerRows.filter((row) => watchIds.includes(String(row.SnapshotId)));
    const concernRows = playerRows.filter((row) => concernIds.includes(String(row.SnapshotId)));
    const watchFlags = watchRows.filter((row) => row.RiskGroup !== 'Green').length;
    const concernFlags = concernRows.filter((row) => row.RiskGroup !== 'Green').length;
    const lowWaveFlags = concernRows.filter((row) => String(row.RiskReason).toLowerCase().includes('low waves')).length;
    const missedDeployFlags = concernRows.filter((row) => number(row.MissedDeployments) > 0).length;
    const priorRows = recentRows.filter((row) => String(row.SnapshotId) !== currentSnapshotId);
    const previousAvg = priorRows.length ? mean(priorRows.map((row) => number(row.ContributionScore))) : null;
    const currentScore = number(current.ContributionScore);
    const scoreChangePct = previousAvg > 0 ? (currentScore - previousAvg) / previousAvg : null;
    let { status, reason } = classifyPattern(watchFlags, concernFlags, lowWaveFlags, missedDeployFlags, scoreChangePct, settings);
    if (snapshotIds.length === 1 && current.RiskGroup !== 'Green') {
      status = 'Watch';
      reason = `current baseline: ${current.RiskReason}`;
    }
    return {
      Name: current.Name,
      Status: status,
      PatternReason: reason,
      RecentRuns: recentRows.length,
      WatchFlags: watchFlags,
      ConcernFlags: concernFlags,
      LowWaveFlags: lowWaveFlags,
      MissedDeployFlags: missedDeployFlags,
      CurrentRisk: current.RiskGroup,
      CurrentReason: current.RiskReason,
      CurrentScore: currentScore,
      RecentAvgScore: mean(recentRows.map((row) => number(row.ContributionScore))),
      PreviousAvgScore: previousAvg,
      ScoreChangePct: scoreChangePct,
      CurrentExpectedRatio: number(current.ExpectedRatio),
      CurrentWaves: number(current.TotalCombatWaves),
      CurrentMissed: number(current.MissedDeployments),
    };
  }).filter((row) => row.Status !== 'Stable')
    .sort((a, b) => STATUS_ORDER[a.Status] - STATUS_ORDER[b.Status]
      || b.ConcernFlags - a.ConcernFlags
      || b.WatchFlags - a.WatchFlags
      || number(a.ScoreChangePct) - number(b.ScoreChangePct));

  const reliable = currentRows.filter((current) => {
    const rows = history.filter((row) => String(row.Name) === String(current.Name) && concernIds.includes(String(row.SnapshotId)));
    return rows.length && rows.every((row) => row.RiskGroup === 'Green' && number(row.MissedDeployments) === 0);
  }).slice(0, 12);

  return { snapshotIds, currentSnapshotId, currentRows, historyIds, watchlist, reliable, hasHistory: snapshotIds.length > 1 };
}

function buildPhaseActivity(rows, phases) {
  const values = new Map();
  const sources = new Map();
  for (const phase of phases) {
    const wavesColumn = `P${phase} Waves`;
    const combatColumn = `P${phase} Combat Attempts`;
    const specialColumn = `P${phase} Special Attempts`;
    const hasWavesColumn = Object.hasOwn(rows[0], wavesColumn);
    const waveValues = hasWavesColumn ? rows.map((row) => nullableNumber(row[wavesColumn])) : [];
    const attemptValues = rows.map((row) => number(row[combatColumn]) + number(row[specialColumn]));
    const hasWaveData = waveValues.some((value) => Number.isFinite(value) && value > 0);
    const hasAttemptData = attemptValues.some((value) => value > 0);
    if (hasWaveData) {
      values.set(phase, rows.map((row) => number(row[wavesColumn])));
      sources.set(phase, `P${phase} Waves`);
    } else if (hasAttemptData) {
      values.set(phase, attemptValues);
      sources.set(phase, `P${phase} combat+special attempts fallback`);
    } else if (hasWavesColumn) {
      values.set(phase, rows.map((row) => number(row[wavesColumn])));
      sources.set(phase, `P${phase} Waves`);
    } else {
      values.set(phase, rows.map(() => 0));
      sources.set(phase, `P${phase} no activity column`);
    }
  }
  return { values, sources };
}

function assignRisk(player) {
  const redReasons = [];
  let priority = 0;
  if (player.Flag_MissedDeployment) {
    redReasons.push('missed deploy');
    priority += 3;
  }
  if (player.Flag_LowWaves) {
    redReasons.push('low waves');
    priority += 2;
  }
  if (player.Flag_LowPlatoons) {
    redReasons.push('low platoons');
    priority += 1;
  }
  if (redReasons.length) {
    player.RiskGroup = 'Red';
    player.RiskReason = redReasons.join(', ');
  } else if (player.Flag_BelowExpected) {
    player.RiskGroup = 'Amber';
    player.RiskReason = 'acceptable activity, below expected GP';
    priority += 1;
  } else {
    player.RiskGroup = 'Green';
    player.RiskReason = player.Flag_AboveExpected ? 'solid contributor, above expected GP' : 'solid contributor';
  }
  player.FollowUpPriority = priority;
}

function classifyPattern(watchFlags, concernFlags, lowWaveFlags, missedFlags, scoreChangePct, settings) {
  const reasons = [];
  let status = 'Stable';
  if (concernFlags >= settings.performanceConcernThreshold) {
    status = 'Concern';
    reasons.push(`non-green in ${concernFlags} recent TBs`);
  }
  if (lowWaveFlags >= settings.performanceConcernThreshold) {
    status = 'Concern';
    reasons.push(`low waves in ${lowWaveFlags} recent TBs`);
  }
  if (missedFlags >= 2) {
    status = 'Concern';
    reasons.push(`missed deploys in ${missedFlags} recent TBs`);
  }
  if (watchFlags >= settings.performanceWatchThreshold && status !== 'Concern') {
    status = 'Watch';
    reasons.push(`non-green in ${watchFlags} of last ${settings.performanceWatchWindow} TBs`);
  }
  if (Number.isFinite(scoreChangePct) && scoreChangePct <= -settings.performanceTailOffDrop) {
    if (status !== 'Concern') status = 'Watch';
    reasons.push(`score down ${Math.round(Math.abs(scoreChangePct) * 100)}% vs recent average`);
  }
  return { status, reason: reasons.join(', ') };
}

function aggregateRosterPower(rows) {
  const totals = new Map();
  for (const row of rows) {
    const name = String(row.Name ?? '').trim();
    if (!name) continue;
    totals.set(name, (totals.get(name) ?? 0) + number(row.Power));
  }
  return totals;
}

function buildSnapshotId(result) {
  const phaseToken = result.analysisPhases.join('_');
  const points = Math.round(sum(result.players.map((player) => player.TotalTerritoryPoints)));
  const waves = Math.round(sum(result.players.map((player) => player.TotalCombatWaves)));
  const missed = Math.round(sum(result.players.map((player) => player.MissedDeployments)));
  return `P${phaseToken}_${points}pts_${waves}waves_${missed}missed`;
}

function compareRiskPlayers(a, b) {
  return RISK_ORDER[a.RiskGroup] - RISK_ORDER[b.RiskGroup]
    || b.FollowUpPriority - a.FollowUpPriority
    || a.ContributionScore - b.ContributionScore;
}

function linearRegression(points) {
  if (points.length < 2) return null;
  const xMean = mean(points.map((point) => point.x));
  const yMean = mean(points.map((point) => point.y));
  const denominator = sum(points.map((point) => (point.x - xMean) ** 2));
  if (denominator === 0) return null;
  const slope = sum(points.map((point) => (point.x - xMean) * (point.y - yMean))) / denominator;
  return { slope, intercept: yMean - slope * xMean };
}

function requireColumns(record, columns, source) {
  const missing = columns.filter((column) => !Object.hasOwn(record, column));
  if (missing.length) throw new Error(`${source} is missing: ${missing.join(', ')}`);
}

function mergeSettings(defaults, overrides) {
  return { ...defaults, ...overrides, weights: { ...defaults.weights, ...(overrides.weights ?? {}) } };
}

function emptyInsights() {
  return { snapshotIds: [], currentSnapshotId: '', currentRows: [], historyIds: [], watchlist: [], reliable: [], hasHistory: false };
}

function formatDateTime(date) {
  const pad = (value) => String(value).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
}

function unique(values) { return [...new Set(values)]; }
function tail(values, count) { return values.slice(Math.max(0, values.length - count)); }
function max(values) { return values.length ? Math.max(...values) : 0; }
function sum(values) { return values.reduce((total, value) => total + number(value), 0); }
function mean(values) { return values.length ? sum(values) / values.length : 0; }
function isYes(value) { return String(value ?? '').trim().toLowerCase() === 'yes'; }
function isNo(value) { return String(value ?? '').trim().toLowerCase() === 'no'; }
function nullableNumber(value) {
  if (value == null || String(value).trim() === '') return Number.NaN;
  const parsed = Number(String(value).replaceAll(',', '').trim());
  return Number.isFinite(parsed) ? parsed : Number.NaN;
}
function number(value) {
  const parsed = nullableNumber(value);
  return Number.isFinite(parsed) ? parsed : 0;
}
