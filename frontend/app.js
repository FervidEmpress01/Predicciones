/* ===== Mundial 2026 – Predicciones + Bracket Interactivo ===== */
const API = '';
const GROUPS = 'ABCDEFGHIJKL'.split('');

let currentUser = null;     // logged-in username
let gruposData = {};        // from /api/grupos
let grupoSelections = {};   // { A: [1st, 2nd, 3rd], ... }
let bracketData = null;
let matchResults = {};
let teamNames = {};
let predictionLocked = false; // true if user already saved
let deadlineClosed = false;   // true if past deadline
let resultsViewMode = 'groups';

// ─── INIT ──────────────────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', async () => {
  // Login
  document.getElementById('btn-login').addEventListener('click', doLogin);
  document.getElementById('login-name').addEventListener('keydown', e => {
    if (e.key === 'Enter') doLogin();
  });
  document.getElementById('btn-logout').addEventListener('click', doLogout);

  // Tabs
  document.querySelectorAll('.nav-btn').forEach(btn => {
    btn.addEventListener('click', () => switchTab(btn.dataset.tab));
  });
  document.getElementById('btn-generate').addEventListener('click', generateBracket);
  document.getElementById('btn-save').addEventListener('click', savePrediction);
  document.getElementById('btn-sync').addEventListener('click', () => loadResultados(true));

  document.getElementById('btn-view-groups')?.addEventListener('click', (e) => {
    resultsViewMode = 'groups';
    document.querySelectorAll('.view-toggles .btn').forEach(b => b.classList.remove('active'));
    e.target.classList.add('active');
    loadResultados();
  });
  document.getElementById('btn-view-dates')?.addEventListener('click', (e) => {
    resultsViewMode = 'dates';
    document.querySelectorAll('.view-toggles .btn').forEach(b => b.classList.remove('active'));
    e.target.classList.add('active');
    loadResultados();
  });

  // Load groups data
  try {
    const res = await fetch(API + '/api/grupos');
    gruposData = await res.json();
  } catch (e) {
    console.error('Error cargando grupos:', e);
  }

  // Check if user was logged in (localStorage)
  const saved = localStorage.getItem('mundial2026_user');
  if (saved) {
    loginAs(saved);
  }
});

// ─── LOGIN / LOGOUT ────────────────────────────────────────────────────────
function doLogin() {
  const nameInput = document.getElementById('login-name');
  const errDiv = document.getElementById('login-error');
  const name = nameInput.value.trim();
  if (!name) {
    errDiv.textContent = '⚠️ Ingresa tu nombre';
    errDiv.style.display = 'block';
    return;
  }
  errDiv.style.display = 'none';
  localStorage.setItem('mundial2026_user', name);
  loginAs(name);
}

async function loginAs(name) {
  currentUser = name;
  document.getElementById('login-screen').style.display = 'none';
  document.getElementById('main-app').style.display = 'block';
  document.getElementById('user-badge').textContent = `👤 ${name}`;

  // Check deadline
  try {
    const dlRes = await fetch(API + '/api/deadline');
    const dlData = await dlRes.json();
    deadlineClosed = dlData.closed;
  } catch (e) { }

  // Build UI
  buildGruposUI();
  buildThirdsSelector();

  // Try to load existing prediction for this user
  try {
    const res = await fetch(API + '/api/prediccion/' + encodeURIComponent(name));
    if (res.ok) {
      const data = await res.json();
      await loadExistingPrediction(data);
      predictionLocked = true;
      lockUI();
    } else if (deadlineClosed) {
      // New user but deadline passed
      predictionLocked = true;
      lockUI();
      showDeadlineBanner('Las predicciones están cerradas. Ya no se pueden crear nuevas predicciones.');
    }
  } catch (e) {
    if (deadlineClosed) {
      predictionLocked = true;
      lockUI();
      showDeadlineBanner('Las predicciones están cerradas.');
    }
  }
}

function doLogout() {
  currentUser = null;
  localStorage.removeItem('mundial2026_user');
  document.getElementById('main-app').style.display = 'none';
  document.getElementById('login-screen').style.display = 'flex';
  document.getElementById('login-name').value = '';
  bracketData = null;
  matchResults = {};
  document.getElementById('bracket-inline').style.display = 'none';
}

async function loadExistingPrediction(data) {
  // Restore group selections
  if (data.grupos) {
    GROUPS.forEach(g => {
      grupoSelections[g] = data.grupos[g] || [];
      refreshGrupoCard(g);
    });
  }
  // Restore thirds
  if (data.terceros_grupos && data.terceros_grupos.length > 0) {
    data.terceros_grupos.forEach(g => {
      const btn = document.getElementById(`third-btn-${g}`);
      if (btn) btn.classList.add('selected');
    });
    document.getElementById('thirds-count').textContent =
      document.querySelectorAll('.third-btn.selected').length;
  }

  // Restore bracket
  await generateBracket();
  if (bracketData) {
    // Reconstruct matchResults from saved arrays
    const applyPhase = (phaseMatches, savedNames) => {
      if (!savedNames) return;
      phaseMatches.forEach(m => {
        const nameA = resolve(m.teamA);
        const nameB = resolve(m.teamB);
        if (savedNames.includes(nameA)) {
          matchResults[m.id] = m.teamA;
          propagate(m.id, m.teamA);
        } else if (savedNames.includes(nameB)) {
          matchResults[m.id] = m.teamB;
          propagate(m.id, m.teamB);
        }
      });
    };

    applyPhase(bracketData.r32, data.dieciseisavos);
    applyPhase(bracketData.r16, data.octavos);
    applyPhase(bracketData.qf, data.cuartos);
    applyPhase(bracketData.sf, data.semis);
    applyPhase([bracketData.final], data.campeon);

    // We don't save 3RD place winner, but we can set it if it was saved (data.tercero_puesto)
    if (data.tercero_puesto) {
      applyPhase([bracketData.third_place], [data.tercero_puesto]);
    }

    // Re-render bracket to show the loaded outcomes
    renderBracket('bracket', 'round-labels');
  }
}

function lockUI() {
  // Disable all interactive elements
  document.querySelectorAll('.team-row').forEach(r => {
    r.style.pointerEvents = 'none';
    r.style.opacity = '0.7';
  });
  document.querySelectorAll('.third-btn').forEach(b => {
    b.style.pointerEvents = 'none';
    b.style.opacity = '0.7';
  });
  document.querySelectorAll('.team-slot').forEach(t => {
    t.style.pointerEvents = 'none';
  });

  // Hide generate button
  const genBtn = document.getElementById('btn-generate');
  if (genBtn) genBtn.style.display = 'none';

  // Hide save button
  const saveBtn = document.getElementById('btn-save');
  if (saveBtn) saveBtn.style.display = 'none';

  // Add locked banner
  showDeadlineBanner('🔒 Tu predicción está guardada y bloqueada. No se puede modificar.');
}

function showDeadlineBanner(msg) {
  // Remove existing banner
  const old = document.getElementById('locked-banner');
  if (old) old.remove();
  const banner = document.createElement('div');
  banner.id = 'locked-banner';
  banner.className = 'glass-card locked-banner';
  banner.innerHTML = `<p>${msg}</p>`;
  const tab = document.getElementById('tab-predicciones');
  tab.insertBefore(banner, tab.firstChild);
}

// ─── TAB NAV ───────────────────────────────────────────────────────────────
function switchTab(tab) {
  document.querySelectorAll('.nav-btn').forEach(b => b.classList.remove('active'));
  document.querySelectorAll('.tab-content').forEach(s => s.classList.remove('active'));
  document.querySelector(`[data-tab="${tab}"]`).classList.add('active');
  document.getElementById(`tab-${tab}`).classList.add('active');

  if (tab === 'ranking') loadRanking();
  if (tab === 'resultados') loadResultados();
}

// ─── GRUPOS UI ─────────────────────────────────────────────────────────────
function buildGruposUI() {
  const grid = document.getElementById('grupos-grid');
  grid.innerHTML = '';
  GROUPS.forEach(g => {
    const teams = gruposData[g] || [];
    if (!grupoSelections[g]) grupoSelections[g] = [];
    const card = document.createElement('div');
    card.className = 'grupo-card';
    card.id = `grupo-${g}`;
    card.innerHTML = `<h4>Grupo ${g}</h4>`;
    teams.forEach(team => {
      const row = document.createElement('div');
      row.className = 'team-row';
      row.dataset.group = g;
      row.dataset.team = team;
      row.innerHTML = `<span>${team}</span><span class="pos-badge">–</span>`;
      row.addEventListener('click', () => toggleTeamPosition(g, team));
      card.appendChild(row);
    });
    grid.appendChild(card);
    refreshGrupoCard(g);
  });
}

function toggleTeamPosition(group, team) {
  const sel = grupoSelections[group];
  const idx = sel.indexOf(team);
  if (idx >= 0) {
    sel.splice(idx, 1);
  } else if (sel.length < 3) {
    sel.push(team);
  } else {
    sel[2] = team;
  }
  refreshGrupoCard(group);
}

function refreshGrupoCard(group) {
  const card = document.getElementById(`grupo-${group}`);
  if (!card) return;
  const rows = card.querySelectorAll('.team-row');
  const sel = grupoSelections[group];
  rows.forEach(row => {
    const team = row.dataset.team;
    const pos = sel.indexOf(team);
    row.className = 'team-row' + (pos >= 0 ? ` pos-${pos + 1}` : '');
    const badge = row.querySelector('.pos-badge');
    badge.textContent = pos >= 0 ? `${pos + 1}°` : '–';
  });
  refreshThirdsSelector();
}

// ─── THIRDS SELECTOR ───────────────────────────────────────────────────────
function buildThirdsSelector() {
  const grid = document.getElementById('thirds-selector');
  grid.innerHTML = '';
  GROUPS.forEach(g => {
    const btn = document.createElement('button');
    btn.className = 'third-btn';
    btn.dataset.group = g;
    btn.id = `third-btn-${g}`;
    updateThirdBtnContent(btn, g);
    btn.addEventListener('click', () => toggleThird(btn));
    grid.appendChild(btn);
  });
}

function updateThirdBtnContent(btn, g) {
  const sel = grupoSelections[g] || [];
  const teams = gruposData[g] || [];
  let thirdTeam = sel[2] || null;
  if (!thirdTeam) {
    thirdTeam = teams.find(t => !sel.includes(t)) || teams[2] || `3°${g}`;
  }
  btn.innerHTML = `<span class="third-group">Grupo ${g}</span><span class="third-team">${thirdTeam}</span>`;
}

function refreshThirdsSelector() {
  GROUPS.forEach(g => {
    const btn = document.getElementById(`third-btn-${g}`);
    if (btn) updateThirdBtnContent(btn, g);
  });
}

function toggleThird(btn) {
  const selected = document.querySelectorAll('.third-btn.selected');
  if (btn.classList.contains('selected')) {
    btn.classList.remove('selected');
  } else if (selected.length < 8) {
    btn.classList.add('selected');
  }
  document.getElementById('thirds-count').textContent =
    document.querySelectorAll('.third-btn.selected').length;
}

function getSelectedThirds() {
  return [...document.querySelectorAll('.third-btn.selected')].map(b => b.dataset.group);
}

// ─── GENERATE BRACKET ──────────────────────────────────────────────────────
async function generateBracket() {
  const errDiv = document.getElementById('error-msg');
  errDiv.style.display = 'none';

  for (const g of GROUPS) {
    if (!grupoSelections[g] || grupoSelections[g].length < 2) {
      errDiv.textContent = `⚠️ Completa al menos 1° y 2° del Grupo ${g}`;
      errDiv.style.display = 'block';
      return;
    }
  }

  const thirds = getSelectedThirds();
  if (thirds.length !== 8) {
    errDiv.textContent = '⚠️ Selecciona exactamente 8 grupos para mejores terceros.';
    errDiv.style.display = 'block';
    return;
  }

  const leaderCodes = GROUPS.map(g => `1${g}`);
  const runnerCodes = GROUPS.map(g => `2${g}`);
  teamNames = {};
  GROUPS.forEach(g => {
    const sel = grupoSelections[g];
    teamNames[`1${g}`] = sel[0] || `1°${g}`;
    teamNames[`2${g}`] = sel[1] || `2°${g}`;
    teamNames[`3${g}`] = sel[2] || (gruposData[g] || [])[2] || `3°${g}`;
  });

  try {
    const res = await fetch(API + '/api/bracket', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ leaders: leaderCodes, runners_up: runnerCodes, best_thirds: thirds })
    });
    if (!res.ok) {
      const err = await res.json();
      throw new Error(err.detail || 'Error del servidor');
    }
    bracketData = await res.json();
    matchResults = {};
    document.getElementById('bracket-inline').style.display = 'block';
    renderBracket('bracket', 'round-labels');
    document.getElementById('bracket-inline').scrollIntoView({ behavior: 'smooth' });
  } catch (e) {
    errDiv.textContent = '❌ ' + e.message;
    errDiv.style.display = 'block';
  }
}

// ─── RENDER BRACKET ────────────────────────────────────────────────────────
function renderBracket(containerId, labelsId) {
  if (!bracketData) return;
  const container = document.getElementById(containerId);
  const labelsDiv = document.getElementById(labelsId);
  container.innerHTML = '';
  labelsDiv.innerHTML = '';

  const rounds = [
    { key: 'r32_left', label: '16avos', matches: bracketData.r32.slice(0, 8) },
    { key: 'r16_left', label: 'Octavos', matches: bracketData.r16.slice(0, 4) },
    { key: 'qf_left', label: 'Cuartos', matches: bracketData.qf.slice(0, 2) },
    { key: 'sf_left', label: 'Semis', matches: bracketData.sf.slice(0, 1) },
    { key: 'final', label: 'Final', matches: [bracketData.final] },
    { key: 'sf_right', label: 'Semis', matches: bracketData.sf.slice(1, 2) },
    { key: 'qf_right', label: 'Cuartos', matches: bracketData.qf.slice(2, 4) },
    { key: 'r16_right', label: 'Octavos', matches: bracketData.r16.slice(4, 8) },
    { key: 'r32_right', label: '16avos', matches: bracketData.r32.slice(8, 16) },
  ];

  rounds.forEach(round => {
    labelsDiv.innerHTML += `<div class="rl">${round.label}</div>`;
    if (round.key === 'final') {
      const col = document.createElement('div');
      col.className = 'round';
      col.style.justifyContent = 'center';
      const champ = document.createElement('div');
      champ.className = 'champion-box';
      champ.innerHTML = `<div class="trophy-icon">🏆</div><div class="label">Campeón</div><div class="champ-name" id="champ-${containerId}">—</div>`;
      col.appendChild(champ);
      col.appendChild(renderMatch(round.matches[0]));
      const tp = document.createElement('div');
      tp.className = 'third-place-box';
      tp.innerHTML = `<div class="label">3er Puesto</div>`;
      tp.appendChild(renderMatch(bracketData.third_place));
      col.appendChild(tp);
      container.appendChild(col);
    } else {
      const col = document.createElement('div');
      col.className = 'round';
      round.matches.forEach(m => col.appendChild(renderMatch(m)));
      container.appendChild(col);
    }
  });
  updateChampion(containerId);
}

function renderMatch(m) {
  const div = document.createElement('div');
  div.className = 'match';
  div.id = `match-${m.id}`;
  const nameA = resolve(m.teamA);
  const nameB = resolve(m.teamB);
  const winner = matchResults[m.id] || null;
  const winA = winner && m.teamA && winner === m.teamA;
  const winB = winner && m.teamB && winner === m.teamB;

  div.innerHTML = `
    <div class="team-slot ${!nameA ? 'empty' : ''} ${winA ? 'winner' : ''}" data-match="${m.id}" data-team="${m.teamA || ''}" data-side="A">
      <span class="seed">${m.teamA ? (m.teamA.substring(0, 2)) : ''}</span> ${nameA || 'Por definir'}
    </div>
    <div class="vs">VS</div>
    <div class="team-slot ${!nameB ? 'empty' : ''} ${winB ? 'winner' : ''}" data-match="${m.id}" data-team="${m.teamB || ''}" data-side="B">
      <span class="seed">${m.teamB ? (m.teamB.substring(0, 2)) : ''}</span> ${nameB || 'Por definir'}
    </div>`;

  div.querySelectorAll('.team-slot:not(.empty)').forEach(slot => {
    slot.addEventListener('click', () => onTeamClick(slot));
  });
  return div;
}

function resolve(code) {
  if (!code) return null;
  return teamNames[code] || code;
}

// ─── CLICK TO ADVANCE ──────────────────────────────────────────────────────
function onTeamClick(slot) {
  const matchId = slot.dataset.match;
  const teamCode = slot.dataset.team;
  if (!teamCode) return;
  matchResults[matchId] = teamCode;
  propagate(matchId, teamCode);
  renderBracket('bracket', 'round-labels');
  if (document.getElementById('bracket-full')) {
    renderBracket('bracket-full', 'round-labels-full');
  }
}

function propagate(matchId, winnerCode) {
  const feeder = bracketData.feeder;
  for (const [nextId, sources] of Object.entries(feeder)) {
    const idx = sources.indexOf(matchId);
    if (idx === -1) continue;
    const nm = findMatch(nextId);
    if (!nm) continue;

    if (nextId === '3RD') {
      // 3rd place gets the LOSERS of the semis, not the winners
      const sfm = findMatch(matchId);
      if (sfm) {
        const loser = sfm.teamA === winnerCode ? sfm.teamB : sfm.teamA;
        if (idx === 0) bracketData.third_place.teamA = loser;
        else bracketData.third_place.teamB = loser;
      }
      // Don't run general propagation for 3RD — it would overwrite losers with winners
      continue;
    }

    if (idx === 0) nm.teamA = winnerCode;
    else nm.teamB = winnerCode;

    if (matchResults[nextId]) {
      const oldW = matchResults[nextId];
      if (oldW !== nm.teamA && oldW !== nm.teamB) {
        delete matchResults[nextId];
        clearDown(nextId);
      }
    }
  }
}

function clearDown(matchId) {
  for (const [nextId, sources] of Object.entries(bracketData.feeder)) {
    const idx = sources.indexOf(matchId);
    if (idx === -1) continue;
    const nm = findMatch(nextId);
    if (!nm) continue;
    if (idx === 0) nm.teamA = null; else nm.teamB = null;
    delete matchResults[nextId];
    clearDown(nextId);
  }
}

function findMatch(id) {
  return [...bracketData.r32, ...bracketData.r16, ...bracketData.qf, ...bracketData.sf,
  bracketData.final, bracketData.third_place].find(m => m.id === id);
}

function updateChampion(containerId) {
  const el = document.getElementById(`champ-${containerId}`);
  if (!el) return;
  const w = matchResults['FINAL'];
  el.textContent = w ? resolve(w) : '—';
  if (w) el.style.color = '#f59e0b';
  else el.style.color = '';
}

// ─── SAVE PREDICTION ───────────────────────────────────────────────────────
async function savePrediction() {
  const msgDiv = document.getElementById('save-msg');
  msgDiv.style.display = 'none';

  if (!currentUser) {
    showMsg(msgDiv, '⚠️ No hay usuario activo', 'err');
    return;
  }

  // ── Validación: Grupos completos ──
  for (const g of GROUPS) {
    if (!grupoSelections[g] || grupoSelections[g].length < 2) {
      showMsg(msgDiv, `⚠️ Completa al menos 1° y 2° del Grupo ${g}`, 'err');
      return;
    }
  }

  // ── Validación: Terceros ──
  const thirdsGroups = getSelectedThirds();
  if (thirdsGroups.length !== 8) {
    showMsg(msgDiv, `⚠️ Selecciona exactamente 8 mejores terceros (tienes ${thirdsGroups.length})`, 'err');
    return;
  }

  // ── Validación: Bracket generado ──
  if (!bracketData) {
    showMsg(msgDiv, '⚠️ Primero genera el bracket de eliminatorias', 'err');
    return;
  }

  // ── Contar ganadores por ronda ──
  let r32Count = 0, r16Count = 0, qfCount = 0, sfCount = 0, finalCount = 0;
  for (const mid of Object.keys(matchResults)) {
    if (mid.startsWith('R32-')) r32Count++;
    else if (mid.startsWith('R16-')) r16Count++;
    else if (mid.startsWith('QF-')) qfCount++;
    else if (mid.startsWith('SF-')) sfCount++;
    else if (mid === 'FINAL') finalCount++;
  }

  // ── Validación: Bracket completo ──
  const faltantes = [];
  if (r32Count < 16) faltantes.push(`Dieciseisavos: ${r32Count}/16`);
  if (r16Count < 8) faltantes.push(`Octavos: ${r16Count}/8`);
  if (qfCount < 4) faltantes.push(`Cuartos: ${qfCount}/4`);
  if (sfCount < 2) faltantes.push(`Semis: ${sfCount}/2`);
  if (finalCount < 1) faltantes.push(`Final: sin campeón`);
  if (faltantes.length > 0) {
    showMsg(msgDiv, `⚠️ Bracket incompleto — ${faltantes.join(', ')}`, 'err');
    return;
  }

  // ── Construir payload ──
  const grupos = {};
  GROUPS.forEach(g => { grupos[g] = grupoSelections[g] || []; });

  const terceros = thirdsGroups.map(g => {
    const sel = grupoSelections[g];
    return sel && sel[2] ? sel[2] : (gruposData[g] || [])[2] || `3°${g}`;
  });

  const dieciseisavos = [], octavos = [], cuartos = [], semis = [], final_ = [], campeon = [];
  for (const [mid, w] of Object.entries(matchResults)) {
    const name = resolve(w);
    if (mid.startsWith('R32-')) dieciseisavos.push(name);
    else if (mid.startsWith('R16-')) octavos.push(name);
    else if (mid.startsWith('QF-')) cuartos.push(name);
    else if (mid.startsWith('SF-')) semis.push(name);
    else if (mid === 'FINAL') { final_.push(name); campeon.push(name); }
  }
  if (bracketData && bracketData.final.teamA && bracketData.final.teamB) {
    const fA = resolve(bracketData.final.teamA);
    const fB = resolve(bracketData.final.teamB);
    if (fA && !final_.includes(fA)) final_.push(fA);
    if (fB && !final_.includes(fB)) final_.push(fB);
  }

  // Save 3rd place winner too
  let tercero_puesto = null;
  if (matchResults['3RD']) {
    tercero_puesto = resolve(matchResults['3RD']);
  }

  const payload = {
    usuario: currentUser,
    grupos, terceros, terceros_grupos: thirdsGroups,
    dieciseisavos, octavos, cuartos, semis,
    final: final_, campeon, tercero_puesto
  };

  try {
    const res = await fetch(API + '/api/predicciones', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.detail || 'Error');
    showMsg(msgDiv, '✅ ' + data.mensaje, 'ok');
  } catch (e) {
    showMsg(msgDiv, '❌ ' + e.message, 'err');
  }
}

function showMsg(el, text, cls) {
  el.textContent = text;
  el.className = 'save-msg ' + cls;
  el.style.display = 'block';
  setTimeout(() => { el.style.display = 'none'; }, 4000);
}

// ─── RANKING ───────────────────────────────────────────────────────────────
async function loadRanking() {
  const container = document.getElementById('ranking-table');
  container.innerHTML = '<p style="color:var(--text2)">Cargando...</p>';
  try {
    const res = await fetch(API + '/api/ranking');
    const data = await res.json();
    if (data.length === 0) {
      container.innerHTML = '<div class="empty-ranking">No hay predicciones aún. ¡Sé el primero!</div>';
      return;
    }
    const medals = ['🥇', '🥈', '🥉'];
    let html = `<table class="ranking-tbl"><thead><tr><th>Pos</th><th>Usuario</th><th>Puntos</th></tr></thead><tbody>`;
    data.forEach((u, i) => {
      const medal = i < 3 ? `<span class="medal">${medals[i]}</span>` : '';
      const isMe = u.usuario === currentUser ? ' style="background:rgba(245,158,11,.08)"' : '';
      html += `<tr${isMe}><td class="pos">${medal}${i + 1}</td><td><b class="ranking-user" data-user="${u.usuario}" style="cursor:pointer;text-decoration:underline dotted;text-underline-offset:3px">${u.usuario}</b></td><td class="puntos">${u.puntos}</td></tr>`;
    });
    html += '</tbody></table>';
    container.innerHTML = html;

    // Click handler: view user prediction
    container.querySelectorAll('.ranking-user').forEach(el => {
      el.addEventListener('click', () => showUserPrediction(el.dataset.user));
    });
  } catch (e) {
    container.innerHTML = '<div class="empty-ranking">Error cargando ranking</div>';
  }
}

// ─── RESULTADOS EN VIVO ────────────────────────────────────────────────────
const STATUS_LABELS = {
  'SCHEDULED': 'Programado', 'TIMED': 'Programado',
  'IN_PLAY': '🔴 EN VIVO', 'PAUSED': '⏸ Entretiempo',
  'FINISHED': 'Finalizado', 'POSTPONED': 'Pospuesto',
  'CANCELLED': 'Cancelado', 'SUSPENDED': 'Suspendido',
};
const STAGE_LABELS = {
  'GROUP_STAGE': 'Fase de Grupos',
  'LAST_32': 'Dieciseisavos de Final',
  'LAST_16': 'Octavos de Final',
  'QUARTER_FINALS': 'Cuartos de Final',
  'SEMI_FINALS': 'Semifinales',
  'THIRD_PLACE': 'Tercer Puesto',
  'FINAL': 'Final',
};

async function loadResultados(forceRefresh = false) {
  const container = document.getElementById('results-container');
  const statusEl = document.getElementById('results-status');
  container.innerHTML = '<p style="color:var(--text2);text-align:center;padding:20px">Cargando partidos...</p>';

  try {
    const url = API + '/api/partidos' + (forceRefresh ? '?force_refresh=true' : '');
    const res = await fetch(url);
    const data = await res.json();
    const partidos = data.partidos || [];

    if (partidos.length === 0) {
      container.innerHTML = '<div class="glass-card" style="text-align:center"><p style="color:var(--text2)">No hay partidos disponibles aún.</p></div>';
      statusEl.textContent = data.message || 'Sin datos';
      return;
    }

    // Count stats
    const finished = partidos.filter(m => m.status === 'FINISHED').length;
    const live = partidos.filter(m => m.status === 'IN_PLAY' || m.status === 'PAUSED').length;
    statusEl.textContent = `${partidos.length} partidos · ${finished} finalizados` + (live > 0 ? ` · ${live} en vivo 🔴` : '') + (data.cached ? ' (caché)' : '');

    let html = '';

    if (resultsViewMode === 'dates') {
      // Group by date
      const byDate = {};
      partidos.forEach(m => {
        const d = new Date(m.date);
        // Format to YYYY-MM-DD for grouping
        const dateStr = isNaN(d.getTime()) ? 'Fecha por definir' : d.toLocaleDateString('es-ES', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });
        const sortKey = isNaN(d.getTime()) ? '9999-99-99' : d.toISOString().split('T')[0];
        
        if (!byDate[sortKey]) byDate[sortKey] = { label: dateStr, matches: [] };
        byDate[sortKey].matches.push(m);
      });

      const sortedDates = Object.keys(byDate).sort();
      sortedDates.forEach(dKey => {
        html += `<div class="results-stage-title" style="text-transform: capitalize;">${byDate[dKey].label}</div>`;
        html += `<div class="match-cards">`;
        byDate[dKey].matches.sort((a, b) => new Date(a.date) - new Date(b.date)).forEach(m => {
          html += renderMatchCard(m);
        });
        html += `</div>`;
      });
    } else {
      // Group by stage, then by group (Original logic)
      const stages = {};
      partidos.forEach(m => {
        const stage = m.stage || 'OTHER';
        if (!stages[stage]) stages[stage] = [];
        stages[stage].push(m);
      });

      // Render group stage first, organized by groups
      if (stages['GROUP_STAGE']) {
        html += `<div class="results-stage-title">${STAGE_LABELS['GROUP_STAGE'] || 'Fase de Grupos'}</div>`;
        const byGroup = {};
        stages['GROUP_STAGE'].forEach(m => {
          const g = m.group || '?';
          if (!byGroup[g]) byGroup[g] = [];
          byGroup[g].push(m);
        });
        const sortedGroups = Object.keys(byGroup).sort();
        sortedGroups.forEach(g => {
          html += `<div class="results-group">`;
          html += `<div class="results-group-title">Grupo ${g}</div>`;
          html += `<div class="match-cards">`;
          byGroup[g].sort((a, b) => new Date(a.date) - new Date(b.date)).forEach(m => {
            html += renderMatchCard(m);
          });
          html += `</div></div>`;
        });
        delete stages['GROUP_STAGE'];
      }

      // Render knockout stages in order
      const koOrder = ['LAST_32', 'LAST_16', 'QUARTER_FINALS', 'SEMI_FINALS', 'THIRD_PLACE', 'FINAL'];
      koOrder.forEach(stage => {
        if (!stages[stage]) return;
        html += `<div class="results-stage-title">${STAGE_LABELS[stage] || stage}</div>`;
        html += `<div class="match-cards">`;
        stages[stage].sort((a, b) => new Date(a.date) - new Date(b.date)).forEach(m => {
          html += renderMatchCard(m);
        });
        html += `</div>`;
        delete stages[stage];
      });
    }

    container.innerHTML = html;
  } catch (e) {
    container.innerHTML = '<div class="glass-card" style="text-align:center"><p style="color:var(--red)">Error cargando resultados</p></div>';
    statusEl.textContent = 'Error de conexión';
  }
}

function renderMatchCard(m) {
  const isLive = m.status === 'IN_PLAY' || m.status === 'PAUSED';
  const isFinished = m.status === 'FINISHED';
  const statusLabel = STATUS_LABELS[m.status] || m.status;
  const statusClass = isLive ? 'live' : isFinished ? 'finished' : 'scheduled';
  const cardClass = isLive ? 'is-live' : isFinished ? 'is-finished' : '';

  const hasScore = m.homeScore !== null && m.awayScore !== null;
  const scoreHtml = hasScore
    ? `<span>${m.homeScore}</span><span class="dash">-</span><span>${m.awayScore}</span>`
    : `<span class="dash">vs</span>`;

  const dateStr = m.date ? formatMatchDate(m.date) : '';

  return `<div class="match-card ${cardClass}">
    <div class="mc-team home">${m.home || '?'}</div>
    <div style="text-align:center">
      <div class="mc-score ${statusClass}">${scoreHtml}</div>
      <div class="mc-status ${statusClass}">${statusLabel}</div>
      ${dateStr ? `<div class="mc-date">${dateStr}</div>` : ''}
    </div>
    <div class="mc-team away">${m.away || '?'}</div>
  </div>`;
}

function formatMatchDate(isoStr) {
  try {
    const d = new Date(isoStr);
    return d.toLocaleDateString('es', { day: 'numeric', month: 'short' }) + ' ' +
      d.toLocaleTimeString('es', { hour: '2-digit', minute: '2-digit' });
  } catch (e) { return ''; }
}

// ─── VIEW USER PREDICTION (Modal) ──────────────────────────────────────────
async function showUserPrediction(usuario) {
  // Remove existing modal
  const existing = document.getElementById('prediction-modal');
  if (existing) existing.remove();

  const modal = document.createElement('div');
  modal.id = 'prediction-modal';
  modal.className = 'prediction-modal-overlay';
  modal.innerHTML = `<div class="prediction-modal-card">
    <div class="pm-header">
      <h2>📋 Predicción de <span class="accent">${usuario}</span></h2>
      <button class="btn btn-outline btn-sm pm-close">✕ Cerrar</button>
    </div>
    <div class="pm-body"><p style="color:var(--text2)">Cargando...</p></div>
  </div>`;
  document.body.appendChild(modal);
  modal.querySelector('.pm-close').addEventListener('click', () => modal.remove());
  modal.addEventListener('click', (e) => { if (e.target === modal) modal.remove(); });

  try {
    const res = await fetch(API + '/api/prediccion/' + encodeURIComponent(usuario));
    if (!res.ok) throw new Error('No encontrada');
    const data = await res.json();
    const body = modal.querySelector('.pm-body');

    let html = '';

    // Groups
    html += '<h3>⚽ Fase de Grupos</h3><div class="pm-groups">';
    GROUPS.forEach(g => {
      const teams = data.grupos[g] || [];
      html += `<div class="pm-group"><div class="pm-group-title">Grupo ${g}</div>`;
      teams.forEach((t, i) => {
        const badge = i < 3 ? ['1°', '2°', '3°'][i] : '';
        html += `<div class="pm-team"><span class="pm-badge">${badge}</span> ${t}</div>`;
      });
      html += '</div>';
    });
    html += '</div>';

    // Thirds
    html += '<h3>🎯 Mejores Terceros</h3><div class="pm-thirds">';
    (data.terceros || []).forEach(t => {
      html += `<span class="pm-third-tag">${t}</span>`;
    });
    html += '</div>';

    // Bracket phases
    const phases = [
      ['dieciseisavos', '16avos'],
      ['octavos', 'Octavos'],
      ['cuartos', 'Cuartos'],
      ['semis', 'Semis'],
      ['final', 'Final'],
      ['campeon', '🏆 Campeón'],
    ];
    html += '<h3>🏟️ Fase Eliminatoria</h3>';
    phases.forEach(([key, label]) => {
      const items = data[key] || [];
      if (items.length === 0) return;
      const isCampeon = key === 'campeon';
      html += `<div class="pm-phase"><span class="pm-phase-label">${label}:</span> `;
      html += items.map(t => `<span class="pm-team-tag${isCampeon ? ' campeon' : ''}">${t}</span>`).join(' ');
      html += '</div>';
    });

    body.innerHTML = html;
  } catch (e) {
    modal.querySelector('.pm-body').innerHTML = '<p style="color:var(--red)">No se pudo cargar la predicción</p>';
  }
}
