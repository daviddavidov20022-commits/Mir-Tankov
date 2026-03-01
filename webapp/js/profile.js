/**
 * Профиль — JS логика
 * Управление никнеймом, реальная статистика через API Lesta Games
 */

// ============================================================
// КОНФИГ API
// ============================================================
const LESTA_API_URL = 'https://api.tanki.su/wot';
const LESTA_APP_ID = 'c984faa7dc529f4cb0139505d5e8043c';

// ============================================================
// ИНИЦИАЛИЗАЦИЯ
// ============================================================
document.addEventListener('DOMContentLoaded', () => {
    loadProfile();
    loadProgress();
    checkAchievements();
});

// ============================================================
// ПРОФИЛЬ
// ============================================================
function loadProfile() {
    // Telegram данные
    const tg = window.Telegram?.WebApp;
    if (tg?.initDataUnsafe?.user) {
        const user = tg.initDataUnsafe.user;
        const nameEl = document.getElementById('profileName');
        if (nameEl) nameEl.textContent = user.first_name || 'Танкист';
    }

    // Загрузить сохранённый ник
    const savedNick = localStorage.getItem('wot_nickname');
    if (savedNick) {
        showSavedNickname(savedNick);
        loadQuickStats(savedNick);
    }

    // Уровень
    updateLevel();
}

// ============================================================
// НИКНЕЙМ
// ============================================================
function saveNickname() {
    const input = document.getElementById('nicknameInput');
    const nickname = input.value.trim();

    if (nickname.length < 2) {
        input.style.borderColor = '#e74c3c';
        input.style.animation = 'shake 0.4s ease';
        setTimeout(() => {
            input.style.borderColor = '';
            input.style.animation = '';
        }, 500);

        if (window.Telegram?.WebApp?.HapticFeedback) {
            window.Telegram.WebApp.HapticFeedback.notificationOccurred('error');
        }
        return;
    }

    localStorage.setItem('wot_nickname', nickname);
    showSavedNickname(nickname);
    loadQuickStats(nickname);
    showToast('✅', `Ник "${nickname}" сохранён!`);

    if (window.Telegram?.WebApp?.HapticFeedback) {
        window.Telegram.WebApp.HapticFeedback.notificationOccurred('success');
    }
}

function showSavedNickname(nickname) {
    const displayEl = document.getElementById('nicknameDisplay');
    const editEl = document.getElementById('nicknameEdit');
    const nameEl = document.getElementById('savedNickname');

    if (displayEl) displayEl.style.display = 'flex';
    if (editEl) editEl.style.display = 'none';
    if (nameEl) nameEl.textContent = nickname;
}

function editNickname() {
    const displayEl = document.getElementById('nicknameDisplay');
    const editEl = document.getElementById('nicknameEdit');
    const input = document.getElementById('nicknameInput');
    const savedNick = localStorage.getItem('wot_nickname') || '';

    if (displayEl) displayEl.style.display = 'none';
    if (editEl) editEl.style.display = 'block';
    if (input) {
        input.value = savedNick;
        setTimeout(() => input.focus(), 100);
    }
}

// Enter key
document.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && document.activeElement?.id === 'nicknameInput') {
        saveNickname();
    }
});

// ============================================================
// БЫСТРАЯ СТАТИСТИКА — РЕАЛЬНЫЙ API
// ============================================================
async function loadQuickStats(nickname) {
    const section = document.getElementById('quickStatsSection');
    if (!section) return;

    // Показываем секцию с индикатором загрузки
    section.style.display = 'block';
    setStatLoading(true);

    try {
        // 1) Поиск игрока
        const searchUrl = `${LESTA_API_URL}/account/list/?application_id=${LESTA_APP_ID}&search=${encodeURIComponent(nickname)}&limit=1`;
        const searchResp = await fetch(searchUrl);
        const searchData = await searchResp.json();

        if (searchData.status !== 'ok' || !searchData.data || searchData.data.length === 0) {
            setStatsError('Игрок не найден');
            return;
        }

        const accountId = searchData.data[0].account_id;
        const realNick = searchData.data[0].nickname;

        // Обновляем ник если отличается
        const savedNameEl = document.getElementById('savedNickname');
        if (savedNameEl && realNick) savedNameEl.textContent = realNick;

        // 2) Получаем статистику
        const statsUrl = `${LESTA_API_URL}/account/info/?application_id=${LESTA_APP_ID}&account_id=${accountId}`;
        const statsResp = await fetch(statsUrl);
        const statsData = await statsResp.json();

        if (statsData.status !== 'ok' || !statsData.data || !statsData.data[accountId]) {
            setStatsError('Ошибка загрузки');
            return;
        }

        const player = statsData.data[accountId];
        const allStats = player.statistics?.all || {};

        // Вычисляем показатели
        const battles = allStats.battles || 0;
        const wins = allStats.wins || 0;
        const damage = allStats.damage_dealt || 0;
        const rating = player.global_rating || 0;

        const winrate = battles > 0 ? ((wins / battles) * 100).toFixed(1) : '0';
        const avgDamage = battles > 0 ? Math.round(damage / battles) : 0;

        // Отображаем реальные данные
        animateValue('qsBattles', battles > 10000 ? (battles / 1000).toFixed(1) + 'K' : battles.toLocaleString());
        animateValue('qsWinrate', winrate + '%');
        animateValue('qsDamage', avgDamage.toLocaleString());
        animateValue('qsRating', rating.toLocaleString());

        // Цвет винрейта
        const wrEl = document.getElementById('qsWinrate');
        if (wrEl) {
            const wr = parseFloat(winrate);
            if (wr >= 55) wrEl.style.color = '#bb86fc';
            else if (wr >= 52) wrEl.style.color = '#64b5f6';
            else if (wr >= 49) wrEl.style.color = '#81c784';
            else if (wr >= 46) wrEl.style.color = '#ffd54f';
            else wrEl.style.color = '#ef5350';
        }

        // Сохраняем данные для оффлайн доступа
        localStorage.setItem('wot_cached_stats', JSON.stringify({
            nickname: realNick,
            accountId,
            battles,
            winrate,
            avgDamage,
            rating,
            clanId: player.clan_id,
            cachedAt: Date.now()
        }));

        setStatLoading(false);

    } catch (err) {
        console.error('Ошибка загрузки статистики:', err);

        // Пробуем кеш
        const cached = localStorage.getItem('wot_cached_stats');
        if (cached) {
            try {
                const data = JSON.parse(cached);
                document.getElementById('qsBattles').textContent =
                    data.battles > 10000 ? (data.battles / 1000).toFixed(1) + 'K' : data.battles.toLocaleString();
                document.getElementById('qsWinrate').textContent = data.winrate + '%';
                document.getElementById('qsDamage').textContent = data.avgDamage.toLocaleString();
                document.getElementById('qsRating').textContent = data.rating.toLocaleString();
                setStatLoading(false);
            } catch (e) {
                setStatsError('Нет сети');
            }
        } else {
            setStatsError('Нет сети');
        }
    }
}

function setStatLoading(isLoading) {
    const items = document.querySelectorAll('.qs-value');
    items.forEach(el => {
        if (isLoading) {
            el.classList.add('loading');
        } else {
            el.classList.remove('loading');
        }
    });
}

function setStatsError(message) {
    setStatLoading(false);
    document.getElementById('qsBattles').textContent = '—';
    document.getElementById('qsWinrate').textContent = '—';
    document.getElementById('qsDamage').textContent = '—';
    document.getElementById('qsRating').textContent = '—';

    showToast('⚠️', message);
}

function animateValue(id, finalValue) {
    const el = document.getElementById(id);
    if (!el) return;

    el.style.opacity = '0';
    el.style.transform = 'translateY(8px)';

    setTimeout(() => {
        el.textContent = finalValue;
        el.style.transition = 'all 0.4s ease';
        el.style.opacity = '1';
        el.style.transform = 'translateY(0)';
    }, 100);
}

function viewMyStats() {
    const nickname = localStorage.getItem('wot_nickname');
    if (nickname) {
        window.location.href = 'stats.html?nick=' + encodeURIComponent(nickname);
    } else {
        window.location.href = 'stats.html';
    }
}

// ============================================================
// ПРОГРЕСС
// ============================================================
function loadProgress() {
    try {
        const data = JSON.parse(localStorage.getItem('wot_user_data') || '{}');

        const coins = data.coins || 0;
        const xp = data.xp || 0;
        const games = data.games || 0;
        const wins = data.wins || 0;
        const streak = data.dailyStreak || 0;

        setText('progCoins', coins.toLocaleString());
        setText('progXP', xp.toLocaleString());
        setText('progGames', games.toLocaleString());
        setText('progWins', wins.toLocaleString());
        setText('progStreak', streak + ' дн.');

        // XP Level
        const level = Math.floor(xp / 100) + 1;
        const xpInLevel = xp % 100;

        setText('xpProgress', `${xpInLevel} / 100 XP`);
        setText('xpLevel', `Уровень ${level}`);

        // Аватар уровень
        const avatarLevel = document.getElementById('avatarLevel');
        if (avatarLevel) avatarLevel.textContent = level;

        // Progress bar
        setTimeout(() => {
            const bar = document.getElementById('xpBar');
            if (bar) bar.style.width = xpInLevel + '%';
        }, 300);

        // Tag
        updateTag(level);
    } catch (e) {
        console.warn('Ошибка загрузки прогресса:', e);
    }
}

function updateLevel() {
    try {
        const data = JSON.parse(localStorage.getItem('wot_user_data') || '{}');
        const xp = data.xp || 0;
        const level = Math.floor(xp / 100) + 1;
        updateTag(level);
    } catch (e) { }
}

function updateTag(level) {
    const tagEl = document.getElementById('profileTag');
    if (!tagEl) return;

    if (level >= 10) { tagEl.textContent = '👑 Легенда'; tagEl.style.borderColor = 'rgba(155,89,182,0.5)'; tagEl.style.color = '#bb86fc'; }
    else if (level >= 7) { tagEl.textContent = '⭐ Ветеран'; tagEl.style.borderColor = 'rgba(52,152,219,0.5)'; tagEl.style.color = '#64b5f6'; }
    else if (level >= 4) { tagEl.textContent = '🪖 Боец'; tagEl.style.borderColor = 'rgba(46,204,113,0.5)'; tagEl.style.color = '#81c784'; }
    else { tagEl.textContent = '🔰 Новобранец'; }
}

// ============================================================
// ДОСТИЖЕНИЯ
// ============================================================
function checkAchievements() {
    try {
        const data = JSON.parse(localStorage.getItem('wot_user_data') || '{}');
        const coins = data.coins || 0;
        const games = data.games || 0;
        const streak = data.dailyStreak || 0;
        const xp = data.xp || 0;
        const level = Math.floor(xp / 100) + 1;

        if (games >= 1) unlockAchievement('achFirst');
        else lockAchievement('achFirst');

        if (games >= 50) unlockAchievement('achVeteran');
        else lockAchievement('achVeteran');

        if (coins >= 5000) unlockAchievement('achRich');
        else lockAchievement('achRich');

        if (streak >= 7) unlockAchievement('achStreak');
        else lockAchievement('achStreak');

        if (level >= 10) {
            const el = document.getElementById('achPro');
            if (el) { el.classList.remove('achievement--locked'); el.classList.add('achievement--unlocked'); }
        }
    } catch (e) { }
}

function unlockAchievement(id) {
    const el = document.getElementById(id);
    if (el) {
        el.classList.remove('achievement--locked');
        el.classList.add('achievement--unlocked');
    }
}
function lockAchievement(id) {
    const el = document.getElementById(id);
    if (el && !el.classList.contains('achievement--locked')) {
        // Не блокировать если уже разблокировано
    }
}

// ============================================================
// HELPERS
// ============================================================
function setText(id, text) {
    const el = document.getElementById(id);
    if (el) el.textContent = text;
}

function goBack() {
    if (window.Telegram?.WebApp?.BackButton) {
        window.Telegram.WebApp.BackButton.hide();
    }
    window.location.href = 'index.html';
}

// Toast (если не определена в app.js)
if (typeof showToast !== 'function') {
    window.showToast = function (icon, text) {
        const existing = document.querySelector('.toast');
        if (existing) existing.remove();

        const toast = document.createElement('div');
        toast.className = 'toast';
        toast.innerHTML = `<span>${icon}</span> ${text}`;
        toast.style.cssText = `
            position: fixed; bottom: 80px; left: 50%; transform: translateX(-50%);
            background: rgba(30,30,30,0.95); color: #fff; padding: 12px 24px;
            border-radius: 12px; font-size: 14px; z-index: 9999;
            backdrop-filter: blur(10px); border: 1px solid rgba(255,255,255,0.1);
            animation: fadeInUp 0.3s ease;
        `;
        document.body.appendChild(toast);
        setTimeout(() => toast.remove(), 3000);
    };
}

// Telegram back button
if (window.Telegram?.WebApp?.BackButton) {
    window.Telegram.WebApp.BackButton.show();
    window.Telegram.WebApp.BackButton.onClick(goBack);
}

// Expose
window.saveNickname = saveNickname;
window.editNickname = editNickname;
window.viewMyStats = viewMyStats;
window.goBack = goBack;
