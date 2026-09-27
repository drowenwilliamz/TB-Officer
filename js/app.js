import { parseCsv, toCsv, downloadText } from './csv.js';
import {
  analyseTerritoryBattle, buildPerformanceInsights, detectPhases, makeSnapshot,
  mergeSnapshot, normaliseHistory,
} from './analysis.js';
import { drawContribution, drawHistory, drawMomentum, drawQuadrant } from './charts.js';

const HISTORY_KEY = 'tb-analyser-performance-log-v1';
const state = {
  tbRows: [], rosterRows: [], detectedPhases: [], selectedPhases: [2, 3, 4, 5, 6],
  result: null, history: loadStoredHistory(), sort: { key: 'RiskGroup', direction: 1 },
};

const elements = Object.fromEntries([...document.querySelectorAll('[id]')].map((node) => [node.id, node]));

wireFileInput(elements.tbFile, 'tb');
wireFileInput(elements.rosterFile, 'roster');
wireDropZone(elements.tbDrop, 'tb');
wireDropZone(elements.rosterDrop, 'roster');

elements.analyseButton.addEventListener('click', runAnalysis);
elements.resetButton.addEventListener('click', resetFiles);
elements.playerSearch.addEventListener('input', renderPlayerTable);
elements.riskFilter.addEventListener('change', renderPlayerTable);
elements.saveSnapshotButton.addEventListener('click', saveCurrentSnapshot);
elements.historyFile.addEventListener('change', importHistory);
elements.exportHistoryButton.addEventListener('click', exportHistory);
elements.clearHistoryButton.addEventListener('click', clearHistory);
elements.downloadSummaryButton.addEventListener('click', downloadPlayerSummary);
elements.downloadFollowUpButton.addEventListener('click', downloadFollowUp);
elements.downloadPhaseButton.addEventListener('click', downloadPhases);
elements.downloadReportButton.addEventListener('click', downloadReport);
elements.downloadSiteDataButton.addEventListener('click', downloadSiteData);

document.querySelectorAll('#phasePresets button').forEach((button) => {
  button.addEventListener('click', () => {
    const phases = button.dataset.phases.split(',').map(Number);
    if (phases.some((phase) => !state.detectedPhases.includes(phase))) return;
    state.selectedPhases = phases;
    updatePhaseControls();
  });
});

document.querySelectorAll('.tabs button').forEach((button) => {
  button.addEventListener('click', () => {
    document.querySelectorAll('.tabs button').forEach((item) => item.classList.toggle('active', item === button));
    document.querySelectorAll('.tab-panel').forEach((panel) => panel.classList.toggle('active', panel.dataset.panel === button.dataset.tab));
    if (button.dataset.tab === 'history') renderHistory();
  });
});

let resizeTimer;
window.addEventListener('resize', () => {
  clearTimeout(resizeTimer);
  resizeTimer = setTimeout(renderCharts, 100);
});

renderPhaseControls();
renderHistory();

function wireFileInput(input, type) {
  input.addEventListener('change', async () => {
    const [file] = input.files;
    if (file) await loadDataFile(file, type);
  });
}

function wireDropZone(zone, type) {
  ['dragenter', 'dragover'].forEach((eventName) => zone.addEventListener(eventName, (event) => {
    event.preventDefault(); zone.classList.add('dragging');
  }));
  ['dragleave', 'drop'].forEach((eventName) => zone.addEventListener(eventName, (event) => {
    event.preventDefault(); zone.classList.remove('dragging');
  }));
  zone.addEventListener('drop', async (event) => {
    const [file] = event.dataTransfer.files;
    if (file) await loadDataFile(file, type);
  });
}

async function loadDataFile(file, type) {
  try {
    setMessage(`Reading ${file.name}...`);
    const rows = parseCsv(await file.text());
    if (!rows.length) throw new Error(`${file.name} does not contain any data rows.`);
    if (type === 'tb') {
      if (!Object.hasOwn(rows[0], 'Combat Waves') || !Object.hasOwn(rows[0], 'Platoon Units')) {
        throw new Error('That does not look like a TB activity export. The Combat Waves and Platoon Units columns are missing.');
      }
      state.tbRows = rows;
      state.detectedPhases = detectPhases(rows);
      state.selectedPhases = state.detectedPhases.filter((phase) => phase >= 2);
      setFileStatus('tb', file.name, `${rows.length} players, phases ${formatPhases(state.detectedPhases)}`);
      renderPhaseControls();
    } else {
      if (!Object.hasOwn(rows[0], 'Name') || !Object.hasOwn(rows[0], 'Power')) {
        throw new Error('That does not look like a guild roster export. The Name and Power columns are missing.');
      }
      state.rosterRows = rows;
      const players = new Set(rows.map((row) => row.Name).filter(Boolean)).size;
      setFileStatus('roster', file.name, `${players} players, ${rows.length.toLocaleString()} units`);
    }
    updateReadyState();
  } catch (error) {
    setMessage(error.message, true);
  }
}

function setFileStatus(type, filename, detail) {
  const status = type === 'tb' ? elements.tbFileStatus : elements.rosterFileStatus;
  const drop = type === 'tb' ? elements.tbDrop : elements.rosterDrop;
  status.textContent = `${filename} - ${detail}`;
  status.title = filename;
  drop.classList.add('loaded');
}

function renderPhaseControls() {
  elements.phaseChecks.innerHTML = '';
  const phases = state.detectedPhases.filter((phase) => phase >= 2);
  phases.forEach((phase) => {
    const label = document.createElement('label');
    const input = document.createElement('input');
    input.type = 'checkbox';
    input.value = String(phase);
    input.checked = state.selectedPhases.includes(phase);
    input.addEventListener('change', () => {
      state.selectedPhases = [...elements.phaseChecks.querySelectorAll('input:checked')].map((item) => Number(item.value));
      updatePhaseControls();
      updateReadyState();
    });
    label.classList.toggle('selected', input.checked);
    label.append(input, `P${phase}`);
    elements.phaseChecks.append(label);
  });
  updatePhaseControls();
}

function updatePhaseControls() {
  [...elements.phaseChecks.querySelectorAll('input')].forEach((input) => {
    input.checked = state.selectedPhases.includes(Number(input.value));
    input.parentElement.classList.toggle('selected', input.checked);
  });
  document.querySelectorAll('#phasePresets button').forEach((button) => {
    const phases = button.dataset.phases.split(',').map(Number);
    const available = phases.every((phase) => state.detectedPhases.includes(phase));
    button.disabled = state.detectedPhases.length > 0 && !available;
    button.classList.toggle('active', sameNumbers(phases, state.selectedPhases));
  });
  updateReadyState();
}

function updateReadyState() {
  const ready = state.tbRows.length && state.rosterRows.length && state.selectedPhases.length;
  elements.analyseButton.disabled = !ready;
  if (!state.tbRows.length || !state.rosterRows.length) {
    setMessage('Add both CSV files to begin.');
  } else if (!state.selectedPhases.length) {
    setMessage('Choose at least one phase.', true);
  } else {
    setMessage(`Ready to analyse ${formatPhases(state.selectedPhases)}.`);
  }
}

function runAnalysis() {
  try {
    elements.analyseButton.disabled = true;
    elements.analyseButton.textContent = 'Analysing...';
    state.result = analyseTerritoryBattle(state.tbRows, state.rosterRows, state.selectedPhases);
    renderResults();
    elements.results.hidden = false;
    elements.results.scrollIntoView({ behavior: 'smooth', block: 'start' });
    setMessage(`Report complete for ${formatPhases(state.result.analysisPhases)}.`);
  } catch (error) {
    setMessage(error.message, true);
  } finally {
    elements.analyseButton.textContent = 'Analyse TB';
    elements.analyseButton.disabled = false;
  }
}

function renderResults() {
  const result = state.result;
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
  elements.saveSnapshotButton.disabled = !result.canLogCompletedRun;
  elements.saveSnapshotButton.title = result.canLogCompletedRun ? '' : 'Only a full P2-P6 analysis can be logged.';
  renderPlayerTable();
  renderCharts();
  renderHistory();
}

function renderPlayerTable() {
  if (!state.result) return;
  const search = elements.playerSearch.value.trim().toLowerCase();
  const risk = elements.riskFilter.value;
  const rows = state.result.playerSummary.filter((player) =>
    (!search || player.Name.toLowerCase().includes(search)) && (!risk || player.RiskGroup === risk));
  const columns = [
    ['Name', 'Name'], ['Status', 'RiskGroup', formatStatus], ['Reason', 'RiskReason'],
    ['Score', 'ContributionScore', score], ['Expected', 'ExpectedRatio', ratio],
    ['Points', 'TotalTerritoryPoints', integer], ['Waves', 'TotalCombatWaves', integer],
    ['Platoons', 'PlatoonUnits', integer], ['Missed', 'MissedDeployments', integer],
    ['Rogue', 'RogueActions', integer], ['GP', 'TotalPower', integer],
  ];
  elements.playerTable.innerHTML = makeTable(rows, columns, true);
  elements.playerTable.querySelectorAll('th[data-sort]').forEach((header) => header.addEventListener('click', () => {
    const key = header.dataset.sort;
    state.sort.direction = state.sort.key === key ? -state.sort.direction : 1;
    state.sort.key = key;
    state.result.playerSummary.sort((a, b) => compareValues(a[key], b[key]) * state.sort.direction);
    renderPlayerTable();
  }));
}

function renderCharts() {
  if (!state.result || elements.results.hidden) return;
  requestAnimationFrame(() => {
    drawQuadrant(elements.quadrantChart, state.result.players, state.result.waveThreshold);
    drawMomentum(elements.momentumChart, state.result.phaseSummary);
    drawContribution(elements.contributionChart, state.result.players);
    const insights = buildPerformanceInsights(state.history);
    drawHistory(elements.historyChart, state.history, insights);
  });
}

function renderHistory() {
  const insights = buildPerformanceInsights(state.history);
  const runCount = insights.snapshotIds.length;
  elements.historyStatus.textContent = runCount
    ? `${runCount} completed TB run${runCount === 1 ? '' : 's'} stored in this browser.`
    : 'No completed TB runs stored yet.';
  elements.exportHistoryButton.disabled = !state.history.length;
  elements.clearHistoryButton.disabled = !state.history.length;
  elements.historyWatchlist.innerHTML = insights.watchlist.length ? makeTable(insights.watchlist, [
    ['Name', 'Name'], ['Pattern', 'Status', formatStatus], ['Why', 'PatternReason'],
    ['Recent runs', 'RecentRuns'], ['Concern flags', 'ConcernFlags'],
    ['Score change', 'ScoreChangePct', percent], ['Current score', 'CurrentScore', score],
  ]) : '<p class="empty-state">No repeated concerns identified from the stored completed runs.</p>';
  drawHistory(elements.historyChart, state.history, insights);
}

function saveCurrentSnapshot() {
  if (!state.result?.canLogCompletedRun) return;
  state.history = mergeSnapshot(state.history, makeSnapshot(state.result));
  storeHistory();
  renderHistory();
}

async function importHistory() {
  const [file] = elements.historyFile.files;
  if (!file) return;
  try {
    const imported = normaliseHistory(parseCsv(await file.text()));
    if (!imported.length) throw new Error('No valid performance-log rows were found.');
    const importedIds = [...new Set(imported.map((row) => String(row.SnapshotId)))];
    let merged = state.history.filter((row) => !importedIds.includes(String(row.SnapshotId)));
    merged.push(...imported);
    state.history = merged;
    storeHistory();
    renderHistory();
    elements.historyStatus.textContent = `Imported ${importedIds.length} completed TB run${importedIds.length === 1 ? '' : 's'} from ${file.name}.`;
  } catch (error) {
    elements.historyStatus.textContent = error.message;
  } finally {
    elements.historyFile.value = '';
  }
}

function exportHistory() {
  if (!state.history.length) return;
  downloadText('TB_Performance_Log.csv', toCsv(state.history), 'text/csv;charset=utf-8');
}

function clearHistory() {
  if (!state.history.length || !window.confirm('Clear the completed TB history stored in this browser? Export it first if you may need it later.')) return;
  state.history = [];
  localStorage.removeItem(HISTORY_KEY);
  renderHistory();
}

function downloadPlayerSummary() {
  if (!state.result) return;
  downloadText('TB_Player_Summary.csv', toCsv(state.result.playerSummary, summaryColumns()), 'text/csv;charset=utf-8');
}

function downloadFollowUp() {
  if (!state.result) return;
  downloadText('TB_Follow_Up_List.csv', toCsv(state.result.followUpList, summaryColumns()), 'text/csv;charset=utf-8');
}

function downloadPhases() {
  if (!state.result) return;
  downloadText('TB_Phase_Summary.csv', toCsv(state.result.phaseSummary), 'text/csv;charset=utf-8');
}

function downloadReport() {
  if (!state.result) return;
  const html = buildStandaloneReport(state.result);
  downloadText('TB_Report.html', html, 'text/html;charset=utf-8');
}

function downloadSiteData() {
  if (!state.result) return;
  const payload = {
    schemaVersion: 1,
    publishedAt: new Date().toISOString(),
    guildName: 'Open Armed New Republic',
    report: state.result,
  };
  downloadText('report-data.json', JSON.stringify(payload, null, 2), 'application/json;charset=utf-8');
}

function buildStandaloneReport(result) {
  const totals = {
    points: sum(result.players.map((player) => player.TotalTerritoryPoints)),
    waves: sum(result.players.map((player) => player.TotalCombatWaves)),
    missed: sum(result.players.map((player) => player.MissedDeployments)),
    rogue: sum(result.players.map((player) => player.RogueActions)),
  };
  const chartImages = [
    ['Activity quadrant', elements.quadrantChart.toDataURL('image/png')],
    ['Phase momentum', elements.momentumChart.toDataURL('image/png')],
    ['Contribution breakdown', elements.contributionChart.toDataURL('image/png')],
  ];
  const reportCss = `body{margin:0;background:#f4f2ec;color:#171915;font-family:Segoe UI,Arial,sans-serif}.shell{max-width:1280px;margin:auto;padding:28px}.hero{border-bottom:3px solid #20231e;padding-bottom:18px}.eyebrow{text-transform:uppercase;letter-spacing:.12em;font-size:12px;font-weight:800;color:#946d11}h1{font-size:42px;margin:4px 0}.cards{display:grid;grid-template-columns:repeat(6,1fr);gap:8px;margin:20px 0}.card,.panel{background:#fff;border:1px solid #d9d6cd;border-radius:6px;padding:15px}.card span{display:block;color:#62665f;text-transform:uppercase;font-size:11px}.card strong{display:block;font-size:23px;margin-top:5px}.risks,.grid{display:grid;grid-template-columns:repeat(3,1fr);gap:9px;margin:12px 0}.grid{grid-template-columns:1fr 1fr}.risk{color:#fff;padding:12px 16px;border-radius:4px;display:flex;justify-content:space-between}.green{background:#187a45}.amber{background:#b56909}.red{background:#be3b32}.panel img{width:100%}table{width:100%;border-collapse:collapse;font-size:12px}th{background:#292c27;color:#fff;text-align:left;padding:8px}td{border-bottom:1px solid #e6e5e0;padding:7px}@media(max-width:800px){.cards{grid-template-columns:repeat(2,1fr)}.grid{grid-template-columns:1fr}}`;
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>TB Report</title><style>${reportCss}</style></head><body><main class="shell">
    <section class="hero"><p class="eyebrow">Territory Battle</p><h1>Guild TB Report</h1><p>Generated ${escapeHtml(new Date().toLocaleString())}. Analysed ${escapeHtml(formatPhases(result.analysisPhases))}. ${escapeHtml(result.waveSource)}.</p></section>
    <section class="cards">${[
      metric('Players', result.players.length, ''), metric('Points', `${(totals.points / 1e6).toFixed(1)}M`, ''),
      metric('Waves', totals.waves, ''), metric('Missed deploys', totals.missed, 'P3 onwards'),
      metric('Rogue actions', totals.rogue, 'information only'), metric('Top score', result.topContributors[0]?.Name ?? '-', ''),
    ].join('')}</section>
    <section class="risks">${['Green', 'Amber', 'Red'].map((risk) => `<div class="risk ${risk.toLowerCase()}"><strong>${result.riskCounts[risk]}</strong><span>${risk}</span></div>`).join('')}</section>
    <section class="grid">${chartImages.slice(0, 2).map(([title, src]) => `<article class="panel"><h2>${title}</h2><img src="${src}" alt="${title}"></article>`).join('')}</section>
    <article class="panel"><h2>${chartImages[2][0]}</h2><img src="${chartImages[2][1]}" alt="${chartImages[2][0]}"></article>
    <section class="grid"><article class="panel"><h2>Activity watchlist</h2>${makeTable(result.followUpList.slice(0, 20), [['Name','Name'],['Status','RiskGroup'],['Reason','RiskReason'],['Missed','MissedDeployments'],['Waves','TotalCombatWaves']])}</article><article class="panel"><h2>Top contributors</h2>${makeTable(result.topContributors, [['Name','Name'],['Status','RiskGroup'],['Score','ContributionScore',score],['Points','TotalTerritoryPoints',integer],['Waves','TotalCombatWaves']])}</article></section>
    <article class="panel"><h2>Phase summary</h2>${makeTable(result.phaseSummary, [['Phase','Phase',(value)=>`P${value}`],['Points M','PointsMillions',oneDecimal],['Waves','Waves'],['Avg waves','AvgWavesPerPlayer',oneDecimal],['Deployed','DeployedPlayers'],['Missed','MissedDeployments']])}</article>
    </main></body></html>`;
}

function makeTable(rows, columns, sortable = false) {
  if (!rows.length) return '<p class="empty-state">No rows to show.</p>';
  const header = columns.map(([label, key]) => `<th${sortable ? ` data-sort="${escapeHtml(key)}"` : ''}>${escapeHtml(label)}</th>`).join('');
  const body = rows.map((row) => `<tr>${columns.map(([, key, formatter]) => `<td>${formatter ? formatter(row[key], row) : escapeHtml(row[key])}</td>`).join('')}</tr>`).join('');
  return `<table><thead><tr>${header}</tr></thead><tbody>${body}</tbody></table>`;
}

function summaryColumns() {
  return ['Name', 'RiskGroup', 'RiskReason', 'FollowUpPriority', 'TotalPower', 'TotalTerritoryPoints',
    'TotalCombatWaves', 'PlatoonUnits', 'RogueActions', 'MissedDeployments', 'SuccessfulDeployments',
    'DeployGPShare', 'ContributionScore', 'RawContributionScore', 'PowerEfficiency', 'ExpectedRatio', 'ContributionResidual'];
}

function resetFiles() {
  state.tbRows = []; state.rosterRows = []; state.detectedPhases = []; state.selectedPhases = [2, 3, 4, 5, 6]; state.result = null;
  elements.tbFile.value = ''; elements.rosterFile.value = '';
  elements.tbFileStatus.textContent = 'Choose or drop tb_data.csv';
  elements.rosterFileStatus.textContent = 'Choose or drop Open Armed New RepublicFull.csv';
  elements.tbDrop.classList.remove('loaded'); elements.rosterDrop.classList.remove('loaded');
  elements.results.hidden = true;
  renderPhaseControls(); updateReadyState();
}

function loadStoredHistory() {
  try { return normaliseHistory(JSON.parse(localStorage.getItem(HISTORY_KEY) ?? '[]')); }
  catch { return []; }
}
function storeHistory() { localStorage.setItem(HISTORY_KEY, JSON.stringify(state.history)); }
function setMessage(message, error = false) { elements.setupMessage.textContent = message; elements.setupMessage.classList.toggle('error', error); }
function metric(label, value, note) { return `<article class="metric card"><span>${escapeHtml(label)}</span><strong>${escapeHtml(value)}</strong><small>${escapeHtml(note)}</small></article>`; }
function formatStatus(value) { const text = String(value ?? ''); return `<span class="status-pill ${text.toLowerCase()}">${escapeHtml(text)}</span>`; }
function score(value) { return Number(value).toFixed(3); }
function ratio(value) { return Number(value).toFixed(3); }
function oneDecimal(value) { return Number(value).toFixed(1); }
function integer(value) { return Math.round(Number(value) || 0).toLocaleString(); }
function percent(value) { return Number.isFinite(Number(value)) ? `${Number(value) >= 0 ? '+' : ''}${(Number(value) * 100).toFixed(0)}%` : '-'; }
function formatPhases(phases) {
  if (!phases.length) return 'none';
  const ordered = [...phases].sort((a, b) => a - b);
  const contiguous = ordered.every((phase, index) => index === 0 || phase === ordered[index - 1] + 1);
  return contiguous && ordered.length > 1 ? `P${ordered[0]}-P${ordered.at(-1)}` : ordered.map((phase) => `P${phase}`).join(', ');
}
function sameNumbers(a, b) { return a.length === b.length && a.every((value, index) => value === [...b].sort((x, y) => x - y)[index]); }
function compareValues(a, b) { return typeof a === 'number' && typeof b === 'number' ? a - b : String(a).localeCompare(String(b)); }
function sum(values) { return values.reduce((total, value) => total + (Number(value) || 0), 0); }
function escapeHtml(value) { return String(value ?? '').replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char])); }
