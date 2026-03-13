/**
 * Global Challenge JS — Общий Челлендж
 * Мир Танков Webapp
 * 
 * Таймер обратного отсчёта, динамический лидерборд,
 * админ-панель создания, отправка результатов
 */

// ============================================================
// CONFIG
// ============================================================
const BOT_API_URL = localStorage.getItem('bot_api_url') || 'http://localhost:8081';
const CONDITION_MAP = {
    damage: { icon: '💥', name: 'Урон', unit: 'урона' },
    frags: { icon: '🎯', name: 'Фраги', unit: 'фрагов' },
    xp: { icon: '⭐', name: 'Опыт', unit: 'опыта' },
    spotting: { icon: '👁', name: 'Засвет', unit: 'засвета' },
    blocked: { icon: '🛡', name: 'Блок', unit: 'блока' },
    wins: { icon: '🏆', name: 'Победы', unit: 'побед' },
};

let myTelegramId = 0;
let isAdmin = false;
let currentChallenge = null;
let timerInterval = null;
let refreshInterval = null;
let adminCondition = 'damage';

// ============================================================
// INIT
// ============================================================
document.addEventListener('DOMContentLoaded', () => {
    identifyMe();
    loadChallenge();
    createParticles();

    // Refresh every 10 seconds
    refreshInterval = setInterval(loadChallenge, 10000);
});

function identifyMe() {
    const urlParams = new URLSearchParams(window.location.search);
    const urlId = urlParams.get('telegram_id');
    if (urlId) {
        myTelegramId = parseInt(urlId);
        return;
    }

    const tg = window.Telegram?.WebApp;
    if (tg?.initDataUnsafe?.user) {
        myTelegramId = tg.initDataUnsafe.user.id;
        localStorage.setItem('my_telegram_id', String(myTelegramId));
        return;
    }

    const saved = localStorage.getItem('my_telegram_id');
    if (saved) myTelegramId = parseInt(saved);
}

// ============================================================
// LOAD CHALLENGE
// ============================================================
async function loadChallenge() {
    try {
        const resp = await fetch(`${BOT_API_URL}/api/global-challenge/active`);
        const data = await resp.json();

        document.getElementById('gcLoading').style.display = 'none';

        if (data.status === 'active' && data.challenge) {
            showActiveChallenge(data.challenge);
        } else if (data.status === 'finished' && data.challenge) {
            showFinishedChallenge(data.challenge);
        } else {
            showEmpty();
        }

        // Check admin
        checkAdmin();
    } catch (e) {
        console.error('Load challenge error:', e);
        document.getElementById('gcLoading').style.display = 'none';
        showEmpty();
        checkAdmin();
    }
}

async function checkAdmin() {
    if (!myTelegramId) return;
    try {
        const resp = await fetch(`${BOT_API_URL}/api/me?telegram_id=${myTelegramId}`);
        const data = await resp.json();
        if (data.is_admin) {
            isAdmin = true;
            document.getElementById('gcAdmin').style.display = '';
            loadSubscribers();
        }
    } catch (e) { }
}

// ============================================================
// SUBSCRIBERS LIST (ADMIN)
// ============================================================
let allSubscribers = [];

async function loadSubscribers() {
    const list = document.getElementById('subsList');
    list.innerHTML = '<div class="gc-subs__loading">⏳ Загрузка подписчиков...</div>';

    try {
        const resp = await fetch(`${BOT_API_URL}/api/admin/users?telegram_id=${myTelegramId}`);
        const data = await resp.json();

        if (!data.users) {
            list.innerHTML = '<div class="gc-subs__loading">❌ Ошибка загрузки</div>';
            return;
        }

        // Filter only users with subscription
        allSubscribers = data.users.filter(u => u.subscription && u.subscription.active);

        document.getElementById('subsCount').textContent = allSubscribers.length;
        renderSubscribers(allSubscribers);
    } catch (e) {
        console.error('Load subscribers error:', e);
        list.innerHTML = '<div class="gc-subs__loading">❌ Нет подключения к API</div>';
    }
}

function renderSubscribers(subs) {
    const list = document.getElementById('subsList');

    if (!subs || subs.length === 0) {
        list.innerHTML = '<div class="gc-subs__loading">Нет подписчиков</div>';
        return;
    }

    list.innerHTML = subs.map((u, i) => {
        const nick = u.wot_nickname || u.first_name || u.username || 'Танкист';
        const initials = nick.substring(0, 2).toUpperCase();
        const sub = u.subscription;
        const daysLeft = sub ? sub.days_remaining : 0;
        const isActive = sub && sub.active;
        const badgeCls = isActive ? 'gc-sub-card__badge--active' : 'gc-sub-card__badge--expired';
        const badgeText = isActive ? `${daysLeft} дн.` : 'Истёк';
        const meta = u.wot_nickname ? `@${u.username || '—'} • TG: ${u.telegram_id}` : `TG: ${u.telegram_id}`;

        return `
            <div class="gc-sub-card" style="animation-delay:${i * 0.03}s">
                <div class="gc-sub-card__avatar">${initials}</div>
                <div class="gc-sub-card__info">
                    <div class="gc-sub-card__nick">${nick}</div>
                    <div class="gc-sub-card__meta">${meta}</div>
                </div>
                <div class="gc-sub-card__badge ${badgeCls}">${badgeText}</div>
            </div>`;
    }).join('');
}

function filterSubscribers() {
    const query = (document.getElementById('subsSearch').value || '').toLowerCase().trim();
    if (!query) {
        renderSubscribers(allSubscribers);
        return;
    }
    const filtered = allSubscribers.filter(u => {
        const nick = (u.wot_nickname || u.first_name || u.username || '').toLowerCase();
        const tgId = String(u.telegram_id);
        return nick.includes(query) || tgId.includes(query);
    });
    renderSubscribers(filtered);
}

// ============================================================
// SHOW STATES
// ============================================================
function showEmpty() {
    document.getElementById('gcEmpty').style.display = '';
    document.getElementById('gcActive').style.display = 'none';
    document.getElementById('gcFinished').style.display = 'none';
}

function showActiveChallenge(ch) {
    currentChallenge = ch;

    document.getElementById('gcEmpty').style.display = 'none';
    document.getElementById('gcActive').style.display = '';
    document.getElementById('gcFinished').style.display = 'none';

    // Header
    document.getElementById('gcIcon').textContent = ch.icon || '🔥';
    document.getElementById('gcTitle').textContent = ch.title;
    document.getElementById('gcDesc').textContent = ch.description || '';

    const cond = CONDITION_MAP[ch.condition] || CONDITION_MAP.damage;
    document.getElementById('gcCondition').textContent = cond.icon;
    document.getElementById('gcCondLabel').textContent = cond.name;

    // Stats
    document.getElementById('gcParticipants').textContent = ch.participants_count || 0;
    document.getElementById('gcReward').textContent = `🧀 ${ch.reward_coins || 0}`;

    // Timer
    startTimer(ch.ends_at, ch.duration_minutes);

    // Leaderboard
    renderLeaderboard(ch.leaderboard || []);

    // Join button state
    const joinBtn = document.getElementById('gcJoinBtn');
    const submitArea = document.getElementById('gcSubmit');
    const isParticipant = (ch.leaderboard || []).some(p => p.telegram_id === myTelegramId);

    if (isParticipant) {
        joinBtn.disabled = true;
        joinBtn.textContent = '✅ ВЫ УЧАСТВУЕТЕ';
        submitArea.style.display = '';
    } else {
        joinBtn.disabled = false;
        joinBtn.textContent = '⚔️ ВСТУПИТЬ В ЧЕЛЛЕНДЖ';
        submitArea.style.display = 'none';
    }

    // Admin control
    const stopBtn = document.getElementById('adminStopBtn');
    const launchBtn = document.getElementById('adminLaunchBtn');
    if (isAdmin) {
        stopBtn.style.display = '';
        stopBtn.setAttribute('data-id', ch.id);
        launchBtn.style.display = 'none';
    }
}

function showFinishedChallenge(ch) {
    currentChallenge = ch;

    document.getElementById('gcEmpty').style.display = 'none';
    document.getElementById('gcActive').style.display = 'none';
    document.getElementById('gcFinished').style.display = '';

    const cond = CONDITION_MAP[ch.condition] || CONDITION_MAP.damage;

    document.getElementById('gcWinnerName').textContent = ch.winner_nickname || 'Нет участников';
    document.getElementById('gcWinnerValue').textContent = (ch.winner_value || 0).toLocaleString('ru');
    document.getElementById('gcWinnerLabel').textContent = cond.unit;

    // Final leaderboard
    const lb = ch.leaderboard || [];
    let html = '';
    if (lb.length > 0) {
        html += '<div class="gc-lb-title" style="margin-top:8px">📊 Итоговая таблица</div>';
        lb.forEach((p, i) => {
            const medals = ['🥇', '🥈', '🥉'];
            const medal = medals[i] || `${i + 1}`;
            const cls = i === 0 ? 'gc-lb-item--1st' : i === 1 ? 'gc-lb-item--2nd' : i === 2 ? 'gc-lb-item--3rd' : 'gc-lb-item--other';
            html += `
                <div class="gc-lb-item ${cls}">
                    <div class="gc-lb-rank gc-lb-rank--${i < 3 ? ['1st', '2nd', '3rd'][i] : 'other'}">${medal}</div>
                    <div class="gc-lb-info">
                        <div class="gc-lb-name">${p.nickname}</div>
                    </div>
                    <div class="gc-lb-value">${(p.current_value || 0).toLocaleString('ru')}</div>
                </div>`;
        });
    }
    document.getElementById('gcFinalLb').innerHTML = html;

    // Admin: show launch again
    if (isAdmin) {
        document.getElementById('adminLaunchBtn').style.display = '';
        document.getElementById('adminStopBtn').style.display = 'none';
    }

    // Confetti!
    if (ch.winner_nickname) {
        setTimeout(launchConfetti, 300);
    }
}

// ============================================================
// TIMER
// ============================================================
function startTimer(endsAtStr, durationMinutes) {
    if (timerInterval) clearInterval(timerInterval);

    const endsAt = new Date(endsAtStr);
    const totalSeconds = (durationMinutes || 60) * 60;
    const circumference = 2 * Math.PI * 90; // SVG circle r=90

    const progressEl = document.getElementById('gcTimerProgress');
    const valueEl = document.getElementById('gcTimerValue');
    progressEl.style.strokeDasharray = circumference;

    function tick() {
        const now = new Date();
        const diff = Math.max(0, Math.floor((endsAt - now) / 1000));

        if (diff <= 0) {
            valueEl.textContent = '00:00';
            progressEl.style.strokeDashoffset = circumference;
            clearInterval(timerInterval);
            // Reload after 2 sec to show results
            setTimeout(loadChallenge, 2000);
            return;
        }

        const hours = Math.floor(diff / 3600);
        const minutes = Math.floor((diff % 3600) / 60);
        const seconds = diff % 60;

        if (hours > 0) {
            valueEl.textContent = `${hours}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
        } else {
            valueEl.textContent = `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
        }

        // Progress ring
        const elapsed = totalSeconds - diff;
        const fraction = elapsed / totalSeconds;
        progressEl.style.strokeDashoffset = fraction * circumference;

        // Danger mode < 60 seconds
        if (diff < 60) {
            valueEl.classList.add('gc-timer-value--danger');
            progressEl.classList.add('gc-timer-progress--danger');
        } else {
            valueEl.classList.remove('gc-timer-value--danger');
            progressEl.classList.remove('gc-timer-progress--danger');
        }
    }

    tick();
    timerInterval = setInterval(tick, 1000);
}

// ============================================================
// LEADERBOARD
// ============================================================
function renderLeaderboard(leaders) {
    const list = document.getElementById('gcLbList');

    if (!leaders || leaders.length === 0) {
        list.innerHTML = '<div class="gc-lb-empty">Пока нет участников</div>';
        return;
    }

    const cond = CONDITION_MAP[currentChallenge?.condition] || CONDITION_MAP.damage;
    const medals = ['🥇', '🥈', '🥉'];

    list.innerHTML = leaders.map((p, i) => {
        const medal = medals[i] || `${i + 1}`;
        let cls;
        if (i === 0) cls = 'gc-lb-item--1st';
        else if (i === 1) cls = 'gc-lb-item--2nd';
        else if (i === 2) cls = 'gc-lb-item--3rd';
        else cls = 'gc-lb-item--other';

        const isMe = p.telegram_id === myTelegramId;
        if (isMe) cls += ' gc-lb-item--me';

        const rankCls = i < 3 ? ['gc-lb-rank--1st', 'gc-lb-rank--2nd', 'gc-lb-rank--3rd'][i] : 'gc-lb-rank--other';

        return `
            <div class="gc-lb-item ${cls}" style="animation-delay:${i * 0.06}s">
                <div class="gc-lb-rank ${rankCls}">${medal}</div>
                <div class="gc-lb-info">
                    <div class="gc-lb-name">${isMe ? '⭐ ' : ''}${p.nickname || 'Танкист'}</div>
                    <div class="gc-lb-battles">${p.battles_played || 0} боёв</div>
                </div>
                <div class="gc-lb-value">${(p.current_value || 0).toLocaleString('ru')}</div>
            </div>`;
    }).join('');
}

// ============================================================
// JOIN
// ============================================================
async function joinChallenge() {
    if (!myTelegramId) {
        showToast('⚠️ Откройте через Telegram-бот', 'error');
        return;
    }
    if (!currentChallenge) return;

    const btn = document.getElementById('gcJoinBtn');
    btn.disabled = true;
    btn.textContent = '⏳ Вступаем...';

    try {
        const resp = await fetch(`${BOT_API_URL}/api/global-challenge/join`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                telegram_id: myTelegramId,
                challenge_id: currentChallenge.id
            })
        });
        const data = await resp.json();

        if (data.success) {
            showToast(`⚔️ Вы вступили как ${data.nickname}!`, 'success');
            btn.textContent = '✅ ВЫ УЧАСТВУЕТЕ';
            btn.style.background = 'linear-gradient(135deg, #22c55e, #16a34a)';
            document.getElementById('gcSubmit').style.display = '';

            const tg = window.Telegram?.WebApp;
            if (tg?.HapticFeedback) tg.HapticFeedback.notificationOccurred('success');

            loadChallenge();
        } else {
            showToast(`❌ ${data.error}`, 'error');
            btn.disabled = false;
            btn.textContent = '⚔️ ВСТУПИТЬ В ЧЕЛЛЕНДЖ';
        }
    } catch (e) {
        showToast('❌ Нет подключения', 'error');
        btn.disabled = false;
        btn.textContent = '⚔️ ВСТУПИТЬ В ЧЕЛЛЕНДЖ';
    }
}

// ============================================================
// SUBMIT RESULT
// ============================================================
async function submitResult() {
    if (!myTelegramId || !currentChallenge) return;

    const input = document.getElementById('gcSubmitValue');
    const value = parseInt(input.value);
    if (!value || value <= 0) {
        showToast('❌ Введите результат', 'error');
        return;
    }

    try {
        const resp = await fetch(`${BOT_API_URL}/api/global-challenge/submit`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                telegram_id: myTelegramId,
                challenge_id: currentChallenge.id,
                value: value
            })
        });
        const data = await resp.json();

        if (data.success) {
            showToast(`✅ Результат обновлён: ${data.current_value}`, 'success');
            input.value = '';
            loadChallenge();
        } else {
            showToast(`❌ ${data.error}`, 'error');
        }
    } catch (e) {
        showToast('❌ Нет подключения', 'error');
    }
}

// ============================================================
// ADMIN: CREATE CHALLENGE
// ============================================================
function selectAdminCond(cond, btn) {
    adminCondition = cond;
    document.querySelectorAll('.gc-cond-btn').forEach(b => b.classList.remove('gc-cond-btn--active'));
    btn.classList.add('gc-cond-btn--active');
}

function setDuration(min) {
    document.getElementById('adminDuration').value = min;
    document.querySelectorAll('.gc-preset-btn').forEach(b => b.classList.remove('gc-preset-btn--active'));
    event.target.classList.add('gc-preset-btn--active');
}

async function launchChallenge() {
    if (!myTelegramId) {
        showToast('⚠️ Нет Telegram ID', 'error');
        return;
    }

    const title = document.getElementById('adminTitle').value || 'Общий Челлендж';
    const desc = document.getElementById('adminDesc').value || '';
    const duration = parseInt(document.getElementById('adminDuration').value) || 60;
    const reward = parseInt(document.getElementById('adminReward').value) || 500;

    const btn = document.getElementById('adminLaunchBtn');
    btn.disabled = true;
    btn.textContent = '⏳ Запускаем...';

    try {
        const resp = await fetch(`${BOT_API_URL}/api/global-challenge/create`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                admin_telegram_id: myTelegramId,
                title,
                description: desc,
                icon: '🔥',
                condition: adminCondition,
                duration_minutes: duration,
                reward_coins: reward,
                reward_description: `${reward} 🧀`
            })
        });
        const data = await resp.json();

        if (data.success) {
            showToast('🚀 Челлендж запущен!', 'success');
            loadChallenge();
        } else {
            showToast(`❌ ${data.error}`, 'error');
        }
    } catch (e) {
        showToast('❌ Нет подключения', 'error');
    }

    btn.disabled = false;
    btn.textContent = '🚀 ЗАПУСТИТЬ ЧЕЛЛЕНДЖ';
}

async function stopChallenge() {
    if (!confirm('Завершить челлендж досрочно? Победитель будет определён по текущим результатам.')) return;

    const btn = document.getElementById('adminStopBtn');
    const challengeId = btn.getAttribute('data-id');

    try {
        const resp = await fetch(`${BOT_API_URL}/api/global-challenge/finish`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                admin_telegram_id: myTelegramId,
                challenge_id: parseInt(challengeId)
            })
        });
        const data = await resp.json();

        if (data.success) {
            showToast('✅ Челлендж завершён!', 'success');
            loadChallenge();
        } else {
            showToast(`❌ ${data.error}`, 'error');
        }
    } catch (e) {
        showToast('❌ Нет подключения', 'error');
    }
}

// ============================================================
// CONFETTI 🎊
// ============================================================
function launchConfetti() {
    const canvas = document.getElementById('confettiCanvas');
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    canvas.width = window.innerWidth;
    canvas.height = window.innerHeight;

    const particles = [];
    const colors = ['#f5be0b', '#C8AA6E', '#ef4444', '#22c55e', '#3b82f6', '#f59e0b', '#a855f7'];

    for (let i = 0; i < 120; i++) {
        particles.push({
            x: Math.random() * canvas.width,
            y: -20 - Math.random() * 100,
            w: 4 + Math.random() * 6,
            h: 8 + Math.random() * 8,
            vx: (Math.random() - 0.5) * 4,
            vy: 2 + Math.random() * 4,
            color: colors[Math.floor(Math.random() * colors.length)],
            rot: Math.random() * 360,
            rotSpeed: (Math.random() - 0.5) * 8,
            opacity: 1,
        });
    }

    let frame = 0;
    function animate() {
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        let alive = 0;

        particles.forEach(p => {
            if (p.opacity <= 0) return;
            alive++;

            p.x += p.vx;
            p.y += p.vy;
            p.vy += 0.05;
            p.rot += p.rotSpeed;

            if (p.y > canvas.height + 20) {
                p.opacity = 0;
                return;
            }

            if (frame > 80) p.opacity -= 0.015;

            ctx.save();
            ctx.globalAlpha = Math.max(0, p.opacity);
            ctx.translate(p.x, p.y);
            ctx.rotate((p.rot * Math.PI) / 180);
            ctx.fillStyle = p.color;
            ctx.fillRect(-p.w / 2, -p.h / 2, p.w, p.h);
            ctx.restore();
        });

        frame++;
        if (alive > 0 && frame < 200) {
            requestAnimationFrame(animate);
        } else {
            ctx.clearRect(0, 0, canvas.width, canvas.height);
        }
    }

    animate();
}

// ============================================================
// TOAST & PARTICLES
// ============================================================
function showToast(message, type = 'info') {
    const existing = document.querySelector('.gc-toast');
    if (existing) existing.remove();

    const colors = {
        info: 'rgba(200,170,110,0.9)',
        success: 'rgba(34,197,94,0.9)',
        error: 'rgba(239,68,68,0.9)',
    };

    const toast = document.createElement('div');
    toast.className = 'gc-toast';
    toast.textContent = message;
    toast.style.background = colors[type] || colors.info;
    document.body.appendChild(toast);
    setTimeout(() => toast.remove(), 3000);
}

function createParticles() {
    const container = document.getElementById('bgParticles');
    if (!container) return;
    for (let i = 0; i < 15; i++) {
        const p = document.createElement('div');
        p.className = 'bg-particle';
        p.style.left = Math.random() * 100 + '%';
        p.style.animationDuration = (8 + Math.random() * 12) + 's';
        p.style.animationDelay = Math.random() * 10 + 's';
        p.style.width = p.style.height = (1 + Math.random() * 2) + 'px';
        container.appendChild(p);
    }
}
