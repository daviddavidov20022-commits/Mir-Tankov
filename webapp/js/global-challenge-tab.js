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
let _gcLastDataHash = null;
let _gcIsFirstLoad = true;
let _gcLoadInProgress = false;

// ============================================================
// LOAD CHALLENGE
// ============================================================
async function gcLoadChallenge(forceRefresh) {
    // Предотвращаем параллельные запросы (причина мерцания)
    if (_gcLoadInProgress) return;
    _gcLoadInProgress = true;

    try {
        // Всегда проверяем админ-статус ПЕРВЫМ ДЕЛОМ (до загрузки челленджа)
        if (!isAdmin && myTelegramId) {
            try {
                const meResp = await fetch(`${BOT_API_URL}/api/me?telegram_id=${myTelegramId}`);
                const meData = await meResp.json();
                if (meData.is_admin) {
                    isAdmin = true;
                    const adminTab = document.getElementById('adminTab');
                    if (adminTab) adminTab.style.display = '';
                }
            } catch(e) {}
        }

        // Показываем админ-панель СРАЗУ если админ
        if (isAdmin) {
            const adminPanel = document.getElementById('gcAdminPanel');
            if (adminPanel) adminPanel.style.display = '';
        }

        // Обновляем статистику в фоне (НЕ блокируем загрузку!)
        const refreshController = new AbortController();
        setTimeout(() => refreshController.abort(), 10000); // 10 сек таймаут
        fetch(`${BOT_API_URL}/api/global-challenge/refresh-stats`, { 
            method: 'POST', 
            signal: refreshController.signal 
        }).catch(() => {});

        const resp = await fetch(`${BOT_API_URL}/api/global-challenge/active`);
        const data = await resp.json();

        // Anti-flicker: проверяем изменились ли данные
        const dataHash = JSON.stringify({
            status: data.status,
            id: data.challenge?.id,
            participants: data.challenge?.participants_count,
            leaderboard: data.challenge?.leaderboard?.map(p => `${p.telegram_id}:${p.current_value}:${p.battles_played}`),
        });

        const isFirstLoad = _gcIsFirstLoad;
        _gcIsFirstLoad = false;

        // Скрываем загрузку при первом рендере
        if (isFirstLoad) {
            document.getElementById('gcLoading').style.display = 'none';
        }

        // Если данные НЕ изменились — обновляем только таймер, лидерборд не трогаем
        if (!isFirstLoad && !forceRefresh && _gcLastDataHash === dataHash) {
            // Данные не изменились — ничего не перерисовываем 
        } else {
            _gcLastDataHash = dataHash;

            if (isFirstLoad) {
                document.getElementById('gcLoading').style.display = 'none';
            }

            if (data.status === 'active' && data.challenge) {
                gcShowActive(data.challenge);
            } else if (data.status === 'finished' && data.challenge) {
                gcShowFinished(data.challenge);
            } else {
                gcShowEmpty();
            }
        }

        // Повторно убеждаемся что админ-панель показана
        if (isAdmin) {
            const adminPanel = document.getElementById('gcAdminPanel');
            if (adminPanel) adminPanel.style.display = '';
        }
    } catch (e) {
        console.error('GC load error:', e);
        if (_gcIsFirstLoad) {
            _gcIsFirstLoad = false;
            document.getElementById('gcLoading').style.display = 'none';
            gcShowEmpty();
        }
        // Даже при ошибке — показываем admin panel
        if (isAdmin) {
            const adminPanel = document.getElementById('gcAdminPanel');
            if (adminPanel) adminPanel.style.display = '';
        }
    } finally {
        _gcLoadInProgress = false;
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
    const myId = parseInt(myTelegramId);
    const isParticipant = (ch.leaderboard || []).some(p => parseInt(p.telegram_id) === myId);

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

        // OBS link section
        const obsSection = document.getElementById('gcObsSection');
        if (obsSection) {
            obsSection.style.display = '';
            const obsUrl = document.getElementById('gcObsUrl');
            if (obsUrl) {
                // Строим URL корректно для любой страницы (challenges.html или global-challenge.html)
                const pathParts = window.location.pathname.split('/');
                pathParts[pathParts.length - 1] = 'gc-widget.html';
                const base = window.location.origin + pathParts.join('/');
                const url = myTelegramId ? `${base}?telegram_id=${myTelegramId}` : base;
                obsUrl.textContent = url;
            }
        }
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
        // Скрываем OBS секцию когда челлендж завершён
        const obsSection = document.getElementById('gcObsSection');
        if (obsSection) obsSection.style.display = 'none';
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

        const isMe = parseInt(p.telegram_id) === parseInt(myTelegramId);
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

    // Передаём WoT данные из localStorage чтобы сервер мог обновить БД
    const joinData = {
        telegram_id: myTelegramId,
        challenge_id: gcCurrentChallenge.id,
        wot_nickname: localStorage.getItem('wot_nickname') || '',
        wot_account_id: localStorage.getItem('wot_account_id') || ''
    };

    // Имя из Telegram
    const tg = window.Telegram?.WebApp;
    if (tg?.initDataUnsafe?.user) {
        joinData.first_name = tg.initDataUnsafe.user.first_name || '';
        joinData.username = tg.initDataUnsafe.user.username || '';
    }

    try {
        const resp = await fetch(`${BOT_API_URL}/api/global-challenge/join`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(joinData)
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
                reward_description: `${reward} 🧀`,
                wot_nickname: localStorage.getItem('wot_nickname') || '',
                wot_account_id: localStorage.getItem('wot_account_id') || ''
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

// Auto-refresh данных каждые 15 секунд (без мерцания)
// Работает и на challenges.html (вкладка global) и на standalone global-challenge.html
setInterval(() => {
    const globalTab = document.getElementById('tab-global');
    // Если вкладка global активна ИЛИ мы на standalone странице (нет tab-global)
    const isGlobalTabActive = globalTab ? globalTab.classList.contains('tab-content--active') : true;
    if (isGlobalTabActive && gcCurrentChallenge) {
        gcLoadChallenge(false);
    }
}, 15000);

// Данные обновляются внутри gcLoadChallenge — отдельный refresh убран (был дублирующим)

// Check URL for ?tab=global on load
document.addEventListener('DOMContentLoaded', () => {
    const urlParams = new URLSearchParams(window.location.search);
    if (urlParams.get('tab') === 'global') {
        const globalBtn = document.querySelector('.arena-tab[onclick*="global"]');
        if (globalBtn) {
            switchTab('global', globalBtn);
        }
    }
});

// ============================================================
// WIDGET CONSTRUCTOR
// ============================================================

// Theme definitions
const WC_THEMES = {
    gold: {
        bg: 'rgba(26,21,8,{opacity})',
        accent: '#f5d36e',
        accentDark: '#8B6914',
        timerColor: '#f5d36e',
        timerShadow: '0 1px 0 #8B6914, 0 2px 4px rgba(0,0,0,0.5)',
        titleColor: '#ffeeb0',
        border: '#d4a745',
        meNick: '#f5d36e',
        meVal: '#ffeeb0',
        lbVal: '#d4a745',
        avatarBg: 'linear-gradient(135deg, #d4a745, #8B6914)',
        avatarText: '#1a1408',
    },
    neon: {
        bg: 'rgba(15,5,32,{opacity})',
        accent: '#a855f7',
        accentDark: '#6d28d9',
        timerColor: '#a855f7',
        timerShadow: '0 0 12px rgba(168,85,247,0.5)',
        titleColor: '#d8b4fe',
        border: '#7c3aed',
        meNick: '#c084fc',
        meVal: '#d8b4fe',
        lbVal: '#a855f7',
        avatarBg: 'linear-gradient(135deg, #a855f7, #6d28d9)',
        avatarText: '#1a0530',
    },
    military: {
        bg: 'rgba(15,26,10,{opacity})',
        accent: '#22c55e',
        accentDark: '#14532d',
        timerColor: '#22c55e',
        timerShadow: '0 1px 0 #14532d, 0 2px 4px rgba(0,0,0,0.5)',
        titleColor: '#bbf7d0',
        border: '#16a34a',
        meNick: '#4ade80',
        meVal: '#bbf7d0',
        lbVal: '#22c55e',
        avatarBg: 'linear-gradient(135deg, #22c55e, #14532d)',
        avatarText: '#052e16',
    },
    fire: {
        bg: 'rgba(26,8,0,{opacity})',
        accent: '#ff6b35',
        accentDark: '#b33d00',
        timerColor: '#ff6b35',
        timerShadow: '0 0 12px rgba(255,107,53,0.5), 0 2px 0 #b33d00',
        titleColor: '#ffd4b0',
        border: '#e55a00',
        meNick: '#ff8c5a',
        meVal: '#ffd4b0',
        lbVal: '#ff6b35',
        avatarBg: 'linear-gradient(135deg, #ff6b35, #b33d00)',
        avatarText: '#1a0800',
    },
    ice: {
        bg: 'rgba(4,10,20,{opacity})',
        accent: '#38bdf8',
        accentDark: '#0369a1',
        timerColor: '#38bdf8',
        timerShadow: '0 0 12px rgba(56,189,248,0.5), 0 2px 0 #0369a1',
        titleColor: '#bae6fd',
        border: '#0ea5e9',
        meNick: '#7dd3fc',
        meVal: '#bae6fd',
        lbVal: '#38bdf8',
        avatarBg: 'linear-gradient(135deg, #38bdf8, #0369a1)',
        avatarText: '#040a14',
    }
};

let wcCurrentTheme = 'gold';
let wcCurrentAccent = '#f5d36e';
let wcCurrentBorder = 'gold';
let wcCurrentLayout = 1;

function gcSelectLayout(num) {
    wcCurrentLayout = num;
    for (let i = 1; i <= 5; i++) {
        const el = document.getElementById(`wcLayout-${i}`);
        if (el) el.classList.toggle('wc-theme--active', i === num);
    }
    gcUpdatePreview();
}

function gcToggleWidgetConstructor() {
    const body = document.getElementById('wcBody');
    const arrow = document.getElementById('wcArrow');
    if (body.style.display === 'none') {
        body.style.display = '';
        arrow.classList.add('wc-section__arrow--open');
    } else {
        body.style.display = 'none';
        arrow.classList.remove('wc-section__arrow--open');
    }
}

function gcSelectTheme(theme) {
    wcCurrentTheme = theme;
    // Update theme card states
    document.querySelectorAll('.wc-theme').forEach(el => el.classList.remove('wc-theme--active'));
    const themeEl = document.getElementById(`wcTheme-${theme}`);
    if (themeEl) themeEl.classList.add('wc-theme--active');

    // Set accent from theme
    const t = WC_THEMES[theme];
    wcCurrentAccent = t.accent;

    // Update accent color active state
    document.querySelectorAll('.wc-color').forEach(el => {
        el.classList.toggle('wc-color--active', el.dataset.color === wcCurrentAccent);
    });

    gcUpdatePreview();
}

function gcSetAccent(el) {
    wcCurrentAccent = el.dataset.color;
    document.querySelectorAll('.wc-color').forEach(c => c.classList.remove('wc-color--active'));
    el.classList.add('wc-color--active');
    gcUpdatePreview();
}

function gcSetBorder(el) {
    wcCurrentBorder = el.dataset.border;
    document.querySelectorAll('.wc-toggle').forEach(b => b.classList.remove('wc-toggle--active'));
    el.classList.add('wc-toggle--active');
    gcUpdatePreview();
}

function gcUpdatePreview() {
    const wrap = document.getElementById('wcPreview');
    if (!wrap) return;

    const theme = WC_THEMES[wcCurrentTheme] || WC_THEMES.gold;
    const opacity = (document.getElementById('wcBgOpacity')?.value || 90) / 100;
    const fontScale = (document.getElementById('wcFontSize')?.value || 100) / 100;
    const showTimer = document.getElementById('wcShowTimer')?.checked !== false;
    const showMe = document.getElementById('wcShowMyStats')?.checked !== false;
    const showTop = document.getElementById('wcShowTop3')?.checked !== false;
    const showLive = document.getElementById('wcShowLive')?.checked !== false;

    const bgVal = document.getElementById('wcBgVal');
    if (bgVal) bgVal.textContent = Math.round(opacity * 100) + '%';
    const fontVal = document.getElementById('wcFontVal');
    if (fontVal) fontVal.textContent = Math.round(fontScale * 100) + '%';

    const ac = wcCurrentAccent;
    const bg = theme.bg.replace('{opacity}', opacity.toFixed(2));
    const tc = theme.titleColor;
    const live = showLive ? `<div style="position:absolute;top:4px;right:4px;background:#e00;color:#fff;font-size:.3rem;padding:1px 4px;border-radius:3px;font-weight:900">● LIVE</div>` : '';
    const timerHtml = showTimer ? `<div style="font-family:'Russo One',sans-serif;font-size:1.3rem;color:${theme.timerColor};text-shadow:${theme.timerShadow};line-height:1">52:30</div>` : '';
    const meHtml = showMe ? `<div style="display:flex;align-items:center;gap:4px;padding:4px 6px;border:1px solid ${ac}33;background:${ac}0d">
        <div style="width:16px;height:16px;border-radius:50%;background:${theme.avatarBg};display:flex;align-items:center;justify-content:center;font-size:.25rem;font-weight:900">FA</div>
        <div style="flex:1;font-size:.35rem;font-weight:700;color:${theme.meNick}">Fara777</div>
        <div style="font-family:'Russo One',sans-serif;font-size:.45rem;color:${theme.meVal}">15,230</div></div>` : '';
    const topHtml = showTop ? `<div style="font-size:.25rem">
        <div style="display:flex;gap:3px;padding:2px 4px;background:${ac}10;border-left:2px solid ${ac};margin-bottom:1px"><span style="color:${tc};font-weight:900">1</span><span style="flex:1">TankAce</span><span style="color:${theme.lbVal};font-weight:700">18,500</span></div>
        <div style="display:flex;gap:3px;padding:2px 4px;background:${ac}08;border-left:2px solid #aaa;margin-bottom:1px"><span style="color:#aaa;font-weight:900">2</span><span style="flex:1">Fara777</span><span style="color:${theme.lbVal};font-weight:700">15,230</span></div>
        <div style="display:flex;gap:3px;padding:2px 4px;background:${ac}06;border-left:2px solid #cd7f32"><span style="color:#cd7f32;font-weight:900">3</span><span style="flex:1">Wolf</span><span style="color:${theme.lbVal};font-weight:700">12,100</span></div></div>` : '';

    // Border
    let border = `2px solid ${ac}`;
    let shadow = `0 0 10px ${ac}15`;
    if (wcCurrentBorder === 'glow') { border = `1px solid ${ac}44`; shadow = `0 0 15px ${ac}33`; }
    else if (wcCurrentBorder === 'minimal') { border = `1px solid ${ac}22`; shadow = 'none'; }
    else if (wcCurrentBorder === 'none') { border = 'none'; shadow = 'none'; }

    let html = '';
    const baseStyle = `background:${bg};border:${border};box-shadow:${shadow};border-radius:8px;position:relative;font-size:${(10 * fontScale)}px;overflow:hidden`;

    switch (wcCurrentLayout) {
        case 1: // Classic vertical
            html = `<div style="${baseStyle};width:180px;padding:10px;text-align:center">
                ${live}
                <div style="font-family:'Russo One',sans-serif;font-size:.45rem;color:${tc};margin-bottom:4px">🔥 Челлендж</div>
                ${timerHtml}
                <div style="font-size:.28rem;opacity:.4;margin:3px 0 6px">👥 3 · 🧀 500</div>
                ${meHtml}
                <div style="margin-top:4px">${topHtml}</div>
            </div>`;
            break;

        case 2: // Compact horizontal
            html = `<div style="${baseStyle};width:240px;padding:8px">
                ${live}
                <div style="display:flex;gap:8px;align-items:center;margin-bottom:6px">
                    <div style="text-align:center">${timerHtml}<div style="font-size:.2rem;color:${ac};opacity:.5">ОСТАЛОСЬ</div></div>
                    <div style="flex:1"><div style="font-family:'Russo One',sans-serif;font-size:.4rem;color:${tc};margin-bottom:3px">🔥 Челлендж</div>${meHtml}</div>
                </div>
                <div style="display:flex;gap:2px">${showTop ? `
                    <div style="flex:1;font-size:.25rem;padding:3px 4px;background:${ac}10;border-radius:2px"><span style="color:${tc};font-weight:900">1</span> Ace <span style="color:${theme.lbVal}">18k</span></div>
                    <div style="flex:1;font-size:.25rem;padding:3px 4px;background:${ac}08;border-radius:2px"><span style="color:#aaa;font-weight:900">2</span> Fara <span style="color:${theme.lbVal}">15k</span></div>
                    <div style="flex:1;font-size:.25rem;padding:3px 4px;background:${ac}06;border-radius:2px"><span style="color:#cd7f32;font-weight:900">3</span> Wolf <span style="color:${theme.lbVal}">12k</span></div>
                ` : ''}</div>
            </div>`;
            break;

        case 3: // Strip
            html = `<div style="${baseStyle};width:280px;padding:6px 10px;display:flex;align-items:center;gap:6px;border-radius:5px">
                ${showLive ? `<div style="background:#e00;color:#fff;font-size:.25rem;padding:1px 3px;border-radius:2px;font-weight:900">LIVE</div>` : ''}
                <div style="width:1px;height:14px;background:${ac};opacity:.15"></div>
                <div style="font-family:'Russo One',sans-serif;font-size:.35rem;color:${tc}">🔥 Челлендж</div>
                <div style="width:1px;height:14px;background:${ac};opacity:.15"></div>
                ${showTimer ? `<div style="font-family:'Russo One',sans-serif;font-size:.5rem;color:${theme.timerColor}">52:30</div>` : ''}
                ${showMe ? `<div style="width:1px;height:14px;background:${ac};opacity:.15"></div><div style="font-size:.3rem;color:${ac}">Fara: <span style="color:${tc}">15,230</span></div>` : ''}
            </div>`;
            break;

        case 4: // Scoreboard
            html = `<div style="${baseStyle};width:180px;border-radius:3px">
                ${live}
                <div style="padding:6px;text-align:center;border-bottom:1px solid rgba(255,255,255,.06)">
                    <div style="font-size:.3rem;color:${ac};letter-spacing:1px;opacity:.5">ЧЕЛЛЕНДЖ</div>
                    ${timerHtml}
                </div>
                <div style="padding:2px 4px;font-size:.2rem;opacity:.3;display:flex;border-bottom:1px solid rgba(255,255,255,.04)"><span style="width:14px">#</span><span style="flex:1">Игрок</span><span>Урона</span></div>
                ${showTop ? `
                <div style="padding:3px 4px;font-size:.25rem;display:flex;border-bottom:1px solid rgba(255,255,255,.03)"><span style="width:14px;color:gold;font-weight:900">1</span><span style="flex:1">TankAce</span><span style="color:${theme.lbVal}">18,500</span></div>
                <div style="padding:3px 4px;font-size:.25rem;display:flex;background:${ac}10;border-left:2px solid ${ac};border-bottom:1px solid rgba(255,255,255,.03)"><span style="width:14px;color:silver;font-weight:900">2</span><span style="flex:1">⭐ Fara777</span><span style="color:${theme.lbVal}">15,230</span></div>
                <div style="padding:3px 4px;font-size:.25rem;display:flex"><span style="width:14px;color:#cd7f32;font-weight:900">3</span><span style="flex:1">Wolf</span><span style="color:${theme.lbVal}">12,100</span></div>
                ` : ''}
            </div>`;
            break;

        case 5: // HUD corners
            html = `<div style="width:200px;position:relative">
                ${showLive ? `<div style="position:absolute;top:0;left:50%;transform:translateX(-50%);background:${ac};color:#000;font-size:.25rem;padding:1px 6px;border-radius:0 0 3px 3px;font-weight:900;z-index:5">LIVE</div>` : ''}
                <div style="display:flex;gap:3px;margin-bottom:3px">
                    <div style="${baseStyle};flex:1;padding:6px;text-align:center;border-radius:5px">
                        <div style="font-size:.2rem;color:${ac};letter-spacing:1px;opacity:.5">⏱ ОСТАЛОСЬ</div>
                        ${timerHtml}
                        <div style="font-size:.25rem;color:${ac};margin-top:1px">🔥 Челлендж</div>
                    </div>
                    ${showMe ? `<div style="${baseStyle};flex:1;padding:6px;text-align:center;border-radius:5px">
                        <div style="font-size:.2rem;color:${ac};letter-spacing:1px;opacity:.5">👤 УРОНА</div>
                        <div style="font-size:.3rem;color:${ac};margin:2px 0">Fara777</div>
                        <div style="font-family:'Russo One',sans-serif;font-size:.7rem;color:${tc}">15,230</div>
                    </div>`: ''}
                </div>
                ${showTop ? `<div style="${baseStyle};display:flex;gap:2px;padding:3px;border-radius:4px">
                    <div style="flex:1;font-size:.22rem;padding:3px;background:${ac}10;border-radius:3px"><span style="color:gold;font-weight:900">1</span> Ace <span style="color:${theme.lbVal}">18k</span></div>
                    <div style="flex:1;font-size:.22rem;padding:3px;background:${ac}08;border-radius:3px"><span style="color:silver;font-weight:900">2</span> Fara <span style="color:${theme.lbVal}">15k</span></div>
                    <div style="flex:1;font-size:.22rem;padding:3px;background:${ac}06;border-radius:3px"><span style="color:#cd7f32;font-weight:900">3</span> Wolf <span style="color:${theme.lbVal}">12k</span></div>
                </div>`: ''}
            </div>`;
            break;
    }

    wrap.innerHTML = html;
}

function gcGetWidgetConfig() {
    return {
        layout: wcCurrentLayout,
        theme: wcCurrentTheme,
        accent: wcCurrentAccent,
        border: wcCurrentBorder,
        bgOpacity: parseInt(document.getElementById('wcBgOpacity')?.value || 90),
        fontSize: parseInt(document.getElementById('wcFontSize')?.value || 100),
        showTimer: document.getElementById('wcShowTimer')?.checked !== false,
        showMyStats: document.getElementById('wcShowMyStats')?.checked !== false,
        showTop3: document.getElementById('wcShowTop3')?.checked !== false,
        showLive: document.getElementById('wcShowLive')?.checked !== false,
    };
}

function gcCopyCustomWidgetLink() {
    const config = gcGetWidgetConfig();
    const pathParts = window.location.pathname.split('/');
    pathParts[pathParts.length - 1] = 'gc-widget.html';
    const base = window.location.origin + pathParts.join('/');
    const params = new URLSearchParams();
    if (myTelegramId) params.set('telegram_id', myTelegramId);
    params.set('layout', config.layout);
    params.set('theme', config.theme);
    params.set('accent', config.accent.replace('#', ''));
    params.set('border', config.border);
    params.set('bg', config.bgOpacity);
    params.set('font', config.fontSize);
    if (!config.showTimer) params.set('timer', '0');
    if (!config.showMyStats) params.set('me', '0');
    if (!config.showTop3) params.set('top', '0');
    if (!config.showLive) params.set('live', '0');

    const url = `${base}?${params.toString()}`;
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
