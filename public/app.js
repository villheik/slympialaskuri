import { createApp, ref, computed, onMounted, onBeforeUnmount } from '/vendor/vue.js'

// ── API ──────────────────────────────────────────────────────────────────────
async function api(method, path, body) {
  const res = await fetch(path, {
    method,
    headers: body ? { 'Content-Type': 'application/json' } : {},
    body: body ? JSON.stringify(body) : undefined,
  })
  if (!res.ok) {
    const err = await res.json().catch(() => ({}))
    throw new Error(err.error || `HTTP ${res.status}`)
  }
  return res.json()
}
const get = p => api('GET', p)
const post = (p, b) => api('POST', p, b)
const put = (p, b) => api('PUT', p, b)
const del = p => api('DELETE', p)

// ── Main app ─────────────────────────────────────────────────────────────────
createApp({
  setup() {
    // ── Toast ──
    const toastMsg = ref('')
    const toastVisible = ref(false)
    let toastTimer = null
    function toast(msg) {
      toastMsg.value = msg; toastVisible.value = true
      clearTimeout(toastTimer)
      toastTimer = setTimeout(() => { toastVisible.value = false }, 2500)
    }

    // ── App state ──
    const currentUser = ref(null)
    const competitions = ref([])
    const currentComp = ref(null)
    const state = ref(null)
    const activeTab = ref('standings')
    const openEventId = ref(null)
    const sortCol = ref(null)
    const sortDir = ref('desc')
    const standingsOrder = ref(null)

    // ── Form refs ──
    const loginUsername = ref('')
    const newCompName = ref('')
    const newParticipantName = ref('')
    const newTeamName = ref('')
    const newColName = ref('')
    const newEvName = ref('')
    const newEvUnit = ref('')
    const newEvMode = ref('individual')
    const newEvDir = ref('desc')

    // ── Computed ──
    const sortedStandings = computed(() => {
      if (!state.value) return []
      const standings = state.value.standings
      if (sortCol.value) {
        const dir = sortDir.value === 'desc' ? 1 : -1
        const sorted = [...standings].sort((a, b) => {
          if (sortCol.value === 'total') return dir * (b.total - a.total)
          if (sortCol.value === 'individual') return dir * (b.individualPoints - a.individualPoints)
          const td = dir * (b.teamPoints - a.teamPoints)
          return td !== 0 ? td : b.individualPoints - a.individualPoints
        })
        standingsOrder.value = sorted.map(s => s.participantId)
        return sorted
      }
      if (standingsOrder.value) {
        const map = new Map(standings.map(s => [s.participantId, s]))
        const ordered = standingsOrder.value.map(id => map.get(id)).filter(Boolean)
        const known = new Set(standingsOrder.value)
        const result = [...ordered, ...standings.filter(s => !known.has(s.participantId))]
        standingsOrder.value = result.map(s => s.participantId)
        return result
      }
      standingsOrder.value = standings.map(s => s.participantId)
      return standings
    })

    const unassignedParticipants = computed(() => {
      if (!state.value) return []
      const assigned = new Set(state.value.teamMembers.map(tm => tm.participant_id))
      return state.value.participants.filter(p => !assigned.has(p.id))
    })

    // ── Helpers ──
    function sortIndicator(col) {
      if (sortCol.value !== col) return '↕'
      return sortDir.value === 'desc' ? '↓' : '↑'
    }
    function sortBy(col) {
      if (sortCol.value === col) sortDir.value = sortDir.value === 'desc' ? 'asc' : 'desc'
      else { sortCol.value = col; sortDir.value = 'desc' }
    }
    function teamMembersFor(teamId) {
      if (!state.value) return []
      const ids = new Set(state.value.teamMembers.filter(tm => tm.team_id === teamId).map(tm => tm.participant_id))
      return state.value.participants.filter(p => ids.has(p.id))
    }
    function customValueFor(colId, pid) {
      return state.value?.customValues?.find(v => v.column_id === colId && v.participant_id === pid)?.value ?? ''
    }
    function eventPointsFor(eid) {
      return (state.value?.eventPoints || []).filter(ep => ep.event_id === eid).sort((a, b) => a.rank - b.rank)
    }
    function resultFor(eid, entrantId) {
      return (state.value?.results || []).find(r => r.event_id === eid && r.entrant_id === entrantId)
    }
    function entrantsFor(ev) {
      if (!state.value) return []
      return ev.mode === 'team' ? state.value.teams : state.value.participants
    }
    function modeLabel(ev) { return ev.mode === 'team' ? 'Tiimilaji' : 'Yksilölaji' }
    function dirLabel(ev) { return ev.sort_direction === 'asc' ? '↑ pienin voittaa' : '↓ suurin voittaa' }

    // ── API actions ──
    async function loadState() {
      state.value = await get(`/api/competitions/${currentComp.value.id}/state`)
    }

    async function openComp(comp) {
      currentComp.value = comp
      await loadState()
      activeTab.value = 'standings'
      openEventId.value = null
      standingsOrder.value = null
      sortCol.value = null
      sortDir.value = 'desc'
    }

    async function doLogin() {
      if (!loginUsername.value.trim()) return
      try {
        currentUser.value = await post('/api/login', { username: loginUsername.value.trim() })
        competitions.value = await get('/api/competitions')
      } catch(e) { toast(e.message) }
    }

    async function doLogout() {
      await post('/api/logout')
      currentUser.value = null; currentComp.value = null; state.value = null
    }

    async function createComp() {
      if (!newCompName.value.trim()) return
      try {
        const c = await post('/api/competitions', { name: newCompName.value.trim() })
        competitions.value.unshift({ ...c, created_at: new Date().toISOString() })
        newCompName.value = ''
        await openComp(competitions.value[0])
      } catch(e) { toast(e.message) }
    }

    async function addParticipant() {
      if (!newParticipantName.value.trim()) return
      try {
        await post(`/api/competitions/${currentComp.value.id}/participants`, { name: newParticipantName.value.trim() })
        newParticipantName.value = ''
        await loadState()
      } catch(e) { toast(e.message) }
    }

    async function deleteParticipant(pid) {
      if (!confirm('Poistetaanko osallistuja?')) return
      try { await del(`/api/competitions/${currentComp.value.id}/participants/${pid}`); await loadState() }
      catch(e) { toast(e.message) }
    }

    async function addTeam() {
      if (!newTeamName.value.trim()) return
      try {
        await post(`/api/competitions/${currentComp.value.id}/teams`, { name: newTeamName.value.trim() })
        newTeamName.value = ''
        await loadState()
      } catch(e) { toast(e.message) }
    }

    async function deleteTeam(tid) {
      if (!confirm('Poistetaanko tiimi?')) return
      try { await del(`/api/competitions/${currentComp.value.id}/teams/${tid}`); await loadState() }
      catch(e) { toast(e.message) }
    }

    async function moveMember(pid, targetTeamId) {
      try {
        const cid = currentComp.value.id
        const cur = state.value.teamMembers.find(tm => tm.participant_id === Number(pid))
        if (cur) await del(`/api/competitions/${cid}/teams/${cur.team_id}/members/${pid}`)
        if (targetTeamId !== 'unassigned') {
          await post(`/api/competitions/${cid}/teams/${targetTeamId}/members`, { participantId: Number(pid) })
        }
        await loadState()
      } catch(e) { toast(e.message) }
    }

    async function addEvent() {
      if (!newEvName.value.trim()) return
      try {
        await post(`/api/competitions/${currentComp.value.id}/events`, {
          name: newEvName.value.trim(),
          unit: newEvUnit.value.trim() || null,
          mode: newEvMode.value,
          sort_direction: newEvDir.value,
        })
        newEvName.value = ''; newEvUnit.value = ''
        await loadState()
      } catch(e) { toast(e.message) }
    }

    async function deleteEvent(eid) {
      if (!confirm('Poistetaanko laji?')) return
      try {
        await del(`/api/competitions/${currentComp.value.id}/events/${eid}`)
        openEventId.value = null
        await loadState()
      } catch(e) { toast(e.message) }
    }

    async function toggleStatus(ev) {
      try {
        await put(`/api/competitions/${currentComp.value.id}/events/${ev.id}/status`,
          { status: ev.status === 'completed' ? 'pending' : 'completed' })
        await loadState()
      } catch(e) { toast(e.message) }
    }

    async function saveScore(eid, entrantId, entrantType, value) {
      if (value === '') return
      try {
        await post(`/api/competitions/${currentComp.value.id}/events/${eid}/results`,
          { entrantType, entrantId: Number(entrantId), rawScore: Number(value) })
        await loadState()
      } catch(e) { toast(e.message) }
    }

    async function deleteResult(eid, entrantType, entrantId) {
      try {
        await del(`/api/competitions/${currentComp.value.id}/events/${eid}/results/${entrantType}/${entrantId}`)
        await loadState()
      } catch(e) { toast(e.message) }
    }

    async function savePoints(eid) {
      const inputs = document.querySelectorAll(`.ep-input[data-eid="${eid}"]`)
      const pointsMap = {}
      inputs.forEach(inp => { pointsMap[inp.dataset.rank] = Number(inp.value) || 0 })
      try {
        await put(`/api/competitions/${currentComp.value.id}/events/${eid}/points`, { pointsMap })
        toast('Pisteet tallennettu')
        await loadState()
      } catch(e) { toast(e.message) }
    }

    async function adjust(pid, delta) {
      try {
        await post(`/api/competitions/${currentComp.value.id}/participants/${pid}/adjust`, { delta })
        await loadState()
      } catch(e) { toast(e.message) }
    }

    async function addCustomColumn() {
      if (!newColName.value.trim()) return
      try {
        await post(`/api/competitions/${currentComp.value.id}/custom-columns`, { name: newColName.value.trim() })
        newColName.value = ''
        await loadState()
      } catch(e) { toast(e.message) }
    }

    async function deleteCustomColumn(cid) {
      if (!confirm('Poistetaanko sarake?')) return
      try { await del(`/api/competitions/${currentComp.value.id}/custom-columns/${cid}`); await loadState() }
      catch(e) { toast(e.message) }
    }

    async function saveCustomValue(colId, pid, value) {
      try {
        await put(`/api/competitions/${currentComp.value.id}/custom-columns/${colId}/values/${pid}`, { value })
      } catch(e) { toast(e.message) }
    }

    // ── Drag & drop ──
    let dragGhost = null, dragPid = null, dragSrc = null

    function onPointerDown(e) {
      const chip = e.target.closest('.draggable')
      if (!chip) return
      e.preventDefault()
      dragPid = chip.dataset.pid; dragSrc = chip
      const rect = chip.getBoundingClientRect()
      dragGhost = chip.cloneNode(true)
      dragGhost.classList.add('drag-ghost')
      Object.assign(dragGhost.style, {
        position: 'fixed', left: rect.left + 'px', top: rect.top + 'px',
        width: rect.width + 'px', pointerEvents: 'none', zIndex: '1000',
      })
      document.body.appendChild(dragGhost)
      chip.style.opacity = '0.3'
      chip.setPointerCapture(e.pointerId)
    }

    function onPointerMove(e) {
      if (!dragGhost) return
      dragGhost.style.left = (e.clientX - 16) + 'px'
      dragGhost.style.top = (e.clientY - 16) + 'px'
      document.querySelectorAll('.drop-zone').forEach(z => z.classList.remove('drag-over'))
      document.elementFromPoint(e.clientX, e.clientY)?.closest('.drop-zone')?.classList.add('drag-over')
    }

    async function onPointerUp(e) {
      if (!dragGhost) return
      dragGhost.remove(); dragGhost = null
      if (dragSrc) { dragSrc.style.opacity = ''; dragSrc = null }
      document.querySelectorAll('.drop-zone').forEach(z => z.classList.remove('drag-over'))
      const zone = document.elementFromPoint(e.clientX, e.clientY)?.closest('.drop-zone')
      if (zone && dragPid) await moveMember(dragPid, zone.dataset.teamId)
      dragPid = null
    }

    onMounted(async () => {
      currentUser.value = await get('/api/me')
      if (currentUser.value) competitions.value = await get('/api/competitions')
      document.addEventListener('pointerdown', onPointerDown, { passive: false })
      document.addEventListener('pointermove', onPointerMove)
      document.addEventListener('pointerup', onPointerUp)
    })

    onBeforeUnmount(() => {
      document.removeEventListener('pointerdown', onPointerDown)
      document.removeEventListener('pointermove', onPointerMove)
      document.removeEventListener('pointerup', onPointerUp)
    })

    return {
      toastMsg, toastVisible,
      currentUser, competitions, currentComp, state, activeTab, openEventId,
      sortedStandings, unassignedParticipants,
      sortCol, sortDir, sortBy, sortIndicator,
      loginUsername, newCompName, newParticipantName, newTeamName, newColName,
      newEvName, newEvUnit, newEvMode, newEvDir,
      teamMembersFor, customValueFor, eventPointsFor, resultFor, entrantsFor,
      modeLabel, dirLabel,
      openComp, doLogin, doLogout, createComp,
      addParticipant, deleteParticipant,
      addTeam, deleteTeam,
      addEvent, deleteEvent, toggleStatus, saveScore, deleteResult, savePoints,
      adjust, addCustomColumn, deleteCustomColumn, saveCustomValue,
    }
  },

  template: `
    <div>
      <div class="toast" :class="{ show: toastVisible }">{{ toastMsg }}</div>

      <!-- LOGIN -->
      <template v-if="!currentUser">
        <div class="login-wrap card">
          <h1>Slympialaskuri</h1>
          <p>Kirjaudu käyttäjänimellä jatkaaksesi.</p>
          <input v-model="loginUsername" type="text" placeholder="Käyttäjänimi"
            autocomplete="off" style="margin-bottom:12px" @keyup.enter="doLogin">
          <button class="btn-primary btn-block" @click="doLogin">Kirjaudu</button>
        </div>
      </template>

      <!-- COMPETITION LIST -->
      <template v-else-if="!currentComp">
        <div class="app-header">
          <h1>Slympialaskuri</h1>
          <div class="user-info">
            <span>{{ currentUser.username }}</span>
            <button class="btn-ghost btn-sm" @click="doLogout">Kirjaudu ulos</button>
          </div>
        </div>
        <div v-if="!competitions.length" class="empty">Ei kisoja. Luo ensimmäinen!</div>
        <div v-for="c in competitions" :key="c.id" class="comp-item" @click="openComp(c)">
          <span class="comp-item-name">{{ c.name }}</span>
          <span class="comp-item-date">{{ c.created_at.slice(0,10) }}</span>
        </div>
        <div class="card">
          <div class="card-title">Uusi kisa</div>
          <div class="input-row">
            <input v-model="newCompName" type="text" placeholder="Kisan nimi" @keyup.enter="createComp">
            <button class="btn-primary" @click="createComp">Luo</button>
          </div>
        </div>
      </template>

      <!-- COMPETITION VIEW -->
      <template v-else-if="state">
        <div class="app-header">
          <div>
            <button class="btn-ghost btn-sm" @click="currentComp = null; state = null">← Kisat</button>
            <h1 style="display:inline;margin-left:8px">{{ currentComp.name }}</h1>
          </div>
          <div class="user-info">
            <span>{{ currentUser.username }}</span>
            <button class="btn-ghost btn-sm" @click="doLogout">Kirjaudu ulos</button>
          </div>
        </div>

        <div class="tabs">
          <button v-for="tab in [{id:'standings',label:'Kokonaiskilpailu'},{id:'events',label:'Lajit'},{id:'participants',label:'Osallistujat'},{id:'teams',label:'Tiimit'}]"
            :key="tab.id" class="tab" :class="{ active: activeTab === tab.id }"
            @click="activeTab = tab.id; openEventId = null">{{ tab.label }}</button>
        </div>

        <!-- STANDINGS -->
        <template v-if="activeTab === 'standings'">
          <div class="card">
            <div class="card-title">Kokonaispisteet</div>
            <div class="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>#</th>
                    <th>Nimi</th>
                    <th class="sortable" @click="sortBy('total')">Yht. {{ sortIndicator('total') }}</th>
                    <th class="sortable" @click="sortBy('individual')">Yksilöp. {{ sortIndicator('individual') }}</th>
                    <th>Tiimi</th>
                    <th class="sortable" @click="sortBy('team')">Tiimipit. {{ sortIndicator('team') }}</th>
                    <th v-for="col in state.customColumns" :key="col.id">{{ col.name }}</th>
                  </tr>
                </thead>
                <tbody>
                  <tr v-if="!sortedStandings.length">
                    <td :colspan="7 + state.customColumns.length" class="empty">Ei osallistujia</td>
                  </tr>
                  <tr v-for="(s, i) in sortedStandings" :key="s.participantId">
                    <td class="rank-col">{{ i + 1 }}</td>
                    <td>{{ s.name }}</td>
                    <td class="points-col total-col">{{ s.total }}</td>
                    <td class="points-col">{{ s.individualPoints }}</td>
                    <td>{{ s.teamName ?? '—' }}</td>
                    <td class="points-col">{{ s.teamPoints }}</td>
                    <td v-for="col in state.customColumns" :key="col.id">
                      <input class="score-input" style="width:80px"
                        :value="customValueFor(col.id, s.participantId)"
                        placeholder="—"
                        @blur="saveCustomValue(col.id, s.participantId, $event.target.value)">
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>
          </div>
          <div v-if="sortedStandings.length" class="card">
            <div v-for="s in sortedStandings" :key="s.participantId" class="adj-row">
              <span class="adj-name">{{ s.name }}</span>
              <button class="btn-ghost btn-icon btn-sm" @click="adjust(s.participantId, -1)">−</button>
              <span class="adj-val">{{ (s.adjustment >= 0 ? '+' : '') + s.adjustment }}</span>
              <button class="btn-ghost btn-icon btn-sm" @click="adjust(s.participantId, 1)">+</button>
            </div>
          </div>
          <div class="card">
            <div class="section-title">Lisäsarakkeet</div>
            <div class="input-row">
              <input v-model="newColName" type="text" placeholder="Sarakkeen nimi">
              <button class="btn-ghost btn-sm" @click="addCustomColumn">+ Lisää</button>
            </div>
            <div v-for="col in state.customColumns" :key="col.id" class="list-item">
              <span class="list-item-name">{{ col.name }}</span>
              <button class="btn-danger btn-sm" @click="deleteCustomColumn(col.id)">Poista</button>
            </div>
          </div>
        </template>

        <!-- EVENTS -->
        <template v-if="activeTab === 'events'">
          <div v-if="!state.events.length" class="empty">Ei lajeja.</div>
          <div v-for="ev in state.events" :key="ev.id" class="event-card">
            <div class="event-header" @click="openEventId = openEventId === ev.id ? null : ev.id">
              <span class="event-name">{{ ev.name }}</span>
              <span class="event-meta">{{ modeLabel(ev) }}</span>
              <span class="event-status" :class="ev.status === 'completed' ? 'status-completed' : 'status-pending'">
                {{ ev.status === 'completed' ? 'Valmis' : 'Kesken' }}
              </span>
            </div>
            <div v-if="openEventId === ev.id" class="event-body">
              <div class="section-title">Pistetaulukko</div>
              <div class="points-grid">
                <template v-for="ep in eventPointsFor(ev.id)" :key="ep.rank">
                  <label>{{ ep.rank }}. sija</label>
                  <input type="number" inputmode="decimal"
                    class="ep-input" :data-eid="ev.id" :data-rank="ep.rank" :value="ep.points">
                </template>
              </div>
              <button class="btn-ghost btn-sm" @click="savePoints(ev.id)">Tallenna pisteet</button>

              <div class="section-title" style="margin-top:16px">
                Tulokset
                <span class="chip">{{ modeLabel(ev) }} · {{ dirLabel(ev) }}{{ ev.unit ? ' · ' + ev.unit : '' }}</span>
              </div>
              <div v-for="ent in entrantsFor(ev)" :key="ent.id" class="score-row">
                <span class="score-name">{{ ent.name }}</span>
                <input type="number" inputmode="decimal" class="score-input"
                  :value="resultFor(ev.id, ent.id)?.raw_score ?? ''"
                  placeholder="—"
                  @blur="saveScore(ev.id, ent.id, ev.mode === 'team' ? 'team' : 'participant', $event.target.value)">
                <button v-if="resultFor(ev.id, ent.id)" class="btn-ghost btn-sm"
                  @click="deleteResult(ev.id, ev.mode === 'team' ? 'team' : 'participant', ent.id)">✕</button>
                <span v-else style="width:42px"></span>
              </div>

              <div style="margin-top:12px;display:flex;gap:8px;flex-wrap:wrap">
                <button :class="ev.status === 'completed' ? 'btn-ghost btn-sm' : 'btn-success btn-sm'"
                  @click="toggleStatus(ev)">
                  {{ ev.status === 'completed' ? 'Merkitse kesken' : 'Merkitse valmiiksi' }}
                </button>
                <button class="btn-danger btn-sm" @click="deleteEvent(ev.id)">Poista laji</button>
              </div>
            </div>
          </div>
          <div class="card">
            <div class="card-title">Lisää laji</div>
            <div class="input-row">
              <input v-model="newEvName" type="text" placeholder="Lajin nimi">
            </div>
            <div class="input-row">
              <input v-model="newEvUnit" type="text" placeholder="Yksikkö (esim. m, s, p)">
              <select v-model="newEvMode">
                <option value="individual">Yksilölaji</option>
                <option value="team">Tiimilaji</option>
              </select>
              <select v-model="newEvDir">
                <option value="desc">Suurin voittaa</option>
                <option value="asc">Pienin voittaa</option>
              </select>
            </div>
            <button class="btn-primary" @click="addEvent">+ Lisää laji</button>
          </div>
        </template>

        <!-- PARTICIPANTS -->
        <template v-if="activeTab === 'participants'">
          <div class="card">
            <div class="card-title">Osallistujat</div>
            <div v-if="!state.participants.length" class="empty">Ei osallistujia.</div>
            <div v-for="p in state.participants" :key="p.id" class="list-item">
              <span class="list-item-name">{{ p.name }}</span>
              <button class="btn-danger btn-sm" @click="deleteParticipant(p.id)">Poista</button>
            </div>
            <div class="input-row" style="margin-top:12px">
              <input v-model="newParticipantName" type="text" placeholder="Nimi" @keyup.enter="addParticipant">
              <button class="btn-primary" @click="addParticipant">+ Lisää</button>
            </div>
          </div>
        </template>

        <!-- TEAMS -->
        <template v-if="activeTab === 'teams'">
          <div class="card">
            <div class="card-title">Ei tiimissä</div>
            <div class="drop-zone chip-zone" data-team-id="unassigned">
              <span v-if="!unassignedParticipants.length" class="empty" style="font-size:13px;padding:4px 0">Kaikki jaettu</span>
              <div v-for="p in unassignedParticipants" :key="p.id"
                class="participant-chip draggable" :data-pid="p.id">{{ p.name }}</div>
            </div>
          </div>
          <div v-if="state.teams.length" class="teams-grid">
            <div v-for="t in state.teams" :key="t.id" class="team-card drop-zone" :data-team-id="t.id">
              <div class="team-card-header">
                <span>{{ t.name }}</span>
                <button class="btn-danger btn-sm" style="padding:2px 7px" @click="deleteTeam(t.id)">✕</button>
              </div>
              <div class="chip-zone">
                <span v-if="!teamMembersFor(t.id).length" class="empty" style="font-size:13px;padding:4px 0">Tyhjä</span>
                <div v-for="p in teamMembersFor(t.id)" :key="p.id"
                  class="participant-chip draggable" :data-pid="p.id">{{ p.name }}</div>
              </div>
            </div>
          </div>
          <div v-else class="empty">Luo ensin tiimit.</div>
          <div class="card">
            <div class="input-row">
              <input v-model="newTeamName" type="text" placeholder="Tiimin nimi" @keyup.enter="addTeam">
              <button class="btn-primary" @click="addTeam">+ Luo tiimi</button>
            </div>
          </div>
        </template>
      </template>
    </div>
  `,
}).mount('#app')
