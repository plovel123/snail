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

function buildGuestStatuses() {
  return points.map((_, i) => (i === 0 ? 'completed' : i === 1 ? 'today' : 'future'));
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

function positionPoints() {
  const frame = getMapFrame();
  const nodes = layer.querySelectorAll('.point');

  nodes.forEach((node, i) => {
    const pos = pathPointToPixels(points[i], frame);
    node.style.left = `${pos.x}px`;
    node.style.top = `${pos.y}px`;
  });
}

function getSnailState() {
  const lastIdx = points.length - 1;
  const activeMove = me?.activeMove;

  if (!activeMove) {
    const currentIdx = Math.min(Math.max(me?.completedCount ?? 0, 0), lastIdx);
    const at = points[currentIdx];
    const lookAhead = points[Math.min(lastIdx, currentIdx + 1)] || at;
    return {
      pathPosition: at,
      angle: angleBetween(at, lookAhead)
    };
  }

  const from = points[activeMove.fromIdx] || points[0];
  const to = points[activeMove.toIdx] || from;
  const control = arcControls[activeMove.fromIdx] || lerpPoint(from, to, 0.5);
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

  const lastIdx = points.length - 1;
  const isFinished = (me?.completedCount ?? 0) >= lastIdx && !me?.activeMove;

  if (!me?.authenticated) {
    checkBtn.disabled = true;
    checkBtn.dataset.action = 'login';
    checkBtn.textContent = 'Войдите через Twitter';
    statusMsg.textContent = 'Для отметки нужен вход.';
    return;
  }

  if (isFinished) {
    checkBtn.disabled = true;
    checkBtn.dataset.action = 'done';
    checkBtn.textContent = 'Маршрут завершён';
    statusMsg.textContent = 'Отлично! Все точки уже пройдены.';
    return;
  }

  if (!me.activeMove) {
    checkBtn.disabled = false;
    checkBtn.dataset.action = 'start';
    checkBtn.textContent = 'Начать путь';
    statusMsg.textContent = 'Можно сразу начинать следующий путь.';
    return;
  }

  const elapsed = Date.now() - me.activeMove.startedAt;
  const remaining = state.moveDurationMs - elapsed;

  if (remaining <= 0) {
    checkBtn.disabled = false;
    checkBtn.dataset.action = 'finish';
    checkBtn.textContent = 'Завершить отметку';
    statusMsg.textContent = 'Улитка добралась до точки, можно завершить отметку.';
    return;
  }

  const mins = Math.ceil(remaining / 60000);
  checkBtn.disabled = true;
  checkBtn.dataset.action = 'wait';
  checkBtn.textContent = `В пути ещё ${mins} мин`;
  statusMsg.textContent = 'Движение начато. Кнопка станет активной позже.';
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
  if (frameTimer) {
    cancelAnimationFrame(frameTimer);
  }

  const tick = () => {
    moveSnail();
    frameTimer = requestAnimationFrame(tick);
  };

  frameTimer = requestAnimationFrame(tick);

  if (buttonTickTimer) {
    clearInterval(buttonTickTimer);
  }

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

function updateProgressHeader() {
  const nextPoint = Math.min(points.length - 1, (me?.completedCount ?? 0) + 1);
  dayInfo.textContent = `Точка ${nextPoint + 1} / ${points.length}`;
}

async function load() {
  try {
    await waitForBackground();

    state = await fetch(api.state).then((r) => r.json());
    me = await fetch(api.me).then((r) => r.json());

    points = Array.isArray(state.points) && state.points.length ? state.points : DEFAULT_POINTS;
    arcControls = Array.isArray(state.arcControls) && state.arcControls.length ? state.arcControls : DEFAULT_ARC_CONTROLS;

    updateProgressHeader();

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
      ? 'Старт сохранён. Улитка уже ползёт к следующей точке.'
      : 'Готово! Можно сразу запускать следующий путь.';
    await load();
  } catch (error) {
    checkBtn.textContent = originalLabel;
    statusMsg.textContent = `Ошибка: ${error.message}`;
    updateCheckinButton();
  }
});

window.addEventListener('resize', rerenderTrack);

load();