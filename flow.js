'use strict';
// A small incompressible velocity grid carries the particle trails.
// Cursor displacement adds momentum; pressure projection keeps the flow divergence-free.
(() => {
  const canvas = document.getElementById('water');
  const ctx = canvas.getContext('2d', { alpha: false });
  const motion = document.getElementById('motion');
  const stir = document.getElementById('drop');
  if (!ctx) { motion.hidden = true; stir.hidden = true; return; }
  const reduced = matchMedia('(prefers-reduced-motion: reduce)');
  let paused = reduced.matches;
  let width, height, nx, ny, size, u, v, nextU, nextV, pressure, pressureNext, divergence, curl;
  let panels = [];
  let particles = [], pointer = null, lastTime = 0, frameId = null;
  let light = document.documentElement.dataset.theme === 'light';
  // A velocity-inspired cool-to-warm ramp; darker tones retain contrast in light mode.
  const palette = () => light
    ? ['#3058a2', '#177fbb', '#148e9b', '#9b9626', '#ce7624', '#ba3d36']
    : ['#426bd1', '#359fe2', '#42cccf', '#e5d75c', '#f49b48', '#ee6356'];
  function syncMotion() {
    motion.textContent = paused ? '▶' : 'Ⅱ';
    motion.setAttribute('aria-pressed', String(paused));
    motion.setAttribute('aria-label', paused ? 'Resume flow animation' : 'Pause flow animation');
  }
  function clear() {
    ctx.fillStyle = light ? '#dce8e8' : '#091820';
    ctx.fillRect(0, 0, width, height);
  }
  function sample(field, x, y) {
    x = Math.max(0, Math.min(nx - 1.001, x));
    y = Math.max(0, Math.min(ny - 1.001, y));
    const ix = Math.floor(x), iy = Math.floor(y), fx = x - ix, fy = y - iy;
    const k = iy * nx + ix;
    return (field[k] * (1 - fx) + field[k + 1] * fx) * (1 - fy)
      + (field[k + nx] * (1 - fx) + field[k + nx + 1] * fx) * fy;
  }
  function inject(x, y, dx, dy, radius = 7) {
    const cx = x / width * (nx - 1), cy = y / height * (ny - 1);
    const fx = Math.max(-16, Math.min(16, dx / width * nx));
    const fy = Math.max(-16, Math.min(16, dy / height * ny));
    for (let j = Math.max(1, Math.floor(cy - radius)); j < Math.min(ny - 1, cy + radius); j++) {
      for (let i = Math.max(1, Math.floor(cx - radius)); i < Math.min(nx - 1, cx + radius); i++) {
        const d = ((i - cx) ** 2 + (j - cy) ** 2) / (radius * radius);
        if (d >= 1) continue;
        const weight = (1 - d) ** 2, k = j * nx + i;
        u[k] = Math.max(-22, Math.min(22, u[k] + fx * weight));
        v[k] = Math.max(-22, Math.min(22, v[k] + fy * weight));
      }
    }
  }
  function updatePanels() {
    panels = [...document.querySelectorAll('.panel')].map(el => el.getBoundingClientRect());
  }
  function respawn(p) {
    // Spend most particles in the exposed background, including gaps between cards.
    for (let attempt = 0; attempt < 8; attempt++) {
      p.x = Math.random() * width; p.y = Math.random() * height;
      if (!panels.some(r => p.x > r.left && p.x < r.right && p.y > r.top && p.y < r.bottom)) break;
    }
    p.age = 0; p.energy = 0;
    return p;
  }
  function seed() {
    for (let j = 1; j < ny - 1; j++) for (let i = 1; i < nx - 1; i++) {
      const x = i / nx, y = j / ny, k = j * nx + i;
      u[k] = 1.5 * Math.sin(y * Math.PI * 4) * Math.cos(x * Math.PI * 3);
      v[k] = -1.125 * Math.cos(y * Math.PI * 4) * Math.sin(x * Math.PI * 3);
    }
  }
  function resize() {
    width = innerWidth; height = innerHeight;
    const ratio = Math.min(devicePixelRatio || 1, 1.5);
    canvas.width = Math.round(width * ratio); canvas.height = Math.round(height * ratio);
    ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
    nx = Math.max(32, Math.min(160, Math.round(width / 10)));
    ny = Math.max(24, Math.min(110, Math.round(height / 10)));
    size = nx * ny;
    [u, v, nextU, nextV, pressure, pressureNext, divergence, curl] = Array.from({ length: 8 }, () => new Float32Array(size));
    updatePanels();
    particles = Array.from({ length: Math.min(1750, Math.round(width * height / 560)) }, () => {
      const p = respawn({}); p.age = Math.random() * 230; return p;
    });
    pointer = null; seed(); clear();
    // Render a settled still for reduced motion and while paused.
    for (let i = 0; i < 16; i++) draw(0.55);
  }
  function solve(dt) {
    for (let y = 1; y < ny - 1; y++) for (let x = 1; x < nx - 1; x++) {
      const k = y * nx + x, bx = x - u[k] * dt, by = y - v[k] * dt;
      nextU[k] = sample(u, bx, by) * 0.997 + 0.004 * Math.sin(y / ny * Math.PI * 4) * Math.cos(x / nx * Math.PI * 3);
      nextV[k] = sample(v, bx, by) * 0.997 - 0.003 * Math.cos(y / ny * Math.PI * 4) * Math.sin(x / nx * Math.PI * 3);
    }
    [u, nextU] = [nextU, u]; [v, nextV] = [nextV, v];
    // Restore small eddies lost to grid interpolation (vorticity confinement).
    for (let y = 1; y < ny - 1; y++) for (let x = 1; x < nx - 1; x++) {
      const k = y * nx + x;
      curl[k] = 0.5 * (v[k + 1] - v[k - 1] - u[k + nx] + u[k - nx]);
    }
    for (let y = 2; y < ny - 2; y++) for (let x = 2; x < nx - 2; x++) {
      const k = y * nx + x;
      const gx = Math.abs(curl[k + 1]) - Math.abs(curl[k - 1]);
      const gy = Math.abs(curl[k + nx]) - Math.abs(curl[k - nx]);
      const scale = 0.16 * dt * curl[k] / (Math.hypot(gx, gy) + 0.0001);
      u[k] = Math.max(-22, Math.min(22, u[k] + gy * scale));
      v[k] = Math.max(-22, Math.min(22, v[k] - gx * scale));
    }
    pressure.fill(0); pressureNext.fill(0);
    for (let y = 1; y < ny - 1; y++) for (let x = 1; x < nx - 1; x++) {
      const k = y * nx + x;
      divergence[k] = (u[k + 1] - u[k - 1] + v[k + nx] - v[k - nx]) * 0.5;
    }
    for (let n = 0; n < 12; n++) {
      for (let y = 1; y < ny - 1; y++) for (let x = 1; x < nx - 1; x++) {
        const k = y * nx + x;
        pressureNext[k] = (pressure[k - 1] + pressure[k + 1] + pressure[k - nx] + pressure[k + nx] - divergence[k]) * 0.25;
      }
      [pressure, pressureNext] = [pressureNext, pressure];
    }
    for (let y = 1; y < ny - 1; y++) for (let x = 1; x < nx - 1; x++) {
      const k = y * nx + x;
      u[k] -= (pressure[k + 1] - pressure[k - 1]) * 0.5;
      v[k] -= (pressure[k + nx] - pressure[k - nx]) * 0.5;
    }
  }
  function draw(dt) {
    ctx.fillStyle = light ? 'rgba(220,232,232,0.045)' : 'rgba(9,24,32,0.045)';
    ctx.fillRect(0, 0, width, height);
    const paths = Array.from({ length: 12 }, () => new Path2D());
    const cursorActive = pointer !== null;
    for (const p of particles) {
      const gx = p.x / width * (nx - 1), gy = p.y / height * (ny - 1);
      const ux = sample(u, gx, gy), uy = sample(v, gx, gy);
      // Midpoint integration follows curves without the angular Euler segments.
      const vx = sample(u, gx + ux * dt * 0.5, gy + uy * dt * 0.5);
      const vy = sample(v, gx + ux * dt * 0.5, gy + uy * dt * 0.5);
      let driftX = 0, driftY = 0;
      if (cursorActive) {
        // A local particle drift gathers the existing streams, while the underlying
        // incompressible fluid keeps crawling. No particles are emitted at the cursor.
        const rx = pointer.x - p.x, ry = pointer.y - p.y;
        const distance = Math.hypot(rx, ry);
        const falloff = Math.exp(-distance * distance / (130 * 130));
        const invDistance = 1 / Math.max(distance, 1);
        const pull = Math.max(-1.2, Math.min(5, (distance - 24) * 0.055)) * falloff;
        const orbit = 2.4 * falloff * Math.min(1, distance / 24);
        driftX = (rx * pull - ry * orbit) * invDistance;
        driftY = (ry * pull + rx * orbit) * invDistance;
      }
      const x = p.x + (vx * width / nx + driftX) * dt;
      const y = p.y + (vy * height / ny + driftY) * dt;
      p.age += dt;
      if (p.age > 240 || x < 0 || x >= width || y < 0 || y >= height) {
        respawn(p); continue;
      }
      p.energy *= Math.exp(-dt * 0.055);
      if (cursorActive) {
        const distance = Math.hypot(p.x - pointer.x, p.y - pointer.y);
        p.energy = Math.max(p.energy, Math.max(0, 1 - distance / 85));
      }
      // Color follows rendered speed, including the cursor's gathering motion.
      const speed = Math.hypot(vx * width / nx + driftX, vy * height / ny + driftY);
      const band = Math.min(5, Math.floor(speed / 1.5));
      const path = paths[band + (p.energy > 0.18 ? 6 : 0)];
      path.moveTo(p.x, p.y); path.lineTo(x, y);
      p.x = x; p.y = y;
    }
    ctx.lineCap = 'round';
    const colors = palette();
    // Keep the ambient field quiet; reserve contrast for the cursor and its recent wake.
    ctx.lineWidth = 0.55;
    ctx.globalAlpha = light ? 0.14 : 0.21;
    colors.forEach((color, i) => { ctx.strokeStyle = color; ctx.stroke(paths[i]); });
    ctx.lineWidth = light ? 2.4 : 3.6;
    ctx.globalAlpha = light ? 0.065 : 0.10;
    colors.forEach((color, i) => { ctx.strokeStyle = color; ctx.stroke(paths[i + 6]); });
    ctx.lineWidth = light ? 0.7 : 0.85;
    ctx.globalAlpha = light ? 0.42 : 0.65;
    colors.forEach((color, i) => { ctx.strokeStyle = color; ctx.stroke(paths[i + 6]); });
    ctx.globalAlpha = 1;
  }
  function frame(now) {
    frameId = null;
    if (paused || document.hidden) return;
    if (!lastTime) lastTime = now;
    const elapsed = now - lastTime;
    if (elapsed >= 1000 / 30) {
      const dt = Math.min(elapsed / 33.333, 1.6) * 0.65;
      solve(dt); draw(dt); lastTime = now;
    }
    frameId = requestAnimationFrame(frame);
  }
  function schedule() {
    if (frameId !== null) cancelAnimationFrame(frameId);
    frameId = null; lastTime = 0;
    if (!paused && !document.hidden) frameId = requestAnimationFrame(frame);
  }
  window.addEventListener('pointermove', e => {
    if (paused || e.pointerType === 'touch') return;
    if (pointer) {
      // A gentle nudge bends the flow along a moving cursor without creating a jet.
      inject(e.clientX, e.clientY, (e.clientX - pointer.x) * 0.25,
        (e.clientY - pointer.y) * 0.25, 5);
    }
    pointer = { x: e.clientX, y: e.clientY, time: e.timeStamp };
  }, { passive: true });
  document.addEventListener('pointerleave', () => { pointer = null; });
  window.addEventListener('blur', () => { pointer = null; });
  window.addEventListener('pointerdown', e => {
    if (!paused && !e.target.closest('button, a, input, textarea')) inject(e.clientX, e.clientY, 70, -50, 9);
  }, { passive: true });
  stir.addEventListener('click', () => {
    paused = false; syncMotion();
    // Both margins receive a pulse so it remains visible around the content cards.
    inject(width * 0.06, height * 0.42, 90, -110, 13);
    inject(width * 0.94, height * 0.65, -90, 110, 13);
    for (const p of particles) {
      if (Math.hypot(p.x - width * 0.06, p.y - height * 0.42) < 110 ||
          Math.hypot(p.x - width * 0.94, p.y - height * 0.65) < 110) p.energy = 1;
    }
    schedule();
  });
  motion.addEventListener('click', () => { paused = !paused; pointer = null; syncMotion(); schedule(); });
  reduced.addEventListener('change', e => { paused = e.matches; syncMotion(); schedule(); });
  window.addEventListener('portfolio-theme-change', () => {
    light = document.documentElement.dataset.theme === 'light'; clear();
    if (paused) for (let i = 0; i < 16; i++) draw(0.55);
  });
  window.addEventListener('resize', resize);
  window.addEventListener('scroll', updatePanels, { passive: true });
  document.addEventListener('visibilitychange', () => { pointer = null; schedule(); });
  syncMotion(); resize(); schedule();
})();
