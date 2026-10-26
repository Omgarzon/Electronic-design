/**
 * main.js — page behaviour for the PMB-1.3 site.
 *
 * Everything here runs without Three.js: navigation, scroll reveals, tabs and
 * the annotation DOM. The renderer is imported lazily so the first paint stays
 * fast, and the whole page keeps working if WebGL is unavailable.
 */
import { ANCHORS } from './annotations.js';

const $ = (selector, scope = document) => scope.querySelector(selector);
const $$ = (selector, scope = document) => Array.from(scope.querySelectorAll(selector));
const desktopQuery = window.matchMedia('(min-width: 900px)');
const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

/* ── header & mobile navigation ───────────────────────────────────────────── */

function initHeader() {
  const header = $('[data-header]');
  if (!header) return;

  const onScroll = () => header.classList.toggle('is-stuck', window.scrollY > 24);
  onScroll();
  window.addEventListener('scroll', onScroll, { passive: true });

  const toggle = $('.nav-toggle', header);
  const mobileNav = $('#mobile-nav');
  if (!toggle || !mobileNav) return;

  const setOpen = (open) => {
    toggle.setAttribute('aria-expanded', String(open));
    toggle.setAttribute('aria-label', open ? 'Close menu' : 'Open menu');
    mobileNav.hidden = !open;
    mobileNav.classList.toggle('is-open', open);
    header.classList.toggle('is-open', open);
  };

  toggle.addEventListener('click', () => {
    setOpen(toggle.getAttribute('aria-expanded') !== 'true');
  });

  mobileNav.addEventListener('click', (event) => {
    if (event.target.closest('a')) setOpen(false);
  });

  window.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && toggle.getAttribute('aria-expanded') === 'true') {
      setOpen(false);
      toggle.focus();
    }
  });

  desktopQuery.addEventListener('change', (event) => {
    if (event.matches) setOpen(false);
  });
}

/* ── scroll reveals ───────────────────────────────────────────────────────── */

function initReveals() {
  const items = $$('[data-reveal]');
  if (!items.length) return;

  if (reduceMotion || !('IntersectionObserver' in window)) {
    items.forEach((item) => item.classList.add('is-visible'));
    return;
  }

  const observer = new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        if (!entry.isIntersecting) continue;
        entry.target.classList.add('is-visible');
        observer.unobserve(entry.target);
      }
    },
    { rootMargin: '0px 0px -10% 0px', threshold: 0.06 },
  );

  items.forEach((item) => observer.observe(item));
}

/* ── metric counters ──────────────────────────────────────────────────────── */

function initCounters() {
  const values = $$('[data-count]');
  if (!values.length) return;

  const format = (value, decimals) =>
    decimals > 0 ? value.toFixed(decimals) : String(Math.round(value));

  const run = (element) => {
    const target = Number(element.dataset.count);
    const decimals = Number(element.dataset.decimals ?? 0);
    if (!Number.isFinite(target)) return;
    if (reduceMotion) {
      element.textContent = format(target, decimals);
      return;
    }
    const duration = 1100;
    const start = performance.now();
    const step = (now) => {
      const t = Math.min((now - start) / duration, 1);
      element.textContent = format(target * (1 - Math.pow(1 - t, 3)), decimals);
      if (t < 1) requestAnimationFrame(step);
      else element.textContent = format(target, decimals);
    };
    requestAnimationFrame(step);
  };

  if (!('IntersectionObserver' in window)) {
    values.forEach(run);
    return;
  }

  const observer = new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        if (!entry.isIntersecting) continue;
        run(entry.target);
        observer.unobserve(entry.target);
      }
    },
    { threshold: 0.6 },
  );

  values.forEach((value) => {
    value.textContent = '0';
    observer.observe(value);
  });
}

/* ── accessible tabs ──────────────────────────────────────────────────────── */

function initTabs() {
  const list = $('[role="tablist"]');
  if (!list) return;
  const tabs = $$('[role="tab"]', list);
  if (!tabs.length) return;

  const select = (index) => {
    tabs.forEach((tab, i) => {
      const selected = i === index;
      tab.setAttribute('aria-selected', String(selected));
      tab.tabIndex = selected ? 0 : -1;
      const panel = document.getElementById(tab.getAttribute('aria-controls'));
      if (panel) panel.hidden = !selected;
    });
    tabs[index].focus();
  };

  tabs.forEach((tab, index) => {
    tab.addEventListener('click', () => select(index));
    tab.addEventListener('keydown', (event) => {
      const last = tabs.length - 1;
      let next = null;
      if (event.key === 'ArrowRight') next = index === last ? 0 : index + 1;
      else if (event.key === 'ArrowLeft') next = index === 0 ? last : index - 1;
      else if (event.key === 'Home') next = 0;
      else if (event.key === 'End') next = last;
      if (next === null) return;
      event.preventDefault();
      select(next);
    });
  });
}

/* ── footer year ──────────────────────────────────────────────────────────── */

function initYear() {
  for (const node of $$('[data-year]')) node.textContent = String(new Date().getFullYear());
}

/* ── annotations (DOM side) ───────────────────────────────────────────────── */

function buildHotspots() {
  const layer = $('[data-hotspots]');
  if (!layer) {
    return { update() {}, close() {}, setInteractive() {} };
  }

  const card = document.createElement('div');
  card.className = 'hotspot-card';
  card.setAttribute('role', 'dialog');
  card.setAttribute('aria-label', 'Annotation detail');
  card.hidden = true;
  card.innerHTML = `
    <button class="hotspot-card__close" type="button" aria-label="Close annotation">
      <svg viewBox="0 0 16 16" width="12" height="12" aria-hidden="true" focusable="false">
        <path d="M3.6 3.6l8.8 8.8M12.4 3.6l-8.8 8.8" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" fill="none" />
      </svg>
    </button>
    <p class="hotspot-card__meta"></p>
    <h3 class="hotspot-card__title"></h3>
    <p class="hotspot-card__body"></p>
  `;

  const meta = card.querySelector('.hotspot-card__meta');
  const title = card.querySelector('.hotspot-card__title');
  const body = card.querySelector('.hotspot-card__body');
  const elements = new Map();
  let positions = [];

  const closeAll = (restoreFocus = false) => {
    const id = card.dataset.for;
    card.classList.remove('is-open');
    card.hidden = true;
    card.dataset.for = '';
    for (const button of elements.values()) button.setAttribute('aria-expanded', 'false');
    if (restoreFocus && id) elements.get(id)?.focus();
  };

  for (const anchor of ANCHORS) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'hotspot';
    button.dataset.anchor = anchor.id;
    button.dataset.side = anchor.side;
    button.setAttribute('aria-expanded', 'false');
    button.innerHTML = `
      <span class="hotspot__dot" aria-hidden="true"></span>
      <span class="hotspot__label">${anchor.title}</span>
    `;
    button.addEventListener('click', () => {
      const willOpen = button.getAttribute('aria-expanded') !== 'true';
      closeAll();
      if (!willOpen) return;
      meta.textContent = anchor.meta;
      title.textContent = anchor.title;
      body.textContent = anchor.body;
      card.dataset.for = anchor.id;
      card.hidden = false;
      requestAnimationFrame(() => card.classList.add('is-open'));
      button.setAttribute('aria-expanded', 'true');
      positionCard();
    });
    layer.append(button);
    elements.set(anchor.id, button);
  }

  layer.append(card);
  card.querySelector('.hotspot-card__close').addEventListener('click', () => closeAll(true));

  window.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && !card.hidden) closeAll(true);
  });

  function positionCard() {
    const id = card.dataset.for;
    const anchor = ANCHORS.find((item) => item.id === id);
    const point = positions.find((item) => item.id === id);
    if (!anchor || !point) return;

    if (window.matchMedia('(max-width: 899px)').matches) {
      card.style.removeProperty('transform');
      card.style.removeProperty('left');
      card.style.removeProperty('top');
      return;
    }

    const width = 262;
    const gap = 20;
    const left =
      point.x + (anchor.side === 'left' ? -width - gap : gap);
    const top = point.y - 14;
    card.style.transform = 'none';
    card.style.left = `${Math.min(Math.max(left, 14), Math.max(layer.clientWidth - width - 14, 14))}px`;
    card.style.top = `${Math.min(Math.max(top, 14), Math.max(layer.clientHeight - 170, 14))}px`;
  }

  window.addEventListener('resize', () => {
    if (!card.hidden) positionCard();
  });

  return {
    update(next) {
      positions = next;
      const byId = new Map(positions.map((point) => [point.id, point]));
      for (const [id, button] of elements) {
        const point = byId.get(id);
        if (!point || !point.visible) {
          button.classList.remove('is-visible');
          button.style.pointerEvents = 'none';
          if (card.dataset.for === id) closeAll();
          continue;
        }
        button.classList.add('is-visible');
        button.style.pointerEvents = 'auto';
        button.style.transform = `translate3d(${point.x.toFixed(1)}px, ${point.y.toFixed(1)}px, 0) translate(-50%, -50%)`;
      }
      if (!card.hidden) positionCard();
    },
    close() {
      closeAll();
    },
    setInteractive(on) {
      layer.style.pointerEvents = on ? '' : 'none';
      if (!on) closeAll();
    },
  };
}

/* ── 3D stage wiring ──────────────────────────────────────────────────────── */

async function initStage() {
  const stage = $('[data-stage]');
  const canvas = $('[data-canvas]');
  if (!stage || !canvas) return;

  const dock = $('[data-dock]');
  const status = $('[data-loading]');
  const bar = $('[data-bar]');
  const pct = $('[data-pct]');
  const hint = $('[data-hint]');
  const fallback = $('[data-fallback]');
  const statusLabel = status ? status.querySelector('[data-loading-label]') : null;

  const clamp01 = (value) => Math.min(Math.max(Number(value) || 0, 0), 1);

  /* shareable deep links: ?m=baked&n=0&a=0&f=1 */
  const params = new URLSearchParams(window.location.search);
  const flag = (name, fallback) => {
    const value = params.get(name);
    if (value === null) return fallback;
    return value !== '0' && value !== 'false';
  };

  const state = {
    annotations: flag('n', true),
    autoRotate: flag('a', !reduceMotion),
    focus: false,
    material: params.get('m') === 'baked' ? 'baked' : 'pbr',
  };

  let viewer = null;
  let hotspots = null;

  const setPressed = (name, value) => {
    dock?.querySelectorAll(`[data-view="${name}"]`).forEach((button) => {
      button.setAttribute('aria-pressed', String(Boolean(value)));
    });
  };

  const setProgress = (value) => {
    if (!status || !bar || !pct) return;
    if (value === null) {
      status.hidden = true;
      return;
    }
    status.hidden = false;
    if (value.label && statusLabel) statusLabel.textContent = value.label;
    if (value.indeterminate) {
      bar.style.width = '100%';
      bar.style.opacity = '0.4';
      pct.textContent = '…';
      return;
    }
    const percent = Math.round(clamp01(value.ratio ?? value) * 100);
    bar.style.opacity = '1';
    bar.style.width = `${percent}%`;
    pct.textContent = `${percent}%`;
  };

  const showFallback = (message) => {
    stage.classList.add('is-fallback');
    if (fallback) {
      fallback.hidden = false;
      const text = fallback.querySelector('[data-fallback-text]');
      if (text && message) text.textContent = message;
    }
    if (status) status.hidden = true;
    if (dock) dock.hidden = true;
    if (hint) hint.hidden = true;
  };

  const { supportsWebGL, isSoftwareRenderer, createViewer } = await import('./viewer.js');

  if (!supportsWebGL()) {
    showFallback('Your browser could not start WebGL — the rendered image is shown instead.');
    return;
  }

  /* Force the live view on (?3d=on) or off (?3d=off) — handy on VMs and for
     anyone who prefers the still image. */
  const preference = (new URLSearchParams(window.location.search).get('3d') ?? 'auto').toLowerCase();
  if (preference === 'off') {
    showFallback('The live 3D view is switched off — the rendered image is shown instead.');
    return;
  }

  /* Software rasterisers can technically run WebGL but not at a usable frame
     rate, so those visitors get the rendered still instead of a slideshow. */
  if (preference !== 'on' && isSoftwareRenderer()) {
    showFallback(
      'Hardware acceleration is unavailable here, so the rendered image is shown instead of the live model.',
    );
    return;
  }

  hotspots = buildHotspots();

  try {
    viewer = await createViewer({
      canvas,
      stage,
      desktopQuery,
      initialMaterial: state.material,
      initialAnnotations: state.annotations,
      initialAutoRotate: state.autoRotate,
      onProgress: setProgress,
      onAnchorFrame: (positions) => hotspots.update(positions),
      onReady: () => {
        setProgress(1);
        window.setTimeout(() => setProgress(null), 260);
        stage.classList.remove('is-loading');
        stage.classList.add('is-ready');
      },
    });
  } catch (error) {
    console.error('[pmb-1.3] could not start the 3D viewer', error);
    showFallback('The 3D model could not be loaded — the rendered image is shown instead.');
    return;
  }

  const modeLabel = $('[data-mode-label]');

  setPressed('annotations', state.annotations);
  setPressed('autoRotate', state.autoRotate);
  setPressed('focus', false);
  $('[data-view="mode"]')?.setAttribute('aria-pressed', String(state.material === 'baked'));
  if (modeLabel) modeLabel.textContent = state.material === 'pbr' ? 'PBR' : 'Baked';

  /* ── dock actions ───────────────────────────────────────────────────────── */

  const setFocus = (on) => {
    state.focus = on;
    document.body.classList.toggle('is-focus', on);
    setPressed('focus', on);
    hotspots.setInteractive(!on);
    if (on) {
      hotspots.close();
      viewer.focus();
    } else {
      viewer.reset();
    }
  };

  const setAnnotations = (on) => {
    state.annotations = on;
    setPressed('annotations', on);
    viewer.setAnnotations(on);
  };

  const setAutoRotate = (on) => {
    state.autoRotate = on;
    setPressed('autoRotate', on);
    viewer.setAutoRotate(on);
  };

  const toggleMaterial = async () => {
    const next = state.material === 'pbr' ? 'baked' : 'pbr';
    const button = $('[data-view="mode"]');
    button?.classList.add('is-busy');
    const applied = await viewer.setMaterial(next);
    button?.classList.remove('is-busy');
    state.material = applied;
    if (modeLabel) modeLabel.textContent = applied === 'pbr' ? 'PBR' : 'Baked';
    button?.setAttribute('aria-pressed', String(applied === 'baked'));
  };

  const actions = {
    annotations: () => setAnnotations(!state.annotations),
    autorotate: () => setAutoRotate(!state.autoRotate),
    mode: toggleMaterial,
    reset: () => {
      if (state.focus) setFocus(false);
      else {
        viewer.reset();
        hotspots.close();
      }
    },
    snapshot: async () => {
      const button = $('[data-view="snapshot"]');
      button?.classList.add('is-busy');
      const ok = await viewer.snapshot();
      button?.classList.remove('is-busy');
      if (!ok) return;
      button?.classList.add('is-done');
      window.setTimeout(() => button?.classList.remove('is-done'), 1500);
    },
    focus: () => setFocus(!state.focus),
  };

  dock?.addEventListener('click', (event) => {
    const button = event.target.closest('[data-view]');
    if (!button) return;
    actions[button.dataset.view]?.();
  });

  $$('[data-action="focus"]').forEach((button) => {
    button.addEventListener('click', () => setFocus(true));
  });

  /* keyboard shortcuts, ignored while typing */
  window.addEventListener('keydown', (event) => {
    const active = document.activeElement;
    if (
      active &&
      (active.tagName === 'INPUT' || active.tagName === 'TEXTAREA' || active.isContentEditable)
    ) {
      return;
    }
    if (event.metaKey || event.ctrlKey || event.altKey) return;
    const action = {
      f: 'focus',
      a: 'autorotate',
      n: 'annotations',
      m: 'mode',
      r: 'reset',
    }[event.key.toLowerCase()];
    if (action) actions[action]?.();
    else if (event.key === 'Escape' && state.focus) setFocus(false);
  });

  canvas.addEventListener('webglcontextlost', (event) => {
    event.preventDefault();
    showFallback('The graphics context was lost — reload the page to restart the 3D view.');
  });
}

/* ── boot ─────────────────────────────────────────────────────────────────── */

initHeader();
initTabs();
initReveals();
initCounters();
initYear();

const startStage = () => {
  initStage().catch((error) => console.error('[pmb-1.3] stage failed', error));
};

if (document.readyState === 'complete') startStage();
else window.addEventListener('load', startStage, { once: true });
