// script.js - frontend logic

const api = {
  state: '/api/state',
  me: '/api/me',
  checkin: '/api/checkin',
  logout: '/auth/logout'
};

let state = null;
let me = null;
let points = [];
let currentDay = 1;
let totalDays = 7;
let moveDurationMs = 4*60*60*1000;

const mapEl = document.querySelector('.map');
const snailEl = document.getElementById('snail');
const checkBtn = document.getElementById('checkBtn');
const dayInfo = document.getElementById('dayInfo');
const statusMsg = document.getElementById('statusMsg');
const userNameEl = document.getElementById('userName');
const authButtons = document.getElementById('authButtons');

async function fetchState(){
  const r = await fetch(api.state);
  state = await r.json();
  points = state.points;
  currentDay = state.currentDay;
  totalDays = state.totalDays;
  moveDurationMs = state.moveDurationMs || moveDurationMs;
  renderPoints();
}

async function fetchMe(){
  const r = await fetch(api.me);
  me = await r.json();
  if (!me.authenticated) {
    userNameEl.textContent = 'Guest';
    authButtons.innerHTML = `<a id="loginBtn" href="/auth/twitter" class="btn">Login via Twitter</a>`;
    checkBtn.disabled = true;
    checkBtn.textContent = 'Login to check';
    return;
  }
  userNameEl.textContent = '@' + me.username;
  authButtons.innerHTML = `<button id="logoutBtn" class="btn" style="background:#ff6b6b">Exit</button>`;
  document.getElementById('logoutBtn').addEventListener('click', async () => {
    await fetch('/auth/logout', { method:'POST' });
    location.reload();
  });
  updateUIFromMe();
}

function renderPoints(){
  // clear existing points (except snail element)
  Array.from(mapEl.querySelectorAll('.point')).forEach(n => n.remove());
  // add points
  points.forEach((p, i) => {
    const idx = i;
    const el = document.createElement('div');
    el.className = 'point future';
    el.style.left = p.x + '%';
    el.style.top = p.y + '%';
    el.dataset.index = i;
    el.innerHTML = `<div style="z-index:2">${i+1}</div><div class="num">${i+1}</div>`;
    mapEl.appendChild(el);
  });
  // ensure snail on top
  mapEl.appendChild(snailEl);
  updateUIFromMe();
}

// compute snail position and move it
function updateSnailPosition(){
  const snailSize = 48;
  // default anchor positions between two points
  const todayIdx = currentDay - 1;
  const prevIdx = Math.max(0, todayIdx - 1);
  // find coordinates in px
  const mapRect = mapEl.getBoundingClientRect();

  function coordFor(idx){
    const p = points[idx];
    if (!p) return {x: 10, y: mapRect.height - 40};
    const x = p.x/100 * mapRect.width;
    const y = p.y/100 * mapRect.height;
    return {x, y};
  }

  // Determine snail position rules:
  // - if previous day exists and previous was missed (status 'missed') => snail at today's point
  // - else if movement started for current day => interpolate between prev and today
  // - else snail at prev point (or start position if day 1, no prev)
  let x = 0, y = 0;
  if (!me || !me.authenticated) {
    // place snail off left as "start"
    const startX = 30;
    const startY = mapRect.height - 30;
    snailEl.style.left = startX + 'px';
    snailEl.style.top = startY + 'px';
    return;
  }
  const statuses = me.statuses || [];
  const checkins = me.checkins || [];
  const movementStarts = me.movementStarts || [];

  // Prior day missed?
  const prevMissed = (currentDay > 1) && (statuses[currentDay-2] === 'missed');

  if (prevMissed) {
    // snail is at today's point
    const c = coordFor(todayIdx);
    x = c.x; y = c.y;
  } else {
    const startedAt = movementStarts[todayIdx];
    if (startedAt) {
      // interpolate between prev and today based on percent of moveDurationMs
      const now = Date.now();
      const elapsed = Math.max(0, now - startedAt);
      let t = Math.min(1, elapsed / moveDurationMs);
      const A = coordFor(prevIdx);
      const B = coordFor(todayIdx);
      x = A.x + (B.x - A.x) * t;
      y = A.y + (B.y - A.y) * t;
    } else {
      // show snail at prev point (or start pos)
      if (currentDay === 1) {
        const startX = 30;
        const startY = mapRect.height - 30;
        x = startX; y = startY;
      } else {
        const p = coordFor(prevIdx);
        x = p.x; y = p.y;
      }
    }
  }

  snailEl.style.left = x + 'px';
  snailEl.style.top = y + 'px';
}

function updateUIFromMe(){
  // update buttons, statuses, point classes
  if (!state || !points.length) return;
  // ensure points exist
  const pointEls = Array.from(document.querySelectorAll('.point'));
  pointEls.forEach((el, i) => {
    el.className = 'point';
    const st = me && me.statuses ? me.statuses[i] : (i+1 === currentDay ? 'today' : (i+1 > currentDay ? 'future' : 'missed'));
    el.classList.add(st);
  });

  // day info
  dayInfo.textContent = `Day: ${currentDay} / ${totalDays}`;

  if (!me || !me.authenticated) {
    checkBtn.disabled = true;
    checkBtn.textContent = 'Login to check';
    statusMsg.textContent = '';
    updateSnailPosition();
    return;
  }

  // determine button state for today
  const idx = currentDay - 1;
  const startedAt = me.movementStarts ? me.movementStarts[idx] : null;
  const completed = me.checkins ? me.checkins[idx] : false;
  const now = Date.now();

  if (completed) {
    checkBtn.disabled = true;
    checkBtn.textContent = 'Already checked in today';
    statusMsg.textContent = 'You have already completed your check-in for today. Great job!';
  } else if (!startedAt) {
    checkBtn.disabled = false;
    checkBtn.textContent = 'Start snail movement';
    statusMsg.textContent = 'Click to start the snail moving to today\'s point.';
    checkBtn.onclick = async () => {
      checkBtn.disabled = true;
      checkBtn.textContent = 'Starting...';
      const res = await fetch(api.checkin, {method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({action:'start'})});
      const j = await res.json();
      if (res.ok) {
        me.movementStarts[idx] = j.startedAt;
        updateUIFromMe();
      } else {
        checkBtn.disabled = false;
        checkBtn.textContent = 'Start snail movement';
        statusMsg.textContent = j.error || 'Error starting';
      }
    };
  } else {
    // started but not completed
    const elapsed = now - startedAt;
    if (elapsed < moveDurationMs) {
      const need = moveDurationMs - elapsed;
      checkBtn.disabled = true;
      const h = Math.floor(need / (3600*1000));
      const m = Math.floor((need % (3600*1000)) / (60*1000));
      const s = Math.floor((need % (60*1000)) / 1000);
      checkBtn.textContent = `Please wait: ${h}h ${m}m ${s}s until check-in`;
      statusMsg.textContent = 'After starting, the movement lasts 4 hours — then you can check in.';
      // start a small timer to update countdown and position
      startCountdownTimer();
    } else {
      checkBtn.disabled = false;
      checkBtn.textContent = 'Check in at point';
      statusMsg.textContent = 'You can check in — the snail has completed its journey.';
      checkBtn.onclick = async () => {
        checkBtn.disabled = true;
        checkBtn.textContent = 'Checking in...';
        const res = await fetch(api.checkin, {method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({action:'finish'})});
        const j = await res.json();
        if (res.ok) {
          // reload me
          await fetchMe();
        } else {
          checkBtn.disabled = false;
          checkBtn.textContent = 'Check in at point';
          if (j.error === 'too_early') {
            statusMsg.textContent = 'Please wait a bit longer.';
          } else {
            statusMsg.textContent = j.error || 'Error checking in';
          }
        }
      };
    }
  }

  updateSnailPosition();
}

let countdownInterval = null;
function startCountdownTimer(){
  if (countdownInterval) return;
  countdownInterval = setInterval(() => {
    updateUIFromMe();
    // update snail animation position as time passes too
    updateSnailPosition();
    // stop when not in countdown anymore
    const idx = currentDay - 1;
    if (!me || !me.movementStarts || !me.movementStarts[idx]) {
      clearInterval(countdownInterval);
      countdownInterval = null;
    }
  }, 1000);
}

// initial
(async function init(){
  await fetchState();
  await fetchMe();
  // update snail regularly for smoother animation
  setInterval(() => {
    updateSnailPosition();
  }, 1000);
  window.addEventListener('resize', updateSnailPosition);
})();
