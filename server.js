// server.js
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
const GAME_START = process.env.GAME_START || null; // format "YYYY-MM-DD" , optional: if not set, today is day1
const TOTAL_DAYS = 7;
const MOVE_DURATION_MS = 4 * 60 * 60 * 1000; // 4 hours

// sample points positions (percent coordinates for the frontend)
// You can tune these coordinates to change layout of 7 points on map.
const POINTS = [
  { x: 16, y: 28 },
  { x: 25, y: 61 },
  { x: 39, y: 53 },
  { x: 51.5, y: 35 },
  { x: 69.3, y: 50 },
  { x: 80, y: 27 },
  { x: 93, y: 50 }
];

function loadDB(){
  if (!fs.existsSync(DB_PATH)) {
    fs.writeFileSync(DB_PATH, JSON.stringify({ users: {} }, null, 2));
  }
  const raw = fs.readFileSync(DB_PATH);
  return JSON.parse(raw);
}
function saveDB(db){
  fs.writeFileSync(DB_PATH, JSON.stringify(db, null, 2));
}

function ensureUserShape(user){
  // ensure checkins and movementStarts arrays length TOTAL_DAYS
  user.checkins = user.checkins || Array(TOTAL_DAYS).fill(false);
  user.movementStarts = user.movementStarts || Array(TOTAL_DAYS).fill(null);
  return user;
}

function getCurrentDay() {
  // returns 1..TOTAL_DAYS
  const now = new Date();
  if (!GAME_START) {
    // if no start date configured: day 1 is day when server first started? Simpler: make day 1 = today
    // But to have progression over days, user should set GAME_START env variable.
    return 1;
  }
  const start = new Date(GAME_START + 'T00:00:00Z');
  const diffDays = Math.floor((Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()) - Date.UTC(start.getUTCFullYear(), start.getUTCMonth(), start.getUTCDate())) / (24*3600*1000));
  const day = Math.floor(diffDays) + 1;
  if (day < 1) return 1;
  if (day > TOTAL_DAYS) return TOTAL_DAYS;
  return day;
}

// --- Passport / Twitter setup ---
if (!TWITTER_KEY || !TWITTER_SECRET) {
  console.warn('WARNING: TWITTER_CONSUMER_KEY or TWITTER_CONSUMER_SECRET not set. OAuth will not work until you set them.');
}
if (!process.env.TWITTER_CALLBACK_URL && !APP_BASE_URL) {
  console.warn('WARNING: APP_BASE_URL or TWITTER_CALLBACK_URL is not set. OAuth callback defaults to localhost and will fail on a public server.');
}
if (APP_BASE_URL && /^http:\/\//.test(APP_BASE_URL) && !/localhost|127\.0\.0\.1/.test(APP_BASE_URL)) {
  console.warn('WARNING: APP_BASE_URL uses http on a public host. Use https in production for secure OAuth and cookies.');
}
passport.serializeUser(function(user, done) {
  done(null, user.id);
});
passport.deserializeUser(function(id, done) {
  try {
    const db = loadDB();
    const user = db.users[id];
    if (!user) return done(null, false);
    done(null, user);
  } catch (e) {
    done(e);
  }
});

passport.use(new TwitterStrategy({
    consumerKey: TWITTER_KEY,
    consumerSecret: TWITTER_SECRET,
    callbackURL: CALLBACK_URL
  },
  function(token, tokenSecret, profile, cb) {
    // profile.id, profile.username
    const db = loadDB();
    const users = db.users || {};
    // Use profile.id as unique key
    let user = Object.values(users).find(u => u.twitterId === profile.id);
    if (!user) {
      // create new
      const uid = 'u_' + Date.now() + '_' + Math.floor(Math.random()*10000);
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
  }
));

const app = express();
if (!process.env.TWITTER_CALLBACK_URL && !APP_BASE_URL) {
  console.warn('WARNING: APP_BASE_URL or TWITTER_CALLBACK_URL is not set. OAuth callback defaults to localhost and will fail on a public server.');
}
if (APP_BASE_URL && /^http:\/\//.test(APP_BASE_URL) && !/localhost|127\.0\.0\.1/.test(APP_BASE_URL)) {
  console.warn('WARNING: APP_BASE_URL uses http on a public host. Use https in production for secure OAuth and cookies.');
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

// Auth routes
app.get('/auth/twitter', passport.authenticate('twitter'));
app.get('/auth/twitter/callback',
  passport.authenticate('twitter', { failureRedirect: '/' }),
  function(req, res) {
    // Successful authentication, redirect home.
    res.redirect('/');
  });

// API: get state (public)
app.get('/api/state', (req, res) => {
  const currentDay = getCurrentDay();
  res.json({
    currentDay,
    totalDays: TOTAL_DAYS,
    points: POINTS,
    serverTime: Date.now(),
    moveDurationMs: MOVE_DURATION_MS,
    gameStart: GAME_START
  });
});

// API: get me
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

  // derive statuses for each day: "future","today","completed","missed","available" etc
  const currentDay = getCurrentDay();
  const statuses = [];
  for (let i = 0; i < TOTAL_DAYS; i++) {
    const day = i + 1;
    if (day < currentDay && !user.checkins[i]) {
      statuses.push('missed');
    } else if (user.checkins[i]) {
      statuses.push('completed');
    } else if (day === currentDay) {
      statuses.push('today');
    } else if (day > currentDay) {
      statuses.push('future');
    } else {
      // other past that was completed handled; else fallback
      statuses.push('future');
    }
  }

  res.json({
    authenticated: true,
    id: user.id,
    twitterId: user.twitterId,
    username: user.username,
    checkins: user.checkins,
    movementStarts: user.movementStarts,
    statuses,
    currentDay
  });
});

// Helper to ensure user exists in DB
function getUserFromReq(req){
  if (!req.isAuthenticated()) return null;
  const db = loadDB();
  let user = db.users[req.user.id];
  if (!user) return null;
  user = ensureUserShape(user);
  return { db, user };
}

// POST /api/checkin
// body: { action: 'start' | 'finish' }
app.post('/api/checkin', (req, res) => {
  if (!req.isAuthenticated()) return res.status(401).json({ error: 'unauthenticated' });
  const { action } = req.body;
  if (!action || (action !== 'start' && action !== 'finish')) return res.status(400).json({ error: 'invalid action' });

  const curDay = getCurrentDay(); // 1..TOTAL_DAYS
  const idx = curDay - 1;

  const { db, user } = getUserFromReq(req);
  if (!user) return res.status(404).json({ error: 'user not found' });

  // If day is already completed -> cannot act
  if (user.checkins[idx]) {
    return res.status(400).json({ error: 'today already completed' });
  }

  // cannot start/finish for future days - API always uses currentDay
  if (action === 'start') {
    if (user.movementStarts[idx]) {
      return res.status(400).json({ error: 'movement already started' });
    }
    // If previous day was missed -> it's allowed (user can still start today's movement)
    user.movementStarts[idx] = Date.now();
    db.users[user.id] = user;
    saveDB(db);
    return res.json({ ok: true, startedAt: user.movementStarts[idx] });
  } else if (action === 'finish') {
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
    return res.json({ ok: true, checkins: user.checkins });
  }
});

// Logout
app.post('/auth/logout', (req, res) => {
  req.logout(() => {});
  res.json({ ok: true });
});

// fallback
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.listen(PORT, () => {
  console.log(`Daily Check-in Game running on http://localhost:${PORT}`);
    console.log(`OAuth callback URL: ${CALLBACK_URL}`);
  if (GAME_START) console.log(`Game start date: ${GAME_START}`);
});
