// ─── CONSTANTS ───────────────────────────────────────────────────────────────
const COLORS = ['#818cf8','#34d399','#fb923c','#f472b6','#a78bfa','#22d3ee','#4ade80','#fbbf24','#60a5fa','#f87171'];
// Fenêtre large (1 an dans le passé, 2 ans dans le futur) pour qu'il y ait vraiment de quoi
// naviguer dans le temps (scroll horizontal natif + boutons Précédent/Aujourd'hui/Suivant,
// voir scrollGanttBy()/scrollGanttToToday()) — avant, seuls 15 mois fixes étaient affichés.
const GANTT_MONTHS = 36;
const GANTT_OFFSET = -12; // start 12 months before today

// ─── STATE ────────────────────────────────────────────────────────────────────
let S = { consultants: [], prestations: [], opportunites: [], candidatures: [], commerciaux: [] };
let filterCons   = null;  // null = all
let filterCommercial = null; // null = all — id d'un commercial, restreint par portefeuille client (commercialOwnsClient())
let filterStatus = 'all'; // bucket commun : 'all' | 'en_cours' | 'en_attente' | 'gagne' | 'perdu'
let filterType   = 'all'; // 'all' | 'prestation' | 'opportunite' — Vue liste uniquement
let currentView  = 'gantt';
let currentProfile = null; // { type: 'manager' } | { type: 'consultant', id } | { type: 'commercial', id }
let viewMode = 'consultants'; // 'consultants' | 'clients' — bascule de la Vue liste

// Temp modal state
let modalRevisions = []; // [{date, tjm}]
let modalCostRevisions = []; // [{date, coutComplet}]
let modalAbsences = []; // [{startDate, endDate, period?: 'matin'|'apres-midi'}] — pas de raison enregistrée
let modalCandidatures = []; // [{id, consultantId, status, bookPushes:[{id,date}], soutenances:[{id,date,resultat}]}]
let modalWonCandidatureId = null; // set par markCandidatureWonInModal(), consommé par savePrestation()
let modalMissionEvents = []; // [{id, type: 'prolongation'|'pause'|'sortie_anticipee', date, resumeDate?}]
let prestModalSnapshot = null; // état du formulaire à l'ouverture, pour détecter une saisie non enregistrée (cancelPrestModal())
let oppModalSnapshot = null; // idem, pour la modale Opportunité (cancelOpportuniteModal())
// Prestation/Opportunité actuellement affichées dans "Suivre la demande" (null si le bloc
// correspondant n'existe pas pour cette demande) — voir openSuiviDemande().
let suiviDemandePrest = null;
let suiviDemandeOpp   = null;
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
    S.commerciaux  = S.commerciaux  || [];
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

// Un commercial "possède" un client si son portefeuille (commercial.clients) contient ce nom,
// comparaison insensible à la casse/espaces — même nom que celui saisi dans `client` sur une
// opportunité/prestation (pas de référence par id, un commercial peut être ajouté après coup).
function commercialOwnsClient(commercial, client) {
  const needle = (client || '').trim().toLowerCase();
  return (commercial?.clients || []).some(c => c.trim().toLowerCase() === needle);
}
// Cherche, parmi S.commerciaux, celui dont le portefeuille contient ce client — utilisé pour
// pré-remplir le commercial attaché sur une opportunité/prestation (reste modifiable à la main).
function findCommercialForClient(client) {
  return S.commerciaux.find(co => commercialOwnsClient(co, client));
}
// Commercial actuellement connecté (profil "commercial" du panneau de lancement), ou null —
// à utiliser pour restreindre l'affichage à son portefeuille (commercialOwnsClient()).
function activeCommercial() {
  return filterCommercial ? S.commerciaux.find(co => co.id === filterCommercial) : null;
}

// Remplit un <select> "Commercial attaché" (modales Opportunité/Prestation) à partir de
// S.commerciaux, avec une option vide. Verrouillé sur lui-même pour un profil Commercial
// connecté — même principe que le verrouillage de f-cons pour un profil Consultant.
function populateCommercialSelect(selectId, selectedId) {
  const sel = document.getElementById(selectId);
  sel.innerHTML = '<option value="">— Aucun —</option>';
  S.commerciaux.forEach(co => {
    const o = document.createElement('option');
    o.value = co.id; o.textContent = co.name;
    sel.appendChild(o);
  });
  const isCommercialProfile = currentProfile?.type === 'commercial';
  sel.value = isCommercialProfile ? currentProfile.id : (selectedId || '');
  sel.disabled = isCommercialProfile;
}

// Pré-remplit le commercial attaché quand le client saisi correspond à un portefeuille connu —
// seulement si le champ est encore vide (ne jamais écraser un choix déjà fait à la main) et
// que le champ n'est pas verrouillé sur le profil Commercial connecté.
function autoSuggestCommercial(clientFieldId, commercialFieldId) {
  const sel = document.getElementById(commercialFieldId);
  if (sel.disabled || sel.value) return;
  const match = findCommercialForClient(document.getElementById(clientFieldId).value);
  if (match) sel.value = match.id;
}

// Toutes les prestations qui partagent la même entité (besoin/projet) — client + service
// client, pas le titre du profil (qui varie par consultant : lead/prod/dev, ou 1 UXR + 2
// product designers sur le même besoin). Voir decisions/vue-prestation-macro-micro/.
function prestationsForEntity(client, clientService) {
  return S.prestations
    .filter(p => p.client === client && (p.clientService||'') === (clientService||''))
    .sort((a,b) => a.startDate.localeCompare(b.startDate));
}

// nature/limite d'UO/commercial sont des réglages d'entité (voir f-nature/f-uo/f-commercial,
// devenus des champs cachés dans la modale Prestation) : à la création d'une nouvelle
// prestation, si le client+service saisi correspond à une entité déjà staffée par ailleurs, on
// hérite de ses réglages plutôt que de les laisser vides — pour un ajout à une entité qui
// n'existe pas encore, "Réglages de la prestation" (depuis "Suivre la demande") permet de les
// corriger juste après la création.
function inheritEntitySettingsFromClient() {
  const client = document.getElementById('f-client').value;
  const clientService = document.getElementById('f-service').value;
  const siblings = prestationsForEntity(client, clientService);
  if (siblings.length) {
    const ref = siblings[0];
    document.getElementById('f-nature').value      = ref.nature || 'mission';
    document.getElementById('f-uo').value           = ref.limiteUOAn || '';
    document.getElementById('f-commercial').value   = ref.commercialId || '';
  } else {
    // Pas d'entité existante pour hériter : on retombe sur la suggestion par portefeuille
    // client, comme avant (autoSuggestCommercial()), sans écraser un choix déjà fait.
    const match = findCommercialForClient(client);
    if (match && !document.getElementById('f-commercial').value) {
      document.getElementById('f-commercial').value = match.id;
    }
  }
  updateLockedSections();
}

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
  // Une révision peut ne porter qu'un taux d'occupation (pas de TJM) : on ignore ces entrées ici,
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

// Valeur de départ suggérée pour le TJM d'une nouvelle prestation (jamais en édition) : coût
// complet actuel du consultant sélectionné, majoré de la même marge cible que le "TC" déjà
// affiché dans la fiche consultant (updateTcDisplay()) — aucun nouveau champ, juste une
// suggestion modifiable à la main selon la négociation client. Ne touche jamais un champ déjà
// rempli (ex: TJM estimé repris d'une opportunité gagnée, qui garde la priorité).
function prefillTjmFromConsultant() {
  const tjmField = document.getElementById('f-tjm');
  if (tjmField.value) return;
  const consultant = S.consultants.find(c => c.id === document.getElementById('f-cons').value);
  if (!consultant) return;
  const cc = currentCoutComplet(consultant, todayStr());
  if (cc > 0) tjmField.value = Math.round(cc * 1.32);
}

// Jours ouvrés (lun-ven) réellement compris entre deux dates — un mois de 28 jours n'a pas le
// même coût qu'un mois de 31 jours.
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

// 1 = journée complète, 0.5 = demi-journée (matin/après-midi), 0 = pas d'absence ce jour-là.
function absenceFraction(consultant, dateStr) {
  if (!consultant?.absences?.length) return 0;
  return consultant.absences.reduce((frac, a) => {
    if (dateStr < a.startDate || dateStr > a.endDate) return frac;
    return Math.max(frac, a.period ? 0.5 : 1);
  }, 0);
}

// Fraction (0 à 1) de jours ouvrés non travaillés par le consultant staffé sur cette prestation,
// sur l'intersection de la fenêtre de calcul [pStart,pEnd] et de la fenêtre réelle de la
// prestation. Une pause de mission et une absence individuelle qui tombent sur le même jour ne
// se cumulent jamais (Math.max, pas +) — cf. decisions/jours-travailles-ca/evidence.md.
function unavailableFraction(p, consultant, pStart, pEnd) {
  const winStart = new Date(Math.max(pStart, new Date(p.startDate+'T00:00:00')));
  const winEnd   = new Date(Math.min(pEnd, new Date(effectiveEnd(p)+'T00:00:00')));
  if (winStart > winEnd) return 0;
  let weekdays = 0, unavailable = 0;
  const d = new Date(winStart);
  while (d <= winEnd) {
    const day = d.getDay();
    if (day !== 0 && day !== 6) {
      weekdays++;
      const dStr = d.toISOString().slice(0,10);
      unavailable += Math.max(activePause(p, dStr) ? 1 : 0, absenceFraction(consultant, dStr));
    }
    d.setDate(d.getDate() + 1);
  }
  return weekdays > 0 ? unavailable / weekdays : 0;
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
  S.commerciaux = [
    { id: genId(), name: 'Julie Tanguy',   clients: ['Orange', 'Airbus'] },
    { id: genId(), name: 'Marc Delattre',  clients: ['BNP Paribas', 'Société Générale', 'TotalEnergies'] },
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
      fte: 5, nature: 'forfait', prixForfait: 60000, tjmRevisions: [],
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
// 3 groupes : Manager (vue globale), Commercial (restreint à son portefeuille client,
// voir commercialOwnsClient()) et Consultant (restreint à sa propre ligne). Les valeurs
// commercial sont préfixées "commercial:" pour les distinguer des ids consultant dans le
// même <select> à plat.
function populateProfileSelect(preselect) {
  const sel = document.getElementById('profile-select');
  sel.innerHTML = '';
  const manager = document.createElement('option');
  manager.value = 'manager';
  manager.textContent = 'Manager — vue globale';
  sel.appendChild(manager);

  if (S.commerciaux.length) {
    const grp = document.createElement('optgroup');
    grp.label = 'Commercial';
    S.commerciaux.forEach(co => {
      const o = document.createElement('option');
      o.value = 'commercial:' + co.id;
      o.textContent = co.name;
      grp.appendChild(o);
    });
    sel.appendChild(grp);
  }

  const grpCons = document.createElement('optgroup');
  grpCons.label = 'Consultant';
  S.consultants.forEach(c => {
    const o = document.createElement('option');
    o.value = c.id;
    o.textContent = c.name;
    grpCons.appendChild(o);
  });
  sel.appendChild(grpCons);

  if (preselect) sel.value = preselect;
}

function confirmProfile() {
  const val = document.getElementById('profile-select').value;
  if (val === 'manager') {
    currentProfile = { type: 'manager' };
    filterCons = null;
    filterCommercial = null;
  } else if (val.startsWith('commercial:')) {
    const id = val.slice('commercial:'.length);
    currentProfile = { type: 'commercial', id };
    filterCons = null;
    filterCommercial = id;
    // La restriction par portefeuille client (commercialOwnsClient()) n'a de sens qu'en vue
    // clients — la vue consultants n'est pas organisée par client et laisserait tout voir.
    viewMode = 'clients';
  } else {
    currentProfile = { type: 'consultant', id: val };
    filterCons = val;
    filterCommercial = null;
  }
  closeModal('profile-overlay');
  const badge = document.getElementById('profile-badge-label');
  if (currentProfile.type === 'manager') badge.textContent = 'Connecté : Manager';
  else if (currentProfile.type === 'commercial') badge.textContent = `Connecté : ${S.commerciaux.find(c => c.id === currentProfile.id)?.name || ''}`;
  else badge.textContent = `Connecté : ${S.consultants.find(c => c.id === val)?.name || ''}`;
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
  const preselect = currentProfile?.type === 'manager' ? 'manager'
    : currentProfile?.type === 'commercial' ? 'commercial:' + currentProfile.id
    : currentProfile?.id;
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
  const isManager     = currentProfile?.type === 'manager';
  document.getElementById('cons-count').textContent = S.consultants.length;
  const el = document.getElementById('cons-list');
  el.innerHTML = '';

  // "Ajouter un consultant" : seul le Manager gère le référentiel de consultants (un
  // Commercial n'en a pas besoin, un Consultant encore moins). Idem pour l'entrée "Gérer les
  // commerciaux" du menu "Connecté" (voir openCommerciauxManageModal()).
  document.getElementById('btn-add-consultant').style.display = isManager ? 'flex' : 'none';
  document.getElementById('btn-manage-commerciaux').style.display = isManager ? '' : 'none';

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

// ─── COMMERCIAUX — POPUP DE GESTION (menu "Connecté", Manager uniquement) ──────────────────
// Aide à la présentation de l'outil (configurer rapidement qui sont les commerciaux et leur
// portefeuille), pas une fonction finale de l'interface — voir le commentaire dans index.html.
function openCommerciauxManageModal() {
  document.getElementById('user-menu').removeAttribute('open');
  renderCommerciauxManageList();
  document.getElementById('commerciaux-manage-overlay').classList.add('open');
  openModalA11y('commerciaux-manage-overlay');
}

function renderCommerciauxManageList() {
  const el = document.getElementById('commerciaux-manage-list');
  el.innerHTML = '';
  if (!S.commerciaux.length) {
    el.innerHTML = `<div style="padding:10px 0;color:var(--text-muted);font-size:var(--text-base)">Aucun commercial pour l'instant.</div>`;
    return;
  }
  S.commerciaux.forEach(co => {
    const item = document.createElement('div');
    item.className = 'consultant-item';
    item.innerHTML = `
      <div class="avatar" style="background:var(--surface2);color:var(--text-dim)">${initials(co.name)}</div>
      <div class="consultant-name">${co.name}<small>${(co.clients||[]).join(', ')}</small></div>
      <button class="btn-icon" onclick="editCommercialFromManageList('${co.id}')" title="Modifier" aria-label="Modifier ${co.name}">
        <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
      </button>`;
    el.appendChild(item);
  });
}

// La modale d'édition (COMMERCIAL MODAL) s'ouvre par-dessus celle-ci, qui se referme pour
// éviter 2 modales "open" en même temps (ambiguïté sinon sur la touche Échap, voir le
// gestionnaire global de keydown) — elle se réouvre au retour (cancelCommercialModal(),
// saveCommercial(), deleteCommercial()).
function editCommercialFromManageList(id) {
  closeModal('commerciaux-manage-overlay');
  openCommercialModal(id);
}

// ─── COMMERCIAL MODAL (ajout/édition d'un seul commercial) ─────────────────────
function openCommercialModal(id) {
  clearFieldErrors(['co-name']);
  document.getElementById('commercial-overlay').classList.add('open');
  if (id) {
    const co = S.commerciaux.find(x => x.id === id);
    document.getElementById('commercial-modal-title').textContent = 'Modifier le commercial';
    document.getElementById('btn-del-commercial').style.display = 'block';
    document.getElementById('co-id').value      = co.id;
    document.getElementById('co-name').value    = co.name;
    document.getElementById('co-clients').value = (co.clients || []).join(', ');
  } else {
    document.getElementById('commercial-modal-title').textContent = 'Nouveau commercial';
    document.getElementById('btn-del-commercial').style.display = 'none';
    document.getElementById('co-id').value = document.getElementById('co-name').value =
      document.getElementById('co-clients').value = '';
  }
  openModalA11y('commercial-overlay');
}

// Toujours revenir au popup de gestion en quittant cette modale (×, Annuler, Échap, clic en
// dehors — voir MODAL_CANCEL) : elle n'est jamais ouverte autrement que depuis ce popup.
function cancelCommercialModal() {
  closeModal('commercial-overlay');
  openCommerciauxManageModal();
}

function saveCommercial() {
  const id      = document.getElementById('co-id').value;
  const name    = document.getElementById('co-name').value.trim();
  const clients = document.getElementById('co-clients').value.split(',').map(s => s.trim()).filter(Boolean);
  clearFieldErrors(['co-name']);
  if (!name) {
    markFieldInvalid('co-name', 'Ce champ est obligatoire.');
    showToast('Merci de compléter les champs obligatoires en surbrillance', 'error');
    document.getElementById('co-name').focus();
    return;
  }
  if (id) {
    const i = S.commerciaux.findIndex(c => c.id === id);
    if (i >= 0) S.commerciaux[i] = { ...S.commerciaux[i], name, clients: clients.length ? clients : undefined };
  } else {
    S.commerciaux.push({ id: genId(), name, ...(clients.length ? { clients } : {}) });
  }
  save(); closeModal('commercial-overlay'); render();
  openCommerciauxManageModal();
  showToast('Commercial enregistré', 'success');
}

function deleteCommercial() {
  const id = document.getElementById('co-id').value;
  if (!id) return;
  const nb = S.opportunites.filter(o => o.commercialId === id).length
    + S.prestations.filter(p => p.commercialId === id).length;
  const msg = nb > 0
    ? `Ce commercial est attaché à ${nb} opportunité(s)/prestation(s). Supprimer quand même ?`
    : 'Supprimer ce commercial ?';
  if (!confirm(msg)) return;
  S.commerciaux = S.commerciaux.filter(c => c.id !== id);
  if (filterCommercial === id) filterCommercial = null;
  save(); closeModal('commercial-overlay'); render();
  openCommerciauxManageModal();
  showToast('Commercial supprimé');
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
  // largeur du wrapper au total réel (colonne des noms + 36 mois) règle les deux à la source —
  // mais seulement quand ce total dépasse l'écran : sinon la largeur en pixels écraserait
  // min-width:100% et empêcherait l'en-tête de remplir tout le conteneur sur un grand écran.
  const wrapperEl = document.getElementById('gantt-wrapper');
  const labelColWidth = document.getElementById('gantt-label-col').offsetWidth;
  const colW = ganttColWidth();
  const contentWidth = labelColWidth + colW * GANTT_MONTHS;
  const availableWidth = document.getElementById('gantt-scroll').clientWidth;
  wrapperEl.style.width = contentWidth > availableWidth ? contentWidth + 'px' : '';
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
          ? () => openSuiviDemande(null, S.opportunites.find(o => o.id === p.oppId))
          : () => openSuiviDemande(S.prestations.find(x => x.id === pId), null);
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
    const commercial = activeCommercial();
    const opps = filterCons
      ? S.opportunites.filter(o => S.candidatures.some(c => c.opportuniteId===o.id && c.consultantId===filterCons))
      : S.opportunites;
    const clients = [...new Set([
      ...opps.map(o => o.client),
      ...S.prestations.filter(p => !filterCons || p.consultantId === filterCons).map(p => p.client),
    ])]
      .filter(client => !commercial || commercialOwnsClient(commercial, client))
      .sort((a,b) => a.localeCompare(b));

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
// forme, pour tenir dans UNE seule chronologie (Statut/Type/Client/Dates/TJM/Occupation) —
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

  // Colonne "Restant" = jours restants jusqu'à la fin effective, avec le même code couleur que
  // l'ancienne alerte dédiée (fusionnées en une seule colonne) : rouge sous 30 jours, orange
  // entre 31 et 90 jours, neutre au-delà ou si déjà terminée. Même seuil que le widget
  // "Événements à venir" des Statistiques (buildEventsDiv()).
  const daysToEnd = Math.round((new Date(effectiveEnd(p)+'T00:00:00') - new Date(todayStr()+'T00:00:00')) / 86400000);
  let restantColor = '';
  if (status === 'en_cours' && daysToEnd >= 0 && daysToEnd <= 90) {
    restantColor = daysToEnd <= 30 ? 'var(--red)' : 'var(--orange)';
  }
  const restantLine = daysToEnd >= 0
    ? `<span${restantColor ? ` style="color:${restantColor};font-weight:600"` : ''} title="Fin de mission le ${fmtD(effectiveEnd(p))}">${daysToEnd} j</span>`
    : '—';

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
    restantLine,
    valueLine: `${tjmCur.toLocaleString('fr-FR')} €/j${hasRevision?`<small>base: ${p.tjm.toLocaleString('fr-FR')} €</small>`:''}`,
    activiteLine: `${(p.fte||5)}/5`,
    onClick: `openSuiviDemande(S.prestations.find(x=>x.id==='${p.id}'), null)`,
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
    restantLine: '—', valueLine: '—', activiteLine: '—',
    onClick: `openSuiviDemande(null, S.opportunites.find(x=>x.id==='${opp.id}'))`,
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
    restantLine: '—', valueLine: '—', activiteLine: '—',
    onClick: `openSuiviDemande(null, S.opportunites.find(x=>x.id==='${opp.id}'))`,
  };
}

// whoHeader : libellé de la colonne "qui" — "Consultant" en Vue Clients (la carte regroupe déjà
// par client), "Client / Service" en Vue Consultants (la carte regroupe déjà par consultant).
function buildUnifiedTableHtml(items, whoHeader) {
  if (!items.length) return '';
  const header = `<div class="prest-header-row"><span>Statut</span><span>Type</span><span>Profil</span><span>${whoHeader}</span><span>Dates</span><span style="text-align:center">Restant</span><span style="text-align:right">TJM</span><span style="text-align:right">Occupation</span><span></span></div>`;
  const rows = items.slice().sort((a,b) => b.sortDate.localeCompare(a.sortDate)).map(it => `
    <div class="prest-row">
      <span class="status-pill ${it.statusClass}">${it.statusLabel}</span>
      <div class="prest-type">
        <span class="prest-type-label ${it.typeClass}">${it.typeLabel}</span>
        ${it.originLine||''}
      </div>
      <div class="prest-profil${it.profilLine?'':' prest-profil-empty'}">${it.profilLine||'<span style="color:var(--text-muted)">—</span>'}</div>
      <div class="prest-client">${it.clientLine}<small>${it.subLine||''}</small></div>
      <div class="prest-dates">${it.dateLine}</div>
      <div class="prest-restant">${it.restantLine}</div>
      <div class="prest-tjm">${it.valueLine}</div>
      <div class="prest-activite">${it.activiteLine}</div>
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

  const commercial = activeCommercial();
  const opps = filterCons
    ? S.opportunites.filter(o => S.candidatures.some(c => c.opportuniteId===o.id && c.consultantId===filterCons))
    : S.opportunites;
  const clients = [...new Set([
    ...opps.map(o => o.client),
    ...S.prestations
      .filter(p => !filterCons || p.consultantId === filterCons)
      .map(p => p.client),
  ])]
    .filter(client => !commercial || commercialOwnsClient(commercial, client))
    .sort((a,b) => a.localeCompare(b));

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
    caStatusPill = kd.occRate >= 80 ? statusPill('Occupation soutenue', 'var(--green)', 'var(--green-soft)')
      : kd.occRate >= 50 ? statusPill('Occupation modérée', 'var(--yellow)', 'var(--yellow-soft)')
      : statusPill('Occupation faible', 'var(--red)', 'var(--red-soft)');
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
    <h3 class="section-title" style="margin-top:0">
      Occupation · ${kpiLabel} · base ${kpiWorkDays} j/trimestre
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
    <div style="display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:10px;margin-top:32px;margin-bottom:10px">
      <h3 class="section-title" style="margin-top:0">
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
    const natures   = [...new Set(cl.missions.map(p=>`<span class="prest-type-label nature-${p.nature||'mission'}">${natureLabel(p.nature)}</span>`))].join(' · ');
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
    evHtml += '<div class="event-row" style="cursor:pointer" onclick="openSuiviDemande(null, S.opportunites.find(x=>x.id===\'' + o.id + '\'))">'
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

  // Commercial connecté : les Statistiques (CA, marge, pipeline) ne reflètent alors que son
  // portefeuille client (commercialOwnsClient()), même logique que la restriction par
  // consultant déjà appliquée ci-dessous via `cons`.
  const commercial = activeCommercial();

  function activeIn(pStart, pEnd, statusFilter) {
    return S.prestations.filter(p =>
      cons.find(c=>c.id===p.consultantId) &&
      (!commercial || commercialOwnsClient(commercial, p.client)) &&
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
      (!commercial || commercialOwnsClient(commercial, o.client)) &&
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
    // TJM moyen : seulement les missions (régie) — un forfait n'a pas de TJM réel une fois son
    // prix fixé une fois pour toute la prestation, un projet interne n'en a jamais eu de pertinent.
    const tjmMissions = missions.filter(p => (p.nature||'mission') === 'mission');
    const avgTjm     = tjmMissions.length ? Math.round(tjmMissions.reduce((s,p)=>s+currentTjm(p),0)/tjmMissions.length) : null;
    // CA : sensible à la nature. Mission → réduit par les pauses/absences réelles sur la période.
    // Forfait → prix fixé à l'avance, jamais réduit, proratisé sur la durée totale de
    // l'engagement. Projet interne → 0, ce n'est pas une vente mais un investissement.
    const ca = missions.reduce((s,p) => {
      const nature = p.nature || 'mission';
      if (nature === 'projet_interne') return s;
      if (nature === 'forfait') {
        const totalWD = workingDays(new Date(p.startDate+'T00:00:00'), new Date(effectiveEnd(p)+'T00:00:00'));
        return totalWD > 0 ? s + (p.prixForfait||0) * (wDays/totalWD) : s;
      }
      const consultant = cons.find(c => c.id === p.consultantId);
      const frac = unavailableFraction(p, consultant, pStart, pEnd);
      return s + currentTjm(p) * wDays * (1-frac) * (p.fte||5)/5;
    }, 0);
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
  detailHeader.textContent = 'Détail par période';
  scroll.appendChild(detailHeader);

  const toolbar = document.createElement('div');
  toolbar.className = 'stats-toolbar';
  toolbar.style.cssText = 'border-bottom:none;padding:0 0 14px 0;background:none';
  toolbar.innerHTML = `
    <span class="form-label" style="margin-bottom:0">Échelle :</span>
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

// Variante à 2 séries de buildLineChart() ci-dessus — pour comparer une valeur "prévisionnelle"
// (pointillée) à une valeur "réelle" (pleine) dans le temps. Utilisée par la vue groupée de
// "Suivre la demande" (CA, staffing) : zéro dépendance externe, contrairement à
// buildMultiLineChart() qui dépend de l'état de la page Statistiques (hiddenChartSeries,
// renderStats()) et n'est donc pas réutilisable hors de cette page.
function buildTwoLineChart(container, periods, seriesA, seriesB, opts = {}) {
  const W = 760, H = 150;
  const PAD = { top: 14, right: 14, bottom: 30, left: 48 };
  const cW  = W - PAD.left - PAD.right;
  const cH  = H - PAD.top  - PAD.bottom;

  const allValues = [...seriesA.values, ...seriesB.values].filter(v => v !== null && v !== undefined);
  if (!allValues.length) {
    container.innerHTML = `<div style="padding:20px;text-align:center;color:var(--text-muted);font-size:var(--text-base)">Aucune donnée sur cette période</div>`;
    return;
  }

  const rawMin = opts.yMin ?? Math.min(0, ...allValues);
  const rawMax = opts.yMax ?? Math.max(...allValues);
  const pad = (rawMax - rawMin) * 0.15 || rawMax * 0.1 || 10;
  const yMin = Math.max(opts.yMin ?? -Infinity, rawMin - pad);
  const yMax = opts.yMax ?? rawMax + pad;
  // decimals>0 pour une série non-entière (ex: staffing réel en équivalents temps plein, voir
  // renderSuiviDemandeGroupCharts()) — 0 par défaut (euros, décomptes entiers).
  const decimals = opts.decimals ?? 0;
  const fmtVal = v => decimals > 0 ? v.toFixed(decimals) : Math.round(v).toLocaleString('fr-FR');

  function xPx(i) { return PAD.left + (periods.length > 1 ? i / (periods.length - 1) : 0.5) * cW; }
  function yPx(v) { return PAD.top + cH * (1 - (v - yMin) / (yMax - yMin)); }

  let grid = '', xlabels = '';
  const nT = 4;
  for (let t = 0; t <= nT; t++) {
    const v = yMin + (yMax - yMin) * t / nT;
    const y = yPx(v).toFixed(1);
    grid += `<line x1="${PAD.left}" x2="${W-PAD.right}" y1="${y}" y2="${y}" stroke="var(--border)" stroke-width="0.8"/>
      <text x="${PAD.left-5}" y="${y}" text-anchor="end" dominant-baseline="middle" font-size="9" fill="var(--text-muted)">${fmtVal(v)}</text>`;
  }
  periods.forEach((pd, i) => {
    const x = xPx(i).toFixed(1);
    const label = periods.length <= 12 ? pd.short : (i % Math.ceil(periods.length / 8) === 0 ? pd.short : '');
    if (label) xlabels += `<text x="${x}" y="${H-5}" text-anchor="middle" font-size="9" fill="var(--text-muted)">${label}</text>`;
  });

  function buildLine(series) {
    let pathSegs = [], dots = '', prevI = null;
    periods.forEach((pd, i) => {
      const v = series.values[i];
      const x = xPx(i).toFixed(1);
      if (v === null || v === undefined) { prevI = null; return; }
      const y = yPx(v).toFixed(1);
      pathSegs.push(prevI === null ? `M ${x} ${y}` : `L ${x} ${y}`);
      dots += `<circle cx="${x}" cy="${y}" r="2.5" fill="${series.color}" stroke="var(--surface)" stroke-width="1"><title>${series.label} — ${pd.label}: ${fmtVal(v)}${opts.unit ? ' '+opts.unit : ''}</title></circle>`;
      prevI = i;
    });
    const dash = series.dash ? ` stroke-dasharray="${series.dash}"` : '';
    return `<path d="${pathSegs.join(' ')}" fill="none" stroke="${series.color}" stroke-width="2" stroke-linejoin="round"${dash}/>${dots}`;
  }

  const legend = `<div style="display:flex;gap:16px;font-size:var(--text-xs);margin-bottom:6px">
      <span style="color:${seriesA.color}">● ${seriesA.label}</span>
      <span style="color:${seriesB.color}">● ${seriesB.label}</span>
    </div>`;

  container.innerHTML = `${legend}
    <svg viewBox="0 0 ${W} ${H}" style="width:100%;height:${H}px;display:block;overflow:visible">
      ${grid}
      <line x1="${PAD.left}" x2="${PAD.left}" y1="${PAD.top}" y2="${H-PAD.bottom}" stroke="var(--border)" stroke-width="1"/>
      ${buildLine(seriesA)}
      ${buildLine(seriesB)}
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
  clearFieldErrors(['f-client', 'f-start', 'f-end', 'f-tjm', 'f-prix-forfait', 'f-cons', 'f-nature']);
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
    document.getElementById('f-prix-forfait').value = p.prixForfait || '';
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
    document.getElementById('f-nature').value   = 'mission';
    document.getElementById('f-titre').value    = '';
    document.getElementById('f-client').value   = '';
    document.getElementById('f-service').value  = '';
    document.getElementById('f-start').value    = '';
    document.getElementById('f-end').value      = '';
    document.getElementById('f-tjm').value      = '';
    document.getElementById('f-prix-forfait').value = '';
    document.getElementById('f-fte').value      = '5';
    document.getElementById('f-uo').value       = '';
    document.getElementById('f-commercial').value = '';
    document.getElementById('f-notes').value    = '';
    modalMissionEvents = [];
    modalRevisions = [];
    document.getElementById('f-opportunite-id').value = '';
    if (forceConsId) sel.value = forceConsId;
    else if (filterCons) sel.value = filterCons;
    prefillTjmFromConsultant();
  }
  if (p) document.getElementById('f-commercial').value = p.commercialId || '';

  // p sans opportuniteId : rien à dire tant qu'on ne sait pas si l'utilisateur va en attacher une
  // (cas d'une prestation en cours de création qui n'est pas issue d'une candidature gagnée).
  // p existant (avec ou sans opportuniteId) : une prestation existante ne s'édite plus que via
  // "Suivre la demande" (openSuiviDemande()) — jamais en modale de création directe. Le bandeau
  // "Issue d'une opportunité" y serait redondant avec le bloc Opportunité affiché juste en
  // dessous, et "Créée directement, sans opportunité au préalable" est désormais affiché dans la
  // sous-info de la carte KPI "Profils engagés" (renderSuiviDemandeKpis()) — les deux cas sont
  // donc masqués ici. showOriginBannerLinked() reste utilisée ailleurs
  // (markCandidatureWonInModal(), juste après avoir gagné une candidature), dans le flux de
  // création où l'Opportunité n'est pas visible.
  hideOriginBanner();

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

// TJM initial/Taux d'occupation et Modification de la mission ne sont des champs de "définition"
// qu'à la création directe d'une prestation (pas issue d'une opportunité) : dès que la prestation
// existe déjà (édition) ou qu'elle vient d'une candidature gagnée, ils passent en lecture seule —
// tout changement passe alors par les tables de tarification/modification ci-dessous. Les 2
// paires de blocs sont mutuellement exclusives : champs de définition (création) d'un côté,
// table en lecture seule + bouton "Modifier" de l'autre — jamais les deux en même temps.
// Axe indépendant, ajouté ensuite : la nature choisie (mission/forfait/projet_interne) décide
// QUEL champ de prix afficher (TJM vs prix forfaitaire vs aucun), et si l'historique de
// révisions a un sens — seule une mission est révisable dans le temps ; un forfait a un prix
// fixé une fois pour toute la prestation, un projet interne n'a pas de prix du tout.
function updateLockedSections() {
  const nature    = document.getElementById('f-nature').value || 'mission';
  const isForfait = nature === 'forfait';
  const isInterne = nature === 'projet_interne';
  const existing  = !!document.getElementById('f-id').value;
  const fromOpp   = !!document.getElementById('f-opportunite-id').value;
  // La mission (prolongation/pause/sortie anticipée) s'applique quelle que soit la nature —
  // un forfait comme un projet interne peuvent aussi être prolongés ou arrêtés plus tôt.
  const missionLocked = existing || fromOpp;
  document.getElementById('mission-history-block').style.display = missionLocked ? '' : 'none';

  document.getElementById('tjm-field-wrap').style.display          = (isForfait || isInterne) ? 'none' : '';
  document.getElementById('prix-forfait-field-wrap').style.display = isForfait ? '' : 'none';

  if (isForfait || isInterne) {
    document.getElementById('tjm-fte-row').style.display         = '';
    document.getElementById('tarif-history-block').style.display = 'none';
    document.getElementById('f-tjm').disabled          = true;
    document.getElementById('f-prix-forfait').disabled = isInterne;
    return;
  }

  // Cas particulier : une prestation issue d'une candidature gagnée n'a pas forcément hérité
  // d'un TJM (champ optionnel côté Opportunité). Verrouiller quand même le TJM/Taux d'occupation
  // rendrait ce champ obligatoire invisible, donc impossible à corriger (bug constaté en test).
  // Le verrouillage tarification ne s'applique donc que s'il y a effectivement une valeur reprise.
  const hasBaseTjm  = !!document.getElementById('f-tjm').value;
  const tarifLocked = existing || (fromOpp && hasBaseTjm);

  document.getElementById('f-tjm').disabled = tarifLocked;
  document.getElementById('f-fte').disabled = tarifLocked;
  document.getElementById('tjm-fte-row').style.display          = tarifLocked ? 'none' : '';
  document.getElementById('tarif-history-block').style.display   = tarifLocked ? '' : 'none';
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
  returnToSuiviDemande();
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
    // Une pause est un réglage d'entité (voir "Réglages de la prestation") : affichée ici pour
    // le contexte, mais pas supprimable depuis la modale Prestation individuelle.
    const delBtn = e.type === 'pause' ? '' :
      `<button class="btn-icon" onclick="removeMissionEvent('${e.id}')" title="Supprimer" aria-label="Supprimer cette modification" style="width:22px;height:22px;font-size:var(--text-sm)">×</button>`;
    tbody.innerHTML += `
      <tr>
        <td>${MISSION_EVENT_LABELS[e.type] || e.type}</td>
        <td>${fmtD(e.date)}</td>
        <td>${e.resumeDate ? fmtD(e.resumeDate) : '—'}</td>
        <td>${delBtn}</td>
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

  // Le résumé (dates, TJM actuel, taux d'occupation, marge, dernière modification) ne s'affiche
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
  // TJM/taux d'occupation "en cours" : dernière révision connue, sinon la valeur de départ — même
  // valeur que la 1re/dernière ligne de la table de tarification (renderRevisions()).
  const curTjm = tjmRevs.length ? tjmRevs[tjmRevs.length - 1].tjm : baseTjm;
  const curFte = fteRevs.length ? fteRevs[fteRevs.length - 1].fte : baseFte;

  // Taux de marge hebdo = (TJM − coût complet du consultant) / TJM, sur le TJM en cours (pas la
  // valeur de départ). Le taux d'occupation (jours/semaine) n'entre pas dans le calcul : il
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
    locked && curFte ? `Taux d'occupation actuel : ${curFte}/5` : '';

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

  refreshSuiviDemandeIfOpen();
}

// Une révision porte un TJM et/ou un taux d'occupation (au moins un des deux) + une date. Si une
// entrée existe déjà à cette date, on la complète plutôt que de l'écraser (ex: TJM ajouté un
// jour, taux d'occupation ajouté le même jour plus tard — les deux doivent survivre ensemble).
function addRevision() {
  const date   = document.getElementById('rev-date').value;
  const tjmVal = document.getElementById('rev-tjm').value;
  const fteVal = document.getElementById('rev-fte').value;
  const tjm = tjmVal ? parseFloat(tjmVal) : undefined;
  const fte = fteVal ? parseInt(fteVal)   : undefined;
  if (!date) { showToast('Saisissez une date de mise en place', 'error'); return; }
  if (tjm === undefined && fte === undefined) { showToast('Saisissez un TJM ou un taux d\'occupation', 'error'); return; }
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
// pas seulement ce qui a changé ce jour-là : une ligne "taux d'occupation seul" reprend quand même
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

// Écrit l'état courant du formulaire (+ révisions, événements de mission) dans S, sans fermer
// la modale. Retourne l'id de la prestation, ou null si la validation échoue. Symétrique à
// commitOpportuniteFromForm().
function commitPrestationFromForm() {
  const id           = document.getElementById('f-id').value;
  const consultantId = document.getElementById('f-cons').value;
  const client       = document.getElementById('f-client').value.trim();
  const clientService= document.getElementById('f-service').value.trim();
  const startDate    = document.getElementById('f-start').value;
  const endDate      = document.getElementById('f-end').value;
  const tjm          = parseFloat(document.getElementById('f-tjm').value) || 0;
  const prixForfait  = parseFloat(document.getElementById('f-prix-forfait').value) || 0;
  const fte          = parseInt(document.getElementById('f-fte').value) || 5;
  const limiteUOAn   = parseInt(document.getElementById('f-uo').value) || undefined;
  const nature       = document.getElementById('f-nature').value;
  const titre        = document.getElementById('f-titre').value.trim();
  const notes        = document.getElementById('f-notes').value.trim();
  const commercialId = document.getElementById('f-commercial').value || undefined;

  clearFieldErrors(['f-client', 'f-start', 'f-end', 'f-tjm', 'f-prix-forfait', 'f-cons', 'f-nature']);
  const missing = [];
  if (!client) missing.push('f-client');
  if (!startDate) missing.push('f-start');
  if (!endDate) missing.push('f-end');
  // Le prix dépend de la nature : TJM pour une mission, prix forfaitaire pour un forfait,
  // aucun des deux pour un projet interne (pas de prix).
  if (nature === 'mission' && !tjm) missing.push('f-tjm');
  if (nature === 'forfait' && !prixForfait) missing.push('f-prix-forfait');
  if (!consultantId) missing.push('f-cons');
  // Optionnelle à l'étape Opportunité (pas toujours connue dès la détection), mais devient
  // obligatoire ici si elle n'a pas déjà été reprise de l'opportunité d'origine.
  if (!nature) missing.push('f-nature');
  if (missing.length) {
    missing.forEach(id => markFieldInvalid(id, 'Ce champ est obligatoire.'));
    showToast('Merci de compléter les champs obligatoires en surbrillance', 'error');
    document.getElementById(missing[0]).focus();
    return null;
  }
  if (endDate < startDate) { markFieldInvalid('f-end', 'La date de fin doit être après la date de début.'); showToast('La date de fin doit être après la date de début', 'error'); document.getElementById('f-end').focus(); return null; }

  const opportuniteId = document.getElementById('f-opportunite-id').value || undefined;

  const prest = {
    id: id || genId(),
    consultantId, client, clientService, startDate, endDate,
    missionEvents: modalMissionEvents,
    tjm, fte, limiteUOAn, nature, titre, tjmRevisions: modalRevisions,
    prixForfait: nature === 'forfait' ? prixForfait : undefined,
    notes, opportuniteId, commercialId,
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
      recomputeOpportuniteStatus(cand.opportuniteId);
    }
    modalWonCandidatureId = null;
  }

  save();
  return prest.id;
}

function savePrestation() {
  const id = commitPrestationFromForm();
  if (id === null) return false;
  closeModal('prest-overlay');
  render();
  returnToSuiviDemande();
  showToast('Prestation enregistrée', 'success');
  return true;
}

function showOriginBannerLinked() {
  const b = document.getElementById('prest-origin-banner');
  b.className = 'modal-info-banner';
  b.style.display = '';
  b.innerHTML = `<span>Issue d'une opportunité</span>`;
}
function hideOriginBanner() {
  document.getElementById('prest-origin-banner').style.display = 'none';
}

// Recalcule le statut d'une opportunité à partir de la composition réelle de ses candidatures
// (règle documentée dans BACKLOG.md : granularité simplifiée à 3 valeurs) — partagé entre
// commitOpportuniteFromForm() et toute mutation directe de S.candidatures (ex: deletePrestation()
// qui détache une candidature gagnée). Sans aucune candidature, ne touche pas au statut : c'est
// alors le champ Statut du formulaire qui fait foi.
function recomputeOpportuniteStatus(oppId) {
  const opp = S.opportunites.find(o => o.id === oppId);
  if (!opp) return;
  const cands = S.candidatures.filter(c => c.opportuniteId === oppId);
  if (!cands.length) return;
  if (cands.some(c => c.status === 'gagnee')) opp.status = 'pourvu';
  else if (cands.every(c => c.status === 'perdue')) opp.status = 'abandonne';
  else opp.status = 'ouvert';
}

function deletePrestation() {
  const id = document.getElementById('f-id').value;
  if (!id) return;
  // Une prestation supprimée peut être celle d'une candidature gagnée : sans ce détachement,
  // la candidature restait "gagnée" avec un prestationId pointant vers une prestation qui
  // n'existe plus (bug latent constaté en explorant ce code).
  const linkedCand = S.candidatures.find(c => c.prestationId === id);
  const msg = 'Supprimer définitivement cette prestation ? Cette action est irréversible et ne peut pas être annulée.'
    + (linkedCand ? ' La candidature gagnée associée à cette mission repassera "en attente".' : '');
  if (!confirm(msg)) return;
  if (linkedCand) {
    linkedCand.status = 'en_attente';
    delete linkedCand.prestationId;
    recomputeOpportuniteStatus(linkedCand.opportuniteId);
  }
  S.prestations = S.prestations.filter(p => p.id !== id);
  save();
  closeSuiviDemande();
  render();
  returnToSuiviDemande();
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
    modalAbsences = c.absences ? c.absences.map(a => ({...a})) : [];
  } else {
    document.getElementById('cons-modal-title').textContent = 'Nouveau consultant';
    document.getElementById('btn-del-cons').style.display = 'none';
    document.getElementById('cf-id').value = document.getElementById('cf-name').value =
      document.getElementById('cf-role').value = document.getElementById('cf-email').value = '';
    document.getElementById('cf-date-entree').value = document.getElementById('cf-date-sortie').value = '';
    document.getElementById('cf-cout-complet').value = '';
    modalCostRevisions = [];
    modalAbsences = [];
  }
  document.getElementById('abs-period').value = '';
  document.getElementById('abs-start').value  = '';
  document.getElementById('abs-end').value    = '';
  updateAbsPeriodUI();
  renderCostRevisions();
  renderAbsences();
  updateTcDisplay();
  openModalA11y('cons-overlay');
}

// Une demi-journée n'a de sens que pour une seule date : le champ "Au" est masqué dans ce cas
// (la date de fin est forcée égale à la date de début dans addAbsence()).
function updateAbsPeriodUI() {
  document.getElementById('abs-end-wrap').style.display =
    document.getElementById('abs-period').value ? 'none' : '';
}

function addAbsence() {
  const period = document.getElementById('abs-period').value; // '' | 'matin' | 'apres-midi'
  const start  = document.getElementById('abs-start').value;
  const endRaw = document.getElementById('abs-end').value;
  if (!start) { showToast('Saisissez une date', 'error'); return; }
  const end = period ? start : (endRaw || start);
  if (end < start) { showToast('La date de fin doit être après la date de début', 'error'); return; }
  modalAbsences = modalAbsences.filter(a =>
    !(a.startDate === start && a.endDate === end && (a.period||'') === period));
  modalAbsences.push({ startDate: start, endDate: end, ...(period ? { period } : {}) });
  modalAbsences.sort((a,b) => a.startDate.localeCompare(b.startDate));
  document.getElementById('abs-period').value = '';
  document.getElementById('abs-start').value  = '';
  document.getElementById('abs-end').value    = '';
  updateAbsPeriodUI();
  renderAbsences();
}

function removeAbsence(startDate, endDate, period) {
  if (!confirm('Supprimer cette absence ?')) return;
  modalAbsences = modalAbsences.filter(a =>
    !(a.startDate === startDate && a.endDate === endDate && (a.period||'') === period));
  renderAbsences();
}

const ABSENCE_PERIOD_LABELS = { matin: 'Matin', 'apres-midi': 'Après-midi' };
function renderAbsences() {
  const el = document.getElementById('absence-list');
  el.innerHTML = '';
  if (!modalAbsences.length) {
    el.innerHTML = `<div style="font-size:var(--text-sm);color:var(--text-muted);padding:6px 0 10px">Aucune absence saisie.</div>`;
    return;
  }
  modalAbsences.forEach(a => {
    const label = a.period
      ? `${fmtD(a.startDate)} · ${ABSENCE_PERIOD_LABELS[a.period]}`
      : (a.startDate === a.endDate ? fmtD(a.startDate) : `${fmtD(a.startDate)} → ${fmtD(a.endDate)}`);
    el.innerHTML += `
      <div class="revision-item">
        <span class="revision-date">${label}</span>
        <button class="btn-icon" onclick="removeAbsence('${a.startDate}','${a.endDate}','${a.period||''}')" title="Supprimer" aria-label="Supprimer cette absence" style="width:22px;height:22px;font-size:var(--text-sm)">×</button>
      </div>`;
  });
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
    if (i>=0) S.consultants[i] = {...S.consultants[i], name, role, email, dateEntree, dateSortie: dateSortie || undefined, coutComplet: coutComplet || undefined, coutCompletRevisions: modalCostRevisions.length ? modalCostRevisions : undefined, absences: modalAbsences.length ? modalAbsences : undefined};
  } else {
    S.consultants.push({ id: genId(), name, role, email, dateEntree, ...(dateSortie ? {dateSortie} : {}), ...(coutComplet ? {coutComplet} : {}), ...(modalCostRevisions.length ? {coutCompletRevisions: modalCostRevisions} : {}), ...(modalAbsences.length ? {absences: modalAbsences} : {}) });
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
  populateCommercialSelect('of-commercial', opp ? opp.commercialId : '');
  if (!opp) autoSuggestCommercial('of-client', 'of-commercial');
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
  const commercialId  = document.getElementById('of-commercial').value || undefined;

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

  const opp = { id: oppId, client, clientService, titre, startDate, endDate, nature, tjm, fte, limiteUOAn, createdAt, status, commercialId };
  if (id) {
    const i = S.opportunites.findIndex(o => o.id === id);
    if (i >= 0) S.opportunites[i] = opp;
  } else {
    S.opportunites.push(opp);
  }

  S.candidatures = S.candidatures.filter(c => c.opportuniteId !== oppId)
    .concat(kept.map(c => ({ ...c, opportuniteId: oppId })));

  // Dès qu'il y a au moins une candidature, le statut de l'opportunité se déduit de leur
  // composition plutôt que de se déclarer à la main (simplification volontaire — la nuance
  // "perdue par le consultant" vs "perdue par le client" est mise de côté pour l'instant, voir
  // BACKLOG.md) : une candidature gagnée suffit à la rendre gagnée ; toutes perdues la rendent
  // perdue ; dès qu'une candidature active (en attente) existe à nouveau, elle redevient
  // ouverte automatiquement — pas besoin de repasser le statut à la main après un nouvel ajout.
  // Sans aucune candidature, le champ Statut du formulaire (déjà écrit ci-dessus) reste la seule
  // source (ex : une opportunité abandonnée avant même qu'un candidat n'ait été proposé).
  recomputeOpportuniteStatus(oppId);

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
  const msg = 'Supprimer définitivement cette opportunité ? Cette action est irréversible et ne peut pas être annulée.'
    + (nb > 0 ? ` Ses ${nb} candidature(s) associée(s) seront supprimées avec elle.` : '');
  if (!confirm(msg)) return;
  S.candidatures = S.candidatures.filter(c=>c.opportuniteId!==id);
  S.opportunites = S.opportunites.filter(o=>o.id!==id);
  save(); closeSuiviDemande(); render();
  showToast('Opportunité supprimée');
}

// ─── CANDIDATURES — édition imbriquée dans la modale Opportunité ─────────────
function renderOpportuniteCandidatures() {
  const el = document.getElementById('opp-candidatures-list');
  if (!modalCandidatures.length) {
    el.innerHTML = `<div style="font-size:var(--text-sm);color:var(--text-muted);padding:6px 0 10px">Aucun candidat pour l'instant.</div>`;
    refreshSuiviDemandeIfOpen();
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

    // Résumé lecture seule uniquement : le bloc Prestation complet est déjà affiché juste
    // au-dessus dans "Suivre la demande" dès que l'opportunité est gagnée, pas besoin d'un
    // 2e accès pour le modifier ici.
    const missionBlock = (cand.status==='gagnee' && cand.prestationId && S.prestations.find(p=>p.id===cand.prestationId))
      ? (() => { const p = S.prestations.find(x=>x.id===cand.prestationId); const pStatus = prestationStatus(p); return `
        <div style="display:flex;align-items:center;gap:8px;padding:8px 0;font-size:var(--text-sm);color:var(--text-dim)">
          <span class="status-pill pill-${pStatus}">${statusLabel(pStatus)}</span>
          <span>${fmtD(p.startDate)} → ${fmtD(p.endDate)} · ${currentTjm(p).toLocaleString('fr-FR')} €/j</span>
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
  refreshSuiviDemandeIfOpen();
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
  // L'opportunité peut être éditée seule (création, pas encore de mission) ou depuis "Suivre
  // la demande" (édition) — dans ce 2e cas c'est cet overlay qu'il faut fermer, pas
  // opportunite-overlay dont la classe .open a déjà été retirée par openSuiviDemande().
  if (document.getElementById('opportunite-modal-box').classList.contains('suivi-demande-embedded')) closeSuiviDemande();
  else closeModal('opportunite-overlay');
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
  if (opp.commercialId) document.getElementById('f-commercial').value = opp.commercialId;
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

// ─── RÉGLAGES DE LA PRESTATION — entité (client+clientService), réglages partagés par tous
// les consultants staffés dessus (voir decisions/vue-prestation-macro-micro/). Toujours ouverte
// depuis "Suivre la demande" (mode groupé) — ferme celle-ci avant, la rouvre après
// (suiviDemandeReturnEntity/returnToSuiviDemande(), mécanique commune à cette modale et à
// l'édition individuelle d'un consultant depuis la liste micro).
let suiviDemandeReturnEntity = null; // {client, clientService} | null
let modalPrestationReglagesPauses = []; // [{id, date, resumeDate?}]

function returnToSuiviDemande() {
  if (!suiviDemandeReturnEntity) return;
  const { client, clientService } = suiviDemandeReturnEntity;
  suiviDemandeReturnEntity = null;
  const ref = prestationsForEntity(client, clientService)[0];
  if (ref) openSuiviDemande(ref, null);
}

function openPrestationReglagesModal(client, clientService) {
  clearFieldErrors(['pr-client']);
  document.getElementById('pr-original-client').value = client;
  document.getElementById('pr-original-client-service').value = clientService || '';
  document.getElementById('pr-client').value = client;
  document.getElementById('pr-client-service').value = clientService || '';
  const siblings = prestationsForEntity(client, clientService);
  const ref = siblings[0] || {};
  document.getElementById('pr-nature').value = ref.nature || 'mission';
  document.getElementById('pr-uo').value = ref.limiteUOAn || '';
  populateCommercialSelect('pr-commercial', ref.commercialId || '');

  // Fusionne les pauses déjà présentes (en théorie identiques sur chaque enregistrement frère,
  // du fait de la propagation) — dédupliquées par date d'effet.
  const seen = new Set();
  modalPrestationReglagesPauses = [];
  siblings.forEach(p => (p.missionEvents || []).filter(e => e.type === 'pause').forEach(e => {
    if (seen.has(e.date)) return;
    seen.add(e.date);
    modalPrestationReglagesPauses.push({ ...e });
  }));
  modalPrestationReglagesPauses.sort((a, b) => a.date.localeCompare(b.date));
  renderPrestationReglagesPauses();

  document.getElementById('prestation-reglages-overlay').classList.add('open');
  openModalA11y('prestation-reglages-overlay');
}

function addPrestationReglagesPause() {
  const date       = document.getElementById('pr-pause-date').value;
  const resumeDate = document.getElementById('pr-pause-resume').value;
  if (!date) { showToast('Saisissez une date d\'effet', 'error'); return; }
  if (resumeDate && resumeDate <= date) {
    showToast('La date de reprise doit être après la date d\'effet', 'error'); return;
  }
  modalPrestationReglagesPauses = modalPrestationReglagesPauses.filter(e => e.date !== date);
  modalPrestationReglagesPauses.push({ id: genId(), date, ...(resumeDate ? { resumeDate } : {}) });
  modalPrestationReglagesPauses.sort((a, b) => a.date.localeCompare(b.date));
  document.getElementById('pr-pause-date').value   = '';
  document.getElementById('pr-pause-resume').value = '';
  renderPrestationReglagesPauses();
}

function removePrestationReglagesPause(id) {
  if (!confirm('Supprimer cette pause ?')) return;
  modalPrestationReglagesPauses = modalPrestationReglagesPauses.filter(e => e.id !== id);
  renderPrestationReglagesPauses();
}

function renderPrestationReglagesPauses() {
  const el = document.getElementById('pr-pause-list');
  el.innerHTML = '';
  if (!modalPrestationReglagesPauses.length) {
    el.innerHTML = `<div style="font-size:var(--text-sm);color:var(--text-muted);padding:6px 0 10px">Aucune pause.</div>`;
    return;
  }
  modalPrestationReglagesPauses.forEach(e => {
    el.innerHTML += `
      <div class="revision-item">
        <span class="revision-date">${fmtD(e.date)}${e.resumeDate ? ` → reprise ${fmtD(e.resumeDate)}` : ' (reprise non connue)'}</span>
        <button class="btn-icon" onclick="removePrestationReglagesPause('${e.id}')" title="Supprimer" aria-label="Supprimer cette pause" style="width:22px;height:22px;font-size:var(--text-sm)">×</button>
      </div>`;
  });
}

function cancelPrestationReglagesModal() {
  closeModal('prestation-reglages-overlay');
  returnToSuiviDemande();
}

function savePrestationReglages() {
  const originalClient        = document.getElementById('pr-original-client').value;
  const originalClientService = document.getElementById('pr-original-client-service').value;
  const client        = document.getElementById('pr-client').value.trim();
  const clientService = document.getElementById('pr-client-service').value.trim();
  const nature        = document.getElementById('pr-nature').value;
  const limiteUOAn    = parseInt(document.getElementById('pr-uo').value) || undefined;
  const commercialId  = document.getElementById('pr-commercial').value || undefined;
  const pauses        = modalPrestationReglagesPauses.map(e => ({ ...e }));

  clearFieldErrors(['pr-client']);
  if (!client) {
    markFieldInvalid('pr-client', 'Ce champ est obligatoire.');
    showToast('Merci de compléter les champs obligatoires en surbrillance', 'error');
    document.getElementById('pr-client').focus();
    return;
  }

  // Renommer déplace TOUTES les prestations de l'ancienne entité vers la nouvelle — recherchées
  // par leurs valeurs d'origine (pr-original-*), pas par les champs qui viennent d'être modifiés.
  prestationsForEntity(originalClient, originalClientService).forEach(p => {
    p.client        = client;
    p.clientService  = clientService || undefined;
    p.nature         = nature;
    p.limiteUOAn     = limiteUOAn;
    p.commercialId   = commercialId;
    const kept = (p.missionEvents || []).filter(e => e.type !== 'pause');
    p.missionEvents = [...kept, ...pauses].sort((a, b) => a.date.localeCompare(b.date));
  });
  save();
  closeModal('prestation-reglages-overlay');
  // Revenir sur la NOUVELLE entité (l'ancienne n'a plus de prestations si elle a été renommée).
  suiviDemandeReturnEntity = { client, clientService };
  returnToSuiviDemande();
  showToast('Réglages de la prestation enregistrés', 'success');
}

// ─── SUIVRE LA DEMANDE — fusion Prestation/Opportunité en overlay plein écran ─────────────
// 2 modes, décidés par openSuiviDemande() selon qu'une prestation existe déjà pour l'entité :
// - Mode GROUPÉ (prest résolu) : refonte macro+micro du 2026-10-12 (voir decisions/
//   vue-prestation-macro-micro/) — toujours en lecture seule à l'affichage, construite depuis
//   S.prestations directement pour TOUTES les prestations de l'entité (client+clientService).
//   Jamais d'embedding de formulaire (impossible pour N consultants à la fois) : "Modifier" sur
//   un consultant ou "Réglages de la prestation" ferment cette vue et ouvrent une modale
//   standalone, qui y revient automatiquement en sortie (returnToSuiviDemande()).
// - Mode LEGACY (prest non résolu, opportunité pas encore gagnée) : comportement d'origine,
//   inchangé — #opportunite-modal-box réparentée dans cet overlay le temps de l'édition.
let suiviDemandeGroupEntity = null; // {client, clientService} | null — entité affichée en mode groupé

function openSuiviDemande(prest, opp) {
  // Capturé avant tout appel à openPrestModal()/openOpportuniteModal() : ces 2 fonctions
  // (et openModalA11y() qu'elles appellent) réécrivent modalTrigger avec le focus interne à
  // leur propre modale, pas avec le vrai déclencheur de "Suivre la demande" — restauré en fin
  // de fonction pour que le focus revienne au bon endroit à la fermeture.
  const trigger = document.activeElement;
  if (prest && !opp && prest.opportuniteId) {
    opp = S.opportunites.find(o => o.id === prest.opportuniteId);
  }
  if (opp && !prest) {
    const wonCand = S.candidatures.find(c =>
      c.opportuniteId === opp.id && c.status === 'gagnee' && c.prestationId);
    // wonCand.prestationId peut pointer vers une prestation supprimée entre-temps (via une
    // ancienne donnée) — find() défensif, dégrade proprement (traité comme non gagnée).
    if (wonCand) prest = S.prestations.find(p => p.id === wonCand.prestationId) || null;
  }

  if (prest) { openSuiviDemandeGroup(prest, trigger); return; }
  openSuiviDemandeLegacy(opp, trigger);
}

// Mode legacy — comportement d'origine, inchangé. Extrait à part (plutôt que resté en ligne
// dans openSuiviDemande()) pour pouvoir être appelé directement sur une opportunité déjà gagnée
// — ex: bouton "Voir l'opportunité d'origine" depuis la liste micro du mode groupé
// (renderSuiviDemandeGroupStaffing()) — sans passer par la résolution opp→prest ci-dessus, qui
// renverrait sinon systématiquement vers le mode groupé pour une opportunité déjà gagnée.
function openSuiviDemandeLegacy(opp, trigger) {
  trigger = trigger || document.activeElement;
  if (opp) openOpportuniteModal(opp);
  document.getElementById('prest-overlay').classList.remove('open');
  document.getElementById('opportunite-overlay').classList.remove('open');

  document.getElementById('sd-entity-header').style.display   = 'none';
  document.getElementById('sd-charts').style.display          = 'none';
  document.getElementById('sd-entity-actions').style.display  = 'none';
  document.getElementById('sd-staffing-section').style.display = 'none';
  document.getElementById('sd-opp-links').innerHTML = '';

  const oppSlot    = document.getElementById('sd-opp-slot');
  const oppSection = document.getElementById('sd-opp-section');
  oppSlot.innerHTML = '';
  if (opp) {
    const box = document.getElementById('opportunite-modal-box');
    box.classList.add('suivi-demande-embedded');
    oppSlot.appendChild(box);
    oppSection.style.display = '';
  } else {
    oppSection.style.display = 'none';
  }

  suiviDemandePrest = null;
  suiviDemandeOpp   = opp || null;
  suiviDemandeGroupEntity = null;
  renderSuiviDemandeKpis(null, suiviDemandeOpp);
  renderSuiviDemandeTimeline(null, suiviDemandeOpp);
  setSuiviDemandeFooterMode('legacy');

  document.getElementById('suivi-demande-overlay').classList.add('open');
  openModalA11y('suivi-demande-overlay');
  modalTrigger = trigger;
}

function setSuiviDemandeFooterMode(mode) {
  const isGroup = mode === 'group';
  document.getElementById('sd-btn-cancel').style.display = isGroup ? 'none' : '';
  document.getElementById('sd-btn-save').style.display   = isGroup ? 'none' : '';
  document.getElementById('sd-btn-close').style.display  = isGroup ? '' : 'none';
}

// ─── Mode groupé ────────────────────────────────────────────────────────────
function openSuiviDemandeGroup(prest, trigger) {
  const prests = prestationsForEntity(prest.client, prest.clientService);
  suiviDemandeGroupEntity = { client: prest.client, clientService: prest.clientService };
  suiviDemandePrest = null;
  suiviDemandeOpp   = null;

  const commercial = S.commerciaux.find(c => c.id === prests[0]?.commercialId);
  document.getElementById('sd-entity-name').textContent = prest.client + (prest.clientService ? ' · ' + prest.clientService : '');
  document.getElementById('sd-entity-commercial').textContent = commercial ? `Commercial : ${commercial.name}` : '';
  document.getElementById('sd-entity-header').style.display   = 'flex';
  document.getElementById('sd-charts').style.display          = '';
  document.getElementById('sd-entity-actions').style.display  = 'flex';
  document.getElementById('sd-staffing-section').style.display = '';
  document.getElementById('sd-opp-section').style.display     = 'none';

  renderSuiviDemandeGroupKpis(prests);
  renderSuiviDemandeGroupCharts(prests);
  renderSuiviDemandeGroupStaffing(prests);
  renderSuiviDemandeGroupTimeline(prests);
  renderSuiviDemandeGroupOppLinks(prests);
  setSuiviDemandeFooterMode('group');

  document.getElementById('suivi-demande-overlay').classList.add('open');
  openModalA11y('suivi-demande-overlay');
  modalTrigger = trigger;
}

function openReglagesFromSuiviDemande() {
  if (!suiviDemandeGroupEntity) return;
  const { client, clientService } = suiviDemandeGroupEntity;
  suiviDemandeReturnEntity = { client, clientService };
  closeModal('suivi-demande-overlay');
  openPrestationReglagesModal(client, clientService);
}

function editConsultantFromSuiviDemande(prestId) {
  const p = S.prestations.find(x => x.id === prestId);
  if (!p) return;
  suiviDemandeReturnEntity = { client: p.client, clientService: p.clientService };
  closeModal('suivi-demande-overlay');
  openPrestModal(p);
}

// "Voir les candidatures" depuis le mode groupé — un seul bouton après la frise chronologique
// (pas un par consultant, voir renderSuiviDemandeGroupOppLinks()), ouvre la section Candidatures
// de l'opportunité (ajout/modification/suppression de tous les candidats en un seul endroit).
// Contrairement à editConsultantFromSuiviDemande() ci-dessus, pas besoin de fermer
// "suivi-demande-overlay" : openSuiviDemandeLegacy() réutilise le même overlay, juste basculé en
// mode legacy. Toujours appelée depuis le mode groupé actuellement affiché (suiviDemandeGroupEntity)
// — suiviDemandeReturnEntity reste posé pour que cancelSuiviDemande()/saveSuiviDemande() y
// reviennent en sortant.
function viewOriginOpportunite(oppId) {
  const opp = S.opportunites.find(o => o.id === oppId);
  if (!opp || !suiviDemandeGroupEntity) return;
  suiviDemandeReturnEntity = suiviDemandeGroupEntity;
  openSuiviDemandeLegacy(opp);
}

// Un bouton par opportunité distincte parmi les prestations de l'entité (dédupliqué) — dans le
// cas courant (1 seule opportunité à l'origine de toute l'entité), ça donne naturellement 1 seul
// bouton. Rien si aucune prestation n'a d'opportuniteId (créées directement).
function renderSuiviDemandeGroupOppLinks(prests) {
  const el = document.getElementById('sd-opp-links');
  const oppIds = [...new Set(prests.map(p => p.opportuniteId).filter(Boolean))];
  el.innerHTML = oppIds.map(id => {
    const opp = S.opportunites.find(o => o.id === id);
    if (!opp) return '';
    return `<button class="btn-primary" onclick="viewOriginOpportunite('${id}')">
      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>
      Voir l'opportunité
    </button>`;
  }).join(' ');
}

// CA "à vie" d'une prestation, plafonné à une date donnée — base commune à caAccumuleADate()
// (plafond = aujourd'hui) et aux points du graphique CA (plafond = fin de chaque mois affiché).
// Nature-aware comme periodData() : mission réduite par pauses/absences, forfait proratisé
// (jamais réduit par une pause/absence, juste étalé dans le temps), projet interne = 0.
function caAtDate(p, asOfDate) {
  const nature = p.nature || 'mission';
  if (nature === 'projet_interne') return 0;
  const start = new Date(p.startDate + 'T00:00:00');
  const realEnd = new Date(effectiveEnd(p) + 'T00:00:00');
  const cap = asOfDate < realEnd ? asOfDate : realEnd;
  if (cap < start) return 0;
  if (nature === 'forfait') {
    const totalWD = workingDays(start, realEnd);
    const elapsedWD = workingDays(start, cap);
    return totalWD > 0 ? (p.prixForfait || 0) * (elapsedWD / totalWD) : 0;
  }
  const wDays = workingDays(start, cap);
  const consultant = S.consultants.find(c => c.id === p.consultantId);
  return currentTjm(p) * wDays * (1 - unavailableFraction(p, consultant, start, cap)) * (p.fte||5)/5;
}
function caAccumuleADate(p) {
  return caAtDate(p, new Date(todayStr() + 'T00:00:00'));
}

// CA "max attendu" — même principe que caAtDate() mais sur les valeurs INITIALES (p.tjm, pas
// currentTjm() ; p.endDate prévue initialement, pas effectiveEnd()) : un repère figé, jamais
// réduit par une pause/absence, jamais recalculé après la signature. caMaxAttendu() = la valeur
// finale (asOfDate = la fin initiale elle-même) ; caMaxAtDate() sert aux points du graphique.
function caMaxAtDate(p, asOfDate) {
  const nature = p.nature || 'mission';
  if (nature === 'projet_interne') return 0;
  const start = new Date(p.startDate + 'T00:00:00');
  const initialEnd = new Date(p.endDate + 'T00:00:00');
  const cap = asOfDate < initialEnd ? asOfDate : initialEnd;
  if (cap < start) return 0;
  if (nature === 'forfait') {
    const totalWD = workingDays(start, initialEnd);
    const elapsedWD = workingDays(start, cap);
    return totalWD > 0 ? (p.prixForfait || 0) * (elapsedWD / totalWD) : 0;
  }
  const wDays = workingDays(start, cap);
  return (p.tjm || 0) * wDays * (p.fte||5)/5;
}
function caMaxAttendu(p) {
  return caMaxAtDate(p, new Date(p.endDate + 'T00:00:00'));
}

// Délai de réponse moyen (push→soutenance, soutenance→démarrage), agrégé sur toutes les
// candidatures gagnées ayant mené aux prestations de l'entité — même esprit que
// computeDelaiReponse() (mode legacy), mais lit S.candidatures/S.opportunites directement
// plutôt que l'état d'un formulaire ouvert, et moyenne sur plusieurs candidatures.
function computeGroupDelaiReponse(prests) {
  const pushSoutenance = [], soutenanceDemarrage = [];
  prests.forEach(p => {
    if (!p.opportuniteId) return;
    const cand = S.candidatures.find(c => c.opportuniteId === p.opportuniteId && c.consultantId === p.consultantId && c.status === 'gagnee');
    if (!cand) return;
    const pushes = (cand.bookPushes || []).map(x => x.date).sort();
    const soutenances = (cand.soutenances || []).slice().sort((a,b) => a.date.localeCompare(b.date));
    const validees = soutenances.filter(s => s.resultat === 'validee');
    const retenue = validees.length ? validees[validees.length-1] : (soutenances.length ? soutenances[soutenances.length-1] : null);
    if (pushes.length && retenue) {
      const d = Math.round((new Date(retenue.date) - new Date(pushes[0])) / 86400000);
      if (d >= 0) pushSoutenance.push(d);
    }
    if (retenue) {
      const d = Math.round((new Date(p.startDate) - new Date(retenue.date)) / 86400000);
      if (d >= 0) soutenanceDemarrage.push(d);
    }
  });
  const avg = arr => arr.length ? Math.round(arr.reduce((s,v) => s+v, 0) / arr.length) : null;
  const avgPushSout = avg(pushSoutenance);
  const avgSoutDem  = avg(soutenanceDemarrage);
  const total = avgPushSout !== null && avgSoutDem !== null ? avgPushSout + avgSoutDem : (avgPushSout ?? avgSoutDem);
  const lines = [];
  if (avgPushSout !== null) lines.push(`Envoi → soutenance : ${avgPushSout} j (moy.)`);
  if (avgSoutDem  !== null) lines.push(`Soutenance → démarrage : ${avgSoutDem} j (moy.)`);
  return { total, lines };
}

function renderSuiviDemandeGroupKpis(prests) {
  const el = document.getElementById('sd-kpis');
  const nature = prests[0]?.nature || 'mission';

  const statuses = prests.map(prestationStatus);
  const enCours  = statuses.filter(s => s === 'en_cours').length;
  const enPause  = statuses.filter(s => s === 'en_pause').length;
  const terminee = statuses.filter(s => s === 'terminee').length;
  // Préciser "consultant(s)" à chaque pastille : "1 en cours" seul seul ne dit pas de quoi (ligne
  // de contexte entre le badge "Nature" et le compte de staffing plus bas).
  const statusPills = [
    enCours  ? `<span class="status-pill pill-en_cours">${enCours} consultant${enCours > 1 ? 's' : ''} en cours</span>` : '',
    enPause  ? `<span class="status-pill pill-en_pause">${enPause} consultant${enPause > 1 ? 's' : ''} en pause</span>` : '',
    terminee ? `<span class="status-pill pill-terminee">${terminee} consultant${terminee > 1 ? 's' : ''} terminé${terminee > 1 ? 's' : ''}</span>` : '',
  ].filter(Boolean).join(' ');

  const minStart = prests.reduce((m,p) => (!m || p.startDate < m) ? p.startDate : m, null);
  const maxEnd   = prests.reduce((m,p) => { const e = effectiveEnd(p); return (!m || e > m) ? e : m; }, null);
  const joursRestants = Math.round((new Date(maxEnd+'T00:00:00') - new Date(todayStr()+'T00:00:00')) / 86400000);

  const delai = computeGroupDelaiReponse(prests);
  const activeCount = statuses.filter(s => s !== 'terminee').length;
  const limiteUO = prests[0]?.limiteUOAn;

  const caAccumule = prests.reduce((s,p) => s + caAccumuleADate(p), 0);
  const caMax      = prests.reduce((s,p) => s + caMaxAttendu(p), 0);

  el.innerHTML = `<div class="stats-grid">
    <div class="stat-card">
      <div class="stat-label-row"><span class="stat-label">Nature & statut</span></div>
      <div class="stat-value" style="font-size:var(--text-md)"><span class="nature-${nature}">${natureLabel(nature)}</span></div>
      <div class="stat-sub" style="display:flex;gap:6px;flex-wrap:wrap;margin-top:6px">${statusPills}</div>
    </div>
    <div class="stat-card">
      <div class="stat-label-row"><span class="stat-label">Durée</span></div>
      <div class="stat-value" style="font-size:var(--text-md)">${fmtD(minStart)} → ${fmtD(maxEnd)}</div>
      <div class="stat-sub">${joursRestants >= 0 ? joursRestants + ' jour' + (joursRestants > 1 ? 's' : '') + ' restant' + (joursRestants > 1 ? 's' : '') : 'Terminée'}</div>
    </div>
    <div class="stat-card">
      <div class="stat-label-row"><span class="stat-label">Délai de réponse</span></div>
      <div class="stat-value">${delai.total !== null ? delai.total + ' j' : '—'}</div>
      ${delai.lines.map(l => `<div class="stat-sub">${l}</div>`).join('')}
    </div>
    <div class="stat-card">
      <div class="stat-label-row"><span class="stat-label">Staffing</span></div>
      <div class="stat-value">${activeCount} actif${activeCount > 1 ? 's' : ''}<span style="font-size:var(--text-sm);color:var(--text-muted)"> · ${prests.length} au total</span></div>
      <div class="stat-sub">${limiteUO ? `Limite d'UO : ${limiteUO} j/an` : "Pas de limite d'UO"}</div>
    </div>
    <div class="stat-card">
      <div class="stat-label-row"><span class="stat-label">CA</span></div>
      <div class="stat-value">${Math.round(caAccumule).toLocaleString('fr-FR')} €</div>
      <div class="stat-sub">CA max attendu : ${Math.round(caMax).toLocaleString('fr-FR')} €</div>
    </div>
  </div>`;
}

// Mois calendaires couvrant l'entité, de la date de début la plus ancienne à la date de fin
// INITIALE la plus tardive (l'horizon "prévisionnel" — une vraie prolongation déplacerait ce
// repère, volontairement laissé tel quel ici : le graphique montre l'écart, pas une cible mouvante).
function groupMonthBuckets(prests) {
  const minStart = prests.reduce((m,p) => (!m || p.startDate < m) ? p.startDate : m, null);
  const maxEnd   = prests.reduce((m,p) => (!m || p.endDate > m) ? p.endDate : m, null);
  const start = new Date(minStart + 'T00:00:00');
  const last  = new Date(maxEnd + 'T00:00:00');
  const months = [];
  let d = new Date(start.getFullYear(), start.getMonth(), 1);
  const lastMonth = new Date(last.getFullYear(), last.getMonth(), 1);
  while (d <= lastMonth) {
    months.push({ date: new Date(d), short: d.toLocaleDateString('fr-FR', {month:'short'}), label: d.toLocaleDateString('fr-FR', {month:'long', year:'numeric'}) });
    d = new Date(d.getFullYear(), d.getMonth()+1, 1);
  }
  return months;
}

function renderSuiviDemandeGroupCharts(prests) {
  const el = document.getElementById('sd-charts');
  const months = groupMonthBuckets(prests);
  const today = new Date(todayStr() + 'T00:00:00');
  const monthStart = d => new Date(d.getFullYear(), d.getMonth(), 1);
  const monthEnd   = d => new Date(d.getFullYear(), d.getMonth()+1, 0);
  // "Réel" plafonné à aujourd'hui pour le mois EN COURS (sinon ce mois n'affiche jamais rien
  // avant sa toute fin, cf. l'absence du 12-16 octobre non visible le 12 octobre) — null
  // seulement pour un mois qui n'a pas encore commencé.
  const reelAsOf = d => monthStart(d) > today ? null : (monthEnd(d) < today ? monthEnd(d) : today);

  const caPrevis = months.map(m => prests.reduce((s,p) => s + caMaxAtDate(p, monthEnd(m.date)), 0));
  const caReel   = months.map(m => {
    const asOf = reelAsOf(m.date);
    return asOf ? prests.reduce((s,p) => s + caAtDate(p, asOf), 0) : null;
  });

  const staffPrevis = months.map(m => prests.filter(p =>
    new Date(p.startDate+'T00:00:00') <= monthEnd(m.date) && new Date(p.endDate+'T00:00:00') >= monthEnd(m.date)
  ).length);
  // "Réel" : somme des taux d'activité journaliers (1 = journée pleine, 0,5 = demi-journée
  // d'absence, 0 = pause ou absence journée complète — pause et absence ne se cumulent jamais,
  // même règle de non-cumul que pour le CA, voir unavailableFraction()) plutôt qu'un décompte
  // entier de têtes : une demi-journée d'absence fait maintenant baisser la courbe de 0,5 au
  // lieu d'être invisible (le consultant restait compté comme présent) ou de faire disparaître
  // toute une personne.
  const staffReel = months.map(m => {
    const asOf = reelAsOf(m.date);
    if (!asOf) return null;
    const asOfStr = asOf.toISOString().slice(0,10);
    return prests.reduce((sum, p) => {
      if (!(new Date(p.startDate+'T00:00:00') <= asOf && new Date(effectiveEnd(p)+'T00:00:00') >= asOf)) return sum;
      const consultant = S.consultants.find(c => c.id === p.consultantId);
      const unavailable = Math.max(activePause(p, asOfStr) ? 1 : 0, absenceFraction(consultant, asOfStr));
      return sum + (1 - unavailable);
    }, 0);
  });

  el.innerHTML = `<div class="ca-marge-charts-grid">
    <div class="chart-container">
      <div class="chart-title ca-marge-chart-title">CA prévisionnel vs accumulé</div>
      <div id="sd-chart-ca"></div>
    </div>
    <div class="chart-container">
      <div class="chart-title ca-marge-chart-title">Staffing prévisionnel vs réel</div>
      <div id="sd-chart-staffing"></div>
    </div>
  </div>`;

  buildTwoLineChart(document.getElementById('sd-chart-ca'), months,
    { label: 'CA max attendu', values: caPrevis, color: 'var(--text-muted)', dash: '4,3' },
    { label: 'CA accumulé', values: caReel, color: 'var(--accent)' },
    { unit: '€' });
  buildTwoLineChart(document.getElementById('sd-chart-staffing'), months,
    { label: 'Staffing prévisionnel', values: staffPrevis, color: 'var(--text-muted)', dash: '4,3' },
    { label: 'Staffing réel', values: staffReel, color: 'var(--green)' },
    { decimals: 1 });
}

// Table dédiée (pas buildUnifiedTableHtml() de la Vue liste — colonnes différentes demandées
// ici : pas de rappel d'entité par ligne déjà en en-tête de page) mais même famille visuelle
// (mêmes classes .status-pill/.prest-type-label/.prest-* réutilisées, voir buildStaffingTableHtml()
// et styles/organisms/list.css). Construite depuis prestationToRow() (comme la Vue liste) pour ne
// pas dupliquer son calcul de statut/TJM/dates/restant, avec juste clientService neutralisé (déjà
// affiché dans l'en-tête de la page).
function renderSuiviDemandeGroupStaffing(prests) {
  const rows = prests.map(p => ({
    ...prestationToRow({ ...p, clientService: undefined }, 'clients'),
    onClick: `editConsultantFromSuiviDemande('${p.id}')`,
  }));
  document.getElementById('sd-staffing-list').innerHTML = buildStaffingTableHtml(rows);
}

// Statut · Type · Profil · Consultant · Dates · Restant · TJM · Occupation · [Modifier] — même
// ordre que la Vue liste (buildUnifiedTableHtml(), 2026-10-15). Grille CSS dédiée (.sd-staffing-row),
// pas .prest-row (celle de la Vue liste, à 9 colonnes différentes) — pour ne jamais risquer de la
// régresser.
function buildStaffingTableHtml(items) {
  if (!items.length) return '';
  const header = `<div class="sd-staffing-header-row"><span>Statut</span><span>Type</span><span>Profil</span><span>Consultant</span><span>Dates</span><span style="text-align:center">Restant</span><span style="text-align:right">TJM</span><span style="text-align:right">Occupation</span><span></span></div>`;
  const rows = items.slice().sort((a,b) => b.sortDate.localeCompare(a.sortDate)).map(it => `
    <div class="sd-staffing-row">
      <span class="status-pill ${it.statusClass}">${it.statusLabel}</span>
      <div class="prest-type"><span class="prest-type-label ${it.typeClass}">${it.typeLabel}</span></div>
      <div class="prest-profil${it.profilLine?'':' prest-profil-empty'}">${it.profilLine||'<span style="color:var(--text-muted)">—</span>'}</div>
      <div class="prest-client">${it.clientLine}<small>${it.subLine||''}</small></div>
      <div class="prest-dates">${it.dateLine}</div>
      <div class="prest-restant">${it.restantLine}</div>
      <div class="prest-tjm">${it.valueLine}</div>
      <div class="prest-activite">${it.activiteLine}</div>
      <button class="btn-icon prest-edit" onclick="${it.onClick}" title="Modifier" aria-label="Modifier — ${it.whoLabel}">
        <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
      </button>
    </div>`).join('');
  return header + rows;
}

// Mêmes points que buildMissionTimelinePoints() (démarrage → événements de mission → fin), mais
// depuis les champs stockés de la prestation plutôt que d'un formulaire ouvert (cette vue n'en
// embarque jamais) — plus un point par absence individuelle du consultant (pas les pauses,
// déjà résumées dans les KPI macro).
function buildPrestationTimelinePoints(p) {
  const points = [];
  if (p.startDate) points.push({ type: 'demarrage', date: p.startDate, label: 'Démarrage', color: 'var(--accent)' });
  (p.missionEvents || []).filter(e => e.type !== 'pause').forEach(e => points.push({
    type: e.type, date: e.date, label: MISSION_EVENT_LABELS[e.type] || e.type,
    color: e.type === 'prolongation' ? 'var(--orange)' : 'var(--red)',
  }));
  const consultant = S.consultants.find(c => c.id === p.consultantId);
  (consultant?.absences || []).forEach(a => {
    const days = Math.round((new Date(a.endDate+'T00:00:00') - new Date(a.startDate+'T00:00:00')) / 86400000) + 1;
    const label = a.period ? `Absence (${a.period === 'matin' ? 'matin' : 'après-midi'})` : `Absence (${days} j)`;
    points.push({ type: 'absence', date: a.startDate, label, color: 'var(--purple)' });
  });
  const effEnd = effectiveEnd(p);
  points.push(effEnd
    ? { type: 'fin', date: effEnd, label: 'Date de fin', color: 'var(--text-dim)' }
    : { type: 'fin-indefinie', date: null, label: 'Sortie indéfinie', color: 'var(--text-muted)', undated: true });
  return points.sort((a,b) => (a.date||'9999').localeCompare(b.date||'9999'));
}

// Une ligne par consultant staffé (gagné) + une ligne par candidature non retenue issue d'une
// opportunité ayant mené à une des prestations de l'entité (le pipeline, pas seulement les
// gagnants — demandé explicitement pour cette frise).
function renderSuiviDemandeGroupTimeline(prests) {
  const el = document.getElementById('sd-timeline');
  const lanes = [];

  prests.forEach(p => {
    const c = S.consultants.find(x => x.id === p.consultantId);
    const header = `<span class="sd-tl-lane-name">${c ? c.name : 'Consultant supprimé'}</span>`;
    lanes.push({ html: renderTimelineLane(buildPrestationTimelinePoints(p), header, true), firstDate: p.startDate });
  });

  const oppIds = new Set(prests.map(p => p.opportuniteId).filter(Boolean));
  S.candidatures.filter(c => oppIds.has(c.opportuniteId) && c.status === 'perdue').forEach(cand => {
    const c = S.consultants.find(x => x.id === cand.consultantId);
    const pushPts = (cand.bookPushes || []).map(x => ({ type: 'push', date: x.date, label: 'Push', color: 'var(--blue)' }));
    const soutPts = (cand.soutenances || []).map(s => ({
      type: 'soutenance', date: s.date, label: 'Soutenance',
      color: s.resultat === 'validee' ? 'var(--green)' : s.resultat === 'refusee' ? 'var(--red)' : 'var(--blue)',
    }));
    const points = [...pushPts, ...soutPts].sort((a,b) => a.date.localeCompare(b.date));
    points.push({ type: 'reponse', date: points.length ? points[points.length-1].date : todayStr(), label: 'Non retenu', color: 'var(--red)' });
    const header = `<span class="sd-tl-lane-name" style="color:var(--text-muted)">${c ? c.name : 'Candidat'} (non retenu)</span>`;
    lanes.push({ html: renderTimelineLane(points, header, false), firstDate: points[0]?.date || '9999' });
  });

  lanes.sort((a,b) => a.firstDate.localeCompare(b.firstDate));
  el.innerHTML = lanes.map(l => l.html).join('');
}

// Restitue #opportunite-modal-box à son overlay d'origine avant de masquer "Suivre la demande"
// (mode legacy uniquement — #prest-modal-box n'est plus jamais embarquée, voir mode groupé plus
// haut) — indispensable pour que la prochaine modale de création (Nouvelle opportunité)
// retrouve sa boîte à sa place habituelle. Appelée sur tous les chemins de sortie (Annuler,
// Échap, clic hors modale, Enregistrer, Supprimer).
function closeSuiviDemande() {
  const oppBox = document.getElementById('opportunite-modal-box');
  oppBox.classList.remove('suivi-demande-embedded');
  document.getElementById('opportunite-overlay').appendChild(oppBox);
  suiviDemandePrest = null;
  suiviDemandeOpp   = null;
  closeModal('suivi-demande-overlay');
}

// suiviDemandePrest est toujours null en mode groupé (jamais de formulaire Prestation embarqué,
// voir le mode groupé plus haut) : ces 2 fonctions ne font donc quelque chose qu'en mode legacy
// — en mode groupé, les boutons Annuler/Enregistrer sont de toute façon masqués
// (setSuiviDemandeFooterMode()), seul "Fermer" (closeSuiviDemande() direct) est visible.
// returnToSuiviDemande() : no-op sauf si on vient de "Voir l'opportunité d'origine" depuis le
// mode groupé (viewOriginOpportunite()) — y revient alors automatiquement, pour la continuité
// Modifier/Réglages/Voir l'opportunité partout pareil.
function cancelSuiviDemande() {
  const prestDirty = suiviDemandePrest && prestFormState() !== prestModalSnapshot;
  const oppDirty    = suiviDemandeOpp   && oppFormState()   !== oppModalSnapshot;
  if ((prestDirty || oppDirty) && !confirm('Des modifications non enregistrées seront perdues. Annuler quand même ?')) return;
  closeSuiviDemande();
  returnToSuiviDemande();
}

function saveSuiviDemande() {
  if (suiviDemandePrest && commitPrestationFromForm() === null) return;
  if (suiviDemandeOpp   && commitOpportuniteFromForm() === null) return;
  closeSuiviDemande();
  render();
  returnToSuiviDemande();
  showToast('Demande enregistrée', 'success');
}

// [d1, d2) en jours ouvrés (lundi-vendredi uniquement, pas de jours fériés — même niveau de
// précision que le reste de l'app, qui ne les modélise pas non plus).
function businessDaysBetween(d1, d2) {
  if (!d1 || !d2 || d2 <= d1) return 0;
  let n = 0;
  for (let d = new Date(d1 + 'T00:00:00'); d < new Date(d2 + 'T00:00:00'); d.setDate(d.getDate() + 1)) {
    const day = d.getDay();
    if (day !== 0 && day !== 6) n++;
  }
  return n;
}

// Découpe la mission en segments atomiques : une rupture à chaque changement de TJM/taux
// d'occupation (modalRevisions) ET à chaque révision de coût complet du consultant
// (consultant.coutCompletRevisions) — les 2 listes de dates sont fusionnées, pas seulement
// celle du TJM. Avant ce découpage, une révision de coût tombant au milieu d'un segment TJM
// n'était prise en compte qu'au segment TJM suivant, pas à sa vraie date (bug corrigé le
// 2026-09-16). Réutilisée par computeMissionCaExact() et computeMissionCaSparklineData().
function buildMissionCaAtomicSegments() {
  const startDate = document.getElementById('f-start').value;
  if (!startDate) return null;
  const endEvts = modalMissionEvents.filter(e => e.type === 'prolongation' || e.type === 'sortie_anticipee');
  const effEnd  = endEvts.length ? endEvts[endEvts.length - 1].date : document.getElementById('f-end').value;
  const consultant = S.consultants.find(c => c.id === document.getElementById('f-cons').value);

  const baseTjm = parseFloat(document.getElementById('f-tjm').value) || undefined;
  const baseFte = parseInt(document.getElementById('f-fte').value) || undefined;
  const tariffRows = [{ date: startDate, tjm: baseTjm, fte: baseFte }, ...modalRevisions]
    .slice().sort((a, b) => a.date.localeCompare(b.date));

  const coutDates = consultant ? (consultant.coutCompletRevisions || []).map(r => r.date).filter(d => d >= startDate) : [];
  const breakDates = Array.from(new Set([startDate, ...tariffRows.map(r => r.date), ...coutDates])).sort();

  let curTjm = baseTjm, curFte = baseFte;
  const segments = [];
  for (let i = 0; i < breakDates.length; i++) {
    const segStart = breakDates[i];
    tariffRows.filter(r => r.date === segStart).forEach(r => {
      if (r.tjm !== undefined) curTjm = r.tjm;
      if (r.fte !== undefined) curFte = r.fte;
    });
    const segEnd  = i + 1 < breakDates.length ? breakDates[i + 1] : (effEnd || todayStr());
    const curCout = consultant ? currentCoutComplet(consultant, segStart) : 0;
    segments.push({ start: segStart, end: segEnd, tjm: curTjm, fte: curFte, cout: curCout });
  }
  return { segments, effEnd, startDate, consultant };
}

// Somme CA/coût sur les segments atomiques jusqu'à une date, en retirant les jours de pause —
// même logique que l'ancien computeUpTo() interne de computeMissionCaExact(), mais itère les
// segments déjà découpés par buildMissionCaAtomicSegments() plutôt que les seules révisions TJM.
function sumMissionCaSegments(segData, uptoDate) {
  if (!uptoDate) return { ca: 0, cout: 0 };
  const { segments, effEnd } = segData;
  const pauses = modalMissionEvents.filter(e => e.type === 'pause')
    .map(e => ({ start: e.date, end: e.resumeDate || effEnd || todayStr() }));
  let ca = 0, cout = 0;
  for (const seg of segments) {
    if (seg.start >= uptoDate) break;
    const clippedEnd = seg.end > uptoDate ? uptoDate : seg.end;

    let workStart = seg.start;
    let segBizDays = 0;
    const segPauses = pauses.filter(p => p.start < clippedEnd && p.end > seg.start)
      .sort((a, b) => a.start.localeCompare(b.start));
    segPauses.forEach(p => {
      const pStart = p.start < seg.start ? seg.start : p.start;
      segBizDays += businessDaysBetween(workStart, pStart);
      workStart = p.end > clippedEnd ? clippedEnd : p.end;
    });
    segBizDays += businessDaysBetween(workStart, clippedEnd);

    ca   += (seg.tjm || 0) * segBizDays * (seg.fte || 5) / 5;
    cout += seg.cout        * segBizDays * (seg.fte || 5) / 5;
  }
  return { ca, cout };
}

// CA/marge exacts de la mission en cours d'édition — même signature/retour qu'avant, calcul
// interne désormais basé sur buildMissionCaAtomicSegments()/sumMissionCaSegments() (segmentation
// fine TJM + coût complet, pas d'approximation sur une période plate).
function computeMissionCaExact() {
  const segData = buildMissionCaAtomicSegments();
  if (!segData) return null;
  const today = todayStr();
  const realise = sumMissionCaSegments(segData, segData.effEnd && segData.effEnd < today ? segData.effEnd : today);
  const total   = segData.effEnd ? sumMissionCaSegments(segData, segData.effEnd) : null;
  return {
    caRealise: realise.ca,
    margePctRealise: realise.ca ? Math.round((realise.ca - realise.cout) / realise.ca * 100) : null,
    caPrevisionnel: total ? total.ca : null,
  };
}

// Points pour la sparkline CA/marge de la carte KPI "CA" : CA cumulé à chaque frontière de
// segment (ligne pleine), et taux de marge propre à chaque segment (ligne en paliers — saute à
// chaque révision de TJM/taux d'occupation OU de coût complet, pas une moyenne lissée).
function computeMissionCaSparklineData() {
  const segData = buildMissionCaAtomicSegments();
  if (!segData) return null;
  const horizon = segData.effEnd || todayStr();
  const relevantSegs = segData.segments.filter(s => s.start < horizon)
    .map(s => ({ ...s, end: s.end > horizon ? horizon : s.end }));
  if (!relevantSegs.length) return null;

  const boundaries = Array.from(new Set([...relevantSegs.map(s => s.start), horizon])).sort();
  const caPoints = boundaries.map(d => ({ date: d, caCum: sumMissionCaSegments(segData, d).ca }));
  const margeSteps = relevantSegs.map(s => ({
    start: s.start, end: s.end,
    marginPct: s.tjm ? Math.round((s.tjm - s.cout) / s.tjm * 100) : null,
  }));
  return { caPoints, margeSteps, startDate: segData.startDate, horizon };
}

// Sparkline CA (ligne pleine) + marge (ligne pointillée) — même précédent de style que
// buildCaChart() (masse salariale en var(--orange) pointillé) : pas de couleur inventée. Pas
// d'axe/légende/titre ("indicateur de pilotage, pas un compte-rendu") ; aria-hidden car les
// valeurs qu'elle illustre (CA réalisé, marge, prévisionnel) sont déjà en texte dans la carte.
function buildCaSparklineSvg(sparkData) {
  if (!sparkData) return '';
  const { caPoints, margeSteps, startDate, horizon } = sparkData;
  const W = 200, H = 24, PAD = 2;
  const t0 = new Date(startDate + 'T00:00:00').getTime();
  const t1 = new Date(horizon + 'T00:00:00').getTime();
  const span = Math.max(1, t1 - t0);
  const xPx = d => PAD + ((new Date(d + 'T00:00:00').getTime() - t0) / span) * (W - 2 * PAD);

  const caMax = Math.max(...caPoints.map(p => p.caCum), 1);
  const yCa = v => H - PAD - (v / caMax) * (H - 2 * PAD);
  const caPath = caPoints.map((p, i) => `${i === 0 ? 'M' : 'L'} ${xPx(p.date).toFixed(1)} ${yCa(p.caCum).toFixed(1)}`).join(' ');

  const margeVals = margeSteps.map(s => s.marginPct).filter(v => v !== null);
  const mMin = margeVals.length ? Math.min(...margeVals, 0) : 0;
  const mMax = margeVals.length ? Math.max(...margeVals, 1) : 1;
  const yMarge = v => H - PAD - ((v - mMin) / ((mMax - mMin) || 1)) * (H - 2 * PAD);
  let margePath = '';
  margeSteps.forEach(s => {
    if (s.marginPct === null) return;
    const x1 = xPx(s.start), x2 = xPx(s.end), y = yMarge(s.marginPct);
    margePath += `${margePath ? ' L' : 'M'} ${x1.toFixed(1)} ${y.toFixed(1)} L ${x2.toFixed(1)} ${y.toFixed(1)}`;
  });

  return `<svg viewBox="0 0 ${W} ${H}" style="width:100%;height:${H}px;display:block" aria-hidden="true" focusable="false">
    <path d="${caPath}" fill="none" stroke="var(--green)" stroke-width="1.5" stroke-linejoin="round"/>
    <path d="${margePath}" fill="none" stroke="var(--orange)" stroke-width="1.2" stroke-dasharray="2,2"/>
  </svg>`;
}

// Nombre de mois entiers entre 2 dates (jour du mois pas encore atteint = mois incomplet, pas
// arrondi au supérieur) et sa mise en forme "X mois" / "Y an(s)[, Z mois]" — carte KPI "Statut".
function monthsBetween(d1, d2) {
  const a = new Date(d1 + 'T00:00:00'), b = new Date(d2 + 'T00:00:00');
  let months = (b.getFullYear() - a.getFullYear()) * 12 + (b.getMonth() - a.getMonth());
  if (b.getDate() < a.getDate()) months--;
  return Math.max(0, months);
}
function formatDuration(months) {
  if (months < 12) return `${months} mois`;
  const years = Math.floor(months / 12), rem = months % 12;
  return rem === 0 ? `${years} an${years > 1 ? 's' : ''}` : `${years} an${years > 1 ? 's' : ''}, ${rem} mois`;
}
// Format JJ/MM/AAAA — uniquement pour la carte KPI "Statut" (demande explicite) ; fmtD() (format
// "12 mars 26") reste inchangée partout ailleurs, y compris dans la frise de "Suivre la demande".
function fmtDNum(d) {
  if (!d) return '—';
  const [y, m, day] = d.split('-');
  return `${day}/${m}/${y}`;
}

// Statut/date de fin/durée/jours restants "live" de la mission en cours d'édition — même
// logique que updateBadges() (statut calculé, pas stocké), mais sur les champs du formulaire
// plutôt que sur l'objet prest (qui peut être obsolète pendant l'édition). Carte KPI "Statut".
function computeSuiviDemandeStatus() {
  const startDate = document.getElementById('f-start').value;
  const endDate    = document.getElementById('f-end').value;
  const endEvts    = modalMissionEvents.filter(e => e.type === 'prolongation' || e.type === 'sortie_anticipee');
  const effEnd     = endEvts.length ? endEvts[endEvts.length - 1].date : endDate;
  const today      = todayStr();
  const pauseNow   = modalMissionEvents.find(e => e.type === 'pause' && e.date <= today && (!e.resumeDate || e.resumeDate > today));

  let statusKey = 'en_cours', label = 'En cours';
  if (pauseNow) { statusKey = 'en_pause'; label = 'En pause'; }
  else if (effEnd && effEnd < today) { statusKey = 'terminee'; label = 'Terminée'; }

  const totalMonths   = startDate && effEnd ? monthsBetween(startDate, effEnd) : null;
  const joursRestants = effEnd ? Math.round((new Date(effEnd + 'T00:00:00') - new Date(today + 'T00:00:00')) / 86400000) : null;
  return { statusKey, label, effEnd, totalMonths, joursRestants };
}

// TJM/taux d'occupation courants — même calcul que updateBadges() (main.js), carte KPI "TJM".
function computeSuiviDemandeTjm() {
  const baseTjm = parseFloat(document.getElementById('f-tjm').value) || null;
  const baseFte = parseInt(document.getElementById('f-fte').value) || null;
  const tjmRevs = modalRevisions.filter(r => r.tjm !== undefined);
  const fteRevs = modalRevisions.filter(r => r.fte !== undefined);
  return {
    curTjm: tjmRevs.length ? tjmRevs[tjmRevs.length - 1].tjm : baseTjm,
    curFte: fteRevs.length ? fteRevs[fteRevs.length - 1].fte : baseFte,
  };
}

// Délai envoi (push) → soutenance (si elle a eu lieu) → démarrage (si il a eu lieu), calculé sur
// la candidature gagnée de l'opportunité. hasPrest indique si le démarrage réel (f-start) est
// disponible — sans prestation, seul le délai envoi→soutenance peut être calculé.
function computeDelaiReponse(hasPrest) {
  const cand = modalCandidatures.find(c => c.status === 'gagnee');
  if (!cand) return null;
  const pushes = (cand.bookPushes || []).slice().sort((a, b) => a.date.localeCompare(b.date));
  const soutenances = (cand.soutenances || []).slice().sort((a, b) => a.date.localeCompare(b.date));
  const firstPush = pushes.length ? pushes[0].date : null;
  const validees = soutenances.filter(s => s.resultat === 'validee');
  const retenue = validees.length ? validees[validees.length - 1] : (soutenances.length ? soutenances[soutenances.length - 1] : null);
  const demarrage = hasPrest ? (document.getElementById('f-start').value || null) : null;

  const diffJ = (a, b) => Math.round((new Date(b + 'T00:00:00') - new Date(a + 'T00:00:00')) / 86400000);
  return {
    delaiPushSoutenance:      (firstPush && retenue)   ? diffJ(firstPush, retenue.date) : null,
    delaiSoutenanceDemarrage: (retenue && demarrage)   ? diffJ(retenue.date, demarrage) : null,
    delaiPushDemarrageDirect: (!retenue && firstPush && demarrage) ? diffJ(firstPush, demarrage) : null,
  };
}

// 5 cartes (Statut, TJM, Profils engagés, Délai de réponse, CA) dans .stats-grid.sd-kpis-grid —
// largeurs inégales (styles/molecules/stat-card.css) plutôt que la grille fluide par défaut,
// pour qu'aucune ligne ne revienne jamais à la ligne au milieu d'une phrase. Statut/TJM/CA ne
// s'affichent que si `prest` existe ; Profils engagés/Délai de réponse que si `opp` existe.
function renderSuiviDemandeKpis(prest, opp) {
  const el = document.getElementById('sd-kpis');
  const cards = [];

  if (prest) {
    const st = computeSuiviDemandeStatus();
    const jr = st.joursRestants;
    // Une mission Terminée n'affiche pas de compte à rebours (ni "restants", ni "depuis") —
    // l'info est déjà portée par la pastille de statut elle-même.
    const jrHtml = (jr === null || st.statusKey === 'terminee') ? ''
      : `<div class="sd-kpi-jours-restants">${jr} jour${jr > 1 ? 's' : ''} restant${jr > 1 ? 's' : ''}</div>`;
    cards.push(`<div class="stat-card">
      <div class="stat-label-row"><span class="stat-label">Statut</span></div>
      <div class="stat-value"><span class="status-pill pill-${st.statusKey}">${st.label}</span></div>
      <div class="stat-sub">Date de fin : ${fmtDNum(st.effEnd)}<br>Durée totale : ${st.totalMonths !== null ? formatDuration(st.totalMonths) : '—'}</div>
      ${jrHtml}
    </div>`);

    const tjm = computeSuiviDemandeTjm();
    cards.push(`<div class="stat-card">
      <div class="stat-label-row"><span class="stat-label">TJM</span></div>
      <div class="stat-value" style="color:var(--accent)">${tjm.curTjm ? tjm.curTjm.toLocaleString('fr-FR') + ' €/j' : '—'}</div>
      <div class="stat-sub">Occupation : ${tjm.curFte || '—'}/5</div>
    </div>`);
  }

  // Toujours affichées, avec ou sans opportunité d'origine (y compris pour une prestation
  // terminée).
  {
    // "Profils engagés" = nombre de profils distincts qui sont, ont été, ou seront en
    // prestation pour cette demande — opportunité ou pas. prest.consultantId compte le profil
    // actuellement staffé (y compris sans opportunité d'origine, ex: prestation créée
    // directement) ; les candidatures avec un prestationId comptent tout autre profil déjà passé
    // en prestation via cette opportunité (ex: staffing en équipe, plusieurs prestations issues
    // de la même opportunité) — un Set évite de compter 2 fois le même consultant si les 2
    // sources se recoupent (cas normal : le gagnant de l'opportunité EST le consultant de prest).
    const staffedIds = new Set();
    if (prest) staffedIds.add(prest.consultantId);
    if (opp) modalCandidatures.filter(c => c.prestationId).forEach(c => staffedIds.add(c.consultantId));
    const engages = staffedIds.size;
    // Sous-info : toujours liée aux données de l'opportunité (pushs/soutenances), tous statuts
    // confondus — n'existe tout simplement pas sans opportunité (rien à additionner).
    const totalPushes = opp ? modalCandidatures.reduce((s, c) => s + (c.bookPushes || []).length, 0) : 0;
    const totalSout   = opp ? modalCandidatures.reduce((s, c) => s + (c.soutenances || []).length, 0) : 0;
    cards.push(`<div class="stat-card">
      <div class="stat-label-row"><span class="stat-label">Profils engagés</span></div>
      <div class="stat-value">${engages} profil${engages > 1 ? 's' : ''}</div>
      ${opp ? `<div class="stat-sub">${totalPushes} push${totalPushes > 1 ? 's' : ''} CV/Book<br>${totalSout} soutenance${totalSout > 1 ? 's' : ''}</div>` : ''}
    </div>`);

    const delai = opp ? computeDelaiReponse(!!prest) : null;
    let total = null;
    const lines = [];
    if (delai) {
      if (delai.delaiPushDemarrageDirect !== null) total = delai.delaiPushDemarrageDirect;
      else if (prest && delai.delaiPushSoutenance !== null && delai.delaiSoutenanceDemarrage !== null) total = delai.delaiPushSoutenance + delai.delaiSoutenanceDemarrage;
      else if (!prest && delai.delaiPushSoutenance !== null) total = delai.delaiPushSoutenance;
      if (delai.delaiPushSoutenance !== null)      lines.push(`Envoi → soutenance : ${delai.delaiPushSoutenance} j`);
      if (delai.delaiSoutenanceDemarrage !== null) lines.push(`Soutenance → démarrage : ${delai.delaiSoutenanceDemarrage} j`);
    }
    if (!opp) lines.push('Créée directement, sans opportunité au préalable');
    cards.push(`<div class="stat-card">
      <div class="stat-label-row"><span class="stat-label">Délai de réponse</span></div>
      <div class="stat-value">${total !== null ? total + ' j' : '—'}</div>
      ${lines.map(l => `<div class="stat-sub">${l}</div>`).join('')}
    </div>`);
  }

  if (prest) {
    const ca = computeMissionCaExact();
    if (ca) {
      const spark = buildCaSparklineSvg(computeMissionCaSparklineData());
      cards.push(`<div class="stat-card">
        <div class="stat-label-row"><span class="stat-label">CA</span></div>
        <div class="stat-value">${Math.round(ca.caRealise).toLocaleString('fr-FR')} €</div>
        <div class="stat-sub">${ca.margePctRealise !== null ? `Marge : ${ca.margePctRealise}%` : ''}${ca.caPrevisionnel !== null ? `<br>CA prévisionnel : ${Math.round(ca.caPrevisionnel).toLocaleString('fr-FR')} €` : ''}</div>
        ${spark ? `<div class="sd-kpi-sparkline">${spark}</div>` : ''}
      </div>`);
    }
  }

  el.innerHTML = cards.length ? `<div class="stats-grid sd-kpis-grid">${cards.join('')}</div>` : '';
}

// Point neutre "Détection" (opp.createdAt) + une ligne par candidat (bookPushes/soutenances
// interclassés par date, puis réponse/démarrage/événements de mission/date de fin pour un
// gagnant, ou arrêt à la réponse pour un perdant) — voir buildSuiviDemandeLane().
// Démarrage → toutes les prolongations/pauses/sorties (modalMissionEvents est déjà trié par
// date, addMissionEvent() : itérer dans l'ordre donne tout l'historique, pas seulement le
// dernier événement comme le feraient effectiveEnd()/lastEndEvent()) → date de fin (ou "Sortie
// indéfinie"). Partagé entre buildSuiviDemandeLane() (candidature gagnée) et
// renderSuiviDemandeTimeline() (prestation créée directement, sans opportunité).
function buildMissionTimelinePoints(prest) {
  const points = [];
  const startDate = document.getElementById('f-start').value;
  if (startDate) points.push({ type: 'demarrage', date: startDate, label: 'Démarrage', color: 'var(--accent)' });

  modalMissionEvents.forEach(e => points.push({
    type: e.type, date: e.date, label: MISSION_EVENT_LABELS[e.type] || e.type,
    color: e.type === 'prolongation' ? 'var(--orange)' : e.type === 'pause' ? 'var(--blue)' : 'var(--red)',
  }));

  const endEvts = modalMissionEvents.filter(e => e.type === 'prolongation' || e.type === 'sortie_anticipee');
  const effEnd  = endEvts.length ? endEvts[endEvts.length - 1].date : document.getElementById('f-end').value;
  points.push(effEnd
    ? { type: 'fin', date: effEnd, label: 'Date de fin', color: 'var(--text-dim)' }
    : { type: 'fin-indefinie', date: null, label: 'Sortie indéfinie', color: 'var(--text-muted)', undated: true });
  return points;
}

function buildSuiviDemandeLane(cand, prest) {
  const pushPts = (cand.bookPushes || []).map(p => ({ type: 'push', date: p.date, label: 'Push', color: 'var(--blue)' }));
  const soutPts = (cand.soutenances || []).map(s => ({
    type: 'soutenance', date: s.date, label: 'Soutenance',
    color: s.resultat === 'validee' ? 'var(--green)' : s.resultat === 'refusee' ? 'var(--red)' : 'var(--blue)',
  }));
  const points = [...pushPts, ...soutPts].sort((a, b) => a.date.localeCompare(b.date));

  if (cand.status === 'gagnee' || cand.status === 'perdue') {
    const validees = (cand.soutenances || []).filter(s => s.resultat === 'validee').sort((a, b) => a.date.localeCompare(b.date));
    const allSout  = (cand.soutenances || []).slice().sort((a, b) => a.date.localeCompare(b.date));
    const retenue  = validees.length ? validees[validees.length - 1] : (allSout.length ? allSout[allSout.length - 1] : null);
    if (retenue) points.push({ type: 'reponse', date: retenue.date, label: 'Réponse', color: cand.status === 'gagnee' ? 'var(--green)' : 'var(--red)' });
  }

  if (cand.status === 'gagnee' && prest) points.push(...buildMissionTimelinePoints(prest));

  return {
    consultantId: cand.consultantId,
    status: cand.status,
    won: cand.status === 'gagnee',
    firstPushDate: points.find(p => p.type === 'push' || p.type === 'soutenance')?.date || null,
    points,
  };
}

// Le(s) candidat(s) gagnant(s) toujours en premier ; les autres triés par date de leur 1er push
// (le plus ancien en haut) — règle exacte demandée pour la frise.
function sortSuiviDemandeLanes(lanes) {
  return lanes.slice().sort((a, b) => {
    if (a.won !== b.won) return a.won ? -1 : 1;
    return (a.firstPushDate || '9999-99-99').localeCompare(b.firstPushDate || '9999-99-99');
  });
}

function renderTimelinePoint(pt) {
  return `<div class="sd-tl-point${pt.undated ? ' sd-tl-undated' : ''}">
    <span class="sd-tl-dot" style="--dot-color:${pt.color}"></span>
    <span class="sd-tl-label">${pt.label}</span>
    ${pt.undated ? '' : `<span class="sd-tl-date">${fmtD(pt.date)}</span>`}
  </div>`;
}

function renderTimelineLane(points, headerHtml, won) {
  const pointsHtml = points.map(renderTimelinePoint).join('<div class="sd-tl-connector"></div>');
  return `<div class="sd-timeline-lane${won ? ' sd-tl-lane-won' : ''}">
    <div class="sd-tl-lane-head">${headerHtml}</div>
    <div class="sd-tl-lane-points">${pointsHtml}</div>
  </div>`;
}

// Frise chronologique de "Suivre la demande" : #sd-timeline, entre les KPI et le bloc
// Prestation/Opportunité. Toujours affichée dès qu'il y a `prest` ou `opp` — avec `opp` : point
// "Détection" + une ligne par candidat ; sans `opp` (prestation créée directement) : une seule
// ligne, directement le cycle de la mission (démarrage → événements → fin), il y a assez de
// données pour ça même sans opportunité en amont.
function renderSuiviDemandeTimeline(prest, opp) {
  const el = document.getElementById('sd-timeline');
  if (!el) return;

  if (!opp) {
    if (!prest) { el.innerHTML = ''; return; }
    const cons = S.consultants.find(c => c.id === document.getElementById('f-cons').value);
    const headerHtml = `<span class="sd-tl-lane-name">${cons ? cons.name : 'Consultant supprimé'}</span>`;
    el.innerHTML = `<div class="sd-timeline-lanes">${renderTimelineLane(buildMissionTimelinePoints(prest), headerHtml, true)}</div>`;
    return;
  }

  const detectionHtml = `<div class="sd-tl-detection-row">${renderTimelinePoint({ label: 'Détection', date: opp.createdAt, color: 'var(--text-dim)' })}</div>`;

  const lanes = sortSuiviDemandeLanes(
    modalCandidatures.filter(c => c.consultantId).map(c => buildSuiviDemandeLane(c, prest))
  );
  const lanesHtml = lanes.map(lane => {
    const cons = S.consultants.find(c => c.id === lane.consultantId);
    const headerHtml = `<span class="sd-tl-lane-name">${cons ? cons.name : 'Consultant supprimé'}</span>
      <span class="status-pill pill-cand-${lane.status}">${candidatureStatusLabel(lane.status)}</span>`;
    return renderTimelineLane(lane.points, headerHtml, lane.won);
  }).join('');

  el.innerHTML = `${detectionHtml}<div class="sd-timeline-lanes">${lanesHtml}</div>`;
}

function refreshSuiviDemandeIfOpen() {
  if (document.getElementById('suivi-demande-overlay').classList.contains('open')) {
    renderSuiviDemandeKpis(suiviDemandePrest, suiviDemandeOpp);
    renderSuiviDemandeTimeline(suiviDemandePrest, suiviDemandeOpp);
  }
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
  'suivi-demande-overlay': cancelSuiviDemande,
  'commercial-overlay': cancelCommercialModal,
  'prestation-reglages-overlay': cancelPrestationReglagesModal,
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
  (MODAL_CANCEL[id] || (() => closeModal(id)))();
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
