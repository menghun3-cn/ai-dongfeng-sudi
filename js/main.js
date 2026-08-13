/* ============================================================================
 * 东风速递导弹 3C —— 全球打击演练
 * 纯 three.js (r159 UMD) 实现，无其它依赖，可直接双击 index.html 打开
 *
 * 玩法：左侧面板选择/输入全球目标坐标 -> 点击发射 -> 3 秒倒计时
 *       -> 导弹沿弹道飞向目标 -> 命中爆炸 -> 积分
 * ========================================================================== */
'use strict';

// ---------------- 常量 ----------------
const R = 1;                        // 地球半径（单位球）
const LAUNCH = { lat: 39.1, lon: 111.8 };          // 发射阵地：五寨基地
const DEMO_TARGET = { lat: 35.677219, lon: 139.747847, name: '东京' };  // 试玩目标（35°40'37.99"N / 139°44'52.25"E）
const MAX_TARGETS = 1;              // 待打击目标数量（单一红点）
const HIT_RADIUS = 2.0 * Math.PI / 180;   // 命中判定容差（角距 2°）
const SCORE_PER_HIT = 100;          // 单次命中得分
const MIN_RANGE = 0.03;             // 允许打击的最小角距（弧度），防止目标贴脸
const CAM_MIN = 1.6, CAM_MAX = 6.0; // 相机缩放范围

// ---------------- DOM 引用 ----------------
const $ = id => document.getElementById(id);
const wrap = $('sceneWrap');
const statusText = $('statusText');
const countdownEl = $('countdown');
const inpLon = $('inpLon'), inpLat = $('inpLat');
const btnLaunch = $('btnLaunch'), btnRandom = $('btnRandom');
const valHits = $('valHits'), valScore = $('valScore');
const logList = $('logList');
const floatScoreEl = $('floatScore'), flashEl = $('flash');

// ---------------- 渲染器 / 场景 / 相机 ----------------
const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false });
renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
renderer.setSize(wrap.clientWidth, wrap.clientHeight);
renderer.outputEncoding = THREE.sRGBEncoding;
wrap.insertBefore(renderer.domElement, wrap.firstChild);

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x04070c);

const camera = new THREE.PerspectiveCamera(45, wrap.clientWidth / wrap.clientHeight, 0.01, 100);
const camState = { theta: 0.0, phi: 1.12, dist: 3.2 };   // 轨道控制参数
let camShake = 0;                                        // 爆炸震屏强度

// ---------------- 灯光 ----------------
scene.add(new THREE.AmbientLight(0x556677, 1.05));
const sun = new THREE.DirectionalLight(0xffffff, 1.4);
sun.position.set(5, 3, 4);
scene.add(sun);

// ---------------- 星空背景 ----------------
(function buildStars() {
  const n = 1400, pos = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    const r = 15 + Math.random() * 25;
    const u = Math.random() * 2 - 1, a = Math.random() * Math.PI * 2;
    const s = Math.sqrt(1 - u * u);
    pos[i * 3] = r * s * Math.cos(a);
    pos[i * 3 + 1] = r * u;
    pos[i * 3 + 2] = r * s * Math.sin(a);
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  const mat = new THREE.PointsMaterial({ color: 0xffffff, size: 0.035, sizeAttenuation: true, transparent: true, opacity: 0.85 });
  scene.add(new THREE.Points(geo, mat));
})();

// ---------------- 地球 ----------------
const earthGroup = new THREE.Group();
scene.add(earthGroup);

// 程序化兜底纹理（离线 / file:// 下也能看到可辨识的大陆轮廓）
function makeFallbackTexture() {
  const W = 1024, H = 512;
  const cvs = document.createElement('canvas');
  cvs.width = W; cvs.height = H;
  const ctx = cvs.getContext('2d');
  // 海洋渐变
  const g = ctx.createLinearGradient(0, 0, 0, H);
  g.addColorStop(0, '#0a2038');
  g.addColorStop(0.5, '#0d3a55');
  g.addColorStop(1, '#081a30');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, W, H);
  // 经纬网
  ctx.strokeStyle = 'rgba(130,200,255,0.10)';
  ctx.lineWidth = 1;
  for (let lon = -180; lon < 180; lon += 15) {
    ctx.beginPath(); ctx.moveTo((lon + 180) / 360 * W, 0); ctx.lineTo((lon + 180) / 360 * W, H); ctx.stroke();
  }
  for (let lat = -75; lat <= 75; lat += 15) {
    ctx.beginPath(); ctx.moveTo(0, (90 - lat) / 180 * H); ctx.lineTo(W, (90 - lat) / 180 * H); ctx.stroke();
  }
  // 大陆轮廓（粗略经纬多边形）
  const continents = [
    // 非洲
    [[37,-6],[36,10],[31,32],[11,43],[-5,41],[-15,38],[-26,34],[-35,20],[-34,16],[-20,13],[-11,9],[5,8],[15,-17],[27,-12],[35,-6]],
    // 欧洲
    [[36,-9],[43,-8],[46,-1],[51,2],[54,8],[58,11],[63,7],[66,13],[70,22],[71,28],[68,38],[62,42],[55,36],[52,32],[47,36],[42,38],[40,27],[38,22],[36,10]],
    // 亚洲
    [[71,28],[69,43],[71,55],[73,70],[76,95],[73,115],[72,135],[70,155],[66,168],[60,171],[53,160],[46,142],[38,136],[34,129],[36,122],[30,120],[22,121],[16,110],[10,107],[8,98],[14,95],[15,88],[11,84],[6,80],[0,74],[-7,76],[-9,85],[-1,92],[1,100],[5,104],[0,108],[-6,111],[-8,119],[-4,127],[0,132],[6,138],[12,144],[19,148],[25,152],[31,144],[34,131],[37,127],[40,132],[44,141],[49,150],[52,158],[58,162],[62,150],[57,140],[52,135],[48,142],[45,132],[42,127],[40,124]],
    // 北美洲
    [[71,-160],[58,-155],[60,-141],[72,-125],[75,-95],[69,-79],[60,-64],[50,-57],[45,-64],[42,-71],[38,-76],[30,-81],[25,-80],[20,-90],[18,-95],[24,-97],[28,-94],[30,-110],[28,-114],[32,-118],[38,-123],[42,-124],[47,-124],[54,-130],[60,-140]],
    // 南美洲
    [[12,-71],[8,-78],[4,-81],[0,-80],[-5,-82],[-11,-78],[-16,-75],[-20,-70],[-25,-68],[-30,-62],[-34,-59],[-40,-65],[-45,-66],[-51,-69],[-54,-66],[-52,-60],[-45,-62],[-38,-62],[-32,-53],[-25,-46],[-18,-40],[-12,-37],[-6,-35],[-1,-44],[0,-50],[5,-53],[10,-60]],
    // 澳大利亚
    [[-12,130],[-17,122],[-22,114],[-26,113],[-32,115],[-35,117],[-38,140],[-35,150],[-31,153],[-27,153],[-24,152],[-20,149],[-16,145],[-14,137]],
    // 格陵兰
    [[83,-32],[78,-68],[70,-54],[60,-43],[60,-20],[68,-18],[75,-20],[80,-25]]
  ];
  const XY = (lat, lon) => [(lon + 180) / 360 * W, (90 - lat) / 180 * H];
  ctx.lineJoin = 'round';
  for (const poly of continents) {
    ctx.beginPath();
    poly.forEach((p, i) => {
      const [x, y] = XY(p[0], p[1]);
      i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
    });
    ctx.closePath();
    ctx.fillStyle = 'rgba(74,150,92,0.85)';
    ctx.fill();
    ctx.strokeStyle = 'rgba(150,255,180,0.45)';
    ctx.lineWidth = 1;
    ctx.stroke();
  }
  // 极地冰盖
  ctx.fillStyle = 'rgba(215,240,235,0.55)';
  ctx.fillRect(0, 0, W, 14); ctx.fillRect(0, H - 20, W, 20);
  // 南极洲近似
  ctx.beginPath();
  for (let lon = -180; lon <= 180; lon += 6) {
    const [x, y] = XY(-66 + Math.random() * 4 - 2, lon);
    lon === -180 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
  }
  ctx.closePath();
  ctx.fillStyle = 'rgba(225,245,240,0.6)';
  ctx.fill();
  const tex = new THREE.CanvasTexture(cvs);
  tex.encoding = THREE.sRGBEncoding;
  return tex;
}

const earthMat = new THREE.MeshPhongMaterial({
  map: makeFallbackTexture(),
  specular: 0x333333, shininess: 8
});
const earth = new THREE.Mesh(new THREE.SphereGeometry(R, 96, 64), earthMat);
earthGroup.add(earth);

// 真实贴图：仅在 http(s) 环境下加载（file:// 下 WebGL 不允许跨源图片，保留程序化贴图）
if (location.protocol === 'http:' || location.protocol === 'https:') {
  new THREE.TextureLoader().load('assets/earth.jpg', tex => {
    tex.encoding = THREE.sRGBEncoding;
    earthMat.map = tex;
    earthMat.needsUpdate = true;
  }, undefined, () => { /* 加载失败则继续使用程序化贴图 */ });
}

// 大气层光晕
const atmos = new THREE.Mesh(
  new THREE.SphereGeometry(R * 1.04, 64, 48),
  new THREE.MeshBasicMaterial({ color: 0x7fc8ff, transparent: true, opacity: 0.14, side: THREE.BackSide, depthWrite: false })
);
earthGroup.add(atmos);

// 初始朝向：让发射阵地面向相机
earthGroup.rotation.y = (-90 - LAUNCH.lon) * Math.PI / 180;

// ---------------- 坐标转换工具 ----------------
// 经纬度 -> 单位球面上三维坐标（与 three.js 球体 UV 映射一致）
function latLonToVec3(lat, lon, r) {
  const phi = (90 - lat) * Math.PI / 180;
  const theta = (lon + 180) * Math.PI / 180;
  return new THREE.Vector3(
    -r * Math.sin(phi) * Math.cos(theta),
    r * Math.cos(phi),
    r * Math.sin(phi) * Math.sin(theta)
  );
}
// ---------------- 发射阵地标记 ----------------
const launchMark = (function () {
  const g = new THREE.Group();
  const ring = new THREE.Mesh(
    new THREE.RingGeometry(0.02, 0.032, 32),
    new THREE.MeshBasicMaterial({ color: 0x3fd674, transparent: true, opacity: 0.95, side: THREE.DoubleSide, depthWrite: false })
  );
  const core = new THREE.Mesh(
    new THREE.SphereGeometry(0.011, 12, 12),
    new THREE.MeshBasicMaterial({ color: 0x8dffb0 })
  );
  g.add(ring); g.add(core);
  const p = latLonToVec3(LAUNCH.lat, LAUNCH.lon, R * 1.002);
  g.position.copy(p);
  g.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), p.clone().normalize());
  earthGroup.add(g);
  return g;
})();

// ---------------- 目标系统（单一待打击红点） ----------------
const targets = [];          // 待打击目标（恒 1 个，红点）
let aimLat = 0, aimLon = 0;  // 瞄准坐标（导弹击打位置，地图上不显示）

function makeTargetMarker(target) {
  const g = new THREE.Group();
  const dot = new THREE.Mesh(
    new THREE.SphereGeometry(0.014, 14, 14),
    new THREE.MeshBasicMaterial({ color: 0xff2233 })
  );
  dot.userData.target = target;
  g.add(dot);
  earthGroup.add(g);
  target.group = g;
  target.dot = dot;
  updateMarkerPos(target);
}

// 根据红点经纬度摆放标记（法线朝外）
function updateMarkerPos(t) {
  const p = latLonToVec3(t.lat, t.lon, R * 1.002);
  t.group.position.copy(p);
  t.group.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), p.clone().normalize());
}

// 随机生成一个全球目标（避开极点与发射阵地附近）
function randomTarget() {
  let lat, lon, ok = false;
  for (let i = 0; i < 500 && !ok; i++) {
    lat = Math.random() * 160 - 80;
    lon = Math.random() * 360 - 180;
    const a = latLonToVec3(lat, lon, R).angleTo(latLonToVec3(LAUNCH.lat, LAUNCH.lon, R));
    if (Math.abs(lat) < 82 && a > MIN_RANGE * 2) ok = true;
  }
  return { lat, lon };
}

function spawnTarget() {
  const t = randomTarget();
  t.alive = true;
  targets.push(t);
  makeTargetMarker(t);
  return t;
}

function initTargets() {
  spawnTarget();
  randomizeAim();           // 初始瞄准随机：红点坐标对用户未知，需自行探寻
}

// 随机瞄准坐标（未必命中红点，玩家需观察红点位置自行微调）
function randomizeAim() {
  aimLat = Math.random() * 160 - 80;
  aimLon = Math.random() * 360 - 180;
  syncInputsFromAim();
}

// 瞄准坐标 <-> 输入框
function syncInputsFromAim() {
  inpLon.value = aimLon.toFixed(4);
  inpLat.value = aimLat.toFixed(4);
}
function applyInputToAim() {
  aimLon = THREE.MathUtils.clamp(parseFloat(inpLon.value) || 0, -180, 180);
  aimLat = THREE.MathUtils.clamp(parseFloat(inpLat.value) || 0, -90, 90);
  inpLon.value = aimLon.toFixed(4);
  inpLat.value = aimLat.toFixed(4);
}

// ---------------- 弹道计算 ----------------
// 从起点到终点的大圆路径 + 抛物线高度剖面（弹道导弹飞行弧线）
function buildTrajectory(from, to) {
  const pts = [];
  const N = 160;
  const range = from.angleTo(to);
  const apex = 0.06 + 0.32 * Math.min(1, range / Math.PI);   // 顶点高度（相对地球半径）
  const q = new THREE.Quaternion().setFromUnitVectors(from, to);
  const q0 = new THREE.Quaternion();
  const qi = new THREE.Quaternion();
  const dir = new THREE.Vector3();
  for (let i = 0; i <= N; i++) {
    const t = i / N;
    qi.copy(q0).slerp(q, t);                                  // 大圆路径旋转（r159 无 Vector3.slerp）
    dir.copy(from).applyQuaternion(qi);
    // 真实弹道高度剖面：快速上升 -> 高空平流层巡航平台 -> 末端再入俯冲
    const alt = apex * (1 - Math.pow(Math.abs(2 * t - 1), 5));
    pts.push(dir.clone().multiplyScalar(R * (1 + alt)));      // 必须 clone：push 引用会共享同一对象
  }
  return pts;
}

// ---------------- 发光纹理（尾焰 / 火球） ----------------
function makeGlowTexture(color) {
  const cvs = document.createElement('canvas');
  cvs.width = cvs.height = 64;
  const ctx = cvs.getContext('2d');
  const g = ctx.createRadialGradient(32, 32, 0, 32, 32, 32);
  g.addColorStop(0, '#ffffff');
  g.addColorStop(0.25, color);
  g.addColorStop(1, 'rgba(255,120,30,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 64, 64);
  return new THREE.CanvasTexture(cvs);
}

// ---------------- 导弹 3D 模型（程序化建模：两级弹体 + 鼻锥 + 涂装 + 梯形尾翼 + 喷口） ----------------
function buildMissileModel() {
  const g = new THREE.Group();
  const matBody = new THREE.MeshPhongMaterial({ color: 0xe8ece6, specular: 0x555555, shininess: 30 });
  const matAccent = new THREE.MeshPhongMaterial({ color: 0xc0202a, specular: 0x333333, shininess: 20 });
  const matDark = new THREE.MeshPhongMaterial({ color: 0x2b3338, specular: 0x444444, shininess: 25 });
  const matFin = new THREE.MeshPhongMaterial({ color: 0xc9d2cc, side: THREE.DoubleSide, specular: 0x333333, shininess: 20 });
  // 鼻锥（尖头）
  const nose = new THREE.Mesh(new THREE.ConeGeometry(0.016, 0.035, 14), matAccent);
  nose.position.y = 0.058;
  g.add(nose);
  // 二级弹体
  const stage2 = new THREE.Mesh(new THREE.CylinderGeometry(0.014, 0.014, 0.045, 14), matBody);
  stage2.position.y = 0.02;
  g.add(stage2);
  // 级间段
  const inter = new THREE.Mesh(new THREE.CylinderGeometry(0.0105, 0.0105, 0.012, 12), matDark);
  inter.position.y = -0.008;
  g.add(inter);
  // 一级弹体（底部微扩）
  const stage1 = new THREE.Mesh(new THREE.CylinderGeometry(0.018, 0.0195, 0.055, 14), matBody);
  stage1.position.y = -0.0415;
  g.add(stage1);
  // 一级红色环带
  const band = new THREE.Mesh(new THREE.CylinderGeometry(0.0183, 0.0183, 0.008, 14), matAccent);
  band.position.y = -0.052;
  g.add(band);
  // 尾裙
  const skirt = new THREE.Mesh(new THREE.CylinderGeometry(0.0195, 0.021, 0.014, 14), matDark);
  skirt.position.y = -0.065;
  g.add(skirt);
  // 梯形尾翼 ×4（竖直翼面含弹体轴线，翼根贴弹体表面、径向伸出）
  const finGeo = new THREE.BufferGeometry();
  finGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array([
    0, -0.064, 0.021,     // 翼根后缘（贴一级弹体表面）
    0, -0.042, 0.021,     // 翼根前缘
    0, -0.044, 0.0415,    // 翼尖前缘
    0, -0.058, 0.0415     // 翼尖后缘
  ]), 3));
  finGeo.setIndex(new THREE.BufferAttribute(new Uint16Array([0, 1, 2, 0, 2, 3]), 1));
  finGeo.computeVertexNormals();
  for (let i = 0; i < 4; i++) {
    const fin = new THREE.Mesh(finGeo, matFin);
    fin.rotation.y = i * Math.PI / 2;
    g.add(fin);
  }
  // 尾喷口
  const nozzle = new THREE.Mesh(new THREE.CylinderGeometry(0.008, 0.010, 0.010, 10), matDark);
  nozzle.position.y = -0.077;
  g.add(nozzle);
  return g;
}
const missile = new THREE.Group();
missile.add(buildMissileModel());
const flame = new THREE.Sprite(new THREE.SpriteMaterial({
  map: makeGlowTexture('#ffb24d'),
  blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, opacity: 0.9
}));
flame.scale.set(0.055, 0.10, 1);
flame.position.y = -0.088;
missile.add(flame);
missile.visible = false;
earthGroup.add(missile);

// ---------------- 爆炸特效 ----------------
const fireball = new THREE.Sprite(new THREE.SpriteMaterial({
  map: makeGlowTexture('#ff9a3d'),
  blending: THREE.AdditiveBlending, depthWrite: false, transparent: true
}));
fireball.visible = false;
earthGroup.add(fireball);

const shockRing = new THREE.Mesh(
  new THREE.RingGeometry(0.82, 0.9, 48),
  new THREE.MeshBasicMaterial({ color: 0xffd27a, transparent: true, opacity: 0.9, side: THREE.DoubleSide, depthWrite: false })
);
shockRing.visible = false;
earthGroup.add(shockRing);

const P_N = 90;
const pPos = new Float32Array(P_N * 3);
const pVel = new Float32Array(P_N * 3);
const pGeo = new THREE.BufferGeometry();
pGeo.setAttribute('position', new THREE.BufferAttribute(pPos, 3));
const pMat = new THREE.PointsMaterial({
  color: 0xffb35c, size: 0.022,
  blending: THREE.AdditiveBlending, transparent: true, depthWrite: false
});
const pPoints = new THREE.Points(pGeo, pMat);
pPoints.visible = false;
earthGroup.add(pPoints);

const boomLight = new THREE.PointLight(0xff9a3d, 0, 20, 2);
earthGroup.add(boomLight);

const explode = { active: false, t: 0, normal: new THREE.Vector3(0, 1, 0), origin: new THREE.Vector3() };

function spawnExplosion(point) {
  const normal = point.clone().normalize();
  explode.active = true; explode.t = 0;
  explode.normal.copy(normal);
  explode.origin.copy(point);
  // 火球
  fireball.visible = true;
  fireball.position.copy(point);
  fireball.scale.set(0.02, 0.02, 1);
  fireball.material.opacity = 1;
  // 冲击波
  shockRing.visible = true;
  shockRing.position.copy(point);
  shockRing.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), normal);
  shockRing.scale.set(0.2, 0.2, 1);
  shockRing.material.opacity = 0.95;
  // 碎片粒子
  pPoints.visible = true;
  const t1 = new THREE.Vector3(-normal.y, normal.x, 0);
  if (t1.lengthSq() < 1e-4) t1.set(1, 0, 0);
  t1.normalize();
  const t2 = new THREE.Vector3().crossVectors(normal, t1).normalize();
  for (let i = 0; i < P_N; i++) {
    const a = Math.random() * Math.PI * 2;
    const dir = t1.clone().multiplyScalar(Math.cos(a))
      .add(t2.clone().multiplyScalar(Math.sin(a)))
      .multiplyScalar(0.5 + Math.random() * 0.5)
      .add(normal.clone().multiplyScalar(0.3 + Math.random() * 0.4)).normalize();
    const sp = 0.06 + Math.random() * 0.14;
    pVel[i * 3] = dir.x * sp; pVel[i * 3 + 1] = dir.y * sp; pVel[i * 3 + 2] = dir.z * sp;
    pPos[i * 3] = point.x; pPos[i * 3 + 1] = point.y; pPos[i * 3 + 2] = point.z;
  }
  pGeo.attributes.position.needsUpdate = true;
  boomLight.position.copy(point);
  boomLight.intensity = 6;
}

function updateExplosions(dt) {
  if (!explode.active) {
    if (boomLight.intensity > 0.01) boomLight.intensity = Math.max(0, boomLight.intensity - dt * 30);
    return;
  }
  explode.t += dt;
  const t = explode.t;
  // 火球膨胀消散（贯穿 3 秒镜头）
  const fb = 0.02 + 1.2 * Math.min(1, t / 1.4);
  fireball.scale.set(fb, fb, 1);
  fireball.material.opacity = Math.max(0, 1 - t / 3.0);
  // 冲击波扩散
  const sr = 0.2 + 2.6 * Math.min(1, t / 1.1);
  shockRing.scale.set(sr, sr, 1);
  shockRing.material.opacity = Math.max(0, 0.95 * (1 - t / 1.6));
  // 碎片粒子飞行 + 衰减
  const pA = pGeo.attributes.position;
  for (let i = 0; i < P_N; i++) {
    pVel[i * 3] *= (1 - 0.9 * dt);
    pVel[i * 3 + 1] *= (1 - 0.9 * dt);
    pVel[i * 3 + 2] *= (1 - 0.9 * dt);
    pVel[i * 3] -= explode.normal.x * 0.5 * dt;
    pVel[i * 3 + 1] -= explode.normal.y * 0.5 * dt;
    pVel[i * 3 + 2] -= explode.normal.z * 0.5 * dt;
    pPos[i * 3] += pVel[i * 3] * dt;
    pPos[i * 3 + 1] += pVel[i * 3 + 1] * dt;
    pPos[i * 3 + 2] += pVel[i * 3 + 2] * dt;
  }
  pA.needsUpdate = true;
  pMat.opacity = Math.max(0, 1 - t / 3.0);
  boomLight.intensity = Math.max(0, 6 * (1 - t / 1.2));
  // 爆炸结束 -> 恢复待命
  if (t > 3.2) {
    explode.active = false;
    fireball.visible = false;
    shockRing.visible = false;
    pPoints.visible = false;
    state = State.READY;
    setStatus('待命', '');
    countdownEl.textContent = '--';
    btnLaunch.disabled = false;
    btnLaunch.textContent = '发 射';
    setInputsEnabled(true);
    syncInputsFromAim();
  }
}

// ---------------- 音效（WebAudio，无外部资源） ----------------
let AC = null;
function ensureAudio() {
  if (!AC) {
    const C = window.AudioContext || window.webkitAudioContext;
    if (C) AC = new C();
  }
  if (AC && AC.state === 'suspended') AC.resume();
}
function beep(freq, dur, type, vol) {
  if (!AC) return;
  const o = AC.createOscillator(), g = AC.createGain();
  o.type = type || 'square';
  o.frequency.value = freq;
  g.gain.setValueAtTime(vol || 0.15, AC.currentTime);
  g.gain.exponentialRampToValueAtTime(0.0001, AC.currentTime + dur);
  o.connect(g); g.connect(AC.destination);
  o.start(); o.stop(AC.currentTime + dur + 0.02);
}
function boom() {
  if (!AC) return;
  const dur = 1.4;
  const buf = AC.createBuffer(1, Math.floor(AC.sampleRate * dur), AC.sampleRate);
  const d = buf.getChannelData(0);
  for (let i = 0; i < d.length; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / d.length, 2);
  const src = AC.createBufferSource();
  src.buffer = buf;
  const f = AC.createBiquadFilter();
  f.type = 'lowpass';
  f.frequency.setValueAtTime(1000, AC.currentTime);
  f.frequency.exponentialRampToValueAtTime(50, AC.currentTime + dur);
  const g = AC.createGain();
  g.gain.setValueAtTime(0.6, AC.currentTime);
  g.gain.exponentialRampToValueAtTime(0.001, AC.currentTime + dur);
  src.connect(f); f.connect(g); g.connect(AC.destination);
  src.start();
  const o = AC.createOscillator();
  o.type = 'sine';
  o.frequency.setValueAtTime(110, AC.currentTime);
  o.frequency.exponentialRampToValueAtTime(28, AC.currentTime + 0.9);
  const og = AC.createGain();
  og.gain.setValueAtTime(0.7, AC.currentTime);
  og.gain.exponentialRampToValueAtTime(0.001, AC.currentTime + 1.0);
  o.connect(og); og.connect(AC.destination);
  o.start(); o.stop(AC.currentTime + 1.05);
}

// ---------------- 状态机 ----------------
const State = { READY: 0, COUNT: 1, FLIGHT: 2, IMPACT: 3 };
let state = State.READY;
let countdownT = 0, lastCountInt = 4;
let flightT = 0, flightDur = 0, impactT = 0;
let pathPts = [];
let score = 0, hits = 0, misses = 0;
let flightPhase = '';          // 当前飞行阶段（状态栏显示）

function setStatus(text, cls) {
  statusText.textContent = text;
  statusText.className = cls || '';
}
function setInputsEnabled(en) {
  btnRandom.disabled = !en;
  btnDemo.disabled = !en;
  inpLon.disabled = !en;
  inpLat.disabled = !en;
}

function startCountdown() {
  const from = latLonToVec3(LAUNCH.lat, LAUNCH.lon, R);
  const to = latLonToVec3(aimLat, aimLon, R);
  if (from.angleTo(to) < MIN_RANGE) {
    setStatus('目标过近，无法发射', 'warn');
    beep(160, 0.25, 'square', 0.2);
    return;
  }
  countdownT = 3; lastCountInt = 4;
  state = State.COUNT;
  setStatus('发射倒计时', 'warn');
  countdownEl.textContent = '3';
  btnLaunch.textContent = '取消发射';
  btnLaunch.disabled = false;
  setInputsEnabled(false);
  beep(880, 0.08, 'square', 0.12);
}
function cancelCountdown() {
  state = State.READY;
  countdownEl.textContent = '--';
  setStatus('待命', '');
  btnLaunch.textContent = '发 射';
  setInputsEnabled(true);
  beep(220, 0.12, 'square', 0.12);
}

function updateCountdown(dt) {
  countdownT -= dt;
  const ci = Math.max(0, Math.ceil(countdownT));
  if (ci !== lastCountInt) {
    lastCountInt = ci;
    countdownEl.textContent = String(ci);
    if (ci > 0) beep(880, 0.08, 'square', 0.12);
  }
  if (countdownT <= 0) launchMissile();
}

function launchMissile() {
  const from = latLonToVec3(LAUNCH.lat, LAUNCH.lon, R);
  const to = latLonToVec3(aimLat, aimLon, R);
  pathPts = buildTrajectory(from, to);
  const range = from.angleTo(to);
  flightDur = 3.2 + 6.5 * (range / Math.PI);   // 射程越远飞行越久（与目标距离强关联）
  flightT = 0;
  flightPhase = '';
  state = State.FLIGHT;
  setStatus('导弹飞行中', 'fire');
  countdownEl.textContent = '--';
  btnLaunch.disabled = true;
  btnLaunch.textContent = '飞行中';
  setInputsEnabled(false);
  missile.visible = true;
  missile.position.copy(pathPts[0]);
  const d0 = new THREE.Vector3().subVectors(pathPts[1], pathPts[0]).normalize();
  lastDir.copy(d0);
  missile.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), d0);
  beep(140, 0.5, 'sawtooth', 0.2);            // 点火音
}

function setFlightPhase(name, cls) {
  if (flightPhase !== name) {
    flightPhase = name;
    setStatus(name, cls);
  }
}

function updateFlight(dt) {
  flightT += dt;
  const t = Math.min(1, flightT / flightDur);
  // 阶段状态：与实际弹道剖面一致（上升 -> 平流层巡航 -> 再入下降）
  if (t < 0.22) setFlightPhase('上升阶段', 'fire');
  else if (t < 0.8) setFlightPhase('平流层巡航', 'warn');
  else setFlightPhase('再入下降', 'fire');
  const idx = t * (pathPts.length - 1);
  const i = Math.floor(idx), f = idx - i;
  missile.position.lerpVectors(pathPts[i], pathPts[Math.min(i + 1, pathPts.length - 1)], f);
  const i2 = Math.min(i + 2, pathPts.length - 1);
  const dir = new THREE.Vector3().subVectors(pathPts[i2], pathPts[Math.max(0, i - 1)]).normalize();
  lastDir.copy(dir);
  missile.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir);
  const s = 1 + Math.sin(flightT * 30) * 0.25;  // 尾焰脉动
  flame.scale.set(0.05 * s, 0.09 * s, 1);
  if (t >= 1) triggerImpact();
}

function triggerImpact() {
  const impactPoint = latLonToVec3(aimLat, aimLon, R);   // 落点 = 瞄准坐标
  missile.getWorldPosition(impactWorld);                 // 记录爆点世界坐标（导弹此时位于终点）
  // 命中判定：落点与红点角距小于容差
  const t = targets[0];
  const isHit = t.alive &&
    latLonToVec3(aimLat, aimLon, R).angleTo(latLonToVec3(t.lat, t.lon, R)) < HIT_RADIUS;
  state = State.IMPACT;
  impactT = 0;
  btnLaunch.disabled = true;
  btnLaunch.textContent = '装填中…';
  missile.visible = false;
  if (isHit) {
    // 命中待打击目标：计分
    hits++; score += SCORE_PER_HIT;
    valHits.textContent = hits;
    valScore.textContent = score;
    addLog(t.lat, t.lon, true);
    showFloatScore();
    setStatus('命中目标！', 'warn');
    countdownEl.textContent = '+' + SCORE_PER_HIT;
    // 红点销毁，生成新红点（新坐标对用户未知，保留当前瞄准供参考）
    earthGroup.remove(t.group);
    t.alive = false;
    targets.length = 0;
    spawnTarget();
  } else {
    // 脱靶：不积分，红点保留
    misses++;
    addLog(aimLat, aimLon, false);
    setStatus('脱靶！未命中', 'warn');
    countdownEl.textContent = '脱靶';
  }
  // 特效（落点爆炸）
  spawnExplosion(impactPoint);
  boom();
  flashEl.classList.remove('flash-anim');
  void flashEl.offsetWidth;
  flashEl.classList.add('flash-anim');
  camShake = 1;
}

// ---------------- 战绩 UI ----------------
function addLog(lat, lon, isHit) {
  const E = lon >= 0 ? 'E' : 'W', N = lat >= 0 ? 'N' : 'S';
  const div = document.createElement('div');
  div.className = isHit ? 'log-hit' : 'log-miss';
  div.textContent = isHit
    ? '命中 ' + Math.abs(lat).toFixed(1) + '°' + N + ' / ' + Math.abs(lon).toFixed(1) + '°' + E + '  +' + SCORE_PER_HIT
    : '脱靶 ' + Math.abs(lat).toFixed(1) + '°' + N + ' / ' + Math.abs(lon).toFixed(1) + '°' + E;
  logList.insertBefore(div, logList.firstChild);
  const empty = logList.querySelector('.log-empty');
  if (empty) empty.remove();
  while (logList.children.length > 30) logList.lastChild.remove();
}
function showFloatScore() {
  floatScoreEl.textContent = '+' + SCORE_PER_HIT;
  floatScoreEl.classList.remove('float-anim');
  void floatScoreEl.offsetWidth;
  floatScoreEl.classList.add('float-anim');
}

// ---------------- 相机：轨道控制 + 点选目标 ----------------
const ORIGIN = new THREE.Vector3(0, 0, 0);
const UP = new THREE.Vector3(0, 1, 0);
const _v1 = new THREE.Vector3(), _v2 = new THREE.Vector3(), _v3 = new THREE.Vector3(), _v4 = new THREE.Vector3(), _v5 = new THREE.Vector3(), _q = new THREE.Quaternion(), _q2 = new THREE.Quaternion(), _q3 = new THREE.Quaternion();
const Q_IDENT = new THREE.Quaternion();     // 单位四元数（球面插值起点）
const impactWorld = new THREE.Vector3();    // 爆点世界坐标（爆炸期间镜头注视点）
const lastDir = new THREE.Vector3(0, 0, 1); // 导弹飞行方向（地球局部系）
const camPos = new THREE.Vector3();         // 相机平滑位置

function orbitPos() {
  const s = Math.sin(camState.phi), c = Math.cos(camState.phi);
  return _v1.set(
    camState.dist * s * Math.sin(camState.theta),
    camState.dist * c,
    camState.dist * s * Math.cos(camState.theta)
  );
}

function applyCamera(dt) {
  let lookTarget = ORIGIN;
  if (state === State.FLIGHT) {
    const mPos = missile.getWorldPosition(_v2);
    const dirW = _v1.copy(lastDir).applyQuaternion(earthGroup.getWorldQuaternion(_q)).normalize();
    const progress = flightT / flightDur;
    if (progress < 0.25) {
      // 起飞正面镜头：平视导弹从面前升起
      const desired = _v3.copy(mPos).addScaledVector(dirW, 0.45).addScaledVector(UP, 0.06);
      if (desired.length() < R + 0.04) desired.setLength(R + 0.04);   // 防止相机穿入地球
      camPos.lerp(desired, 1 - Math.exp(-dt * 5));
      lookTarget = mPos;
    } else if (progress < 0.78) {
      // 空中跟随镜头：从正面沿弧线绕到导弹后上方（球面插值，不穿模）
      const backDir = _v3.copy(dirW).multiplyScalar(-0.86).addScaledVector(UP, 0.48).normalize();
      const mix = Math.min(1, Math.max(0, (progress - 0.25) / 0.10));
      const ease = mix * mix * (3 - 2 * mix);
      _q3.setFromUnitVectors(dirW, backDir);
      _q2.copy(Q_IDENT).slerp(_q3, ease);
      const camDir = _v1.copy(dirW).applyQuaternion(_q2).normalize();
      const dist = 0.45 - 0.15 * ease;
      const desired = _v3.copy(mPos).addScaledVector(camDir, dist);
      if (desired.length() < R + 0.04) desired.setLength(R + 0.04);
      camPos.lerp(desired, 1 - Math.exp(-dt * 6));
      lookTarget = mPos;
    } else {
      // 目标上空俯冲：瞄准点正上方高空，俯视导弹命中（从上往下）
      const tWorld = _v4.copy(latLonToVec3(aimLat, aimLon, R)).applyQuaternion(earthGroup.getWorldQuaternion(_q));
      const desired = _v3.copy(tWorld).addScaledVector(tWorld, 0.8);  // |tWorld|=1 即目标外法线
      camPos.lerp(desired, 1 - Math.exp(-dt * 4.5));
      lookTarget = tWorld;
    }
  } else if (state === State.IMPACT) {
    // 上空俯视爆炸镜头：爆点正上方高空，向下俯视爆炸全过程
    const n = _v1.copy(impactWorld).normalize();
    const desired = _v2.copy(impactWorld).addScaledVector(n, 1.1);
    camPos.lerp(desired, 1 - Math.exp(-dt * 4));
    lookTarget = impactWorld;
  } else {
    // 轨道模式：拖动时即时响应，松开后平滑回归
    const desired = orbitPos();
    if (dragging) camPos.copy(desired);
    else camPos.lerp(desired, 1 - Math.exp(-dt * 3));
    lookTarget = ORIGIN;
  }
  camera.position.copy(camPos);
  if (camShake > 0.001) {
    camera.position.x += (Math.random() - 0.5) * 0.06 * camShake;
    camera.position.y += (Math.random() - 0.5) * 0.06 * camShake;
    camera.position.z += (Math.random() - 0.5) * 0.06 * camShake;
  }
  camera.lookAt(lookTarget);
}

// ---------------- 右下角横向跟踪镜头（画中画） ----------------
const pipWrap = $('pip');
const pipRenderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
pipRenderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
pipWrap.insertBefore(pipRenderer.domElement, pipWrap.firstChild);
const pipCamera = new THREE.PerspectiveCamera(50, 16 / 9, 0.01, 100);
const pipSide = new THREE.Vector3(1, 0, 0);    // 侧拍方向（保持同侧连续）
const pipPos = new THREE.Vector3(4.2, 0.6, 0.9);
pipCamera.position.copy(pipPos);
pipCamera.lookAt(0, 0, 0);
let pipW = 0, pipH = 0;

function updatePip(dt) {
  // 响应式尺寸（变化时才重建）
  const nw = Math.max(220, Math.min(320, wrap.clientWidth * 0.28));
  const nh = nw * 0.56;
  if (nw !== pipW || nh !== pipH) {
    pipW = nw; pipH = nh;
    pipRenderer.setSize(nw, nh, false);
    pipWrap.style.width = nw + 'px';
    pipWrap.style.height = nh + 'px';
    pipCamera.aspect = nw / nh;
    pipCamera.updateProjectionMatrix();
  }
  if (state === State.FLIGHT) {
    // 横向跟踪：导弹侧方机位，拍到侧影飞过
    const mPos = missile.getWorldPosition(_v2);
    const dirW = _v1.copy(lastDir).applyQuaternion(earthGroup.getWorldQuaternion(_q)).normalize();
    const raw = _v3.copy(UP).cross(dirW);
    if (raw.lengthSq() > 1e-6) {
      raw.normalize();
      if (pipSide.dot(raw) < 0) raw.negate();
      pipSide.copy(raw);
    }
    const target = _v4.copy(mPos).addScaledVector(pipSide, 0.9).addScaledVector(UP, 0.18);
    pipPos.lerp(target, 1 - Math.exp(-dt * 5));
    pipCamera.position.copy(pipPos);
    pipCamera.lookAt(mPos);
  } else if (state === State.IMPACT) {
    // 横向看爆炸
    const n = _v4.copy(impactWorld).normalize();
    const raw = _v3.copy(UP).cross(n);
    if (raw.lengthSq() > 1e-6) {
      raw.normalize();
      if (pipSide.dot(raw) < 0) raw.negate();
      pipSide.copy(raw);
    }
    const target = _v4.copy(impactWorld).addScaledVector(pipSide, 1.6).addScaledVector(UP, 0.25);
    pipPos.lerp(target, 1 - Math.exp(-dt * 4));
    pipCamera.position.copy(pipPos);
    pipCamera.lookAt(impactWorld);
  } else {
    // 常态：固定横向机位
    const home = _v4.set(4.2, 0.6, 0.9);
    pipPos.lerp(home, 1 - Math.exp(-dt * 2));
    pipCamera.position.copy(pipPos);
    pipCamera.lookAt(0, 0, 0);
  }
}

let dragging = false, moved = 0, lastX = 0, lastY = 0;
renderer.domElement.style.touchAction = 'none';

renderer.domElement.addEventListener('pointerdown', e => {
  dragging = true; moved = 0;
  lastX = e.clientX; lastY = e.clientY;
  renderer.domElement.setPointerCapture(e.pointerId);
});
renderer.domElement.addEventListener('pointermove', e => {
  if (!dragging) return;
  const dx = e.clientX - lastX, dy = e.clientY - lastY;
  lastX = e.clientX; lastY = e.clientY;
  moved += Math.abs(dx) + Math.abs(dy);
  if (moved > 6) {
    camState.theta -= dx * 0.005;
    camState.phi = THREE.MathUtils.clamp(camState.phi - dy * 0.005, 0.08, Math.PI - 0.08);
  }
});
function onPointerUp(e) {
  dragging = false;
  renderer.domElement.releasePointerCapture(e.pointerId);
}
renderer.domElement.addEventListener('pointerup', onPointerUp);
renderer.domElement.addEventListener('pointercancel', onPointerUp);
renderer.domElement.addEventListener('wheel', e => {
  e.preventDefault();
  camState.dist = THREE.MathUtils.clamp(
    camState.dist * (1 + Math.sign(e.deltaY) * 0.12), CAM_MIN, CAM_MAX
  );
}, { passive: false });

// ---------------- UI 事件 ----------------
btnLaunch.addEventListener('click', () => {
  ensureAudio();
  if (state === State.READY) startCountdown();
  else if (state === State.COUNT) cancelCountdown();
});
btnRandom.addEventListener('click', () => {
  ensureAudio();
  if (state !== State.READY) return;
  randomizeAim();           // 生成随机瞄准坐标（与红点大概率不一致，不会命中）
});
btnDemo.addEventListener('click', () => {
  ensureAudio();
  if (state !== State.READY) return;
  // 试玩效果：红点目标与击打坐标均设为东京
  const t = targets[0];
  t.lat = DEMO_TARGET.lat; t.lon = DEMO_TARGET.lon;
  updateMarkerPos(t);
  aimLat = DEMO_TARGET.lat; aimLon = DEMO_TARGET.lon;
  syncInputsFromAim();
  setStatus('试玩目标已设定：' + DEMO_TARGET.name, 'warn');
  beep(660, 0.1, 'square', 0.12);
});
inpLon.addEventListener('change', () => state === State.READY ? applyInputToAim() : syncInputsFromAim());
inpLat.addEventListener('change', () => state === State.READY ? applyInputToAim() : syncInputsFromAim());

window.addEventListener('resize', () => {
  const w = wrap.clientWidth, h = wrap.clientHeight;
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
  renderer.setSize(w, h);
});

// ---------------- 主循环 ----------------
let last = performance.now();
function animate(now) {
  requestAnimationFrame(animate);
  const dt = Math.min(0.05, (now - last) / 1000);
  last = now;
  // 红点脉冲
  const pulse = 1 + 0.22 * Math.sin(now * 0.005);
  targets.forEach(t => {
    if (!t.group.parent) return;
    t.group.scale.set(pulse, pulse, pulse);
  });
  // 状态机驱动
  if (state === State.COUNT) updateCountdown(dt);
  else if (state === State.FLIGHT) updateFlight(dt);
  else if (state === State.IMPACT) { impactT += dt; updateExplosions(dt); }
  else updateExplosions(dt);
  // 震屏衰减
  camShake = Math.max(0, camShake - dt * 2.2);
  applyCamera(dt);
  renderer.render(scene, camera);
  updatePip(dt);
  pipRenderer.render(scene, pipCamera);
}

// ---------------- 启动 ----------------
initTargets();
btnLaunch.disabled = false;          // HTML 初始为 disabled，启动时启用
camPos.copy(orbitPos());             // 相机初始位置
document.getElementById('loading').classList.add('hide');
requestAnimationFrame(animate);
