const API = 'http://localhost:8001';
let currentUser = null;
let appState = null;

const FLAG_MAP = {
  'Ecuador': '🇪🇨',
  'Costa de Marfil': '🇨🇮',
  'Curazao': '🇨🇼',
  'Alemania': '🇩🇪',
  'Países Bajos': '🇳🇱'
};

document.addEventListener('DOMContentLoaded', () => {
  const savedUser = localStorage.getItem('ecuador_user');
  if (savedUser) loginAs(savedUser);

  document.getElementById('btn-login').addEventListener('click', () => {
    const name = document.getElementById('login-name').value;
    if (name.trim()) loginAs(name);
  });

  document.getElementById('btn-logout').addEventListener('click', () => {
    localStorage.removeItem('ecuador_user');
    currentUser = null;
    document.getElementById('main-app').style.display = 'none';
    document.getElementById('login-screen').style.display = 'flex';
  });

  document.querySelectorAll('.nav-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.nav-btn').forEach(b => b.classList.remove('active'));
      document.querySelectorAll('.tab-content').forEach(t => t.classList.remove('active'));
      btn.classList.add('active');
      document.getElementById(`tab-${btn.dataset.tab}`).classList.add('active');
      
      if (btn.dataset.tab === 'ranking') loadRanking();
    });
  });

  document.getElementById('btn-save-score').addEventListener('click', savePrediction);
});

async function loginAs(name) {
  currentUser = name.trim();
  localStorage.setItem('ecuador_user', currentUser);
  document.getElementById('login-screen').style.display = 'none';
  document.getElementById('main-app').style.display = 'block';
  document.getElementById('user-badge').textContent = `👤 ${currentUser}`;
  
  await loadState();
}

async function loadState() {
  try {
    const res = await fetch(`${API}/api/state`);
    appState = await res.json();
    renderActiveMatch();
    renderPastMatches();
  } catch (e) {
    console.error("Error loading state", e);
  }
}

async function renderActiveMatch() {
  const activeMatch = appState.matches.find(m => m.id === appState.activeMatchId);
  const container = document.getElementById('active-match-container');
  
  if (!activeMatch) {
    container.innerHTML = `<h3>Próximo Partido</h3><p>No hay más partidos programados.</p>`;
    return;
  }

  document.getElementById('match-date').textContent = new Date(activeMatch.date).toLocaleDateString('es-ES', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });
  document.getElementById('team-a-name').textContent = activeMatch.teamA;
  document.getElementById('team-b-name').textContent = activeMatch.teamB;
  document.getElementById('flag-a').textContent = FLAG_MAP[activeMatch.teamA] || '🏳️';
  document.getElementById('flag-b').textContent = FLAG_MAP[activeMatch.teamB] || '🏳️';

  const scoreAInput = document.getElementById('score-a');
  const scoreBInput = document.getElementById('score-b');
  const btnSave = document.getElementById('btn-save-score');
  
  scoreAInput.value = '';
  scoreBInput.value = '';
  
  if (activeMatch.finished) {
    scoreAInput.disabled = true;
    scoreBInput.disabled = true;
    btnSave.style.display = 'none';
    showMsg('El partido ya terminó.', 'error');
  } else {
    scoreAInput.disabled = false;
    scoreBInput.disabled = false;
    btnSave.style.display = 'block';
    
    // Check if user already predicted
    try {
      const pRes = await fetch(`${API}/api/prediccion/${encodeURIComponent(currentUser)}/${activeMatch.id}`);
      if (pRes.ok) {
        const pred = await pRes.json();
        scoreAInput.value = pred.scoreA;
        scoreBInput.value = pred.scoreB;
        btnSave.textContent = 'Actualizar Marcador';
      } else {
        btnSave.textContent = 'Guardar Marcador';
      }
    } catch(e) {}
  }
}

function renderPastMatches() {
  const container = document.getElementById('past-matches-container');
  const past = appState.matches.filter(m => m.id < appState.activeMatchId || m.finished);
  
  if (past.length === 0) {
    container.innerHTML = '<p class="subtitle">Aún no se han jugado partidos.</p>';
    return;
  }
  
  container.innerHTML = past.map(m => `
    <div class="past-match-item">
      <div>
        <strong>${FLAG_MAP[m.teamA]||''} ${m.teamA}</strong> vs <strong>${m.teamB} ${FLAG_MAP[m.teamB]||''}</strong>
      </div>
      <div class="past-match-score">
        ${m.scoreA !== null ? m.scoreA : '-'} : ${m.scoreB !== null ? m.scoreB : '-'}
      </div>
    </div>
  `).join('');
}

async function savePrediction() {
  if (!appState) return;
  const scoreA = parseInt(document.getElementById('score-a').value);
  const scoreB = parseInt(document.getElementById('score-b').value);
  
  if (isNaN(scoreA) || isNaN(scoreB) || scoreA < 0 || scoreB < 0) {
    showMsg('Por favor ingresa un marcador válido.', 'error');
    return;
  }

  try {
    const res = await fetch(`${API}/api/prediccion`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        user: currentUser,
        matchId: appState.activeMatchId,
        scoreA,
        scoreB
      })
    });
    const data = await res.json();
    if (res.ok) {
      showMsg('¡Marcador guardado con éxito! 🇪🇨', 'success');
      document.getElementById('btn-save-score').textContent = 'Actualizar Marcador';
    } else {
      showMsg(data.detail, 'error');
    }
  } catch (e) {
    showMsg('Error de conexión', 'error');
  }
}

function showMsg(text, type) {
  const msg = document.getElementById('save-msg');
  msg.textContent = text;
  msg.className = `msg ${type}`;
  msg.style.display = 'block';
  setTimeout(() => msg.style.display = 'none', 4000);
}

async function loadRanking() {
  const container = document.getElementById('ranking-container');
  try {
    const res = await fetch(`${API}/api/ranking`);
    const ranking = await res.json();
    
    if (ranking.length === 0) {
      container.innerHTML = '<p>No hay predicciones aún.</p>';
      return;
    }
    
    let html = `
      <table id="ranking-table">
        <thead>
          <tr>
            <th>Pos</th>
            <th>Participante</th>
            <th>Marcadores Exactos</th>
            <th>Fallos</th>
          </tr>
        </thead>
        <tbody>
    `;
    
    ranking.forEach((r, idx) => {
      html += `
        <tr>
          <td><strong>${idx+1}</strong></td>
          <td>${r.user}</td>
          <td><span class="badge badge-success">${r.exactos}</span></td>
          <td><span class="badge badge-error">${r.fallos}</span></td>
        </tr>
      `;
    });
    
    html += `</tbody></table>`;
    container.innerHTML = html;
  } catch (e) {
    container.innerHTML = '<p>Error cargando ranking.</p>';
  }
}
