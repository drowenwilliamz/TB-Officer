import { drawContribution, drawMomentum, drawQuadrant, setupExpandableCharts } from './charts.js';

const elements = Object.fromEntries([...document.querySelectorAll('[id]')].map((node) => [node.id, node]));
let result = null;
let sort = { key: 'RiskGroup', direction: 1 };

elements.printButton.addEventListener('click', () => window.print());
elements.playerSearch.addEventListener('input', renderPlayers);
elements.riskFilter.addEventListener('change', renderPlayers);

document.querySelectorAll('.tabs button').forEach((button) => {
  button.addEventListener('click', () => {
    document.querySelectorAll('.tabs button').forEach((item) => item.classList.toggle('active', item === button));
    document.querySelectorAll('.tab-panel').forEach((panel) => panel.classList.toggle('active', panel.dataset.panel === button.dataset.tab));
  });
});

let resizeTimer;
window.addEventListener('resize', () => {
  clearTimeout(resizeTimer);
  resizeTimer = setTimeout(renderCharts, 100);
});

loadReport();
setupExpandableCharts(() => result);

async function loadReport() {
  try {
    const response = await fetch(`report-data.json?ts=${Date.now()}`, { cache: 'no-store' });
    if (!response.ok) throw new Error(`Report data returned ${response.status}.`);
    const payload = await response.json();
    if (!payload.report?.players?.length) throw new Error('Report data is empty.');
    result = payload.report;
    elements.publishedAt.textContent = `Updated ${formatDate(payload.publishedAt)}`;
    elements.publicHeaderCopy.textContent = `${payload.guildName ?? 'Guild'} performance for ${formatPhases(result.analysisPhases)}.`;
    renderReport();
  } catch (error) {
    elements.publishedAt.textContent = 'Report unavailable';
    elements.publicError.hidden = false;
    elements.publicError.querySelector('p').textContent = `The latest report could not be loaded. ${error.message}`;
  }
}

function renderReport() {
  const totals = {
    points: sum(result.players.map((player) => player.TotalTerritoryPoints)),
    waves: sum(result.players.map((player) => player.TotalCombatWaves)),
    missed: sum(result.players.map((player) => player.MissedDeployments)),
    rogue: sum(result.players.map((player) => player.RogueActions)),
  };
  elements.reportMeta.textContent = `Analysed ${formatPhases(result.analysisPhases)} from detected ${formatPhases(result.detectedPhases)}. ${result.waveSource}.`;
  elements.metricCards.innerHTML = [
    metric('Players', result.players.length, 'analysed'),
    metric('Points', `${(totals.points / 1e6).toFixed(1)}M`, 'selected phases'),
    metric('Waves', totals.waves.toLocaleString(), `target ${result.waveThreshold} per player`),
    metric('Missed deploys', totals.missed, 'P3 onwards'),
    metric('Rogue actions', totals.rogue, 'information only'),
    metric('Top score', result.topContributors[0]?.Name ?? '-', 'current lead'),
  ].join('');
  elements.riskBand.innerHTML = ['Green', 'Amber', 'Red'].map((risk) =>
    `<div class="risk-summary ${risk.toLowerCase()}"><strong>${result.riskCounts[risk]}</strong><span>${risk}</span></div>`).join('');
  elements.watchlistTable.innerHTML = makeTable(result.followUpList.slice(0, 16), [
    ['Name', 'Name'], ['Status', 'RiskGroup', formatStatus], ['Reason', 'RiskReason'],
    ['Priority', 'FollowUpPriority'], ['Missed', 'MissedDeployments'], ['Waves', 'TotalCombatWaves'],
    ['Platoons', 'PlatoonUnits'], ['Expected', 'ExpectedRatio', ratio],
  ]);
  elements.topTable.innerHTML = makeTable(result.topContributors, [
    ['Name', 'Name'], ['Status', 'RiskGroup', formatStatus], ['Score', 'ContributionScore', score],
    ['Points', 'TotalTerritoryPoints', integer], ['Waves', 'TotalCombatWaves'], ['Platoons', 'PlatoonUnits'],
  ]);
  elements.phaseTable.innerHTML = makeTable(result.phaseSummary, [
    ['Phase', 'Phase', (value) => `P${value}`], ['Points M', 'PointsMillions', oneDecimal],
    ['Waves', 'Waves', integer], ['Avg waves', 'AvgWavesPerPlayer', oneDecimal],
    ['Deployed', 'DeployedPlayers'], ['Missed', 'MissedDeployments'], ['Deployed GP', 'TotalDeployedGP', integer],
    ['Activity source', 'ActivitySource'],
  ]);
  renderPlayers();
  elements.results.hidden = false;
  renderCharts();
}

function renderPlayers() {
  if (!result) return;
  const search = elements.playerSearch.value.trim().toLowerCase();
  const risk = elements.riskFilter.value;
  const rows = [...result.playerSummary]
    .filter((player) => (!search || player.Name.toLowerCase().includes(search)) && (!risk || player.RiskGroup === risk))
    .sort((a, b) => compareValues(a[sort.key], b[sort.key]) * sort.direction);
  elements.playerTable.innerHTML = makeTable(rows, [
    ['Name', 'Name'], ['Status', 'RiskGroup', formatStatus], ['Reason', 'RiskReason'],
    ['Score', 'ContributionScore', score], ['Expected', 'ExpectedRatio', ratio],
    ['Points', 'TotalTerritoryPoints', integer], ['Waves', 'TotalCombatWaves', integer],
    ['Platoons', 'PlatoonUnits', integer], ['Missed', 'MissedDeployments', integer],
    ['Rogue', 'RogueActions', integer], ['GP', 'TotalPower', integer],
  ], true);
  elements.playerTable.querySelectorAll('th[data-sort]').forEach((header) => header.addEventListener('click', () => {
    const key = header.dataset.sort;
    sort.direction = sort.key === key ? -sort.direction : 1;
    sort.key = key;
    renderPlayers();
  }));
}

function renderCharts() {
  if (!result || elements.results.hidden) return;
  requestAnimationFrame(() => {
    drawQuadrant(elements.quadrantChart, result.players, result.waveThreshold);
    drawMomentum(elements.momentumChart, result.phaseSummary);
    drawContribution(elements.contributionChart, result.players);
  });
}

function makeTable(rows, columns, sortable = false) {
  if (!rows.length) return '<p class="empty-state">No rows to show.</p>';
  const header = columns.map(([label, key]) => `<th${sortable ? ` data-sort="${escapeHtml(key)}"` : ''}>${escapeHtml(label)}</th>`).join('');
  const body = rows.map((row) => `<tr>${columns.map(([, key, formatter]) => `<td>${formatter ? formatter(row[key], row) : escapeHtml(row[key])}</td>`).join('')}</tr>`).join('');
  return `<table><thead><tr>${header}</tr></thead><tbody>${body}</tbody></table>`;
}

function formatDate(value) {
  const date = new Date(value);
  return Number.isNaN(date.valueOf()) ? 'recently' : date.toLocaleString('en-GB', { dateStyle: 'medium', timeStyle: 'short' });
}
function metric(label, value, note) { return `<article class="metric card"><span>${escapeHtml(label)}</span><strong>${escapeHtml(value)}</strong><small>${escapeHtml(note)}</small></article>`; }
function formatStatus(value) { const text = String(value ?? ''); return `<span class="status-pill ${text.toLowerCase()}">${escapeHtml(text)}</span>`; }
function score(value) { return Number(value).toFixed(3); }
function ratio(value) { return Number(value).toFixed(3); }
function oneDecimal(value) { return Number(value).toFixed(1); }
function integer(value) { return Math.round(Number(value) || 0).toLocaleString(); }
function formatPhases(phases) {
  if (!phases?.length) return 'none';
  const ordered = [...phases].sort((a, b) => a - b);
  const contiguous = ordered.every((phase, index) => index === 0 || phase === ordered[index - 1] + 1);
  return contiguous && ordered.length > 1 ? `P${ordered[0]}-P${ordered.at(-1)}` : ordered.map((phase) => `P${phase}`).join(', ');
}
function compareValues(a, b) { return typeof a === 'number' && typeof b === 'number' ? a - b : String(a).localeCompare(String(b)); }
function sum(values) { return values.reduce((total, value) => total + (Number(value) || 0), 0); }
function escapeHtml(value) { return String(value ?? '').replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char])); }
