const express = require('express');
const cors = require('cors');
const fs = require('fs');
const path = require('path');

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'frontend')));

const DB_FILE = path.join(__dirname, 'db.json');

// Initial Data Structure
const INITIAL_DB = {
  activeMatchId: 1,
  matches: [
    { id: 1, teamA: 'Ecuador', teamB: 'Costa de Marfil', date: '2026-06-14', scoreA: null, scoreB: null, finished: false },
    { id: 2, teamA: 'Curazao', teamB: 'Ecuador', date: '2026-06-19', scoreA: null, scoreB: null, finished: false },
    { id: 3, teamA: 'Alemania', teamB: 'Ecuador', date: '2026-06-24', scoreA: null, scoreB: null, finished: false }
  ],
  predictions: []
  // prediction format: { user: '...', matchId: 1, scoreA: 2, scoreB: 1 }
};

// Load or create DB
let db;
try {
  if (fs.existsSync(DB_FILE)) {
    db = JSON.parse(fs.readFileSync(DB_FILE, 'utf8'));
  } else {
    db = INITIAL_DB;
    fs.writeFileSync(DB_FILE, JSON.stringify(db, null, 2));
  }
} catch (e) {
  console.error("Error loading DB", e);
  db = INITIAL_DB;
}

function saveDB() {
  fs.writeFileSync(DB_FILE, JSON.stringify(db, null, 2));
}

// ── ENDPOINTS ─────────────────────────────────────────────────────────────

app.get('/api/state', (req, res) => {
  res.json({
    activeMatchId: db.activeMatchId,
    matches: db.matches
  });
});

app.post('/api/prediccion', (req, res) => {
  const { user, matchId, scoreA, scoreB } = req.body;
  
  if (!user || !user.trim()) return res.status(400).json({ detail: 'Nombre de usuario requerido' });
  if (matchId !== db.activeMatchId) return res.status(400).json({ detail: 'No se puede predecir este partido' });
  if (typeof scoreA !== 'number' || typeof scoreB !== 'number') return res.status(400).json({ detail: 'Marcador inválido' });

  const activeMatch = db.matches.find(m => m.id === db.activeMatchId);
  if (activeMatch.finished) {
    return res.status(403).json({ detail: 'El partido ya terminó' });
  }

  // Find existing prediction for this user and match
  let pred = db.predictions.find(p => p.user === user.trim() && p.matchId === matchId);
  if (pred) {
    pred.scoreA = scoreA;
    pred.scoreB = scoreB;
  } else {
    db.predictions.push({ user: user.trim(), matchId, scoreA, scoreB });
  }
  
  saveDB();
  res.json({ mensaje: 'Predicción guardada exitosamente' });
});

app.get('/api/prediccion/:user/:matchId', (req, res) => {
  const pred = db.predictions.find(p => p.user === req.params.user && p.matchId === parseInt(req.params.matchId));
  if (pred) res.json(pred);
  else res.status(404).json({ detail: 'No encontrada' });
});

app.get('/api/ranking', (req, res) => {
  // Calculate correct predictions per user
  const scores = {};
  
  // Initialize users
  db.predictions.forEach(p => {
    if (!scores[p.user]) scores[p.user] = { user: p.user, aciertos: 0, fallos: 0, exactos: 0 };
  });

  // Check finished matches
  db.matches.forEach(m => {
    if (!m.finished) return;
    
    // For each prediction of this match
    db.predictions.filter(p => p.matchId === m.id).forEach(p => {
      // Hit exact score
      if (p.scoreA === m.scoreA && p.scoreB === m.scoreB) {
        scores[p.user].exactos += 1;
        scores[p.user].aciertos += 1; // Un exacto es un acierto
      } else {
        scores[p.user].fallos += 1;
      }
    });
  });

  const ranking = Object.values(scores).sort((a, b) => b.exactos - a.exactos);
  res.json(ranking);
});

// ── ADMIN ─────────────────────────────────────────────────────────────────
app.post('/api/admin/match', (req, res) => {
  const { matchId, scoreA, scoreB, finished, nextMatchId } = req.body;
  
  const match = db.matches.find(m => m.id === matchId);
  if (match) {
    if (scoreA !== undefined) match.scoreA = scoreA;
    if (scoreB !== undefined) match.scoreB = scoreB;
    if (finished !== undefined) match.finished = finished;
  }
  
  if (nextMatchId) {
    db.activeMatchId = nextMatchId;
  }
  
  saveDB();
  res.json({ mensaje: 'Administración actualizada', state: { activeMatchId: db.activeMatchId, match } });
});

const PORT = 8001;
app.listen(PORT, () => console.log(`Ecuador App running on port ${PORT}`));
