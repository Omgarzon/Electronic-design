/**
 * input.js — unified pilot input for keyboard and dual virtual joysticks.
 *
 * Every frame the game calls sample(), which returns normalised −1…1 command
 * channels. Discrete actions (thermal toggle, RTH, pause…) are queued as
 * edges and consumed once by the state machine, so a key press never fires
 * twice across two frames.
 */

const KEY_MAP = {
  KeyW: 'pitch+',
  ArrowUp: 'pitch+',
  KeyS: 'pitch-',
  ArrowDown: 'pitch-',
  KeyA: 'yaw-',
  ArrowLeft: 'yaw-',
  KeyD: 'yaw+',
  ArrowRight: 'yaw+',
  Space: 'climb+',
  KeyC: 'climb-',
  ControlLeft: 'climb-',
  ControlRight: 'climb-',
  KeyQ: 'roll-',
  KeyE: 'roll+',
  ShiftLeft: 'brake',
  ShiftRight: 'brake',
  KeyF: 'scan',
};

const EDGE_KEYS = {
  KeyT: 'thermal',
  KeyH: 'rth',
  Enter: 'takeoff',
  KeyP: 'pause',
  Escape: 'pause',
  KeyM: 'mute',
};

export class InputManager {
  constructor(root) {
    this.root = root;
    this.held = new Set(); // semantic channels currently held on keys
    this.sticks = {
      left: { x: 0, y: 0, pointerId: null },
      right: { x: 0, y: 0, pointerId: null },
    };
    this.scanHeld = false;
    this.brakeHeld = false;
    this.edges = [];
    this._onKeyDown = this._onKeyDown.bind(this);
    this._onKeyUp = this._onKeyUp.bind(this);
    this._onBlur = this._onBlur.bind(this);
    window.addEventListener('keydown', this._onKeyDown);
    window.addEventListener('keyup', this._onKeyUp);
    window.addEventListener('blur', this._onBlur);
    this._bindSticks();
    this._bindButtons();
  }

  dispose() {
    window.removeEventListener('keydown', this._onKeyDown);
    window.removeEventListener('keyup', this._onKeyUp);
    window.removeEventListener('blur', this._onBlur);
  }

  _onKeyDown(e) {
    const playing = document.body.dataset.playing === 'true';
    // Flight channels never hijack keys while a menu/overlay owns the screen.
    const channel = KEY_MAP[e.code];
    if (channel) {
      if (!playing) return;
      e.preventDefault();
      this.held.add(channel);
      if (channel === 'scan') this.scanHeld = true;
      if (channel === 'brake') this.brakeHeld = true;
    }
    // Pause and mute must still reach a paused game so keyboard resume works.
    const edge = EDGE_KEYS[e.code];
    if (edge && !e.repeat && (playing || edge === 'pause' || edge === 'mute')) {
      this.edges.push(edge);
    }
  }

  _onKeyUp(e) {
    const channel = KEY_MAP[e.code];
    if (channel) {
      this.held.delete(channel);
      if (channel === 'scan') this.scanHeld = false;
      if (channel === 'brake') this.brakeHeld = false;
    }
  }

  _onBlur() {
    this.held.clear();
    this.scanHeld = false;
    this.brakeHeld = false;
    for (const s of Object.values(this.sticks)) {
      s.x = 0;
      s.y = 0;
      s.pointerId = null;
    }
  }

  _bindSticks() {
    for (const [name, el] of Object.entries(this.sticks)) {
      const node = this.root.querySelector(`[data-stick="${name}"]`);
      if (!node) continue;
      el.node = node;
      el.knob = node.querySelector('.stick__knob');
      const reset = () => {
        el.x = 0;
        el.y = 0;
        el.pointerId = null;
        el.knob.style.transform = 'translate(-50%, -50%)';
      };
      node.addEventListener('pointerdown', (e) => {
        e.preventDefault();
        el.pointerId = e.pointerId;
        node.setPointerCapture(e.pointerId);
        update(e);
      });
      const update = (e) => {
        if (el.pointerId !== e.pointerId) return;
        const rect = node.getBoundingClientRect();
        const cx = rect.left + rect.width / 2;
        const cy = rect.top + rect.height / 2;
        const radius = rect.width / 2;
        let dx = (e.clientX - cx) / radius;
        let dy = (e.clientY - cy) / radius;
        const mag = Math.hypot(dx, dy);
        if (mag > 1) {
          dx /= mag;
          dy /= mag;
        }
        el.x = dx;
        el.y = dy;
        el.knob.style.transform = `translate(calc(-50% + ${dx * radius * 0.62}px), calc(-50% + ${dy * radius * 0.62}px))`;
      };
      node.addEventListener('pointermove', update);
      node.addEventListener('pointerup', reset);
      node.addEventListener('pointercancel', reset);
    }
  }

  _bindButtons() {
    this.root.querySelectorAll('[data-action]').forEach((btn) => {
      const action = btn.dataset.action;
      if (action === 'scan') {
        btn.addEventListener('pointerdown', (e) => {
          e.preventDefault();
          this.scanHeld = true;
          btn.classList.add('is-active');
        });
        const release = () => {
          this.scanHeld = false;
          btn.classList.remove('is-active');
        };
        btn.addEventListener('pointerup', release);
        btn.addEventListener('pointercancel', release);
        btn.addEventListener('pointerleave', release);
      } else {
        btn.addEventListener('click', () => this.edges.push(action));
      }
    });
  }

  /** Pull and clear the queued discrete actions. */
  consumeEdges() {
    const out = this.edges.slice();
    this.edges.length = 0;
    return out;
  }

  sample() {
    const L = this.sticks.left;
    const R = this.sticks.right;
    const h = this.held;
    const clamp = (v) => Math.max(-1, Math.min(1, v));
    const cmd = {
      // stick up is negative screen-y → positive climb / forward pitch
      climb: clamp(-L.y + (h.has('climb+') ? 1 : 0) - (h.has('climb-') ? 1 : 0)),
      yaw: clamp(L.x + (h.has('yaw+') ? 1 : 0) - (h.has('yaw-') ? 1 : 0)),
      pitch: clamp(-R.y + (h.has('pitch+') ? 1 : 0) - (h.has('pitch-') ? 1 : 0)),
      roll: clamp(R.x + (h.has('roll+') ? 1 : 0) - (h.has('roll-') ? 1 : 0)),
      deadStick: false,
    };
    if (this.brakeHeld) {
      cmd.pitch = 0;
      cmd.roll = 0;
      cmd.yaw = 0;
      cmd.climb = 0;
    }
    return cmd;
  }
}
