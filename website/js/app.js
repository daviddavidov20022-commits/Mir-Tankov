/**
 * ISERVERI Website — Core App Utilities
 * Toast, navbar, particles, reveal animations, etc.
 */

// ─── TOAST NOTIFICATIONS ──────────────────────────────────────
const Toast = {
  _container: null,

  _getContainer() {
    if (!this._container) {
      this._container = document.createElement('div');
      this._container.className = 'toast-container';
      document.body.appendChild(this._container);
    }
    return this._container;
  },

  show(icon, title, text = '', type = 'info', duration = 3500) {
    const container = this._getContainer();
    const el = document.createElement('div');
    el.className = `toast toast--${type}`;
    el.innerHTML = `
      <span class="toast__icon">${icon}</span>
      <div class="toast__body">
        <div class="toast__title">${title}</div>
        ${text ? `<div class="toast__text">${text}</div>` : ''}
      </div>
    `;
    container.appendChild(el);
    requestAnimationFrame(() => el.classList.add('toast--visible'));
    setTimeout(() => {
      el.classList.remove('toast--visible');
      setTimeout(() => el.remove(), 400);
    }, duration);
  },

  success(title, text = '') { this.show('✅', title, text, 'success'); },
  error(title, text = '')   { this.show('❌', title, text, 'error'); },
  info(title, text = '')    { this.show('ℹ️', title, text, 'info'); },
  cheese(amount)            { this.show('🧀', `+${amount} Сыра!`, 'Баланс пополнен', 'success'); },
};
window.Toast = Toast;

// legacy shim for old pages
window.showToast = (icon, text) => Toast.show(icon, text);

// ─── NAVBAR SCROLL EFFECT ─────────────────────────────────────
function initNavbar() {
  const navbar = document.getElementById('navbar');
  if (!navbar) return;

  const onScroll = () => {
    if (window.scrollY > 40) navbar.classList.add('navbar--scrolled');
    else navbar.classList.remove('navbar--scrolled');
  };
  window.addEventListener('scroll', onScroll, { passive: true });
  onScroll();

  // Hamburger
  const ham = document.getElementById('navHam');
  const drawer = document.getElementById('mobileDrawer');
  const overlay = document.getElementById('mobileOverlay');
  if (ham && drawer) {
    ham.addEventListener('click', () => {
      drawer.classList.toggle('open');
      if (overlay) overlay.classList.toggle('open');
    });
    if (overlay) {
      overlay.addEventListener('click', () => {
        drawer.classList.remove('open');
        overlay.classList.remove('open');
      });
    }
  }

  // Highlight active link
  document.querySelectorAll('.navbar__links a, .sidebar__item').forEach(link => {
    if (link.href && window.location.href.includes(link.getAttribute('href'))) {
      link.classList.add('active');
    }
  });
}

// ─── SCROLL REVEAL ────────────────────────────────────────────
function initReveal() {
  const obs = new IntersectionObserver(entries => {
    entries.forEach(e => { if (e.isIntersecting) e.target.classList.add('visible'); });
  }, { threshold: 0.08 });
  document.querySelectorAll('.reveal').forEach(el => obs.observe(el));
}

// ─── HERO CANVAS — RADAR + PARTICLES ─────────────────────────
function initHeroCanvas() {
  const canvas = document.getElementById('heroCanvas');
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  let W, H, raf;
  const particles = [];
  let radarAngle = 0;
  let mouse = { x: 0, y: 0 };

  function resize() {
    W = canvas.width = canvas.offsetWidth;
    H = canvas.height = canvas.offsetHeight;
  }

  resize();
  window.addEventListener('resize', resize);
  canvas.addEventListener('mousemove', e => {
    const r = canvas.getBoundingClientRect();
    mouse.x = e.clientX - r.left;
    mouse.y = e.clientY - r.top;
  });

  // Particle class
  class Dot {
    constructor() { this.reset(true); }
    reset(init = false) {
      this.x = Math.random() * W;
      this.y = init ? Math.random() * H : H + 5;
      this.vx = (Math.random() - 0.5) * 0.3;
      this.vy = -(0.2 + Math.random() * 0.4);
      this.r  = 0.5 + Math.random() * 1.5;
      this.a  = 0;
      this.maxA = 0.2 + Math.random() * 0.5;
      this.life = 0;
      this.maxLife = 200 + Math.random() * 300;
    }
    update() {
      this.x  += this.vx + (mouse.x / W - 0.5) * 0.05;
      this.y  += this.vy;
      this.life++;
      const progress = this.life / this.maxLife;
      this.a = progress < 0.2
        ? (progress / 0.2) * this.maxA
        : progress > 0.8
          ? ((1 - progress) / 0.2) * this.maxA
          : this.maxA;
      if (this.life >= this.maxLife || this.y < -5) this.reset();
    }
    draw() {
      ctx.save();
      ctx.globalAlpha = this.a;
      ctx.fillStyle = '#C8AA6E';
      ctx.shadowBlur = 4;
      ctx.shadowColor = '#C8AA6E';
      ctx.beginPath();
      ctx.arc(this.x, this.y, this.r, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }
  }

  for (let i = 0; i < 60; i++) particles.push(new Dot());

  // Radar sweep
  function drawRadar() {
    const cx = W * 0.5, cy = H * 0.55;
    const maxR = Math.max(W, H) * 0.6;

    // Subtle radar rings
    ctx.save();
    for (let i = 1; i <= 4; i++) {
      const r = (maxR / 4) * i;
      ctx.beginPath();
      ctx.arc(cx, cy, r, 0, Math.PI * 2);
      ctx.strokeStyle = `rgba(200,170,110,${0.03 - i * 0.005})`;
      ctx.lineWidth = 1;
      ctx.stroke();
    }

    // Sweep gradient
    const sweepLen = Math.PI * 0.35;
    const startA = radarAngle - sweepLen;
    const grad = ctx.createConicalGradient
      ? null // not widely supported
      : null;

    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate(radarAngle);
    const sweep = ctx.createLinearGradient(-maxR, 0, 0, 0);
    sweep.addColorStop(0, 'rgba(200,170,110,0)');
    sweep.addColorStop(0.7, 'rgba(200,170,110,0.04)');
    sweep.addColorStop(1, 'rgba(200,170,110,0.12)');

    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.arc(0, 0, maxR, -sweepLen, 0);
    ctx.closePath();
    ctx.fillStyle = sweep;
    ctx.fill();
    ctx.restore();

    radarAngle += 0.004;
    ctx.restore();
  }

  function frame() {
    ctx.clearRect(0, 0, W, H);

    // Dark gradient bg
    const bg = ctx.createRadialGradient(W/2, H/2, 0, W/2, H/2, Math.max(W,H)*0.7);
    bg.addColorStop(0, 'rgba(15,20,40,0.4)');
    bg.addColorStop(1, 'rgba(5,8,16,0)');
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, W, H);

    drawRadar();
    particles.forEach(p => { p.update(); p.draw(); });

    raf = requestAnimationFrame(frame);
  }

  frame();
  return () => cancelAnimationFrame(raf);
}

// ─── STREAM STATUS ────────────────────────────────────────────
async function checkStreams() {
  try {
    const data = await API.getStreamStatus();
    const platforms = {
      youtube: { badge: 'ytBadge', viewers: 'ytViewers', card: 'platYt' },
      vkplay:  { badge: 'vkBadge', viewers: 'vkViewers', card: 'platVk' },
      trovo:   { badge: 'trovoBadge', viewers: 'trovoViewers', card: 'platTrovo' },
      twitch:  { badge: 'twitchBadge', viewers: 'twitchViewers', card: 'platTwitch' },
    };

    let anyLive = false;
    let totalViewers = 0;

    for (const [platform, ids] of Object.entries(platforms)) {
      const info = data[platform];
      const badge = document.getElementById(ids.badge);
      const viewEl = document.getElementById(ids.viewers);
      const card = document.getElementById(ids.card);
      if (!badge) continue;

      const isLive = info && info.live;
      if (isLive) {
        anyLive = true;
        const v = info.viewers || 0;
        totalViewers += v;
        badge.textContent = v > 0 ? `LIVE · ${v}` : 'LIVE';
        badge.className = 'badge badge--live';
        if (card) card.classList.add('stream-card--live');
        if (viewEl) {
          viewEl.style.display = 'flex';
          const vc = viewEl.querySelector('.viewers-count');
          if (vc) vc.textContent = v.toLocaleString();
        }
      } else {
        badge.textContent = 'OFFLINE';
        badge.className = 'badge badge--offline';
        if (card) card.classList.remove('stream-card--live');
        if (viewEl) viewEl.style.display = 'none';
      }
    }

    // Hero live badge
    const heroBadge = document.getElementById('heroBadge');
    if (heroBadge) {
      if (anyLive) {
        heroBadge.innerHTML = `<span class="live-dot"></span> LIVE · ${totalViewers} зрителей`;
        heroBadge.className = 'hero__badge hero__badge--live';
      } else {
        heroBadge.innerHTML = '⚫ OFFLINE';
        heroBadge.className = 'hero__badge hero__badge--offline';
      }
    }

    // Navbar dot
    const navDot = document.getElementById('navLiveDot');
    if (navDot) navDot.style.display = anyLive ? 'inline-block' : 'none';

  } catch (e) {
    console.warn('[Streams] Error:', e);
  }
}

// ─── DAILY REWARD (server-backed) ─────────────────────────────
async function initDailyReward() {
  const btn = document.getElementById('dailyBtn');
  const card = document.getElementById('dailyCard');
  if (!btn && !card) return;
  if (!auth.isLoggedIn) return;

  try {
    const data = await API.getDailyStatus(auth.getId());
    const claimed = data.claimed_today;
    const streak  = data.streak || 0;
    const nextAmt = data.next_amount || 15;

    const amountEl = document.getElementById('dailyAmount');
    const streakEl = document.getElementById('dailyStreak');
    const labelEl  = document.getElementById('dailyLabel');

    if (amountEl) amountEl.textContent = `${nextAmt} 🧀`;
    if (streakEl) streakEl.textContent = `Серия: ${streak} дней`;

    if (claimed) {
      if (btn) { btn.disabled = true; btn.textContent = '✅ Уже получено'; }
      if (card) card.classList.add('daily-claimed');
      if (labelEl) labelEl.textContent = 'Приходи завтра!';
    }
  } catch {
    // fallback to localStorage
    const today = new Date().toDateString();
    const last  = localStorage.getItem('ws_daily_last');
    const streak = parseInt(localStorage.getItem('ws_daily_streak') || '0');
    if (last === today && btn) {
      btn.disabled = true;
      btn.textContent = '✅ Уже получено';
    }
    const amountEl = document.getElementById('dailyAmount');
    if (amountEl) {
      const tiers = [0,15,15,15,15,15,15,25,25,25,25,25,25,25,35,35,35,35,35,35,35,50];
      amountEl.textContent = `${tiers[Math.min(streak, tiers.length-1)] || 15} 🧀`;
    }
  }
}

async function claimDaily() {
  if (!auth.isLoggedIn) { Toast.error('Нужно войти в систему'); return; }
  const btn = document.getElementById('dailyBtn');
  if (btn) { btn.disabled = true; btn.textContent = '⏳'; }

  try {
    const data = await API.claimDaily(auth.getId());
    if (data.success || data.claimed) {
      const amount = data.amount || data.reward || 15;
      Toast.cheese(amount);
      if (btn) btn.textContent = '✅ Получено!';
      const card = document.getElementById('dailyCard');
      if (card) card.classList.add('daily-claimed');
      auth.balance += amount;
      updateBalanceUI(auth.balance);
      localStorage.setItem('ws_balance', auth.balance);
    } else {
      Toast.info('Уже получено', 'Приходи завтра!');
      if (btn) btn.textContent = '✅ Уже получено';
    }
  } catch {
    // localStorage fallback
    const today = new Date().toDateString();
    const last  = localStorage.getItem('ws_daily_last');
    if (last === today) { Toast.info('Уже получено сегодня'); return; }
    const streak = parseInt(localStorage.getItem('ws_daily_streak') || '0') + 1;
    const tiers = [0,15,15,15,15,15,15,25,25,25,25,25,25,25,35,35,35,35,35,35,35,50];
    const amount = tiers[Math.min(streak, tiers.length-1)] || 15;
    localStorage.setItem('ws_daily_last', today);
    localStorage.setItem('ws_daily_streak', streak);
    Toast.cheese(amount);
    if (btn) btn.textContent = '✅ Получено!';
  }
}
window.claimDaily = claimDaily;

// ─── MODAL HELPERS ────────────────────────────────────────────
function openModal(id) {
  const el = document.getElementById(id);
  if (el) el.classList.add('open');
}
function closeModal(id) {
  const el = document.getElementById(id);
  if (el) el.classList.remove('open');
}
window.openModal  = openModal;
window.closeModal = closeModal;

// Close modal on overlay click
document.addEventListener('click', e => {
  if (e.target.classList.contains('modal-overlay')) {
    e.target.classList.remove('open');
  }
});

// ─── LOADING SPINNER ──────────────────────────────────────────
function showLoader(containerId, rows = 3) {
  const el = document.getElementById(containerId);
  if (!el) return;
  el.innerHTML = Array(rows).fill(`
    <div style="padding:16px;border-bottom:1px solid rgba(255,255,255,0.04)">
      <div class="skeleton skeleton-text" style="width:60%"></div>
      <div class="skeleton skeleton-text" style="width:40%;margin-top:8px"></div>
    </div>
  `).join('');
}
window.showLoader = showLoader;

// ─── COPY TO CLIPBOARD ────────────────────────────────────────
function copyText(text, feedback = 'Скопировано!') {
  navigator.clipboard?.writeText(text).then(() => Toast.success(feedback));
}
window.copyText = copyText;

// ─── COUNTER ANIMATION ────────────────────────────────────────
function animateCounter(el, target, duration = 1200) {
  if (!el) return;
  const start = parseInt(el.textContent.replace(/\D/g,'')) || 0;
  const diff = target - start;
  const startTime = performance.now();
  function step(now) {
    const progress = Math.min((now - startTime) / duration, 1);
    const eased = 1 - Math.pow(1 - progress, 3);
    el.textContent = Math.round(start + diff * eased).toLocaleString();
    if (progress < 1) requestAnimationFrame(step);
  }
  requestAnimationFrame(step);
}
window.animateCounter = animateCounter;

// ─── INIT ON DOM READY ────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  initNavbar();
  initReveal();
  initHeroCanvas();

  // Update navbar user info
  if (auth.isLoggedIn) {
    const nameEl   = document.getElementById('navUsername');
    const balEl    = document.getElementById('navBalance');
    const avatarEl = document.getElementById('navAvatar');
    const loggedIn = document.getElementById('navLoggedIn');
    const loggedOut = document.getElementById('navLoggedOut');

    if (nameEl)   nameEl.textContent   = auth.username;
    if (balEl)    balEl.textContent    = auth.balance.toLocaleString();
    if (avatarEl) avatarEl.textContent = '🪖';
    if (loggedIn)  loggedIn.style.display  = 'flex';
    if (loggedOut) loggedOut.style.display = 'none';

    updateBalanceUI(auth.balance);

    // Admin link
    if (auth.isAdmin) {
      document.querySelectorAll('[data-admin-only]').forEach(el => el.style.display = '');
    }

    // Premium
    if (auth.isPremium) {
      document.querySelectorAll('[data-premium-lock]').forEach(el => el.classList.remove('locked'));
    }
  }

  // Stream status
  checkStreams();
  setInterval(checkStreams, 120000);

  // Daily reward
  initDailyReward();
});
