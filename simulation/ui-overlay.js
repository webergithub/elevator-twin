/**
 * HTML UI overlay — config panel, elevator status cards, stats bar, event log.
 */

export class UIOverlay {
  constructor(container, onConfigChange) {
    this._cb     = onConfigChange;
    this._config = { floors: 10, elevators: 3, spawnRate: 4, algorithm: 'LOOK' };
    this._log    = [];
    this._root   = this._build(container);
  }

  _build(container) {
    const overlay = document.createElement('div');
    overlay.id = 'ui-overlay';
    overlay.innerHTML = `
      <!-- Left: Config -->
      <div id="panel-config" class="panel">
        <h2 class="panel-title">⚙️ 配置</h2>

        <label class="ctrl-label">楼层数：<span id="val-floors">10</span></label>
        <input type="range" id="sl-floors" min="3" max="30" value="10" step="1">

        <label class="ctrl-label">电梯数量：<span id="val-elevators">3</span></label>
        <input type="range" id="sl-elevators" min="1" max="6" value="3" step="1">

        <label class="ctrl-label">乘客生成速率(s)：<span id="val-spawn">4</span></label>
        <input type="range" id="sl-spawn" min="1" max="12" value="4" step="0.5">

        <label class="ctrl-label">调度算法</label>
        <select id="sel-algo" class="sel-input">
          <option value="LOOK">LOOK（双向扫描）</option>
          <option value="NEAREST_CAR">最近轿厢</option>
          <option value="DCS">目标控制DCS</option>
        </select>

        <button id="btn-apply" class="btn-primary">应用配置</button>

        <hr class="divider">
        <h3 class="panel-subtitle">🚨 控制</h3>
        <button id="btn-emergency" class="btn-danger">紧急停梯</button>
        <button id="btn-clear"     class="btn-warn">清除紧急</button>
        <button id="btn-fire"      class="btn-warn">消防模式</button>
        <button id="btn-normal"    class="btn-secondary">恢复正常</button>
      </div>

      <!-- Right: Elevator status cards -->
      <div id="panel-status" class="panel">
        <h2 class="panel-title">🛗 电梯状态</h2>
        <div id="elevator-cards"></div>
      </div>

      <!-- Bottom: Stats bar -->
      <div id="stats-bar">
        <div class="stat-item"><span class="stat-lbl">⏱ 平均等待</span><span id="s-wait" class="stat-val">0s</span></div>
        <div class="stat-item"><span class="stat-lbl">👥 等候中</span><span id="s-waiting" class="stat-val">0</span></div>
        <div class="stat-item"><span class="stat-lbl">🛗 乘梯中</span><span id="s-riding" class="stat-val">0</span></div>
        <div class="stat-item"><span class="stat-lbl">✅ 已送达</span><span id="s-served" class="stat-val">0</span></div>
        <div class="stat-item"><span class="stat-lbl">📊 利用率</span><span id="s-util" class="stat-val">0%</span></div>
      </div>

      <!-- Event log -->
      <div id="event-log">
        <div class="log-title">事件日志</div>
        <div id="log-items"></div>
      </div>
    `;
    container.appendChild(overlay);

    // ── Slider bindings ───────────────────────────────────────────────────────
    this._bind('sl-floors',    'val-floors',    v => this._config.floors    = +v);
    this._bind('sl-elevators', 'val-elevators', v => this._config.elevators = +v);
    this._bind('sl-spawn',     'val-spawn',     v => this._config.spawnRate = +v);

    document.getElementById('sel-algo').addEventListener('change', e => {
      this._config.algorithm = e.target.value;
    });

    document.getElementById('btn-apply').addEventListener('click', () => {
      this._cb('reconfigure', this._config);
    });

    document.getElementById('btn-emergency').addEventListener('click', () => this._cb('emergency'));
    document.getElementById('btn-clear').addEventListener('click',     () => this._cb('clearEmergency'));
    document.getElementById('btn-fire').addEventListener('click',      () => this._cb('setMode', 'FIRE'));
    document.getElementById('btn-normal').addEventListener('click',    () => this._cb('setMode', 'NORMAL'));

    return overlay;
  }

  _bind(sliderId, valId, setter) {
    const sl  = document.getElementById(sliderId);
    const val = document.getElementById(valId);
    sl.addEventListener('input', () => { val.textContent = sl.value; setter(sl.value); });
  }

  // ── Status cards ──────────────────────────────────────────────────────────

  updateElevatorCards(allStatus) {
    const container = document.getElementById('elevator-cards');
    if (!container) return;

    // Rebuild cards if count changed
    if (container.children.length !== allStatus.length) {
      container.innerHTML = allStatus.map((_, i) =>
        `<div class="elev-card" id="ecard-${i}">
           <div class="ecard-id">E${i + 1}</div>
           <div class="ecard-floor" id="efloor-${i}">—</div>
           <div class="ecard-state" id="estate-${i}">—</div>
           <div class="ecard-bar"><div class="ecard-fill" id="efill-${i}"></div></div>
           <div class="ecard-pax" id="epax-${i}">👤 0</div>
           <div class="ecard-queue" id="equeue-${i}"></div>
         </div>`
      ).join('');
    }

    allStatus.forEach((s, i) => {
      const stateMap = {
        IDLE: ['停', 'idle'], MOVING_UP: ['上▲', 'moving'], MOVING_DOWN: ['下▼', 'moving'],
        DOOR_OPENING: ['开门…', 'door'], DOOR_OPEN: ['开门', 'door'],
        DOOR_CLOSING: ['关门…', 'door'], EMERGENCY: ['!急停', 'emergency'],
        MAINTENANCE: ['维护', 'maint'],
      };
      const [stateText, stateClass] = stateMap[s.state] ?? ['—', ''];

      const el = (id) => document.getElementById(id);
      if (!el(`efloor-${i}`)) return;

      el(`efloor-${i}`).textContent = `${s.displayFloor}F`;
      el(`estate-${i}`).textContent = stateText;
      el(`estate-${i}`).className   = `ecard-state ${stateClass}`;
      el(`efill-${i}`).style.width  = `${(s.doorPosition * 100).toFixed(0)}%`;
      el(`epax-${i}`).textContent   = `👤 ${s.passengerCount}`;
      el(`equeue-${i}`).textContent =
        s.targetFloors.length ? '→ ' + s.targetFloors.sort((a, b) => a - b).join(' ') : '';
    });
  }

  // ── Stats bar ─────────────────────────────────────────────────────────────

  updateStats({ avgWait, waiting, riding, totalServed, utilization }) {
    const set = (id, v) => { const e = document.getElementById(id); if (e) e.textContent = v; };
    set('s-wait',    `${avgWait}s`);
    set('s-waiting', waiting);
    set('s-riding',  riding);
    set('s-served',  totalServed);
    set('s-util',    `${(utilization * 100).toFixed(0)}%`);
  }

  // ── Event log ─────────────────────────────────────────────────────────────

  log(msg, type = 'info') {
    const now  = new Date();
    const time = `${now.getHours().toString().padStart(2,'0')}:${now.getMinutes().toString().padStart(2,'0')}:${now.getSeconds().toString().padStart(2,'0')}`;
    this._log.unshift({ time, msg, type });
    if (this._log.length > 60) this._log.pop();

    const container = document.getElementById('log-items');
    if (!container) return;
    container.innerHTML = this._log.slice(0, 20).map(e =>
      `<div class="log-item log-${e.type}"><span class="log-time">${e.time}</span>${e.msg}</div>`
    ).join('');
  }

  // ── Convenience ───────────────────────────────────────────────────────────
  updateStatsAll(passengerStats, systemStats) {
    const el = (id) => document.getElementById(id);
    if (el('s-wait'))    el('s-wait').textContent    = `${passengerStats.avgWait}s`;
    if (el('s-waiting')) el('s-waiting').textContent = passengerStats.waiting;
    if (el('s-riding'))  el('s-riding').textContent  = passengerStats.riding;
    if (el('s-served'))  el('s-served').textContent  = passengerStats.totalServed;
    if (el('s-util'))    el('s-util').textContent    = `${(systemStats.avgUtilization * 100).toFixed(0)}%`;
  }
}
