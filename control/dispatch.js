/**
 * Elevator dispatch algorithms
 * Industry-standard: NearestCar, LOOK (bidirectional SCAN), Destination Control System
 */

import { Direction } from './state-machine.js';

// Cost of assigning a hall call (floor, dir) to elevator unit e
function nearestCarCost(e, floor, dir) {
  const d = Math.abs(e.currentFloor - floor);
  // Same direction and elevator hasn't passed the call yet
  if (e.direction === dir && dir === Direction.UP && e.currentFloor <= floor) return d;
  if (e.direction === dir && dir === Direction.DOWN && e.currentFloor >= floor) return d;
  // Idle elevator
  if (e.direction === Direction.NONE) return d;
  // Moving away or wrong direction — penalize
  return d + e.numFloors;
}

/**
 * NearestCar: assign each hall call to the elevator with minimum cost.
 * Low latency, works well for low-to-moderate traffic.
 */
export class NearestCarDispatch {
  assign(elevators, floor, dir) {
    let best = null, bestCost = Infinity;
    for (const e of elevators) {
      if (e.isOutOfService) continue;
      const c = nearestCarCost(e, floor, dir);
      if (c < bestCost) { bestCost = c; best = e; }
    }
    return best;
  }
}

/**
 * LOOK: each elevator sweeps in its current direction, then reverses.
 * Assign hall call to the elevator already heading toward it.
 */
export class LookDispatch {
  assign(elevators, floor, dir) {
    const available = elevators.filter(e => !e.isOutOfService);
    if (!available.length) return null;

    // Tier 1: elevator moving same direction, hasn't passed the floor
    const tier1 = available.filter(e =>
      (e.direction === dir && dir === Direction.UP && e.currentFloor <= floor) ||
      (e.direction === dir && dir === Direction.DOWN && e.currentFloor >= floor)
    );
    if (tier1.length) return tier1.reduce((a, b) =>
      Math.abs(a.currentFloor - floor) < Math.abs(b.currentFloor - floor) ? a : b);

    // Tier 2: idle elevators
    const idle = available.filter(e => e.direction === Direction.NONE);
    if (idle.length) return idle.reduce((a, b) =>
      Math.abs(a.currentFloor - floor) < Math.abs(b.currentFloor - floor) ? a : b);

    // Tier 3: any elevator (nearest)
    return available.reduce((a, b) =>
      nearestCarCost(a, floor, dir) < nearestCarCost(b, floor, dir) ? a : b);
  }
}

/**
 * Destination Control System (DCS): passengers declare destination at hall panel.
 * Groups passengers heading to same floor into the same car, reduces stops.
 * Best for high-traffic office buildings.
 */
export class DestinationControlDispatch {
  constructor() {
    this._assignments = new Map(); // elevatorId -> Set of destFloors
  }

  reset(elevators) {
    this._assignments.clear();
    for (const e of elevators) this._assignments.set(e.id, new Set(e.targetFloors));
  }

  assign(elevators, fromFloor, toFloor) {
    this.reset(elevators);
    const available = elevators.filter(e => !e.isOutOfService);
    if (!available.length) return null;

    let best = null, bestScore = Infinity;
    for (const e of available) {
      const destSet = this._assignments.get(e.id);
      const alreadyGoingThere = destSet.has(toFloor) ? 0 : 1;
      const dist = nearestCarCost(e, fromFloor, toFloor > fromFloor ? Direction.UP : Direction.DOWN);
      const stops = destSet.size;
      // Score: fewer new stops + shorter distance + fewer total stops
      const score = alreadyGoingThere * 3 + dist * 0.5 + stops * 0.2;
      if (score < bestScore) { bestScore = score; best = e; }
    }
    return best;
  }
}

export const DISPATCH_ALGORITHMS = {
  NEAREST_CAR: NearestCarDispatch,
  LOOK: LookDispatch,
  DCS: DestinationControlDispatch,
};
