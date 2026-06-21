/**
 * Traffic Analyzer — builds a temporal model of passenger demand.
 *
 * Output: TrafficModel → per (hour, floor) demand probability matrix.
 * Used by: scheduler.js to compute optimal idle positions.
 */

const HOURS_PER_DAY = 24;

/**
 * A single data point recorded when a passenger calls an elevator.
 * @typedef {{ timestamp: number, floor: number, direction: string, count: number }} TrafficEvent
 */

export class TrafficAnalyzer {
  /**
   * @param {number} numFloors
   */
  constructor(numFloors) {
    this.numFloors = numFloors;
    // demand[hour][floor] = total call count
    this._demand   = Array.from({ length: HOURS_PER_DAY }, () => new Float32Array(numFloors + 1));
    this._samples  = new Float32Array(HOURS_PER_DAY); // how many data points per hour
    this._events   = []; // raw event log
  }

  /**
   * Record a hall call event.
   * @param {number} floor
   * @param {string} direction  'UP' | 'DOWN'
   * @param {number} [count=1]  number of people (from passenger counter)
   * @param {Date|number} [when]
   */
  record(floor, direction, count = 1, when = new Date()) {
    const d    = when instanceof Date ? when : new Date(when);
    const hour = d.getHours();
    if (floor < 1 || floor > this.numFloors) return;

    this._demand[hour][floor] += count;
    this._samples[hour]++;
    this._events.push({ timestamp: d.getTime(), floor, direction, count });
  }

  /**
   * Record from simulation: inject synthetic 24h traffic pattern.
   * Typical office building:
   *   07-09h: morning rush (1→upper floors)
   *   12-13h: lunch (upper→mid, mid→ground)
   *   17-19h: evening rush (upper→1)
   *   rest:   low uniform demand
   */
  injectSyntheticPattern(days = 5) {
    const rng  = (a, b) => Math.floor(Math.random() * (b - a + 1)) + a;
    const nF   = this.numFloors;
    const groundFloor = 1;
    const now  = new Date();

    for (let d = 0; d < days; d++) {
      for (let h = 0; h < HOURS_PER_DAY; h++) {
        const date = new Date(now);
        date.setDate(date.getDate() - d);
        date.setHours(h, 0, 0, 0);

        let callsThisHour;
        if (h >= 7 && h < 9) {
          // Morning rush: ground → upper
          callsThisHour = rng(20, 40);
          for (let c = 0; c < callsThisHour; c++) {
            this.record(groundFloor, 'UP', 1, new Date(date.getTime() + rng(0, 3599999)));
          }
        } else if (h >= 12 && h < 13) {
          // Lunch: mid-floors + ground traffic
          callsThisHour = rng(10, 20);
          for (let c = 0; c < callsThisHour; c++) {
            const from = rng(Math.ceil(nF / 2), nF);
            this.record(from, 'DOWN', 1, new Date(date.getTime() + rng(0, 3599999)));
          }
        } else if (h >= 17 && h < 19) {
          // Evening rush: upper → ground
          callsThisHour = rng(25, 50);
          for (let c = 0; c < callsThisHour; c++) {
            const from = rng(Math.ceil(nF * 0.4), nF);
            this.record(from, 'DOWN', 1, new Date(date.getTime() + rng(0, 3599999)));
          }
        } else {
          // Off-peak: random low demand
          callsThisHour = rng(1, 8);
          for (let c = 0; c < callsThisHour; c++) {
            const from = rng(1, nF);
            this.record(from, Math.random() > 0.5 ? 'UP' : 'DOWN', 1,
              new Date(date.getTime() + rng(0, 3599999)));
          }
        }
      }
    }
  }

  // ── Model output ────────────────────────────────────────────────────────────

  /**
   * Returns a normalized demand matrix [hour][floor].
   * Values sum to 1.0 across all floors for each hour.
   */
  getDemandMatrix() {
    const nF  = this.numFloors;
    const mat = Array.from({ length: HOURS_PER_DAY }, (_, h) => {
      const row   = Array.from(this._demand[h]).slice(1, nF + 1); // floors 1..nF
      const total = row.reduce((s, v) => s + v, 0) || 1;
      return row.map(v => v / total);
    });
    return mat;
  }

  /**
   * For a given hour, returns the top-N busiest floors.
   * @param {number} hour  0–23
   * @param {number} n
   */
  getBusiestFloors(hour, n = 3) {
    const row = Array.from(this._demand[hour]).slice(1);
    return row
      .map((v, i) => ({ floor: i + 1, demand: v }))
      .sort((a, b) => b.demand - a.demand)
      .slice(0, n);
  }

  /**
   * Weighted centroid floor for a given hour — useful as a single idle target.
   */
  getCentroidFloor(hour) {
    const row = Array.from(this._demand[hour]).slice(1);
    const total = row.reduce((s, v) => s + v, 0) || 1;
    const centroid = row.reduce((s, v, i) => s + v * (i + 1), 0) / total;
    return Math.round(centroid);
  }

  /**
   * Time-of-day label: 'morning_rush' | 'lunch' | 'evening_rush' | 'off_peak'
   */
  static periodLabel(hour) {
    if (hour >= 7  && hour <  9) return 'morning_rush';
    if (hour >= 12 && hour < 13) return 'lunch';
    if (hour >= 17 && hour < 19) return 'evening_rush';
    return 'off_peak';
  }

  getReport() {
    return {
      numFloors:    this.numFloors,
      totalEvents:  this._events.length,
      hourSummary:  Array.from({ length: HOURS_PER_DAY }, (_, h) => ({
        hour:     h,
        period:   TrafficAnalyzer.periodLabel(h),
        calls:    this._samples[h],
        centroid: this.getCentroidFloor(h),
        top3:     this.getBusiestFloors(h, 3),
      })),
    };
  }

  resize(numFloors) {
    this.numFloors = numFloors;
    this._demand   = Array.from({ length: HOURS_PER_DAY }, () => new Float32Array(numFloors + 1));
    this._samples  = new Float32Array(HOURS_PER_DAY);
    this._events   = [];
  }
}
