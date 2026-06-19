/**
 * FIFA World Cup 2026 — Simulador de Predicciones
 * Backend Node.js/Express: Fase de grupos, Fase eliminatoria (R32→Final),
 * Sistema de puntos, Ranking, y Resultados en vivo.
 */

const express = require('express');
const cors = require('cors');
const fs = require('fs');
const path = require('path');
const http = require('https');

const app = express();
const PORT = 8000;

app.use(cors());
app.use(express.json());

// ── Paths ──────────────────────────────────────────────────────────────────
const BASE_DIR = __dirname;
const FRONTEND_DIR = path.join(BASE_DIR, 'frontend');
const DB_FILE = path.join(BASE_DIR, 'predicciones.json');
const RESULTS_FILE = path.join(BASE_DIR, 'resultados_reales.json');
const MATCHES_CACHE_FILE = path.join(BASE_DIR, 'matches_cache.json');

// ── Football-Data.org API ──────────────────────────────────────────────────
const FOOTBALL_DATA_TOKEN = process.env.FOOTBALL_DATA_TOKEN || '14a16d2acccf454d92732e759cb795bd';
const FOOTBALL_DATA_BASE = 'https://api.football-data.org/v4';
const WC_CODE = 'WC';
const WC_SEASON = 2026;

// ── Grupos oficiales ───────────────────────────────────────────────────────
const GRUPOS_MUNDIAL = {
  A: ['Corea del Sur', 'México', 'Sudáfrica', 'Chequia'],
  B: ['Canadá', 'Catar', 'Suiza', 'Bosnia y Herzegovina'],
  C: ['Brasil', 'Escocia', 'Haití', 'Marruecos'],
  D: ['Australia', 'Estados Unidos', 'Paraguay', 'Turquía'],
  E: ['Alemania', 'Costa de Marfil', 'Curazao', 'Ecuador'],
  F: ['Japón', 'Países Bajos', 'Suecia', 'Túnez'],
  G: ['Bélgica', 'Irán', 'Egipto', 'Nueva Zelanda'],
  H: ['Arabia Saudita', 'España', 'Cabo Verde', 'Uruguay'],
  I: ['Francia', 'Senegal', 'Noruega', 'Irak'],
  J: ['Argelia', 'Argentina', 'Jordania', 'Austria'],
  K: ['Portugal', 'Colombia', 'Uzbekistán', 'RD Congo'],
  L: ['Inglaterra', 'Panamá', 'Croacia', 'Ghana'],
};
const VALID_GROUPS = 'ABCDEFGHIJKL'.split('');
const ALL_TEAMS = Object.values(GRUPOS_MUNDIAL).flat().sort();

// ── Team name mapping (EN → ES) ───────────────────────────────────────────
const TEAM_NAME_MAP = {
  'South Korea': 'Corea del Sur', 'Korea Republic': 'Corea del Sur',
  'Mexico': 'México', 'South Africa': 'Sudáfrica',
  'Czech Republic': 'Chequia', 'Czechia': 'Chequia',
  'Canada': 'Canadá', 'Qatar': 'Catar',
  'Switzerland': 'Suiza', 'Bosnia and Herzegovina': 'Bosnia y Herzegovina',
  'Brazil': 'Brasil', 'Scotland': 'Escocia',
  'Haiti': 'Haití', 'Morocco': 'Marruecos',
  'Australia': 'Australia', 'United States': 'Estados Unidos', 'USA': 'Estados Unidos',
  'Paraguay': 'Paraguay', 'Turkey': 'Turquía', 'Türkiye': 'Turquía',
  'Germany': 'Alemania', 'Ivory Coast': 'Costa de Marfil', "Côte d'Ivoire": 'Costa de Marfil',
  'Curaçao': 'Curazao', 'Curacao': 'Curazao', 'Ecuador': 'Ecuador',
  'Japan': 'Japón', 'Netherlands': 'Países Bajos',
  'Sweden': 'Suecia', 'Tunisia': 'Túnez',
  'Belgium': 'Bélgica', 'Iran': 'Irán',
  'Egypt': 'Egipto', 'New Zealand': 'Nueva Zelanda',
  'Saudi Arabia': 'Arabia Saudita', 'Spain': 'España',
  'Cape Verde': 'Cabo Verde', 'Uruguay': 'Uruguay',
  'France': 'Francia', 'Senegal': 'Senegal',
  'Norway': 'Noruega', 'Iraq': 'Irak',
  'Algeria': 'Argelia', 'Argentina': 'Argentina',
  'Jordan': 'Jordania', 'Austria': 'Austria',
  'Portugal': 'Portugal', 'Colombia': 'Colombia',
  'Uzbekistan': 'Uzbekistán', 'DR Congo': 'RD Congo', 'Congo DR': 'RD Congo',
  'England': 'Inglaterra', 'Panama': 'Panamá',
  'Croatia': 'Croacia', 'Ghana': 'Ghana',
};

function translateTeam(name) {
  if (!name) return name;
  return TEAM_NAME_MAP[name] || name;
}

// ── DB helpers ─────────────────────────────────────────────────────────────
function cargarDB() {
  try {
    if (fs.existsSync(DB_FILE)) return JSON.parse(fs.readFileSync(DB_FILE, 'utf-8'));
  } catch (e) { console.error('Error cargando DB:', e.message); }
  return [];
}

function guardarDB(datos) {
  fs.writeFileSync(DB_FILE, JSON.stringify(datos, null, 2), 'utf-8');
}

function cargarResultados() {
  try {
    if (fs.existsSync(RESULTS_FILE)) return JSON.parse(fs.readFileSync(RESULTS_FILE, 'utf-8'));
  } catch (e) { console.error('Error cargando resultados:', e.message); }
  const r = { grupos: {}, terceros: [], dieciseisavos: [], octavos: [], cuartos: [], semis: [], final: [], campeon: [] };
  VALID_GROUPS.forEach(g => r.grupos[g] = []);
  return r;
}

let prediccionesDB = cargarDB();
let resultadosReales = cargarResultados();

// ── Annex C — Third-place pairing ─────────────────────────────────────────
const LEADER_POSSIBLE_THIRDS = {
  E: new Set(['A', 'B', 'C', 'D', 'F']),
  I: new Set(['C', 'D', 'F', 'G', 'H']),
  A: new Set(['C', 'E', 'F', 'H', 'I']),
  L: new Set(['E', 'H', 'I', 'J', 'K']),
  G: new Set(['A', 'E', 'H', 'I', 'J']),
  D: new Set(['B', 'E', 'F', 'I', 'J']),
  B: new Set(['E', 'F', 'G', 'I', 'J']),
  K: new Set(['D', 'E', 'I', 'J', 'L']),
};

function assignThirdsToLeaders(bestThirdsGroups) {
  const thirdsSet = new Set(bestThirdsGroups);
  const leaders = Object.keys(LEADER_POSSIBLE_THIRDS);
  const domains = {};
  for (const leader of leaders) {
    const possible = [...LEADER_POSSIBLE_THIRDS[leader]].filter(g => thirdsSet.has(g) && g !== leader);
    domains[leader] = possible.sort();
  }

  const assignment = {};
  const used = new Set();

  function solve(idx) {
    if (idx === leaders.length) return true;
    // MRV heuristic
    const remaining = leaders
      .filter(l => !(l in assignment))
      .map(l => [domains[l].filter(v => !used.has(v)).length, l])
      .sort((a, b) => a[0] - b[0]);
    const leader = remaining[0][1];
    for (const third of domains[leader]) {
      if (!used.has(third)) {
        assignment[leader] = third;
        used.add(third);
        if (solve(idx + 1)) return true;
        delete assignment[leader];
        used.delete(third);
      }
    }
    return false;
  }

  if (!solve(0)) throw new Error('No se puede asignar terceros con esa combinación');
  return assignment;
}

// ── Bracket builder ────────────────────────────────────────────────────────
function buildBracket(leaders, runnersUp, bestThirds) {
  const leaderMap = {};
  leaders.forEach(item => leaderMap[item.slice(-1).toUpperCase()] = item);
  const runnerMap = {};
  runnersUp.forEach(item => runnerMap[item.slice(-1).toUpperCase()] = item);
  const thirdMap = {};
  bestThirds.forEach(g => thirdMap[g] = `3${g}`);
  const ta = assignThirdsToLeaders(bestThirds);

  const m = (a, b, mid) => ({ id: mid, teamA: a, teamB: b, winner: null });
  const emp = mid => ({ id: mid, teamA: null, teamB: null, winner: null });

  const r32 = [
    m(leaderMap['E'], thirdMap[ta['E']], 'R32-1'),
    m(runnerMap['A'], runnerMap['B'], 'R32-2'),
    m(leaderMap['A'], thirdMap[ta['A']], 'R32-3'),
    m(leaderMap['C'], runnerMap['F'], 'R32-4'),
    m(leaderMap['G'], thirdMap[ta['G']], 'R32-5'),
    m(runnerMap['D'], runnerMap['G'], 'R32-6'),
    m(leaderMap['L'], thirdMap[ta['L']], 'R32-7'),
    m(leaderMap['H'], runnerMap['J'], 'R32-8'),
    m(leaderMap['I'], thirdMap[ta['I']], 'R32-9'),
    m(runnerMap['E'], runnerMap['I'], 'R32-10'),
    m(leaderMap['D'], thirdMap[ta['D']], 'R32-11'),
    m(leaderMap['F'], runnerMap['C'], 'R32-12'),
    m(leaderMap['B'], thirdMap[ta['B']], 'R32-13'),
    m(runnerMap['K'], runnerMap['L'], 'R32-14'),
    m(leaderMap['K'], thirdMap[ta['K']], 'R32-15'),
    m(leaderMap['J'], runnerMap['H'], 'R32-16'),
  ];

  const r16 = Array.from({ length: 8 }, (_, i) => emp(`R16-${i + 1}`));
  const qf = Array.from({ length: 4 }, (_, i) => emp(`QF-${i + 1}`));
  const sf = Array.from({ length: 2 }, (_, i) => emp(`SF-${i + 1}`));

  const feeder = {
    'R16-1': ['R32-1', 'R32-2'], 'R16-2': ['R32-3', 'R32-4'],
    'R16-3': ['R32-5', 'R32-6'], 'R16-4': ['R32-7', 'R32-8'],
    'R16-5': ['R32-9', 'R32-10'], 'R16-6': ['R32-11', 'R32-12'],
    'R16-7': ['R32-13', 'R32-14'], 'R16-8': ['R32-15', 'R32-16'],
    'QF-1': ['R16-1', 'R16-2'], 'QF-2': ['R16-3', 'R16-4'],
    'QF-3': ['R16-5', 'R16-6'], 'QF-4': ['R16-7', 'R16-8'],
    'SF-1': ['QF-1', 'QF-2'], 'SF-2': ['QF-3', 'QF-4'],
    'FINAL': ['SF-1', 'SF-2'], '3RD': ['SF-1', 'SF-2'],
  };

  return {
    r32, r16, qf, sf,
    final: emp('FINAL'),
    third_place: emp('3RD'),
    feeder,
    thirds_assignment: Object.fromEntries(Object.entries(ta).map(([k, v]) => [k, `3${v}`])),
  };
}

// ── Admin key ──────────────────────────────────────────────────────────────
const ADMIN_KEY = process.env.ADMIN_KEY || 'mundial2026admin';

// ── Deadline: Jueves 11 de Junio 2026, 12:00 PM (UTC-5) = 17:00 UTC ───────
const PREDICTIONS_DEADLINE = new Date('2026-06-11T17:00:00Z');

function isPastDeadline() {
  return new Date() >= PREDICTIONS_DEADLINE;
}

// ══════════════════════════════════════════════════════════════════════════
// ENDPOINTS
// ══════════════════════════════════════════════════════════════════════════

// Serve frontend
app.get('/', (req, res) => res.sendFile(path.join(FRONTEND_DIR, 'index.html')));

app.get('/api/equipos', (req, res) => res.json(ALL_TEAMS));

app.get('/api/grupos', (req, res) => res.json(GRUPOS_MUNDIAL));

// ── Deadline status ────────────────────────────────────────────────────────
app.get('/api/deadline', (req, res) => {
  res.json({
    deadline: PREDICTIONS_DEADLINE.toISOString(),
    closed: isPastDeadline(),
    message: isPastDeadline() ? 'Las predicciones están cerradas' : 'Las predicciones siguen abiertas',
  });
});

// ── Bracket ────────────────────────────────────────────────────────────────
app.post('/api/bracket', (req, res) => {
  const { leaders, runners_up, best_thirds } = req.body;
  if (!leaders || leaders.length !== 12) return res.status(400).json({ detail: '12 líderes requeridos' });
  if (!runners_up || runners_up.length !== 12) return res.status(400).json({ detail: '12 segundos requeridos' });
  if (!best_thirds || best_thirds.length !== 8) return res.status(400).json({ detail: '8 mejores terceros requeridos' });
  try {
    const bt = best_thirds.map(g => g.toUpperCase());
    const result = buildBracket(leaders, runners_up, bt);
    res.json(result);
  } catch (e) {
    res.status(400).json({ detail: e.message });
  }
});

// ── Save prediction ────────────────────────────────────────────────────────
app.post('/api/predicciones', (req, res) => {
  const pred = req.body;
  if (!pred.usuario || !pred.usuario.trim()) return res.status(400).json({ detail: 'El usuario no puede estar vacío' });
  pred.usuario = pred.usuario.trim().slice(0, 50);

  const existing = prediccionesDB.find(p => p.usuario === pred.usuario);

  // Deadline check: no new predictions after deadline
  if (isPastDeadline() && !existing) {
    return res.status(403).json({ detail: 'Las predicciones están cerradas. No se pueden crear nuevas predicciones.' });
  }

  // If user already saved, they are locked — reject any update
  if (existing) {
    return res.status(403).json({ detail: 'Tu predicción ya fue guardada y está bloqueada. No se puede modificar.' });
  }

  // Validate groups
  for (const g of VALID_GROUPS) {
    const equipos = (pred.grupos && pred.grupos[g]) || [];
    if (equipos.length < 2) return res.status(400).json({ detail: `Grupo ${g}: debe tener al menos 1° y 2° lugar` });
    for (const eq of equipos) {
      if (!GRUPOS_MUNDIAL[g].includes(eq)) return res.status(400).json({ detail: `'${eq}' no pertenece al Grupo ${g}` });
    }
  }

  // Validate thirds
  if (!pred.terceros || pred.terceros.length !== 8) return res.status(400).json({ detail: `Debe tener exactamente 8 mejores terceros` });

  // Validate bracket complete
  const fases = [
    ['dieciseisavos', 16, 'Dieciseisavos (16 ganadores)'],
    ['octavos', 8, 'Octavos (8 ganadores)'],
    ['cuartos', 4, 'Cuartos (4 ganadores)'],
    ['semis', 2, 'Semifinales (2 ganadores)'],
    ['final', 2, 'Finalistas (2 equipos)'],
    ['campeon', 1, 'Campeón (1 equipo)'],
  ];
  for (const [campo, cant, nombre] of fases) {
    const actual = (pred[campo] || []).length;
    if (actual < cant) return res.status(400).json({ detail: `Bracket incompleto: ${nombre} — tienes ${actual}, necesitas ${cant}` });
  }

  // Save (new prediction)
  prediccionesDB.push(pred);
  guardarDB(prediccionesDB);
  res.json({ mensaje: 'Predicción guardada exitosamente. ¡Está bloqueada y no se puede cambiar!' });
});

// ── Get user prediction ────────────────────────────────────────────────────
app.get('/api/prediccion/:usuario', (req, res) => {
  const p = prediccionesDB.find(p => p.usuario === req.params.usuario);
  if (!p) return res.status(404).json({ detail: 'Predicción no encontrada' });
  res.json(p);
});

// ── Ranking ────────────────────────────────────────────────────────────────
app.get('/api/ranking', (req, res) => {
  const ranking = prediccionesDB.map(p => {
    let pts = 0;

    // Group positions (1 pt each)
    for (const [letra, ordenReal] of Object.entries(resultadosReales.grupos)) {
      if (ordenReal.length >= 2) {
        const ordenU = (p.grupos && p.grupos[letra]) || [];
        for (let i = 0; i < Math.min(ordenReal.length, ordenU.length); i++) {
          if (ordenU[i] === ordenReal[i]) pts += 1;
        }
      }
    }

    // Thirds (1 pt each)
    if (resultadosReales.terceros && resultadosReales.terceros.length) {
      const tercU = new Set(p.terceros || []);
      const tercR = new Set(resultadosReales.terceros);
      for (const t of tercU) { if (tercR.has(t)) pts += 1; }
    }

    // Knockout phases (progressive multiplier)
    const fasesM = [['dieciseisavos', 1], ['octavos', 2], ['cuartos', 3], ['final', 5], ['campeon', 10]];
    for (const [fase, mult] of fasesM) {
      const reales = resultadosReales[fase] || [];
      if (reales.length) {
        const pSet = new Set(p[fase] || []);
        const rSet = new Set(reales);
        for (const v of pSet) { if (rSet.has(v)) pts += mult; }
      }
    }

    return { usuario: p.usuario, puntos: pts };
  });

  ranking.sort((a, b) => b.puntos - a.puntos);
  res.json(ranking);
});

// ── Results ────────────────────────────────────────────────────────────────
app.get('/api/resultados', (req, res) => res.json(resultadosReales));

// ── Admin: update real results ─────────────────────────────────────────────
app.post('/api/admin/resultados', (req, res) => {
  const { admin_key, fase, datos, lista } = req.body;
  if (admin_key !== ADMIN_KEY) return res.status(403).json({ detail: 'Clave de administrador incorrecta' });

  const fasesValidas = ['grupos', 'terceros', 'dieciseisavos', 'octavos', 'cuartos', 'semis', 'final', 'campeon'];
  if (!fasesValidas.includes(fase)) return res.status(400).json({ detail: `Fase inválida. Opciones: ${fasesValidas}` });

  if (fase === 'grupos') {
    for (const [g, equipos] of Object.entries(datos || {})) {
      if (g in resultadosReales.grupos) resultadosReales.grupos[g] = equipos;
    }
  } else {
    resultadosReales[fase] = lista || [];
  }

  fs.writeFileSync(RESULTS_FILE, JSON.stringify(resultadosReales, null, 2), 'utf-8');
  res.json({ mensaje: `Resultados de '${fase}' actualizados`, resultados: resultadosReales });
});

// ── Football-Data.org: live matches ────────────────────────────────────────
let matchesCache = { data: [], lastFetch: null };

function fetchFromAPI(urlPath) {
  return new Promise((resolve, reject) => {
    if (!FOOTBALL_DATA_TOKEN) return resolve(null);
    const url = new URL(`${FOOTBALL_DATA_BASE}${urlPath}`);
    const options = {
      hostname: url.hostname, path: url.pathname + url.search,
      headers: { 'X-Auth-Token': FOOTBALL_DATA_TOKEN },
      timeout: 15000,
    };
    const req = http.get(options, resp => {
      let data = '';
      resp.on('data', chunk => data += chunk);
      resp.on('end', () => {
        if (resp.statusCode !== 200) {
          console.log(`[API] Error ${resp.statusCode}: ${data.slice(0, 200)}`);
          return resolve(null);
        }
        try { resolve(JSON.parse(data)); } catch (e) { resolve(null); }
      });
    });
    req.on('error', e => { console.log('[API] Error:', e.message); resolve(null); });
    req.on('timeout', () => { req.destroy(); resolve(null); });
  });
}

function parseMatch(m) {
  const homeEn = m.homeTeam?.name || '';
  const awayEn = m.awayTeam?.name || '';
  const ft = m.score?.fullTime || {};
  const ht = m.score?.halfTime || {};
  const group = (m.group || '').replace('GROUP_', '');
  return {
    id: m.id, home: translateTeam(homeEn), away: translateTeam(awayEn),
    homeScore: ft.home ?? null, awayScore: ft.away ?? null,
    htHome: ht.home ?? null, htAway: ht.away ?? null,
    status: m.status || 'SCHEDULED', stage: m.stage || 'GROUP_STAGE',
    group, matchday: m.matchday, date: m.utcDate || '',
    winner: m.score?.winner ? translateTeam(m.score.winner) : null,
  };
}

const STAGE_MAP = {
  GROUP_STAGE: 'grupos', LAST_32: 'dieciseisavos', LAST_16: 'octavos',
  QUARTER_FINALS: 'cuartos', SEMI_FINALS: 'semis',
  THIRD_PLACE: 'tercero', FINAL: 'final',
};

function autoSyncResults(parsed) {
  // Group standings
  const groupPts = {};
  VALID_GROUPS.forEach(g => groupPts[g] = {});
  for (const m of parsed) {
    if (m.stage !== 'GROUP_STAGE' || m.status !== 'FINISHED') continue;
    if (!(m.group in groupPts)) continue;
    const g = m.group;
    if (!(m.home in groupPts[g])) groupPts[g][m.home] = 0;
    if (!(m.away in groupPts[g])) groupPts[g][m.away] = 0;
    if (m.homeScore != null && m.awayScore != null) {
      if (m.homeScore > m.awayScore) groupPts[g][m.home] += 3;
      else if (m.homeScore < m.awayScore) groupPts[g][m.away] += 3;
      else { groupPts[g][m.home] += 1; groupPts[g][m.away] += 1; }
    }
  }
  for (const g of VALID_GROUPS) {
    if (Object.keys(groupPts[g]).length > 0) {
      resultadosReales.grupos[g] = Object.entries(groupPts[g])
        .sort((a, b) => b[1] - a[1]).map(([t]) => t);
    }
  }

  // Knockout winners
  for (const m of parsed) {
    if (m.status !== 'FINISHED') continue;
    const stageKey = STAGE_MAP[m.stage];
    if (!stageKey || stageKey === 'grupos') continue;
    if (m.homeScore != null && m.awayScore != null) {
      const winner = m.homeScore > m.awayScore ? m.home : m.awayScore > m.homeScore ? m.away : null;
      if (!winner) continue;
      
      // Add winner to its stage
      if (!resultadosReales[stageKey]) resultadosReales[stageKey] = [];
      if (!resultadosReales[stageKey].includes(winner)) resultadosReales[stageKey].push(winner);

      // Special cases for Final and Semis
      if (stageKey === 'final') {
        resultadosReales.campeon = [winner];
      }
      // If a semi-final is finished, the winner is a finalist
      if (stageKey === 'semis') {
        if (!resultadosReales.final) resultadosReales.final = [];
        if (!resultadosReales.final.includes(winner)) resultadosReales.final.push(winner);
      }
    }
  }

  fs.writeFileSync(RESULTS_FILE, JSON.stringify(resultadosReales, null, 2), 'utf-8');
}

app.get('/api/partidos', async (req, res) => {
  const forceRefresh = req.query.force_refresh === 'true';
  const now = Date.now();

  // Cache 2 min
  if (!forceRefresh && matchesCache.data.length && matchesCache.lastFetch && (now - matchesCache.lastFetch) < 120000) {
    return res.json({ partidos: matchesCache.data, cached: true, api_configured: !!FOOTBALL_DATA_TOKEN });
  }

  if (!FOOTBALL_DATA_TOKEN) {
    if (fs.existsSync(MATCHES_CACHE_FILE)) {
      try {
        const cached = JSON.parse(fs.readFileSync(MATCHES_CACHE_FILE, 'utf-8'));
        return res.json({
          partidos: cached, cached: true, api_configured: false,
          message: 'Configura FOOTBALL_DATA_TOKEN para datos en vivo'
        });
      } catch (e) { }
    }
    return res.json({
      partidos: [], cached: false, api_configured: false,
      message: 'Configura FOOTBALL_DATA_TOKEN para datos en vivo. Regístrate gratis en football-data.org'
    });
  }

  const rawData = await fetchFromAPI(`/competitions/${WC_CODE}/matches?season=${WC_SEASON}`);
  if (!rawData) {
    if (matchesCache.data.length) return res.json({ partidos: matchesCache.data, cached: true, api_configured: true });
    return res.json({ partidos: [], error: 'Error al conectar con la API' });
  }

  const parsed = (rawData.matches || []).map(parseMatch);
  matchesCache = { data: parsed, lastFetch: now };
  fs.writeFileSync(MATCHES_CACHE_FILE, JSON.stringify(parsed, null, 2), 'utf-8');
  autoSyncResults(parsed);

  res.json({ partidos: parsed, cached: false, api_configured: true });
});

app.post('/api/sync', async (req, res) => {
  try {
    // Reuse the partidos endpoint logic
    const rawData = FOOTBALL_DATA_TOKEN
      ? await fetchFromAPI(`/competitions/${WC_CODE}/matches?season=${WC_SEASON}`)
      : null;
    if (rawData) {
      const parsed = (rawData.matches || []).map(parseMatch);
      matchesCache = { data: parsed, lastFetch: Date.now() };
      fs.writeFileSync(MATCHES_CACHE_FILE, JSON.stringify(parsed, null, 2), 'utf-8');
      autoSyncResults(parsed);
      return res.json({ mensaje: 'Resultados sincronizados', total_partidos: parsed.length });
    }
    res.json({ mensaje: 'No se pudo sincronizar — sin token o error API', total_partidos: 0 });
  } catch (e) {
    res.status(500).json({ detail: 'Error sincronizando: ' + e.message });
  }
});

// ── Static files (MUST be last) ────────────────────────────────────────────
app.use(express.static(FRONTEND_DIR));

// ── Start server ───────────────────────────────────────────────────────────
app.listen(PORT, () => {
  console.log(`\n  ⚽ Predicciones Mundial 2026`);
  console.log(`  🚀 Server running at http://localhost:${PORT}`);
  console.log(`  📊 API Token: ${FOOTBALL_DATA_TOKEN ? '✅ Configured' : '❌ Not set'}`);
  console.log(`  📁 DB: ${prediccionesDB.length} predictions loaded\n`);
});
