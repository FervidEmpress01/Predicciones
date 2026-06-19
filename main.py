"""
FIFA World Cup 2026 — Simulador de Predicciones
Backend FastAPI: Fase de grupos, Fase eliminatoria (R32→Final), Sistema de puntos y Ranking.
"""

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse
from pydantic import BaseModel, field_validator
from typing import List, Dict, Optional
import json, os, httpx, asyncio
from datetime import datetime

app = FastAPI(title="Quiniela Mundial 2026")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# ── Paths ──────────────────────────────────────────────────────────────────
BASE_DIR = os.path.dirname(os.path.abspath(__file__))
FRONTEND_DIR = os.path.join(BASE_DIR, "frontend")
DB_FILE = os.path.join(BASE_DIR, "predicciones.json")
RESULTS_FILE = os.path.join(BASE_DIR, "resultados_reales.json")
MATCHES_CACHE_FILE = os.path.join(BASE_DIR, "matches_cache.json")

# ── Football-Data.org API ──────────────────────────────────────────────────
# Regístrate GRATIS en https://www.football-data.org/ para obtener tu token
FOOTBALL_DATA_TOKEN = os.environ.get("FOOTBALL_DATA_TOKEN", "")
FOOTBALL_DATA_BASE = "https://api.football-data.org/v4"
WC_CODE = "WC"
WC_SEASON = 2026

# ── Grupos oficiales ───────────────────────────────────────────────────────
GRUPOS_MUNDIAL = {
    "A": ["Corea del Sur", "México", "Sudáfrica", "Chequia"],
    "B": ["Canadá", "Catar", "Suiza", "Bosnia y Herzegovina"],
    "C": ["Brasil", "Escocia", "Haití", "Marruecos"],
    "D": ["Australia", "Estados Unidos", "Paraguay", "Turquía"],
    "E": ["Alemania", "Costa de Marfil", "Curazao", "Ecuador"],
    "F": ["Japón", "Países Bajos", "Suecia", "Túnez"],
    "G": ["Bélgica", "Irán", "Egipto", "Nueva Zelanda"],
    "H": ["Arabia Saudita", "España", "Cabo Verde", "Uruguay"],
    "I": ["Francia", "Senegal", "Noruega", "Irak"],
    "J": ["Argelia", "Argentina", "Jordania", "Austria"],
    "K": ["Portugal", "Colombia", "Uzbekistán", "RD Congo"],
    "L": ["Inglaterra", "Panamá", "Croacia", "Ghana"],
}
VALID_GROUPS = list("ABCDEFGHIJKL")
ALL_TEAMS = sorted([eq for g in GRUPOS_MUNDIAL.values() for eq in g])

# Mapping: football-data.org English names → our Spanish names
TEAM_NAME_MAP = {
    "South Korea": "Corea del Sur", "Korea Republic": "Corea del Sur",
    "Mexico": "México", "South Africa": "Sudáfrica", "Sudáfrica": "Sudáfrica",
    "Czech Republic": "Chequia", "Czechia": "Chequia",
    "Canada": "Canadá", "Qatar": "Catar",
    "Switzerland": "Suiza", "Bosnia and Herzegovina": "Bosnia y Herzegovina",
    "Brazil": "Brasil", "Scotland": "Escocia",
    "Haiti": "Haití", "Morocco": "Marruecos",
    "Australia": "Australia", "United States": "Estados Unidos", "USA": "Estados Unidos",
    "Paraguay": "Paraguay", "Turkey": "Turquía", "Türkiye": "Turquía",
    "Germany": "Alemania", "Ivory Coast": "Costa de Marfil", "Côte d'Ivoire": "Costa de Marfil",
    "Curaçao": "Curazao", "Curacao": "Curazao", "Ecuador": "Ecuador",
    "Japan": "Japón", "Netherlands": "Países Bajos",
    "Sweden": "Suecia", "Tunisia": "Túnez",
    "Belgium": "Bélgica", "Iran": "Irán",
    "Egypt": "Egipto", "New Zealand": "Nueva Zelanda",
    "Saudi Arabia": "Arabia Saudita", "Spain": "España",
    "Cape Verde": "Cabo Verde", "Cabo Verde": "Cabo Verde", "Uruguay": "Uruguay",
    "France": "Francia", "Senegal": "Senegal",
    "Norway": "Noruega", "Iraq": "Irak",
    "Algeria": "Argelia", "Argentina": "Argentina",
    "Jordan": "Jordania", "Austria": "Austria",
    "Portugal": "Portugal", "Colombia": "Colombia",
    "Uzbekistan": "Uzbekistán", "DR Congo": "RD Congo", "Congo DR": "RD Congo",
    "England": "Inglaterra", "Panama": "Panamá",
    "Croatia": "Croacia", "Ghana": "Ghana",
}

def translate_team(name_en):
    """Translate English team name to our Spanish name."""
    if not name_en:
        return name_en
    return TEAM_NAME_MAP.get(name_en, name_en)

# Group letter lookup from team name
TEAM_TO_GROUP = {}
for _g, _teams in GRUPOS_MUNDIAL.items():
    for _t in _teams:
        TEAM_TO_GROUP[_t] = _g

# ── DB helpers ─────────────────────────────────────────────────────────────
def cargar_db():
    if os.path.exists(DB_FILE):
        with open(DB_FILE, "r", encoding="utf-8") as f:
            return json.load(f)
    return []

def guardar_db(datos):
    with open(DB_FILE, "w", encoding="utf-8") as f:
        json.dump(datos, f, ensure_ascii=False, indent=2)

def cargar_resultados():
    if os.path.exists(RESULTS_FILE):
        with open(RESULTS_FILE, "r", encoding="utf-8") as f:
            return json.load(f)
    return {
        "grupos": {g: [] for g in VALID_GROUPS},
        "terceros": [],
        "dieciseisavos": [], "octavos": [], "cuartos": [],
        "semis": [], "final": [], "campeon": []
    }

predicciones_db = cargar_db()
resultados_reales = cargar_resultados()

# ── Annex C — Third-place pairing ─────────────────────────────────────────
LEADER_POSSIBLE_THIRDS = {
    "E": {"A","B","C","D","F"},
    "I": {"C","D","F","G","H"},
    "A": {"C","E","F","H","I"},
    "L": {"E","H","I","J","K"},
    "G": {"A","E","H","I","J"},
    "D": {"B","E","F","I","J"},
    "B": {"E","F","G","I","J"},
    "K": {"D","E","I","J","L"},
}

def assign_thirds_to_leaders(best_thirds_groups: list) -> dict:
    thirds_set = set(best_thirds_groups)
    leaders = list(LEADER_POSSIBLE_THIRDS.keys())
    domains = {}
    for leader in leaders:
        possible = LEADER_POSSIBLE_THIRDS[leader] & thirds_set
        possible.discard(leader)
        domains[leader] = sorted(possible)

    assignment, used = {}, set()

    def solve(idx):
        if idx == len(leaders):
            return True
        remaining = sorted(
            [(len([v for v in domains[l] if v not in used]), l)
             for l in leaders if l not in assignment]
        )
        _, leader = remaining[0]
        for third in domains[leader]:
            if third not in used:
                assignment[leader] = third
                used.add(third)
                if solve(idx + 1):
                    return True
                del assignment[leader]
                used.discard(third)
        return False

    if not solve(0):
        raise ValueError("No se puede asignar terceros con esa combinación")
    return assignment

# ── Bracket builder ────────────────────────────────────────────────────────
def build_bracket(leaders: list, runners_up: list, best_thirds: list) -> dict:
    leader_map = {item[-1].upper(): item for item in leaders}
    runner_map = {item[-1].upper(): item for item in runners_up}
    third_map  = {g: f"3{g}" for g in best_thirds}
    ta = assign_thirds_to_leaders(best_thirds)

    def m(a, b, mid):
        return {"id": mid, "teamA": a, "teamB": b, "winner": None}

    r32 = [
        m(leader_map["E"], third_map[ta["E"]], "R32-1"),
        m(runner_map["A"], runner_map["B"],     "R32-2"),
        m(leader_map["A"], third_map[ta["A"]], "R32-3"),
        m(leader_map["C"], runner_map["F"],     "R32-4"),
        m(leader_map["G"], third_map[ta["G"]], "R32-5"),
        m(runner_map["D"], runner_map["G"],     "R32-6"),
        m(leader_map["L"], third_map[ta["L"]], "R32-7"),
        m(leader_map["H"], runner_map["J"],     "R32-8"),
        m(leader_map["I"], third_map[ta["I"]], "R32-9"),
        m(runner_map["E"], runner_map["I"],     "R32-10"),
        m(leader_map["D"], third_map[ta["D"]], "R32-11"),
        m(leader_map["F"], runner_map["C"],     "R32-12"),
        m(leader_map["B"], third_map[ta["B"]], "R32-13"),
        m(runner_map["K"], runner_map["L"],     "R32-14"),
        m(leader_map["K"], third_map[ta["K"]], "R32-15"),
        m(leader_map["J"], runner_map["H"],     "R32-16"),
    ]

    emp = lambda mid: {"id": mid, "teamA": None, "teamB": None, "winner": None}
    r16 = [emp(f"R16-{i+1}") for i in range(8)]
    qf  = [emp(f"QF-{i+1}")  for i in range(4)]
    sf  = [emp(f"SF-{i+1}")  for i in range(2)]

    feeder = {
        "R16-1":["R32-1","R32-2"],"R16-2":["R32-3","R32-4"],
        "R16-3":["R32-5","R32-6"],"R16-4":["R32-7","R32-8"],
        "R16-5":["R32-9","R32-10"],"R16-6":["R32-11","R32-12"],
        "R16-7":["R32-13","R32-14"],"R16-8":["R32-15","R32-16"],
        "QF-1":["R16-1","R16-2"],"QF-2":["R16-3","R16-4"],
        "QF-3":["R16-5","R16-6"],"QF-4":["R16-7","R16-8"],
        "SF-1":["QF-1","QF-2"],"SF-2":["QF-3","QF-4"],
        "FINAL":["SF-1","SF-2"],"3RD":["SF-1","SF-2"],
    }

    return {
        "r32": r32, "r16": r16, "qf": qf, "sf": sf,
        "final": emp("FINAL"), "third_place": emp("3RD"),
        "feeder": feeder,
        "thirds_assignment": {k: f"3{v}" for k, v in ta.items()},
    }

# ── Pydantic Models ────────────────────────────────────────────────────────
class BracketRequest(BaseModel):
    leaders: List[str]
    runners_up: List[str]
    best_thirds: List[str]

    @field_validator("leaders")
    @classmethod
    def val_l(cls, v):
        if len(v) != 12: raise ValueError("12 líderes requeridos")
        return v
    @field_validator("runners_up")
    @classmethod
    def val_r(cls, v):
        if len(v) != 12: raise ValueError("12 segundos requeridos")
        return v
    @field_validator("best_thirds")
    @classmethod
    def val_t(cls, v):
        if len(v) != 8: raise ValueError("8 mejores terceros requeridos")
        return [g.upper() for g in v]

class Prediccion(BaseModel):
    usuario: str
    grupos: Dict[str, List[str]]
    terceros: List[str] = []
    terceros_grupos: List[str] = []  # which group letters were selected
    dieciseisavos: List[str] = []
    octavos: List[str] = []
    cuartos: List[str] = []
    semis: List[str] = []
    final: List[str] = []
    campeon: List[str] = []

# ── Endpoints ──────────────────────────────────────────────────────────────
@app.get("/")
async def serve_index():
    return FileResponse(os.path.join(FRONTEND_DIR, "index.html"))

@app.get("/api/equipos")
def get_equipos():
    return ALL_TEAMS

@app.get("/api/grupos")
def get_grupos():
    return GRUPOS_MUNDIAL

@app.post("/api/bracket")
async def generate_bracket(req: BracketRequest):
    try:
        return build_bracket(req.leaders, req.runners_up, req.best_thirds)
    except ValueError as e:
        raise HTTPException(400, str(e))

@app.post("/api/predicciones")
def guardar_prediccion(pred: Prediccion):
    if not pred.usuario.strip():
        raise HTTPException(400, "El usuario no puede estar vacío")
    # Nombre sanitizado
    pred.usuario = pred.usuario.strip()[:50]

    # Validar grupos: cada grupo debe tener al menos 1° y 2°
    for g in VALID_GROUPS:
        equipos = pred.grupos.get(g, [])
        if len(equipos) < 2:
            raise HTTPException(400, f"Grupo {g}: debe tener al menos 1° y 2° lugar")
        # Validar que sean equipos reales del grupo
        for eq in equipos:
            if eq not in GRUPOS_MUNDIAL.get(g, []):
                raise HTTPException(400, f"'{eq}' no pertenece al Grupo {g}")

    # Validar terceros: exactamente 8
    if len(pred.terceros) != 8:
        raise HTTPException(400, f"Debe tener exactamente 8 mejores terceros (tienes {len(pred.terceros)})")

    # Validar bracket completo: 16 dieciseisavos, 8 octavos, etc.
    fases_req = [
        ("dieciseisavos", 16, "Dieciseisavos (16 ganadores)"),
        ("octavos", 8, "Octavos (8 ganadores)"),
        ("cuartos", 4, "Cuartos (4 ganadores)"),
        ("semis", 2, "Semifinales (2 ganadores)"),
        ("final", 2, "Finalistas (2 equipos)"),
        ("campeon", 1, "Campeón (1 equipo)"),
    ]
    for campo, cantidad, nombre in fases_req:
        actual = len(getattr(pred, campo, []))
        if actual < cantidad:
            raise HTTPException(400, f"Bracket incompleto: {nombre} — tienes {actual}, necesitas {cantidad}")

    datos = pred.dict()
    for i, p in enumerate(predicciones_db):
        if p["usuario"] == pred.usuario:
            predicciones_db[i] = datos
            guardar_db(predicciones_db)
            return {"mensaje": "Predicción actualizada exitosamente"}
    predicciones_db.append(datos)
    guardar_db(predicciones_db)
    return {"mensaje": "Predicción guardada exitosamente"}

@app.get("/api/ranking")
def get_ranking():
    ranking = []
    for p in predicciones_db:
        pts = 0
        # Fase de grupos: 1 pt por posición correcta
        for letra, orden_real in resultados_reales["grupos"].items():
            if len(orden_real) >= 2:
                orden_u = p["grupos"].get(letra, [])
                for i in range(min(len(orden_real), len(orden_u))):
                    if orden_u[i] == orden_real[i]:
                        pts += 1
        # Terceros: 1 pt cada uno
        if resultados_reales["terceros"]:
            pts += len(set(p.get("terceros",[])) & set(resultados_reales["terceros"]))
        # Fases eliminatorias: multiplicadores crecientes
        fases = [("dieciseisavos",1),("octavos",2),("cuartos",3),
                 ("semis",4),("final",5),("campeon",10)]
        for fase, mult in fases:
            reales = resultados_reales.get(fase, [])
            if reales:
                pts += len(set(p.get(fase,[])) & set(reales)) * mult
        ranking.append({"usuario": p["usuario"], "puntos": pts})
    return sorted(ranking, key=lambda x: x["puntos"], reverse=True)

@app.get("/api/resultados")
def get_resultados():
    return resultados_reales

@app.get("/api/prediccion/{usuario}")
def get_prediccion(usuario: str):
    for p in predicciones_db:
        if p["usuario"] == usuario:
            return p
    raise HTTPException(404, "Predicción no encontrada")

# ── Admin: actualizar resultados reales ────────────────────────────────────
ADMIN_KEY = "mundial2026admin"  # Cámbialo por algo seguro

class ResultadosUpdate(BaseModel):
    admin_key: str
    fase: str          # "grupos", "terceros", "dieciseisavos", etc.
    datos: dict = {}   # Para grupos: {"A": ["equipo1","equipo2",...], ...}
    lista: List[str] = []  # Para fases eliminatorias: ["ganador1", ...]

@app.post("/api/admin/resultados")
def actualizar_resultados(req: ResultadosUpdate):
    if req.admin_key != ADMIN_KEY:
        raise HTTPException(403, "Clave de administrador incorrecta")

    global resultados_reales
    fases_validas = ["grupos","terceros","dieciseisavos","octavos",
                     "cuartos","semis","final","campeon"]
    if req.fase not in fases_validas:
        raise HTTPException(400, f"Fase inválida. Opciones: {fases_validas}")

    if req.fase == "grupos":
        for g, equipos in req.datos.items():
            if g in resultados_reales["grupos"]:
                resultados_reales["grupos"][g] = equipos
    else:
        resultados_reales[req.fase] = req.lista

    # Guardar en archivo
    with open(RESULTS_FILE, "w", encoding="utf-8") as f:
        json.dump(resultados_reales, f, ensure_ascii=False, indent=2)

    return {"mensaje": f"Resultados de '{req.fase}' actualizados", "resultados": resultados_reales}

# ── Football-Data.org: obtener partidos en vivo ────────────────────────────
matches_cache = {"data": [], "last_fetch": None}

async def fetch_matches_from_api():
    """Fetch all WC 2026 matches from football-data.org API."""
    if not FOOTBALL_DATA_TOKEN:
        return None
    headers = {"X-Auth-Token": FOOTBALL_DATA_TOKEN}
    url = f"{FOOTBALL_DATA_BASE}/competitions/{WC_CODE}/matches?season={WC_SEASON}"
    try:
        async with httpx.AsyncClient(timeout=15) as client:
            resp = await client.get(url, headers=headers)
            if resp.status_code != 200:
                print(f"[API] Error {resp.status_code}: {resp.text[:200]}")
                return None
            data = resp.json()
            return data.get("matches", [])
    except Exception as e:
        print(f"[API] Error fetching matches: {e}")
        return None

def parse_match(m):
    """Parse a football-data.org match into our format."""
    home_en = m.get("homeTeam", {}).get("name", "")
    away_en = m.get("awayTeam", {}).get("name", "")
    home = translate_team(home_en)
    away = translate_team(away_en)
    score = m.get("score", {})
    ft = score.get("fullTime", {})
    ht = score.get("halfTime", {})
    status = m.get("status", "SCHEDULED")  # SCHEDULED, TIMED, IN_PLAY, PAUSED, FINISHED
    stage = m.get("stage", "GROUP_STAGE")
    group = m.get("group", "")  # "GROUP_A", etc.
    group_letter = group.replace("GROUP_", "") if group else ""
    matchday = m.get("matchday")
    utc_date = m.get("utcDate", "")

    return {
        "id": m.get("id"),
        "home": home,
        "away": away,
        "homeScore": ft.get("home"),
        "awayScore": ft.get("away"),
        "htHome": ht.get("home"),
        "htAway": ht.get("away"),
        "status": status,
        "stage": stage,
        "group": group_letter,
        "matchday": matchday,
        "date": utc_date,
        "winner": translate_team(m.get("score", {}).get("winner", "")) if m.get("score", {}).get("winner") else None,
    }

def determine_winner_name(match_data):
    """Get winner name from a parsed match."""
    w = match_data.get("winner")
    if w == "HOME_TEAM":
        return match_data["home"]
    elif w == "AWAY_TEAM":
        return match_data["away"]
    elif w == "DRAW":
        return None  # Penalties handled differently
    return None

STAGE_MAP = {
    "GROUP_STAGE": "grupos",
    "LAST_32": "dieciseisavos",
    "LAST_16": "octavos",
    "QUARTER_FINALS": "cuartos",
    "SEMI_FINALS": "semis",
    "THIRD_PLACE": "tercero",
    "FINAL": "final",
}

def auto_sync_results(parsed_matches):
    """Auto-update resultados_reales from finished matches."""
    global resultados_reales

    # --- Group standings from finished group matches ---
    group_points = {g: {} for g in VALID_GROUPS}  # {group: {team: points}}
    for m in parsed_matches:
        if m["stage"] != "GROUP_STAGE" or m["status"] != "FINISHED":
            continue
        g = m["group"]
        if g not in group_points:
            continue
        h, a = m["home"], m["away"]
        if h not in group_points[g]: group_points[g][h] = 0
        if a not in group_points[g]: group_points[g][a] = 0
        hs, as_ = m["homeScore"], m["awayScore"]
        if hs is not None and as_ is not None:
            if hs > as_:
                group_points[g][h] += 3
            elif hs < as_:
                group_points[g][a] += 3
            else:
                group_points[g][h] += 1
                group_points[g][a] += 1

    for g in VALID_GROUPS:
        if group_points[g]:
            sorted_teams = sorted(group_points[g].items(), key=lambda x: x[1], reverse=True)
            resultados_reales["grupos"][g] = [t[0] for t in sorted_teams]

    # --- Knockout winners from finished knockout matches ---
    for m in parsed_matches:
        if m["status"] != "FINISHED":
            continue
        stage_key = STAGE_MAP.get(m["stage"])
        if not stage_key or stage_key == "grupos":
            continue

        hs, as_ = m["homeScore"], m["awayScore"]
        if hs is not None and as_ is not None:
            winner = m["home"] if hs > as_ else m["away"] if as_ > hs else None
            # In knockout, if draw check penalties
            if winner is None:
                pen = {}  # Would need penalty data from API
                continue
            if stage_key == "final":
                if winner not in resultados_reales.get("final", []):
                    resultados_reales.setdefault("final", [])
                    resultados_reales["final"] = [m["home"], m["away"]]
                resultados_reales["campeon"] = [winner]
            else:
                fase_lista = resultados_reales.setdefault(stage_key, [])
                if winner not in fase_lista:
                    fase_lista.append(winner)

    # Save
    with open(RESULTS_FILE, "w", encoding="utf-8") as f:
        json.dump(resultados_reales, f, ensure_ascii=False, indent=2)

@app.get("/api/partidos")
async def get_partidos(force_refresh: bool = False):
    """Get all WC 2026 matches, grouped by stage and group."""
    now = datetime.utcnow()

    # Cache for 2 minutes to avoid API rate limits
    if (not force_refresh
        and matches_cache["data"]
        and matches_cache["last_fetch"]
        and (now - matches_cache["last_fetch"]).total_seconds() < 120):
        return {"partidos": matches_cache["data"], "cached": True, "api_configured": bool(FOOTBALL_DATA_TOKEN)}

    if not FOOTBALL_DATA_TOKEN:
        # Return from cache file if exists
        if os.path.exists(MATCHES_CACHE_FILE):
            with open(MATCHES_CACHE_FILE, "r", encoding="utf-8") as f:
                return {"partidos": json.load(f), "cached": True, "api_configured": False,
                        "message": "Configura FOOTBALL_DATA_TOKEN para datos en vivo"}
        return {"partidos": [], "cached": False, "api_configured": False,
                "message": "Configura FOOTBALL_DATA_TOKEN para datos en vivo. Regístrate gratis en football-data.org"}

    raw = await fetch_matches_from_api()
    if raw is None:
        if matches_cache["data"]:
            return {"partidos": matches_cache["data"], "cached": True, "api_configured": True}
        return {"partidos": [], "error": "Error al conectar con la API"}

    parsed = [parse_match(m) for m in raw]
    matches_cache["data"] = parsed
    matches_cache["last_fetch"] = now

    # Save to cache file
    with open(MATCHES_CACHE_FILE, "w", encoding="utf-8") as f:
        json.dump(parsed, f, ensure_ascii=False, indent=2)

    # Auto-sync results
    auto_sync_results(parsed)

    return {"partidos": parsed, "cached": False, "api_configured": True}

@app.post("/api/sync")
async def sync_results():
    """Force sync results from football-data.org."""
    result = await get_partidos(force_refresh=True)
    return {"mensaje": "Resultados sincronizados", "total_partidos": len(result.get("partidos", []))}

# ── Static files mount (MUST be last) ─────────────────────────────────────
app.mount("/", StaticFiles(directory=FRONTEND_DIR), name="static")

if __name__ == "__main__":
    import uvicorn
    uvicorn.run("main:app", host="0.0.0.0", port=8000, reload=True)
