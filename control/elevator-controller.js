/**
 * Core elevator controller — physics simulation + dispatch integration.
 * ElevatorUnit models a single car; ElevatorSystem manages the fleet.
 */

import { ElevatorState, Direction } from './state-machine.js';
import { LookDispatch } from './dispatch.js';

const FLOOR_SPEED    = 2.5;  // floors per second (max speed)
const ACCEL          = 1.8;  // floors/s²
const DOOR_OPEN_SEC  = 3.0;  // how long doors stay open
const DOOR_ANIM_SEC  = 0.8;  // door open/close animation duration
const ARRIVAL_THRESH = 0.03; // how close (in floors) counts as "arrived"

export class ElevatorUnit {
  constructor(id, numFloors, startFloor = 1) {
    this.id = id;
    this.numFloors = numFloors;

    // Physical state
    this.currentFloor = startFloor;  // continuous float
    this.velocity     = 0;           // floors/s
    this.direction    = Direction.NONE;

    // Door state: 0 = fully closed, 1 = fully open
    this.doorPosition = 0;
    this._doorState   = 'closed'; // 'closed'|'opening'|'open'|'closing'
    this._doorTimer   = 0;

    // Request queues
    this.targetFloors = new Set();  // floors this car must stop at
    this._upCalls     = new Set();  // hall calls UP
    this._downCalls   = new Set();  // hall calls DOWN

    this.state        = ElevatorState.IDLE;
    this.isOutOfService = false;

    // Metrics
    this.passengersServed = 0;
    this.totalTravelTime  = 0;
    this.floorsTraversed  = 0;

    // Passengers currently inside
    this.passengers = [];  // [{ id, destFloor, boardTime }]

    this._listeners = {};
  }

  on(event, fn) { (this._listeners[event] ??= []).push(fn); return this; }
  _emit(event, data) { (this._listeners[event] ?? []).forEach(fn => fn(data)); }

  addHallCall(floor, dir) {
    if (dir === Direction.UP)   this._upCalls.add(floor);
    if (dir === Direction.DOWN) this._downCalls.add(floor);
    this.targetFloors.add(floor);
    if (this.state === ElevatorState.IDLE) this._pickDirection();
  }

  addCarCall(floor) {
    if (floor < 1 || floor > this.numFloors) return;
    this.targetFloors.add(floor);
    if (this.state === ElevatorState.IDLE) this._pickDirection();
  }

  boardPassenger(passenger) {
    this.passengers.push(passenger);
    this.addCarCall(passenger.destFloor);
  }

  _pickDirection() {
    if (!this.targetFloors.size) return;
    const nearest = [...this.targetFloors].reduce((a, b) =>
      Math.abs(a - this.currentFloor) < Math.abs(b - this.currentFloor) ? a : b);
    this.direction = nearest > this.currentFloor ? Direction.UP
                   : nearest < this.currentFloor ? Direction.DOWN
                   : Direction.NONE;
    if (this.direction === Direction.UP)   this.state = ElevatorState.MOVING_UP;
    if (this.direction === Direction.DOWN) this.state = ElevatorState.MOVING_DOWN;
  }

  // Returns the next floor to stop at given current direction (LOOK algorithm)
  _nextStop() {
    const stops = [...this.targetFloors];
    if (!stops.length) return null;

    if (this.direction === Direction.UP) {
      const ahead = stops.filter(f => f > this.currentFloor + ARRIVAL_THRESH);
      if (ahead.length) return Math.min(...ahead);
      // No more stops ahead — reverse
      return Math.max(...stops);
    }
    if (this.direction === Direction.DOWN) {
      const ahead = stops.filter(f => f < this.currentFloor - ARRIVAL_THRESH);
      if (ahead.length) return Math.max(...ahead);
      return Math.min(...stops);
    }
    // NONE — pick nearest
    return stops.reduce((a, b) =>
      Math.abs(a - this.currentFloor) < Math.abs(b - this.currentFloor) ? a : b);
  }

  update(dt) {
    if (this.isOutOfService || this.state === ElevatorState.EMERGENCY) return;

    // Door animation
    this._updateDoor(dt);

    // Movement only when doors are fully closed
    if (this._doorState !== 'closed') return;
    if (this.state === ElevatorState.IDLE) {
      if (this.targetFloors.size) this._pickDirection();
      return;
    }
    if (this.state === ElevatorState.DOOR_OPENING ||
        this.state === ElevatorState.DOOR_OPEN ||
        this.state === ElevatorState.DOOR_CLOSING) return;

    const target = this._nextStop();
    if (target === null) {
      this.velocity = 0;
      this.direction = Direction.NONE;
      this.state = ElevatorState.IDLE;
      return;
    }

    const dist = target - this.currentFloor;
    const absD = Math.abs(dist);
    const dir  = dist > 0 ? 1 : -1;

    // Update direction and state
    if (dir !== this.direction) {
      this.direction = dir;
      this.state = dir === 1 ? ElevatorState.MOVING_UP : ElevatorState.MOVING_DOWN;
    }

    // Braking distance at current speed: v²/(2a)
    const brakeDist = (this.velocity * this.velocity) / (2 * ACCEL);

    let newVel;
    if (absD <= brakeDist + 0.01) {
      // Decelerate
      newVel = this.velocity - ACCEL * dt * dir;
      if (Math.abs(newVel) < 0.05) newVel = 0;
    } else {
      // Accelerate toward max speed
      newVel = this.velocity + ACCEL * dt * dir;
      newVel = Math.max(-FLOOR_SPEED, Math.min(FLOOR_SPEED, newVel));
    }

    this.velocity = newVel;
    const prevFloor = this.currentFloor;
    this.currentFloor += this.velocity * dt;
    this.floorsTraversed += Math.abs(this.currentFloor - prevFloor);

    // Check arrival
    if (Math.abs(this.currentFloor - target) < ARRIVAL_THRESH) {
      this.currentFloor = target;
      this.velocity = 0;
      this._onArrival(target);
    }
  }

  _onArrival(floor) {
    this.targetFloors.delete(floor);
    this._upCalls.delete(floor);
    this._downCalls.delete(floor);
    this.state = ElevatorState.DOOR_OPENING;
    this._doorState = 'opening';
    this._doorTimer = 0;

    // Discharge passengers at this floor
    const alighting = this.passengers.filter(p => p.destFloor === floor);
    alighting.forEach(p => {
      this.passengersServed++;
      this._emit('passenger_exit', { elevatorId: this.id, floor, passenger: p });
    });
    this.passengers = this.passengers.filter(p => p.destFloor !== floor);
    this._emit('floor_arrived', { elevatorId: this.id, floor, alighting: alighting.length });
  }

  _updateDoor(dt) {
    this._doorTimer += dt;

    if (this._doorState === 'opening') {
      this.doorPosition = Math.min(1, this._doorTimer / DOOR_ANIM_SEC);
      if (this.doorPosition >= 1) {
        this._doorState = 'open';
        this._doorTimer = 0;
        this.state = ElevatorState.DOOR_OPEN;
        this._emit('door_open', { elevatorId: this.id, floor: Math.round(this.currentFloor) });
      }
    } else if (this._doorState === 'open') {
      if (this._doorTimer >= DOOR_OPEN_SEC) {
        this._doorState = 'closing';
        this._doorTimer = 0;
        this.state = ElevatorState.DOOR_CLOSING;
        this._emit('door_closing', { elevatorId: this.id });
      }
    } else if (this._doorState === 'closing') {
      this.doorPosition = Math.max(0, 1 - this._doorTimer / DOOR_ANIM_SEC);
      if (this.doorPosition <= 0) {
        this._doorState = 'closed';
        this._doorTimer = 0;
        this.state = ElevatorState.IDLE;
        this._emit('door_closed', { elevatorId: this.id });
      }
    }
  }

  holdDoor(extraSecs = 2) {
    if (this._doorState === 'open') this._doorTimer = Math.max(0, this._doorTimer - extraSecs);
  }

  emergencyStop() {
    this.velocity = 0;
    this.state = ElevatorState.EMERGENCY;
    this.isOutOfService = true;
    this._emit('emergency', { elevatorId: this.id });
  }

  clearEmergency() {
    this.isOutOfService = false;
    this.state = ElevatorState.IDLE;
    this.targetFloors.clear();
  }

  get status() {
    return {
      id:           this.id,
      floor:        this.currentFloor,
      displayFloor: Math.round(this.currentFloor),
      velocity:     this.velocity,
      direction:    this.direction,
      state:        this.state,
      doorPosition: this.doorPosition,
      targetFloors: [...this.targetFloors],
      passengerCount: this.passengers.length,
      passengersServed: this.passengersServed,
      isOutOfService: this.isOutOfService,
    };
  }
}

// ─── ElevatorSystem ───────────────────────────────────────────────────────────

export class ElevatorSystem {
  constructor(numElevators, numFloors, DispatchClass = LookDispatch) {
    this.numFloors   = numFloors;
    this.elevators   = Array.from({ length: numElevators }, (_, i) =>
      new ElevatorUnit(i, numFloors, 1));
    this.dispatcher  = new DispatchClass();
    this.mode        = 'NORMAL';

    // System-level metrics
    this.totalWaitTime    = 0;
    this.totalPassengers  = 0;
    this.pendingCalls     = []; // { floor, dir, timestamp }

    this._listeners = {};
    this._time      = 0;

    // Wire up elevator events
    this.elevators.forEach(e => {
      e.on('floor_arrived', d => this._emit('floor_arrived', d));
      e.on('door_open',     d => this._emit('door_open', d));
      e.on('door_closed',   d => this._emit('door_closed', d));
      e.on('passenger_exit',d => this._emit('passenger_exit', d));
      e.on('emergency',     d => this._emit('emergency', d));
    });
  }

  on(event, fn) { (this._listeners[event] ??= []).push(fn); return this; }
  _emit(event, data) { (this._listeners[event] ?? []).forEach(fn => fn(data)); }

  // Called when a user presses a hall call button
  hallCall(floor, dir) {
    const e = this.dispatcher.assign(this.elevators, floor, dir);
    if (!e) return;
    e.addHallCall(floor, dir);
    this.pendingCalls.push({ floor, dir, timestamp: this._time, elevatorId: e.id });
    this._emit('hall_call', { floor, dir, elevatorId: e.id });
    return e.id;
  }

  // Called when a passenger inside presses a destination button
  carCall(elevatorId, floor) {
    const e = this.elevators[elevatorId];
    if (!e) return;
    e.addCarCall(floor);
  }

  // Board a passenger onto an elevator
  boardPassenger(elevatorId, passenger) {
    const e = this.elevators[elevatorId];
    if (!e || e.state !== ElevatorState.DOOR_OPEN) return false;
    e.boardPassenger(passenger);
    this.totalPassengers++;
    return true;
  }

  setMode(mode) {
    this.mode = mode;
    if (mode === 'FIRE') {
      this.elevators.forEach(e => {
        e.targetFloors.clear();
        e.addCarCall(1); // return to ground
      });
      this._emit('mode_change', { mode });
    }
  }

  update(dt) {
    this._time += dt;
    this.elevators.forEach(e => e.update(dt));
  }

  getStatus(id) { return this.elevators[id]?.status ?? null; }

  getAllStatus() { return this.elevators.map(e => e.status); }

  getStats() {
    const served = this.elevators.reduce((s, e) => s + e.passengersServed, 0);
    const utilization = this.elevators.map(e =>
      e.floorsTraversed / Math.max(1, this._time * FLOOR_SPEED));
    return {
      time: this._time,
      totalPassengersServed: served,
      pendingCalls: this.pendingCalls.length,
      avgUtilization: utilization.reduce((a, b) => a + b, 0) / this.elevators.length,
    };
  }

  resize(numElevators, numFloors, DispatchClass) {
    this.numFloors  = numFloors;
    if (DispatchClass) this.dispatcher = new DispatchClass();
    const prev = this.elevators.length;
    if (numElevators > prev) {
      for (let i = prev; i < numElevators; i++)
        this.elevators.push(new ElevatorUnit(i, numFloors, 1));
    } else {
      this.elevators.length = numElevators;
    }
    this.elevators.forEach(e => { e.numFloors = numFloors; });
  }
}
