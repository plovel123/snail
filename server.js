require('dotenv').config();
const express = require('express');
const fs = require('fs');
const path = require('path');
const session = require('express-session');
const passport = require('passport');
const TwitterStrategy = require('passport-twitter').Strategy;
const bodyParser = require('body-parser');

const DB_PATH = path.join(__dirname, 'db.json');
const PORT = process.env.PORT || 3000;
const SESSION_SECRET = process.env.SESSION_SECRET || 'change_this_session_secret';
const TWITTER_KEY = process.env.TWITTER_CONSUMER_KEY || '';
const TWITTER_SECRET = process.env.TWITTER_CONSUMER_SECRET || '';
const APP_BASE_URL = process.env.APP_BASE_URL || '';
const CALLBACK_URL = process.env.TWITTER_CALLBACK_URL || (APP_BASE_URL ? `${APP_BASE_URL}/auth/twitter/callback` : `http://localhost:${PORT}/auth/twitter/callback`);
const TRUST_PROXY = process.env.TRUST_PROXY === '1';
const COOKIE_SECURE = process.env.COOKIE_SECURE === '1';

// GAME configuration
const GAME_START = process.env.GAME_START || null;
const TOTAL_DAYS = 7;
const MOVE_DURATION_MS = 12 * 60 * 60 * 1000; // 12 hours

const POINTS = [
  { x: 8, y: 80 },
  { x: 22, y: 60 },
  { x: 38, y: 48 },
  { x: 52, y: 36 },
  { x: 66, y: 46 },
  { x: 80, y: 60 },
  { x: 92, y: 44 }
];

const ARC_CONTROLS = [
  { x: 15, y: 74 },
  { x: 30, y: 56 },
  { x: 45, y: 44 },
  { x: 58, y: 42 },
  { x: 73, y: 54 },
  { x: 86, y: 55 }
];

function loadDB() {
  if (!fs.existsSync(DB_PATH)) {
    fs.writeFileSync(DB_PATH, JSON.stringify({ users: {} }, null, 2));
  }
  const raw = fs.readFileSync(DB_PATH);
  return JSON.parse(raw);
}

function saveDB(db) {
  fs.writeFileSync(DB_PATH, JSON.stringify(db, null, 2));
}

function ensureUserShape(user) {
  user.checkins = user.checkins || Array(TOTAL_DAYS).fill(false);
  user.movementStarts = user.movementStarts || Array(TOTAL_DAYS).fill(null);
  return user;
}

function getProgressDay(user) {
  const nextOpenIdx = user.checkins.findIndex((done) => !done);
  if (nextOpenIdx === -1) return TOTAL_DAYS;
  return nextOpenIdx + 1;
}

function getTargetIdx(user) {
  const nextOpenIdx = user.checkins.findIndex((done) => !done);
  if (nextOpenIdx === -1) return TOTAL_DAYS - 1;
  return nextOpenIdx;
}

function buildStatuses(user) {
  const targetIdx = getTargetIdx(user);
  return user.checkins.map((done, i) => {
    if (done) return 'completed';
    if (i === targetIdx) return 'today';
    return 'future';
  });
}

if (!TWITTER_KEY || !TWITTER_SECRET) {
  console.warn('WARNING: TWITTER_CONSUMER_KEY or TWITTER_CONSUMER_SECRET not set. OAuth will not work until you set them.');
}
if (!process.env.TWITTER_CALLBACK_URL && !APP_BASE_URL) {
  console.warn('WARNING: APP_BASE_URL or TWITTER_CALLBACK_URL is not set. OAuth callback defaults to localhost and will fail on a public server.');
}
if (APP_BASE_URL && /^http:\/\//.test(APP_BASE_URL) && !/localhost|127\.0\.0\.1/.test(APP_BASE_URL)) {
  console.warn('WARNING: APP_BASE_URL uses http on a public host. Use https in production for secure OAuth and cookies.');
}

passport.serializeUser((user, done) => done(null, user.id));
passport.deserializeUser((id, done) => {
  try {
    const db = loadDB();
    const user = db.users[id];
    if (!user) return done(null, false);
    return done(null, user);
  } catch (e) {
    return done(e);
  }
});

passport.use(new TwitterStrategy({
  consumerKey: TWITTER_KEY,
  consumerSecret: TWITTER_SECRET,
  callbackURL: CALLBACK_URL
}, (token, tokenSecret, profile, cb) => {
  const db = loadDB();
  const users = db.users || {};

  let user = Object.values(users).find((u) => u.twitterId === profile.id);
  if (!user) {
    const uid = `u_${Date.now()}_${Math.floor(Math.random() * 10000)}`;
    user = {
      id: uid,
      twitterId: profile.id,
      username: profile.username || (profile.displayName || '').replace(/\s+/g, ''),
      checkins: Array(TOTAL_DAYS).fill(false),
      movementStarts: Array(TOTAL_DAYS).fill(null)
    };
    users[uid] = user;
  } else {
    user.username = profile.username || user.username;
    user = ensureUserShape(user);
    users[user.id] = user;
  }

  db.users = users;
  saveDB(db);
  return cb(null, user);
}));

const app = express();
if (TRUST_PROXY) {
  app.set('trust proxy', 1);
}

app.use(bodyParser.json());
app.use(session({
  secret: SESSION_SECRET,
  resave: false,
  saveUninitialized: false,
  cookie: {
    httpOnly: true,
    sameSite: 'lax',
    secure: COOKIE_SECURE
  }
}));
app.use(passport.initialize());
app.use(passport.session());
app.use(express.static(path.join(__dirname, 'public')));

app.get('/auth/twitter', passport.authenticate('twitter'));
app.get('/auth/twitter/callback', passport.authenticate('twitter', { failureRedirect: '/' }), (req, res) => {
  res.redirect('/');
});

app.get('/api/state', (req, res) => {
  res.json({
    currentDay: 1,
    totalDays: TOTAL_DAYS,
    points: POINTS,
    arcControls: ARC_CONTROLS,
    serverTime: Date.now(),
    moveDurationMs: MOVE_DURATION_MS,
    gameStart: GAME_START
  });
});

app.get('/api/me', (req, res) => {
  if (!req.isAuthenticated()) {
    return res.json({ authenticated: false });
  }

  const db = loadDB();
  let user = db.users[req.user.id];
  if (!user) {
    return res.status(404).json({ error: 'user not found' });
  }

  user = ensureUserShape(user);
  db.users[user.id] = user;
  saveDB(db);

  return res.json({
    authenticated: true,
    id: user.id,
    twitterId: user.twitterId,
    username: user.username,
    checkins: user.checkins,
    movementStarts: user.movementStarts,
    statuses: buildStatuses(user),
    currentDay: getProgressDay(user)
  });
});

function getUserFromReq(req) {
  if (!req.isAuthenticated()) return null;
  const db = loadDB();
  let user = db.users[req.user.id];
  if (!user) return null;
  user = ensureUserShape(user);
  return { db, user };
}

app.post('/api/checkin', (req, res) => {
  if (!req.isAuthenticated()) return res.status(401).json({ error: 'unauthenticated' });

  const { action } = req.body;
  if (!action || (action !== 'start' && action !== 'finish')) {
    return res.status(400).json({ error: 'invalid action' });
  }

  const context = getUserFromReq(req);
  if (!context) return res.status(404).json({ error: 'user not found' });

  const { db, user } = context;
  const idx = getTargetIdx(user);

  if (user.checkins.every(Boolean)) {
    return res.status(400).json({ error: 'all_days_completed' });
  }

  if (action === 'start') {
    if (user.movementStarts[idx]) {
      return res.status(400).json({ error: 'movement already started' });
    }

    user.movementStarts[idx] = Date.now();
    db.users[user.id] = user;
    saveDB(db);
    return res.json({ ok: true, startedAt: user.movementStarts[idx], currentDay: getProgressDay(user) });
  }

  const startedAt = user.movementStarts[idx];
  if (!startedAt) {
    return res.status(400).json({ error: 'movement not started yet' });
  }

  const diff = Date.now() - startedAt;
  if (diff < MOVE_DURATION_MS) {
    return res.status(400).json({ error: 'too_early', needMs: MOVE_DURATION_MS - diff });
  }

  user.checkins[idx] = true;
  user.movementStarts[idx] = null;
  db.users[user.id] = user;
  saveDB(db);

  return res.json({ ok: true, checkins: user.checkins, currentDay: getProgressDay(user) });
});

app.post('/auth/logout', (req, res) => {
  req.logout(() => {});
  res.json({ ok: true });
});

app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.listen(PORT, () => {
  console.log(`Daily Check-in Game running on http://localhost:${PORT}`);
  console.log(`OAuth callback URL: ${CALLBACK_URL}`);
  if (GAME_START) console.log(`Game start date: ${GAME_START}`);
});