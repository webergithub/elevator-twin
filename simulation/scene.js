/**
 * Three.js scene bootstrap — renderer, camera, lighting, OrbitControls, CSS2DRenderer
 */

import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { CSS2DRenderer } from 'three/addons/renderers/CSS2DRenderer.js';

export function createScene(container) {
  // ── Renderer ──────────────────────────────────────────────────────────────
  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false });
  renderer.setPixelRatio(window.devicePixelRatio);
  renderer.setSize(container.clientWidth, container.clientHeight);
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type    = THREE.PCFSoftShadowMap;
  renderer.toneMapping       = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.2;
  container.appendChild(renderer.domElement);

  // CSS2D overlay for text labels
  const labelRenderer = new CSS2DRenderer();
  labelRenderer.setSize(container.clientWidth, container.clientHeight);
  labelRenderer.domElement.style.position = 'absolute';
  labelRenderer.domElement.style.top      = '0';
  labelRenderer.domElement.style.left     = '0';
  labelRenderer.domElement.style.pointerEvents = 'none';
  container.appendChild(labelRenderer.domElement);

  // ── Scene ─────────────────────────────────────────────────────────────────
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x0d1117);
  scene.fog = new THREE.FogExp2(0x0d1117, 0.018);

  // ── Camera ────────────────────────────────────────────────────────────────
  const aspect = container.clientWidth / container.clientHeight;
  const camera = new THREE.PerspectiveCamera(45, aspect, 0.1, 500);
  camera.position.set(22, 14, 28);
  camera.lookAt(0, 8, 0);

  // ── Lighting ──────────────────────────────────────────────────────────────
  const ambient = new THREE.AmbientLight(0x334455, 1.8);
  scene.add(ambient);

  const sun = new THREE.DirectionalLight(0xfff8ee, 2.5);
  sun.position.set(20, 40, 20);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  sun.shadow.camera.near = 1;
  sun.shadow.camera.far  = 120;
  sun.shadow.camera.left = sun.shadow.camera.bottom = -30;
  sun.shadow.camera.right = sun.shadow.camera.top   =  30;
  scene.add(sun);

  const fill = new THREE.DirectionalLight(0x7799cc, 0.6);
  fill.position.set(-15, 10, -10);
  scene.add(fill);

  const ground = new THREE.DirectionalLight(0xddccaa, 0.3);
  ground.position.set(0, -10, 0);
  scene.add(ground);

  // ── Ground plane ──────────────────────────────────────────────────────────
  const floorGeo  = new THREE.PlaneGeometry(120, 120);
  const floorMat  = new THREE.MeshLambertMaterial({ color: 0x111820 });
  const floorMesh = new THREE.Mesh(floorGeo, floorMat);
  floorMesh.rotation.x = -Math.PI / 2;
  floorMesh.position.y = -0.05;
  floorMesh.receiveShadow = true;
  scene.add(floorMesh);

  // Grid helper for depth perception
  const grid = new THREE.GridHelper(80, 40, 0x1a2a3a, 0x1a2a3a);
  grid.position.y = 0;
  scene.add(grid);

  // ── OrbitControls ─────────────────────────────────────────────────────────
  const controls = new OrbitControls(camera, renderer.domElement);
  controls.target.set(0, 8, 0);
  controls.enableDamping = true;
  controls.dampingFactor = 0.08;
  controls.minDistance   = 5;
  controls.maxDistance   = 120;
  controls.maxPolarAngle = Math.PI / 2 + 0.1;
  controls.update();

  // ── Resize handler ────────────────────────────────────────────────────────
  function onResize() {
    const w = container.clientWidth;
    const h = container.clientHeight;
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    renderer.setSize(w, h);
    labelRenderer.setSize(w, h);
  }
  window.addEventListener('resize', onResize);

  return { scene, camera, renderer, labelRenderer, controls };
}
