/**
 * Passenger Counter — CV-based boarding/alighting detection at each floor stop.
 *
 * In production: wraps a real vision model API (e.g., YOLO person detector).
 * Here: provides a clean interface + deterministic mock for simulation integration.
 */

export class PassengerCounter {
  /**
   * @param {{ mockMode?: boolean, avgPersonWeight?: number }} options
   */
  constructor(options = {}) {
    this.mockMode        = options.mockMode        ?? true;
    this.avgPersonWeight = options.avgPersonWeight ?? 70; // kg
    this._history        = []; // { timestamp, floor, elevatorId, boarding, alighting, raw }
  }

  /**
   * Process a camera frame captured when doors are open at a floor stop.
   *
   * In mock mode: uses simulation ground-truth counts with ±10% sensor noise.
   * In real mode: calls external vision API (overrideable via setCameraAdapter).
   *
   * @param {object} frameData
   *   - elevatorId {number}
   *   - floor      {number}
   *   - timestamp  {number}
   *   - groundTruth { boarding, alighting } — only used in mock mode
   *   - imageBuffer {Uint8Array}            — used in real mode
   * @returns {{ boarding: number, alighting: number, confidence: number }}
   */
  async processFrame(frameData) {
    let result;
    if (this.mockMode) {
      result = this._mockDetect(frameData.groundTruth ?? { boarding: 0, alighting: 0 });
    } else {
      result = await this._realDetect(frameData.imageBuffer, frameData);
    }

    this._history.push({
      timestamp:  frameData.timestamp,
      floor:      frameData.floor,
      elevatorId: frameData.elevatorId,
      ...result,
    });

    return result;
  }

  _mockDetect({ boarding, alighting }) {
    // Add ±10% Gaussian-ish noise, floor to int
    const noise = (x) => Math.max(0, Math.round(x + (Math.random() - 0.5) * x * 0.2));
    return {
      boarding:   noise(boarding),
      alighting:  noise(alighting),
      confidence: 0.88 + Math.random() * 0.1,
    };
  }

  async _realDetect(imageBuffer, meta) {
    if (!this._cameraAdapter) throw new Error('No camera adapter set. Call setCameraAdapter().');
    return this._cameraAdapter(imageBuffer, meta);
  }

  /**
   * Plug in your real vision API:
   *   counter.setCameraAdapter(async (imageBuffer, meta) => ({ boarding, alighting, confidence }))
   */
  setCameraAdapter(fn) {
    this.mockMode       = false;
    this._cameraAdapter = fn;
  }

  // ── Validation helpers ──────────────────────────────────────────────────────

  /**
   * Cross-check camera count vs weight sensor delta.
   * Returns { valid, discrepancy, suggestedCount }.
   */
  validateWithWeight(cameraResult, weightDeltaKg) {
    const cameraNet    = cameraResult.boarding - cameraResult.alighting;
    const sensorCount  = Math.round(weightDeltaKg / this.avgPersonWeight);
    const discrepancy  = Math.abs(cameraNet - sensorCount);
    const valid        = discrepancy <= 1; // allow ±1 person margin
    return {
      valid,
      discrepancy,
      cameraNet,
      sensorNet:      sensorCount,
      suggestedCount: valid ? cameraNet : Math.round((cameraNet + sensorCount) / 2),
    };
  }

  // ── Analytics ──────────────────────────────────────────────────────────────

  /** Returns per-floor traffic summary from recorded history */
  getFloorSummary() {
    const summary = {};
    for (const r of this._history) {
      const key = r.floor;
      summary[key] ??= { floor: r.floor, totalBoarding: 0, totalAlighting: 0, samples: 0 };
      summary[key].totalBoarding  += r.boarding;
      summary[key].totalAlighting += r.alighting;
      summary[key].samples++;
    }
    return Object.values(summary).sort((a, b) => a.floor - b.floor);
  }

  /** Returns recent N events */
  getHistory(n = 20) {
    return this._history.slice(-n);
  }

  reset() { this._history = []; }
}
