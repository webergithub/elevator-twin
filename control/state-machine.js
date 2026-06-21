/**
 * Elevator state machine — mirrors industry FSM conventions (OTIS/Schindler/Kone)
 */

export const ElevatorState = Object.freeze({
  IDLE:          'IDLE',
  MOVING_UP:     'MOVING_UP',
  MOVING_DOWN:   'MOVING_DOWN',
  DOOR_OPENING:  'DOOR_OPENING',
  DOOR_OPEN:     'DOOR_OPEN',
  DOOR_CLOSING:  'DOOR_CLOSING',
  EMERGENCY:     'EMERGENCY',
  MAINTENANCE:   'MAINTENANCE',
});

export const ElevatorMode = Object.freeze({
  NORMAL:      'NORMAL',
  FIRE:        'FIRE',       // Return to ground, doors open
  EVACUATION:  'EVACUATION', // Sequential floor evacuation
  VIP:         'VIP',        // Priority to specific floors
  MAINTENANCE: 'MAINTENANCE',
});

export const Direction = Object.freeze({
  UP:   1,
  NONE: 0,
  DOWN: -1,
});

// Valid transitions: event → [fromStates] → toState
const TRANSITIONS = [
  { event: 'START_UP',       from: [ElevatorState.IDLE],                          to: ElevatorState.MOVING_UP },
  { event: 'START_DOWN',     from: [ElevatorState.IDLE],                          to: ElevatorState.MOVING_DOWN },
  { event: 'ARRIVE',         from: [ElevatorState.MOVING_UP, ElevatorState.MOVING_DOWN], to: ElevatorState.DOOR_OPENING },
  { event: 'DOOR_OPENED',    from: [ElevatorState.DOOR_OPENING],                  to: ElevatorState.DOOR_OPEN },
  { event: 'START_CLOSE',    from: [ElevatorState.DOOR_OPEN],                     to: ElevatorState.DOOR_CLOSING },
  { event: 'DOOR_CLOSED',    from: [ElevatorState.DOOR_CLOSING],                  to: ElevatorState.IDLE },
  { event: 'EMERGENCY',      from: Object.values(ElevatorState),                  to: ElevatorState.EMERGENCY },
  { event: 'CLEAR_EMERGENCY',from: [ElevatorState.EMERGENCY],                     to: ElevatorState.IDLE },
  { event: 'MAINTENANCE_ON', from: [ElevatorState.IDLE],                          to: ElevatorState.MAINTENANCE },
  { event: 'MAINTENANCE_OFF',from: [ElevatorState.MAINTENANCE],                   to: ElevatorState.IDLE },
];

export class StateMachine {
  constructor() {
    this.state = ElevatorState.IDLE;
    this._listeners = {};
  }

  on(event, fn) {
    (this._listeners[event] ??= []).push(fn);
    return this;
  }

  transition(event) {
    const rule = TRANSITIONS.find(t => t.event === event && t.from.includes(this.state));
    if (!rule) return false;
    const prev = this.state;
    this.state = rule.to;
    this._emit(rule.to, { from: prev, event });
    return true;
  }

  canTransition(event) {
    return TRANSITIONS.some(t => t.event === event && t.from.includes(this.state));
  }

  _emit(event, data) {
    (this._listeners[event] ?? []).forEach(fn => fn(data));
    (this._listeners['*'] ?? []).forEach(fn => fn({ type: event, ...data }));
  }
}
