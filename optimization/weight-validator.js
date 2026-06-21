/**
 * Weight Sensor Validator — reads load cell data to cross-check passenger counts
 * and detect overload conditions.
 *
 * Industry reference: OTIS Gen2 / Schindler 3300 load weighing device (LWD).
 */

const AVG_PERSON_KG  = 70;
const OVERLOAD_RATIO = 1.10; // 110% rated capacity triggers alarm
const MIN_RATED_KG   = 630;  // typical 8-person car

export class WeightValidator {
  /**
   * @param {{ ratedCapacityKg?: number, avgPersonWeight?: number, noiseStdKg?: number }} opts
   */
  constructor(opts = {}) {
    this.ratedCapacity   = opts.ratedCapacityKg  ?? MIN_RATED_KG;
    this.avgPersonWeight = opts.avgPersonWeight   ?? AVG_PERSON_KG;
    this.noiseStd        = opts.noiseStdKg        ?? 2.5; // sensor noise std dev

    this._currentWeightKg = 0; // simulated load
    this._readings = [];       // rolling window
    this._windowSize = 20;
    this._listeners = {};
  }

  // ── Sensor interface ────────────────────────────────────────────────────────

  /**
   * Ingest a raw sensor reading (kg). Applies noise filtering.
   * In production: called by hardware driver ISR or MQTT message handler.
   * @param {number} rawKg
   * @param {number} [timestamp]
   */
  ingestReading(rawKg, timestamp = Date.now()) {
    const filtered = this._filter(rawKg);
    this._currentWeightKg = filtered;
    this._readings.push({ raw: rawKg, filtered, timestamp });
    if (this._readings.length > this._windowSize) this._readings.shift();

    // Overload check
    if (filtered > this.ratedCapacity * OVERLOAD_RATIO) {
      this._emit('overload', { weightKg: filtered, ratedKg: this.ratedCapacity });
    }
  }

  /**
   * Simulate a reading given actual passenger count (for mock/test mode).
   * Adds Gaussian noise ≈ N(0, noiseStd).
   */
  simulateReading(passengerCount, timestamp) {
    const trueWeight = passengerCount * this.avgPersonWeight;
    const noisy      = trueWeight + this._gaussian(0, this.noiseStd);
    this.ingestReading(Math.max(0, noisy), timestamp);
    return noisy;
  }

  /** Exponential moving average filter (α = 0.25) */
  _filter(raw) {
    if (!this._readings.length) return raw;
    const prev = this._readings[this._readings.length - 1].filtered;
    return 0.25 * raw + 0.75 * prev;
  }

  // ── Cross-validation ────────────────────────────────────────────────────────

  /**
   * Validate camera-detected count against weight sensor delta.
   * @param {{ boarding: number, alighting: number }} cameraResult
   * @param {number} weightBeforeKg
   * @param {number} weightAfterKg
   * @returns {{ valid, netPeople, weightNet, cameraNet, confidence, action }}
   */
  validate(cameraResult, weightBeforeKg, weightAfterKg) {
    const weightNet  = weightAfterKg - weightBeforeKg;
    const sensorNet  = Math.round(weightNet / this.avgPersonWeight);
    const cameraNet  = cameraResult.boarding - cameraResult.alighting;
    const diff       = Math.abs(sensorNet - cameraNet);

    // Confidence: drops as discrepancy grows
    const confidence = Math.max(0, 1 - diff * 0.25);
    const valid      = diff <= 1;

    // Reconciliation strategy
    let action = 'ACCEPT_CAMERA';
    if (!valid) {
      if (diff === 2 && confidence > 0.4) action = 'USE_AVERAGE';
      else action = 'FLAG_FOR_REVIEW';
    }

    return {
      valid,
      cameraNet,
      weightNet,
      sensorNet,
      discrepancy: diff,
      confidence,
      action,
      recommendation: this._recommend(action, cameraNet, sensorNet),
    };
  }

  _recommend(action, cameraNet, sensorNet) {
    if (action === 'ACCEPT_CAMERA') return cameraNet;
    if (action === 'USE_AVERAGE')   return Math.round((cameraNet + sensorNet) / 2);
    return sensorNet; // fallback to sensor when camera unreliable (dim conditions, crowd)
  }

  // ── Capacity info ───────────────────────────────────────────────────────────

  get currentWeightKg() { return this._currentWeightKg; }

  get estimatedPassengers() {
    return Math.round(this._currentWeightKg / this.avgPersonWeight);
  }

  get loadPercent() {
    return (this._currentWeightKg / this.ratedCapacity) * 100;
  }

  get isOverloaded() {
    return this._currentWeightKg > this.ratedCapacity * OVERLOAD_RATIO;
  }

  getStatus() {
    return {
      currentKg:       Math.round(this._currentWeightKg),
      ratedKg:         this.ratedCapacity,
      loadPercent:     this.loadPercent.toFixed(1),
      estimatedPax:    this.estimatedPassengers,
      overloaded:      this.isOverloaded,
      samplesRecorded: this._readings.length,
    };
  }

  // ── Events ──────────────────────────────────────────────────────────────────

  on(event, fn) { (this._listeners[event] ??= []).push(fn); return this; }
  _emit(event, data) { (this._listeners[event] ?? []).forEach(fn => fn(data)); }

  // ── Utils ───────────────────────────────────────────────────────────────────

  _gaussian(mean, std) {
    // Box-Muller transform
    const u1 = Math.random() || 1e-10;
    const u2 = Math.random();
    return mean + std * Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
  }

  reset() {
    this._readings = [];
    this._currentWeightKg = 0;
  }
}
