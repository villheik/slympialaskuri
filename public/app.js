// ---------- State ----------
let currentUser = null;
let competitions = [];
let currentComp = null;
let state = null; // full competition state from /api/competitions/:id/state
let activeTab = 'standings';
let openEventId = null;

// ---------- API helpers ----------
async function api(method, path, body) {
  const res = await fetch(path, {
    method,
    headers: body ? { 'Content-Type': 'application/json' } : {},
    body: body ? JSON.stringify(body) : undefined
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || `HTTP ${res.status}`);
  }
  return res.json();
}
const get = (path) => api('GET', path);
const post = (path, body) => api('POST', path, body);
const put = (path, body) => api('PUT', path, body);
const del = (path) => api('DELETE', path);

// ---------- Toast ----------
function toast(msg) {
  let el = document.querySelector('.toast');
  if (!el) { el = document.createElement('div'); el.className = 'toast'; document.body.appendChild(el); }
  el.textContent = msg;
  el.classList.add('show');
  setTimeout(() => el.classList.remove('show'), 2500);
}

// ---------- Render router ----------
function render() {
  const app = document.getElementById('app');
  if (!currentUser) { app.innerHTML = renderLogin(); return; }
  if (!currentComp) { app.innerHTML = renderCompList(); return; }
  app.innerHTML = renderComp();
  attachCompHandlers();
}

// ---------- Login ----------
function renderLogin() {
  return `
    <div class="login-wrap card">
      <h1>Slympialaskuri</h1>
      <p>Kirjaudu käyttäjänimellä jatkaaksesi.</p>
      <div class="input-row" style="margin-bottom:12px">
        <input id="login-name" type="text" placeholder="Käyttäjänimi" autocomplete="off">
      </div>
      <button class="btn-primary btn-block" id="login-btn">Kirjaudu</button>
    </div>`;
}

document.addEventListener('click', async (e) => {
  if (e.target.id === 'login-btn') {
    const name = document.getElementById('login-name').value.trim();
    if (!name) return;
    try {
      currentUser = await post('/api/login', { username: name });
      competitions = await get('/api/competitions');
      render();
    } catch(err) { toast(err.message); }
  }
  if (e.target.id === 'logout-btn') {
    await post('/api/logout');
    currentUser = null; currentComp = null; state = null;
    render();
  }
});

document.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') {
    const btn = document.getElementById('login-btn');
    if (btn) btn.click();
  }
});

// ---------- Competition list ----------
function renderCompList() {
  const items = competitions.length
    ? competitions.map(c => `
        <div class="comp-item" data-comp-id="${c.id}">
          <span class="comp-item-name">${esc(c.name)}</span>
          <span class="comp-item-date">${c.created_at.slice(0,10)}</span>
        </div>`).join('')
    : '<div class="empty">Ei kisoja. Luo ensimmäinen!</div>';

  return `
    <div class="app-header">
      <h1>Slympialaskuri</h1>
      <div class="user-info">
        <span>${esc(currentUser.username)}</span>
        <button class="btn-ghost btn-sm" id="logout-btn">Kirjaudu ulos</button>
      </div>
    </div>
    ${items}
    <div class="card">
      <div class="card-title">Uusi kisa</div>
      <div class="input-row">
        <input id="new-comp-name" type="text" placeholder="Kisan nimi">
        <button class="btn-primary" id="new-comp-btn">Luo</button>
      </div>
    </div>`;
}

document.addEventListener('click', async (e) => {
  const compItem = e.target.closest('[data-comp-id]');
  if (compItem && !e.target.closest('button')) {
    const id = compItem.dataset.compId;
    const comp = competitions.find(c => String(c.id) === id);
    if (comp) await openComp(comp);
  }
  if (e.target.id === 'new-comp-btn') {
    const name = document.getElementById('new-comp-name').value.trim();
    if (!name) return;
    try {
      const c = await post('/api/competitions', { name });
      competitions.unshift({ ...c, created_at: new Date().toISOString() });
      await openComp(competitions[0]);
    } catch(err) { toast(err.message); }
  }
});

async function openComp(comp) {
  currentComp = comp;
  state = await get(`/api/competitions/${comp.id}/state`);
  activeTab = 'standings';
  openEventId = null;
  render();
}

// ---------- Competition view ----------
function renderComp() {
  const tabs = [
    { id: 'standings', label: 'Kokonaiskilpailu' },
    { id: 'events', label: 'Lajit' },
    { id: 'participants', label: 'Osallistujat' },
    { id: 'teams', label: 'Tiimit' },
  ];
  const tabHtml = tabs.map(t => `<button class="tab ${activeTab === t.id ? 'active' : ''}" data-tab="${t.id}">${t.label}</button>`).join('');

  let content = '';
  if (activeTab === 'standings') content = renderStandings();
  if (activeTab === 'events') content = renderEvents();
  if (activeTab === 'participants') content = renderParticipants();
  if (activeTab === 'teams') content = renderTeams();

  return `
    <div class="app-header">
      <div>
        <button class="btn-ghost btn-sm" id="back-btn">← Kisat</button>
        <h1 style="display:inline;margin-left:8px">${esc(currentComp.name)}</h1>
      </div>
      <div class="user-info">
        <span>${esc(currentUser.username)}</span>
        <button class="btn-ghost btn-sm" id="logout-btn">Kirjaudu ulos</button>
      </div>
    </div>
    <div class="tabs">${tabHtml}</div>
    ${content}`;
}

function attachCompHandlers() {
  document.querySelectorAll('.tab').forEach(btn => {
    btn.addEventListener('click', () => { activeTab = btn.dataset.tab; openEventId = null; render(); });
  });
  document.getElementById('back-btn')?.addEventListener('click', () => { currentComp = null; state = null; render(); });
}

// ---------- Standings ----------
function renderStandings() {
  const { standings, customColumns, customValues, adjustments } = state;

  const colHeaders = customColumns.map(c => `<th>${esc(c.name)}</th>`).join('');
  const rows = standings.map((s, i) => {
    const adjVal = s.adjustment || 0;
    const colCells = customColumns.map(col => {
      const val = customValues.find(v => v.column_id === col.id && v.participant_id === s.participantId);
      return `<td><input class="score-input" style="width:80px" data-ccol="${col.id}" data-pid="${s.participantId}" value="${esc(val?.value ?? '')}" placeholder="—"></td>`;
    }).join('');

    return `<tr>
      <td class="rank-col">${i + 1}</td>
      <td>${esc(s.name)}</td>
      <td class="points-col">${s.total}</td>
      <td>
        <div class="adj-row">
          <button class="btn-ghost btn-icon btn-sm adj-btn" data-pid="${s.participantId}" data-delta="-1">−</button>
          <span>${adjVal >= 0 ? '+' : ''}${adjVal}</span>
          <button class="btn-ghost btn-icon btn-sm adj-btn" data-pid="${s.participantId}" data-delta="1">+</button>
        </div>
      </td>
      ${colCells}
    </tr>`;
  }).join('');

  const addColHtml = `
    <div class="section-title">Lisäsarakkeet</div>
    <div class="input-row">
      <input id="new-col-name" type="text" placeholder="Sarakkeen nimi">
      <button class="btn-ghost btn-sm" id="add-col-btn">+ Lisää</button>
    </div>
    ${customColumns.map(c => `
      <div class="list-item">
        <span class="list-item-name">${esc(c.name)}</span>
        <button class="btn-danger btn-sm del-col-btn" data-cid="${c.id}">Poista</button>
      </div>`).join('')}`;

  return `
    <div class="card">
      <div class="card-title">Kokonaispisteet</div>
      <div class="table-wrap">
        <table>
          <thead><tr><th>#</th><th>Nimi</th><th>Pisteet</th><th>Säätö</th>${colHeaders}</tr></thead>
          <tbody>${rows || '<tr><td colspan="4" class="empty">Ei osallistujia</td></tr>'}</tbody>
        </table>
      </div>
    </div>
    <div class="card">${addColHtml}</div>`;
}

// ---------- Events ----------
function renderEvents() {
  const { events, participants, teams, eventPoints, results, eventOverrides } = state;

  const cards = events.map(ev => {
    const isOpen = openEventId === ev.id;
    const pts = eventPoints.filter(p => p.event_id === ev.id).sort((a,b) => a.rank - b.rank);
    const evResults = results.filter(r => r.event_id === ev.id);
    const modeLabel = ev.mode === 'team' ? 'Tiimilaji' : 'Yksilölaji';
    const dirLabel = ev.sort_direction === 'asc' ? '↑ pienin voittaa' : '↓ suurin voittaa';
    const entrants = ev.mode === 'team' ? teams : participants;

    const pointsGrid = pts.map(p =>
      `<label>${p.rank}. sija</label><input type="number" inputmode="decimal" class="ep-input" data-eid="${ev.id}" data-rank="${p.rank}" value="${p.points}">`
    ).join('');

    const scoreRows = entrants.map(ent => {
      const res = evResults.find(r => r.entrant_id === ent.id);
      return `<div class="score-row">
        <span class="score-name">${esc(ent.name)}</span>
        <input type="number" inputmode="decimal" class="score-input score-entry" data-eid="${ev.id}" data-entrant-id="${ent.id}" data-entrant-type="${ev.mode === 'team' ? 'team' : 'participant'}" value="${res ? res.raw_score : ''" placeholder="—">
        ${res ? `<button class="btn-ghost btn-sm del-result-btn" data-eid="${ev.id}" data-type="${ev.mode === 'team' ? 'team' : 'participant'}" data-eid2="${ent.id}">✕</button>` : '<span style="width:42px"></span>'}
      </div>`;
    }).join('');

    const body = isOpen ? `
      <div class="event-body">
        <div class="section-title">Pistetaulukko</div>
        <div class="points-grid">${pointsGrid}</div>
        <button class="btn-ghost btn-sm save-points-btn" data-eid="${ev.id}">Tallenna pisteet</button>

        <div class="section-title" style="margin-top:16px">Tulokset <span class="chip">${modeLabel} · ${dirLabel}${ev.unit ? ' · ' + esc(ev.unit) : ''}</span></div>
        ${scoreRows}

        <div style="margin-top:12px;display:flex;gap:8px;flex-wrap:wrap">
          <button class="btn-${ev.status === 'completed' ? 'ghost' : 'success'} btn-sm toggle-status-btn" data-eid="${ev.id}" data-status="${ev.status}">
            ${ev.status === 'completed' ? 'Merkitse kesken' : 'Merkitse valmiiksi'}
          </button>
          <button class="btn-danger btn-sm del-event-btn" data-eid="${ev.id}">Poista laji</button>
        </div>
      </div>` : '';

    return `
      <div class="event-card">
        <div class="event-header toggle-event" data-eid="${ev.id}">
          <span class="event-name">${esc(ev.name)}</span>
          <span class="event-meta">${modeLabel}</span>
          <span class="event-status ${ev.status === 'completed' ? 'status-completed' : 'status-pending'}">${ev.status === 'completed' ? 'Valmis' : 'Kesken'}</span>
        </div>
        ${body}
      </div>`;
  }).join('') || '<div class="empty">Ei lajeja.</div>';

  const modeOptions = `<option value="individual">Yksilölaji</option><option value="team">Tiimilaji</option>`;
  const dirOptions = `<option value="desc">Suurin voittaa</option><option value="asc">Pienin voittaa</option>`;

  return `
    ${cards}
    <div class="card">
      <div class="card-title">Lisää laji</div>
      <div class="input-row"><input id="new-ev-name" type="text" placeholder="Lajin nimi"></div>
      <div class="input-row">
        <input id="new-ev-unit" type="text" placeholder="Yksikkö (esim. m, s, p)">
        <select id="new-ev-mode">${modeOptions}</select>
        <select id="new-ev-dir">${dirOptions}</select>
      </div>
      <button class="btn-primary" id="add-event-btn">+ Lisää laji</button>
    </div>`;
}

// ---------- Participants ----------
function renderParticipants() {
  const { participants } = state;
  const items = participants.map(p => `
    <div class="list-item">
      <span class="list-item-name">${esc(p.name)}</span>
      <div class="list-item-actions">
        <button class="btn-danger btn-sm del-participant-btn" data-pid="${p.id}">Poista</button>
      </div>
    </div>`).join('') || '<div class="empty">Ei osallistujia.</div>';

  return `
    <div class="card">
      <div class="card-title">Osallistujat</div>
      ${items}
      <div class="input-row" style="margin-top:12px">
        <input id="new-participant-name" type="text" placeholder="Nimi">
        <button class="btn-primary" id="add-participant-btn">+ Lisää</button>
      </div>
    </div>`;
}

// ---------- Teams ----------
function renderTeams() {
  const { teams, participants, teamMembers } = state;

  const teamCards = teams.map(t => {
    const memberIds = teamMembers.filter(tm => tm.team_id === t.id).map(tm => tm.participant_id);
    const members = participants.filter(p => memberIds.includes(p.id));
    const nonMembers = participants.filter(p => !memberIds.includes(p.id));

    const memberItems = members.map(p => `
      <div class="list-item">
        <span class="list-item-name">${esc(p.name)}</span>
        <button class="btn-ghost btn-sm remove-member-btn" data-tid="${t.id}" data-pid="${p.id}">Poista</button>
      </div>`).join('') || '<div class="empty">Tiimi tyhjä.</div>';

    const addOptions = nonMembers.map(p => `<option value="${p.id}">${esc(p.name)}</option>`).join('');

    return `
      <div class="card">
        <div style="display:flex;align-items:center;gap:8px;margin-bottom:10px">
          <span class="card-title" style="margin-bottom:0;flex:1">${esc(t.name)}</span>
          <button class="btn-danger btn-sm del-team-btn" data-tid="${t.id}">Poista tiimi</button>
        </div>
        ${memberItems}
        ${nonMembers.length ? `
          <div class="input-row" style="margin-top:10px">
            <select class="add-member-select" data-tid="${t.id}">${addOptions}</select>
            <button class="btn-ghost btn-sm add-member-btn" data-tid="${t.id}">+ Lisää</button>
          </div>` : ''}
      </div>`;
  }).join('') || '<div class="empty">Ei tiimejä.</div>';

  return `
    ${teamCards}
    <div class="card">
      <div class="input-row">
        <input id="new-team-name" type="text" placeholder="Tiimin nimi">
        <button class="btn-primary" id="add-team-btn">+ Luo tiimi</button>
      </div>
    </div>`;
}

// ---------- Event handlers ----------
document.addEventListener('click', async (e) => {
  try {
    const cid = currentComp?.id;

    // Toggle event open/close
    const toggleEl = e.target.closest('.toggle-event');
    if (toggleEl) {
      const eid = Number(toggleEl.dataset.eid);
      openEventId = openEventId === eid ? null : eid;
      render(); return;
    }

    // Save points
    if (e.target.classList.contains('save-points-btn')) {
      const eid = e.target.dataset.eid;
      const inputs = document.querySelectorAll(`.ep-input[data-eid="${eid}"]`);
      const pointsMap = {};
      inputs.forEach(inp => { pointsMap[inp.dataset.rank] = Number(inp.value) || 0; });
      await put(`/api/competitions/${cid}/events/${eid}/points`, { pointsMap });
      state = await get(`/api/competitions/${cid}/state`);
      toast('Pisteet tallennettu');
      render(); return;
    }

    // Toggle event status
    if (e.target.classList.contains('toggle-status-btn')) {
      const eid = e.target.dataset.eid;
      const newStatus = e.target.dataset.status === 'completed' ? 'pending' : 'completed';
      await put(`/api/competitions/${cid}/events/${eid}/status`, { status: newStatus });
      state = await get(`/api/competitions/${cid}/state`);
      render(); return;
    }

    // Delete event
    if (e.target.classList.contains('del-event-btn')) {
      if (!confirm('Poistetaanko laji?')) return;
      await del(`/api/competitions/${cid}/events/${e.target.dataset.eid}`);
      state = await get(`/api/competitions/${cid}/state`);
      openEventId = null;
      render(); return;
    }

    // Delete result
    if (e.target.classList.contains('del-result-btn')) {
      await del(`/api/competitions/${cid}/events/${e.target.dataset.eid}/results/${e.target.dataset.type}/${e.target.dataset.eid2}`);
      state = await get(`/api/competitions/${cid}/state`);
      render(); return;
    }

    // Add event
    if (e.target.id === 'add-event-btn') {
      const name = document.getElementById('new-ev-name').value.trim();
      if (!name) return;
      const unit = document.getElementById('new-ev-unit').value.trim();
      const mode = document.getElementById('new-ev-mode').value;
      const sort_direction = document.getElementById('new-ev-dir').value;
      await post(`/api/competitions/${cid}/events`, { name, unit, mode, sort_direction });
      state = await get(`/api/competitions/${cid}/state`);
      render(); return;
    }

    // Add participant
    if (e.target.id === 'add-participant-btn') {
      const name = document.getElementById('new-participant-name').value.trim();
      if (!name) return;
      await post(`/api/competitions/${cid}/participants`, { name });
      state = await get(`/api/competitions/${cid}/state`);
      render(); return;
    }

    // Delete participant
    if (e.target.classList.contains('del-participant-btn')) {
      if (!confirm('Poistetaanko osallistuja?')) return;
      await del(`/api/competitions/${cid}/participants/${e.target.dataset.pid}`);
      state = await get(`/api/competitions/${cid}/state`);
      render(); return;
    }

    // Add team
    if (e.target.id === 'add-team-btn') {
      const name = document.getElementById('new-team-name').value.trim();
      if (!name) return;
      await post(`/api/competitions/${cid}/teams`, { name });
      state = await get(`/api/competitions/${cid}/state`);
      render(); return;
    }

    // Delete team
    if (e.target.classList.contains('del-team-btn')) {
      if (!confirm('Poistetaanko tiimi?')) return;
      await del(`/api/competitions/${cid}/teams/${e.target.dataset.tid}`);
      state = await get(`/api/competitions/${cid}/state`);
      render(); return;
    }

    // Add member to team
    if (e.target.classList.contains('add-member-btn')) {
      const tid = e.target.dataset.tid;
      const select = document.querySelector(`.add-member-select[data-tid="${tid}"]`);
      if (!select?.value) return;
      await post(`/api/competitions/${cid}/teams/${tid}/members`, { participantId: Number(select.value) });
      state = await get(`/api/competitions/${cid}/state`);
      render(); return;
    }

    // Remove member from team
    if (e.target.classList.contains('remove-member-btn')) {
      await del(`/api/competitions/${cid}/teams/${e.target.dataset.tid}/members/${e.target.dataset.pid}`);
      state = await get(`/api/competitions/${cid}/state`);
      render(); return;
    }

    // Manual adjustment
    if (e.target.classList.contains('adj-btn')) {
      await post(`/api/competitions/${cid}/participants/${e.target.dataset.pid}/adjust`, { delta: Number(e.target.dataset.delta) });
      state = await get(`/api/competitions/${cid}/state`);
      render(); return;
    }

    // Delete custom column
    if (e.target.classList.contains('del-col-btn')) {
      if (!confirm('Poistetaanko sarake?')) return;
      await del(`/api/competitions/${cid}/custom-columns/${e.target.dataset.cid}`);
      state = await get(`/api/competitions/${cid}/state`);
      render(); return;
    }

    // Add custom column
    if (e.target.id === 'add-col-btn') {
      const name = document.getElementById('new-col-name').value.trim();
      if (!name) return;
      await post(`/api/competitions/${cid}/custom-columns`, { name });
      state = await get(`/api/competitions/${cid}/state`);
      render(); return;
    }

  } catch(err) { toast(err.message); }
});

// Save score on blur
document.addEventListener('blur', async (e) => {
  if (!e.target.classList.contains('score-entry')) return;
  const { eid, entrantId, entrantType } = e.target.dataset;
  const val = e.target.value.trim();
  if (val === '') return;
  try {
    await post(`/api/competitions/${currentComp.id}/events/${eid}/results`, {
      entrantType, entrantId: Number(entrantId), rawScore: Number(val)
    });
    state = await get(`/api/competitions/${currentComp.id}/state`);
    render();
  } catch(err) { toast(err.message); }
}, true);

// Save custom column value on blur
document.addEventListener('blur', async (e) => {
  if (!e.target.dataset.ccol) return;
  const { ccol, pid } = e.target.dataset;
  try {
    await put(`/api/competitions/${currentComp.id}/custom-columns/${ccol}/values/${pid}`, { value: e.target.value });
  } catch(err) { toast(err.message); }
}, true);

// ---------- Utils ----------
function esc(str) {
  return String(str ?? '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

// ---------- Boot ----------
(async () => {
  currentUser = await get('/api/me');
  if (currentUser) competitions = await get('/api/competitions');
  render();
})();
