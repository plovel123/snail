const DEFAULT_START_POINT = { x: 3.5, y: 50.6 };

const DEFAULT_POINTS = [
  { x: 16, y: 22 },
  { x: 25, y: 61 },
  { x: 39, y: 53 },
  { x: 51.5, y: 35 },
  { x: 69.3, y: 50 },
  { x: 80, y: 22 },
  { x: 93, y: 50 }
];

const DEFAULT_ARC_CONTROLS = [
    { x: 50, y: 50 },
  { x: 13, y: 49 },
  { x: 31, y: 66 },
  { x: 47, y: 44 },
  { x: 60, y: 32 },
  { x: 76, y: 38 },
  { x: 89, y: 31 }
];

const api = {
  state: '/api/state',
  me: '/api/me',
  checkin: '/api/checkin',
  logout: '/auth/logout'
};

const assets = {
  base: '/assets/base.png',
  succ: '/assets/succ.png',
  fail: '/assets/fail.png'
};

const SNAIL_ROTATION_OFFSET_DEG = 0;

const map = document.getElementById('map');
const mapBg = document.querySelector('.map-bg');
const layer = document.getElementById('pointsLayer');
const routeOverlay = document.getElementById('routeOverlay');
const routePath = document.getElementById('routePath');
const startPointEl = document.getElementById('startPoint');
const snail = document.getElementById('snail');
const checkBtn = document.getElementById('checkBtn');
const dayInfo = document.getElementById('dayInfo');
const statusMsg = document.getElementById('statusMsg');
const userName = document.getElementById('userName');
const loginBtn = document.getElementById('loginBtn');

let me;
let state;
let startPoint = DEFAULT_START_POINT;
let points = DEFAULT_POINTS;
let fullPathPoints = [DEFAULT_START_POINT, ...DEFAULT_POINTS];
let arcControls = DEFAULT_ARC_CONTROLS;
let frameTimer;
let buttonTickTimer;
let appInitialized = false;

function isTouchDevice() {
  return navigator.maxTouchPoints > 0 || window.matchMedia('(pointer: coarse)').matches;
}

function isMobileDevice() {
  const ua = navigator.userAgent || '';
  return /Android|iPhone|iPad|iPod|Mobile|Opera Mini|IEMobile/i.test(ua) || isTouchDevice();
}

function isLandscape() {
  return window.matchMedia('(orientation: landscape)').matches || window.innerWidth > window.innerHeight;
}

function shouldLockByOrientation() {
  return isMobileDevice() && !isLandscape();
}
function buildGuestStatuses() {
  return points.map((_, i) => (i === 0 ? 'today' : 'future'));
}

function getMapFrame() {
  const mapW = map.clientWidth;
  const mapH = map.clientHeight;
  const imgW = mapBg.naturalWidth || 1920;
  const imgH = mapBg.naturalHeight || 1080;

  const scale = Math.max(mapW / imgW, mapH / imgH);
  const drawW = imgW * scale;
  const drawH = imgH * scale;

  return {
    left: (mapW - drawW) / 2,
    top: (mapH - drawH) / 2,
    width: drawW,
    height: drawH
  };
}

function pathPointToPixels(point, frame = getMapFrame()) {
  return {
    x: frame.left + frame.width * (point.x / 100),
    y: frame.top + frame.height * (point.y / 100)
  };
}

function lerpPoint(a, b, t) {
  return {
    x: a.x + (b.x - a.x) * t,
    y: a.y + (b.y - a.y) * t
  };
}

function angleBetween(a, b) {
  return Math.atan2(b.y - a.y, b.x - a.x) * 180 / Math.PI;
}

function quadraticBezierPoint(a, c, b, t) {
  const oneMinus = 1 - t;
  return {
    x: oneMinus * oneMinus * a.x + 2 * oneMinus * t * c.x + t * t * b.x,
    y: oneMinus * oneMinus * a.y + 2 * oneMinus * t * c.y + t * t * b.y
  };
}

function quadraticBezierTangent(a, c, b, t) {
  return {
    x: 2 * (1 - t) * (c.x - a.x) + 2 * t * (b.x - c.x),
    y: 2 * (1 - t) * (c.y - a.y) + 2 * t * (b.y - c.y)
  };
}

function toPathIndex(pointIndex) {
  return pointIndex + 1;
}

function createPoints(statuses) {
  layer.innerHTML = '';

  points.forEach((_, i) => {
    const el = document.createElement('div');
    el.className = 'point';

    const img = document.createElement('img');
    const st = statuses?.[i] || 'future';

    if (st === 'completed') img.src = assets.succ;
    else if (st === 'missed') img.src = assets.fail;
    else img.src = assets.base;

    img.alt = `point-${i + 1}-${st}`;

    el.appendChild(img);
    layer.appendChild(el);
  });

  positionPoints();
}

function drawRoute() {
  const frame = getMapFrame();
  routeOverlay.setAttribute('viewBox', `0 0 ${map.clientWidth} ${map.clientHeight}`);

  if (fullPathPoints.length < 2) {
    routePath.setAttribute('d', '');
    return;
  }

  const first = pathPointToPixels(fullPathPoints[0], frame);
  const segments = [`M ${first.x} ${first.y}`];

  for (let i = 0; i < fullPathPoints.length - 1; i += 1) {
    const to = pathPointToPixels(fullPathPoints[i + 1], frame);
    const controlPoint = arcControls[i] || lerpPoint(fullPathPoints[i], fullPathPoints[i + 1], 0.5);
    const control = pathPointToPixels(controlPoint, frame);

    segments.push(`Q ${control.x} ${control.y} ${to.x} ${to.y}`);
  }

  routePath.setAttribute('d', segments.join(' '));
}


function positionPoints() {
  const frame = getMapFrame();
  const nodes = layer.querySelectorAll('.point');

  nodes.forEach((node, i) => {
    const pos = pathPointToPixels(points[i], frame);
    node.style.left = `${pos.x}px`;
    node.style.top = `${pos.y}px`;
  });
    const startPos = pathPointToPixels(startPoint, frame);
  startPointEl.style.left = `${startPos.x}px`;
  startPointEl.style.top = `${startPos.y}px`;

  drawRoute();
}

function getSnailState() {
  const activeMove = me?.activeMove;

  if (!activeMove) {
    const currentPathIdx = Math.min(Math.max(toPathIndex(me?.completedCount ?? -1), 0), fullPathPoints.length - 1);
    const at = fullPathPoints[currentPathIdx];

    if (currentPathIdx < fullPathPoints.length - 1) {
      return {
        pathPosition: at,
        angle: angleBetween(at, fullPathPoints[currentPathIdx + 1])
      };
    }

    const previous = fullPathPoints[Math.max(0, currentPathIdx - 1)] || at;
    return {
      pathPosition: at,
      angle: angleBetween(previous, at)
    };
  }

  const fromPathIdx = toPathIndex(activeMove.fromIdx);
  const toPathIdx = toPathIndex(activeMove.toIdx);
  const from = fullPathPoints[fromPathIdx] || fullPathPoints[0];
  const to = fullPathPoints[toPathIdx] || from;
  const control = arcControls[fromPathIdx] || lerpPoint(from, to, 0.5);
  const elapsed = Date.now() - activeMove.startedAt;
  const progress = Math.min(1, Math.max(0, elapsed / state.moveDurationMs));
  const posOnPath = quadraticBezierPoint(from, control, to, progress);
  const tangent = quadraticBezierTangent(from, control, to, progress);

  return {
    pathPosition: posOnPath,
    angle: Math.atan2(tangent.y, tangent.x) * 180 / Math.PI
  };
}

function moveSnail() {
if (!state || fullPathPoints.length === 0) return;

  const frame = getMapFrame();
  const snailState = getSnailState();
  const pixelPos = pathPointToPixels(snailState.pathPosition, frame);

  snail.style.left = `${pixelPos.x}px`;
  snail.style.top = `${pixelPos.y}px`;
  snail.style.transform = `translate(-50%, -50%) rotate(${snailState.angle + SNAIL_ROTATION_OFFSET_DEG}deg)`;
}

function updateCheckinButton() {
  if (!state) return;

  const isFinished = (me?.completedCount ?? -1) >= points.length - 1 && !me?.activeMove;

  if (!me?.authenticated) {
    checkBtn.disabled = true;
    checkBtn.dataset.action = 'login';
    checkBtn.textContent = 'Sign in with Twitter';
    statusMsg.textContent = 'Sign in is required to check in.';
    return;
  }

  if (isFinished) {
    checkBtn.disabled = true;
    checkBtn.dataset.action = 'done';
    checkBtn.textContent = 'Route completed';
    statusMsg.textContent = 'Great! All points are already completed.';
    return;
  }

  if (!me.activeMove) {
    checkBtn.disabled = false;
    checkBtn.dataset.action = 'start';
    checkBtn.textContent = 'Start moving';
    statusMsg.textContent = 'You can start the next move now.';
    return;
  }

  const elapsed = Date.now() - me.activeMove.startedAt;
  const remaining = state.moveDurationMs - elapsed;

  if (remaining <= 0) {
    checkBtn.disabled = false;
    checkBtn.dataset.action = 'finish';
    checkBtn.textContent = 'Finish check-in';
    statusMsg.textContent = 'The snail reached the point. You can finish check-in.';
    return;
  }

  const mins = Math.ceil(remaining / 60000);
  checkBtn.disabled = true;
  checkBtn.dataset.action = 'wait';
  checkBtn.textContent = `Another ${mins} min on the way`;
  statusMsg.textContent = 'Moving....';
}

async function submitCheckin(action) {
  const response = await fetch(api.checkin, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action })
  });

  const payload = await response.json();
  if (!response.ok) {
    throw new Error(payload.error || 'checkin_failed');
  }
}

function stopTicker() {
  if (frameTimer) {
    cancelAnimationFrame(frameTimer);
    frameTimer = null;
  }

  if (buttonTickTimer) {
    clearInterval(buttonTickTimer);
    buttonTickTimer = null;
  }
}

function startTicker() {
  stopTicker();

  const tick = () => {
    moveSnail();
    frameTimer = requestAnimationFrame(tick);
  };

  frameTimer = requestAnimationFrame(tick);
  buttonTickTimer = setInterval(updateCheckinButton, 1000);
}

function rerenderTrack() {
   if (!appInitialized) return;
  positionPoints();
  moveSnail();
}

function waitForBackground() {
  if (mapBg.complete && mapBg.naturalWidth > 0) {
    return Promise.resolve();
  }

  return new Promise((resolve) => {
    mapBg.addEventListener('load', resolve, { once: true });
  });
}

function updateProgressHeader() {
  const nextPoint = Math.min(points.length, Math.max(1, (me?.completedCount ?? -1) + 2));
  dayInfo.textContent = `Point ${nextPoint} / ${points.length}`;
}

async function load() {
  try {
    await waitForBackground();

    state = await fetch(api.state).then((r) => r.json());
    me = await fetch(api.me).then((r) => r.json());
    startPoint = state.startPoint || DEFAULT_START_POINT;
    points = Array.isArray(state.points) && state.points.length ? state.points : DEFAULT_POINTS;
    fullPathPoints = [startPoint, ...points];

    const fallbackArcControls = [DEFAULT_ARC_CONTROLS[0], ...DEFAULT_ARC_CONTROLS.slice(1, points.length)];
    arcControls = Array.isArray(state.arcControls) && state.arcControls.length >= fullPathPoints.length - 1
      ? state.arcControls
      : fallbackArcControls;

    updateProgressHeader();

    if (!me.authenticated) {
      userName.textContent = 'Guest';
      loginBtn.style.display = 'inline-flex';
      createPoints(buildGuestStatuses());
      rerenderTrack();
      updateCheckinButton();
      startTicker();
      return;
    }

    userName.textContent = `@${me.username}`;
    loginBtn.style.display = 'none';

    createPoints(me.statuses);
    rerenderTrack();
    updateCheckinButton();
    startTicker();
  } catch (error) {
    checkBtn.disabled = true;
     checkBtn.textContent = 'Loading error';
    statusMsg.textContent = `Failed to load data: ${error.message}`;
  }
}

function handleCheckinClick() {
  return async () => {
    if (checkBtn.disabled || !me?.authenticated) return;

    const action = checkBtn.dataset.action;
    if (action !== 'start' && action !== 'finish') return;

    checkBtn.disabled = true;
    const originalLabel = checkBtn.textContent;
    checkBtn.textContent = 'Saving...';

    try {
      await submitCheckin(action);
      statusMsg.textContent = action === 'start'
        ? 'Start saved. The snail is already moving to the next point.'
        : 'Done! You can immediately start the next move.';
      await load();
    } catch (error) {
      checkBtn.textContent = originalLabel;
      statusMsg.textContent = `Error: ${error.message}`;
      updateCheckinButton();
    }
  };
}

const onCheckinClick = handleCheckinClick();

function setOrientationGateState(isLocked) {
  document.body.classList.toggle('mobile-portrait-lock', isLocked);
}

function activateAppIfNeeded() {
  if (!appInitialized) {
    appInitialized = true;
    load();
  }
}

function handleOrientation() {
  const locked = shouldLockByOrientation();
  setOrientationGateState(locked);

  if (locked) {
    stopTicker();
    return;
  }

  activateAppIfNeeded();
  rerenderTrack();
  if (appInitialized && !buttonTickTimer) {
    startTicker();
  }
}

checkBtn.addEventListener('click', onCheckinClick);
window.addEventListener('resize', () => {
  handleOrientation();
});
window.addEventListener('orientationchange', handleOrientation);

handleOrientation();