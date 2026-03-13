/**
 * Global Challenge Tab JS — встроенный в challenges.html
 * Все функции имеют префикс gc чтобы не конфликтовать с arena.js
 * 
 * Автоматическое отслеживание статистики через Lesta API
 */

const GC_CONDITION_MAP = {
    damage: { icon: '💥', name: 'Урон', unit: 'урона' },
    frags: { icon: '🎯', name: 'Фраги', unit: 'фрагов' },
    xp: { icon: '⭐', name: 'Опыт', unit: 'опыта' },
    spotting: { icon: '👁', name: 'Засвет', unit: 'засвета' },
    blocked: { icon: '🛡', name: 'Блок', unit: 'блока' },
    wins: { icon: '🏆', name: 'Победы', unit: 'побед' },
};

let gcCurrentChallenge = null;
let gcTimerInterval = null;
let gcAdminCondition = 'damage';
let gcAllSubscribers = [];

// ============================================================
// LOAD CHALLENGE
// ============================================================
async function gcLoadChallenge() {
    try {
        // Сначала обновляем стату через API
        try {
            await fetch(`${BOT_API_URL}/api/global-challenge/refresh-stats`, { method: 'POST' });
        } catch (e) { /* ignore */ }

        const resp = await fetch(`${BOT_API_URL}/api/global-challenge/active`);
        const data = await resp.json();

        document.getElementById('gcLoading').style.display = 'none';

        if (data.status === 'active' && data.challenge) {
            gcShowActive(data.challenge);
        } else if (data.status === 'finished' && data.challenge) {
            gcShowFinished(data.challenge);
        } else {
            gcShowEmpty();
        }

        // Show admin panel if admin
        if (isAdmin) {
            document.getElementById('gcAdminPanel').style.display = '';
        }
    } catch (e) {
        console.error('GC load error:', e);
        document.getElementById('gcLoading').style.display = 'none';
        gcShowEmpty();
    }
}

// ============================================================
// SHOW STATES
// ============================================================
function gcShowEmpty() {
    document.getElementById('gcEmpty').style.display = '';
    document.getElementById('gcActive').style.display = 'none';
    document.getElementById('gcFinished').style.display = 'none';
}

function gcShowActive(ch) {
    gcCurrentChallenge = ch;

    document.getElementById('gcEmpty').style.display = 'none';
    document.getElementById('gcActive').style.display = '';
    document.getElementById('gcFinished').style.display = 'none';

    // Header
    document.getElementById('gcIcon').textContent = ch.icon || '🔥';
    document.getElementById('gcTitle').textContent = ch.title;
    document.getElementById('gcDesc').textContent = ch.description || '';

    const cond = GC_CONDITION_MAP[ch.condition] || GC_CONDITION_MAP.damage;
    document.getElementById('gcCondition').textContent = cond.icon;
    document.getElementById('gcCondLabel').textContent = cond.name;

    // Stats
    document.getElementById('gcParticipants').textContent = ch.participants_count || 0;
    document.getElementById('gcReward').textContent = `🧀 ${ch.reward_coins || 0}`;

    // Timer
    gcStartTimer(ch.ends_at, ch.duration_minutes);

    // Leaderboard
    gcRenderLeaderboard(ch.leaderboard || []);

    // Join button
    const joinBtn = document.getElementById('gcJoinBtn');
    const isParticipant = (ch.leaderboard || []).some(p => p.telegram_id === myTelegramId);

    if (isParticipant) {
        joinBtn.disabled = true;
        joinBtn.textContent = '✅ ВЫ УЧАСТВУЕТЕ — статистика обновляется автоматически';
    } else {
        joinBtn.disabled = false;
        joinBtn.textContent = '⚔️ ВСТУПИТЬ В ЧЕЛЛЕНДЖ';
    }

    // Widget link
    const linkEl = document.getElementById('gcWidgetLink');
    if (linkEl) {
        linkEl.style.display = '';
    }

    // Admin controls
    if (isAdmin) {
        const stopBtn = document.getElementById('adminGcStopBtn');
        const deleteBtn = document.getElementById('adminGcDeleteBtn');
        stopBtn.style.display = '';
        stopBtn.setAttribute('data-id', ch.id);
        if (deleteBtn) {
            deleteBtn.style.display = '';
            deleteBtn.setAttribute('data-id', ch.id);
        }
        document.getElementById('adminGcLaunchBtn').style.display = 'none';
    }
}

function gcShowFinished(ch) {
    gcCurrentChallenge = ch;

    document.getElementById('gcEmpty').style.display = 'none';
    document.getElementById('gcActive').style.display = 'none';
    document.getElementById('gcFinished').style.display = '';

    const cond = GC_CONDITION_MAP[ch.condition] || GC_CONDITION_MAP.damage;

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
                        <div class="gc-lb-battles">${p.battles_played || 0} боёв</div>
                    </div>
                    <div class="gc-lb-value">${(p.current_value || 0).toLocaleString('ru')}</div>
                </div>`;
        });
    }
    document.getElementById('gcFinalLb').innerHTML = html;

    // Widget link hide
    const linkEl = document.getElementById('gcWidgetLink');
    if (linkEl) linkEl.style.display = 'none';

    // Admin: show launch again
    if (isAdmin) {
        document.getElementById('adminGcLaunchBtn').style.display = '';
        document.getElementById('adminGcStopBtn').style.display = 'none';
        const deleteBtn = document.getElementById('adminGcDeleteBtn');
        if (deleteBtn) {
            deleteBtn.style.display = '';
            deleteBtn.setAttribute('data-id', ch.id);
        }
    }

    // Confetti!
    if (ch.winner_nickname) {
        setTimeout(gcLaunchConfetti, 300);
    }
}

// ============================================================
// TIMER
// ============================================================
function gcStartTimer(endsAtStr, durationMinutes) {
    if (gcTimerInterval) clearInterval(gcTimerInterval);

    const endsAt = new Date(endsAtStr);
    const totalSeconds = (durationMinutes || 60) * 60;
    const circumference = 2 * Math.PI * 90;

    const progressEl = document.getElementById('gcTimerProgress');
    const valueEl = document.getElementById('gcTimerValue');
    progressEl.style.strokeDasharray = circumference;

    function tick() {
        const now = new Date();
        const diff = Math.max(0, Math.floor((endsAt - now) / 1000));

        if (diff <= 0) {
            valueEl.textContent = '00:00';
            progressEl.style.strokeDashoffset = circumference;
            clearInterval(gcTimerInterval);
            setTimeout(gcLoadChallenge, 2000);
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

        const elapsed = totalSeconds - diff;
        const fraction = elapsed / totalSeconds;
        progressEl.style.strokeDashoffset = fraction * circumference;

        if (diff < 60) {
            valueEl.classList.add('gc-timer-value--danger');
            progressEl.classList.add('gc-timer-progress--danger');
        } else {
            valueEl.classList.remove('gc-timer-value--danger');
            progressEl.classList.remove('gc-timer-progress--danger');
        }
    }

    tick();
    gcTimerInterval = setInterval(tick, 1000);
}

// ============================================================
// LEADERBOARD
// ============================================================
function gcRenderLeaderboard(leaders) {
    const list = document.getElementById('gcLbList');

    if (!leaders || leaders.length === 0) {
        list.innerHTML = '<div class="gc-lb-empty">Пока нет участников</div>';
        return;
    }

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
// JOIN — вступление + сообщение
// ============================================================
async function gcJoinChallenge() {
    if (!myTelegramId) {
        showToast('⚠️ Откройте через Telegram-бот');
        return;
    }
    if (!gcCurrentChallenge) return;

    const btn = document.getElementById('gcJoinBtn');
    btn.disabled = true;
    btn.textContent = '⏳ Вступаем...';

    try {
        const resp = await fetch(`${BOT_API_URL}/api/global-challenge/join`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                telegram_id: myTelegramId,
                challenge_id: gcCurrentChallenge.id
            })
        });
        const data = await resp.json();

        if (data.success) {
            showToast(data.message || `🎯 Вы вступили! Условия приняты — вперёд!`);
            btn.textContent = '✅ ВЫ УЧАСТВУЕТЕ — статистика обновляется автоматически';
            gcLoadChallenge();
        } else {
            showToast(`❌ ${data.error}`);
            btn.disabled = false;
            btn.textContent = '⚔️ ВСТУПИТЬ В ЧЕЛЛЕНДЖ';
        }
    } catch (e) {
        showToast('❌ Нет подключения');
        btn.disabled = false;
        btn.textContent = '⚔️ ВСТУПИТЬ В ЧЕЛЛЕНДЖ';
    }
}

// ============================================================
// WIDGET LINK — копирование ссылки
// ============================================================
function gcCopyWidgetLink() {
    const base = window.location.origin + window.location.pathname.replace('challenges.html', 'gc-widget.html');
    const url = myTelegramId ? `${base}?telegram_id=${myTelegramId}` : base;
    navigator.clipboard.writeText(url).then(() => {
        showToast('📋 Ссылка на виджет скопирована!');
    }).catch(() => {
        const input = document.createElement('input');
        input.value = url;
        document.body.appendChild(input);
        input.select();
        document.execCommand('copy');
        document.body.removeChild(input);
        showToast('📋 Ссылка на виджет скопирована!');
    });
}

// ============================================================
// ADMIN: SUBSCRIBERS
// ============================================================
async function gcLoadSubscribers() {
    const list = document.getElementById('subsList');
    list.innerHTML = '<div class="gc-subs__loading">⏳ Загрузка подписчиков...</div>';

    try {
        const resp = await fetch(`${BOT_API_URL}/api/admin/users?telegram_id=${myTelegramId}`);
        const data = await resp.json();

        if (!data.users) {
            list.innerHTML = '<div class="gc-subs__loading">❌ Ошибка загрузки</div>';
            return;
        }

        gcAllSubscribers = data.users.filter(u => u.subscription && u.subscription.active);
        document.getElementById('subsCount').textContent = gcAllSubscribers.length;
        gcRenderSubscribers(gcAllSubscribers);
    } catch (e) {
        console.error('Load subscribers error:', e);
        list.innerHTML = '<div class="gc-subs__loading">❌ Нет подключения к API</div>';
    }
}

function gcRenderSubscribers(subs) {
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
        const meta = u.wot_nickname ? `@${u.username || '—'}` : `TG: ${u.telegram_id}`;

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

function gcFilterSubscribers() {
    const query = (document.getElementById('subsSearch').value || '').toLowerCase().trim();
    if (!query) {
        gcRenderSubscribers(gcAllSubscribers);
        return;
    }
    const filtered = gcAllSubscribers.filter(u => {
        const nick = (u.wot_nickname || u.first_name || u.username || '').toLowerCase();
        return nick.includes(query) || String(u.telegram_id).includes(query);
    });
    gcRenderSubscribers(filtered);
}

// ============================================================
// ADMIN: CREATE / STOP / DELETE
// ============================================================
function gcSelectCond(cond, btn) {
    gcAdminCondition = cond;
    document.querySelectorAll('#gcAdminPanel .gc-cond-btn').forEach(b => b.classList.remove('gc-cond-btn--active'));
    btn.classList.add('gc-cond-btn--active');
}

function gcSetDuration(min) {
    document.getElementById('adminGcDuration').value = min;
    document.querySelectorAll('#gcAdminPanel .gc-preset-btn').forEach(b => b.classList.remove('gc-preset-btn--active'));
    event.target.classList.add('gc-preset-btn--active');
}

async function gcLaunchChallenge() {
    if (!myTelegramId) { showToast('⚠️ Нет Telegram ID'); return; }

    const title = document.getElementById('adminGcTitle').value || 'Общий Челлендж';
    const desc = document.getElementById('adminGcDesc').value || '';
    const duration = parseInt(document.getElementById('adminGcDuration').value) || 60;
    const reward = parseInt(document.getElementById('adminGcReward').value) || 500;

    const btn = document.getElementById('adminGcLaunchBtn');
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
                condition: gcAdminCondition,
                duration_minutes: duration,
                reward_coins: reward,
                reward_description: `${reward} 🧀`
            })
        });
        const data = await resp.json();

        if (data.success) {
            showToast('🚀 Челлендж запущен! Вы автоматически вступили.');
            gcLoadChallenge();
        } else {
            showToast(`❌ ${data.error}`);
        }
    } catch (e) {
        showToast('❌ Нет подключения');
    }

    btn.disabled = false;
    btn.textContent = '🚀 ЗАПУСТИТЬ ЧЕЛЛЕНДЖ';
}

async function gcStopChallenge() {
    if (!confirm('Завершить челлендж досрочно? Победитель будет определён по текущим результатам.')) return;

    const btn = document.getElementById('adminGcStopBtn');
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
            showToast('✅ Челлендж завершён!');
            gcLoadChallenge();
        } else {
            showToast(`❌ ${data.error}`);
        }
    } catch (e) {
        showToast('❌ Нет подключения');
    }
}

async function gcDeleteChallenge() {
    if (!confirm('🗑 Удалить челлендж полностью? Все результаты будут утеряны!')) return;

    const deleteBtn = document.getElementById('adminGcDeleteBtn');
    const challengeId = deleteBtn.getAttribute('data-id') ||
        (document.getElementById('adminGcStopBtn').getAttribute('data-id'));

    if (!challengeId) {
        showToast('❌ Не найден ID челленджа');
        return;
    }

    try {
        const resp = await fetch(`${BOT_API_URL}/api/global-challenge/delete`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                admin_telegram_id: myTelegramId,
                challenge_id: parseInt(challengeId)
            })
        });
        const data = await resp.json();

        if (data.success) {
            showToast('🗑 Челлендж удалён');
            gcLoadChallenge();
        } else {
            showToast(`❌ ${data.error}`);
        }
    } catch (e) {
        showToast('❌ Нет подключения');
    }
}

// ============================================================
// CONFETTI 🎊
// ============================================================
function gcLaunchConfetti() {
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
            if (p.y > canvas.height + 20) { p.opacity = 0; return; }
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
// AUTO-REFRESH & URL TAB SWITCHING
// ============================================================

// Auto-refresh stats every 15 seconds when on global tab
setInterval(() => {
    const globalTab = document.getElementById('tab-global');
    if (globalTab && globalTab.classList.contains('tab-content--active')) {
        gcLoadChallenge();
    }
}, 15000);

// Check URL for ?tab=global on load
document.addEventListener('DOMContentLoaded', () => {
    const urlParams = new URLSearchParams(window.location.search);
    if (urlParams.get('tab') === 'global') {
        // Auto-switch to global tab
        const globalBtn = document.querySelector('.arena-tab[onclick*="global"]');
        if (globalBtn) {
            switchTab('global', globalBtn);
        }
    }
});
