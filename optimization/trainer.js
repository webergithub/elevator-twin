/**
 * Optimization Trainer — collects simulation data, trains the traffic model,
 * runs the scheduler, and pushes optimal idle positions back to the API.
 *
 * Integration loop:
 *   1. Listen to ElevatorAPI events → feed TrafficAnalyzer
 *   2. Listen to door_open events → simulate camera + weight readings
 *   3. Every TRAIN_INTERVAL seconds → re-optimize idle positions
 *   4. Apply positions via api.setIdlePositions()
 */

import { PassengerCounter } from './passenger-counter.js';
import { WeightValidator   } from './weight-validator.js';
import { TrafficAnalyzer   } from './traffic-analyzer.js';
import { IdleScheduler     } from './scheduler.js';

const TRAIN_INTERVAL = 60;   // seconds between optimization runs
const SEED_DAYS      = 5;    // days of synthetic history to seed on first run

export class Trainer {
  /**
   * @param {import('../control/elevator-api.js').ElevatorAPI} api
   * @param {{ numFloors: number, numElevators: number, verbose?: boolean }} opts
   */
  constructor(api, opts) {
    this.api          = api;
    this.numFloors    = opts.numFloors;
    this.numElevators = opts.numElevators;
    this.verbose      = opts.verbose ?? false;

    this.counter   = new PassengerCounter({ mockMode: true });
    this.validator = new WeightValidator({ ratedCapacityKg: this.numFloors * 80 });
    this.analyzer  = new TrafficAnalyzer(this.numFloors);
    this.scheduler = new IdleScheduler(this.numFloors, this.numElevators);

    this._trainTimer  = 0;
    this._iteration   = 0;
    this._metrics     = [];  // history of optimization results
    this._lastPositions = null;
    this._running     = false;

    // Per-elevator weight tracking
    this._prevWeights = new Float32Array(this.numElevators);

    this._wireEvents();
  }

  _wireEvents() {
    // Hall calls → traffic data
    this.api.on('hall_call', ({ floor, dir }) => {
      this.analyzer.record(floor, dir, 1, new Date());
    });

    // Door open → camera + weight validation
    this.api.on('door_open', async ({ elevatorId, floor }) => {
      const status  = this.api.getStatus(elevatorId);
      if (!status) return;

      const paxCount = status.passengerCount;
      const weightKg = this.validator.simulateReading(paxCount);

      const cameraResult = await this.counter.processFrame({
        elevatorId, floor,
        timestamp:   Date.now(),
        groundTruth: { boarding: 0, alighting: Math.min(paxCount, 3) },
      });

      const prevWeight  = this._prevWeights[elevatorId];
      const validation  = this.validator.validate(cameraResult, prevWeight, weightKg);
      this._prevWeights[elevatorId] = weightKg;

      if (!validation.valid && this.verbose) {
        console.warn(`[Trainer] E${elevatorId+1} @${floor}F: camera/weight mismatch`, validation);
      }
    });

    this.api.on('passenger_exit', ({ floor }) => {
      this.analyzer.record(floor, 'ANY', 1, new Date());
    });
  }

  /**
   * Must be called each simulation tick.
   * @param {number} dt - delta time (seconds)
   */
  update(dt) {
    if (!this._running) return;
    this._trainTimer += dt;
    if (this._trainTimer >= TRAIN_INTERVAL) {
      this._trainTimer = 0;
      this._runOptimization();
    }
  }

  start() {
    this._running = true;

    // Seed with synthetic history so scheduler has something to work with immediately
    if (this._iteration === 0) {
      this.analyzer.injectSyntheticPattern(SEED_DAYS);
      this._runOptimization();
    }
    this._log('Trainer started');
  }

  stop() {
    this._running = false;
    this._log('Trainer stopped');
  }

  _runOptimization() {
    this._iteration++;
    const hour         = new Date().getHours();
    const demandMatrix = this.analyzer.getDemandMatrix();
    const demandNow    = demandMatrix[hour];

    const currentFloors = Array.from(
      { length: this.numElevators },
      (_, i) => this.api.getStatus(i)?.displayFloor ?? 1
    );

    const result = this.scheduler.optimize(demandNow, currentFloors, {
      iterations: 6000,
      T0:         4.0,
      cooling:    0.9994,
    });

    this._lastPositions = result.positions;
    this._metrics.push({
      iteration:    this._iteration,
      hour,
      expectedWait: result.expectedWait,
      variance:     result.variance,
      positions:    [...result.positions],
      timestamp:    Date.now(),
    });

    // Apply optimized idle positions
    this.api.setIdlePositions(result.positions);

    this._log(
      `[Iter ${this._iteration}] Hour ${hour}h — ` +
      `idle@[${result.positions.join(',')}] ` +
      `E[wait]=${result.expectedWait.toFixed(2)} Var=${result.variance.toFixed(2)}`
    );
  }

  // ── Reports ──────────────────────────────────────────────────────────────────

  getTrafficReport() { return this.analyzer.getReport(); }

  getSensorReport() {
    return {
      weight:     this.validator.getStatus(),
      cameraLog:  this.counter.getHistory(10),
      floorStats: this.counter.getFloorSummary(),
    };
  }

  getOptimizationHistory() { return [...this._metrics]; }

  /**
   * Full 24-hour scheduled plan (run once for planning reports).
   */
  getFullDayPlan() {
    const mat = this.analyzer.getDemandMatrix();
    const current = Array.from({ length: this.numElevators }, () => 1);
    return this.scheduler.scheduleFull24h(mat, current);
  }

  /**
   * Benchmark current algorithm vs naive strategies.
   */
  runBenchmark() {
    const hour = new Date().getHours();
    const P    = this.analyzer.getDemandMatrix()[hour];
    return this.scheduler.benchmark(P);
  }

  /** Reconfigure after building resize */
  resize(numFloors, numElevators) {
    this.numFloors    = numFloors;
    this.numElevators = numElevators;
    this.analyzer.resize(numFloors);
    this.scheduler   = new IdleScheduler(numFloors, numElevators);
    this._prevWeights = new Float32Array(numElevators);
    this._iteration   = 0;
    this.analyzer.injectSyntheticPattern(SEED_DAYS);
  }

  _log(msg) {
    if (this.verbose) console.log(`[Trainer] ${msg}`);
  }
}
