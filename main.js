// ─── CONSTANTS ───────────────────────────────────────────────────────────────
const COLORS = ['#818cf8','#34d399','#fb923c','#f472b6','#a78bfa','#22d3ee','#4ade80','#fbbf24','#60a5fa','#f87171'];
// Fenêtre large (1 an dans le passé, 2 ans dans le futur) pour qu'il y ait vraiment de quoi
// naviguer dans le temps (scroll horizontal natif + boutons Précédent/Aujourd'hui/Suivant,
// voir scrollGanttBy()/scrollGanttToToday()) — avant, seuls 15 mois fixes étaient affichés.
const GANTT_MONTHS = 36;
const GANTT_OFFSET = -12; // start 12 months before today

// ─── STATE ────────────────────────────────────────────────────────────────────
let S = { consultants: [], prestations: [], opportunites: [], candidatures: [] };
let filterCons   = null;  // null = all
let filterStatus = 'all'; // bucket commun : 'all' | 'en_cours' | 'en_attente' | 'gagne' | 'perdu'
let filterType   = 'all'; // 'all' | 'prestation' | 'opportunite' — Vue liste uniquement
let currentView  = 'gantt';
let currentProfile = null; // { type: 'manager' } | { type: 'consultant', id }
let viewMode = 'consultants'; // 'consultants' | 'clients' — bascule de la Vue liste

// Temp modal state
let modalRevisions = []; // [{date, tjm}]
let modalCostRevisions = []; // [{date, coutComplet}]
let modalCandidatures = []; // [{id, consultantId, status, bookPushes:[{id,date}], soutenances:[{id,date,resultat}]}]
let modalWonCandidatureId = null; // set par markCandidatureWonInModal(), consommé par savePrestation()
let modalMissionEvents = []; // [{id, type: 'prolongation'|'pause'|'sortie_anticipee', date, resumeDate?}]
let prestModalSnapshot = null; // état du formulaire à l'ouverture, pour détecter une saisie non enregistrée (cancelPrestModal())
let oppModalSnapshot = null; // idem, pour la modale Opportunité (cancelOpportuniteModal())
let statsPeriod = 'quarterly'; // 'quarterly' | '5y' | '10y' — pilote les tableaux/graphiques du bas de la vue Statistiques

// Navigation dédiée au graphique "Chiffre d'affaires & Marge" (indépendante de statsPeriod)
let chartMode     = '1y';  // '1y' | '3y' | '5y'
let chartYear     = new Date().getFullYear(); // année affichée en mode '1y'
let chartFocusIdx = null;  // point sélectionné pour la légende (index dans les données affichées) ; null = auto (aujourd'hui)

// ─── PERSISTENCE ─────────────────────────────────────────────────────────────
async function load() {
  try {
    const res = await fetch('/api/data');
    if (res.ok) S = await res.json();
    S.opportunites = S.opportunites || [];
    S.candidatures = S.candidatures || [];
  } catch(e) {}
}
function save() {
  fetch('/api/data', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(S),
  }).catch(() => {});
}
function genId() { return Date.now().toString(36) + Math.random().toString(36).slice(2,7); }

// ─── HELPERS ─────────────────────────────────────────────────────────────────
function consColor(id) {
  const i = S.consultants.findIndex(c => c.id === id);
  return COLORS[i % COLORS.length];
}

function initials(name) {
  return name.split(' ').map(n => n[0]).join('').slice(0,2).toUpperCase();
}

function fmtD(d) {
  if (!d) return '—';
  const dt = new Date(d + 'T00:00:00');
  return dt.toLocaleDateString('fr-FR', { day:'2-digit', month:'short', year:'2-digit' });
}

// Badges "Arrive le ..." / "Sortie le ..." pour les consultants pas encore
// arrivés ou déjà partis (ou dont le départ est planifié).
// Badge de tendance (↑/↓/≈) comparant une valeur au trimestre précédent.
function trendBadge(cur, prev) {
  if (cur === null || cur === undefined || prev === null || prev === undefined) return '';
  const diff = cur - prev;
  const cls  = diff === 0 ? 'trend-flat' : diff > 0 ? 'trend-up' : 'trend-down';
  const pct  = prev !== 0 ? Math.round(Math.abs(diff) / Math.abs(prev) * 100) : null;
  const arrow = diff === 0 ? '≈' : (diff > 0 ? '↑' : '↓');
  return `<span class="trend-badge ${cls}" title="vs trimestre précédent">${arrow}${pct !== null ? ' '+pct+'%' : ''}</span>`;
}

function consultantStatusPills(c) {
  const today = new Date(); today.setHours(0,0,0,0);
  const pills = [];
  if (c.dateEntree) {
    const entree = new Date(c.dateEntree + 'T00:00:00');
    if (entree > today) pills.push(`<span class="status-pill pill-arrivee">Arrive le ${fmtD(c.dateEntree)}</span>`);
  }
  if (c.dateSortie) {
    const sortie = new Date(c.dateSortie + 'T23:59:59');
    const label = sortie < today ? 'Sorti(e) le' : 'Sortie le';
    pills.push(`<span class="status-pill pill-sortie">${label} ${fmtD(c.dateSortie)}</span>`);
  }
  return pills.length ? `<div class="status-pills">${pills.join('')}</div>` : '';
}

function statusLabel(s) {
  return { en_cours:'En cours', en_pause:'En pause', terminee:'Terminée' }[s] || s;
}

function opportuniteStatusLabel(s) {
  return { ouvert:'Ouvert', pourvu:'Gagnée', abandonne:'Perdue' }[s] || s;
}
function candidatureStatusLabel(s) {
  return { en_attente:'En attente', gagnee:'Gagnée', perdue:'Perdue' }[s] || s;
}
function resultatSoutenanceLabel(r) {
  return { en_attente:'En attente', validee:'Validée', refusee:'Refusée' }[r] || r;
}
function natureLabel(n) {
  return { mission:'Mission', forfait:'Forfait', projet_interne:'Projet interne' }[n] || 'Mission';
}
function natureBadge(n) {
  const lbl = natureLabel(n || 'mission');
  return `<span class="nature-badge nature-${n||'mission'}">${lbl}</span>`;
}

// Historique des modifications de mission (p.missionEvents : [{id, type, date, resumeDate?}],
// type = 'prolongation' | 'pause' | 'sortie_anticipee') — plusieurs entrées possibles dans le
// temps, comme tjmRevisions. lastEndEvent() = la décision la plus récente qui redéfinit la fin
// de mission (une prolongation ultérieure écrase une sortie anticipée plus ancienne, et
// inversement) ; une "pause" n'affecte pas la fin, seulement le statut pendant sa fenêtre.
function lastEndEvent(p) {
  const events = (p.missionEvents || []).filter(e => e.type === 'prolongation' || e.type === 'sortie_anticipee');
  return events.length ? events[events.length - 1] : null;
}
function activePause(p, atDate) {
  return (p.missionEvents || []).find(e => e.type === 'pause' && e.date <= atDate && (!e.resumeDate || e.resumeDate > atDate));
}
function effectiveEnd(p) {
  return lastEndEvent(p)?.date || p.endDate;
}

function todayStr() { return new Date().toISOString().slice(0,10); }

// Statut calculé, jamais saisi à la main : une prestation existe toujours déjà confirmée
// (créée directement ou issue d'une candidature gagnée), donc seule la date (et une éventuelle
// pause en cours) compte pour savoir où elle en est — pas de risque d'un statut resté "En cours"
// après coup par oubli.
function prestationStatus(p) {
  const today = todayStr();
  if (activePause(p, today)) return 'en_pause';
  return effectiveEnd(p) < today ? 'terminee' : 'en_cours';
}

// Current TJM = last applicable revision or base TJM
function currentTjm(p) {
  const today = new Date().toISOString().slice(0,10);
  if (!p.tjmRevisions?.length) return p.tjm;
  // Une révision peut ne porter qu'un taux d'activité (pas de TJM) : on ignore ces entrées ici,
  // on cherche la dernière qui renseigne bien un TJM.
  const past = p.tjmRevisions.filter(r => r.date <= today && r.tjm !== undefined);
  return past.length ? past[past.length-1].tjm : p.tjm;
}

// Coût complet applicable à une date donnée (YYYY-MM-DD) = dernière révision dont la date est
// atteinte à cette date, sinon le coût de base. Contrairement à currentTjm() (toujours "aujourd'hui"),
// atDate est paramétrable pour que chaque période statistique utilise le coût qui lui est propre.
function currentCoutComplet(c, atDate) {
  if (!c.coutCompletRevisions?.length) return c.coutComplet || 0;
  const past = c.coutCompletRevisions.filter(r => r.date <= atDate);
  return past.length ? past[past.length-1].coutComplet : (c.coutComplet || 0);
}

// ─── DEMO DATA ───────────────────────────────────────────────────────────────
function seedDemo() {
  const ids = [genId(), genId(), genId(), genId()];
  S.consultants = [
    { id: ids[0], name: 'Sophie Martin',   role: 'Lead Développeuse',  dateEntree: '2025-09-01', coutComplet: 450 },
    { id: ids[1], name: 'Thomas Bernard',  role: 'Chef de Projet',     dateEntree: '2025-06-01', coutComplet: 420 },
    { id: ids[2], name: 'Camille Petit',   role: 'Data Engineer',      dateEntree: '2025-03-01', coutComplet: 410 },
    { id: ids[3], name: 'Antoine Dubois',  role: 'Architecte Cloud',   dateEntree: '2024-09-01', coutComplet: 480 },
  ];
  const n = new Date();
  const y = n.getFullYear(), m = n.getMonth();
  const d = (yr,mo,da) => new Date(yr,mo,da).toISOString().slice(0,10);

  // Statut non saisi (voir prestationStatus()) : les dates ci-dessous suffisent à le déduire —
  // pas de champ "status" sur ces objets.
  S.prestations = [
    {
      id: genId(), consultantId: ids[0],
      client: 'Société Générale', clientService: 'DSI — Pôle API',
      startDate: d(y,m-3,1), endDate: d(y,m+3,30),
      missionEvents: [{ id: genId(), type: 'prolongation', date: d(y,m+6,30) }],
      tjm: 700, fte: 5, nature: 'mission', tjmRevisions: [{ date: d(y,m-1,1), tjm: 720 }],
      notes: 'Extension confirmée pour Q4'
    },
    {
      id: genId(), consultantId: ids[1],
      client: 'Orange', clientService: 'PMO DSI',
      startDate: d(y,m-7,1), endDate: d(y,m-2,28),
      missionEvents: [],
      tjm: 620, fte: 5, nature: 'mission', tjmRevisions: [{ date: d(y,m-4,1), tjm: 650 }],
      notes: ''
    },
    {
      id: genId(), consultantId: ids[1],
      client: 'Carrefour', clientService: 'Digital & IT',
      startDate: d(y,m,1), endDate: d(y,m+7,31),
      missionEvents: [],
      tjm: 680, fte: 4, nature: 'mission', tjmRevisions: [],
      notes: 'Renouvellement trimestriel prévu — 4/5'
    },
    {
      id: genId(), consultantId: ids[2],
      client: 'TotalEnergies', clientService: 'Data & Analytics',
      startDate: d(y,m-2,15), endDate: d(y,m+5,14),
      missionEvents: [{ id: genId(), type: 'sortie_anticipee', date: d(y,m+2,28) }],
      tjm: 690, fte: 5, nature: 'forfait', tjmRevisions: [],
      notes: 'Sortie anticipée négociée'
    },
    {
      id: genId(), consultantId: ids[3],
      client: 'SNCF', clientService: 'Systèmes Embarqués',
      startDate: d(y,m-6,1), endDate: d(y,m-3,31),
      missionEvents: [],
      tjm: 730, fte: 5, nature: 'mission', tjmRevisions: [],
      notes: ''
    },
  ];

  // Exemples d'opportunités — couvrent les issues possibles du pipeline : ouvertes (encore en
  // négociation, dont 2 issues d'anciennes prestations spéculatives — ce mécanisme hérité
  // n'existe plus, une demande en négociation est désormais une Opportunité dès le départ),
  // gagnée (liée à une vraie prestation ci-dessous), abandonnée.
  const oppWonId = genId();
  const axaPrestId = genId();
  S.prestations.push({
    id: axaPrestId, consultantId: ids[1],
    client: 'AXA', clientService: 'Assurance Digital',
    startDate: d(y,m-1,1), endDate: d(y,m+8,31),
    missionEvents: [],
    tjm: 710, fte: 5, nature: 'mission', tjmRevisions: [],
    notes: 'Mission démarrée suite à l\'opportunité gagnée'
  });

  const bnpOppId    = genId();
  const airbusOppId = genId();
  S.opportunites = [
    { id: genId(),      client: 'Renault',     clientService: 'Digital Factory',   titre: 'Product Owner',        createdAt: d(y,m,-10),  status: 'ouvert', startDate: d(y,m+1,1), endDate: d(y,m+4,30), nature: '' },
    { id: bnpOppId,     client: 'BNP Paribas', clientService: 'CIB Digital',       titre: 'RFP en cours',         createdAt: d(y,m,-15),  status: 'ouvert', startDate: d(y,m+7,1), endDate: d(y+1,m+2,28), nature: 'forfait', tjm: 750, fte: 5 },
    { id: airbusOppId,  client: 'Airbus',      clientService: 'IT Infrastructure', titre: 'Poste conditionné budget', createdAt: d(y,m,-5), status: 'ouvert', startDate: d(y,m+2,1), endDate: d(y,m+11,30), nature: 'mission', tjm: 800, fte: 5 },
    { id: oppWonId,     client: 'AXA',         clientService: 'Assurance Digital', titre: 'Architecte Data',      createdAt: d(y,m-2,5),  status: 'pourvu' },
    { id: genId(),      client: 'Décathlon',   clientService: 'E-commerce',        titre: 'Lead Data Engineer',   createdAt: d(y,m-1,15), status: 'abandonne' },
  ];
  S.candidatures = [
    {
      id: genId(), opportuniteId: S.opportunites[0].id, consultantId: ids[2], status: 'en_attente',
      bookPushes: [{ id: genId(), date: d(y,m,-8) }],
      soutenances: [{ id: genId(), date: d(y,m,-3), resultat: 'en_attente' }],
    },
    {
      id: genId(), opportuniteId: bnpOppId, consultantId: ids[0], status: 'en_attente',
      bookPushes: [{ id: genId(), date: d(y,m,-14) }],
      soutenances: [{ id: genId(), date: d(y,m,-6), resultat: 'en_attente' }],
    },
    {
      id: genId(), opportuniteId: airbusOppId, consultantId: ids[3], status: 'en_attente',
      bookPushes: [{ id: genId(), date: d(y,m,-4) }],
      soutenances: [],
    },
    {
      id: genId(), opportuniteId: oppWonId, consultantId: ids[1], status: 'gagnee', prestationId: axaPrestId,
      bookPushes: [{ id: genId(), date: d(y,m-2,7) }],
      soutenances: [{ id: genId(), date: d(y,m-2,20), resultat: 'validee' }],
    },
    {
      id: genId(), opportuniteId: S.opportunites[4].id, consultantId: ids[2], status: 'perdue',
      bookPushes: [{ id: genId(), date: d(y,m-1,17) }, { id: genId(), date: d(y,m-1,25) }],
      soutenances: [{ id: genId(), date: d(y,m,-20), resultat: 'refusee' }],
    },
  ];

  save();
}

// ─── TAILLE DU TEXTE (espace utilisateur) ────────────────────────────────────
// Change la taille de la racine <html> : tout le texte de l'app suit proportionnellement,
// puisque tout est en rem (voir styles/tokens.css, --text-*) depuis l'audit accessibilité du
// 2026-08-29. Persisté par navigateur (localStorage), pas par profil applicatif.
const TEXT_SCALE_STEPS = [100, 112, 125, 140, 160]; // %
let textScaleIndex = 0;

function initTextScale() {
  const stored = parseInt(localStorage.getItem('squadra_text_scale_index'));
  textScaleIndex = (!isNaN(stored) && stored >= 0 && stored < TEXT_SCALE_STEPS.length) ? stored : 0;
  applyTextScale();
}
function applyTextScale() {
  const pct = TEXT_SCALE_STEPS[textScaleIndex];
  document.documentElement.style.fontSize = pct + '%';
  document.getElementById('text-scale-indicator').textContent = pct + '%';
  document.getElementById('btn-text-scale-down').disabled = textScaleIndex === 0;
  document.getElementById('btn-text-scale-up').disabled   = textScaleIndex === TEXT_SCALE_STEPS.length - 1;
  localStorage.setItem('squadra_text_scale_index', textScaleIndex);
}
function increaseTextScale() {
  if (textScaleIndex < TEXT_SCALE_STEPS.length - 1) { textScaleIndex++; applyTextScale(); }
}
function decreaseTextScale() {
  if (textScaleIndex > 0) { textScaleIndex--; applyTextScale(); }
}
initTextScale();

// ─── INIT ─────────────────────────────────────────────────────────────────────
load().then(() => {
  if (!S.consultants?.length) seedDemo();
  populateProfileSelect();
  openModalA11y('profile-overlay'); // ouverte par défaut au premier chargement (voir index.html)
});

// ─── PROFILE (panneau de lancement) ─────────────────────────────────────────
function populateProfileSelect(preselect) {
  const sel = document.getElementById('profile-select');
  sel.innerHTML = '';
  const manager = document.createElement('option');
  manager.value = 'manager';
  manager.textContent = 'Manager — vue globale';
  sel.appendChild(manager);
  S.consultants.forEach(c => {
    const o = document.createElement('option');
    o.value = c.id;
    o.textContent = c.name;
    sel.appendChild(o);
  });
  if (preselect) sel.value = preselect;
}

function confirmProfile() {
  const val = document.getElementById('profile-select').value;
  if (val === 'manager') {
    currentProfile = { type: 'manager' };
    filterCons = null;
  } else {
    currentProfile = { type: 'consultant', id: val };
    filterCons = val;
  }
  closeModal('profile-overlay');
  const badge = document.getElementById('profile-badge-label');
  badge.textContent = currentProfile.type === 'manager'
    ? 'Connecté : Manager'
    : `Connecté : ${S.consultants.find(c => c.id === val)?.name || ''}`;
  render();
}

// ─── SIDEBAR EN TIROIR (fenêtre étroite <900px) ─────────────────────────────
// Sous 900px, la sidebar devient un tiroir superposé (voir styles/organisms/sidebar.css) et
// regroupe aussi les 2 boutons "Ajouter..." de la topbar (déplacés ici, pas dupliqués : mêmes
// éléments DOM relocalisés, pour garder onclick/id intacts et éviter toute désynchronisation).
const mqNarrow = window.matchMedia('(max-width: 900px)');

function relocateTopbarActions(e) {
  const narrow = e ? e.matches : mqNarrow.matches;
  const slot = document.getElementById('sidebar-actions');
  const anchor = document.getElementById('topbar-actions');
  const btnOpp = document.getElementById('btn-add-opportunite');
  const btnPrest = document.getElementById('btn-add-prestation');
  if (narrow) { slot.appendChild(btnOpp); slot.appendChild(btnPrest); }
  else        { anchor.appendChild(btnOpp); anchor.appendChild(btnPrest); }
}
mqNarrow.addEventListener('change', relocateTopbarActions);
relocateTopbarActions();

function openSidebarDrawer() {
  document.getElementById('sidebar').classList.add('open');
  document.getElementById('sidebar-backdrop').classList.add('open');
  document.getElementById('btn-sidebar-toggle').setAttribute('aria-expanded', 'true');
}
function closeSidebarDrawer() {
  document.getElementById('sidebar').classList.remove('open');
  document.getElementById('sidebar-backdrop').classList.remove('open');
  document.getElementById('btn-sidebar-toggle').setAttribute('aria-expanded', 'false');
}
function toggleSidebarDrawer() {
  document.getElementById('sidebar').classList.contains('open') ? closeSidebarDrawer() : openSidebarDrawer();
}
// Ferme le tiroir dès qu'une action est choisie dedans (navigation, filtre consultant,
// "Ajouter...") — évite qu'il reste ouvert par-dessus le contenu après un choix.
document.getElementById('sidebar').addEventListener('click', (e) => {
  if (mqNarrow.matches && e.target.closest('button, .nav-item')) closeSidebarDrawer();
});
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && document.getElementById('sidebar').classList.contains('open')) closeSidebarDrawer();
});

function openProfileSwitcher() {
  document.getElementById('user-menu').removeAttribute('open');
  const preselect = currentProfile?.type === 'manager' ? 'manager' : currentProfile?.id;
  populateProfileSelect(preselect);
  document.getElementById('profile-overlay').classList.add('open');
  openModalA11y('profile-overlay');
}

// Ferme le menu utilisateur (barre du haut) au clic en dehors — <details> ne le fait pas nativement.
document.addEventListener('click', (e) => {
  const menu = document.getElementById('user-menu');
  if (menu?.open && !menu.contains(e.target)) menu.removeAttribute('open');
});

// ─── RENDER DISPATCHER ───────────────────────────────────────────────────────
function render() {
  renderSidebar();
  if      (currentView === 'gantt') renderGantt();
  else if (currentView === 'list')  renderList();
  else                               renderStats();
}

// ─── SIDEBAR ─────────────────────────────────────────────────────────────────
function renderSidebar() {
  const isConsultant = currentProfile?.type === 'consultant';
  document.getElementById('cons-count').textContent = S.consultants.length;
  const el = document.getElementById('cons-list');
  el.innerHTML = '';

  document.getElementById('btn-add-consultant').style.display = isConsultant ? 'none' : 'flex';

  if (!isConsultant) {
    // All
    const all = document.createElement('div');
    all.className = 'consultant-item' + (filterCons === null ? ' active' : '');
    all.innerHTML = `
      <div class="avatar" style="background:var(--surface2);color:var(--text-dim)">
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>
      </div>
      <div class="consultant-name">Toute l'équipe</div>`;
    all.onclick = () => { filterCons = null; render(); };
    el.appendChild(all);
  }

  const cons = isConsultant ? S.consultants.filter(c => c.id === currentProfile.id) : S.consultants;
  cons.forEach(c => {
    const color = consColor(c.id);
    const item  = document.createElement('div');
    item.className = 'consultant-item' + (filterCons === c.id ? ' active' : '');
    item.innerHTML = `
      <div class="avatar" style="background:${color}22;color:${color}">${initials(c.name)}</div>
      <div class="consultant-name">${c.name}<small>${c.role || ''}</small>${consultantStatusPills(c)}</div>
      <button class="btn-icon" onclick="event.stopPropagation();openConsModal('${c.id}')" title="Modifier" aria-label="Modifier ${c.name}">
        <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
      </button>`;
    item.onclick = () => { filterCons = c.id; render(); };
    el.appendChild(item);
  });
}

// ─── GANTT ────────────────────────────────────────────────────────────────────
let ganttScrollInitialized = false; // centre sur aujourd'hui une seule fois, au tout 1er rendu
function renderGantt() {
  const scroller = document.getElementById('gantt-scroll');
  const prevScrollTop  = scroller.scrollTop;
  const prevScrollLeft = scroller.scrollLeft;
  const today = new Date();
  const rangeStart = new Date(today.getFullYear(), today.getMonth() + GANTT_OFFSET, 1);
  const months = [];
  for (let i = 0; i < GANTT_MONTHS; i++) {
    months.push(new Date(rangeStart.getFullYear(), rangeStart.getMonth() + i, 1));
  }
  const rangeEnd = new Date(rangeStart.getFullYear(), rangeStart.getMonth() + GANTT_MONTHS, 0);
  const totalDays = (rangeEnd - rangeStart) / 86400000 + 1;

  function px(dateStr) {
    const days = (new Date(dateStr + 'T00:00:00') - rangeStart) / 86400000;
    return Math.max(0, Math.min(100, days / totalDays * 100));
  }
  function clamp(v) { return Math.max(0, Math.min(100, v)); }

  // Header
  const mEl = document.getElementById('gantt-months');
  mEl.innerHTML = '';
  months.forEach(m => {
    const isCurrent = m.getFullYear() === today.getFullYear() && m.getMonth() === today.getMonth();
    const div = document.createElement('div');
    div.className = 'gantt-month' + (isCurrent ? ' current-month' : '');
    div.innerHTML = `<span class="gantt-month-label">${m.toLocaleDateString('fr-FR',{month:'short'})}</span><span class="gantt-month-year">${m.getFullYear()}</span>`;
    mEl.appendChild(div);
  });

  const todayPct = px(today.toISOString().slice(0,10));
  document.getElementById('gantt-label-col').textContent = viewMode === 'clients' ? 'Client' : 'Consultant';
  // #gantt-wrapper n'avait que min-width:100% : sans largeur explicite, un bloc en display:flex
  // ne s'agrandit jamais pour ses enfants qui débordent (ici les 36 colonnes-mois à min-width
  // 80px). Conséquence concrète : la colonne des noms (position:sticky) ne pouvait rester figée
  // que sur ~1 écran de large, puis "décrochait" et défilait comme le reste — et les barres,
  // positionnées en % de .gantt-timeline, se calculaient sur cette même largeur trop étroite au
  // lieu des 36 mois réels, donc la ligne entière (nom + barres) disparaissait au-delà. Fixer la
  // largeur du wrapper au total réel (colonne des noms + 36 mois) règle les deux à la source.
  const labelColWidth = document.getElementById('gantt-label-col').offsetWidth;
  const colW = ganttColWidth();
  document.getElementById('gantt-wrapper').style.width = (labelColWidth + colW * GANTT_MONTHS) + 'px';
  const rowsData = ganttRowsData();
  const rows = document.getElementById('gantt-rows');
  rows.innerHTML = '';

  if (!rowsData.length) {
    rows.innerHTML = viewMode === 'clients'
      ? `<div class="empty-state"><h3>Aucun client</h3><p>Ajoutez une opportunité ou une prestation.</p></div>`
      : `<div class="empty-state"><h3>Aucun consultant</h3><p>Ajoutez des consultants depuis le panneau gauche.</p></div>`;
    return;
  }

  rowsData.forEach((row, idx) => {
    const stacked = stackBars(row.items);
    const rowH = Math.max(54, stacked.length * 40 + 14);

    const rowEl = document.createElement('div');
    rowEl.className = 'gantt-row';
    rowEl.style.minHeight = rowH + 'px';
    rowEl.innerHTML = `
      <div class="gantt-row-label" style="min-height:${rowH}px">${row.label}</div>
      <div class="gantt-timeline" id="tl-${idx}" style="min-height:${rowH}px"></div>`;
    rows.appendChild(rowEl);

    const tl = document.getElementById(`tl-${idx}`);

    // Grid lines + today
    months.forEach((_, i) => {
      const l = document.createElement('div');
      l.className = 'gantt-grid-line';
      l.style.left = (i / GANTT_MONTHS * 100) + '%';
      tl.appendChild(l);
    });
    // Ligne de fermeture à droite : la boucle ci-dessus ne pose une ligne qu'au début de
    // chaque mois, donc sans elle le dernier mois affiché n'a pas de bordure sur son bord droit.
    const closingLine = document.createElement('div');
    closingLine.className = 'gantt-grid-line';
    closingLine.style.right = '0';
    tl.appendChild(closingLine);
    if (todayPct > 0 && todayPct < 100) {
      const t = document.createElement('div');
      t.className = 'gantt-today-line';
      t.style.left = todayPct + '%';
      t.title = "Aujourd'hui";
      tl.appendChild(t);
    }

    // Bars — each segment positioned absolutely (left/width as % of timeline)
    stacked.forEach((stackRow, rowIdx) => {
      stackRow.forEach(p => {
        const startPct = px(p.startDate);
        const endPct   = px(p.endDate);
        const top      = 12 + rowIdx * 40;
        const label    = p.client + (p.clientService ? ` · ${p.clientService}` : '');
        const pId      = p.id;
        const tt = p.kind === 'pipeline'
          ? buildPipelineTooltip(p)
          : buildTooltip(p, S.consultants.find(x => x.id === p.consultantId));
        const onClick = p.kind === 'pipeline'
          ? () => openOpportuniteModal(S.opportunites.find(o => o.id === p.oppId))
          : () => openPrestModal(S.prestations.find(x => x.id === pId));
        // Statut calculé pour une vraie prestation ; les items pipeline gardent leur statut
        // littéral 'pipeline' (fixé par pipelineItemFrom*()), pas de date à comparer pour eux.
        const barStatus = p.kind === 'pipeline' ? p.status : prestationStatus(p);

        const endEvt = p.kind === 'pipeline' ? null : lastEndEvent(p);

        const maxRight = Math.max(endPct,
          endEvt?.type === 'prolongation' ? px(endEvt.date) : endPct);
        if (maxRight <= 0 || startPct >= 100) return;

        function seg(cls, left, width, extraStyle, html) {
          if (width <= 0) return;
          const el = document.createElement('div');
          el.className = cls;
          el.style.cssText = `position:absolute;left:${left}%;width:${Math.max(0.4,width)}%;top:${top}px;${extraStyle||''}`;
          el.innerHTML = html || '';
          el.title = tt;
          el.onclick = onClick;
          tl.appendChild(el);
        }

        if (endEvt?.type === 'prolongation' && endEvt.date > p.endDate) {
          const mainL = clamp(startPct);
          const mainW = clamp(endPct) - mainL;
          const extL  = clamp(endPct);
          const extW  = clamp(px(endEvt.date)) - extL;
          seg(`prest-bar bar-${barStatus}`, mainL, mainW,
            extW > 0 ? 'border-radius:4px 0 0 4px;' : '',
            `<div class="bar-dot"></div>${label}`);
          if (extW > 0)
            seg(`ext-bar ext-bar-${barStatus}`, extL, extW, '', `↗ ${fmtD(endEvt.date)}`);

        } else if (endEvt?.type === 'sortie_anticipee' && endEvt.date < p.endDate) {
          const exitPct = px(endEvt.date);
          const mainL   = clamp(startPct);
          const mainW   = clamp(exitPct) - mainL;
          const tailL   = clamp(exitPct);
          const tailW   = clamp(endPct) - tailL;
          seg(`prest-bar bar-${barStatus}`, mainL, mainW,
            tailW > 0 ? 'border-radius:4px 0 0 4px;' : '',
            `<div class="bar-dot"></div>${label}`);
          if (tailW > 0)
            seg('exit-bar', tailL, tailW, '', '');

        } else {
          const effPct = px(effectiveEnd(p));
          seg(`prest-bar bar-${barStatus}`, clamp(startPct), clamp(effPct) - clamp(startPct), '',
            `<div class="bar-dot"></div>${label}`);
        }
      });
    });
  });

  scroller.scrollTop = prevScrollTop;
  if (ganttScrollInitialized) {
    scroller.scrollLeft = prevScrollLeft;
  } else {
    scrollGanttToToday();
    ganttScrollInitialized = true;
  }
}

// Largeur réelle d'une colonne-mois, mesurée dans le DOM (fixe à ~80px dès que la fenêtre de
// 36 mois déborde du conteneur — voir .gantt-month{min-width:80px} — mais mesurer reste plus
// sûr que supposer cette valeur).
function ganttColWidth() {
  const monthEl = document.querySelector('.gantt-month');
  return monthEl ? monthEl.offsetWidth : 80;
}
function scrollGanttBy(monthsDelta) {
  document.getElementById('gantt-scroll').scrollBy({ left: monthsDelta * ganttColWidth(), behavior: 'smooth' });
}
function scrollGanttToToday() {
  const scroller = document.getElementById('gantt-scroll');
  const label = document.querySelector('.gantt-row-label');
  const todayLine = document.querySelector('.gantt-today-line');
  let target;
  if (label && todayLine) {
    // Positionné juste à droite de la colonne des noms (pas centré) : dès l'ouverture,
    // l'utilisateur voit tout de suite où on en est aujourd'hui, sans avoir à chercher la
    // ligne bleue dans l'écran. Mesure réelle (getBoundingClientRect) plutôt que calculée à
    // partir de la largeur de colonne-mois : évite de dépendre de la largeur de la barre
    // latérale ou du padding de la colonne des noms, qui faussaient un calcul en pourcentage.
    scroller.scrollLeft = 0;
    const labelRight = label.getBoundingClientRect().right;
    const todayLeft  = todayLine.getBoundingClientRect().left;
    target = Math.max(0, todayLeft - labelRight - 16);
  } else {
    // Aucune ligne "aujourd'hui" dans la fenêtre affichée (todayPct hors 0-100) : repli sur
    // la colonne-mois correspondante.
    const todayColIndex = -GANTT_OFFSET; // aujourd'hui tombe dans cette colonne-mois, par construction du rangeStart
    target = Math.max(0, todayColIndex * ganttColWidth());
  }
  scroller.scrollTo({ left: target, behavior: ganttScrollInitialized ? 'smooth' : 'auto' });
}

function buildTooltip(p, c) {
  let lines = [`${c.name}`, `${p.client}${p.clientService ? ' / '+p.clientService : ''}`,
    `${fmtD(p.startDate)} → ${fmtD(p.endDate)}`];
  const endEvt = lastEndEvent(p);
  if (endEvt?.type === 'prolongation')     lines.push(`Prolongé jusqu'au ${fmtD(endEvt.date)}`);
  if (endEvt?.type === 'sortie_anticipee') lines.push(`Sortie anticipée: ${fmtD(endEvt.date)}`);
  const pause = activePause(p, todayStr());
  if (pause) lines.push(`En pause depuis le ${fmtD(pause.date)}${pause.resumeDate ? ` (reprise le ${fmtD(pause.resumeDate)})` : ''}`);
  lines.push(`TJM: ${currentTjm(p).toLocaleString('fr-FR')} €/j`);
  return lines.join('\n');
}

function stackBars(prests) {
  const sorted = [...prests].sort((a,b) => a.startDate.localeCompare(b.startDate));
  const result = [];
  sorted.forEach(p => {
    let placed = false;
    for (let i = 0; i < result.length; i++) {
      const last = result[i][result[i].length - 1];
      if (p.startDate >= effectiveEnd(last)) { result[i].push(p); placed = true; break; }
    }
    if (!placed) result.push([p]);
  });
  return result;
}

function buildPipelineTooltip(item) {
  return [`Pipeline — ${item.client}${item.clientService ? ' / '+item.clientService : ''}`,
    item.label || '', `${fmtD(item.startDate)} → ${fmtD(item.endDate)}`].filter(Boolean).join('\n');
}

// Barre spéculative Gantt : uniquement tant que l'opportunité/candidature est encore en attente
// (gagnée → la vraie prestation couvre déjà la période ; perdue/abandonnée → ça n'a pas eu
// lieu) et seulement si les 2 dates prévisionnelles sont renseignées (sinon rien à tracer).
function pipelineItemFromOpportunite(opp) {
  if (opp.status !== 'ouvert' || !opp.startDate || !opp.endDate) return null;
  return { kind: 'pipeline', id: opp.id, oppId: opp.id, startDate: opp.startDate, endDate: opp.endDate,
    status: 'pipeline', client: opp.client, clientService: opp.clientService, label: opp.titre };
}
function pipelineItemFromCandidature(cand) {
  const opp = S.opportunites.find(o => o.id === cand.opportuniteId);
  if (!opp || cand.status !== 'en_attente' || !opp.startDate || !opp.endDate) return null;
  return { kind: 'pipeline', id: cand.id, oppId: opp.id, startDate: opp.startDate, endDate: opp.endDate,
    status: 'pipeline', client: opp.client, clientService: opp.clientService, label: opp.titre };
}

// Lignes du Gantt selon viewMode — même bascule globale que la Vue liste (setViewMode()).
// Mode clients : regroupement identique à renderListClients() (main.js), mais les items
// pipeline sont restreints aux opportunités encore "ouvert" (pas tout le cycle de vie).
function ganttRowsData() {
  if (viewMode === 'clients') {
    const opps = filterCons
      ? S.opportunites.filter(o => S.candidatures.some(c => c.opportuniteId===o.id && c.consultantId===filterCons))
      : S.opportunites;
    const clients = [...new Set([
      ...opps.map(o => o.client),
      ...S.prestations.filter(p => !filterCons || p.consultantId === filterCons).map(p => p.client),
    ])].sort((a,b) => a.localeCompare(b));

    return clients.map(client => {
      const prests = S.prestations
        .filter(p => p.client === client && (!filterCons || p.consultantId === filterCons) && matchStatusAndType('prestation', prestationStatus(p)))
        .map(p => ({...p, kind: 'prestation'}));
      const pipeline = opps
        .filter(o => o.client === client && matchStatusAndType('opportunite', o.status))
        .map(pipelineItemFromOpportunite).filter(Boolean);
      return { id: client, label: client, items: [...prests, ...pipeline] };
    });
  }

  const cons = filterCons ? S.consultants.filter(c => c.id === filterCons) : S.consultants;
  return cons.map(c => {
    const prests = S.prestations
      .filter(p => p.consultantId === c.id && matchStatusAndType('prestation', prestationStatus(p)))
      .map(p => ({...p, kind: 'prestation'}));
    const pipeline = S.candidatures
      .filter(cd => cd.consultantId === c.id && matchStatusAndType('candidature', cd.status))
      .map(pipelineItemFromCandidature).filter(Boolean);
    return { id: c.id, label: c.name, items: [...prests, ...pipeline] };
  });
}

// ─── LIST VIEW ────────────────────────────────────────────────────────────────
function renderList() {
  if (viewMode === 'clients') renderListClients();
  else renderListConsultants();
}

// ─── Ligne unifiée Opportunité / Mission ──────────────────────────────────────
// Une prestation et une opportunité (via une candidature) sont normalisées vers la même
// forme, pour tenir dans UNE seule chronologie (Statut/Type/Client/Dates/TJM/Activité) —
// c'est ce qui permet de comparer d'un coup d'œil ce qui est en pipeline vs confirmé,
// au lieu de deux tableaux au format différent.
// Historique complet d'un type de modification de fin de mission ("1re prolongation au ...,
// 2e au ..."), pour l'infobulle de la ligne — la ligne elle-même n'affiche que la dernière
// (lastEndEvent()), jamais tout l'historique en clair (prendrait trop de place).
const ORDINALS = ['1re','2e','3e','4e','5e','6e','7e','8e','9e','10e'];
function missionEndHistoryText(p, type) {
  const events = (p.missionEvents || []).filter(e => e.type === type);
  if (events.length <= 1) return '';
  const label = type === 'prolongation' ? 'prolongation' : 'sortie anticipée';
  return events.map((e,i) => `${ORDINALS[i] || (i+1)+'e'} ${label} au ${fmtD(e.date)}`).join(', ');
}

function prestationToRow(p, viewMode) {
  const tjmCur = currentTjm(p);
  const hasRevision = p.tjmRevisions?.length > 0;

  // Pause et origine restent à côté du service (colonne large) ; prolongation/sortie anticipée
  // restent avec les dates, dont elles redéfinissent la fin (voir dateLine plus bas).
  const modifiers = [];
  const pause = activePause(p, todayStr());
  if (pause)
    modifiers.push(`<span class="exit-label">⏸ En pause${pause.resumeDate ? ` → reprise ${fmtD(pause.resumeDate)}` : ''}</span>`);

  const endEvt = lastEndEvent(p);
  let dateLine = `${fmtD(p.startDate)} → ${fmtD(p.endDate)}`;
  if (endEvt?.type === 'prolongation' || endEvt?.type === 'sortie_anticipee') {
    const cls   = endEvt.type === 'prolongation' ? 'ext-label' : 'exit-label';
    const arrow = endEvt.type === 'prolongation' ? '↗ Prolongé' : '↙ Sortie anticipée';
    const hist  = missionEndHistoryText(p, endEvt.type);
    dateLine   += `<div class="${cls}"${hist ? ` title="${hist}"` : ''}>${arrow} → ${fmtD(endEvt.date)}</div>`;
  }

  const status = prestationStatus(p);

  // Alerte fin de mission proche (< 3 mois) — même seuil et code couleur que le widget
  // "Événements à venir" des Statistiques (buildEventsDiv()) : rouge sous 30 jours, orange au-delà.
  let alertLine = '';
  if (status === 'en_cours') {
    const daysToEnd = Math.round((new Date(effectiveEnd(p)+'T00:00:00') - new Date(todayStr()+'T00:00:00')) / 86400000);
    if (daysToEnd >= 0 && daysToEnd <= 90) {
      const color = daysToEnd <= 30 ? 'var(--red)' : 'var(--orange)';
      alertLine = `<span title="Fin de mission dans ${daysToEnd} j (${fmtD(effectiveEnd(p))})" style="color:${color}">⚠</span>`;
    }
  }

  // Vue Client : la carte regroupe déjà par client — l'info qui varie ligne à ligne est le
  // consultant staffé (absente avant ce correctif, cf. opportuniteToRow() qui a toujours fait
  // ça correctement avec le titre du besoin). Vue Consultant : inverse, comportement historique
  // inchangé (la carte regroupe par consultant, l'info qui varie est le client).
  const consultant = S.consultants.find(c => c.id === p.consultantId);
  const clientLine = viewMode === 'clients' ? (consultant ? consultant.name : 'Consultant supprimé') : p.client;

  return {
    sortDate: p.startDate,
    statusClass: `pill-${status}`, statusLabel: statusLabel(status),
    typeClass: `nature-${p.nature||'mission'}`, typeLabel: natureLabel(p.nature),
    profilLine: p.titre || '',
    clientLine, whoLabel: clientLine, // whoLabel : version texte brut de clientLine, pour l'aria-label du bouton Modifier (clientLine peut contenir du HTML dans opportuniteToRow)
    subLine: [p.clientService, ...modifiers].filter(Boolean).join(' · '),
    dateLine,
    valueLine: `${tjmCur.toLocaleString('fr-FR')} €/j${hasRevision?`<small>base: ${p.tjm.toLocaleString('fr-FR')} €</small>`:''}`,
    activiteLine: `${(p.fte||5)}/5`,
    alertLine,
    onClick: `openPrestModal(S.prestations.find(x=>x.id==='${p.id}'))`,
  };
}

// Dates affichées d'une opportunité : la plage prévisionnelle si les 2 dates sont renseignées
// (même format que les prestations), sinon la date de création — un seul côté renseigné
// compte comme "absent" (pas plus traçable qu'une paire vide, cf. règle du Gantt).
function oppDateInfo(opp) {
  if (opp.startDate && opp.endDate)
    return { sortDate: opp.startDate, dateLine: `${fmtD(opp.startDate)} → ${fmtD(opp.endDate)}` };
  return { sortDate: opp.createdAt, dateLine: `Ouverte le ${fmtD(opp.createdAt)}` };
}

// Vue Client : une ligne par opportunité, tous ses candidats listés dans la sous-ligne.
function opportuniteToRow(opp, cands) {
  const candNames = cands.length
    ? cands.map(c => {
        const cons = S.consultants.find(x => x.id === c.consultantId);
        const color = c.status==='gagnee' ? 'var(--green)' : c.status==='perdue' ? 'var(--red)' : 'var(--text-dim)';
        const strike = c.status==='perdue' ? 'text-decoration:line-through;' : '';
        // Gagnée/perdue ne se distinguent pas que par la couleur (RGAA 3.1) : le ✓ et le barré
        // restent visibles même sans percevoir le vert/rouge.
        const prefix = c.status==='gagnee' ? '✓ ' : '';
        return `<span style="color:${color};${strike}">${prefix}${cons ? cons.name : 'Consultant supprimé'}</span>`;
      }).join(', ')
    : `<span style="color:var(--text-muted)">Aucun candidat</span>`;
  const { sortDate, dateLine } = oppDateInfo(opp);
  return {
    sortDate,
    statusClass: `pill-opp-${opp.status}`, statusLabel: opportuniteStatusLabel(opp.status),
    typeClass: 'nature-opportunite', typeLabel: 'Opportunité', originLine: '',
    profilLine: opp.titre || '',
    // "Qui" = les candidats (pas encore un consultant confirmé) — même principe que la
    // prestation en Vue Clients : la carte regroupe déjà par client, l'info qui varie ligne à
    // ligne est le(s) candidat(s), pas le titre du besoin (désormais dans profilLine).
    clientLine: candNames, whoLabel: opp.client,
    subLine: opp.clientService || '',
    dateLine,
    valueLine: '—', activiteLine: '—', alertLine: '',
    onClick: `openOpportuniteModal(S.opportunites.find(x=>x.id==='${opp.id}'))`,
  };
}

// Vue Consultants : une ligne par candidature de ce consultant (statut = le sien sur cette
// opportunité, pas le statut global de l'opportunité — c'est ça qui l'intéresse lui).
function candidatureToRow(cand) {
  const opp = S.opportunites.find(o => o.id === cand.opportuniteId);
  if (!opp) return null;
  return {
    statusClass: `pill-cand-${cand.status}`, statusLabel: candidatureStatusLabel(cand.status),
    typeClass: 'nature-opportunite', typeLabel: 'Opportunité', originLine: '',
    profilLine: opp.titre || '',
    clientLine: opp.client, whoLabel: opp.client,
    subLine: opp.clientService || '',
    ...oppDateInfo(opp),
    valueLine: '—', activiteLine: '—', alertLine: '',
    onClick: `openOpportuniteModal(S.opportunites.find(x=>x.id==='${opp.id}'))`,
  };
}

// whoHeader : libellé de la colonne "qui" — "Consultant" en Vue Clients (la carte regroupe déjà
// par client), "Client / Service" en Vue Consultants (la carte regroupe déjà par consultant).
function buildUnifiedTableHtml(items, whoHeader) {
  if (!items.length) return '';
  const header = `<div class="prest-header-row"><span>Statut</span><span>Type</span><span>Profil</span><span>${whoHeader}</span><span>Dates</span><span style="text-align:right">TJM</span><span style="text-align:right">Activité</span><span></span><span></span></div>`;
  const rows = items.slice().sort((a,b) => b.sortDate.localeCompare(a.sortDate)).map(it => `
    <div class="prest-row">
      <span class="status-pill ${it.statusClass}">${it.statusLabel}</span>
      <div class="prest-type">
        <span class="nature-badge ${it.typeClass}">${it.typeLabel}</span>
        ${it.originLine||''}
      </div>
      <div class="prest-profil${it.profilLine?'':' prest-profil-empty'}">${it.profilLine||'<span style="color:var(--text-muted)">—</span>'}</div>
      <div class="prest-client">${it.clientLine}<small>${it.subLine||''}</small></div>
      <div class="prest-dates">${it.dateLine}</div>
      <div class="prest-tjm">${it.valueLine}</div>
      <div class="prest-activite">${it.activiteLine}</div>
      <div class="prest-alert">${it.alertLine||''}</div>
      <button class="btn-icon prest-edit" onclick="${it.onClick}" title="Modifier" aria-label="Modifier ${it.typeLabel} — ${it.whoLabel}">
        <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
      </button>
    </div>`).join('');
  return header + rows;
}

function renderListConsultants() {
  const el = document.getElementById('list-view');
  const prevScrollTop = el.scrollTop;
  el.innerHTML = '';
  const cons = filterCons ? S.consultants.filter(c=>c.id===filterCons) : S.consultants;

  cons.forEach(c => {
    const color = consColor(c.id);
    const items = [
      ...S.prestations.filter(p => p.consultantId === c.id && matchStatusAndType('prestation', prestationStatus(p))).map(p => prestationToRow(p, 'consultants')),
      // Une candidature gagnée a déjà sa continuité portée par la prestation qui en est issue
      // (repère "🔗 Issue d'une opportunité", voir prestationToRow()) — pas besoin d'une 2e ligne
      // pour la même histoire.
      ...S.candidatures.filter(cd => cd.consultantId === c.id && cd.status !== 'gagnee' && matchStatusAndType('candidature', cd.status)).map(candidatureToRow).filter(Boolean),
    ];

    const card = document.createElement('div');
    card.className = 'list-card';

    const rows = items.length
      ? buildUnifiedTableHtml(items, 'Client / Service')
      : `<div style="padding:14px 16px;font-size:var(--text-base);color:var(--text-muted)">Aucune prestation ni opportunité${(filterStatus!=='all'||filterType!=='all')?' pour ce filtre':''}</div>`;

    card.innerHTML = `
      <div class="list-card-header">
        <div class="avatar" style="background:${color}22;color:${color}">${initials(c.name)}</div>
        <div style="flex:1">
          <div style="font-size:var(--text-md);font-weight:600">${c.name}</div>
          <div style="font-size:var(--text-sm);color:var(--text-muted)">${c.role||''}</div>
        </div>
        <button class="btn-primary" style="padding:5px 10px;font-size:var(--text-sm)" onclick="openPrestModal(null,'${c.id}')">+ Prestation</button>
      </div>
      <div class="list-card-body">${rows}</div>`;
    el.appendChild(card);
  });

  el.scrollTop = prevScrollTop;
}

// ─── VUE LISTE — mode Clients (Opportunités + missions du client, 1 seul tableau) ─────
function renderListClients() {
  const el = document.getElementById('list-view');
  const prevScrollTop = el.scrollTop;
  el.innerHTML = '';

  const opps = filterCons
    ? S.opportunites.filter(o => S.candidatures.some(c => c.opportuniteId===o.id && c.consultantId===filterCons))
    : S.opportunites;
  const clients = [...new Set([
    ...opps.map(o => o.client),
    ...S.prestations
      .filter(p => !filterCons || p.consultantId === filterCons)
      .map(p => p.client),
  ])].sort((a,b) => a.localeCompare(b));

  if (!clients.length) {
    el.innerHTML = `<div style="padding:20px;text-align:center;color:var(--text-muted);font-size:var(--text-base)">Aucun client${filterCons?' pour ce consultant':''}</div>`;
    return;
  }

  clients.forEach(client => {
    // Une opportunité "Gagnée" (o.status === 'pourvu') a déjà sa continuité portée par la
    // prestation qui en est issue (repère "🔗 Issue d'une opportunité", voir prestationToRow()) —
    // pas besoin d'une 2e ligne pour la même histoire.
    const clientOpps = opps.filter(o => o.client === client && o.status !== 'pourvu' && matchStatusAndType('opportunite', o.status));
    const clientPrests = S.prestations
      .filter(p => p.client === client && (!filterCons || p.consultantId === filterCons) && matchStatusAndType('prestation', prestationStatus(p)));
    const items = [
      ...clientOpps.map(opp => opportuniteToRow(opp, S.candidatures.filter(c => c.opportuniteId === opp.id))),
      ...clientPrests.map(p => prestationToRow(p, 'clients')),
    ];

    const card = document.createElement('div');
    card.className = 'list-card';

    const body = items.length
      ? buildUnifiedTableHtml(items, 'Consultant')
      : `<div style="padding:14px 16px;font-size:var(--text-base);color:var(--text-muted)">Aucune opportunité ni mission</div>`;

    card.innerHTML = `
      <div class="list-card-header">
        <div class="avatar" style="background:var(--surface2);color:var(--text-dim)">${initials(client)}</div>
        <div style="flex:1">
          <div style="font-size:var(--text-md);font-weight:600">${client}</div>
        </div>
        <button class="btn-primary" style="padding:5px 10px;font-size:var(--text-sm)" onclick="openOpportuniteModal(null,'${client}')">+ Opportunité</button>
      </div>
      <div class="list-card-body">${body}</div>`;
    el.appendChild(card);
  });

  el.scrollTop = prevScrollTop;
}

// ─── STATS VIEW — section builders ────────────────────────────────────────────

function buildKpiStrip(kd, kpiLabel, kpiWorkDays, prevKd, nextKd, nextQLabel, allOpps, cons, chartMonths, chartRangeLabel, focusIdx) {
  const forecastTitle = `Projection basée sur les prestations déjà planifiées pour ${nextQLabel} — pas une prévision statistique.`;
  function forecast(val, fmt) {
    return `<div class="stat-forecast" title="${forecastTitle}">→ ${nextQLabel} (prévision) : ${val !== null && val !== undefined ? fmt(val) : '—'}</div>`;
  }
  const occColor      = kd.occRate >= 80 ? 'var(--green)' : kd.occRate >= 50 ? 'var(--yellow)' : 'var(--red)';
  const hasFinData    = cons.some(c => c.coutComplet > 0 || c.coutCompletRevisions?.length > 0);

  function statusPill(label, color, bg) {
    return `<span class="status-pill" style="text-transform:none;letter-spacing:normal;font-weight:600;white-space:nowrap;background:${bg};color:${color}">${label}</span>`;
  }

  let alertHtml = '';
  let caStatusPill = '';
  if (hasFinData && kd.caCible > 0) {
    const ecart    = kd.ca - kd.caCible;
    const ecartPct = Math.round(Math.abs(ecart) / kd.caCible * 100);
    const ok       = ecart >= 0;
    const color    = ok ? 'var(--green)' : 'var(--orange)';
    const bg       = ok ? 'var(--green-soft)' : 'var(--orange-soft)';
    const msg = ok
      ? '<strong style="color:var(--green)">Objectif tarif dépassé</strong> · CA confirmé supérieur de ' + ecartPct + '% (' + Math.round(ecart).toLocaleString('fr-FR') + ' €) au tarif cible — marge 32% couverte.'
      : '<strong style="color:var(--orange)">Ecart vs objectif : ' + Math.round(-ecart).toLocaleString('fr-FR') + ' €</strong> (−' + ecartPct + '%) · En-dessous du tarif cible. Remonter les TJM ou signer le pipeline.';
    alertHtml = '<div style="background:' + bg + ';border:1px solid ' + color + ';border-radius:var(--radius);padding:10px 14px;margin-bottom:20px;font-size:var(--text-sm);display:flex;align-items:center;gap:10px">'
      + '<span style="font-size:var(--text-xl);flex-shrink:0">' + (ok ? '✓' : '→') + '</span>'
      + '<span>' + msg + '</span></div>';
    caStatusPill = statusPill((ok ? '✓ Objectif atteint +' : 'Sous objectif −') + ecartPct + '%', color, bg);
  } else {
    // Pas d'objectif chiffré saisi : à défaut, l'activité (taux d'occupation) sert de repère
    // pour dire si le trimestre est bien engagé commercialement.
    caStatusPill = kd.occRate >= 80 ? statusPill('Activité soutenue', 'var(--green)', 'var(--green-soft)')
      : kd.occRate >= 50 ? statusPill('Activité modérée', 'var(--yellow)', 'var(--yellow-soft)')
      : statusPill('Activité faible', 'var(--red)', 'var(--red-soft)');
  }
  const caTrendBadge = trendBadge(kd.ca, prevKd.ca);

  const margeStatusPill = kd.margePctVal === null ? '' :
    kd.margePctVal >= 20 ? statusPill(`Marge saine · ${kd.margePctVal}%`, 'var(--green)', 'var(--green-soft)')
    : kd.margePctVal >= 10 ? statusPill(`Marge à surveiller · ${kd.margePctVal}%`, 'var(--yellow)', 'var(--yellow-soft)')
    : statusPill(`Marge faible · ${kd.margePctVal}%`, 'var(--red)', 'var(--red-soft)');
  const margeTrendBadge = kd.margePctVal === null ? '' : trendBadge(kd.margePctVal, prevKd.margePctVal);

  // Palette validée pour un fond sombre (script d'accessibilité de la skill dataviz : bande de
  // clarté, séparation daltonisme ΔE, contraste — tout passe sur le fond var(--surface) de l'app).
  // L'ordre des couleurs fait partie de la garantie d'accessibilité : ne pas le changer.
  // Chaque courbe a aussi un pointillé et une forme de repère propres, pour rester
  // distinguable même sans percevoir la couleur.
  // Graphique 1 "CA & Pipeline" : où on en est vs l'objectif commercial. Le pipeline vient
  // maintenant du vrai S.opportunites (TJM/dates optionnels saisis dès l'Opportunité).
  const caDefs = [
    { key: 'caPipeline', label: 'CA en négociation',         color: 'var(--chart-ca-pipeline)', dash: '0',        shape: 'circle',      always: true },
    { key: 'ca',         label: 'CA Confirmé',               color: 'var(--chart-ca-confirme)', dash: '2,3',       shape: 'diamond',     always: true },
    { key: 'caTotal',    label: 'CA Total prévisionnel',     color: 'var(--chart-ca-total)', dash: '9,3,2,3',   shape: 'triangle',    always: true },
    { key: 'caCible',    label: 'Objectif CA (Tarif Cible)', color: 'var(--chart-objectif)', dash: '1,4',       shape: 'triangleDown', always: false },
  ];
  // Graphique 2 "Marge & Rentabilité" : est-on rentable. Le CA Confirmé y est repris en repère
  // discret (même label, donc même bouton de légende que dans le graphique 1) pour donner du
  // sens à la masse salariale / marge brute sans dupliquer tout le pipeline commercial.
  const margeDefs = [
    { key: 'masseSalariale', label: 'Masse salariale', color: 'var(--chart-masse-salariale)', dash: '7,3',     shape: 'square', always: false },
    { key: 'margeVal',       label: 'Marge brute',     color: 'var(--chart-marge)', dash: '6,2,1,2', shape: 'cross',  always: false },
    { key: 'ca',             label: 'CA Confirmé',     color: 'var(--chart-ca-confirme)', dash: '2,3',     shape: 'diamond', always: true, reference: true },
  ];
  function toSeries(def) {
    return { label: def.label, color: def.color, dash: def.dash, shape: def.shape, reference: def.reference, values: chartMonths.map(m => m.d[def.key]) };
  }
  const caSeries = caDefs
    .filter(def => def.always || (hasFinData && (def.key !== 'caCible' || chartMonths.some(m => m.d.caCible > 0))))
    .map(toSeries);
  const margeSeries = margeDefs
    .filter(def => def.always || hasFinData)
    .map(toSeries);

  // Même échelle verticale (et donc même ligne des 0 €) dans les deux graphiques, pour qu'ils
  // restent comparables côte à côte — indépendamment des courbes masquées via la légende.
  const caMargeAllVals = [...caSeries, ...margeSeries].flatMap(s => s.values.filter(v => v !== null && v !== undefined));
  const caMargeYDomain = {
    yMax: Math.max(0, ...caMargeAllVals) * 1.15 || 1,
    yMin: Math.min(0, Math.min(...caMargeAllVals) * 1.15),
  };

  const div = document.createElement('div');
  div.innerHTML = `
    <h3 class="section-title" style="margin-bottom:10px;padding-top:4px">
      Activité · ${kpiLabel} · base ${kpiWorkDays} j/trimestre
    </h3>
    <div class="stats-grid" style="margin-bottom:20px">
      <div class="stat-card">
        <div class="stat-label-row"><span class="stat-label">Consultants en mission</span>${trendBadge(kd.missions.length, prevKd.missions.length)}</div>
        <div class="stat-value" style="color:var(--green)">${kd.missions.length}</div>
        <div class="stat-sub">sur ${kd.consCount} consultant${kd.consCount>1?'s':''} dans l'effectif · ${kpiLabel}</div>
        ${forecast(nextKd.missions.length, v => String(v))}
      </div>
      <div class="stat-card">
        <div class="stat-label-row"><span class="stat-label">Taux d'occupation</span>${trendBadge(kd.occRate, prevKd.occRate)}</div>
        <div class="stat-value" style="color:${occColor}">${kd.occRate}%</div>
        <div class="stat-sub">${kd.totalFte}/${kd.maxFte} j/sem. · 100% = tous en mission</div>
        ${forecast(nextKd.occRate, v => v+'%')}
      </div>
      <div class="stat-card">
        <div class="stat-label-row"><span class="stat-label">Tarif journalier moyen</span>${trendBadge(kd.avgTjm, prevKd.avgTjm)}</div>
        <div class="stat-value" style="color:var(--accent)">${kd.avgTjm ? kd.avgTjm.toLocaleString('fr-FR')+' €/j' : '—'}</div>
        <div class="stat-sub">TJM moyen facturé · missions en cours</div>
        ${forecast(nextKd.avgTjm, v => v.toLocaleString('fr-FR')+' €/j')}
      </div>
      <div class="stat-card">
        <div class="stat-label-row"><span class="stat-label">Opportunités ouvertes</span></div>
        <div class="stat-value" style="color:var(--blue)">${allOpps.length}</div>
        <div class="stat-sub">Ouvertes actuellement · vrai pipeline (Opportunités)</div>
      </div>
    </div>
    <div style="display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:10px;margin-bottom:10px">
      <h3 class="section-title">
        Chiffre d'affaires & Marge · ${chartRangeLabel}
      </h3>
      <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap">
        <div style="display:flex;gap:6px">
          <button class="period-tab ${chartMode==='1y'?'active':''}" onclick="setChartMode('1y')">1 an</button>
          <button class="period-tab ${chartMode==='3y'?'active':''}" onclick="setChartMode('3y')">3 ans</button>
          <button class="period-tab ${chartMode==='5y'?'active':''}" onclick="setChartMode('5y')">5 ans</button>
        </div>
        ${chartMode==='1y' ? `
        <div style="display:flex;align-items:center;gap:4px">
          <button class="btn-icon" style="font-size:var(--text-md);font-weight:700" onclick="navChartYear(-1)" title="Année précédente" aria-label="Année précédente">‹</button>
          <span style="font-size:var(--text-sm);font-weight:600;min-width:36px;text-align:center">${chartYear}</span>
          <button class="btn-icon" style="font-size:var(--text-md);font-weight:700" onclick="navChartYear(1)" title="Année suivante" aria-label="Année suivante">›</button>
        </div>` : ''}
      </div>
    </div>
    <div class="ca-marge-charts-grid" style="margin-bottom:14px">
      <div class="chart-container">
        <div class="chart-title ca-marge-chart-title" style="display:flex;align-items:center;justify-content:space-between;gap:8px;flex-wrap:wrap">
          <span>CA & Pipeline</span>
          <span style="display:inline-flex;align-items:center;gap:6px;text-transform:none;letter-spacing:normal;font-weight:400" title="État au ${new Date().toLocaleDateString('fr-FR')} · tendance vs trimestre précédent">
            ${caStatusPill}${caTrendBadge}
          </span>
        </div>
        <div id="ca-chart-wrap"></div>
      </div>
      <div class="chart-container">
        <div class="chart-title ca-marge-chart-title" style="display:flex;align-items:center;justify-content:space-between;gap:8px;flex-wrap:wrap">
          <span>Marge & Rentabilité</span>
          <span style="display:inline-flex;align-items:center;gap:6px;text-transform:none;letter-spacing:normal;font-weight:400" title="État au ${new Date().toLocaleDateString('fr-FR')} · tendance vs trimestre précédent">
            ${margeStatusPill}${margeTrendBadge}
          </span>
        </div>
        <div id="marge-chart-wrap"></div>
      </div>
    </div>
    ${alertHtml}`;

  div.querySelector('#ca-chart-wrap').appendChild(buildMultiLineChart(chartMonths, caSeries, focusIdx, caMargeYDomain));
  div.querySelector('#marge-chart-wrap').appendChild(buildMultiLineChart(chartMonths, margeSeries, focusIdx, caMargeYDomain));
  return div;
}

function buildOccTable(pData, cons, isCurPeriod, consOcc, occClass) {
  const thCells = pData.map(pd =>
    '<th scope="col" class="' + (isCurPeriod(pd)?'occ-cur':'') + '" title="' + pd.label + '">' + pd.short + '</th>'
  ).join('');

  const bodyRows = cons.map(c => {
    const color = consColor(c.id);
    const cc    = currentCoutComplet(c, new Date().toISOString().slice(0,10)) || null;
    const tc    = cc ? Math.round(cc * 1.32) : null;
    const cells = pData.map(pd => {
      const fte = consOcc(c.id, pd.start, pd.end);
      const cls = occClass(fte) + (isCurPeriod(pd) ? ' occ-cur' : '');
      return '<td class="' + cls + '">' + (fte>0 ? fte+'/5' : '—') + '</td>';
    }).join('');
    return '<tr>'
      + '<td style="white-space:nowrap"><div style="display:flex;align-items:center;gap:8px">'
      + '<div class="avatar" style="width:22px;height:22px;font-size:var(--text-2xs);background:' + color + '22;color:' + color + ';flex-shrink:0">' + initials(c.name) + '</div>'
      + '<span>' + c.name + '</span></div></td>'
      + '<td style="text-align:right;color:var(--orange)">' + (cc ? cc.toLocaleString('fr-FR')+' €' : '—') + '</td>'
      + '<td style="text-align:right;color:var(--purple);font-weight:600">' + (tc ? tc.toLocaleString('fr-FR')+' €' : '—') + '</td>'
      + cells + '</tr>';
  }).join('');

  function mkFootRow(lbl, lblStyle, cellFn) {
    const tdOpen = lblStyle ? '<td style="' + lblStyle + '">' : '<td>';
    return '<tr>' + tdOpen + lbl + '</td><td></td><td></td>'
      + pData.map(pd => '<td class="' + (isCurPeriod(pd)?'occ-cur':'') + '">' + cellFn(pd) + '</td>').join('')
      + '</tr>';
  }

  const footRows = [
    mkFootRow('Missions', '', pd => '<span style="font-weight:700">'+pd.d.missions.length+'</span>'),
    mkFootRow('Occupation', '', pd => {
      const col = pd.d.occRate>=80 ? 'var(--green)' : pd.d.occRate>=50 ? 'var(--yellow)' : 'var(--text-muted)';
      return '<span style="color:'+col+';font-weight:700">'+pd.d.occRate+'%</span>';
    }),
    mkFootRow('TJM moyen', '', pd => pd.d.avgTjm ? '<span style="color:var(--accent)">'+pd.d.avgTjm+'€</span>' : '—'),
    mkFootRow('Masse salariale', 'color:var(--orange)', pd => {
      return pd.d.masseSalariale>0 ? '<span style="color:var(--orange)">'+Math.round(pd.d.masseSalariale/1000)+'k€</span>' : '—';
    }),
    mkFootRow('CA Cible (TC)', 'color:var(--purple)', pd => {
      return pd.d.caCible>0 ? '<span style="color:var(--purple)">'+Math.round(pd.d.caCible/1000)+'k€</span>' : '—';
    }),
  ].join('');

  const div = document.createElement('div');
  div.className = 'chart-container';
  div.innerHTML = `
    <div class="chart-title">Taux d'occupation par période
      <span style="font-weight:400;color:var(--text-muted)">
        · <span class="occ-full" style="padding:1px 6px;border-radius:3px">5/5</span> plein temps
        · <span class="occ-4" style="padding:1px 6px;border-radius:3px">4/5</span>
        · <span class="occ-3" style="padding:1px 6px;border-radius:3px">3/5</span> partiel
        · <span class="occ-over" style="padding:1px 6px;border-radius:3px">⚠ sur-alloué</span>
        &nbsp;·&nbsp;<span style="color:var(--orange)">CC</span> = Coût complet/j
        &nbsp;·&nbsp;<span style="color:var(--purple)">TC</span> = Tarif cible/j (CC × 1,32)
      </span>
    </div>
    <div style="overflow-x:auto">
      <table class="occ-table">
        <thead><tr><th scope="col">Consultant</th><th scope="col" style="text-align:right;color:var(--orange)">CC (€/j)</th><th scope="col" style="text-align:right;color:var(--purple)">TC (€/j)</th>${thCells}</tr></thead>
        <tbody>${bodyRows}</tbody>
        <tfoot>${footRows}</tfoot>
      </table>
    </div>`;
  return div;
}

function buildFinTable(pData, wLabel, wPeriod, isCurPeriod) {
  function kEur(v) { return v >= 1000 ? Math.round(v/1000)+'k€' : Math.round(v)+'€'; }
  function pct(v)  { return v+'%'; }

  function finRow(label, color, vals, fmt) {
    const cells = vals.map((v, i) => {
      const col = typeof color === 'function' ? color(v) : color;
      return '<td class="' + (isCurPeriod(pData[i])?'occ-cur':'') + '" style="text-align:right;color:' + col + '">' + (v != null ? fmt(v) : '—') + '</td>';
    }).join('');
    return '<tr><td style="font-size:var(--text-sm);white-space:nowrap;color:var(--text-dim)">' + label + '</td>' + cells + '</tr>';
  }

  const thCells = pData.map(pd =>
    '<th scope="col" class="' + (isCurPeriod(pd)?'occ-cur':'') + '" style="text-align:right" title="' + pd.label + '">' + pd.short + '</th>'
  ).join('');

  const msRows = pData.some(pd => pd.d.masseSalariale > 0) ? [
    finRow('Masse salariale (coût employeur)', 'var(--orange)', pData.map(pd=>pd.d.masseSalariale||null), kEur),
    finRow('Marge brute dégagée',  v => v==null?'var(--text-muted)':v>=0?'var(--green)':'var(--red)', pData.map(pd=>pd.d.margeVal), kEur),
    finRow('Taux de marge',        v => v==null?'var(--text-muted)':v>=20?'var(--green)':v>=10?'var(--yellow)':'var(--red)', pData.map(pd=>pd.d.margePctVal), pct),
    finRow('Objectif CA (Tarif Cible)', 'var(--purple)', pData.map(pd=>pd.d.caCible||null), kEur),
  ] : [];

  const rows = [
    finRow('CA Confirmé (missions signées)',  'var(--green)',  pData.map(pd=>pd.d.ca||null), kEur),
    finRow('CA en négociation (pipeline)',    'var(--blue)',   pData.map(pd=>pd.d.caPipeline||null), kEur),
    finRow('CA Total prévisionnel',           'var(--yellow)', pData.map(pd=>pd.d.caTotal||null), kEur),
    ...msRows,
  ].join('');

  const div = document.createElement('div');
  div.className = 'chart-container';
  div.innerHTML = `
    <div class="chart-title">Suivi financier par période
      <span style="font-weight:400;color:var(--text-muted);margin-left:8px;font-size:var(--text-xs)">· base ${wLabel} j ouvrés/${wPeriod} (218 j/an)</span>
    </div>
    <div style="overflow-x:auto">
      <table class="occ-table">
        <thead><tr><th scope="col" style="min-width:200px">Indicateur</th>${thCells}</tr></thead>
        <tbody>${rows}</tbody>
      </table>
    </div>`;
  return div;
}

function buildClientTable(curPD, cons, workDays) {
  const activeMissions = S.prestations.filter(p => {
    if (!cons.find(c => c.id === p.consultantId) || prestationStatus(p) !== 'en_cours') return false;
    const s = new Date(p.startDate + 'T00:00:00');
    const e = new Date(effectiveEnd(p) + 'T00:00:00');
    return s <= curPD.end && e >= curPD.start;
  });

  const byClient = {};
  activeMissions.forEach(p => {
    if (!byClient[p.client]) byClient[p.client] = { client: p.client, missions: [], consultants: new Set() };
    byClient[p.client].missions.push(p);
    byClient[p.client].consultants.add(p.consultantId);
  });

  const clientRows = Object.values(byClient)
    .sort((a, b) => b.missions.reduce((s,p)=>s+(p.fte||5),0) - a.missions.reduce((s,p)=>s+(p.fte||5),0));

  const tableRows = clientRows.map(cl => {
    const totalFte  = cl.missions.reduce((s,p)=>s+(p.fte||5), 0);
    const avgTjm    = Math.round(cl.missions.reduce((s,p)=>s+currentTjm(p), 0) / cl.missions.length);
    const ca        = cl.missions.reduce((s,p)=>s+currentTjm(p)*workDays*(p.fte||5)/5, 0);
    const natures   = [...new Set(cl.missions.map(p=>natureBadge(p.nature)))].join(' ');
    const consNames = [...cl.consultants].map(id => {
      const c = S.consultants.find(x=>x.id===id);
      return c ? '<span style="background:'+consColor(id)+'22;color:'+consColor(id)+';padding:1px 6px;border-radius:10px;font-size:var(--text-2xs)">'+initials(c.name)+'</span>' : '';
    }).join(' ');
    return '<tr>'
      + '<td><strong>' + cl.client + '</strong></td>'
      + '<td>' + consNames + '</td>'
      + '<td style="text-align:center">' + cl.missions.length + '</td>'
      + '<td style="text-align:center;font-weight:600">' + totalFte + '/5</td>'
      + '<td>' + natures + '</td>'
      + '<td style="color:var(--accent);font-weight:700">' + avgTjm.toLocaleString('fr-FR') + ' €/j</td>'
      + '<td style="color:var(--yellow);font-weight:700">' + Math.round(ca).toLocaleString('fr-FR') + ' €</td>'
      + '</tr>';
  }).join('');

  const div = document.createElement('div');
  div.className = 'chart-container';
  div.innerHTML = '<div class="chart-title">Répartition par client · ' + curPD.label + '</div>'
    + (clientRows.length
      ? '<div style="overflow-x:auto"><table class="client-table"><thead><tr>'
        + '<th scope="col">Client</th><th scope="col">Consultants</th><th scope="col" style="text-align:center">Missions</th>'
        + '<th scope="col" style="text-align:center">FTE</th><th scope="col">Nature</th>'
        + '<th scope="col" style="text-align:right">TJM moy.</th><th scope="col" style="text-align:right">CA estimé</th>'
        + '</tr></thead><tbody>' + tableRows + '</tbody></table></div>'
      : '<div style="color:var(--text-muted);font-size:var(--text-base);padding:4px 0">Aucune mission active sur cette période</div>');
  return div;
}

function buildEventsDiv(cons, today) {
  const horizon = new Date(today.getTime() + 90 * 86400000);

  const endings = S.prestations
    .filter(p => cons.find(c=>c.id===p.consultantId) && prestationStatus(p)==='en_cours')
    .map(p => ({ p, endD: new Date(effectiveEnd(p)+'T00:00:00') }))
    .filter(({endD}) => endD >= today && endD <= horizon)
    .sort((a,b) => a.endD - b.endD);

  // Opportunités encore ouvertes, dont la date de début prévue approche — remplace l'ancien
  // mécanisme (prestations spéculatives status==='opportunite'), rebranché sur le vrai pipeline.
  const upcoming = S.opportunites
    .filter(o => o.status === 'ouvert' && o.startDate)
    .filter(o => !filterCons || S.candidatures.some(cd => cd.opportuniteId === o.id && cd.consultantId === filterCons))
    .filter(o => new Date(o.startDate+'T00:00:00') <= horizon)
    .sort((a,b) => a.startDate.localeCompare(b.startDate));

  let evHtml = '';

  endings.forEach(({p, endD}) => {
    const c    = cons.find(x=>x.id===p.consultantId);
    const days = Math.round((endD - today) / 86400000);
    const col  = days <= 30 ? 'var(--red)' : 'var(--orange)';
    const evt  = lastEndEvent(p);
    const tag  = evt?.type === 'prolongation' ? ' (prolongé)' : evt?.type === 'sortie_anticipee' ? ' (anticipée)' : '';
    evHtml += '<div class="event-row">'
      + '<div class="event-dot" style="background:' + col + '"></div>'
      + '<div style="flex:1;min-width:0">'
      + '<div style="font-size:var(--text-base);font-weight:500">' + (c?.name||'') + ' — ' + p.client + (p.clientService ? ' / '+p.clientService : '') + '</div>'
      + '<div style="font-size:var(--text-xs);color:var(--text-muted)">Fin' + tag + ' : ' + fmtD(effectiveEnd(p)) + ' · ' + (p.fte||5) + '/5 · ' + currentTjm(p).toLocaleString('fr-FR') + ' €/j</div>'
      + '</div>'
      + '<span class="event-days" style="color:' + col + '">' + days + 'j</span>'
      + '<span class="status-pill pill-en_cours" style="font-size:var(--text-2xs)">Fin proche</span>'
      + '</div>';
  });

  upcoming.forEach(o => {
    const natureTxt = o.nature ? natureLabel(o.nature) : '';
    evHtml += '<div class="event-row" style="cursor:pointer" onclick="openOpportuniteModal(S.opportunites.find(x=>x.id===\'' + o.id + '\'))">'
      + '<div class="event-dot" style="background:var(--purple)"></div>'
      + '<div style="flex:1;min-width:0">'
      + '<div style="font-size:var(--text-base);font-weight:500">' + o.client + (o.clientService ? ' / '+o.clientService : '') + (o.titre ? ' — '+o.titre : '') + '</div>'
      + '<div style="font-size:var(--text-xs);color:var(--text-muted)">Démarrage prévu : ' + fmtD(o.startDate) + (natureTxt ? ' · '+natureTxt : '') + '</div>'
      + '</div>'
      + '<span class="status-pill pill-opp-ouvert" style="font-size:var(--text-2xs)">Ouvert</span>'
      + '</div>';
  });

  const div = document.createElement('div');
  div.className = 'chart-container';
  div.style.marginBottom = '20px';
  div.innerHTML = '<div class="chart-title">Prochaines échéances — 90 jours</div>'
    + (evHtml || '<div style="color:var(--text-muted);font-size:var(--text-base);padding:4px 0">Aucune échéance dans les 90 prochains jours</div>');
  return div;
}

// ─── STATS VIEW — orchestrateur ────────────────────────────────────────────────
function renderStats() {
  const root = document.getElementById('stats-view');
  const prevScrollTop = root.querySelector('.stats-scroll')?.scrollTop || 0;
  root.innerHTML = '';

  const today = new Date();
  const curY  = today.getFullYear();
  const curQ  = Math.floor(today.getMonth() / 3);
  const cons  = filterCons ? S.consultants.filter(c=>c.id===filterCons) : S.consultants;

  const scroll = document.createElement('div');
  scroll.className = 'stats-scroll';
  root.appendChild(scroll);

  // ── Calcul des périodes ────────────────────────────────────────────────────
  function getPeriods() {
    if (statsPeriod === 'quarterly') {
      const labels    = ['Q1','Q2','Q3','Q4'];
      const mStarts   = [0,3,6,9], mEnds = [2,5,8,11], mLastDays = [31,30,30,31];
      return labels.map((lbl, i) => ({
        label: lbl + ' ' + curY, short: lbl, qi: i,
        start: new Date(curY, mStarts[i], 1),
        end:   new Date(curY, mEnds[i], mLastDays[i], 23, 59, 59),
      }));
    }
    const n = statsPeriod === '5y' ? 5 : 10;
    const startY = curY - Math.floor(n * 0.4);
    return Array.from({length: n}, (_, i) => {
      const y = startY + i;
      return { label: String(y), short: String(y), qi: null, start: new Date(y,0,1), end: new Date(y,11,31,23,59,59) };
    });
  }

  function isCurPeriod(p) {
    return statsPeriod === 'quarterly' ? p.qi === curQ : p.label === String(curY);
  }

  // ── Calcul des données ─────────────────────────────────────────────────────
  function overlaps(prest, pStart, pEnd) {
    const s = new Date(prest.startDate + 'T00:00:00');
    const e = new Date(effectiveEnd(prest) + 'T00:00:00');
    return s <= pEnd && e >= pStart;
  }

  function activeIn(pStart, pEnd, statusFilter) {
    return S.prestations.filter(p =>
      cons.find(c=>c.id===p.consultantId) &&
      (statusFilter ? prestationStatus(p) === statusFilter : prestationStatus(p) !== 'terminee') &&
      overlaps(p, pStart, pEnd)
    );
  }

  // Vrai pipeline (S.opportunites) : une opportunité sans TJM ou sans les 2 dates n'est pas
  // chiffrable pour une période donnée — même règle que les barres pipeline du Gantt.
  function overlapsOpp(o, pStart, pEnd) {
    const s = new Date(o.startDate + 'T00:00:00');
    const e = new Date(o.endDate + 'T00:00:00');
    return s <= pEnd && e >= pStart;
  }
  function oppsActiveIn(pStart, pEnd) {
    return S.opportunites.filter(o =>
      o.status === 'ouvert' && o.tjm && o.startDate && o.endDate &&
      (!filterCons || S.candidatures.some(cd => cd.opportuniteId===o.id && cd.consultantId===filterCons)) &&
      overlapsOpp(o, pStart, pEnd)
    );
  }

  // Consultants qui font partie de l'effectif à un instant du période donnée (date d'entrée
  // atteinte, et pas encore sorti). Sans date d'entrée renseignée (anciennes fiches), on
  // considère le consultant toujours présent, pour rester rétrocompatible.
  function employedIn(pStart, pEnd) {
    return cons.filter(c => {
      if (c.dateEntree) {
        const entree = new Date(c.dateEntree + 'T00:00:00');
        if (entree > pEnd) return false;
      }
      if (c.dateSortie) {
        const sortie = new Date(c.dateSortie + 'T23:59:59');
        if (sortie < pStart) return false;
      }
      return true;
    });
  }

  function periodData(pStart, pEnd, wDaysOverride) {
    const wDays      = wDaysOverride ?? (statsPeriod === 'quarterly' ? 55 : 218);
    const pEndStr    = pEnd.toISOString().slice(0,10);
    const consInPeriod = employedIn(pStart, pEnd);
    const missions   = activeIn(pStart, pEnd, 'en_cours');
    const opps       = oppsActiveIn(pStart, pEnd);
    const totalFte   = missions.reduce((s,p) => s+(p.fte||5), 0);
    const maxFte     = consInPeriod.length * 5;
    const occRate    = maxFte > 0 ? Math.round(totalFte/maxFte*100) : 0;
    const avgTjm     = missions.length ? Math.round(missions.reduce((s,p)=>s+currentTjm(p),0)/missions.length) : null;
    const ca         = missions.reduce((s,p) => s+currentTjm(p)*wDays*(p.fte||5)/5, 0);
    const caPipeline = opps.reduce((s,o) => s+o.tjm*wDays*(o.fte||5)/5, 0);
    const masseSalariale = consInPeriod.reduce((s,c) => {
      const cc = currentCoutComplet(c, pEndStr);
      return cc > 0 ? s + cc*wDays : s;
    }, 0);
    const caCible    = missions.reduce((s,p) => {
      const c  = cons.find(x=>x.id===p.consultantId);
      const cc = c ? currentCoutComplet(c, pEndStr) : 0;
      return cc > 0 ? s + cc*1.32*wDays*(p.fte||5)/5 : s;
    }, 0);
    const margeVal    = masseSalariale > 0 ? ca - masseSalariale : null;
    const margePctVal = (margeVal !== null && ca > 0) ? Math.round(margeVal/ca*100) : null;
    return { missions, opps, totalFte, maxFte, consCount: consInPeriod.length, occRate, avgTjm, ca, caPipeline, caTotal: ca+caPipeline, masseSalariale, caCible, margeVal, margePctVal };
  }

  function consOcc(consultantId, pStart, pEnd) {
    return S.prestations
      .filter(p => p.consultantId===consultantId && prestationStatus(p)==='en_cours' && overlaps(p,pStart,pEnd))
      .reduce((sum,p) => sum+(p.fte||5), 0);
  }

  function occClass(fte) {
    if (fte===0) return 'occ-empty';
    if (fte>=6)  return 'occ-over';
    if (fte===5) return 'occ-full';
    if (fte===4) return 'occ-4';
    return 'occ-3';
  }

  // ── Données pré-calculées ──────────────────────────────────────────────────
  const pData   = getPeriods().map(p => ({ ...p, d: periodData(p.start, p.end) }));
  const curPD   = pData.find(isCurPeriod) || pData[pData.length - 1];
  const kd      = curPD.d;
  const wDays   = statsPeriod === 'quarterly' ? 55 : 218;
  const wLabel  = String(wDays);
  const wPeriod = statsPeriod === 'quarterly' ? 'trimestre' : 'an';
  // Instantané "à aujourd'hui" du vrai pipeline (une opportunité n'a pas de période d'activité
  // fiable comme une prestation — ses dates prévisionnelles sont optionnelles). Filtré par
  // consultant seulement si un filtre précis est actif (sinon une opportunité sans candidat
  // pour l'instant disparaîtrait à tort de la vue "tous les consultants").
  const allOpps = S.opportunites.filter(o => o.status === 'ouvert'
    && (!filterCons || S.candidatures.some(cd => cd.opportuniteId === o.id && cd.consultantId === filterCons)));

  // Jours ouvrés (lun-ven) réellement compris entre deux dates — un mois de 28 jours
  // n'a pas le même coût qu'un mois de 31 jours.
  function workingDays(start, end) {
    let count = 0;
    const d = new Date(start);
    while (d <= end) {
      const day = d.getDay();
      if (day !== 0 && day !== 6) count++;
      d.setDate(d.getDate() + 1);
    }
    return count;
  }

  // Trimestre en cours — indépendant du sélecteur "Échelle" ci-dessus, sert uniquement aux 4 indicateurs du haut
  const MONTH_SHORT = ['Jan','Fév','Mar','Avr','Mai','Juin','Juil','Août','Sep','Oct','Nov','Déc'];
  function quarterBounds(year, q) {
    const starts = [0,3,6,9], ends = [2,5,8,11], lastDays = [31,30,30,31];
    return { start: new Date(year, starts[q], 1), end: new Date(year, ends[q], lastDays[q], 23,59,59) };
  }
  const curQBounds  = quarterBounds(curY, curQ);
  const kpiKd       = periodData(curQBounds.start, curQBounds.end, workingDays(curQBounds.start, curQBounds.end));
  const kpiLabel    = ['Q1','Q2','Q3','Q4'][curQ] + ' ' + curY;
  const kpiWorkDays = workingDays(curQBounds.start, curQBounds.end);
  const prevQ       = curQ === 0 ? 3 : curQ - 1;
  const prevQYear   = curQ === 0 ? curY - 1 : curY;
  const prevQBounds = quarterBounds(prevQYear, prevQ);
  const kpiPrevKd   = periodData(prevQBounds.start, prevQBounds.end, workingDays(prevQBounds.start, prevQBounds.end));

  // Trimestre à venir — projection basée sur les prestations déjà planifiées à date (pas une vraie prévision statistique)
  const nextQ       = curQ === 3 ? 0 : curQ + 1;
  const nextQYear   = curQ === 3 ? curY + 1 : curY;
  const nextQBounds = quarterBounds(nextQYear, nextQ);
  const kpiNextKd   = periodData(nextQBounds.start, nextQBounds.end, workingDays(nextQBounds.start, nextQBounds.end));
  const nextQLabel  = ['Q1','Q2','Q3','Q4'][nextQ] + ' ' + nextQYear;

  // Graphique "Chiffre d'affaires & Marge" — navigation indépendante (chartMode / chartYear / chartFocusIdx),
  // séparée à la fois du sélecteur "Échelle" (ci-dessus) et du trimestre fixe des indicateurs (ci-dessus).
  function monthBucket(y, m) {
    const start = new Date(y, m, 1);
    const end   = new Date(y, m + 1, 0, 23, 59, 59);
    return { label: MONTH_SHORT[m] + ' ' + y, short: MONTH_SHORT[m], start, end, d: periodData(start, end, workingDays(start, end)) };
  }
  function semesterBucket(y, s) {
    const startMonth = s * 6;
    const start = new Date(y, startMonth, 1);
    const end   = new Date(y, startMonth + 6, 0, 23, 59, 59);
    return { label: (s===0?'S1 ':'S2 ')+y, short: (s===0?'S1':'S2')+" '"+String(y).slice(2), start, end, d: periodData(start, end, workingDays(start, end)) };
  }
  let chartMonths, chartRangeLabel;
  if (chartMode === '1y') {
    chartMonths = Array.from({length: 12}, (_, i) => monthBucket(chartYear, i));
    chartRangeLabel = String(chartYear);
  } else {
    const nY = chartMode === '3y' ? 3 : 5;
    const startY = curY - nY + 1;
    chartMonths = [];
    for (let y = startY; y <= curY; y++) { chartMonths.push(semesterBucket(y, 0)); chartMonths.push(semesterBucket(y, 1)); }
    chartRangeLabel = startY + '–' + curY;
  }
  const autoFocusIdx = chartMonths.findIndex(m => today >= m.start && today <= m.end);
  const focusIdx = (chartFocusIdx !== null && chartFocusIdx < chartMonths.length)
    ? chartFocusIdx
    : (autoFocusIdx >= 0 ? autoFocusIdx : chartMonths.length - 1);

  // ── Rendu ──────────────────────────────────────────────────────────────────
  scroll.appendChild(buildKpiStrip(kpiKd, kpiLabel, kpiWorkDays, kpiPrevKd, kpiNextKd, nextQLabel, allOpps, cons, chartMonths, chartRangeLabel, focusIdx));

  // Le sélecteur "Échelle" est placé juste ici, au-dessus des 5 sections qu'il pilote
  // (tableaux d'occupation/financier + les 3 graphiques ci-dessous) — les indicateurs et le
  // graphique CA & Marge au-dessus ont chacun leur propre navigation, indépendante de celui-ci.
  const detailHeader = document.createElement('div');
  detailHeader.className = 'section-title';
  detailHeader.style.cssText = 'margin-bottom:8px;padding-top:6px;border-top:1px solid var(--border)';
  detailHeader.textContent = 'Détail par période';
  scroll.appendChild(detailHeader);

  const toolbar = document.createElement('div');
  toolbar.className = 'stats-toolbar';
  toolbar.style.cssText = 'border-bottom:none;padding:0 0 14px 0;background:none';
  toolbar.innerHTML = `
    <span class="section-title">Échelle :</span>
    <button class="period-tab ${statsPeriod==='quarterly'?'active':''}" onclick="statsPeriod='quarterly';renderStats()">Par trimestre (an en cours)</button>
    <button class="period-tab ${statsPeriod==='5y'?'active':''}"        onclick="statsPeriod='5y';renderStats()">5 ans</button>
    <button class="period-tab ${statsPeriod==='10y'?'active':''}"       onclick="statsPeriod='10y';renderStats()">10 ans</button>`;
  scroll.appendChild(toolbar);

  scroll.appendChild(buildOccTable(pData, cons, isCurPeriod, consOcc, occClass));
  scroll.appendChild(buildFinTable(pData, wLabel, wPeriod, isCurPeriod));

  const caDiv = document.createElement('div');
  caDiv.className = 'chart-container';
  caDiv.innerHTML = '<div class="chart-title">Évolution du Chiffre d\'Affaires'
    + '<span style="font-weight:400;margin-left:12px">'
    + '<span style="color:var(--green)">▮ CA Confirmé (€)</span>&nbsp;&nbsp;'
    + '<span style="color:var(--blue)">▮ CA Pipeline (€)</span>'
    + (pData.some(pd=>pd.d.masseSalariale>0) ? '&nbsp;&nbsp;<span style="color:var(--orange)">── Masse salariale</span>' : '')
    + '</span></div>';
  const caEl = document.createElement('div');
  buildCaChart(caEl, pData);
  caDiv.appendChild(caEl);
  scroll.appendChild(caDiv);

  const comboDiv = document.createElement('div');
  comboDiv.className = 'chart-container';
  comboDiv.innerHTML = '<div class="chart-title">Évolution du Tarif Journalier Moyen & Taux d\'occupation'
    + '<span style="font-weight:400;margin-left:12px">'
    + '<span style="color:var(--accent)">── TJM (€/j, axe gauche)</span>&nbsp;&nbsp;'
    + '<span style="color:var(--green)">▮ Occupation (%, axe droit)</span>'
    + '</span></div>';
  const comboEl = document.createElement('div');
  buildDualChart(comboEl, pData, pData.map(pd=>pd.d.avgTjm), pData.map(pd=>pd.d.occRate||null));
  comboDiv.appendChild(comboEl);
  scroll.appendChild(comboDiv);

  scroll.appendChild(buildClientTable(curPD, cons, wDays));
  scroll.appendChild(buildEventsDiv(cons, today));

  scroll.scrollTop = prevScrollTop;
}

// ── Chart helpers ──────────────────────────────────────────────────────────────

// series: [{ label, color, values }] — values a un point par mois (12 = année civile complète).
// Une courbe par nature d'information. Clic sur un point = infobulle avec la valeur exacte du mois.
// Formes de repère (en plus de la couleur) pour distinguer les courbes sans dépendre
// uniquement de la teinte — utile en cas de daltonisme.
function drawMarker(NS, svg, shape, cx, cy, r, color, opacity) {
  const el = shape === 'square'   ? document.createElementNS(NS, 'rect')
           : shape === 'diamond'  ? document.createElementNS(NS, 'rect')
           : shape === 'triangle' ? document.createElementNS(NS, 'polygon')
           : shape === 'triangleDown' ? document.createElementNS(NS, 'polygon')
           : shape === 'cross'    ? document.createElementNS(NS, 'path')
           : document.createElementNS(NS, 'circle'); // 'circle' par défaut
  if (shape === 'square') {
    el.setAttribute('x', cx - r); el.setAttribute('y', cy - r);
    el.setAttribute('width', r*2); el.setAttribute('height', r*2);
  } else if (shape === 'diamond') {
    el.setAttribute('x', cx - r); el.setAttribute('y', cy - r);
    el.setAttribute('width', r*2); el.setAttribute('height', r*2);
    el.setAttribute('transform', `rotate(45 ${cx} ${cy})`);
  } else if (shape === 'triangle') {
    el.setAttribute('points', `${cx},${cy-r*1.15} ${cx-r*1.1},${cy+r*0.85} ${cx+r*1.1},${cy+r*0.85}`);
  } else if (shape === 'triangleDown') {
    el.setAttribute('points', `${cx},${cy+r*1.15} ${cx-r*1.1},${cy-r*0.85} ${cx+r*1.1},${cy-r*0.85}`);
  } else if (shape === 'cross') {
    const a = r*0.9;
    el.setAttribute('d', `M ${cx-a} ${cy-a} L ${cx+a} ${cy+a} M ${cx-a} ${cy+a} L ${cx+a} ${cy-a}`);
    el.setAttribute('stroke', color); el.setAttribute('stroke-width', '2'); el.setAttribute('stroke-linecap', 'round');
    if (opacity !== undefined) el.setAttribute('stroke-opacity', opacity);
    svg.appendChild(el);
    return el;
  } else {
    el.setAttribute('cx', cx); el.setAttribute('cy', cy); el.setAttribute('r', r);
  }
  el.setAttribute('fill', color);
  el.setAttribute('stroke', 'var(--surface)'); el.setAttribute('stroke-width', '1.3');
  if (opacity !== undefined) el.setAttribute('fill-opacity', opacity);
  svg.appendChild(el);
  return el;
}

// Etat des courbes masquées par l'utilisateur (persiste tant que la page reste ouverte),
// gardé en dehors de la fonction pour survivre aux re-rendus.
const hiddenChartSeries = new Set();

function buildMultiLineChart(months, series, focusIdx, yDomain) {
  const container = document.createElement('div');
  const validSeries = series.filter(s => s.values.some(v => v !== null && v !== undefined));
  if (!validSeries.length) {
    container.innerHTML = `<div style="padding:20px;text-align:center;color:var(--text-muted);font-size:var(--text-base)">Aucune donnée sur cette période</div>`;
    return container;
  }
  const shownSeries = validSeries.filter(s => !hiddenChartSeries.has(s.label));

  const W = 760, H = 240;
  const PAD = { top: 20, right: 14, bottom: 30, left: 64 };
  const cW = W - PAD.left - PAD.right;
  const cH = H - PAD.top  - PAD.bottom;
  const n  = months.length;

  function fmtEuro(v) { return Math.round(v).toLocaleString('fr-FR') + ' €'; }
  function fmtK(v) { const a = Math.abs(v); return (v<0?'-':'') + (a >= 1000000 ? (a/1000000).toFixed(1)+'M' : a >= 1000 ? Math.round(a/1000)+'k' : Math.round(a)); }

  let yMax, yMin;
  if (yDomain) {
    ({ yMax, yMin } = yDomain);
  } else {
    const scaleSeries = shownSeries.length ? shownSeries : validSeries;
    const allVals = scaleSeries.flatMap(s => s.values.filter(v => v !== null && v !== undefined));
    yMax = Math.max(0, ...allVals) * 1.15 || 1;
    yMin = Math.min(0, Math.min(...allVals) * 1.15);
  }
  const range = (yMax - yMin) || 1;

  function xPx(i) { return PAD.left + (n > 1 ? i / (n - 1) : 0.5) * cW; }
  function yPx(v) { return PAD.top + cH * (1 - (v - yMin) / range); }
  const zeroY = yPx(0);

  const NS = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(NS, 'svg');
  svg.setAttribute('viewBox', `0 0 ${W} ${H}`);
  svg.style.cssText = `width:100%;aspect-ratio:${W}/${H};display:block;overflow:visible`;

  const nT = 4;
  for (let t = 0; t <= nT; t++) {
    const v = yMin + range * t / nT;
    const y = yPx(v);
    const line = document.createElementNS(NS, 'line');
    line.setAttribute('x1', PAD.left); line.setAttribute('x2', W - PAD.right);
    line.setAttribute('y1', y.toFixed(1)); line.setAttribute('y2', y.toFixed(1));
    line.setAttribute('stroke', 'var(--border)'); line.setAttribute('stroke-width', '0.8');
    svg.appendChild(line);
    const label = document.createElementNS(NS, 'text');
    label.setAttribute('x', PAD.left - 6); label.setAttribute('y', y.toFixed(1));
    label.setAttribute('text-anchor', 'end'); label.setAttribute('dominant-baseline', 'middle');
    label.setAttribute('font-size', '9'); label.setAttribute('fill', 'var(--text-muted)');
    label.textContent = fmtK(v);
    svg.appendChild(label);
  }
  if (yMin < 0) {
    const zl = document.createElementNS(NS, 'line');
    zl.setAttribute('x1', PAD.left); zl.setAttribute('x2', W - PAD.right);
    zl.setAttribute('y1', zeroY.toFixed(1)); zl.setAttribute('y2', zeroY.toFixed(1));
    zl.setAttribute('stroke', 'var(--neutral)'); zl.setAttribute('stroke-width', '1');
    svg.appendChild(zl);
  }

  months.forEach((m, i) => {
    const x = xPx(i);
    const isFocus = i === focusIdx;
    const xLabel = document.createElementNS(NS, 'text');
    xLabel.setAttribute('x', x.toFixed(1));
    xLabel.setAttribute('y', H - 6);
    xLabel.setAttribute('text-anchor', 'middle');
    xLabel.setAttribute('font-size', '9');
    xLabel.setAttribute('font-weight', isFocus ? '700' : '400');
    xLabel.setAttribute('fill', isFocus ? 'var(--accent)' : 'var(--text-muted)');
    xLabel.textContent = m.short;
    xLabel.style.cursor = 'pointer';
    xLabel.addEventListener('click', () => { chartFocusIdx = i; renderStats(); });
    const titleEl = document.createElementNS(NS, 'title');
    titleEl.textContent = `Afficher les valeurs de ${m.label} dans la légende`;
    xLabel.appendChild(titleEl);
    svg.appendChild(xLabel);
  });

  shownSeries.forEach(s => {
    let d = '';
    s.values.forEach((v, i) => {
      if (v === null || v === undefined) return;
      const x = xPx(i).toFixed(1), y = yPx(v).toFixed(1);
      d += (d === '' ? 'M ' : ' L ') + x + ' ' + y;
    });
    const path = document.createElementNS(NS, 'path');
    path.setAttribute('d', d);
    path.setAttribute('fill', 'none');
    path.setAttribute('stroke', s.color);
    path.setAttribute('stroke-width', s.reference ? '1.4' : '2.2');
    path.setAttribute('stroke-opacity', s.reference ? '0.45' : '1');
    path.setAttribute('stroke-linejoin', 'round');
    if (s.dash) path.setAttribute('stroke-dasharray', s.dash);
    svg.appendChild(path);

    s.values.forEach((v, i) => {
      if (v === null || v === undefined) return;
      const x = xPx(i).toFixed(1), y = yPx(v).toFixed(1);
      drawMarker(NS, svg, s.shape, +x, +y, s.reference ? 2.4 : 3.6, s.color, s.reference ? 0.45 : 1);
      // Zone de clic agrandie (accessibilité tactile), invisible, posée sur le repère
      const hit = document.createElementNS(NS, 'circle');
      hit.setAttribute('cx', x); hit.setAttribute('cy', y); hit.setAttribute('r', '9');
      hit.setAttribute('fill', 'transparent');
      hit.style.cursor = 'pointer';
      hit.addEventListener('click', (e) => {
        e.stopPropagation();
        showPointTooltip(hit, `<strong>${s.label} · ${months[i].label}</strong>${fmtEuro(v)}`);
      });
      svg.appendChild(hit);
    });
  });

  const axis = document.createElementNS(NS, 'line');
  axis.setAttribute('x1', PAD.left); axis.setAttribute('x2', PAD.left);
  axis.setAttribute('y1', PAD.top); axis.setAttribute('y2', H - PAD.bottom);
  axis.setAttribute('stroke', 'var(--border)'); axis.setAttribute('stroke-width', '1');
  svg.appendChild(axis);

  container.appendChild(svg);

  const focusNote = document.createElement('div');
  focusNote.style.cssText = 'font-size:var(--text-xs);color:var(--text-muted);margin-top:10px';
  focusNote.textContent = `Valeurs affichées ci-dessous au point : ${months[focusIdx]?.label ?? '—'} · cliquer un autre repère sur l'axe pour changer`;
  container.appendChild(focusNote);

  const legend = document.createElement('div');
  legend.style.cssText = 'display:flex;flex-wrap:wrap;gap:8px 10px;margin-top:8px;font-size:var(--text-sm)';
  validSeries.forEach(s => {
    const isHidden = hiddenChartSeries.has(s.label);
    const curVal   = s.values[focusIdx];
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.setAttribute('aria-pressed', String(!isHidden));
    btn.title = isHidden ? `Afficher la courbe ${s.label}` : `Masquer la courbe ${s.label}`;
    btn.style.cssText = `display:inline-flex;align-items:center;gap:6px;padding:4px 9px;
      border-radius:20px;border:1px solid var(--border);background:${isHidden ? 'transparent' : 'var(--surface2)'};
      color:var(--text-dim);cursor:pointer;font-size:var(--text-sm);opacity:${isHidden ? 0.45 : 1};transition:opacity .15s`;

    const swatchNS = 'http://www.w3.org/2000/svg';
    const swatch = document.createElementNS(swatchNS, 'svg');
    swatch.setAttribute('width', '18'); swatch.setAttribute('height', '12'); swatch.setAttribute('viewBox', '0 0 18 12');
    const swLine = document.createElementNS(swatchNS, 'line');
    swLine.setAttribute('x1', '0'); swLine.setAttribute('y1', '6'); swLine.setAttribute('x2', '18'); swLine.setAttribute('y2', '6');
    swLine.setAttribute('stroke', s.color); swLine.setAttribute('stroke-width', '2.2');
    if (s.dash) swLine.setAttribute('stroke-dasharray', s.dash);
    swatch.appendChild(swLine);
    drawMarker(swatchNS, swatch, s.shape, 9, 6, 3.2, s.color);
    btn.appendChild(swatch);

    const textSpan = document.createElement('span');
    textSpan.style.textDecoration = isHidden ? 'line-through' : 'none';
    textSpan.innerHTML = curVal !== null && curVal !== undefined
      ? `${s.label} : <strong style="color:${s.color}">${fmtEuro(curVal)}</strong>`
      : s.label;
    btn.appendChild(textSpan);

    btn.addEventListener('click', () => {
      if (isHidden) hiddenChartSeries.delete(s.label); else hiddenChartSeries.add(s.label);
      renderStats();
    });
    legend.appendChild(btn);
  });
  container.appendChild(legend);

  return container;
}

function buildCaChart(container, pData) {
  const W = 760, H = 200;
  const PAD = { top: 20, right: 14, bottom: 30, left: 64 };
  const cW = W - PAD.left - PAD.right;
  const cH = H - PAD.top  - PAD.bottom;
  const n  = pData.length;

  const caVals  = pData.map(pd => pd.d.ca || 0);
  const pipVals = pData.map(pd => pd.d.caPipeline || 0);
  const msVals  = pData.map(pd => pd.d.masseSalariale || null);
  const totVals = pData.map((pd, i) => caVals[i] + pipVals[i]);

  const allVals = [...caVals, ...pipVals, ...totVals, ...msVals.filter(v=>v!==null)];
  if (!allVals.some(v => v > 0)) {
    container.innerHTML = `<div style="padding:20px;text-align:center;color:var(--text-muted);font-size:var(--text-base)">Aucune donnée sur cette période</div>`;
    return;
  }

  const yMax = Math.max(...allVals) * 1.12 || 1;
  const barW = Math.max(6, cW / Math.max(n, 1) * 0.35);

  function xPx(i) { return PAD.left + (n > 1 ? i / (n - 1) : 0.5) * cW; }
  function yPx(v) { return PAD.top + cH * (1 - v / yMax); }
  function fmtY(v) { return v >= 1000000 ? (v/1000000).toFixed(1)+'M' : v >= 1000 ? Math.round(v/1000)+'k' : Math.round(v); }

  let grid = '', yLabels = '', xLabels = '', bars = '', msLine = '', msDots = '';
  const nT = 4;
  for (let t = 0; t <= nT; t++) {
    const v = yMax * t / nT;
    const y = yPx(v).toFixed(1);
    grid    += `<line x1="${PAD.left}" x2="${W-PAD.right}" y1="${y}" y2="${y}" stroke="var(--border)" stroke-width="0.8"/>`;
    yLabels += `<text x="${PAD.left-5}" y="${y}" text-anchor="end" dominant-baseline="middle" font-size="9" fill="var(--text-muted)">${fmtY(v)}</text>`;
  }

  pData.forEach((pd, i) => {
    const x   = xPx(i);
    const ca  = caVals[i];
    const pip = pipVals[i];
    const ms  = msVals[i];

    if (ca > 0) {
      const yCA = yPx(ca), hCA = H - PAD.bottom - yCA;
      bars += `<rect x="${(x-barW).toFixed(1)}" y="${yCA.toFixed(1)}" width="${(barW).toFixed(1)}" height="${Math.max(0,hCA).toFixed(1)}" fill="var(--green)" fill-opacity="0.7" rx="2">
        <title>${pd.label} · CA Confirmé : ${Math.round(ca).toLocaleString('fr-FR')} €</title></rect>`;
    }
    if (pip > 0) {
      const yPip = yPx(ca + pip), hPip = yPx(ca) - yPip;
      bars += `<rect x="${(x-barW).toFixed(1)}" y="${yPip.toFixed(1)}" width="${(barW).toFixed(1)}" height="${Math.max(0,hPip).toFixed(1)}" fill="var(--blue)" fill-opacity="0.55" rx="2">
        <title>${pd.label} · CA Pipeline : ${Math.round(pip).toLocaleString('fr-FR')} €</title></rect>`;
    }

    if (ms !== null) {
      const yMs = yPx(ms).toFixed(1), xMs = x.toFixed(1);
      if (i === 0 || msVals[i-1] === null) msLine += `M ${xMs} ${yMs}`;
      else msLine += ` L ${xMs} ${yMs}`;
      msDots += `<circle cx="${xMs}" cy="${yMs}" r="3" fill="var(--orange)" stroke="var(--surface)" stroke-width="1.5"><title>${pd.label} · Masse sal. : ${Math.round(ms).toLocaleString('fr-FR')} €</title></circle>`;
    }

    const label = n <= 12 ? pd.short : (i % Math.ceil(n/8) === 0 ? pd.short : '');
    if (label) xLabels += `<text x="${x.toFixed(1)}" y="${H-5}" text-anchor="middle" font-size="9" fill="var(--text-muted)">${label}</text>`;
  });

  container.innerHTML = `
    <svg viewBox="0 0 ${W} ${H}" style="width:100%;height:${H}px;display:block;overflow:visible">
      ${grid}
      ${bars}
      ${msLine ? `<path d="${msLine}" fill="none" stroke="var(--orange)" stroke-width="2" stroke-dasharray="5,3" stroke-linejoin="round"/>` : ''}
      ${msDots}
      ${yLabels}${xLabels}
      <line x1="${PAD.left}" x2="${PAD.left}" y1="${PAD.top}" y2="${H-PAD.bottom}" stroke="var(--border)" stroke-width="1"/>
    </svg>`;
}

function buildDualChart(container, periods, tjmValues, occValues) {
  const W = 760, H = 180;
  const PAD = { top: 14, right: 50, bottom: 30, left: 52 };
  const cW = W - PAD.left - PAD.right;
  const cH = H - PAD.top  - PAD.bottom;

  const tjmFiltered = tjmValues.filter(v => v !== null);
  if (!tjmFiltered.length && !occValues.filter(v=>v!==null).length) {
    container.innerHTML = `<div style="padding:20px;text-align:center;color:var(--text-muted);font-size:var(--text-base)">Aucune donnée sur cette période</div>`;
    return;
  }

  const tjmMin = tjmFiltered.length ? Math.min(...tjmFiltered) * 0.92 : 0;
  const tjmMax = tjmFiltered.length ? Math.max(...tjmFiltered) * 1.08 : 1000;

  function xPx(i) { return PAD.left + (periods.length > 1 ? i / (periods.length - 1) : 0.5) * cW; }
  function tjmY(v) { return PAD.top + cH * (1 - (v - tjmMin) / Math.max(1, tjmMax - tjmMin)); }
  function occY(v) { return PAD.top + cH * (1 - v / 100); }

  let grid = '', yLeft = '', yRight = '', xLabels = '';
  const nT = 4;
  for (let t = 0; t <= nT; t++) {
    const frac = t / nT;
    const y    = (PAD.top + cH * (1 - frac)).toFixed(1);
    const occV = Math.round(frac * 100);
    const tjmV = Math.round(tjmMin + (tjmMax - tjmMin) * frac);
    grid   += `<line x1="${PAD.left}" x2="${W-PAD.right}" y1="${y}" y2="${y}" stroke="var(--border)" stroke-width="0.8"/>`;
    yLeft  += `<text x="${PAD.left-5}" y="${y}" text-anchor="end" dominant-baseline="middle" font-size="9" fill="var(--accent)">${tjmV}</text>`;
    yRight += `<text x="${W-PAD.right+5}" y="${y}" dominant-baseline="middle" font-size="9" fill="var(--green)">${occV}%</text>`;
  }

  const barW = Math.max(3, cW / Math.max(periods.length, 1) * 0.55);
  let bars = '';
  periods.forEach((pd, i) => {
    const v = occValues[i];
    if (v === null) return;
    const x = xPx(i), y = occY(v), bH = H - PAD.bottom - y;
    const col = v >= 80 ? 'var(--green)' : v >= 50 ? 'var(--yellow)' : 'var(--text-muted)';
    bars += `<rect x="${(x - barW/2).toFixed(1)}" y="${y.toFixed(1)}" width="${barW.toFixed(1)}" height="${Math.max(0, bH).toFixed(1)}" fill="${col}" fill-opacity="0.22" rx="2"><title>${pd.label}: ${v}%</title></rect>`;
    if (bH > 14) bars += `<text x="${x.toFixed(1)}" y="${(y-3).toFixed(1)}" text-anchor="middle" font-size="8" fill="${col}" fill-opacity="0.85">${v}%</text>`;
  });

  let pathSegs = [], dots = '';
  let prevNull = true;
  periods.forEach((pd, i) => {
    const v = tjmValues[i];
    const x = xPx(i).toFixed(1);
    const label = periods.length <= 12 ? pd.short : (i % Math.ceil(periods.length/8) === 0 ? pd.short : '');
    if (label) xLabels += `<text x="${x}" y="${H-5}" text-anchor="middle" font-size="9" fill="var(--text-muted)">${label}</text>`;
    if (v === null) { prevNull = true; return; }
    const y = tjmY(v).toFixed(1);
    pathSegs.push(prevNull ? `M ${x} ${y}` : `L ${x} ${y}`);
    prevNull = false;
    dots += `<circle cx="${x}" cy="${y}" r="3" fill="var(--accent)" stroke="var(--surface)" stroke-width="1.5"><title>${pd.label}: ${v} €/j</title></circle>`;
    dots += `<text x="${x}" y="${(parseFloat(y)-7).toFixed(1)}" text-anchor="middle" font-size="8" fill="var(--accent)" fill-opacity="0.85">${v}€</text>`;
  });

  container.innerHTML = `
    <svg viewBox="0 0 ${W} ${H}" style="width:100%;height:${H}px;display:block;overflow:visible">
      ${grid}
      ${bars}
      <path d="${pathSegs.join(' ')}" fill="none" stroke="var(--accent)" stroke-width="2.5" stroke-linejoin="round"/>
      ${dots}
      ${yLeft}${yRight}${xLabels}
      <line x1="${PAD.left}" x2="${PAD.left}" y1="${PAD.top}" y2="${H-PAD.bottom}" stroke="var(--border)" stroke-width="1"/>
      <line x1="${W-PAD.right}" x2="${W-PAD.right}" y1="${PAD.top}" y2="${H-PAD.bottom}" stroke="var(--green)" stroke-width="0.8" stroke-dasharray="3,3"/>
    </svg>`;
}

function buildLineChart(container, periods, rawValues, opts = {}) {
  const W = 760, H = 150;
  const PAD = { top: 14, right: 14, bottom: 30, left: 48 };
  const cW  = W - PAD.left - PAD.right;
  const cH  = H - PAD.top  - PAD.bottom;

  const values = rawValues.filter(v => v !== null);
  if (!values.length) {
    container.innerHTML = `<div style="padding:20px;text-align:center;color:var(--text-muted);font-size:var(--text-base)">Aucune donnée sur cette période</div>`;
    return;
  }

  const rawMin = opts.yMin ?? Math.min(...values);
  const rawMax = opts.yMax ?? Math.max(...values);
  const pad = (rawMax - rawMin) * 0.15 || rawMin * 0.1 || 10;
  const yMin = Math.max(opts.yMin ?? -Infinity, rawMin - pad);
  const yMax = opts.yMax ?? rawMax + pad;

  function xPx(i) { return PAD.left + (periods.length > 1 ? i / (periods.length - 1) : 0.5) * cW; }
  function yPx(v) { return PAD.top + cH * (1 - (v - yMin) / (yMax - yMin)); }

  let grid = '', xlabels = '', dots = '';
  const nT = 4;
  for (let t = 0; t <= nT; t++) {
    const v = yMin + (yMax - yMin) * t / nT;
    const y = yPx(v).toFixed(1);
    grid += `<line x1="${PAD.left}" x2="${W-PAD.right}" y1="${y}" y2="${y}" stroke="var(--border)" stroke-width="0.8"/>
      <text x="${PAD.left-5}" y="${y}" text-anchor="end" dominant-baseline="middle" font-size="9" fill="var(--text-muted)">${Math.round(v)}</text>`;
  }

  let pathSegs = [], areaSegs = [], prevI = null;
  periods.forEach((pd, i) => {
    const v = rawValues[i];
    const x = xPx(i).toFixed(1);
    const label = periods.length <= 12 ? pd.short : (i % Math.ceil(periods.length / 8) === 0 ? pd.short : '');
    if (label) xlabels += `<text x="${x}" y="${H-5}" text-anchor="middle" font-size="9" fill="var(--text-muted)">${label}</text>`;
    if (v === null) { prevI = null; return; }
    const y = yPx(v).toFixed(1);
    if (prevI === null) {
      pathSegs.push(`M ${x} ${y}`);
      areaSegs.push(`M ${x} ${H-PAD.bottom} L ${x} ${y}`);
    } else {
      pathSegs.push(`L ${x} ${y}`);
      areaSegs.push(`L ${x} ${y}`);
    }
    if (i === rawValues.length - 1 || rawValues[i+1] === null) {
      areaSegs.push(`L ${x} ${H-PAD.bottom} Z`);
    }
    const col = opts.color || 'var(--accent)';
    dots += `<circle cx="${x}" cy="${y}" r="3" fill="${col}" stroke="var(--surface)" stroke-width="1.5"><title>${pd.label}: ${Math.round(v)}${opts.unit?' '+opts.unit:''}</title></circle>`;
    prevI = i;
  });

  const col = opts.color || 'var(--accent)';
  container.innerHTML = `
    <svg viewBox="0 0 ${W} ${H}" style="width:100%;height:${H}px;display:block;overflow:visible">
      ${grid}
      <line x1="${PAD.left}" x2="${PAD.left}" y1="${PAD.top}" y2="${H-PAD.bottom}" stroke="var(--border)" stroke-width="1"/>
      <path d="${areaSegs.join(' ')}" fill="${col}" fill-opacity="0.08"/>
      <path d="${pathSegs.join(' ')}" fill="none" stroke="${col}" stroke-width="2" stroke-linejoin="round"/>
      ${dots}
      ${xlabels}
    </svg>`;
}

// ─── FILTER ───────────────────────────────────────────────────────────────────
// Vocabulaire commun de statut, partagé par Prestation/Opportunité/Candidature — un même
// bouton de filtre ("En attente", "Gagnées"...) doit regrouper le statut équivalent des 3
// entités, sinon les pastilles Opportunité/Candidature du tableau unifié (Vue liste) ne
// correspondent à aucun filtre affiché.
function statusBucket(kind, status) {
  if (kind === 'prestation')  return { en_cours: 'en_cours', en_pause: 'en_cours', terminee: 'gagne' }[status];
  if (kind === 'opportunite') return { ouvert: 'en_attente', pourvu: 'gagne', abandonne: 'perdu' }[status];
  if (kind === 'candidature') return { en_attente: 'en_attente', gagnee: 'gagne', perdue: 'perdu' }[status];
  return undefined;
}

// Combine le filtre de statut (commun) et le filtre de type (Prestations vs
// Opportunités/Candidatures) — utilisé pour les 3 natures de ligne, Gantt et Vue liste.
function matchStatusAndType(kind, status) {
  if (filterType === 'prestation' && kind !== 'prestation') return false;
  if (filterType === 'opportunite' && kind === 'prestation') return false;
  return filterStatus === 'all' || statusBucket(kind, status) === filterStatus;
}

function setFilter(s) {
  filterStatus = s;
  // .viewmode-btn et .type-filter-btn exclus : ce sont 2 autres groupes de boutons
  // indépendants (onglets Consultants/Clients, filtre Type) — sans cette exclusion, ce
  // querySelectorAll les désélectionne aussi (leur dataset.s est vide, ne matche jamais s).
  document.querySelectorAll('.filter-btn:not(.viewmode-btn):not(.type-filter-btn)').forEach(b => b.classList.toggle('active', b.dataset.s === s));
  render();
}

function setFilterType(t) {
  filterType = t;
  document.querySelectorAll('.type-filter-btn').forEach(b => b.classList.toggle('active', b.dataset.t === t));
  render();
}

// ─── STATS · NAVIGATION DU GRAPHIQUE CA & MARGE ────────────────────────────────
function setChartMode(m) {
  chartMode = m;
  chartFocusIdx = null; // les index ne sont plus comparables d'un mode à l'autre
  renderStats();
}

function navChartYear(delta) {
  chartYear += delta;
  chartFocusIdx = null;
  renderStats();
}

// ─── VIEW SWITCH ──────────────────────────────────────────────────────────────
function switchView(v) {
  currentView = v;
  document.querySelectorAll('.nav-item').forEach(n => n.classList.toggle('active', n.dataset.view === v));
  document.getElementById('gantt-container').style.display     = v==='gantt' ? 'flex' : 'none';
  document.getElementById('list-view-container').style.display = v==='list'  ? 'flex' : 'none';
  document.getElementById('stats-view').style.display           = v==='stats' ? 'flex' : 'none';
  render();
}

// ─── PRESTATION MODAL ────────────────────────────────────────────────────────
function openPrestModal(p, forceConsId) {
  modalWonCandidatureId = null;
  clearFieldErrors(['f-client', 'f-start', 'f-end', 'f-tjm', 'f-cons', 'f-nature']);
  const overlay = document.getElementById('prest-overlay');
  overlay.classList.add('open');

  const sel = document.getElementById('f-cons');
  sel.innerHTML = '';
  S.consultants.forEach(c => {
    const o = document.createElement('option');
    o.value = c.id; o.textContent = c.name;
    sel.appendChild(o);
  });
  sel.disabled = currentProfile?.type === 'consultant';

  if (p) {
    document.getElementById('prest-modal-title').textContent = 'Modifier la prestation';
    document.getElementById('btn-del-prest').style.display = 'block';
    document.getElementById('f-id').value       = p.id;
    document.getElementById('f-cons').value     = p.consultantId;
    document.getElementById('f-nature').value   = p.nature || 'mission';
    document.getElementById('f-titre').value    = p.titre || '';
    document.getElementById('f-client').value   = p.client || '';
    document.getElementById('f-service').value  = p.clientService || '';
    document.getElementById('f-start').value    = p.startDate || '';
    document.getElementById('f-end').value      = p.endDate || '';
    document.getElementById('f-tjm').value      = p.tjm || '';
    document.getElementById('f-fte').value      = p.fte || 5;
    document.getElementById('f-uo').value       = p.limiteUOAn || '';
    document.getElementById('f-notes').value    = p.notes || '';
    modalMissionEvents = p.missionEvents ? p.missionEvents.map(e => ({...e})) : [];
    modalRevisions = p.tjmRevisions ? [...p.tjmRevisions] : [];
    document.getElementById('f-opportunite-id').value = p.opportuniteId || '';
  } else {
    document.getElementById('prest-modal-title').textContent = 'Ajouter une prestation';
    document.getElementById('btn-del-prest').style.display = 'none';
    document.getElementById('f-id').value       = '';
    document.getElementById('f-nature').value   = '';
    document.getElementById('f-titre').value    = '';
    document.getElementById('f-client').value   = '';
    document.getElementById('f-service').value  = '';
    document.getElementById('f-start').value    = '';
    document.getElementById('f-end').value      = '';
    document.getElementById('f-tjm').value      = '';
    document.getElementById('f-fte').value      = '5';
    document.getElementById('f-uo').value       = '';
    document.getElementById('f-notes').value    = '';
    modalMissionEvents = [];
    modalRevisions = [];
    document.getElementById('f-opportunite-id').value = '';
    if (forceConsId) sel.value = forceConsId;
    else if (filterCons) sel.value = filterCons;
  }

  // p sans opportuniteId : rien à dire tant qu'on ne sait pas si l'utilisateur va en attacher une
  // (cas d'une prestation en cours de création qui n'est pas issue d'une candidature gagnée).
  if (!p) hideOriginBanner();
  else if (p.opportuniteId) showOriginBannerLinked();
  else showOriginBannerMuted();

  document.getElementById('ev-type').value = 'prolongation';
  updateEvTypeUI();
  renderRevisions();
  renderMissionEvents();
  updateBadges();
  updateLockedSections();
  document.getElementById('mission-edit-section').style.display = 'none';
  document.getElementById('tarif-edit-section').style.display   = 'none';
  prestModalSnapshot = prestFormState();
  openModalA11y('prest-overlay');
}

// TJM initial/Taux d'activité et Modification de la mission ne sont des champs de "définition"
// qu'à la création directe d'une prestation (pas issue d'une opportunité) : dès que la prestation
// existe déjà (édition) ou qu'elle vient d'une candidature gagnée, ils passent en lecture seule —
// tout changement passe alors par les tables de tarification/modification ci-dessous. Les 2
// paires de blocs sont mutuellement exclusives : champs de définition (création) d'un côté,
// table en lecture seule + bouton "Modifier" de l'autre — jamais les deux en même temps.
function updateLockedSections() {
  const existing = !!document.getElementById('f-id').value;
  const fromOpp  = !!document.getElementById('f-opportunite-id').value;
  // Cas particulier : une prestation issue d'une candidature gagnée n'a pas forcément hérité
  // d'un TJM (champ optionnel côté Opportunité). Verrouiller quand même le TJM/Taux d'activité
  // rendrait ce champ obligatoire invisible, donc impossible à corriger (bug constaté en test).
  // Le verrouillage tarification ne s'applique donc que s'il y a effectivement une valeur reprise.
  const hasBaseTjm  = !!document.getElementById('f-tjm').value;
  const tarifLocked = existing || (fromOpp && hasBaseTjm);
  // La mission (prolongation/pause/sortie anticipée), elle, n'a pas ce problème : rien à
  // reprendre de l'opportunité, donc rien à masquer faute de valeur.
  const missionLocked = existing || fromOpp;

  document.getElementById('f-tjm').disabled = tarifLocked;
  document.getElementById('f-fte').disabled = tarifLocked;
  document.getElementById('tjm-fte-row').style.display          = tarifLocked ? 'none' : '';
  document.getElementById('tarif-history-block').style.display   = tarifLocked ? '' : 'none';
  document.getElementById('mission-history-block').style.display = missionLocked ? '' : 'none';
}

// Capture l'état courant du formulaire Prestation (champs + révisions + modifications de
// mission), pour détecter une saisie non enregistrée avant de fermer la modale sans confirmation.
function prestFormState() {
  const data = {};
  document.querySelectorAll('#prest-modal-box input, #prest-modal-box select, #prest-modal-box textarea')
    .forEach(el => { if (el.id) data[el.id] = el.value; });
  data._revisions     = modalRevisions;
  data._missionEvents = modalMissionEvents;
  return JSON.stringify(data);
}

function cancelPrestModal() {
  if (prestFormState() !== prestModalSnapshot) {
    if (!confirm('Des modifications non enregistrées seront perdues. Annuler quand même ?')) return;
  }
  closeModal('prest-overlay');
}

// Modification de la mission et Révisions TJM sont des modifications d'une prestation déjà
// créée, pas des attributs de base : masquées par défaut derrière un bouton "Modifier", pour que
// la fiche affiche d'abord un état lisible plutôt que tous les formulaires d'édition à la fois.
function toggleMissionEdit() {
  const el = document.getElementById('mission-edit-section');
  el.style.display = el.style.display === 'none' ? '' : 'none';
}
function toggleTarifEdit() {
  const el = document.getElementById('tarif-edit-section');
  el.style.display = el.style.display === 'none' ? '' : 'none';
}

// N'affiche "Date de reprise" que pour une Pause (seul type concerné par une reprise).
function updateEvTypeUI() {
  document.getElementById('ev-resume-wrap').style.display =
    document.getElementById('ev-type').value === 'pause' ? '' : 'none';
}

const MISSION_EVENT_LABELS = { prolongation: 'Prolongation', pause: 'Pause', sortie_anticipee: 'Sortie anticipée' };

function addMissionEvent() {
  const type       = document.getElementById('ev-type').value;
  const date       = document.getElementById('ev-date').value;
  const resumeDate = document.getElementById('ev-resume').value;
  if (!date) { showToast('Saisissez une date d\'effet', 'error'); return; }
  if (type === 'pause' && resumeDate && resumeDate <= date) {
    showToast('La date de reprise doit être après la date d\'effet', 'error'); return;
  }
  modalMissionEvents.push({
    id: genId(), type, date,
    ...(type === 'pause' && resumeDate ? { resumeDate } : {}),
  });
  modalMissionEvents.sort((a,b) => a.date.localeCompare(b.date));
  document.getElementById('ev-date').value   = '';
  document.getElementById('ev-resume').value = '';
  renderMissionEvents();
  updateBadges();
}

function removeMissionEvent(id) {
  if (!confirm('Supprimer cette modification ?')) return;
  modalMissionEvents = modalMissionEvents.filter(e => e.id !== id);
  renderMissionEvents();
  updateBadges();
}

function renderMissionEvents() {
  const tbody = document.getElementById('mission-table-body');
  tbody.innerHTML = '';
  if (!modalMissionEvents.length) {
    tbody.innerHTML = `<tr><td colspan="4" style="color:var(--text-muted);padding:6px 0;white-space:normal">Aucune modification — la mission suit ses dates initiales.</td></tr>`;
    return;
  }
  modalMissionEvents.forEach(e => {
    tbody.innerHTML += `
      <tr>
        <td>${MISSION_EVENT_LABELS[e.type] || e.type}</td>
        <td>${fmtD(e.date)}</td>
        <td>${e.resumeDate ? fmtD(e.resumeDate) : '—'}</td>
        <td><button class="btn-icon" onclick="removeMissionEvent('${e.id}')" title="Supprimer" aria-label="Supprimer cette modification" style="width:22px;height:22px;font-size:var(--text-sm)">×</button></td>
      </tr>`;
  });
}

function updateTcDisplay() {
  const cc = parseFloat(document.getElementById('cf-cout-complet').value) || 0;
  const disp = document.getElementById('cf-tc-display');
  const current = modalCostRevisions.length ? modalCostRevisions[modalCostRevisions.length-1].coutComplet : cc;
  if (current > 0) {
    const tc = Math.round(current * 1.32);
    const diff = current - cc;
    disp.innerHTML = `TC : <strong style="color:var(--purple)">${tc.toLocaleString('fr-FR')} €/j</strong><div style="font-size:var(--text-xs);color:var(--text-muted);margin-top:2px">Marge 32% incluse</div>`
      + (modalCostRevisions.length ? `<div style="font-size:var(--text-sm);margin-top:4px">Coût complet actuel : <strong style="color:var(--orange)">${current.toLocaleString('fr-FR')} €/j</strong> <span style="color:${diff>=0?'var(--green)':'var(--red)'}">(${diff>=0?'+':''}${diff} €)</span></div>` : '');
  } else {
    disp.textContent = '';
  }
}

function addCostRevision() {
  const date  = document.getElementById('cost-rev-date').value;
  const value = parseFloat(document.getElementById('cost-rev-value').value);
  if (!date)  { showToast('Saisissez une date de mise en place', 'error'); return; }
  if (!value) { showToast('Saisissez un coût complet', 'error'); return; }
  modalCostRevisions = modalCostRevisions.filter(r => r.date !== date);
  modalCostRevisions.push({ date, coutComplet: value });
  modalCostRevisions.sort((a,b) => a.date.localeCompare(b.date));
  document.getElementById('cost-rev-date').value  = '';
  document.getElementById('cost-rev-value').value = '';
  renderCostRevisions();
  updateTcDisplay();
}

function removeCostRevision(date) {
  if (!confirm('Supprimer cette révision du coût complet ?')) return;
  modalCostRevisions = modalCostRevisions.filter(r => r.date !== date);
  renderCostRevisions();
  updateTcDisplay();
}

function renderCostRevisions() {
  const el = document.getElementById('cost-revision-list');
  el.innerHTML = '';
  const baseCc = parseFloat(document.getElementById('cf-cout-complet').value) || 0;
  if (!modalCostRevisions.length) {
    el.innerHTML = `<div style="font-size:var(--text-sm);color:var(--text-muted);padding:6px 0 10px">Aucune révision — le coût complet de base s'applique.</div>`;
    return;
  }
  modalCostRevisions.forEach((r, i) => {
    const prev = i === 0 ? baseCc : modalCostRevisions[i-1].coutComplet;
    const diff = r.coutComplet - prev;
    el.innerHTML += `
      <div class="revision-item">
        <span class="revision-date">${fmtD(r.date)}</span>
        <span class="revision-tjm">${r.coutComplet.toLocaleString('fr-FR')} €/j</span>
        ${prev ? `<span class="revision-delta ${diff>=0?'delta-up':'delta-down'}">${diff>=0?'+':''}${diff} €</span>` : ''}
        <button class="btn-icon" onclick="removeCostRevision('${r.date}')" title="Supprimer" aria-label="Supprimer cette révision de coût" style="width:22px;height:22px;font-size:var(--text-sm)">×</button>
      </div>`;
  });
}

function updateBadges() {
  // Même logique que prestationStatus()/effectiveEnd()/activePause(), mais sur l'état du
  // formulaire (modalMissionEvents, pas encore une vraie Prestation) — pour afficher le statut
  // calculé en direct pendant la saisie.
  const endDate  = document.getElementById('f-end').value;
  const endEvts  = modalMissionEvents.filter(e => e.type === 'prolongation' || e.type === 'sortie_anticipee');
  const effEnd   = endEvts.length ? endEvts[endEvts.length - 1].date : endDate;
  const today    = todayStr();
  const pauseNow = modalMissionEvents.find(e => e.type === 'pause' && e.date <= today && (!e.resumeDate || e.resumeDate > today));

  const statusEl = document.getElementById('f-status-display');
  if (pauseNow) {
    statusEl.textContent = 'En pause';
    statusEl.className = 'status-pill pill-en_pause';
  } else if (effEnd) {
    const terminee = effEnd < today;
    statusEl.textContent = terminee ? 'Terminée' : 'En cours';
    statusEl.className = `status-pill ${terminee ? 'pill-terminee' : 'pill-en_cours'}`;
  } else {
    statusEl.textContent = '';
    statusEl.className = 'status-pill';
  }

  // Le résumé (dates, TJM actuel, taux d'activité, marge, dernière modification) ne s'affiche
  // que pour une prestation verrouillée (existe déjà, ou vient d'une opportunité) : à la création
  // directe, rien à résumer par définition — on ne sait pas encore ce qui sera fait de la mission.
  const locked = !!document.getElementById('f-id').value || !!document.getElementById('f-opportunite-id').value;

  const startDate = document.getElementById('f-start').value;
  document.getElementById('mission-dates-display').textContent =
    locked && startDate && effEnd ? `${fmtD(startDate)} → ${fmtD(effEnd)}` : '';

  const baseTjm = parseFloat(document.getElementById('f-tjm').value) || null;
  const baseFte = parseInt(document.getElementById('f-fte').value)   || null;
  const tjmRevs = modalRevisions.filter(r => r.tjm !== undefined);
  const fteRevs = modalRevisions.filter(r => r.fte !== undefined);
  // TJM/taux d'activité "en cours" : dernière révision connue, sinon la valeur de départ — même
  // valeur que la 1re/dernière ligne de la table de tarification (renderRevisions()).
  const curTjm = tjmRevs.length ? tjmRevs[tjmRevs.length - 1].tjm : baseTjm;
  const curFte = fteRevs.length ? fteRevs[fteRevs.length - 1].fte : baseFte;

  // Taux de marge hebdo = (TJM − coût complet du consultant) / TJM, sur le TJM en cours (pas la
  // valeur de départ). Le taux d'activité (jours/semaine) n'entre pas dans le calcul : il
  // multiplie recette ET coût de la même façon, un TAUX (contrairement à un montant) reste donc
  // le même quel que soit le temps de présence.
  const margeEl = document.getElementById('marge-hebdo-display');
  const consultant = S.consultants.find(c => c.id === document.getElementById('f-cons').value);
  const cout = consultant ? currentCoutComplet(consultant, todayStr()) : 0;
  if (locked && curTjm && cout > 0) {
    const margePct = Math.round((curTjm - cout) / curTjm * 100);
    const color = margePct >= 20 ? 'var(--green)' : margePct >= 10 ? 'var(--yellow)' : 'var(--red)';
    margeEl.innerHTML = `Taux de marge hebdo : <strong style="color:${color}">${margePct}%</strong>`;
  } else {
    margeEl.textContent = '';
  }

  const tjmDisp = document.getElementById('current-tjm-display');
  if (locked && curTjm) {
    const diff = tjmRevs.length && baseTjm ? curTjm - baseTjm : null;
    tjmDisp.innerHTML = `TJM actuel : <strong style="color:var(--accent)">${curTjm.toLocaleString('fr-FR')} €/j</strong>` +
      (diff !== null ? ` <span style="color:${diff>=0?'var(--green)':'var(--red)'};">(${diff>=0?'+':''}${diff} €)</span>` : '');
  } else {
    tjmDisp.textContent = '';
  }

  document.getElementById('current-fte-display').textContent =
    locked && curFte ? `Taux d'activité actuel : ${curFte}/5` : '';

  // Dernière modification de mission enregistrée (n'importe quel type), s'il y en a une —
  // uniquement la plus récente par date d'effet, pas tout l'historique (déjà dans la table
  // "Modification de la mission" plus bas).
  const lastEvtDisp = document.getElementById('last-mission-event-display');
  if (locked && modalMissionEvents.length) {
    const last = modalMissionEvents[modalMissionEvents.length - 1];
    const label = MISSION_EVENT_LABELS[last.type] || last.type;
    lastEvtDisp.textContent = `Dernière modification : ${label} · ${fmtD(last.date)}${last.resumeDate ? ` → reprise ${fmtD(last.resumeDate)}` : ''}`;
  } else {
    lastEvtDisp.textContent = '';
  }
}

// Une révision porte un TJM et/ou un taux d'activité (au moins un des deux) + une date. Si une
// entrée existe déjà à cette date, on la complète plutôt que de l'écraser (ex: TJM ajouté un
// jour, taux d'activité ajouté le même jour plus tard — les deux doivent survivre ensemble).
function addRevision() {
  const date   = document.getElementById('rev-date').value;
  const tjmVal = document.getElementById('rev-tjm').value;
  const fteVal = document.getElementById('rev-fte').value;
  const tjm = tjmVal ? parseFloat(tjmVal) : undefined;
  const fte = fteVal ? parseInt(fteVal)   : undefined;
  if (!date) { showToast('Saisissez une date de mise en place', 'error'); return; }
  if (tjm === undefined && fte === undefined) { showToast('Saisissez un TJM ou un taux d\'activité', 'error'); return; }
  const existing = modalRevisions.find(r => r.date === date);
  if (existing) {
    if (tjm !== undefined) existing.tjm = tjm;
    if (fte !== undefined) existing.fte = fte;
  } else {
    modalRevisions.push({ date, ...(tjm !== undefined ? {tjm} : {}), ...(fte !== undefined ? {fte} : {}) });
    modalRevisions.sort((a,b) => a.date.localeCompare(b.date));
  }
  document.getElementById('rev-date').value = '';
  document.getElementById('rev-tjm').value  = '';
  document.getElementById('rev-fte').value  = '';
  renderRevisions();
  updateBadges();
}

function removeRevision(date) {
  if (!confirm('Supprimer cette révision ?')) return;
  modalRevisions = modalRevisions.filter(r => r.date !== date);
  renderRevisions();
  updateBadges();
}

// Table tarification = un instantané complet par ligne (valeurs de départ + chaque révision),
// pas seulement ce qui a changé ce jour-là : une ligne "taux d'activité seul" reprend quand même
// le dernier TJM connu, pour que chaque colonne soit toujours lisible. Couleurs alignées sur les
// tags du haut de modale (TJM en accent, marge au même code vert/jaune/rouge).
function renderRevisions() {
  const tbody = document.getElementById('tarif-table-body');
  tbody.innerHTML = '';
  const baseTjm    = parseFloat(document.getElementById('f-tjm').value) || undefined;
  const baseFte    = parseInt(document.getElementById('f-fte').value)   || undefined;
  const startDate  = document.getElementById('f-start').value;
  const consultant = S.consultants.find(c => c.id === document.getElementById('f-cons').value);

  if (!startDate) {
    tbody.innerHTML = `<tr><td colspan="6" style="color:var(--text-muted);padding:6px 0;white-space:normal">Renseignez une date de début pour voir la tarification.</td></tr>`;
    return;
  }

  const rows = [{ date: startDate, tjm: baseTjm, fte: baseFte, base: true }, ...modalRevisions];
  let curTjm, curFte, prevTjm;
  rows.forEach(r => {
    if (r.tjm !== undefined) curTjm = r.tjm;
    if (r.fte !== undefined) curFte = r.fte;

    const cout = consultant ? currentCoutComplet(consultant, r.date) : 0;
    let margeHtml = '—';
    if (curTjm && cout > 0) {
      const pct = Math.round((curTjm - cout) / curTjm * 100);
      const color = pct >= 20 ? 'var(--green)' : pct >= 10 ? 'var(--yellow)' : 'var(--red)';
      margeHtml = `<span style="color:${color}">${pct}%</span>`;
    }

    let trendHtml = '<span style="color:var(--text-muted)">≈</span>';
    if (prevTjm !== undefined && curTjm !== undefined) {
      if (curTjm > prevTjm) trendHtml = '<span style="color:var(--green)">↑</span>';
      else if (curTjm < prevTjm) trendHtml = '<span style="color:var(--red)">↓</span>';
    }

    tbody.innerHTML += `
      <tr>
        <td><strong style="color:var(--accent)">${curTjm !== undefined ? curTjm.toLocaleString('fr-FR')+' €/j' : '—'}</strong></td>
        <td>${curFte !== undefined ? curFte+'/5' : '—'}</td>
        <td>${r.base ? 'Mise en place · ' : ''}${fmtD(r.date)}</td>
        <td>${margeHtml}</td>
        <td>${trendHtml}</td>
        <td>${r.base ? '' : `<button class="btn-icon" onclick="removeRevision('${r.date}')" title="Supprimer" aria-label="Supprimer cette révision" style="width:22px;height:22px;font-size:var(--text-sm)">×</button>`}</td>
      </tr>`;
    prevTjm = curTjm;
  });
}

function savePrestation() {
  const id           = document.getElementById('f-id').value;
  const consultantId = document.getElementById('f-cons').value;
  const client       = document.getElementById('f-client').value.trim();
  const clientService= document.getElementById('f-service').value.trim();
  const startDate    = document.getElementById('f-start').value;
  const endDate      = document.getElementById('f-end').value;
  const tjm          = parseFloat(document.getElementById('f-tjm').value) || 0;
  const fte          = parseInt(document.getElementById('f-fte').value) || 5;
  const limiteUOAn   = parseInt(document.getElementById('f-uo').value) || undefined;
  const nature       = document.getElementById('f-nature').value;
  const titre        = document.getElementById('f-titre').value.trim();
  const notes        = document.getElementById('f-notes').value.trim();

  clearFieldErrors(['f-client', 'f-start', 'f-end', 'f-tjm', 'f-cons', 'f-nature']);
  const missing = [];
  if (!client) missing.push('f-client');
  if (!startDate) missing.push('f-start');
  if (!endDate) missing.push('f-end');
  if (!tjm) missing.push('f-tjm');
  if (!consultantId) missing.push('f-cons');
  // Optionnelle à l'étape Opportunité (pas toujours connue dès la détection), mais devient
  // obligatoire ici si elle n'a pas déjà été reprise de l'opportunité d'origine.
  if (!nature) missing.push('f-nature');
  if (missing.length) {
    missing.forEach(id => markFieldInvalid(id, 'Ce champ est obligatoire.'));
    showToast('Merci de compléter les champs obligatoires en surbrillance', 'error');
    document.getElementById(missing[0]).focus();
    return false;
  }
  if (endDate < startDate) { markFieldInvalid('f-end', 'La date de fin doit être après la date de début.'); showToast('La date de fin doit être après la date de début', 'error'); document.getElementById('f-end').focus(); return false; }

  const opportuniteId = document.getElementById('f-opportunite-id').value || undefined;

  const prest = {
    id: id || genId(),
    consultantId, client, clientService, startDate, endDate,
    missionEvents: modalMissionEvents,
    tjm, fte, limiteUOAn, nature, titre, tjmRevisions: modalRevisions,
    notes, opportuniteId,
  };

  if (id) {
    const i = S.prestations.findIndex(p => p.id === id);
    if (i >= 0) S.prestations[i] = prest;
  } else {
    S.prestations.push(prest);
  }

  if (modalWonCandidatureId) {
    const cand = S.candidatures.find(c => c.id === modalWonCandidatureId);
    if (cand) {
      cand.status = 'gagnee';
      cand.prestationId = prest.id;
      const opp = S.opportunites.find(o => o.id === cand.opportuniteId);
      if (opp) opp.status = 'pourvu';
    }
    modalWonCandidatureId = null;
  }

  save();
  closeModal('prest-overlay');
  render();
  showToast('Prestation enregistrée', 'success');
  return true;
}

function showOriginBannerLinked() {
  const b = document.getElementById('prest-origin-banner');
  b.className = 'modal-info-banner';
  b.style.display = '';
  b.innerHTML = `<span>Issue d'une opportunité</span>
    <button type="button" class="btn-add-small" onclick="viewOriginOpportunite()">Voir l'opportunité d'origine</button>`;
}
function showOriginBannerMuted() {
  const b = document.getElementById('prest-origin-banner');
  b.className = 'modal-info-banner modal-info-banner-muted';
  b.style.display = '';
  b.innerHTML = `<span>Créée directement, sans opportunité au préalable</span>`;
}
function hideOriginBanner() {
  document.getElementById('prest-origin-banner').style.display = 'none';
}

function viewOriginOpportunite() {
  const oppId = document.getElementById('f-opportunite-id').value;
  if (!oppId) return;
  if (document.getElementById('f-id').value) {
    // Prestation déjà existante : on enregistre les modifs en cours avant de naviguer.
    if (!savePrestation()) return;
  } else {
    // Prestation en cours de création, jamais encore enregistrée (cas juste après avoir gagné
    // une candidature) : rien de réel à sauvegarder, on referme simplement sans valider le
    // formulaire — sinon la validation des dates/TJM bloquerait l'accès à l'opportunité.
    closeModal('prest-overlay');
    render();
  }
  const opp = S.opportunites.find(o => o.id === oppId);
  if (opp) openOpportuniteModal(opp);
}

function deletePrestation() {
  const id = document.getElementById('f-id').value;
  if (!id || !confirm('Supprimer cette prestation ?')) return;
  S.prestations = S.prestations.filter(p => p.id !== id);
  save();
  closeModal('prest-overlay');
  render();
  showToast('Prestation supprimée');
}

// ─── CONSULTANT MODAL ────────────────────────────────────────────────────────
function openConsModal(id) {
  clearFieldErrors(['cf-name', 'cf-date-entree', 'cf-date-sortie']);
  document.getElementById('cons-overlay').classList.add('open');
  if (id) {
    const c = S.consultants.find(x=>x.id===id);
    document.getElementById('cons-modal-title').textContent = 'Modifier le consultant';
    document.getElementById('btn-del-cons').style.display = 'block';
    document.getElementById('cf-id').value    = c.id;
    document.getElementById('cf-name').value  = c.name;
    document.getElementById('cf-role').value  = c.role||'';
    document.getElementById('cf-email').value = c.email||'';
    document.getElementById('cf-date-entree').value = c.dateEntree||'';
    document.getElementById('cf-date-sortie').value = c.dateSortie||'';
    document.getElementById('cf-cout-complet').value = c.coutComplet || '';
    modalCostRevisions = c.coutCompletRevisions ? [...c.coutCompletRevisions] : [];
  } else {
    document.getElementById('cons-modal-title').textContent = 'Nouveau consultant';
    document.getElementById('btn-del-cons').style.display = 'none';
    document.getElementById('cf-id').value = document.getElementById('cf-name').value =
      document.getElementById('cf-role').value = document.getElementById('cf-email').value = '';
    document.getElementById('cf-date-entree').value = document.getElementById('cf-date-sortie').value = '';
    document.getElementById('cf-cout-complet').value = '';
    modalCostRevisions = [];
  }
  renderCostRevisions();
  updateTcDisplay();
  openModalA11y('cons-overlay');
}

function saveConsultant() {
  const id          = document.getElementById('cf-id').value;
  const name        = document.getElementById('cf-name').value.trim();
  const role        = document.getElementById('cf-role').value.trim();
  const email       = document.getElementById('cf-email').value.trim();
  const dateEntree  = document.getElementById('cf-date-entree').value;
  const dateSortie  = document.getElementById('cf-date-sortie').value;
  const coutComplet = parseFloat(document.getElementById('cf-cout-complet').value) || 0;
  clearFieldErrors(['cf-name', 'cf-date-entree', 'cf-date-sortie']);
  const missing = [];
  if (!name) missing.push('cf-name');
  if (!dateEntree) missing.push('cf-date-entree');
  if (missing.length) {
    missing.forEach(markFieldInvalid);
    showToast('Merci de compléter les champs obligatoires en surbrillance', 'error');
    document.getElementById(missing[0]).focus();
    return;
  }
  if (dateSortie && dateSortie < dateEntree) { markFieldInvalid('cf-date-sortie'); showToast('La date de sortie doit être après la date d\'entrée', 'error'); document.getElementById('cf-date-sortie').focus(); return; }
  if (id) {
    const i = S.consultants.findIndex(c=>c.id===id);
    if (i>=0) S.consultants[i] = {...S.consultants[i], name, role, email, dateEntree, dateSortie: dateSortie || undefined, coutComplet: coutComplet || undefined, coutCompletRevisions: modalCostRevisions.length ? modalCostRevisions : undefined};
  } else {
    S.consultants.push({ id: genId(), name, role, email, dateEntree, ...(dateSortie ? {dateSortie} : {}), ...(coutComplet ? {coutComplet} : {}), ...(modalCostRevisions.length ? {coutCompletRevisions: modalCostRevisions} : {}) });
  }
  save(); closeModal('cons-overlay'); render();
  showToast('Consultant enregistré', 'success');
}

function deleteConsultant() {
  const id = document.getElementById('cf-id').value;
  if (!id) return;
  const nb = S.prestations.filter(p=>p.consultantId===id).length;
  const msg = nb > 0
    ? `Ce consultant a ${nb} prestation(s) associée(s). Supprimer quand même ?`
    : 'Supprimer ce consultant ?';
  if (!confirm(msg)) return;
  S.consultants = S.consultants.filter(c=>c.id!==id);
  if (filterCons === id) filterCons = null;
  save(); closeModal('cons-overlay'); render();
  showToast('Consultant supprimé');
}

// ─── OPPORTUNITÉ MODAL ───────────────────────────────────────────────────────
// Une seule fenêtre trace tout le cycle de vie : besoin détecté → candidatures (pushs de
// book + soutenances par consultant candidat) → gagnée (bascule vers une prestation réelle,
// gérée par la modale Prestation existante) ou perdue/abandonnée.
function openOpportuniteModal(opp, prefillClient) {
  clearFieldErrors(['of-client', 'of-start', 'of-end']);
  document.getElementById('opportunite-overlay').classList.add('open');
  const createdLine = document.getElementById('of-created-line');
  if (opp) {
    document.getElementById('opportunite-modal-title').textContent = 'Modifier l\'opportunité';
    document.getElementById('btn-del-opp').style.display = 'block';
    document.getElementById('of-id').value      = opp.id;
    document.getElementById('of-client').value  = opp.client || '';
    document.getElementById('of-service').value = opp.clientService || '';
    document.getElementById('of-titre').value   = opp.titre || '';
    document.getElementById('of-start').value   = opp.startDate || '';
    document.getElementById('of-end').value     = opp.endDate || '';
    document.getElementById('of-nature').value  = opp.nature || '';
    document.getElementById('of-tjm').value     = opp.tjm || '';
    document.getElementById('of-fte').value     = opp.fte || '';
    document.getElementById('of-uo').value      = opp.limiteUOAn || '';
    document.getElementById('of-status').value  = opp.status || 'ouvert';
    createdLine.hidden = !opp.createdAt;
    createdLine.textContent = opp.createdAt ? `Créée le ${fmtD(opp.createdAt)}` : '';
    modalCandidatures = S.candidatures.filter(c => c.opportuniteId === opp.id).map(c => ({...c}));
  } else {
    document.getElementById('opportunite-modal-title').textContent = 'Ajouter une opportunité';
    document.getElementById('btn-del-opp').style.display = 'none';
    document.getElementById('of-id').value      = '';
    document.getElementById('of-client').value  = prefillClient || '';
    document.getElementById('of-service').value = '';
    document.getElementById('of-titre').value   = '';
    document.getElementById('of-start').value   = '';
    document.getElementById('of-end').value     = '';
    document.getElementById('of-nature').value  = '';
    document.getElementById('of-tjm').value     = '';
    document.getElementById('of-fte').value     = '';
    document.getElementById('of-uo').value      = '';
    document.getElementById('of-status').value  = 'ouvert';
    createdLine.hidden = true; // rien à afficher tant qu'elle n'a jamais été enregistrée
    modalCandidatures = [];
  }
  renderOpportuniteCandidatures();
  oppModalSnapshot = oppFormState();
  openModalA11y('opportunite-overlay');
}

// Capture l'état courant du formulaire Opportunité (champs + candidatures), pour détecter une
// saisie non enregistrée avant de fermer la modale sans confirmation (cancelOpportuniteModal()).
function oppFormState() {
  const data = {};
  document.querySelectorAll('#opportunite-modal-box input, #opportunite-modal-box select, #opportunite-modal-box textarea')
    .forEach(el => { if (el.id) data[el.id] = el.value; });
  data._candidatures = modalCandidatures;
  return JSON.stringify(data);
}

function cancelOpportuniteModal() {
  if (oppFormState() !== oppModalSnapshot) {
    if (!confirm('Des modifications non enregistrées seront perdues. Annuler quand même ?')) return;
  }
  closeModal('opportunite-overlay');
}

// Écrit l'état courant du formulaire + modalCandidatures dans S, sans fermer la modale.
// Retourne l'id de l'opportunité, ou null si la validation échoue.
function commitOpportuniteFromForm() {
  const id            = document.getElementById('of-id').value;
  const client        = document.getElementById('of-client').value.trim();
  const clientService = document.getElementById('of-service').value.trim();
  const titre         = document.getElementById('of-titre').value.trim();
  const startDate     = document.getElementById('of-start').value;
  const endDate       = document.getElementById('of-end').value;
  const nature        = document.getElementById('of-nature').value;
  const tjm           = parseFloat(document.getElementById('of-tjm').value) || undefined;
  const fte           = parseInt(document.getElementById('of-fte').value) || undefined;
  const limiteUOAn    = parseInt(document.getElementById('of-uo').value) || undefined;
  const status        = document.getElementById('of-status').value;

  clearFieldErrors(['of-client', 'of-start', 'of-end']);
  const missing = [];
  if (!client) missing.push('of-client');
  if (missing.length) {
    missing.forEach(id => markFieldInvalid(id, 'Ce champ est obligatoire.'));
    showToast('Merci de compléter les champs obligatoires en surbrillance', 'error');
    document.getElementById(missing[0]).focus();
    return null;
  }
  if (startDate && endDate && endDate < startDate) {
    markFieldInvalid('of-end', 'La date de fin prévue doit être après la date de début.');
    showToast('La date de fin prévue doit être après la date de début prévue', 'error');
    document.getElementById('of-end').focus();
    return null;
  }

  const oppId = id || genId();
  // createdAt : horodatage immuable, réglé une seule fois — jamais réécrit en édition.
  const existing = id ? S.opportunites.find(o => o.id === id) : null;
  const createdAt = existing ? existing.createdAt : new Date().toISOString().slice(0,10);

  // Remplace toutes les candidatures de cette opportunité par l'état courant du buffer —
  // les lignes sans consultant choisi (brouillon abandonné) sont ignorées.
  const kept = modalCandidatures.filter(c => c.consultantId);

  // Dès qu'il y a au moins une candidature, le statut de l'opportunité se déduit de leur
  // composition plutôt que de se déclarer à la main (simplification volontaire — la nuance
  // "perdue par le consultant" vs "perdue par le client" est mise de côté pour l'instant, voir
  // BACKLOG.md) : une candidature gagnée suffit à la rendre gagnée ; toutes perdues la rendent
  // perdue ; dès qu'une candidature active (en attente) existe à nouveau, elle redevient
  // ouverte automatiquement — pas besoin de repasser le statut à la main après un nouvel ajout.
  // Sans aucune candidature, le champ Statut du formulaire reste la seule source (ex : une
  // opportunité abandonnée avant même qu'un candidat n'ait été proposé).
  let finalStatus = status;
  if (kept.length > 0) {
    if (kept.some(c => c.status === 'gagnee')) finalStatus = 'pourvu';
    else if (kept.every(c => c.status === 'perdue')) finalStatus = 'abandonne';
    else finalStatus = 'ouvert';
  }

  const opp = { id: oppId, client, clientService, titre, startDate, endDate, nature, tjm, fte, limiteUOAn, createdAt, status: finalStatus };
  if (id) {
    const i = S.opportunites.findIndex(o => o.id === id);
    if (i >= 0) S.opportunites[i] = opp;
  } else {
    S.opportunites.push(opp);
  }

  S.candidatures = S.candidatures.filter(c => c.opportuniteId !== oppId)
    .concat(kept.map(c => ({ ...c, opportuniteId: oppId })));

  save();
  return oppId;
}

function saveOpportunite() {
  const oppId = commitOpportuniteFromForm();
  if (oppId === null) return;
  closeModal('opportunite-overlay');
  render();
  showToast('Opportunité enregistrée', 'success');
}

function deleteOpportunite() {
  const id = document.getElementById('of-id').value;
  if (!id) return;
  const nb = S.candidatures.filter(c=>c.opportuniteId===id).length;
  const msg = nb > 0
    ? `Cette opportunité a ${nb} candidature(s) associée(s). Supprimer quand même ?`
    : 'Supprimer cette opportunité ?';
  if (!confirm(msg)) return;
  S.candidatures = S.candidatures.filter(c=>c.opportuniteId!==id);
  S.opportunites = S.opportunites.filter(o=>o.id!==id);
  save(); closeModal('opportunite-overlay'); render();
  showToast('Opportunité supprimée');
}

// ─── CANDIDATURES — édition imbriquée dans la modale Opportunité ─────────────
function renderOpportuniteCandidatures() {
  const el = document.getElementById('opp-candidatures-list');
  if (!modalCandidatures.length) {
    el.innerHTML = `<div style="font-size:var(--text-sm);color:var(--text-muted);padding:6px 0 10px">Aucun candidat pour l'instant.</div>`;
    return;
  }
  const usedConsIds = modalCandidatures.map(c => c.consultantId).filter(Boolean);

  el.innerHTML = modalCandidatures.map(cand => {
    const isPersisted = S.candidatures.some(c => c.id === cand.id);
    const cons = S.consultants.find(c => c.id === cand.consultantId);

    const consHeader = isPersisted
      ? `<span style="flex:1;font-size:var(--text-base);font-weight:600">${cons ? cons.name : 'Consultant supprimé'}</span>`
      : `<select class="form-select" style="flex:1" onchange="setCandidatureConsultant('${cand.id}', this.value)">
          <option value="">— Choisir un consultant —</option>
          ${S.consultants.filter(c => c.id===cand.consultantId || !usedConsIds.includes(c.id))
            .map(c => `<option value="${c.id}" ${c.id===cand.consultantId?'selected':''}>${c.name}</option>`).join('')}
        </select>`;

    const missionBlock = (cand.status==='gagnee' && cand.prestationId && S.prestations.find(p=>p.id===cand.prestationId))
      ? (() => { const p = S.prestations.find(x=>x.id===cand.prestationId); const pStatus = prestationStatus(p); return `
        <div style="display:flex;align-items:center;gap:8px;padding:8px 0;font-size:var(--text-sm);color:var(--text-dim)">
          <span class="status-pill pill-${pStatus}">${statusLabel(pStatus)}</span>
          <span>${fmtD(p.startDate)} → ${fmtD(p.endDate)} · ${currentTjm(p).toLocaleString('fr-FR')} €/j</span>
          <button class="btn-add-small" style="padding:2px 8px;font-size:var(--text-xs);margin-left:auto" onclick="editMissionFromOpportunite('${p.id}')">Modifier la mission</button>
        </div>`; })()
      : '';

    const actions = cand.status === 'en_attente' ? `
        <button class="btn-icon" title="Marquer gagnée" aria-label="Marquer cette candidature gagnée" style="color:var(--green)" onclick="markCandidatureWonInModal('${cand.id}')">✓</button>
        <button class="btn-icon" title="Marquer perdue" aria-label="Marquer cette candidature perdue" style="color:var(--red)" onclick="markCandidatureLostInModal('${cand.id}')">✗</button>` : '';
    const removeBtn = cand.status !== 'gagnee'
      ? `<button class="btn-icon" title="Retirer ce candidat" aria-label="Retirer ce candidat" onclick="removeCandidatureInModal('${cand.id}')">×</button>` : '';

    const pushRows = (cand.bookPushes||[]).map(p => `
      <div class="revision-item">
        <span class="revision-date">${fmtD(p.date)}</span>
        <button class="btn-icon" title="Supprimer" aria-label="Supprimer ce push de book" style="width:22px;height:22px;font-size:var(--text-sm);margin-left:auto" onclick="removeBookPushInModal('${cand.id}','${p.id}')">×</button>
      </div>`).join('') || `<div style="font-size:var(--text-sm);color:var(--text-muted);padding:4px 0">Aucun push.</div>`;
    const soutRows = (cand.soutenances||[]).map(s => {
      const cls = s.resultat === 'validee' ? 'delta-up' : s.resultat === 'refusee' ? 'delta-down' : '';
      return `
      <div class="revision-item">
        <span class="revision-date">${fmtD(s.date)}</span>
        <span class="revision-delta ${cls}">${resultatSoutenanceLabel(s.resultat)}</span>
        <button class="btn-icon" title="Supprimer" aria-label="Supprimer cette soutenance" style="width:22px;height:22px;font-size:var(--text-sm);margin-left:auto" onclick="removeSoutenanceInModal('${cand.id}','${s.id}')">×</button>
      </div>`;
    }).join('') || `<div style="font-size:var(--text-sm);color:var(--text-muted);padding:4px 0">Aucune soutenance.</div>`;

    return `
      <div class="opp-cand-card">
        <div class="opp-cand-header">
          ${consHeader}
          <span class="status-pill pill-cand-${cand.status}">${candidatureStatusLabel(cand.status)}</span>
          ${actions}${removeBtn}
        </div>
        ${missionBlock}
        <div class="opp-cand-body">
          <div class="opp-cand-sublist">
            <div class="form-label" style="font-size:var(--text-xs);margin-bottom:4px">Pushs de book/CV</div>
            <div class="revision-list">${pushRows}</div>
            <div class="add-revision-row">
              <input type="date" class="form-input" id="push-date-${cand.id}" style="flex:1" />
              <button class="btn-add-small" onclick="addBookPushInModal('${cand.id}')">+ Ajouter</button>
            </div>
          </div>
          <div class="opp-cand-sublist">
            <div class="form-label" style="font-size:var(--text-xs);margin-bottom:4px">Soutenances</div>
            <div class="revision-list">${soutRows}</div>
            <div class="add-revision-row">
              <input type="date" class="form-input" id="sout-date-${cand.id}" style="flex:1" />
              <select class="form-select" id="sout-resultat-${cand.id}" style="flex:1">
                <option value="en_attente">En attente</option>
                <option value="validee">Validée</option>
                <option value="refusee">Refusée</option>
              </select>
              <button class="btn-add-small" onclick="addSoutenanceInModal('${cand.id}')">+ Ajouter</button>
            </div>
          </div>
        </div>
      </div>`;
  }).join('');
}

function addCandidatureInModal() {
  modalCandidatures.push({ id: genId(), consultantId: '', status: 'en_attente', bookPushes: [], soutenances: [] });
  renderOpportuniteCandidatures();
}

function setCandidatureConsultant(candId, consultantId) {
  const cand = modalCandidatures.find(c => c.id === candId);
  if (!cand) return;
  if (consultantId && modalCandidatures.some(c => c.id!==candId && c.consultantId===consultantId)) {
    showToast('Ce consultant est déjà candidat sur cette opportunité', 'error');
    renderOpportuniteCandidatures();
    return;
  }
  cand.consultantId = consultantId;
}

function removeCandidatureInModal(candId) {
  if (!confirm('Retirer ce candidat ?')) return;
  modalCandidatures = modalCandidatures.filter(c => c.id !== candId);
  renderOpportuniteCandidatures();
}

function addBookPushInModal(candId) {
  const cand = modalCandidatures.find(c => c.id === candId);
  const fieldId = `push-date-${candId}`;
  clearFieldErrors([fieldId]);
  const date = document.getElementById(fieldId).value;
  if (!date) { markFieldInvalid(fieldId); showToast('Saisissez une date', 'error'); document.getElementById(fieldId).focus(); return; }
  cand.bookPushes = cand.bookPushes || [];
  cand.bookPushes.push({ id: genId(), date });
  cand.bookPushes.sort((a,b) => a.date.localeCompare(b.date));
  renderOpportuniteCandidatures();
}
function removeBookPushInModal(candId, pushId) {
  if (!confirm('Supprimer ce push ?')) return;
  const cand = modalCandidatures.find(c => c.id === candId);
  cand.bookPushes = cand.bookPushes.filter(p => p.id !== pushId);
  renderOpportuniteCandidatures();
}

function addSoutenanceInModal(candId) {
  const cand = modalCandidatures.find(c => c.id === candId);
  const fieldId  = `sout-date-${candId}`;
  clearFieldErrors([fieldId]);
  const date     = document.getElementById(fieldId).value;
  const resultat = document.getElementById(`sout-resultat-${candId}`).value;
  if (!date) { markFieldInvalid(fieldId); showToast('Saisissez une date', 'error'); document.getElementById(fieldId).focus(); return; }
  cand.soutenances = cand.soutenances || [];
  cand.soutenances.push({ id: genId(), date, resultat });
  cand.soutenances.sort((a,b) => a.date.localeCompare(b.date));
  renderOpportuniteCandidatures();
}
function removeSoutenanceInModal(candId, soutId) {
  if (!confirm('Supprimer cette soutenance ?')) return;
  const cand = modalCandidatures.find(c => c.id === candId);
  cand.soutenances = cand.soutenances.filter(s => s.id !== soutId);
  renderOpportuniteCandidatures();
}

// Gagnée/perdue committent immédiatement (pas d'attente du bouton Enregistrer global) : ce
// sont des transitions d'état qu'on ne veut pas perdre si la modale est ensuite annulée.
function markCandidatureLostInModal(candId) {
  const cand = modalCandidatures.find(c => c.id === candId);
  if (!cand) return;
  cand.status = 'perdue';
  if (commitOpportuniteFromForm() === null) return;
  renderOpportuniteCandidatures();
  render();
  showToast('Candidature marquée perdue');
}

function markCandidatureWonInModal(candId) {
  const cand = modalCandidatures.find(c => c.id === candId);
  if (!cand || !cand.consultantId) return;
  const oppId = commitOpportuniteFromForm();
  if (oppId === null) return;
  closeModal('opportunite-overlay');
  render();
  const opp = S.opportunites.find(o => o.id === oppId);
  // Ordre important : modalWonCandidatureId doit être fixé APRÈS l'appel à openPrestModal,
  // qui le remet lui-même à null en entrée (voir openPrestModal) pour tout autre usage de la modale.
  openPrestModal(null, cand.consultantId);
  modalWonCandidatureId = candId;
  document.getElementById('f-client').value  = opp.client;
  document.getElementById('f-service').value = opp.clientService || '';
  if (opp.startDate) document.getElementById('f-start').value  = opp.startDate;
  if (opp.endDate)   document.getElementById('f-end').value    = opp.endDate;
  if (opp.nature)    document.getElementById('f-nature').value = opp.nature;
  if (opp.titre)     document.getElementById('f-titre').value  = opp.titre;
  if (opp.tjm)       document.getElementById('f-tjm').value    = opp.tjm;
  if (opp.fte)       document.getElementById('f-fte').value    = opp.fte;
  if (opp.limiteUOAn) document.getElementById('f-uo').value    = opp.limiteUOAn;
  document.getElementById('f-opportunite-id').value = opp.id;
  showOriginBannerLinked();
  // f-opportunite-id vient d'être renseigné : on relance le verrouillage (openPrestModal() l'a
  // déjà fait, mais avant que cet id ne soit connu — il voyait encore une création "directe").
  updateLockedSections();
  // Les préremplissages ci-dessus (dates, TJM...) arrivent après le updateBadges() déjà
  // exécuté en fin d'openPrestModal() — on le relance pour que statut/marge/TJM actuel
  // reflètent bien ces valeurs dès l'ouverture, pas seulement après une saisie manuelle.
  updateBadges();
  // Idem pour l'instantané anti-perte de données (cancelPrestModal()) : capturé une 2e fois
  // ici, sinon les préremplissages ci-dessus seraient vus comme une modification de l'utilisateur.
  prestModalSnapshot = prestFormState();
}

function editMissionFromOpportunite(prestId) {
  if (commitOpportuniteFromForm() === null) return;
  closeModal('opportunite-overlay');
  render();
  openPrestModal(S.prestations.find(p => p.id === prestId));
}

// ─── VUE LISTE — bascule Consultants ⇆ Clients ────────────────────────────────
function setViewMode(v) {
  viewMode = v;
  document.querySelectorAll('.viewmode-btn').forEach(b => {
    const selected = b.dataset.vm === v;
    b.classList.toggle('active', selected);
    b.setAttribute('aria-selected', selected ? 'true' : 'false');
    // Roving tabindex (motif ARIA tabs) : seul l'onglet actif est atteint par Tab, les
    // flèches gauche/droite déplacent le focus entre les onglets (voir plus bas).
    b.tabIndex = selected ? 0 : -1;
  });
  // Les panneaux (#list-view, #gantt-rows) référencent l'onglet actif : un lecteur d'écran doit
  // pouvoir remonter de leur contenu à l'onglet qui les pilote, même après un changement de vue.
  document.getElementById('list-view').setAttribute('aria-labelledby', `tab-${v}`);
  document.getElementById('gantt-rows').setAttribute('aria-labelledby', `tab-gantt-${v}`);
  render();
}

// Motif ARIA tabs complet : flèches gauche/droite/Home/End déplacent le focus ET activent
// l'onglet visé (activation automatique — cohérent avec le clic, qui bascule déjà la vue
// instantanément). Un seul gestionnaire pour les 2 groupes d'onglets Consultants/Clients
// (Gantt et Vue liste), chacun cyclant dans son propre tablist.
document.querySelectorAll('[role="tablist"]').forEach(list => {
  list.addEventListener('keydown', (e) => {
    const tabs = Array.from(list.querySelectorAll('[role="tab"]'));
    const i = tabs.indexOf(document.activeElement);
    if (i === -1) return;
    let next = null;
    if (e.key === 'ArrowRight') next = tabs[(i + 1) % tabs.length];
    else if (e.key === 'ArrowLeft') next = tabs[(i - 1 + tabs.length) % tabs.length];
    else if (e.key === 'Home') next = tabs[0];
    else if (e.key === 'End') next = tabs[tabs.length - 1];
    if (!next) return;
    e.preventDefault();
    next.focus();
    setViewMode(next.dataset.vm);
  });
});

// ─── MODAL UTILS ─────────────────────────────────────────────────────────────
// Signalement accessible des champs obligatoires manquants : surbrillance visuelle
// (.field-invalid) + aria-invalid pour les lecteurs d'écran + texte inline (#err-<id>,
// affiché sous l'aide utilisateur du champ), en plus du toast.
function markFieldInvalid(id, message) {
  const el = document.getElementById(id);
  if (!el) return;
  el.classList.add('field-invalid');
  el.setAttribute('aria-invalid', 'true');
  const err = document.getElementById('err-' + id);
  if (err) {
    err.textContent = message || 'Ce champ est invalide.';
    err.classList.add('visible');
  }
}
function clearFieldErrors(ids) {
  ids.forEach(id => {
    const el = document.getElementById(id);
    if (el) {
      el.classList.remove('field-invalid');
      el.removeAttribute('aria-invalid');
    }
    const err = document.getElementById('err-' + id);
    if (err) {
      err.textContent = '';
      err.classList.remove('visible');
    }
  });
}
// ─── ACCESSIBILITÉ MODALES : focus au clavier ───────────────────────────────
// Sans ça, à l'ouverture d'une modale (souris ou clavier), le focus restait sur la page de
// fond — un utilisateur clavier ne pouvait remplir aucun champ (RGAA 7.3/12.6). Centralisé
// ici plutôt que répété dans chaque open*Modal, puisque les 4 modales de données ferment
// déjà toutes via closeModal(). Même logique de "bouton Annuler par modale" que overlayClick
// ci-dessous, réutilisée pour Échap.
const MODAL_CANCEL = {
  'prest-overlay': cancelPrestModal,
  'opportunite-overlay': cancelOpportuniteModal,
};
let modalTrigger = null;

function getFocusable(container) {
  return Array.from(container.querySelectorAll(
    'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])'
  )).filter(el => el.offsetParent !== null);
}

// À appeler à la fin de chaque open*Modal, une fois la modale entièrement remplie/affichée.
// Le focus va au 1er champ du corps de la modale (pas au bouton "Fermer" du header quand il
// existe — cons-overlay en a un, prest/opportunite-overlay n'en ont pas : sans ce choix,
// le 1er arrêt du Tab changerait selon la modale ouverte).
function openModalA11y(overlayId) {
  modalTrigger = document.activeElement;
  const overlay = document.getElementById(overlayId);
  const body = overlay.querySelector('.modal-body');
  const focusable = getFocusable(body || overlay);
  if (focusable.length) focusable[0].focus();
}

// Piège le Tab dans la modale ouverte, et route Échap vers son bouton Annuler (mêmes
// vérifications d'unsaved-changes que la croix/le clic en dehors).
document.addEventListener('keydown', (e) => {
  const overlay = document.querySelector('.modal-overlay.open');
  if (!overlay) return;
  if (e.key === 'Escape') {
    // Cas particulier : "Qui êtes-vous ?" ne doit pas pouvoir se fermer sans choix tant
    // qu'aucun profil n'a jamais été validé (1er chargement) — seul un re-changement de
    // profil (currentProfile déjà défini) peut être annulé sans effet.
    if (overlay.id === 'profile-overlay' && !currentProfile) return;
    (MODAL_CANCEL[overlay.id] || (() => closeModal(overlay.id)))();
    return;
  }
  if (e.key !== 'Tab') return;
  const focusable = getFocusable(overlay);
  if (!focusable.length) return;
  const first = focusable[0], last = focusable[focusable.length - 1];
  if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
  else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
});

function closeModal(overlayId) {
  document.getElementById(overlayId).classList.remove('open');
  if (modalTrigger) { modalTrigger.focus(); modalTrigger = null; }
}
function overlayClick(e, id) {
  if (e.target.id !== id) return;
  if (id === 'prest-overlay') { cancelPrestModal(); return; }
  if (id === 'opportunite-overlay') { cancelOpportuniteModal(); return; }
  closeModal(id);
}

// ─── CHART TOOLTIP (au clic) ─────────────────────────────────────────────────
function showPointTooltip(anchorEl, html) {
  const tip = document.getElementById('chart-tooltip');
  tip.innerHTML = html;
  const rect = anchorEl.getBoundingClientRect();
  tip.style.left = (rect.left + rect.width / 2) + 'px';
  tip.style.top  = (rect.top - 8) + 'px';
  tip.classList.add('visible');
}
function hidePointTooltip() {
  document.getElementById('chart-tooltip').classList.remove('visible');
}
document.addEventListener('click', (e) => {
  if (!document.getElementById('chart-tooltip').contains(e.target)) hidePointTooltip();
});
document.addEventListener('scroll', hidePointTooltip, true);

// ─── TOAST ───────────────────────────────────────────────────────────────────
let toastTimeout = null;
function showToast(msg, type='success') {
  const t = document.getElementById('toast');
  // Préfixe textuel : ne pas coder l'info uniquement par la couleur de bordure (WCAG 1.4.1),
  // et rend le message intelligible même sans percevoir la couleur (lecteur d'écran compris).
  const prefix = type === 'error' ? 'Erreur : ' : 'Succès : ';
  t.textContent = prefix + msg;
  t.className = `show ${type}`;
  // Les erreurs restent affichées plus longtemps : messages en général plus longs/importants
  // à lire qu'une simple confirmation.
  const duration = type === 'error' ? 4500 : 2500;
  clearTimeout(toastTimeout);
  toastTimeout = setTimeout(()=>{ t.className=''; }, duration);
}

// ─── INIT VIEW ────────────────────────────────────────────────────────────────
document.getElementById('gantt-container').style.display = 'flex';
document.getElementById('gantt-container').style.flexDirection = 'column';
document.getElementById('list-view-container').style.display  = 'none';
document.getElementById('stats-view').style.display = 'none';

// Navigation clavier dans le Gantt : flèches ← → une fois la chronologie focus (clic ou Tab).
document.getElementById('gantt-scroll').addEventListener('keydown', (e) => {
  if (e.key === 'ArrowLeft')  { e.preventDefault(); scrollGanttBy(-1); }
  if (e.key === 'ArrowRight') { e.preventDefault(); scrollGanttBy(1);  }
});
