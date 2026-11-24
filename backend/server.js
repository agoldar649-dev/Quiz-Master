const express = require('express');
const session = require('express-session');
const bcrypt = require('bcryptjs');
const crypto = require('crypto');
const dotenv = require('dotenv');
const initSqlJs = require('sql.js');
const fs = require('fs');
const path = require('path');

dotenv.config({ path: path.join(__dirname, '..', '.env') });

const app = express();
app.disable('x-powered-by');
const PORT = Number(process.env.PORT || 4000);
const isProduction = process.env.NODE_ENV === 'production';
const sessionSecret = process.env.SESSION_SECRET || crypto.randomBytes(32).toString('hex');
const configuredDbPath = process.env.DB_PATH || path.join(__dirname, 'quizmaster.sqlite');
const DBFILE = path.isAbsolute(configuredDbPath)
  ? configuredDbPath
  : path.resolve(__dirname, configuredDbPath);

if (isProduction) app.set('trust proxy', 1);

app.use(express.json({ limit: '10kb' }));
app.use(
  session({
    secret: sessionSecret,
    resave: false,
    saveUninitialized: false,
    cookie: {
      httpOnly: true,
      sameSite: 'lax',
      secure: isProduction,
      maxAge: 86400000
    }
  })
);

let db;

function save() {
  fs.writeFileSync(DBFILE, Buffer.from(db.export()));
}

function run(sql, p = []) {
  db.run(sql, p);
}

function one(sql, p = []) {
  let s = db.prepare(sql);
  s.bind(p);
  let r = null;

  if (s.step()) r = s.getAsObject();
  s.free();
  return r;
}

function all(sql, p = []) {
  let s = db.prepare(sql);
  s.bind(p);
  let a = [];

  while (s.step()) a.push(s.getAsObject());
  s.free();
  return a;
}

function login(req, res, next) {
  if (!req.session.user) return res.status(401).json({ error: 'Please log in first.' });
  next();
}

function admin(req, res, next) {
  if (!req.session.user || req.session.user.role !== 'admin') {
    return res.status(403).json({ error: 'Admin access only.' });
  }
  next();
}

function pub(u) {
  return { id: u.id, name: u.name, email: u.email, role: u.role };
}

function validEmail(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) && email.length <= 254;
}

async function start() {
  if (!Number.isInteger(PORT) || PORT < 1 || PORT > 65535) {
    throw new Error('PORT must be a valid TCP port.');
  }
  if (isProduction && (!process.env.SESSION_SECRET || process.env.SESSION_SECRET.length < 32)) {
    throw new Error('Set SESSION_SECRET to a value of at least 32 characters in production.');
  }

  const SQL = await initSqlJs();

  fs.mkdirSync(path.dirname(DBFILE), { recursive: true });
  const databaseExists = fs.existsSync(DBFILE);
  db = databaseExists
    ? new SQL.Database(new Uint8Array(fs.readFileSync(DBFILE)))
    : new SQL.Database();

  const existingTables = new Set(
    all("SELECT name FROM sqlite_master WHERE type='table'").map((table) => table.name)
  );
  let changed = !databaseExists;

  run("CREATE TABLE IF NOT EXISTS users(id INTEGER PRIMARY KEY AUTOINCREMENT,name TEXT,email TEXT UNIQUE,password TEXT,role TEXT DEFAULT 'user')");
  run('CREATE TABLE IF NOT EXISTS topics(id INTEGER PRIMARY KEY AUTOINCREMENT,name TEXT UNIQUE,description TEXT)');
  run('CREATE TABLE IF NOT EXISTS questions(id INTEGER PRIMARY KEY AUTOINCREMENT,topic_id INTEGER,question TEXT,option0 TEXT,option1 TEXT,option2 TEXT,option3 TEXT,correct_index INTEGER,explanation TEXT)');
  run('CREATE TABLE IF NOT EXISTS results(id INTEGER PRIMARY KEY AUTOINCREMENT,user_id INTEGER,topic_id INTEGER,score INTEGER,total INTEGER,created_at TEXT DEFAULT CURRENT_TIMESTAMP)');

  if (['users', 'topics', 'questions', 'results'].some((table) => !existingTables.has(table))) {
    changed = true;
  }

  const adminEmail = String(process.env.ADMIN_EMAIL || 'admin@quizmaster.com').trim().toLowerCase();
  if (!one('SELECT id FROM users WHERE email=?', [adminEmail])) {
    if (!validEmail(adminEmail) || !process.env.ADMIN_PASSWORD || process.env.ADMIN_PASSWORD.length < 12) {
      throw new Error('Set ADMIN_EMAIL and an ADMIN_PASSWORD of at least 12 characters to create the initial admin account.');
    }

    run('INSERT INTO users(name,email,password,role) VALUES(?,?,?,?)', [
      'Admin',
      adminEmail,
      bcrypt.hashSync(process.env.ADMIN_PASSWORD, 10),
      'admin'
    ]);
    changed = true;
  }

  if (!databaseExists && !one('SELECT id FROM topics LIMIT 1')) {
    run('INSERT INTO topics(name,description) VALUES(?,?)', ['Python Basics', 'Python fundamentals']);
    run('INSERT INTO topics(name,description) VALUES(?,?)', ['General Knowledge', 'Starter general knowledge questions']);

    let py = one('SELECT id FROM topics WHERE name=?', ['Python Basics']).id;
    let gk = one('SELECT id FROM topics WHERE name=?', ['General Knowledge']).id;

    let qs = [
      [py, 'Which type stores True or False?', ['int', 'bool', 'str', 'list'], 1, 'bool stores True and False.'],
      [py, 'What is 3 // 2?', ['1.5', '1', '2', '0'], 1, '// is floor division.'],
      [py, 'Which collection is mutable?', ['tuple', 'string', 'list', 'int'], 2, 'Lists are mutable.'],
      [py, 'Which keyword defines a function?', ['func', 'define', 'def', 'function'], 2, 'Python uses def.'],
      [gk, 'Which planet is the Red Planet?', ['Venus', 'Mars', 'Jupiter', 'Mercury'], 1, 'Mars appears red due to iron oxide.'],
      [gk, 'How many sides does a hexagon have?', ['5', '6', '7', '8'], 1, 'A hexagon has six sides.']
    ];

    for (let q of qs) {
      run('INSERT INTO questions(topic_id,question,option0,option1,option2,option3,correct_index,explanation) VALUES(?,?,?,?,?,?,?,?)', [
        q[0],
        q[1],
        ...q[2],
        q[3],
        q[4]
      ]);
    }
    changed = true;
  }

  if (changed) save();

  app.get('/api/auth/me', (req, res) => res.json({ user: req.session.user || null }));

  app.post('/api/auth/register', (req, res) => {
    const body = req.body && typeof req.body === 'object' ? req.body : {};
    let { name, email, password } = body;

    if (
      typeof name !== 'string' ||
      typeof email !== 'string' ||
      typeof password !== 'string' ||
      !name.trim() ||
      !validEmail(email.trim()) ||
      password.length < 6
    ) {
      return res.status(400).json({ error: 'Enter name, email, and password (6+ characters).' });
    }

    name = name.trim();
    email = email.trim().toLowerCase();

    if (one('SELECT id FROM users WHERE email=?', [email])) {
      return res.status(400).json({ error: 'Email already registered.' });
    }

    run('INSERT INTO users(name,email,password,role) VALUES(?,?,?,?)', [
      name,
      email,
      bcrypt.hashSync(password, 10),
      'user'
    ]);

    let u = one('SELECT * FROM users WHERE email=?', [email]);
    req.session.user = pub(u);
    save();
    res.json({ user: req.session.user });
  });

  app.post('/api/auth/login', (req, res) => {
    const body = req.body && typeof req.body === 'object' ? req.body : {};
    const email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : '';
    const password = typeof body.password === 'string' ? body.password : '';
    let u = one('SELECT * FROM users WHERE email=?', [email]);

    if (!u || !bcrypt.compareSync(password, u.password)) {
      return res.status(400).json({ error: 'Invalid email or password.' });
    }

    req.session.user = pub(u);
    res.json({ user: req.session.user });
  });

  app.post('/api/auth/logout', (req, res) => req.session.destroy(() => res.json({ ok: true })));

  app.get('/api/topics', (req, res) =>
    res.json({
      topics: all('SELECT t.*,COUNT(q.id) question_count FROM topics t LEFT JOIN questions q ON q.topic_id=t.id GROUP BY t.id ORDER BY t.id')
    })
  );

  app.get('/api/topics/:id/quiz', login, (req, res) => {
    let t = one('SELECT * FROM topics WHERE id=?', [+req.params.id]);

    if (!t) return res.status(404).json({ error: 'Topic not found' });

    let qs = all('SELECT id,question,option0,option1,option2,option3,correct_index,explanation FROM questions WHERE topic_id=?', [t.id]).map((q) => ({
      ...q,
      options: [q.option0, q.option1, q.option2, q.option3]
    }));

    qs.forEach((q) => {
      delete q.option0;
      delete q.option1;
      delete q.option2;
      delete q.option3;
    });

    res.json({ topic: t, questions: qs });
  });

  app.post('/api/results', login, (req, res) => {
    const body = req.body && typeof req.body === 'object' ? req.body : {};
    let { topic_id, score, total } = body;

    if (
      !Number.isInteger(topic_id) ||
      topic_id < 1 ||
      !Number.isInteger(score) ||
      !Number.isInteger(total) ||
      total < 1 ||
      score < 0 ||
      score > total ||
      !one('SELECT id FROM topics WHERE id=?', [topic_id])
    ) {
      return res.status(400).json({ error: 'Invalid result' });
    }

    run('INSERT INTO results(user_id,topic_id,score,total) VALUES(?,?,?,?)', [
      req.session.user.id,
      topic_id,
      score,
      total
    ]);
    save();
    res.json({ ok: true });
  });

  app.get('/api/history', login, (req, res) =>
    res.json({
      history: all('SELECT r.*,t.name topic_name FROM results r JOIN topics t ON t.id=r.topic_id WHERE r.user_id=? ORDER BY r.id DESC', [
        req.session.user.id
      ])
    })
  );

  app.post('/api/admin/topics', admin, (req, res) => {
    const body = req.body && typeof req.body === 'object' ? req.body : {};
    let { name, description } = body;

    if (
      typeof name !== 'string' ||
      !name.trim() ||
      (description !== undefined && typeof description !== 'string')
    ) return res.status(400).json({ error: 'Topic name required' });
    name = name.trim();
    if (one('SELECT id FROM topics WHERE name=?', [name])) {
      return res.status(400).json({ error: 'Topic already exists' });
    }

    run('INSERT INTO topics(name,description) VALUES(?,?)', [name, description || '']);
    save();
    res.json({ ok: true });
  });

  app.delete('/api/admin/topics/:id', admin, (req, res) => {
    let id = Number(req.params.id);
    if (!Number.isInteger(id) || id < 1) return res.status(400).json({ error: 'Invalid topic id' });

    run('DELETE FROM questions WHERE topic_id=?', [id]);
    run('DELETE FROM results WHERE topic_id=?', [id]);
    run('DELETE FROM topics WHERE id=?', [id]);
    save();
    res.json({ ok: true });
  });

  app.post('/api/admin/questions', admin, (req, res) => {
    const body = req.body && typeof req.body === 'object' ? req.body : {};
    let { topic_id, question, options, correct_index, explanation } = body;

    if (
      !Number.isInteger(topic_id) ||
      topic_id < 1 ||
      !one('SELECT id FROM topics WHERE id=?', [topic_id]) ||
      typeof question !== 'string' ||
      !question.trim() ||
      !Array.isArray(options) ||
      options.length !== 4 ||
      options.some((x) => typeof x !== 'string' || !x.trim()) ||
      ![0, 1, 2, 3].includes(correct_index) ||
      typeof explanation !== 'string' ||
      !explanation.trim()
    ) {
      return res.status(400).json({ error: 'Complete all question fields and four options.' });
    }

    run('INSERT INTO questions(topic_id,question,option0,option1,option2,option3,correct_index,explanation) VALUES(?,?,?,?,?,?,?,?)', [
      topic_id,
      question.trim(),
      ...options,
      correct_index,
      explanation.trim()
    ]);
    save();
    res.json({ ok: true });
  });

  app.use(express.static(path.join(__dirname, '..', 'frontend')));
  app.get('*', (req, res) => res.sendFile(path.join(__dirname, '..', 'frontend', 'index.html')));

  const server = app.listen(PORT, () => console.log('QuizMaster listening on port ' + PORT));
  server.on('error', (error) => {
    console.error('QuizMaster failed to start:', error.message);
    process.exitCode = 1;
  });
}

start().catch((e) => {
  console.error(e);
  process.exit(1);
});
