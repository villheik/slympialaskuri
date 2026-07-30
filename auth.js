const db = require('./db');

function login(req, res) {
  const { username } = req.body;
  if (!username || !username.trim()) return res.status(400).json({ error: 'Käyttäjänimi vaaditaan' });

  const name = username.trim();
  let user = db.prepare('SELECT * FROM users WHERE username = ?').get(name);
  if (!user) {
    const result = db.prepare('INSERT INTO users (username) VALUES (?)').run(name);
    user = { id: result.lastInsertRowid, username: name };
  }

  req.session.userId = user.id;
  req.session.username = user.username;
  res.json({ id: user.id, username: user.username });
}

function logout(req, res) {
  req.session.destroy(() => res.json({ ok: true }));
}

function requireAuth(req, res, next) {
  if (!req.session.userId) return res.status(401).json({ error: 'Kirjaudu ensin' });
  next();
}

module.exports = { login, logout, requireAuth };
