/**
 * main.js — bootstrap and screen flow for the PMB-1.3 inspection game.
 *
 * The heavy Three.js stack is imported dynamically after the menu paints,
 * mirroring the marketing page's lazy-loading approach.
 */
import { Game } from './game.js';
import { arSupported } from './ar.js';

const $ = (sel) => document.querySelector(sel);

function webglOK() {
  try {
    const canvas = document.createElement('canvas');
    return Boolean(canvas.getContext('webgl2') || canvas.getContext('webgl'));
  } catch {
    return false;
  }
}

async function boot() {
  const menu = $('#screen-menu');
  const loadBar = $('#menu-load-fill');
  const loadPct = $('#menu-load-pct');
  const launchers = menu.querySelectorAll('[data-launch]');
  launchers.forEach((b) => (b.disabled = true));

  if (!webglOK()) {
    $('#menu-intro').innerHTML =
      '<p class="menu__error">This browser has no WebGL support, so the inspection sortie cannot run. Try a current version of Chrome, Edge, Safari or Firefox.</p>';
    return;
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
}

function showScreen(id) {
  document.querySelectorAll('[data-screen]').forEach((s) => {
    s.hidden = s.id !== id;
  });
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
  const note = document.querySelector('#menu-intro');
  if (note) {
    note.insertAdjacentHTML(
      'beforeend',
      `<p class="menu__error">Could not start the game: ${err.message}</p>`,
    );
  }
});
