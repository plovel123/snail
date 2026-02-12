const DEFAULT_POINTS = [
  { x: 10, y: 84 },
  { x: 22, y: 66 },
  { x: 35, y: 54 },
  { x: 49, y: 46 },
  { x: 63, y: 53 },
  { x: 78, y: 64 },
  { x: 90, y: 52 }
];

// One control point per segment: 0->1, 1->2, ..., 5->6.
// Tweak these percentages to bend the snail path into better arcs for your map.
const DEFAULT_ARC_CONTROLS = [
  { x: 16, y: 74 },
  { x: 28, y: 58 },
  { x: 42, y: 47 },
  { x: 56, y: 47 },
  { x: 70, y: 58 },
  { x: 84, y: 59 }
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

const map = document.getElementById('map');
const mapBg = document.querySelector('.map-bg');
const layer = document.getElementById('pointsLayer');
const snail = document.getElementById('snail');
const checkBtn = document.getElementById('checkBtn');
const dayInfo = document.getElementById('dayInfo');
const statusMsg = document.getElementById('statusMsg');
const userName = document.getElementById('userName');
const loginBtn = document.getElementById('loginBtn');

let me;
let state;
let points = DEFAULT_POINTS;
let arcControls = DEFAULT_ARC_CONTROLS;
let frameTimer;
let buttonTickTimer;

function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}

function currentIdx() {
  const baseDay = me?.authenticated ? me.currentDay : state?.currentDay;
  const day = baseDay || 1;
  return clamp(day - 1, 0, points.length - 1);
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

function angleBetween(a, b) {
  return Math.atan2(b.y - a.y, b.x - a.x) * 180 / Math.PI;
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

    img.alt = `day-${i + 1}-${st}`;
    el.appendChild(img);
    layer.appendChild(el);
  });

  positionPoints();
}

function positionPoints() {
  const frame = getMapFrame();
  const nodes = layer.querySelectorAll('.point');

  nodes.forEach((node, i) => {
    const pos = pathPointToPixels(points[i], frame);
    node.style.left = `${pos.x}px`;
    node.style.top = `${pos.y}px`;
  });
}

function getLastCompletedIdx() {
  if (!me?.authenticated || !Array.isArray(me.checkins)) return 0;
  for (let i = me.checkins.length - 1; i >= 0; i -= 1) {
    if (me.checkins[i]) return i;
  }
  return 0;
}

function quadraticBezier(a, c, b, t) {
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

function getSegmentControl(fromIdx, toIdx) {
  const segmentIdx = Math.min(fromIdx, toIdx);
  return arcControls[segmentIdx] || {
    x: (points[fromIdx].x + points[toIdx].x) / 2,
    y: (points[fromIdx].y + points[toIdx].y) / 2
  };
}

function getSnailState() {
  if (!me?.authenticated) {
    const idle = points[0];
    return {
      pathPosition: idle,
      angle: 0
    };
  }

  const targetIdx = currentIdx();
  const allDone = me.checkins?.every(Boolean);
  const lastCompletedIdx = getLastCompletedIdx();

  if (allDone) {
    const lastPoint = points[points.length - 1];
    return {
      pathPosition: lastPoint,
      angle: 0
    };
  }

  const startIdx = Math.max(0, Math.min(lastCompletedIdx, targetIdx));
  const fromIdx = me.checkins?.[targetIdx] ? targetIdx : startIdx;
  const toIdx = targetIdx;

  const from = points[fromIdx];
  const to = points[toIdx] || from;

  const startedAt = me.movementStarts?.[toIdx];
  if (!startedAt) {
    const idlePoint = me.checkins?.[toIdx] ? to : from;
    const nextDirection = points[Math.min(points.length - 1, toIdx + 1)] || idlePoint;
    return {
      pathPosition: idlePoint,
      angle: angleBetween(idlePoint, nextDirection)
    };
  }

  const progress = clamp((Date.now() - startedAt) / state.moveDurationMs, 0, 1);
  const control = getSegmentControl(fromIdx, toIdx);
  const posOnArc = quadraticBezier(from, control, to, progress);
  const tangent = quadraticBezierTangent(from, control, to, progress);
  const heading = {
    x: posOnArc.x + tangent.x,
    y: posOnArc.y + tangent.y
  };

  return {
    pathPosition: posOnArc,
    angle: angleBetween(posOnArc, heading)
  };
}

function moveSnail() {
  if (!state || points.length === 0) return;

  const frame = getMapFrame();
  const snailState = getSnailState();
  const pixelPos = pathPointToPixels(snailState.pathPosition, frame);

  snail.style.left = `${pixelPos.x}px`;
  snail.style.top = `${pixelPos.y}px`;
  snail.style.transform = `translate(-50%, -50%) rotate(${snailState.angle}deg)`;
}

function updateCheckinButton() {
  if (!state) return;

  if (!me?.authenticated) {
    checkBtn.disabled = true;
    checkBtn.dataset.action = 'login';
    checkBtn.textContent = 'Войдите через Twitter';
    statusMsg.textContent = 'Для отметки нужен вход.';
    return;
  }

  const idx = currentIdx();
  const allDone = me.checkins?.every(Boolean);

  if (allDone) {
    checkBtn.disabled = true;
    checkBtn.dataset.action = 'done';
    checkBtn.textContent = 'Маршрут пройден';
    statusMsg.textContent = 'Вы завершили все точки.';
    return;
  }

  if (me.checkins?.[idx]) {
    checkBtn.disabled = true;
    checkBtn.dataset.action = 'done';
    checkBtn.textContent = 'Точка завершена';
    statusMsg.textContent = 'Обновляем прогресс...';
    return;
  }

  if (!me.movementStarts?.[idx]) {
    checkBtn.disabled = false;
    checkBtn.dataset.action = 'start';
    checkBtn.textContent = 'Начать путь';
    statusMsg.textContent = 'Можно сразу начать путь к следующей точке.';
    return;
  }

  const elapsed = Date.now() - me.movementStarts[idx];
  const remaining = state.moveDurationMs - elapsed;

  if (remaining <= 0) {
    checkBtn.disabled = false;
    checkBtn.dataset.action = 'finish';
    checkBtn.textContent = 'Завершить точку';
    statusMsg.textContent = 'Путь завершён, можно засчитать точку.';
    return;
  }

  const hours = Math.floor(remaining / 3600000);
  const mins = Math.ceil((remaining % 3600000) / 60000);
  checkBtn.disabled = true;
  checkBtn.dataset.action = 'wait';
  checkBtn.textContent = `Осталось ${hours}ч ${mins}м`;
  statusMsg.textContent = 'Улитка в пути. Дождитесь завершения таймера.';
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

function startTicker() {
  if (frameTimer) cancelAnimationFrame(frameTimer);

  const tick = () => {
    moveSnail();
    frameTimer = requestAnimationFrame(tick);
  };

  frameTimer = requestAnimationFrame(tick);

  if (buttonTickTimer) clearInterval(buttonTickTimer);
  buttonTickTimer = setInterval(updateCheckinButton, 1000);
}

function rerenderTrack() {
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

async function load() {
  try {
    await waitForBackground();

    state = await fetch(api.state).then((r) => r.json());
    me = await fetch(api.me).then((r) => r.json());

    points = Array.isArray(state.points) && state.points.length ? state.points : DEFAULT_POINTS;
    arcControls = Array.isArray(state.arcControls) && state.arcControls.length ? state.arcControls : DEFAULT_ARC_CONTROLS;

    const uiDay = me?.authenticated ? me.currentDay : state.currentDay;
    dayInfo.textContent = `День ${uiDay} / ${state.totalDays}`;

    if (!me.authenticated) {
      userName.textContent = 'Гость';
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
    checkBtn.textContent = 'Ошибка загрузки';
    statusMsg.textContent = `Не удалось загрузить данные: ${error.message}`;
  }
}

checkBtn.addEventListener('click', async () => {
  if (checkBtn.disabled || !me?.authenticated) return;

  const action = checkBtn.dataset.action;
  if (action !== 'start' && action !== 'finish') return;

  checkBtn.disabled = true;
  const originalLabel = checkBtn.textContent;
  checkBtn.textContent = 'Сохраняем...';

  try {
    await submitCheckin(action);
    statusMsg.textContent = action === 'start'
      ? 'Путь начат. Улитка поползла к следующей точке.'
      : 'Точка завершена. Можно сразу начинать следующую.';
    await load();
  } catch (error) {
    checkBtn.textContent = originalLabel;
    statusMsg.textContent = `Ошибка: ${error.message}`;
    updateCheckinButton();
  }
});

window.addEventListener('resize', rerenderTrack);

load();