import { createApp, ref, computed, reactive, watch, nextTick, onMounted, onBeforeUnmount } from '/vendor/vue.js'

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

// ── Column definitions ────────────────────────────────────────────────────────
const COL_LABELS = { team: 'Tiimi', teamPts: 'Tiimipit.', individual: 'Yksilöp.', total: 'Yht.' }
const SORTABLE_COLS = new Set(['total', 'individual', 'teamPts'])
const DEFAULT_COL_ORDER = ['team', 'teamPts', 'individual', 'total']

// ── App ──────────────────────────────────────────────────────────────────────
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
    const columnOrder = ref([...DEFAULT_COL_ORDER])

    // ── Spacer height for +/- column alignment ──
    const standingsCardRef = ref(null)
    const standingsTheadRef = ref(null)
    const adjSpacerHeight = ref(88)

    function measureAdjSpacer() {
      nextTick(() => {
        if (!standingsCardRef.value || !standingsTheadRef.value) return
        const cardTop = standingsCardRef.value.getBoundingClientRect().top
        const theadBottom = standingsTheadRef.value.getBoundingClientRect().bottom
        adjSpacerHeight.value = theadBottom - cardTop
      })
    }

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
    const newEvPoints = ref([3, 2, 1])

    // ── Sync custom columns into columnOrder ──
    watch(() => state.value?.customColumns, (cols) => {
      if (!cols) return
      const customIds = cols.map(c => `col_${c.id}`)
      const existing = new Set(columnOrder.value)
      const toAdd = customIds.filter(id => !existing.has(id))
      if (toAdd.length) columnOrder.value = [...columnOrder.value, ...toAdd]
      const activeSet = new Set(customIds)
      columnOrder.value = columnOrder.value.filter(id => !id.startsWith('col_') || activeSet.has(id))
    }, { deep: true })

    // ── Computed ──
    const sortedStandings = computed(() => {
      if (!state.value) return []
      const standings = state.value.standings
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

    watch(sortedStandings, measureAdjSpacer)

    const unassignedParticipants = computed(() => {
      if (!state.value) return []
      const assigned = new Set(state.value.teamMembers.map(tm => tm.participant_id))
      return state.value.participants.filter(p => !assigned.has(p.id))
    })

    const pendingEvents = computed(() => (state.value?.events || []).filter(ev => ev.status === 'pending'))
    const completedEvents = computed(() => (state.value?.events || []).filter(ev => ev.status === 'completed'))

    const editValues = reactive({ name: '', unit: '', mode: 'individual', sort_direction: 'desc' })

    function openEvent(evId) {
      openEventId.value = openEventId.value === evId ? null : evId
      if (openEventId.value) {
        const ev = state.value?.events.find(e => e.id === evId)
        if (ev) { editValues.name = ev.name; editValues.unit = ev.unit ?? ''; editValues.mode = ev.mode; editValues.sort_direction = ev.sort_direction }
      }
    }

    async function saveEventEdit(eid) {
      try {
        await put(`/api/competitions/${currentComp.value.id}/events/${eid}`, {
          name: editValues.name.trim() || undefined,
          unit: editValues.unit.trim() || null,
          mode: editValues.mode,
          sort_direction: editValues.sort_direction,
        })
        toast('Tallennettu')
        await loadState()
      } catch(e) { toast(e.message) }
    }

    // ── Helpers ──
    function colLabel(colId) {
      if (COL_LABELS[colId]) return COL_LABELS[colId]
      const id = parseInt(colId.slice(4))
      return state.value?.customColumns?.find(c => c.id === id)?.name ?? colId
    }
    function isSortableCol(colId) { return SORTABLE_COLS.has(colId) }

    function sortIndicator(col) {
      if (sortCol.value !== col) return '↕'
      return sortDir.value === 'desc' ? '↓' : '↑'
    }
    function sortBy(col) {
      if (sortCol.value === col) sortDir.value = sortDir.value === 'desc' ? 'asc' : 'desc'
      else { sortCol.value = col; sortDir.value = 'desc' }
      const standings = state.value?.standings
      if (!standings) return
      const dir = sortDir.value === 'desc' ? 1 : -1
      const sorted = [...standings].sort((a, b) => {
        if (col === 'total') return dir * (b.total - a.total)
        if (col === 'individual') return dir * (b.individualPoints - a.individualPoints)
        if (col === 'teamPts') {
          const td = dir * (b.teamPoints - a.teamPoints)
          return td !== 0 ? td : b.individualPoints - a.individualPoints
        }
        return 0
      })
      standingsOrder.value = sorted.map(s => s.participantId)
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

    function cellValue(colId, s) {
      if (colId === 'team') return s.teamName ?? '—'
      if (colId === 'teamPts') return s.teamPoints
      if (colId === 'individual') return s.individualPoints
      if (colId === 'total') return s.total
      return null
    }

    function switchTab(id) {
      activeTab.value = id
      if (id === 'suorita') {
        const first = state.value?.events.find(ev => ev.status === 'pending')
        openEventId.value = first?.id ?? null
      } else {
        openEventId.value = null
      }
      if (id === 'standings') nextTick(measureAdjSpacer)
    }

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
      columnOrder.value = [...DEFAULT_COL_ORDER]
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
        const cid = currentComp.value.id
        const ev = await post(`/api/competitions/${cid}/events`, {
          name: newEvName.value.trim(),
          unit: newEvUnit.value.trim() || null,
          mode: newEvMode.value,
          sort_direction: newEvDir.value,
        })
        if (newEvPoints.value.length > 0) {
          const pointsMap = {}
          newEvPoints.value.forEach((pts, i) => { pointsMap[i + 1] = pts })
          await put(`/api/competitions/${cid}/events/${ev.id}/points`, { pointsMap })
        }
        newEvName.value = ''; newEvUnit.value = ''
        newEvPoints.value = [3, 2, 1]
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

    async function completeAndAdvance(ev) {
      try {
        await put(`/api/competitions/${currentComp.value.id}/events/${ev.id}/status`, { status: 'completed' })
        await loadState()
        const next = state.value.events.find(e => e.status === 'pending')
        openEventId.value = next?.id ?? null
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

    // ── Participant chip drag & drop ──────────────────────────────────────────
    let chipGhost = null, dragPid = null, chipSrc = null

    function onChipPointerDown(e, chip) {
      e.preventDefault()
      dragPid = chip.dataset.pid; chipSrc = chip
      const rect = chip.getBoundingClientRect()
      chipGhost = chip.cloneNode(true)
      chipGhost.classList.add('drag-ghost')
      Object.assign(chipGhost.style, {
        position: 'fixed', left: rect.left + 'px', top: rect.top + 'px',
        width: rect.width + 'px', pointerEvents: 'none', zIndex: '1000',
      })
      document.body.appendChild(chipGhost)
      chip.style.opacity = '0.3'
      chip.setPointerCapture(e.pointerId)
    }

    // ── Column drag & drop ────────────────────────────────────────────────────
    let colGhost = null, dragColId = null, colSrc = null, colDropTarget = null

    function onColPointerDown(e, th) {
      e.preventDefault()
      dragColId = th.dataset.colId; colSrc = th
      const rect = th.getBoundingClientRect()
      colGhost = document.createElement('div')
      colGhost.className = 'col-drag-ghost'
      colGhost.textContent = th.textContent.trim().replace(/[↕↓↑]/, '').trim()
      Object.assign(colGhost.style, {
        position: 'fixed', left: rect.left + 'px', top: rect.top + 'px',
        width: rect.width + 'px', pointerEvents: 'none', zIndex: '1000',
      })
      document.body.appendChild(colGhost)
      th.style.opacity = '0.3'
      th.setPointerCapture(e.pointerId)
    }

    // ── Unified pointer handlers ──────────────────────────────────────────────
    function onPointerDown(e) {
      const chip = e.target.closest('.draggable')
      if (chip) { onChipPointerDown(e, chip); return }
      const col = e.target.closest('.col-draggable')
      if (col) { onColPointerDown(e, col); return }
    }

    function onPointerMove(e) {
      if (chipGhost) {
        chipGhost.style.left = (e.clientX - 16) + 'px'
        chipGhost.style.top = (e.clientY - 16) + 'px'
        document.querySelectorAll('.drop-zone').forEach(z => z.classList.remove('drag-over'))
        document.elementFromPoint(e.clientX, e.clientY)?.closest('.drop-zone')?.classList.add('drag-over')
      }
      if (colGhost) {
        colGhost.style.left = (e.clientX - colGhost.offsetWidth / 2) + 'px'
        colGhost.style.top = (e.clientY - 10) + 'px'
        document.querySelectorAll('.col-draggable').forEach(th => th.classList.remove('col-drag-over'))
        const under = document.elementFromPoint(e.clientX, e.clientY)?.closest('.col-draggable')
        if (under && under.dataset.colId !== dragColId) {
          under.classList.add('col-drag-over')
          colDropTarget = under.dataset.colId
        } else {
          colDropTarget = null
        }
      }
    }

    async function onPointerUp(e) {
      if (chipGhost) {
        chipGhost.remove(); chipGhost = null
        if (chipSrc) { chipSrc.style.opacity = ''; chipSrc = null }
        document.querySelectorAll('.drop-zone').forEach(z => z.classList.remove('drag-over'))
        const zone = document.elementFromPoint(e.clientX, e.clientY)?.closest('.drop-zone')
        if (zone && dragPid) await moveMember(dragPid, zone.dataset.teamId)
        dragPid = null
      }
      if (colGhost) {
        colGhost.remove(); colGhost = null
        if (colSrc) { colSrc.style.opacity = ''; colSrc = null }
        document.querySelectorAll('.col-draggable').forEach(th => th.classList.remove('col-drag-over'))
        if (colDropTarget && colDropTarget !== dragColId) {
          const from = columnOrder.value.indexOf(dragColId)
          const to = columnOrder.value.indexOf(colDropTarget)
          if (from !== -1 && to !== -1) {
            const order = [...columnOrder.value]
            order.splice(from, 1)
            order.splice(to, 0, dragColId)
            columnOrder.value = order
          }
        }
        dragColId = null; colDropTarget = null
      }
    }

    function onPointerCancel() {
      if (chipGhost) {
        chipGhost.remove(); chipGhost = null
        if (chipSrc) { chipSrc.style.opacity = ''; chipSrc = null }
        document.querySelectorAll('.drop-zone').forEach(z => z.classList.remove('drag-over'))
        dragPid = null
      }
      if (colGhost) {
        colGhost.remove(); colGhost = null
        if (colSrc) { colSrc.style.opacity = ''; colSrc = null }
        document.querySelectorAll('.col-draggable').forEach(th => th.classList.remove('col-drag-over'))
        dragColId = null; colDropTarget = null
      }
    }

    onMounted(async () => {
      currentUser.value = await get('/api/me')
      if (currentUser.value) competitions.value = await get('/api/competitions')
      document.addEventListener('pointerdown', onPointerDown, { passive: false })
      document.addEventListener('pointermove', onPointerMove)
      document.addEventListener('pointerup', onPointerUp)
      document.addEventListener('pointercancel', onPointerCancel)
    })

    onBeforeUnmount(() => {
      document.removeEventListener('pointerdown', onPointerDown)
      document.removeEventListener('pointermove', onPointerMove)
      document.removeEventListener('pointerup', onPointerUp)
      document.removeEventListener('pointercancel', onPointerCancel)
    })

    return {
      toastMsg, toastVisible,
      currentUser, competitions, currentComp, state, activeTab, openEventId,
      sortedStandings, unassignedParticipants, pendingEvents, completedEvents,
      sortCol, sortDir, columnOrder, adjSpacerHeight,
      standingsCardRef, standingsTheadRef,
      loginUsername, newCompName, newParticipantName, newTeamName, newColName,
      newEvName, newEvUnit, newEvMode, newEvDir, newEvPoints,
      colLabel, isSortableCol, cellValue,
      sortBy, sortIndicator, teamMembersFor, customValueFor,
      eventPointsFor, resultFor, entrantsFor, modeLabel, dirLabel,
      editValues, openEvent, saveEventEdit,
      openComp, doLogin, doLogout, createComp, switchTab,
      addParticipant, deleteParticipant,
      addTeam, deleteTeam,
      addEvent, deleteEvent, toggleStatus, completeAndAdvance, saveScore, deleteResult, savePoints,
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
            @click="switchTab(tab.id)">{{ tab.label }}</button>
          <button class="tab tab-suorita" :class="{ active: activeTab === 'suorita' }"
            @click="switchTab('suorita')">Suorita kisat</button>
        </div>

        <!-- STANDINGS -->
        <template v-if="activeTab === 'standings'">
          <div v-if="pendingEvents.length" style="margin-bottom:16px">
            <button class="btn-success btn-block" style="padding:16px;font-size:1.05rem;font-weight:700"
              @click="switchTab('suorita')">Aloita kisat →</button>
          </div>

          <div class="standings-outer">
            <div class="card standings-card" ref="standingsCardRef">
              <div class="card-title">Kokonaispisteet</div>
              <div class="table-wrap">
                <table>
                  <thead ref="standingsTheadRef">
                    <tr>
                      <th style="width:2rem">#</th>
                      <th>Nimi</th>
                      <th v-for="colId in columnOrder" :key="colId"
                        class="col-draggable"
                        :class="{ sortable: isSortableCol(colId), 'col-drag-over': false }"
                        :data-col-id="colId"
                        @click="isSortableCol(colId) ? sortBy(colId) : null">
                        {{ colLabel(colId) }}<template v-if="isSortableCol(colId)"> {{ sortIndicator(colId) }}</template>
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr v-if="!sortedStandings.length">
                      <td :colspan="2 + columnOrder.length" class="empty">Ei osallistujia</td>
                    </tr>
                    <tr v-for="(s, i) in sortedStandings" :key="s.participantId">
                      <td class="rank-col">{{ i + 1 }}</td>
                      <td>{{ s.name }}</td>
                      <td v-for="colId in columnOrder" :key="colId"
                        :class="{ 'points-col': ['teamPts','individual'].includes(colId), 'total-col': colId === 'total' }">
                        <template v-if="colId.startsWith('col_')">
                          <input class="score-input" style="width:80px"
                            :value="customValueFor(parseInt(colId.slice(4)), s.participantId)"
                            placeholder="—"
                            @blur="saveCustomValue(parseInt(colId.slice(4)), s.participantId, $event.target.value)">
                        </template>
                        <template v-else>{{ cellValue(colId, s) }}</template>
                      </td>
                    </tr>
                  </tbody>
                </table>
              </div>
            </div>

            <!-- +/- outside the card -->
            <div class="standings-adj-col" v-if="sortedStandings.length">
              <div :style="{ height: adjSpacerHeight + 'px' }"></div>
              <div v-for="s in sortedStandings" :key="s.participantId" class="standings-adj-row">
                <button class="adj-out-btn" @click="adjust(s.participantId, 1)">+</button>
                <button class="adj-out-btn" @click="adjust(s.participantId, -1)">−</button>
              </div>
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

        <!-- SUORITA -->
        <template v-if="activeTab === 'suorita'">
          <div v-if="!state.events.length" class="empty">Lisää ensin lajit Lajit-välilehdellä.</div>

          <div v-for="ev in pendingEvents" :key="ev.id" class="event-card">
            <div class="event-header" @click="openEventId = openEventId === ev.id ? null : ev.id">
              <span class="event-name">{{ ev.name }}</span>
              <span class="event-meta">{{ modeLabel(ev) }}{{ ev.unit ? ' · ' + ev.unit : '' }}</span>
              <span class="event-status status-pending">Kesken</span>
            </div>
            <div v-if="openEventId === ev.id" class="event-body">
              <div v-for="ent in entrantsFor(ev)" :key="ent.id" class="exec-score-row">
                <span class="exec-score-name">{{ ent.name }}</span>
                <input type="number" inputmode="decimal" class="score-input exec-score-input"
                  :value="resultFor(ev.id, ent.id)?.raw_score ?? ''"
                  placeholder="—"
                  @blur="saveScore(ev.id, ent.id, ev.mode === 'team' ? 'team' : 'participant', $event.target.value)">
                <span class="exec-score-unit">{{ ev.unit ?? '' }}</span>
              </div>
              <button class="btn-success btn-block" style="margin-top:16px;padding:14px;font-size:1rem;font-weight:700"
                @click="completeAndAdvance(ev)">Merkitse valmiiksi ✓</button>
            </div>
          </div>

          <div v-if="!pendingEvents.length && state.events.length" class="card" style="text-align:center;padding:40px 16px">
            <div style="font-size:2.5rem;margin-bottom:8px">🏆</div>
            <div style="font-size:1.2rem;font-weight:700">Kaikki lajit suoritettu!</div>
          </div>

          <div v-if="completedEvents.length" class="card" style="margin-top:16px">
            <div class="section-title">Suoritetut</div>
            <div v-for="ev in completedEvents" :key="ev.id" class="list-item">
              <span style="color:var(--success);font-weight:700;margin-right:4px">✓</span>
              <span class="list-item-name">{{ ev.name }}</span>
            </div>
          </div>
        </template>

        <!-- EVENTS -->
        <template v-if="activeTab === 'events'">
          <div v-if="!state.events.length" class="empty">Ei lajeja.</div>
          <div v-for="ev in state.events" :key="ev.id" class="event-card">
            <div class="event-header" @click="openEvent(ev.id)">
              <span class="event-name">{{ ev.name }}</span>
              <span class="event-meta">{{ modeLabel(ev) }}{{ ev.unit ? ' · ' + ev.unit : '' }}</span>
              <span class="event-status" :class="ev.status === 'completed' ? 'status-completed' : 'status-pending'">
                {{ ev.status === 'completed' ? 'Valmis' : 'Kesken' }}
              </span>
            </div>
            <div v-if="openEventId === ev.id" class="event-body">
              <div class="section-title">Muokkaa</div>
              <div class="input-row" style="margin-bottom:6px">
                <input v-model="editValues.name" type="text" placeholder="Lajin nimi">
                <input v-model="editValues.unit" type="text" placeholder="Yksikkö" style="max-width:110px">
              </div>
              <div class="input-row" style="margin-bottom:10px">
                <select v-model="editValues.mode">
                  <option value="individual">Yksilölaji</option>
                  <option value="team">Tiimilaji</option>
                </select>
                <select v-model="editValues.sort_direction">
                  <option value="desc">Suurin voittaa</option>
                  <option value="asc">Pienin voittaa</option>
                </select>
                <button class="btn-primary btn-sm" @click="saveEventEdit(ev.id)">Tallenna</button>
              </div>
              <div class="section-title">Pisteet sijoittain</div>
              <div class="points-grid">
                <template v-for="ep in eventPointsFor(ev.id)" :key="ep.rank">
                  <label>{{ ep.rank }}. sija</label>
                  <input type="number" inputmode="decimal"
                    class="ep-input" :data-eid="ev.id" :data-rank="ep.rank" :value="ep.points">
                </template>
              </div>
              <button class="btn-ghost btn-sm" @click="savePoints(ev.id)">Tallenna pisteet</button>

              <template v-if="ev.status === 'completed'">
                <div class="section-title" style="margin-top:16px">
                  Tulokset <span class="chip">{{ dirLabel(ev) }}</span>
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
              </template>

              <div style="margin-top:12px;display:flex;gap:8px;flex-wrap:wrap">
                <button class="btn-ghost btn-sm" @click="toggleStatus(ev)">
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
            <div class="section-title">Pisteet sijoittain</div>
            <div class="points-grid">
              <template v-for="(pts, i) in newEvPoints" :key="i">
                <label>{{ i + 1 }}. sija</label>
                <div style="display:flex;gap:6px;align-items:center">
                  <input type="number" inputmode="decimal" v-model.number="newEvPoints[i]">
                  <button v-if="newEvPoints.length > 1" class="btn-ghost btn-sm btn-icon"
                    @click="newEvPoints.splice(i, 1)">✕</button>
                </div>
              </template>
            </div>
            <button class="btn-ghost btn-sm" style="margin-bottom:12px" @click="newEvPoints.push(0)">+ Lisää sija</button>
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
