const COLORS = {
  ink: '#292c27', muted: '#6a6e67', grid: '#dedfd9', green: '#187a45',
  amber: '#b56909', red: '#be3b32', blue: '#286aa6', gold: '#c3941f', pale: '#f7f6f2',
};

export function drawQuadrant(canvas, players, waveThreshold) {
  const chart = beginChart(canvas);
  if (!chart || !players.length) return;
  const { ctx, width, height } = chart;
  const margin = { left: 58, right: 20, top: 18, bottom: 48 };
  const plot = area(width, height, margin);
  const ratios = players.map((player) => finite(player.ExpectedRatio));
  const waves = players.map((player) => finite(player.TotalCombatWaves));
  const xMax = Math.max(1.3, roundUp(Math.max(...ratios), .25));
  const yMax = Math.max(waveThreshold + 8, roundUp(Math.max(...waves), 10));
  drawGrid(ctx, plot, 5, 6, (value) => value.toFixed(1), (value) => Math.round(value), 0, xMax, 0, yMax);

  const x = (value) => plot.left + (finite(value) / xMax) * plot.width;
  const y = (value) => plot.bottom - (finite(value) / yMax) * plot.height;
  dashedLine(ctx, x(1), plot.top, x(1), plot.bottom, COLORS.ink, [7, 6]);
  dashedLine(ctx, plot.left, y(waveThreshold), plot.right, y(waveThreshold), COLORS.ink, [4, 5]);
  drawSmallLabel(ctx, 'Expected GP', x(1) + 5, plot.top + 12);
  drawSmallLabel(ctx, `Wave target ${waveThreshold}`, plot.right - 3, y(waveThreshold) - 7, 'right');

  const plotted = players.map((player) => ({
    player,
    x: x(player.ExpectedRatio),
    y: y(player.TotalCombatWaves),
  }));
  for (const point of plotted) {
    const { player, x: px, y: py } = point;
    ctx.beginPath();
    ctx.arc(px, py, 5.5, 0, Math.PI * 2);
    ctx.fillStyle = riskColor(player.RiskGroup);
    ctx.globalAlpha = .82;
    ctx.fill();
    ctx.globalAlpha = 1;
    ctx.strokeStyle = '#343631';
    ctx.lineWidth = .75;
    ctx.stroke();
  }
  drawQuadrantLabels(ctx, plotted, plot);
  axisTitles(ctx, plot, 'Actual / expected contribution', 'Combat waves');
}

export function drawContribution(canvas, players) {
  setChartHeight(canvas, Math.max(560, players.length * 17 + 70));
  const ranked = [...players].sort((a, b) => b.ContributionScore - a.ContributionScore).reverse();
  const chart = beginChart(canvas);
  if (!chart || !ranked.length) return;
  const { ctx, width, height } = chart;
  const margin = { left: 116, right: 22, top: 18, bottom: 42 };
  const plot = area(width, height, margin);
  const rowHeight = plot.height / ranked.length;
  const maxTotal = Math.max(...ranked.map((player) => player.PointScore + player.WaveScore + player.PlatoonScore));
  const xMax = roundUp(maxTotal, .5);

  for (let i = 0; i <= 5; i += 1) {
    const value = xMax * i / 5;
    const px = plot.left + plot.width * i / 5;
    line(ctx, px, plot.top, px, plot.bottom, COLORS.grid, 1);
    tick(ctx, value.toFixed(1), px, plot.bottom + 18, 'center');
  }

  const series = [
    ['PointScore', COLORS.blue],
    ['WaveScore', COLORS.green],
    ['PlatoonScore', COLORS.gold],
  ];
  ranked.forEach((player, index) => {
    const py = plot.bottom - rowHeight * (index + 1) + rowHeight * .17;
    const barHeight = Math.max(7, rowHeight * .66);
    let start = plot.left;
    for (const [key, color] of series) {
      const barWidth = finite(player[key]) / xMax * plot.width;
      ctx.fillStyle = color;
      ctx.fillRect(start, py, barWidth, barHeight);
      start += barWidth;
    }
    ctx.font = '10px Segoe UI, Arial';
    ctx.fillStyle = COLORS.ink;
    ctx.textAlign = 'right';
    ctx.fillText(player.Name, plot.left - 7, py + barHeight * .75);
  });
  ctx.textAlign = 'center';
  ctx.fillStyle = COLORS.muted;
  ctx.font = '12px Segoe UI, Arial';
  ctx.fillText('Normalised contribution components', plot.left + plot.width / 2, height - 6);
  drawLegend(ctx, [['Territory points', COLORS.blue], ['Combat activity', COLORS.green], ['Platoons', COLORS.gold]], plot.right, 10);
}

export function drawMomentum(canvas, phases) {
  const chart = beginChart(canvas);
  if (!chart || !phases.length) return;
  const { ctx, width, height } = chart;
  const margin = { left: 56, right: 52, top: 22, bottom: 48 };
  const plot = area(width, height, margin);
  const gap = phases.length > 1 ? plot.width / phases.length : plot.width;
  const maxPoints = Math.max(...phases.map((phase) => phase.PointsMillions), 1);
  const maxWaves = Math.max(...phases.map((phase) => phase.Waves), 1);
  const maxMissed = Math.max(...phases.map((phase) => phase.MissedDeployments), 1);

  for (let i = 0; i <= 4; i += 1) {
    const py = plot.bottom - plot.height * i / 4;
    line(ctx, plot.left, py, plot.right, py, COLORS.grid, 1);
    tick(ctx, `${Math.round(maxPoints * i / 4)}M`, plot.left - 8, py + 4, 'right');
  }
  phases.forEach((phase, index) => {
    const center = plot.left + gap * (index + .5);
    const barWidth = Math.min(46, gap * .42);
    const barHeight = phase.PointsMillions / maxPoints * plot.height;
    ctx.fillStyle = 'rgba(40,106,166,.22)';
    ctx.fillRect(center - barWidth / 2, plot.bottom - barHeight, barWidth, barHeight);
    tick(ctx, `P${phase.Phase}`, center, plot.bottom + 20, 'center');
  });

  const points = phases.map((phase, index) => ({
    x: plot.left + gap * (index + .5),
    y: plot.bottom - phase.Waves / maxWaves * plot.height,
  }));
  const missed = phases.map((phase, index) => ({
    x: plot.left + gap * (index + .5),
    y: plot.bottom - phase.MissedDeployments / maxMissed * plot.height,
  }));
  drawSeries(ctx, points, COLORS.green, 'circle');
  drawSeries(ctx, missed, COLORS.red, 'square');
  ctx.save();
  ctx.translate(14, plot.top + plot.height / 2);
  ctx.rotate(-Math.PI / 2);
  tick(ctx, 'Points (millions)', 0, 0, 'center');
  ctx.restore();
  drawLegend(ctx, [['Points', COLORS.blue], ['Waves', COLORS.green], ['Missed', COLORS.red]], plot.right, 10);
}

export function drawHistory(canvas, history, insights) {
  const chart = beginChart(canvas);
  if (!chart) return;
  const { ctx, width, height } = chart;
  if (!history.length || !insights.snapshotIds.length) {
    emptyChart(ctx, width, height, 'Add or import completed TB runs to see trends.');
    return;
  }
  const ids = insights.historyIds;
  const focusNames = insights.watchlist.slice(0, 6).map((row) => row.Name);
  if (!focusNames.length) focusNames.push(...insights.currentRows.slice(-6).map((row) => row.Name));
  const margin = { left: 50, right: 20, top: 28, bottom: 58 };
  const plot = area(width, height, margin);
  const allScores = history
    .filter((row) => ids.includes(String(row.SnapshotId)) && focusNames.includes(row.Name))
    .map((row) => finite(row.ContributionScore));
  const yMax = Math.max(.1, roundUp(Math.max(...allScores, .1), .1));
  drawGrid(ctx, plot, 4, Math.max(1, ids.length - 1), (value) => value.toFixed(1), () => '', 0, Math.max(1, ids.length - 1), 0, yMax);
  const palette = [COLORS.red, COLORS.amber, COLORS.blue, COLORS.green, '#74529a', '#62665f'];

  focusNames.forEach((name, nameIndex) => {
    const points = ids.map((id, index) => {
      const row = history.find((item) => String(item.SnapshotId) === id && item.Name === name);
      return row ? {
        x: plot.left + (ids.length === 1 ? plot.width / 2 : index / (ids.length - 1) * plot.width),
        y: plot.bottom - finite(row.ContributionScore) / yMax * plot.height,
      } : null;
    }).filter(Boolean);
    drawSeries(ctx, points, palette[nameIndex % palette.length], 'circle');
  });
  ids.forEach((id, index) => {
    const x = plot.left + (ids.length === 1 ? plot.width / 2 : index / (ids.length - 1) * plot.width);
    tick(ctx, shortSnapshot(id), x, plot.bottom + 20, 'center');
  });
  drawLegend(ctx, focusNames.map((name, index) => [name, palette[index % palette.length]]), plot.right, 9);
}

export function setupExpandableCharts(getResult) {
  const modal = document.getElementById('chartModal');
  const modalCanvas = document.getElementById('expandedChart');
  const modalTitle = document.getElementById('chartModalTitle');
  const closeButton = document.getElementById('closeChartModal');
  if (!modal || !modalCanvas || !modalTitle || !closeButton) return;

  const titles = {
    quadrant: 'Activity quadrant',
    momentum: 'Phase momentum',
    contribution: 'Contribution breakdown - all guild members',
  };
  let activeType = '';
  let resizeTimer;

  const renderExpanded = () => {
    const result = getResult();
    if (!result || !activeType) return;
    if (activeType !== 'contribution') {
      setChartHeight(modalCanvas, Math.max(600, window.innerHeight - 125));
    }
    if (activeType === 'quadrant') drawQuadrant(modalCanvas, result.players, result.waveThreshold);
    if (activeType === 'momentum') drawMomentum(modalCanvas, result.phaseSummary);
    if (activeType === 'contribution') drawContribution(modalCanvas, result.players);
  };

  const open = (type) => {
    if (!getResult()) return;
    activeType = type;
    modalTitle.textContent = titles[type] ?? 'Chart';
    modal.hidden = false;
    document.body.classList.add('modal-open');
    modal.scrollTop = 0;
    requestAnimationFrame(renderExpanded);
    closeButton.focus();
  };

  const close = () => {
    modal.hidden = true;
    document.body.classList.remove('modal-open');
    activeType = '';
  };

  document.querySelectorAll('canvas[data-expand-chart]').forEach((canvas) => {
    canvas.setAttribute('tabindex', '0');
    canvas.setAttribute('role', 'button');
    canvas.setAttribute('aria-label', `Open ${titles[canvas.dataset.expandChart] ?? 'chart'} full screen`);
    canvas.addEventListener('click', () => open(canvas.dataset.expandChart));
    canvas.addEventListener('keydown', (event) => {
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        open(canvas.dataset.expandChart);
      }
    });
  });
  closeButton.addEventListener('click', close);
  modal.addEventListener('click', (event) => { if (event.target === modal) close(); });
  document.addEventListener('keydown', (event) => { if (event.key === 'Escape' && !modal.hidden) close(); });
  window.addEventListener('resize', () => {
    if (modal.hidden) return;
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(renderExpanded, 100);
  });
}

function beginChart(canvas) {
  if (!canvas) return null;
  const rect = canvas.getBoundingClientRect();
  const width = Math.max(280, Math.floor(rect.width || canvas.parentElement?.clientWidth || 600));
  const height = Number(canvas.dataset.chartHeight || canvas.getAttribute('height')) || 400;
  canvas.dataset.chartHeight = String(height);
  const ratio = Math.max(1, window.devicePixelRatio || 1);
  canvas.width = Math.floor(width * ratio);
  canvas.height = Math.floor(height * ratio);
  canvas.style.height = `${height}px`;
  const ctx = canvas.getContext('2d');
  ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
  ctx.clearRect(0, 0, width, height);
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, width, height);
  return { ctx, width, height };
}

function setChartHeight(canvas, height) {
  canvas.dataset.chartHeight = String(Math.round(height));
}

function drawGrid(ctx, plot, xSteps, ySteps, xFormat, yFormat, xMin, xMax, yMin, yMax) {
  for (let i = 0; i <= xSteps; i += 1) {
    const px = plot.left + plot.width * i / xSteps;
    line(ctx, px, plot.top, px, plot.bottom, COLORS.grid, 1);
    tick(ctx, xFormat(xMin + (xMax - xMin) * i / xSteps), px, plot.bottom + 18, 'center');
  }
  for (let i = 0; i <= ySteps; i += 1) {
    const py = plot.bottom - plot.height * i / ySteps;
    line(ctx, plot.left, py, plot.right, py, COLORS.grid, 1);
    tick(ctx, yFormat(yMin + (yMax - yMin) * i / ySteps), plot.left - 8, py + 4, 'right');
  }
}

function drawSeries(ctx, points, color, marker) {
  if (!points.length) return;
  ctx.beginPath();
  points.forEach((point, index) => index ? ctx.lineTo(point.x, point.y) : ctx.moveTo(point.x, point.y));
  ctx.strokeStyle = color;
  ctx.lineWidth = 2.3;
  ctx.stroke();
  points.forEach((point) => {
    ctx.fillStyle = color;
    if (marker === 'square') ctx.fillRect(point.x - 4, point.y - 4, 8, 8);
    else {
      ctx.beginPath();
      ctx.arc(point.x, point.y, 4, 0, Math.PI * 2);
      ctx.fill();
    }
  });
}

function drawLegend(ctx, items, right, top) {
  ctx.font = '10px Segoe UI, Arial';
  let x = right;
  [...items].reverse().forEach(([label, color]) => {
    const width = ctx.measureText(label).width + 20;
    x -= width;
    ctx.fillStyle = color;
    ctx.fillRect(x, top + 1, 9, 9);
    ctx.fillStyle = COLORS.muted;
    ctx.textAlign = 'left';
    ctx.fillText(label, x + 13, top + 10);
  });
}

function axisTitles(ctx, plot, xTitle, yTitle) {
  ctx.fillStyle = COLORS.muted;
  ctx.font = '12px Segoe UI, Arial';
  ctx.textAlign = 'center';
  ctx.fillText(xTitle, plot.left + plot.width / 2, plot.bottom + 39);
  ctx.save();
  ctx.translate(14, plot.top + plot.height / 2);
  ctx.rotate(-Math.PI / 2);
  ctx.fillText(yTitle, 0, 0);
  ctx.restore();
}

function drawQuadrantLabels(ctx, points, plot) {
  ctx.font = '9px Segoe UI, Arial';
  const placed = [];
  const ordered = [...points].sort((a, b) => a.y - b.y || a.x - b.x);
  const candidates = [
    { dx: 8, dy: -6, align: 'left' }, { dx: 8, dy: 11, align: 'left' },
    { dx: -8, dy: -6, align: 'right' }, { dx: -8, dy: 11, align: 'right' },
    { dx: 12, dy: -17, align: 'left' }, { dx: -12, dy: 21, align: 'right' },
  ];

  for (const point of ordered) {
    const name = point.player.Name;
    const textWidth = ctx.measureText(name).width;
    let chosen = null;
    for (const candidate of candidates) {
      const box = labelBox(point, candidate, textWidth, plot);
      if (!placed.some((other) => boxesOverlap(box, other))) {
        chosen = box;
        break;
      }
    }
    if (!chosen) {
      const preferred = point.x > plot.left + plot.width * .68 ? candidates[2] : candidates[0];
      chosen = labelBox(point, preferred, textWidth, plot);
      for (let attempt = 0; attempt < 14 && placed.some((other) => boxesOverlap(chosen, other)); attempt += 1) {
        const direction = attempt % 2 === 0 ? 1 : -1;
        const distance = Math.ceil((attempt + 1) / 2) * 10;
        chosen = { ...chosen, top: clamp(chosen.top + direction * distance, plot.top, plot.bottom - 11) };
        chosen.baseline = chosen.top + 9;
      }
    }
    placed.push(chosen);
    ctx.beginPath();
    ctx.moveTo(point.x, point.y);
    ctx.lineTo(chosen.anchorX, chosen.baseline - 3);
    ctx.strokeStyle = 'rgba(70,72,68,.32)';
    ctx.lineWidth = .6;
    ctx.stroke();
    ctx.fillStyle = 'rgba(255,255,255,.78)';
    ctx.fillRect(chosen.left - 1, chosen.top - 1, chosen.width + 2, 11);
    ctx.fillStyle = COLORS.ink;
    ctx.textAlign = chosen.align;
    ctx.fillText(name, chosen.anchorX, chosen.baseline);
  }
}

function labelBox(point, candidate, textWidth, plot) {
  let align = candidate.align;
  let anchorX = point.x + candidate.dx;
  let left = align === 'left' ? anchorX : anchorX - textWidth;
  if (left < plot.left) {
    align = 'left'; anchorX = plot.left + 1; left = anchorX;
  } else if (left + textWidth > plot.right) {
    align = 'right'; anchorX = plot.right - 1; left = anchorX - textWidth;
  }
  const baseline = clamp(point.y + candidate.dy, plot.top + 9, plot.bottom - 2);
  return { left, top: baseline - 9, width: textWidth, height: 10, baseline, anchorX, align };
}

function boxesOverlap(a, b) {
  return a.left < b.left + b.width + 3 && a.left + a.width + 3 > b.left
    && a.top < b.top + b.height + 2 && a.top + a.height + 2 > b.top;
}

function shortSnapshot(id) {
  const match = String(id).match(/_(\d+)pts_(\d+)waves/);
  return match ? `${Math.round(Number(match[1]) / 1e6)}M` : String(id).slice(0, 12);
}

function emptyChart(ctx, width, height, message) {
  ctx.fillStyle = COLORS.pale;
  ctx.fillRect(0, 0, width, height);
  ctx.fillStyle = COLORS.muted;
  ctx.font = '14px Segoe UI, Arial';
  ctx.textAlign = 'center';
  ctx.fillText(message, width / 2, height / 2);
}

function area(width, height, margin) {
  return { left: margin.left, right: width - margin.right, top: margin.top, bottom: height - margin.bottom,
    width: width - margin.left - margin.right, height: height - margin.top - margin.bottom };
}
function line(ctx, x1, y1, x2, y2, color, width) {
  ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.strokeStyle = color; ctx.lineWidth = width; ctx.stroke();
}
function dashedLine(ctx, x1, y1, x2, y2, color, dash) {
  ctx.save(); ctx.setLineDash(dash); line(ctx, x1, y1, x2, y2, color, 1.4); ctx.restore();
}
function tick(ctx, text, x, y, align) {
  ctx.fillStyle = COLORS.muted; ctx.font = '10px Segoe UI, Arial'; ctx.textAlign = align; ctx.fillText(text, x, y);
}
function drawSmallLabel(ctx, text, x, y, align = 'left') {
  ctx.fillStyle = COLORS.ink; ctx.font = '10px Segoe UI, Arial'; ctx.textAlign = align; ctx.fillText(text, x, y);
}
function riskColor(risk) { return risk === 'Green' ? COLORS.green : risk === 'Amber' ? COLORS.amber : COLORS.red; }
function finite(value) { return Number.isFinite(Number(value)) ? Number(value) : 0; }
function roundUp(value, step) { return Math.ceil(value / step) * step; }
function clamp(value, min, max) { return Math.max(min, Math.min(max, value)); }
