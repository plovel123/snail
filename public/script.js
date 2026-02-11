// ====== CONFIG ======
// 👉 вот тут ты будешь подгонять координаты под свой фон
// проценты от ширины/высоты карты
const POINTS = [
  {x:8, y:82},
  {x:22, y:60},
  {x:36, y:48},
  {x:52, y:38},
  {x:66, y:48},
  {x:82, y:60},
  {x:94, y:44}
];

// ====================
const api = {
  state: '/api/state',
  me: '/api/me',
  checkin: '/api/checkin',
  logout: '/auth/logout'
};
const assets = {
  base:'/assets/base.png',
  succ:'/assets/succ.png',
  fail:'/assets/fail.png'
};

const map = document.getElementById('map');
const layer = document.getElementById('pointsLayer');
const snail = document.getElementById('snail');
const checkBtn = document.getElementById('checkBtn');
const dayInfo = document.getElementById('dayInfo');
const statusMsg = document.getElementById('statusMsg');
const userName = document.getElementById('userName');
const loginBtn = document.getElementById('loginBtn');

let me, state;

function percentToPx(xp, yp){
  return {
    x: xp/100 * map.clientWidth,
    y: yp/100 * map.clientHeight
  };
}

function createPoints(statuses){
  layer.innerHTML = '';

  POINTS.forEach((p,i)=>{
    const el = document.createElement('div');
    el.className='point';

    const img = document.createElement('img');

    const st = statuses?.[i] || 'future';

    if(st==='completed') img.src = assets.succ;
    else if(st==='missed') img.src = assets.fail;
    else img.src = assets.base;

    el.appendChild(img);

    el.style.left = p.x+'%';
    el.style.top = p.y+'%';

    layer.appendChild(el);
  });
}

function moveSnail(){
  if(!me) return;

  const day = state.currentDay;
  const idx = day-1;
  const prevIdx = Math.max(0, idx-1);

  let from = POINTS[prevIdx];
  let to = POINTS[idx];

  let pos;

  const started = me.movementStarts[idx];

  if(started){
    const t = Math.min(1,(Date.now()-started)/state.moveDurationMs);
    pos = {
      x: from.x + (to.x-from.x)*t,
      y: from.y + (to.y-from.y)*t
    };
  }else{
    pos = from;
  }

  snail.style.left = pos.x+'%';
  snail.style.top = pos.y+'%';
}

async function load(){
  state = await fetch('/api/state').then(r=>r.json());
  me = await fetch('/api/me').then(r=>r.json());

  if(!me.authenticated){
    userName.textContent='Гость';
    checkBtn.disabled=true;
    return;
  }

  userName.textContent='@'+me.username;

  createPoints(me.statuses);

  dayInfo.textContent = `День ${state.currentDay} / ${state.totalDays}`;

  moveSnail();

  setInterval(moveSnail,1000);
}

load();
