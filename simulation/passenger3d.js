/**
 * Passenger simulation — lifecycle management and 3D visuals.
 *
 * Lifecycle: WAITING (at floor) → BOARDING → RIDING → EXITING → done
 * 3D: capsule body + sphere head, color-coded by destination zone.
 */

import * as THREE from 'three';
import { FLOOR_H, SHAFT_W, SHAFT_D, shaftX, buildingWidth } from './building.js';
import { Direction } from '../control/state-machine.js';

let _nextId = 0;

const PASSENGER_COLORS = [
  0x4488ff, 0xff6644, 0x44dd88, 0xffcc22, 0xcc44ff,
  0xff4488, 0x22ccff, 0xaaff44,
];

const BODY_H = 0.7;
const HEAD_R = 0.18;

function makePassengerMesh(color) {
  const g = new THREE.Group();

  const body = new THREE.Mesh(
    new THREE.CapsuleGeometry(0.15, BODY_H, 4, 8),
    new THREE.MeshLambertMaterial({ color })
  );
  body.position.y = BODY_H / 2 + HEAD_R;
  g.add(body);

  const head = new THREE.Mesh(
    new THREE.SphereGeometry(HEAD_R, 8, 6),
    new THREE.MeshLambertMaterial({ color: 0xffddbb })
  );
  head.position.y = BODY_H + HEAD_R * 2 + 0.02;
  g.add(head);

  return g;
}

class Passenger {
  constructor(fromFloor, toFloor, numElevators) {
    this.id         = _nextId++;
    this.fromFloor  = fromFloor;
    this.toFloor    = toFloor;
    this.direction  = toFloor > fromFloor ? Direction.UP : Direction.DOWN;
    this.state      = 'WAITING'; // WAITING | BOARDING | RIDING | EXITING | DONE
    this.elevatorId = null;
    this.spawnTime  = performance.now() / 1000;
    this.boardTime  = null;
    this.waitTime   = null;
    this.travelTime = null;

    const color = PASSENGER_COLORS[this.id % PASSENGER_COLORS.length];
    this.mesh   = makePassengerMesh(color);

    // Wait position: in front of a random shaft, at their floor
    const shaftIdx = Math.floor(Math.random() * numElevators);
    const wx = shaftX(shaftIdx) + (Math.random() - 0.5) * (SHAFT_W - 0.4);
    const wy = (fromFloor - 1) * FLOOR_H + 0.02;
    const wz = SHAFT_D / 2 + 0.5 + Math.random() * 0.4;
    this.mesh.position.set(wx, wy, wz);
    this.mesh.visible = true;
    this._waitX = wx;
    this._waitZ = wz;
    this._targetX = wx;
    this._targetZ = wz;
    this._boardShaft = shaftIdx;
  }

  // Move mesh smoothly toward target position
  _lerpMesh(dt) {
    const p = this.mesh.position;
    p.x += (this._targetX - p.x) * Math.min(1, dt * 6);
    p.z += (this._targetZ - p.z) * Math.min(1, dt * 6);
  }

  onAssigned(elevatorId) {
    this.elevatorId   = elevatorId;
    const shaftIdx    = elevatorId;
    this._boardShaft  = shaftIdx;
    this._targetX     = shaftX(shaftIdx) + (Math.random() - 0.5) * 0.5;
    this._targetZ     = SHAFT_D / 2 - 0.1;
  }

  onBoard(elevatorId) {
    this.state     = 'RIDING';
    this.boardTime = performance.now() / 1000;
    this.waitTime  = this.boardTime - this.spawnTime;
    this.mesh.visible = false; // hidden inside elevator
  }

  onExit(floor) {
    const now        = performance.now() / 1000;
    this.travelTime  = now - (this.boardTime ?? now);
    this.state       = 'EXITING';
    const exitX      = shaftX(this._boardShaft) + (Math.random() - 0.5) * 1.0;
    const exitZ      = SHAFT_D / 2 + 1.2 + Math.random() * 0.8;
    this.mesh.position.set(exitX, (floor - 1) * FLOOR_H + 0.02, exitZ);
    this.mesh.visible = true;
    this._targetX    = exitX + (Math.random() - 0.5) * 1.5;
    this._targetZ    = exitZ + Math.random() * 1.0;
    this._exitTimer  = 0;
  }

  update(dt) {
    this._lerpMesh(dt);

    if (this.state === 'EXITING') {
      this._exitTimer = (this._exitTimer ?? 0) + dt;
      const fade = 1 - Math.min(1, this._exitTimer / 1.5);
      this.mesh.children.forEach(c => {
        if (c.material) c.material.opacity = fade;
        if (c.material) c.material.transparent = true;
      });
      if (this._exitTimer > 1.5) this.state = 'DONE';
    }
  }
}

// ─── PassengerManager ─────────────────────────────────────────────────────────

export class PassengerManager {
  constructor(scene, api) {
    this.scene      = scene;
    this.api        = api;
    this.passengers = [];
    this._spawnTimer  = 0;
    this._spawnRate   = 4.0; // seconds between spawns (configurable)
    this._stats       = { totalServed: 0, totalWait: 0, totalTravel: 0 };

    // Listen for door-open events to board waiting passengers
    api.on('door_open', ({ elevatorId, floor }) => {
      this._tryBoard(elevatorId, floor);
    });

    // Listen for passenger exits from controller
    api.on('passenger_exit', ({ elevatorId, floor, passenger }) => {
      const p = this.passengers.find(p => p.id === passenger.id);
      if (p) p.onExit(floor);
    });
  }

  setSpawnRate(rate) { this._spawnRate = rate; }

  update(dt) {
    const nF = this.api.numFloors;
    const nE = this.api.numElevators;

    // Spawn new passengers
    this._spawnTimer += dt;
    if (this._spawnTimer >= this._spawnRate && nF >= 2) {
      this._spawnTimer = 0;
      this._spawn(nF, nE);
    }

    // Update existing
    for (const p of this.passengers) {
      p.update(dt);

      // Route to elevator when WAITING
      if (p.state === 'WAITING') {
        const eId = this.api.hallCall(p.fromFloor, p.direction === Direction.UP ? 'UP' : 'DOWN');
        if (eId !== undefined) {
          p.state = 'BOARDING';
          p.onAssigned(eId);
        }
      }
    }

    // Remove done passengers
    const done = this.passengers.filter(p => p.state === 'DONE');
    done.forEach(p => this.scene.remove(p.mesh));
    this.passengers = this.passengers.filter(p => p.state !== 'DONE');
  }

  _spawn(nF, nE) {
    const from = Math.floor(Math.random() * nF) + 1;
    let   to   = Math.floor(Math.random() * nF) + 1;
    while (to === from) to = Math.floor(Math.random() * nF) + 1;

    const p = new Passenger(from, to, nE);
    this.passengers.push(p);
    this.scene.add(p.mesh);
  }

  _tryBoard(elevatorId, floor) {
    const waiting = this.passengers.filter(p =>
      p.state === 'BOARDING' &&
      p.fromFloor === floor &&
      p.elevatorId === elevatorId
    );

    waiting.forEach(p => {
      const passenger = { id: p.id, destFloor: p.toFloor, boardTime: performance.now() / 1000 };
      const boarded = this.api.boardPassenger(elevatorId, passenger);
      if (boarded) p.onBoard(elevatorId);
    });
  }

  getStats() {
    const served = this.passengers.filter(p => p.waitTime !== null);
    const totalWait = served.reduce((s, p) => s + (p.waitTime ?? 0), 0);
    const avgWait   = served.length ? totalWait / served.length : 0;
    const waiting   = this.passengers.filter(p => p.state === 'WAITING' || p.state === 'BOARDING').length;
    const riding    = this.passengers.filter(p => p.state === 'RIDING').length;
    return { waiting, riding, avgWait: avgWait.toFixed(1), totalServed: this.passengers.length };
  }

  /** Called when simulation is reconfigured */
  reset() {
    this.passengers.forEach(p => this.scene.remove(p.mesh));
    this.passengers = [];
    this._spawnTimer = 0;
  }
}
