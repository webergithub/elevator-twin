/**
 * 3D building geometry — floor slabs, shaft columns, exterior glass shell,
 * floor number labels, and hall call button meshes.
 */

import * as THREE from 'three';
import { CSS2DObject } from 'three/addons/renderers/CSS2DRenderer.js';

// ─── Geometry constants ───────────────────────────────────────────────────────
export const FLOOR_H   = 4.0;   // height of one storey (units)
export const SHAFT_W   = 2.8;   // shaft interior width
export const SHAFT_D   = 2.6;   // shaft interior depth
export const SHAFT_GAP = 0.6;   // gap between shafts
export const SLAB_T    = 0.22;  // floor slab thickness
export const LOBBY_D   = 1.8;   // depth of lobby corridor in front of shaft

// Helper: shaft centre X for shaft index i
export function shaftX(i) {
  return i * (SHAFT_W + SHAFT_GAP);
}

// Total building width
export function buildingWidth(n) {
  return n * SHAFT_W + (n - 1) * SHAFT_GAP;
}

// ─── Materials (shared) ───────────────────────────────────────────────────────
const matSlab = new THREE.MeshLambertMaterial({ color: 0xd4cfc4 });
const matShaft = new THREE.MeshPhongMaterial({
  color: 0x303848, transparent: true, opacity: 0.55, depthWrite: false,
});
const matGlass = new THREE.MeshPhongMaterial({
  color: 0x6699cc, transparent: true, opacity: 0.18,
  side: THREE.FrontSide, depthWrite: false,
});
const matRail = new THREE.MeshLambertMaterial({ color: 0x888898 });

// ─── Building ─────────────────────────────────────────────────────────────────

export class Building3D {
  /**
   * @param {THREE.Scene} scene
   * @param {number} numFloors
   * @param {number} numElevators
   */
  constructor(scene, numFloors, numElevators) {
    this.scene         = scene;
    this.numFloors     = numFloors;
    this.numElevators  = numElevators;
    this.group         = new THREE.Group();
    this._callButtons  = [];  // { mesh, floor, dir, active }
    this._hallLabels   = [];
    scene.add(this.group);

    this._build();
  }

  _build() {
    const nE = this.numElevators;
    const nF = this.numFloors;
    const bW = buildingWidth(nE);
    const bH = nF * FLOOR_H;
    const totalD = SHAFT_D + LOBBY_D;
    const cx = (bW - SHAFT_W) / 2; // centre offset

    // ── Floor slabs ──────────────────────────────────────────────────────────
    for (let f = 0; f < nF; f++) {
      const geo  = new THREE.BoxGeometry(bW + 1.4, SLAB_T, totalD + 1.0);
      const mesh = new THREE.Mesh(geo, matSlab);
      mesh.position.set(cx, f * FLOOR_H, 0);
      mesh.receiveShadow = true;
      this.group.add(mesh);

      // Floor number CSS2D label
      const div = document.createElement('div');
      div.className = 'floor-label';
      div.textContent = `${f + 1}F`;
      const label = new CSS2DObject(div);
      label.position.set(cx - bW / 2 - 1.2, f * FLOOR_H + FLOOR_H * 0.5, 0);
      this.group.add(label);
      this._hallLabels.push(label);
    }

    // ── Shaft columns (glass-like enclosures) ─────────────────────────────────
    for (let i = 0; i < nE; i++) {
      const x = shaftX(i);
      // Shaft walls (front + back + sides), transparent
      [
        [SHAFT_W, bH, 0.06, 0, bH / 2, SHAFT_D / 2 + 0.03],   // front wall
        [SHAFT_W, bH, 0.06, 0, bH / 2, -SHAFT_D / 2 - 0.03],  // back wall
        [0.06, bH, SHAFT_D, -SHAFT_W / 2 - 0.03, bH / 2, 0],  // left wall
        [0.06, bH, SHAFT_D,  SHAFT_W / 2 + 0.03, bH / 2, 0],  // right wall
      ].forEach(([w, h, d, ox, oy, oz]) => {
        const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), matShaft);
        m.position.set(x + ox, oy, oz);
        this.group.add(m);
      });

      // Guide rails
      for (const rx of [-SHAFT_W / 2 + 0.12, SHAFT_W / 2 - 0.12]) {
        const rail = new THREE.Mesh(
          new THREE.BoxGeometry(0.06, bH, 0.06),
          matRail
        );
        rail.position.set(x + rx, bH / 2, 0);
        this.group.add(rail);
      }
    }

    // ── Exterior glass shell ──────────────────────────────────────────────────
    const shells = [
      [bW + 1.6, bH, 0.1, cx, bH / 2, totalD / 2 + 0.5],      // front
      [bW + 1.6, bH, 0.1, cx, bH / 2, -SHAFT_D / 2 - 0.5],    // back
      [0.1, bH, totalD + 1.0, cx - bW / 2 - 0.75, bH / 2, LOBBY_D / 2 - SHAFT_D / 2], // L
      [0.1, bH, totalD + 1.0, cx + bW / 2 + 0.75, bH / 2, LOBBY_D / 2 - SHAFT_D / 2], // R
    ];
    shells.forEach(([w, h, d, ox, oy, oz]) => {
      const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), matGlass);
      m.position.set(ox, oy, oz);
      this.group.add(m);
    });

    // ── Hall call buttons ─────────────────────────────────────────────────────
    this._buildCallButtons(nF, cx);
  }

  _buildCallButtons(nF, cx) {
    const btnGeo = new THREE.CylinderGeometry(0.14, 0.14, 0.06, 16);
    const matOff = new THREE.MeshPhongMaterial({ color: 0x334455, emissive: 0x000000 });
    const bW = buildingWidth(this.numElevators);
    const btnX = cx + bW / 2 + 0.9;

    for (let f = 0; f < nF; f++) {
      const y = f * FLOOR_H + FLOOR_H * 0.5;

      const dirs = [];
      if (f < nF - 1) dirs.push({ dir: 'UP',   dy: 0.22,  color: 0x00dd66 });
      if (f > 0)      dirs.push({ dir: 'DOWN',  dy: -0.22, color: 0xff4422 });

      dirs.forEach(({ dir, dy, color }) => {
        const mat  = matOff.clone();
        const mesh = new THREE.Mesh(btnGeo, mat);
        mesh.rotation.x = Math.PI / 2;
        mesh.position.set(btnX, y + dy, SHAFT_D / 2 + 0.4);
        mesh.userData = { type: 'callButton', floor: f + 1, dir, color, active: false };
        this.group.add(mesh);
        this._callButtons.push(mesh);
      });
    }
  }

  /** Activate or deactivate a call button visually */
  setButtonState(floor, dir, active) {
    const btn = this._callButtons.find(b =>
      b.userData.floor === floor && b.userData.dir === dir);
    if (!btn) return;
    btn.userData.active = active;
    btn.material.color.set(active ? btn.userData.color : 0x334455);
    btn.material.emissive.set(active ? btn.userData.color : 0x000000);
    btn.material.emissiveIntensity = active ? 0.6 : 0;
  }

  /** Returns all call button meshes (for raycasting) */
  get callButtons() { return this._callButtons; }

  /** Rebuild entire building after config change */
  rebuild(numFloors, numElevators) {
    this.group.clear();
    this._callButtons = [];
    this._hallLabels  = [];
    this.numFloors    = numFloors;
    this.numElevators = numElevators;
    this._build();
  }
}
