/**
 * 3D elevator car — body, sliding doors, interior lighting, cable, status label.
 * Reads controller state each frame and interpolates visuals accordingly.
 */

import * as THREE from 'three';
import { CSS2DObject } from 'three/addons/renderers/CSS2DRenderer.js';
import { FLOOR_H, SHAFT_W, SHAFT_D, shaftX } from './building.js';

const CAR_W      = SHAFT_W - 0.24;
const CAR_D      = SHAFT_D - 0.18;
const CAR_H      = FLOOR_H * 0.82;
const DOOR_W     = CAR_W / 2 - 0.04;
const DOOR_H     = CAR_H - 0.24;
const DOOR_THICK = 0.06;
const CABLE_TOP_OFFSET = 0.08;

// Elevator colours
const C = {
  body:     0xc8ccd8,
  bodyTop:  0xa8aab8,
  door:     0xb0b4c4,
  doorEdge: 0x888898,
  interior: 0xf0e8d8,
  cable:    0x888888,
  glow:     0x44aaff,
  display:  0x001100,
};

const matBody     = new THREE.MeshPhongMaterial({ color: C.body,  shininess: 60 });
const matTop      = new THREE.MeshPhongMaterial({ color: C.bodyTop });
const matInterior = new THREE.MeshLambertMaterial({ color: C.interior });
const matCable    = new THREE.LineBasicMaterial({ color: C.cable });

export class Elevator3D {
  /**
   * @param {number} id - elevator index
   * @param {number} numFloors
   * @param {THREE.Scene} scene
   */
  constructor(id, numFloors, scene) {
    this.id        = id;
    this.numFloors = numFloors;
    this.scene     = scene;

    this.group     = new THREE.Group();
    this._doorL    = null;
    this._doorR    = null;
    this._interior = null;
    this._interiorLight = null;
    this._cable    = null;
    this._displayEl = null;
    this._label    = null;

    this._prevY    = 0;
    this._smoothY  = 0;

    scene.add(this.group);
    this._build();
  }

  _build() {
    const x = shaftX(this.id);
    this.group.position.x = x;

    // ── Car body (5 sides: top, bottom, left, right, back) ───────────────────
    const matDoor = new THREE.MeshPhongMaterial({ color: C.door, shininess: 80 });

    const panels = [
      // [w, h, d, ox, oy, oz]
      [CAR_W, 0.06, CAR_D, 0, CAR_H, 0],                         // top
      [CAR_W, 0.06, CAR_D, 0, 0, 0],                              // bottom
      [0.06, CAR_H, CAR_D, -CAR_W / 2, CAR_H / 2, 0],            // left side
      [0.06, CAR_H, CAR_D,  CAR_W / 2, CAR_H / 2, 0],            // right side
      [CAR_W, CAR_H, 0.06,  0, CAR_H / 2, -CAR_D / 2],           // back wall
    ];
    panels.forEach(([w, h, d, ox, oy, oz], idx) => {
      const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d),
        idx === 0 ? matTop : matBody);
      m.position.set(ox, oy, oz);
      m.castShadow = true;
      this.group.add(m);
    });

    // Interior floor
    const iFloor = new THREE.Mesh(
      new THREE.BoxGeometry(CAR_W - 0.08, 0.04, CAR_D - 0.08),
      matInterior
    );
    iFloor.position.set(0, 0.04, 0);
    this.group.add(iFloor);

    // Interior ceiling light (emissive)
    const iCeil = new THREE.Mesh(
      new THREE.BoxGeometry(CAR_W * 0.5, 0.04, CAR_D * 0.4),
      new THREE.MeshStandardMaterial({ color: 0xfff5dd, emissive: 0xfff5dd, emissiveIntensity: 0 })
    );
    iCeil.position.set(0, CAR_H - 0.06, 0);
    this.group.add(iCeil);
    this._interior = iCeil;

    // Point light inside car
    this._interiorLight = new THREE.PointLight(0xfff0cc, 0, 4);
    this._interiorLight.position.set(0, CAR_H * 0.75, 0);
    this.group.add(this._interiorLight);

    // ── Doors ─────────────────────────────────────────────────────────────────
    const dMat = matDoor.clone();
    this._doorL = this._makeDoor(dMat, -DOOR_W / 2 - 0.02);
    this._doorR = this._makeDoor(dMat,  DOOR_W / 2 + 0.02);
    this._doorLClosedX = -DOOR_W / 2 - 0.02;
    this._doorRClosedX =  DOOR_W / 2 + 0.02;
    this._doorLOpenX   = -CAR_W / 2 + 0.02;
    this._doorROpenX   =  CAR_W / 2 - 0.02;

    // Door frame strips
    const frameH = DOOR_H + 0.1;
    const frameMat = new THREE.MeshLambertMaterial({ color: C.doorEdge });
    [[-CAR_W / 2 + 0.02, CAR_H / 2, SHAFT_D / 2 - 0.02],
     [ CAR_W / 2 - 0.02, CAR_H / 2, SHAFT_D / 2 - 0.02],
     [0,                  frameH,    SHAFT_D / 2 - 0.02]].forEach(([ox, oy, oz], i) => {
      const geo = i < 2
        ? new THREE.BoxGeometry(0.07, frameH, 0.07)
        : new THREE.BoxGeometry(CAR_W, 0.07, 0.07);
      const fm = new THREE.Mesh(geo, frameMat);
      fm.position.set(ox, oy, oz);
      this.group.add(fm);
    });

    // ── Cable ─────────────────────────────────────────────────────────────────
    const cableGeo = new THREE.BufferGeometry().setFromPoints([
      new THREE.Vector3(0, CAR_H + CABLE_TOP_OFFSET, 0),
      new THREE.Vector3(0, this.numFloors * FLOOR_H + 2, 0),
    ]);
    this._cable = new THREE.Line(cableGeo, matCable.clone());
    this.group.add(this._cable);

    // ── Status label ──────────────────────────────────────────────────────────
    const div = document.createElement('div');
    div.className = 'elevator-label';
    div.innerHTML = `<span class="elabel-id">E${this.id + 1}</span><span class="elabel-floor">1</span>`;
    this._displayEl = div;
    const label = new CSS2DObject(div);
    label.position.set(0, CAR_H + 0.4, SHAFT_D / 2 + 0.1);
    this.group.add(label);
    this._label = label;
  }

  _makeDoor(mat, startX) {
    const door = new THREE.Mesh(
      new THREE.BoxGeometry(DOOR_W, DOOR_H, DOOR_THICK),
      mat
    );
    door.position.set(startX, DOOR_H / 2 + 0.12, SHAFT_D / 2 - DOOR_THICK / 2);
    door.castShadow = true;
    this.group.add(door);
    return door;
  }

  /**
   * Update visual state each frame.
   * @param {number} dt - delta time (seconds)
   * @param {object} status - from ElevatorAPI.getStatus()
   */
  update(dt, status) {
    if (!status) return;

    // ── Smooth Y position ─────────────────────────────────────────────────
    const targetY = (status.floor - 1) * FLOOR_H;
    this._smoothY += (targetY - this._smoothY) * Math.min(1, dt * 18);
    this.group.position.y = this._smoothY;

    // ── Cable update ──────────────────────────────────────────────────────
    const posAttr = this._cable.geometry.attributes.position;
    posAttr.setXYZ(0, 0, CAR_H + CABLE_TOP_OFFSET, 0);
    posAttr.setXYZ(1, 0, this.numFloors * FLOOR_H + 2 - this._smoothY, 0);
    posAttr.needsUpdate = true;

    // ── Door animation ────────────────────────────────────────────────────
    const t = Math.max(0, Math.min(1, status.doorPosition));
    const lX = this._doorLClosedX + (this._doorLOpenX - this._doorLClosedX) * t;
    const rX = this._doorRClosedX + (this._doorROpenX - this._doorRClosedX) * t;
    this._doorL.position.x = lX;
    this._doorR.position.x = rX;

    // Interior light when doors are open
    const lightInt = t;
    this._interiorLight.intensity = lightInt * 1.2;
    this._interior.material.emissiveIntensity = lightInt * 0.8;

    // ── Status label ──────────────────────────────────────────────────────
    const floorDisplay = status.displayFloor;
    const arrow = status.direction > 0 ? '▲' : status.direction < 0 ? '▼' : '●';
    const stateClass = {
      IDLE: 'idle', MOVING_UP: 'moving', MOVING_DOWN: 'moving',
      DOOR_OPEN: 'door-open', DOOR_OPENING: 'door-open', DOOR_CLOSING: 'door-open',
      EMERGENCY: 'emergency', MAINTENANCE: 'maintenance',
    }[status.state] ?? 'idle';

    if (this._displayEl) {
      this._displayEl.innerHTML =
        `<span class="elabel-id">E${this.id + 1}</span>` +
        `<span class="elabel-floor ${stateClass}">${floorDisplay}F ${arrow}</span>` +
        (status.passengerCount > 0 ? `<span class="elabel-pax">👤${status.passengerCount}</span>` : '');
    }
  }

  /** Called when building is rebuilt (floor count changed) */
  rebuild(numFloors, scene) {
    scene.remove(this.group);
    this.numFloors = numFloors;
    this.group = new THREE.Group();
    this._smoothY = 0;
    scene.add(this.group);
    this._build();
  }
}
