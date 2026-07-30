const express = require('express');
const session = require('express-session');
const path = require('path');
const db = require('./db');
const { login, logout, requireAuth } = require('./auth');

const app = express();
const PORT = process.env.PORT || 3000;

// Session store backed by better-sqlite3
class SqliteStore extends session.Store {
  constructor() {
    super();
    db.exec(`CREATE TABLE IF NOT EXISTS sessions (
      sid TEXT PRIMARY KEY,
      expired INTEGER NOT NULL,
      sess TEXT NOT NULL
    )`);
    this.get_ = db.prepare('SELECT sess FROM sessions WHERE sid = ? AND expired > ?');
    this.set_ = db.prepare('INSERT INTO sessions (sid, expired, sess) VALUES (?, ?, ?) ON CONFLICT(sid) DO UPDATE SET expired = excluded.expired, sess = excluded.sess');
    this.destroy_ = db.prepare('DELETE FROM sessions WHERE sid = ?');
    setInterval(() => db.prepare('DELETE FROM sessions WHERE expired < ?').run(Date.now()), 60000);
  }
  get(sid, cb) {
    const row = this.get_.get(sid, Date.now());
    cb(null, row ? JSON.parse(row.sess) : null);
  }
  set(sid, sess, cb) {
    const ttl = sess.cookie?.maxAge ? Date.now() + sess.cookie.maxAge : Date.now() + 86400000;
    this.set_.run(sid, ttl, JSON.stringify(sess));
    cb(null);
  }
  destroy(sid, cb) { this.destroy_.run(sid); cb(null); }
}

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));
app.get('/vendor/vue.js', (req, res) => {
  res.sendFile(path.join(__dirname, 'node_modules/vue/dist/vue.esm-browser.prod.js'));
});
app.use(session({
  store: new SqliteStore(),
  secret: process.env.SESSION_SECRET || 'slympia-secret',
  resave: false,
  saveUninitialized: false,
  cookie: { maxAge: 30 * 24 * 60 * 60 * 1000 }
}));

// ---------- Auth ----------
app.post('/api/login', login);
app.post('/api/logout', logout);
app.get('/api/me', (req, res) => {
  if (!req.session.userId) return res.json(null);
  res.json({ id: req.session.userId, username: req.session.username });
});

// ---------- Competitions ----------
app.get('/api/competitions', requireAuth, (req, res) => {
  const rows = db.prepare('SELECT * FROM competitions WHERE owner_user_id = ? ORDER BY created_at DESC').all(req.session.userId);
  res.json(rows);
});

app.post('/api/competitions', requireAuth, (req, res) => {
  const { name } = req.body;
  if (!name?.trim()) return res.status(400).json({ error: 'Nimi vaaditaan' });
  const result = db.prepare('INSERT INTO competitions (name, owner_user_id) VALUES (?, ?)').run(name.trim(), req.session.userId);
  res.json({ id: result.lastInsertRowid, name: name.trim() });
});

function ownedComp(req, res) {
  const comp = db.prepare('SELECT * FROM competitions WHERE id = ? AND owner_user_id = ?').get(req.params.id, req.session.userId);
  if (!comp) { res.status(404).json({ error: 'Kisaa ei löydy' }); return null; }
  return comp;
}

// ---------- Full state ----------
app.get('/api/competitions/:id/state', requireAuth, (req, res) => {
  if (!ownedComp(req, res)) return;
  const cid = req.params.id;

  const participants = db.prepare('SELECT * FROM participants WHERE competition_id = ? ORDER BY created_at').all(cid);
  const teams = db.prepare('SELECT * FROM teams WHERE competition_id = ?').all(cid);
  const teamMembers = db.prepare(
    'SELECT tm.team_id, tm.participant_id FROM team_members tm JOIN teams t ON t.id = tm.team_id WHERE t.competition_id = ?'
  ).all(cid);
  const events = db.prepare('SELECT * FROM events WHERE competition_id = ? ORDER BY position, created_at').all(cid);
  const eventIds = events.map(e => e.id);

  let eventPoints = [], eventOverrides = [], results = [];
  if (eventIds.length) {
    const placeholders = eventIds.map(() => '?').join(',');
    eventPoints = db.prepare(`SELECT * FROM event_points WHERE event_id IN (${placeholders})`).all(...eventIds);
    eventOverrides = db.prepare(`SELECT * FROM event_team_overrides WHERE event_id IN (${placeholders})`).all(...eventIds);
    results = db.prepare(`SELECT * FROM results WHERE event_id IN (${placeholders})`).all(...eventIds);
  }

  const customColumns = db.prepare('SELECT * FROM custom_columns WHERE competition_id = ? ORDER BY position').all(cid);
  const colIds = customColumns.map(c => c.id);
  let customValues = [];
  if (colIds.length) {
    const placeholders = colIds.map(() => '?').join(',');
    customValues = db.prepare(`SELECT * FROM custom_column_values WHERE column_id IN (${placeholders})`).all(...colIds);
  }

  const adjustments = db.prepare(
    'SELECT ma.* FROM manual_adjustments ma JOIN participants p ON p.id = ma.participant_id WHERE p.competition_id = ?'
  ).all(cid);

  const standings = computeStandings(participants, teams, teamMembers, events, eventPoints, eventOverrides, results, adjustments);

  res.json({ participants, teams, teamMembers, events, eventPoints, eventOverrides, results, customColumns, customValues, adjustments, standings });
});

// ---------- Participants ----------
app.post('/api/competitions/:id/participants', requireAuth, (req, res) => {
  if (!ownedComp(req, res)) return;
  const { name } = req.body;
  if (!name?.trim()) return res.status(400).json({ error: 'Nimi vaaditaan' });
  const result = db.prepare('INSERT INTO participants (competition_id, name) VALUES (?, ?)').run(req.params.id, name.trim());
  res.json({ id: result.lastInsertRowid, competition_id: Number(req.params.id), name: name.trim() });
});

app.put('/api/competitions/:id/participants/:pid', requireAuth, (req, res) => {
  if (!ownedComp(req, res)) return;
  const { name } = req.body;
  if (!name?.trim()) return res.status(400).json({ error: 'Nimi vaaditaan' });
  db.prepare('UPDATE participants SET name = ? WHERE id = ? AND competition_id = ?').run(name.trim(), req.params.pid, req.params.id);
  res.json({ ok: true });
});

app.delete('/api/competitions/:id/participants/:pid', requireAuth, (req, res) => {
  if (!ownedComp(req, res)) return;
  db.prepare('DELETE FROM participants WHERE id = ? AND competition_id = ?').run(req.params.pid, req.params.id);
  res.json({ ok: true });
});

// ---------- Teams ----------
app.post('/api/competitions/:id/teams', requireAuth, (req, res) => {
  if (!ownedComp(req, res)) return;
  const { name } = req.body;
  if (!name?.trim()) return res.status(400).json({ error: 'Nimi vaaditaan' });
  const result = db.prepare('INSERT INTO teams (competition_id, name) VALUES (?, ?)').run(req.params.id, name.trim());
  res.json({ id: result.lastInsertRowid, competition_id: Number(req.params.id), name: name.trim() });
});

app.put('/api/competitions/:id/teams/:tid', requireAuth, (req, res) => {
  if (!ownedComp(req, res)) return;
  const { name } = req.body;
  if (!name?.trim()) return res.status(400).json({ error: 'Nimi vaaditaan' });
  db.prepare('UPDATE teams SET name = ? WHERE id = ? AND competition_id = ?').run(name.trim(), req.params.tid, req.params.id);
  res.json({ ok: true });
});

app.delete('/api/competitions/:id/teams/:tid', requireAuth, (req, res) => {
  if (!ownedComp(req, res)) return;
  db.prepare('DELETE FROM teams WHERE id = ? AND competition_id = ?').run(req.params.tid, req.params.id);
  res.json({ ok: true });
});

app.post('/api/competitions/:id/teams/:tid/members', requireAuth, (req, res) => {
  if (!ownedComp(req, res)) return;
  const { participantId } = req.body;
  db.prepare('INSERT OR IGNORE INTO team_members (team_id, participant_id) VALUES (?, ?)').run(req.params.tid, participantId);
  res.json({ ok: true });
});

app.delete('/api/competitions/:id/teams/:tid/members/:pid', requireAuth, (req, res) => {
  if (!ownedComp(req, res)) return;
  db.prepare('DELETE FROM team_members WHERE team_id = ? AND participant_id = ?').run(req.params.tid, req.params.pid);
  res.json({ ok: true });
});

// ---------- Events ----------
app.post('/api/competitions/:id/events', requireAuth, (req, res) => {
  if (!ownedComp(req, res)) return;
  const { name, unit, mode, sort_direction } = req.body;
  if (!name?.trim()) return res.status(400).json({ error: 'Nimi vaaditaan' });

  const maxPos = db.prepare('SELECT MAX(position) as m FROM events WHERE competition_id = ?').get(req.params.id);
  const position = (maxPos.m ?? -1) + 1;

  const result = db.prepare(
    'INSERT INTO events (competition_id, name, unit, mode, sort_direction, position) VALUES (?, ?, ?, ?, ?, ?)'
  ).run(req.params.id, name.trim(), unit || null, mode || 'individual', sort_direction || 'desc', position);

  const eventId = result.lastInsertRowid;

  const entrantCount = mode === 'team'
    ? db.prepare('SELECT COUNT(*) as c FROM teams WHERE competition_id = ?').get(req.params.id).c
    : db.prepare('SELECT COUNT(*) as c FROM participants WHERE competition_id = ?').get(req.params.id).c;

  const insertPoint = db.prepare('INSERT INTO event_points (event_id, rank, points) VALUES (?, ?, 0)');
  db.transaction(() => {
    for (let i = 1; i <= entrantCount; i++) insertPoint.run(eventId, i);
  })();

  res.json({ id: eventId, competition_id: Number(req.params.id), name: name.trim(), unit: unit || null, mode: mode || 'individual', sort_direction: sort_direction || 'desc', position, status: 'pending' });
});

app.put('/api/competitions/:id/events/:eid', requireAuth, (req, res) => {
  if (!ownedComp(req, res)) return;
  const { name, unit, sort_direction, position, mode } = req.body;
  db.prepare('UPDATE events SET name = COALESCE(?, name), unit = COALESCE(?, unit), sort_direction = COALESCE(?, sort_direction), position = COALESCE(?, position), mode = COALESCE(?, mode) WHERE id = ? AND competition_id = ?')
    .run(name?.trim() || null, unit ?? null, sort_direction || null, position ?? null, mode || null, req.params.eid, req.params.id);
  res.json({ ok: true });
});

app.delete('/api/competitions/:id/events/:eid', requireAuth, (req, res) => {
  if (!ownedComp(req, res)) return;
  db.prepare('DELETE FROM events WHERE id = ? AND competition_id = ?').run(req.params.eid, req.params.id);
  res.json({ ok: true });
});

app.put('/api/competitions/:id/events/:eid/points', requireAuth, (req, res) => {
  if (!ownedComp(req, res)) return;
  const { pointsMap } = req.body;
  db.transaction(() => {
    for (const [rank, points] of Object.entries(pointsMap)) {
      db.prepare('INSERT INTO event_points (event_id, rank, points) VALUES (?, ?, ?) ON CONFLICT(event_id, rank) DO UPDATE SET points = excluded.points')
        .run(req.params.eid, Number(rank), Number(points));
    }
  })();
  res.json({ ok: true });
});

app.put('/api/competitions/:id/events/:eid/status', requireAuth, (req, res) => {
  if (!ownedComp(req, res)) return;
  const { status } = req.body;
  if (!['pending', 'completed'].includes(status)) return res.status(400).json({ error: 'Virheellinen tila' });
  db.prepare('UPDATE events SET status = ? WHERE id = ? AND competition_id = ?').run(status, req.params.eid, req.params.id);
  res.json({ ok: true });
});

app.put('/api/competitions/:id/events/:eid/team-overrides', requireAuth, (req, res) => {
  if (!ownedComp(req, res)) return;
  const { teamId, participantIds } = req.body;
  const eid = req.params.eid;
  db.transaction(() => {
    db.prepare('DELETE FROM event_team_overrides WHERE event_id = ? AND team_id = ?').run(eid, teamId);
    for (const pid of participantIds) {
      db.prepare('INSERT INTO event_team_overrides (event_id, team_id, participant_id) VALUES (?, ?, ?)').run(eid, teamId, pid);
    }
  })();
  res.json({ ok: true });
});

// ---------- Results ----------
app.post('/api/competitions/:id/events/:eid/results', requireAuth, (req, res) => {
  if (!ownedComp(req, res)) return;
  const { entrantType, entrantId, rawScore } = req.body;
  db.prepare(
    "INSERT INTO results (event_id, entrant_type, entrant_id, raw_score, updated_at) VALUES (?, ?, ?, ?, datetime('now')) ON CONFLICT(event_id, entrant_type, entrant_id) DO UPDATE SET raw_score = excluded.raw_score, updated_at = excluded.updated_at"
  ).run(req.params.eid, entrantType, entrantId, Number(rawScore));
  res.json({ ok: true });
});

app.delete('/api/competitions/:id/events/:eid/results/:entrantType/:entrantId', requireAuth, (req, res) => {
  if (!ownedComp(req, res)) return;
  db.prepare('DELETE FROM results WHERE event_id = ? AND entrant_type = ? AND entrant_id = ?').run(req.params.eid, req.params.entrantType, req.params.entrantId);
  res.json({ ok: true });
});

// ---------- Custom columns ----------
app.post('/api/competitions/:id/custom-columns', requireAuth, (req, res) => {
  if (!ownedComp(req, res)) return;
  const { name } = req.body;
  if (!name?.trim()) return res.status(400).json({ error: 'Nimi vaaditaan' });
  const maxPos = db.prepare('SELECT MAX(position) as m FROM custom_columns WHERE competition_id = ?').get(req.params.id);
  const position = (maxPos.m ?? -1) + 1;
  const result = db.prepare('INSERT INTO custom_columns (competition_id, name, position) VALUES (?, ?, ?)').run(req.params.id, name.trim(), position);
  res.json({ id: result.lastInsertRowid, name: name.trim(), position });
});

app.put('/api/competitions/:id/custom-columns/:cid', requireAuth, (req, res) => {
  if (!ownedComp(req, res)) return;
  const { name } = req.body;
  if (!name?.trim()) return res.status(400).json({ error: 'Nimi vaaditaan' });
  db.prepare('UPDATE custom_columns SET name = ? WHERE id = ? AND competition_id = ?').run(name.trim(), req.params.cid, req.params.id);
  res.json({ ok: true });
});

app.delete('/api/competitions/:id/custom-columns/:cid', requireAuth, (req, res) => {
  if (!ownedComp(req, res)) return;
  db.prepare('DELETE FROM custom_columns WHERE id = ? AND competition_id = ?').run(req.params.cid, req.params.id);
  res.json({ ok: true });
});

app.put('/api/competitions/:id/custom-columns/:cid/values/:pid', requireAuth, (req, res) => {
  if (!ownedComp(req, res)) return;
  const { value } = req.body;
  db.prepare('INSERT INTO custom_column_values (column_id, participant_id, value) VALUES (?, ?, ?) ON CONFLICT(column_id, participant_id) DO UPDATE SET value = excluded.value')
    .run(req.params.cid, req.params.pid, value ?? null);
  res.json({ ok: true });
});

// ---------- Manual adjustments ----------
app.post('/api/competitions/:id/participants/:pid/adjust', requireAuth, (req, res) => {
  if (!ownedComp(req, res)) return;
  const { delta } = req.body;
  db.prepare('INSERT INTO manual_adjustments (participant_id, value) VALUES (?, ?) ON CONFLICT(participant_id) DO UPDATE SET value = value + excluded.value')
    .run(req.params.pid, Number(delta));
  res.json({ ok: true });
});

// ---------- Standings ----------
function computeStandings(participants, teams, teamMembers, events, eventPoints, eventOverrides, results, adjustments) {
  const pointsMap = {};
  for (const ep of eventPoints) {
    if (!pointsMap[ep.event_id]) pointsMap[ep.event_id] = {};
    pointsMap[ep.event_id][ep.rank] = ep.points;
  }

  const overrideMap = {};
  for (const o of eventOverrides) {
    const key = `${o.event_id}:${o.team_id}`;
    if (!overrideMap[key]) overrideMap[key] = [];
    overrideMap[key].push(o.participant_id);
  }

  const defaultMembers = {};
  for (const tm of teamMembers) {
    if (!defaultMembers[tm.team_id]) defaultMembers[tm.team_id] = [];
    defaultMembers[tm.team_id].push(tm.participant_id);
  }

  const individualScores = {};
  const teamScores = {};
  for (const p of participants) { individualScores[p.id] = 0; teamScores[p.id] = 0; }

  for (const event of events) {
    const eventResults = results.filter(r => r.event_id === event.id);
    if (!eventResults.length) continue;

    const sorted = [...eventResults].sort((a, b) =>
      event.sort_direction === 'asc' ? a.raw_score - b.raw_score : b.raw_score - a.raw_score
    );

    const ranked = [];
    let rank = 1;
    for (let i = 0; i < sorted.length; i++) {
      ranked.push({ ...sorted[i], rank: i > 0 && sorted[i].raw_score === sorted[i - 1].raw_score ? ranked[i - 1].rank : rank });
      rank++;
    }

    const pts = pointsMap[event.id] || {};

    if (event.mode === 'individual') {
      for (const r of ranked) {
        if (individualScores[r.entrant_id] !== undefined) individualScores[r.entrant_id] += pts[r.rank] ?? 0;
      }
    } else {
      for (const r of ranked) {
        const key = `${event.id}:${r.entrant_id}`;
        const members = overrideMap[key] ?? defaultMembers[r.entrant_id] ?? [];
        const teamPts = pts[r.rank] ?? 0;
        for (const pid of members) {
          if (teamScores[pid] !== undefined) teamScores[pid] += teamPts;
        }
      }
    }
  }

  const adjMap = {};
  for (const a of adjustments) adjMap[a.participant_id] = a.value;

  const participantTeam = {};
  for (const tm of teamMembers) {
    if (!participantTeam[tm.participant_id]) participantTeam[tm.participant_id] = tm.team_id;
  }
  const teamNameMap = {};
  for (const t of teams) teamNameMap[t.id] = t.name;

  return participants.map(p => ({
    participantId: p.id,
    name: p.name,
    individualPoints: individualScores[p.id] ?? 0,
    teamPoints: teamScores[p.id] ?? 0,
    adjustment: adjMap[p.id] ?? 0,
    total: (individualScores[p.id] ?? 0) + (teamScores[p.id] ?? 0) + (adjMap[p.id] ?? 0),
    teamId: participantTeam[p.id] ?? null,
    teamName: participantTeam[p.id] ? (teamNameMap[participantTeam[p.id]] ?? null) : null,
  })).sort((a, b) => b.total - a.total);
}

app.listen(PORT, () => console.log(`Slympialaskuri käynnissä portissa ${PORT}`));
