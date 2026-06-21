/**
 * Simulation entry point — wires together scene, building, elevators, passengers, UI.
 */

import * as THREE from 'three';
import { createScene }      from './scene.js';
import { Building3D, shaftX, buildingWidth } from './building.js';
import { Elevator3D }       from './elevator3d.js';
import { PassengerManager } from './passenger3d.js';
import { UIOverlay }        from './ui-overlay.js';
import { ElevatorAPI }      from '../control/elevator-api.js';

// ─── Config ──────────────────────────────────────────────────────────────────
let config = { floors: 10, elevators: 3, spawnRate: 4, algorithm: 'LOOK' };

// ─── Init scene ──────────────────────────────────────────────────────────────
const container = document.getElementById('canvas-container');
const { scene, camera, renderer, labelRenderer, controls } = createScene(container);

// ─── State ───────────────────────────────────────────────────────────────────
let api, building, elevators3d, passengerManager, ui;

function initSimulation(cfg) {
  config = { ...config, ...cfg };

  // Tear down existing objects
  if (building) { scene.remove(building.group); }
  if (elevators3d) { elevators3d.forEach(e => scene.remove(e.group)); }
  if (passengerManager) { passengerManager.reset(); }

  // API / controller
  api = new ElevatorAPI(config.elevators, config.floors, { algorithm: config.algorithm });

  // 3D Building
  building = new Building3D(scene, config.floors, config.elevators);

  // 3D Elevators
  elevators3d = Array.from({ length: config.elevators }, (_, i) =>
    new Elevator3D(i, config.floors, scene)
  );

  // Passengers
  if (passengerManager) {
    passengerManager.scene = scene;
    passengerManager.api   = api;
    passengerManager.setSpawnRate(config.spawnRate);
  } else {
    passengerManager = new PassengerManager(scene, api);
  }
  passengerManager.setSpawnRate(config.spawnRate);

  // Wire events to UI log
  api.on('floor_arrived', ({ elevatorId, floor }) =>
    ui?.log(`E${elevatorId+1} 到达 ${floor}F`, 'info'));
  api.on('door_open', ({ elevatorId, floor }) =>
    ui?.log(`E${elevatorId+1} ${floor}F 开门`, 'door'));
  api.on('door_closed', ({ elevatorId }) =>
    ui?.log(`E${elevatorId+1} 关门`, 'door'));
  api.on('hall_call', ({ floor, dir, elevatorId }) =>
    ui?.log(`${floor}F ${dir} → 分配 E${elevatorId+1}`, 'call'));
  api.on('emergency', ({ elevatorId }) =>
    ui?.log(`⚠️ E${elevatorId+1} 紧急停梯！`, 'warn'));

  // Recentre camera
  const bW = buildingWidth(config.elevators);
  const bH = config.floors * 4;
  controls.target.set(bW / 2 - 1.4, bH / 2, 0);
  camera.position.set(bW / 2 - 1.4 + 22, bH / 2 + 6, 28);
  controls.update();
}

// ─── UI ──────────────────────────────────────────────────────────────────────
ui = new UIOverlay(document.getElementById('ui-root'), (action, payload) => {
  switch (action) {
    case 'reconfigure':
      initSimulation(payload);
      passengerManager.reset();
      ui.log(`重新配置：${payload.floors}层 × ${payload.elevators}部电梯 (${payload.algorithm})`, 'info');
      break;
    case 'emergency':
      api.emergencyStop();
      ui.log('⚠️ 全部紧急停梯', 'warn');
      break;
    case 'clearEmergency':
      api.clearEmergency();
      ui.log('紧急状态已清除', 'info');
      break;
    case 'setMode':
      api.setMode(payload);
      ui.log(`模式切换 → ${payload}`, 'info');
      break;
  }
});

// ─── Raycaster for button clicks ──────────────────────────────────────────────
const raycaster = new THREE.Raycaster();
const mouse     = new THREE.Vector2();

renderer.domElement.addEventListener('click', (event) => {
  if (!building) return;
  const rect = renderer.domElement.getBoundingClientRect();
  mouse.x =  ((event.clientX - rect.left) / rect.width)  * 2 - 1;
  mouse.y = -((event.clientY - rect.top)  / rect.height) * 2 + 1;

  raycaster.setFromCamera(mouse, camera);
  const hits = raycaster.intersectObjects(building.callButtons);
  if (!hits.length) return;

  const btn = hits[0].object;
  const { floor, dir } = btn.userData;
  building.setButtonState(floor, dir, true);
  api.hallCall(floor, dir);
  ui.log(`手动呼梯：${floor}F ${dir}`, 'call');

  // Auto-reset button state after 8 seconds
  setTimeout(() => building.setButtonState(floor, dir, false), 8000);
});

// ─── Animation loop ───────────────────────────────────────────────────────────
let lastTime = performance.now();

function animate(now) {
  requestAnimationFrame(animate);
  const dt = Math.min((now - lastTime) / 1000, 0.05);
  lastTime = now;

  if (!api) return;

  // Logic update
  api.update(dt);
  passengerManager.update(dt);

  // 3D update
  elevators3d.forEach((e3d, i) => {
    e3d.update(dt, api.getStatus(i));
  });

  // UI update (every frame is fine for status, log is event-driven)
  ui.updateElevatorCards(api.getAllStatus());
  ui.updateStatsAll(passengerManager.getStats(), api.getStats());

  controls.update();
  renderer.render(scene, camera);
  labelRenderer.render(scene, camera);
}

// ─── Boot ────────────────────────────────────────────────────────────────────
initSimulation(config);
ui.log('电梯模拟系统启动', 'info');

// Add some initial car calls to make the simulation lively
setTimeout(() => {
  if (api && config.floors >= 5) {
    api.hallCall(1, 'UP');
    api.hallCall(Math.ceil(config.floors / 2), 'UP');
    api.hallCall(config.floors, 'DOWN');
  }
}, 800);

requestAnimationFrame(animate);
