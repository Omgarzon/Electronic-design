/**
 * main.js — bootstrap and screen flow for the PMB-1.3 inspection game.
 *
 * The heavy Three.js stack is imported dynamically after the menu paints,
 * mirroring the marketing page's lazy-loading approach. All graphics
 * capability checks and quality tiers live in graphics.js.
 */
import { Game } from './game.js';
import { arSupported } from './ar.js';
import { detectGraphics } from './graphics.js';

const $ = (sel) => document.querySelector(sel);

/** Which full-screen DOM layer belongs to each game phase. */
const PHASE_SCREEN = {
  menu: 'screen-menu',
  placing: 'screen-placing',
  paused: 'screen-pause',
  ended: 'screen-results',
  flying: null,
};

function showScreen(id) {
  // Only the overlay sections carry a data-screen flag and must be toggled.
  // The <body> element also has data-screen (a static state hook in
  // game.html); selecting it here would set body.hidden = true on the first
  // screen change, hiding the whole document — audio keeps playing on a
  // completely black page, which was the reported black-screen bug.
  document.querySelectorAll('section[data-screen]').forEach((s) => {
    s.hidden = s.id !== id;
  });
}

/** Render a fatal graphics/render problem into the dedicated overlay. */
function showFatal({ title, message, advice }) {
  $('#fatal-title').textContent = title;
  $('#fatal-message').textContent = message;
  const adviceEl = $('#fatal-advice');
  if (advice) {
    adviceEl.hidden = false;
    adviceEl.textContent = advice;
  } else {
    adviceEl.hidden = true;
  }
  showScreen('screen-fatal');
}

/** Append an amber/red note to the menu without replacing the briefing. */
function addMenuNote(text, kind = 'warning') {
  const note = document.createElement('p');
  note.className = kind === 'error' ? 'menu__error' : 'menu__warning';
  note.textContent = text;
  const anchor = $('#menu-intro');
  anchor.insertAdjacentElement('afterend', note);
}

/** Reload the current page with ?quality=low appended/replaced. */
function reloadWithLowQuality() {
  const url = new URL(window.location.href);
  url.searchParams.set('quality', 'low');
  window.location.href = url.toString();
}

async function boot() {
  const menu = $('#screen-menu');
  const loadBar = $('#menu-load-fill');
  const loadPct = $('#menu-load-pct');
  const launchers = menu.querySelectorAll('[data-launch]');
  launchers.forEach((b) => (b.disabled = true));

  const graphics = detectGraphics();
  if (!graphics.webgl) {
    addMenuNote(
      'This browser has no working WebGL support, so the inspection sortie cannot run. Update to a current version of Chrome, Edge, Safari or Firefox, or enable hardware acceleration in the browser settings.',
      'error',
    );
    return;
  }

  // Software rasterisers (SwiftShader / llvmpipe / disabled GPU) can create a
  // context but not sustain the scene — the Game auto-selects its low-fidelity
  // tier; say so up front rather than failing onto a black canvas.
  if (graphics.software) {
    addMenuNote(
      'Hardware acceleration is unavailable on this device (software WebGL detected). The game starts in reduced-graphics mode: no anti-aliasing, capped resolution and 1024px shadow maps.',
    );
  } else if (graphics.forced === 'low') {
    addMenuNote('Reduced-graphics mode is on (?quality=low). Use ?quality=high to force the full renderer.');
  }

  const arOK = await arSupported();
  const arButton = $('[data-launch="ar"]');
  if (arButton) {
    arButton.hidden = !arOK;
    $('#ar-note').textContent = arOK
      ? 'Mixed reality: place the yard in your room at real 1:1 scale.'
      : 'Mixed reality needs a WebXR AR device (Android Chrome with ARCore). The simulator runs everywhere.';
  }

  const canvas = $('#game-canvas');
  const callbacks = {
    onPlacing() {
      showScreen('screen-placing');
    },
    onFlying() {
      showScreen(null);
      $('#hud').hidden = false;
      document.body.dataset.playing = 'true';
    },
    onPause(paused) {
      document.body.dataset.playing = paused ? 'false' : 'true';
      showScreen(paused ? 'screen-pause' : null);
    },
    onResults(data) {
      document.body.dataset.playing = 'false';
      fillResults(data);
      showScreen('screen-results');
    },
    onMenu() {
      document.body.dataset.playing = 'false';
      showScreen('screen-menu');
    },
    onQuit() {
      window.location.reload();
    },
    onARBlocked() {
      $('#ar-note').textContent =
        'The AR session could not start. Check camera permissions and ARCore support — the simulator is still available.';
      showScreen('screen-menu');
    },
    onFatal(detail) {
      document.body.dataset.playing = 'false';
      showFatal(detail);
    },
    onFatalRecover() {
      // Return to whichever layer matches the phase the sortie is paused in.
      showScreen(PHASE_SCREEN[game.phase] ?? 'screen-menu');
      if (game.phase === 'flying') $('#hud').hidden = false;
    },
  };

  const game = new Game(canvas, callbacks);
  window.__game = game; // handy for console debugging
  await game.init('sim', false, (p) => {
    loadBar.style.width = `${Math.round(p * 100)}%`;
    loadPct.textContent = `${Math.round(p * 100)}%`;
  });

  launchers.forEach((b) => (b.disabled = false));
  loadPct.textContent = 'ready';

  document.addEventListener('visibilitychange', () => {
    if (document.hidden && game.phase === 'flying') game.pause();
  });

  $('[data-launch="mission"]').addEventListener('click', () => {
    game.sfx.ensure();
    game.start(false);
  });
  $('[data-launch="sandbox"]').addEventListener('click', () => {
    game.sfx.ensure();
    game.start(true);
  });
  if (arOK) {
    arButton.addEventListener('click', () => {
      game.sfx.ensure();
      game.enterAR();
    });
  }

  $('#pause-resume').addEventListener('click', () => game.resume());
  $('#pause-end').addEventListener('click', () => game.endSortie());
  $('#pause-quit').addEventListener('click', () => window.location.reload());
  $('#results-retry').addEventListener('click', () => game.start(false));
  $('#results-menu').addEventListener('click', () => window.location.reload());

  $('#fatal-reload').addEventListener('click', () => window.location.reload());
  $('#fatal-reload-low').addEventListener('click', reloadWithLowQuality);
}

function fillResults(data) {
  $('#result-grade').textContent = data.grade;
  $('#result-total').textContent = data.total.toLocaleString();
  const rows = [
    ['Cracks graded', data.breakdown.scans],
    ['Gates cleared', data.breakdown.gates],
    ['Hull integrity', data.breakdown.hull],
    ['Pack remaining', data.breakdown.battery],
    ['Sortie time', data.breakdown.time],
    ['Battery bonus', `+${data.breakdown.batteryBonus}`],
    ['Time bonus', `+${data.breakdown.timeBonus}`],
  ];
  $('#result-rows').innerHTML = rows
    .map(([k, v]) => `<div class="result-row"><span>${k}</span><strong>${v}</strong></div>`)
    .join('');
  $('#result-title').textContent = data.completed
    ? 'Sortie complete — all cracks graded'
    : 'Sortie ended early';
}

boot().catch((err) => {
  console.error(err);
  // Never leave the player on a black canvas: force the menu back on and
  // keep every launch button disabled with an explanatory error.
  showScreen('screen-menu');
  document.body.dataset.playing = 'false';
  addMenuNote(`Could not start the game: ${err?.message || err}`, 'error');
  document
    .querySelectorAll('#screen-menu [data-launch]')
    .forEach((b) => {
      b.disabled = true;
    });
});
