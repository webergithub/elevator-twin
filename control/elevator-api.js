/**
 * Public Elevator API — industry-standard interface (OTIS/Schindler/ThyssenKrupp style)
 *
 * Usage:
 *   const api = new ElevatorAPI(system);
 *   api.hallCall(3, 'UP');            // Hall panel pressed on floor 3
 *   api.carCall(0, 5);                // Inside elevator 0, press floor 5
 *   api.getStatus(0);                 // Get status of elevator 0
 *   api.setMode('FIRE');              // Set system-wide mode
 *   api.on('door_open', handler);     // Subscribe to events
 */

import { ElevatorSystem } from './elevator-controller.js';
import { LookDispatch, NearestCarDispatch, DestinationControlDispatch } from './dispatch.js';
import { Direction } from './state-machine.js';

const DISPATCH_MAP = {
  LOOK:        LookDispatch,
  NEAREST_CAR: NearestCarDispatch,
  DCS:         DestinationControlDispatch,
};

export class ElevatorAPI {
  /**
   * @param {number} numElevators
   * @param {number} numFloors
   * @param {{ algorithm?: string }} options
   */
  constructor(numElevators, numFloors, options = {}) {
    const algo = options.algorithm ?? 'LOOK';
    this._system = new ElevatorSystem(numElevators, numFloors, DISPATCH_MAP[algo]);
    this._system.on('*', (e) => this._emit(e.type, e));
  }

  // ─── Core controls ─────────────────────────────────────────────────────────

  /** Press the UP or DOWN call button on a floor */
  hallCall(floor, direction = 'UP') {
    const dir = direction === 'UP' ? Direction.UP : Direction.DOWN;
    return this._system.hallCall(floor, dir);
  }

  /** Press a destination floor button inside the elevator */
  carCall(elevatorId, floor) {
    this._system.carCall(elevatorId, floor);
  }

  /** Board a passenger (used by simulation layer) */
  boardPassenger(elevatorId, passenger) {
    return this._system.boardPassenger(elevatorId, passenger);
  }

  /** Hold elevator doors open for additional time */
  holdDoor(elevatorId, extraSeconds = 2) {
    this._system.elevators[elevatorId]?.holdDoor(extraSeconds);
  }

  /** Trigger emergency stop on one or all elevators */
  emergencyStop(elevatorId = null) {
    if (elevatorId !== null) {
      this._system.elevators[elevatorId]?.emergencyStop();
    } else {
      this._system.elevators.forEach(e => e.emergencyStop());
    }
  }

  /** Clear emergency state */
  clearEmergency(elevatorId = null) {
    if (elevatorId !== null) {
      this._system.elevators[elevatorId]?.clearEmergency();
    } else {
      this._system.elevators.forEach(e => e.clearEmergency());
    }
  }

  // ─── Configuration ─────────────────────────────────────────────────────────

  /**
   * Set system-wide operational mode
   * @param {'NORMAL'|'FIRE'|'EVACUATION'|'VIP'|'MAINTENANCE'} mode
   */
  setMode(mode) {
    this._system.setMode(mode);
  }

  /**
   * Set idle floor preferences (optimization output)
   * @param {number[]} idleFloors - one per elevator
   */
  setIdlePositions(idleFloors) {
    idleFloors.forEach((floor, i) => {
      const e = this._system.elevators[i];
      if (e && e.state === 'IDLE' && !e.targetFloors.size) {
        e.addCarCall(floor);
      }
    });
  }

  /**
   * Change dispatch algorithm at runtime
   * @param {'LOOK'|'NEAREST_CAR'|'DCS'} algorithm
   */
  setAlgorithm(algorithm) {
    const Cls = DISPATCH_MAP[algorithm];
    if (Cls) this._system.dispatcher = new Cls();
  }

  /**
   * Reconfigure fleet size and floor count (rebuilds simulation)
   */
  reconfigure(numElevators, numFloors, algorithm) {
    const Cls = algorithm ? DISPATCH_MAP[algorithm] : undefined;
    this._system.resize(numElevators, numFloors, Cls);
  }

  // ─── Status / telemetry ────────────────────────────────────────────────────

  /** Get status of one elevator */
  getStatus(elevatorId) {
    return this._system.getStatus(elevatorId);
  }

  /** Get status of all elevators */
  getAllStatus() {
    return this._system.getAllStatus();
  }

  /** Get system-level metrics */
  getStats() {
    return this._system.getStats();
  }

  /** Get count of elevators */
  get numElevators() { return this._system.elevators.length; }

  /** Get floor count */
  get numFloors() { return this._system.numFloors; }

  // ─── Simulation step ───────────────────────────────────────────────────────

  /** Advance simulation by dt seconds (called by animation loop) */
  update(dt) {
    this._system.update(dt);
  }

  // ─── Events ────────────────────────────────────────────────────────────────

  on(event, fn) {
    this._system.on(event, fn);
    return this;
  }

  _listeners = {};
  _emit(event, data) {
    (this._listeners[event] ?? []).forEach(fn => fn(data));
  }

  /** Direct access for simulation internals (advanced usage) */
  get _internal() { return this._system; }
}
