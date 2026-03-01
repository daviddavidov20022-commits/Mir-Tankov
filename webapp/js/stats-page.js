/**
 * Статистика Мир Танков — JS логика
 * Поиск и отображение реальной статистики через API Lesta Games
 */

// ============================================================
// НАСТРОЙКА API
// ============================================================
const LESTA_APP_ID = "c984faa7dc529f4cb0139505d5e8043c";
const LESTA_API_URL = "https://api.tanki.su/wot";
const USE_REAL_API = Boolean(LESTA_APP_ID);

// ============================================================
// СОСТОЯНИЕ
// ============================================================
let recentSearches = JSON.parse(localStorage.getItem('wot_recent_searches') || '[]');

// ============================================================
// ИНИЦИАЛИЗАЦИЯ
// ============================================================
document.addEventListener('DOMContentLoaded', () => {
    renderRecentSearches();

    // Enter key для поиска
    const input = document.getElementById('nicknameInput');
    if (input) {
        input.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') searchPlayer();
        });
    }

    // Показать/скрыть предупреждение
    if (USE_REAL_API) {
        const notice = document.getElementById('demoNotice');
        if (notice) notice.style.display = 'none';
    }

    // Авто-поиск из URL (?nick=xxx) — приходим из профиля
    const urlParams = new URLSearchParams(window.location.search);
    const nickFromUrl = urlParams.get('nick');
    if (nickFromUrl && input) {
        input.value = nickFromUrl;
        setTimeout(() => searchPlayer(), 200);
    } else if (input) {
        setTimeout(() => input.focus(), 300);
    }

    // Инъекция shake-анимации
    if (!document.getElementById('shakeStyle')) {
        const style = document.createElement('style');
        style.id = 'shakeStyle';
        style.textContent = `
            @keyframes shake {
                0%, 100% { transform: translateX(0); }
                20% { transform: translateX(-8px); }
                40% { transform: translateX(8px); }
                60% { transform: translateX(-4px); }
                80% { transform: translateX(4px); }
            }
        `;
        document.head.appendChild(style);
    }
});

// ============================================================
// ПОИСК ИГРОКА
// ============================================================
async function searchPlayer() {
    const input = document.getElementById('nicknameInput');
    const nickname = input.value.trim();

    if (nickname.length < 2) {
        shakeInput();
        return;
    }

    // Показать загрузку
    document.getElementById('searchSection').style.display = 'none';
    document.getElementById('loadingSection').style.display = 'block';
    document.getElementById('playerSection').style.display = 'none';

    // Haptic
    if (window.Telegram?.WebApp?.HapticFeedback) {
        window.Telegram.WebApp.HapticFeedback.impactOccurred('light');
    }

    try {
        let playerData;

        if (USE_REAL_API) {
            playerData = await fetchRealStats(nickname);
        } else {
            // Имитация задержки
            await new Promise(r => setTimeout(r, 800));
            playerData = getMockStats(nickname);
        }

        if (playerData) {
            addToRecent(playerData.nickname);
            displayStats(playerData);
        } else {
            showSearch();
            showToast('❌', 'Игрок не найден');
        }
    } catch (e) {
        console.error('Ошибка поиска:', e);
        showSearch();
        showToast('❌', 'Ошибка загрузки');
    }
}

// ============================================================
// РЕАЛЬНЫЙ API
// ============================================================
async function fetchRealStats(nickname) {
    // Шаг 1: Поиск по нику
    const searchUrl = `${LESTA_API_URL}/account/list/?application_id=${LESTA_APP_ID}&search=${encodeURIComponent(nickname)}&limit=1`;
    const searchResp = await fetch(searchUrl);
    const searchData = await searchResp.json();

    if (searchData.status !== 'ok' || !searchData.data || searchData.data.length === 0) {
        return null;
    }

    const accountId = searchData.data[0].account_id;

    // Шаг 2: Получаем статистику
    const infoUrl = `${LESTA_API_URL}/account/info/?application_id=${LESTA_APP_ID}&account_id=${accountId}`;
    const infoResp = await fetch(infoUrl);
    const infoData = await infoResp.json();

    if (infoData.status !== 'ok' || !infoData.data) {
        return null;
    }

    return infoData.data[String(accountId)];
}

// ============================================================
// МОКОВЫЕ ДАННЫЕ
// ============================================================
function getMockStats(nickname) {
    const search = nickname.toLowerCase().replace(/\s/g, '_');

    // Ищем в моках
    for (const [key, data] of Object.entries(MOCK_PLAYERS)) {
        if (key.includes(search) || data.nickname.toLowerCase().includes(search)) {
            return data;
        }
    }

    // Генерируем случайного
    const battles = 1000 + Math.floor(Math.random() * 40000);
    const winrate = 0.44 + Math.random() * 0.16;
    const wins = Math.floor(battles * winrate);

    return {
        account_id: Math.floor(Math.random() * 99999999),
        nickname: nickname,
        global_rating: 2000 + Math.floor(Math.random() * 10000),
        created_at: 1388534400 + Math.floor(Math.random() * 200000000),
        last_battle_time: Date.now() / 1000 - Math.floor(Math.random() * 86400 * 30),
        statistics: {
            all: {
                battles, wins,
                losses: battles - wins - Math.floor(battles * 0.02),
                draws: Math.floor(battles * 0.02),
                survived_battles: Math.floor(battles * (0.2 + Math.random() * 0.2)),
                damage_dealt: Math.floor(battles * (800 + Math.random() * 1500)),
                frags: Math.floor(battles * (0.6 + Math.random() * 0.7)),
                spotted: Math.floor(battles * (0.8 + Math.random() * 0.8)),
                hits_percents: 50 + Math.floor(Math.random() * 35),
                capture_points: Math.floor(battles * (0.2 + Math.random() * 0.5)),
                dropped_capture_points: Math.floor(battles * (0.15 + Math.random() * 0.3)),
                xp: Math.floor(battles * (400 + Math.random() * 600)),
                battle_avg_xp: 350 + Math.floor(Math.random() * 650),
                max_xp: 1200 + Math.floor(Math.random() * 2500),
                max_damage: 3000 + Math.floor(Math.random() * 10000),
            }
        }
    };
}

// ============================================================
// ОТОБРАЖЕНИЕ СТАТИСТИКИ
// ============================================================
function displayStats(data) {
    const stats = data.statistics?.all || {};
    const battles = stats.battles || 0;
    const wins = stats.wins || 0;
    const losses = stats.losses || 0;
    const draws = stats.draws || 0;
    const survived = stats.survived_battles || 0;
    const damage = stats.damage_dealt || 0;
    const frags = stats.frags || 0;
    const spotted = stats.spotted || 0;
    const rating = data.global_rating || 0;

    // Вычисления
    const winrate = battles > 0 ? ((wins / battles) * 100).toFixed(2) : 0;
    const avgDmg = battles > 0 ? Math.round(damage / battles) : 0;
    const surviveRate = battles > 0 ? ((survived / battles) * 100).toFixed(1) : 0;
    const avgFrags = battles > 0 ? (frags / battles).toFixed(2) : 0;
    const avgSpotted = battles > 0 ? (spotted / battles).toFixed(2) : 0;

    // Header
    document.getElementById('playerNickname').textContent = data.nickname || '—';
    document.getElementById('ratingValue').textContent = `Рейтинг: ${rating.toLocaleString()}`;

    // Rating badge
    const ratingBadge = document.getElementById('ratingBadge');
    if (rating >= 10000) {
        ratingBadge.textContent = '🟣 Уникум';
        ratingBadge.style.background = 'rgba(155, 89, 182, 0.2)';
        ratingBadge.style.color = '#bb86fc';
    } else if (rating >= 8000) {
        ratingBadge.textContent = '🔵 Отличный';
        ratingBadge.style.background = 'rgba(52, 152, 219, 0.2)';
        ratingBadge.style.color = '#64b5f6';
    } else if (rating >= 6000) {
        ratingBadge.textContent = '🟢 Хороший';
        ratingBadge.style.background = 'rgba(46, 204, 113, 0.2)';
        ratingBadge.style.color = '#81c784';
    } else if (rating >= 4000) {
        ratingBadge.textContent = '🟡 Средний';
        ratingBadge.style.background = 'rgba(241, 196, 15, 0.2)';
        ratingBadge.style.color = '#ffd54f';
    } else {
        ratingBadge.textContent = '🔴 Новичок';
        ratingBadge.style.background = 'rgba(231, 76, 60, 0.2)';
        ratingBadge.style.color = '#e57373';
    }

    // Ring color
    const ring = document.getElementById('ratingRing');
    if (rating >= 10000) ring.style.borderColor = '#9b59b6';
    else if (rating >= 8000) ring.style.borderColor = '#3498db';
    else if (rating >= 6000) ring.style.borderColor = '#2ecc71';
    else if (rating >= 4000) ring.style.borderColor = '#f1c40f';
    else ring.style.borderColor = '#e74c3c';

    // Created date
    const created = data.created_at;
    const createdStr = created ? new Date(created * 1000).toLocaleDateString('ru-RU') : '—';
    document.getElementById('playerCreated').textContent = `Аккаунт создан: ${createdStr}`;

    // Main stats
    document.getElementById('statBattles').textContent = battles.toLocaleString();
    document.getElementById('statWinrate').textContent = winrate + '%';
    document.getElementById('statDamage').textContent = avgDmg.toLocaleString();
    document.getElementById('statSurvive').textContent = surviveRate + '%';

    // Progress bars (animated)
    setTimeout(() => {
        document.getElementById('winrateBar').style.width = winrate + '%';
        document.getElementById('surviveBar').style.width = surviveRate + '%';
    }, 300);

    // Detail stats
    document.getElementById('detailFrags').textContent = avgFrags;
    document.getElementById('detailSpotted').textContent = avgSpotted;
    document.getElementById('detailAccuracy').textContent = (stats.hits_percents || 0) + '%';
    document.getElementById('detailXP').textContent = (stats.battle_avg_xp || 0).toLocaleString();
    document.getElementById('detailMaxDmg').textContent = (stats.max_damage || 0).toLocaleString();
    document.getElementById('detailMaxXP').textContent = (stats.max_xp || 0).toLocaleString();
    document.getElementById('detailWins').textContent = wins.toLocaleString();
    document.getElementById('detailLosses').textContent = losses.toLocaleString();
    document.getElementById('detailDraws').textContent = draws.toLocaleString();
    document.getElementById('detailCapture').textContent = (stats.capture_points || 0).toLocaleString();
    document.getElementById('detailDefend').textContent = (stats.dropped_capture_points || 0).toLocaleString();

    // Skill level
    displaySkillLevel(parseFloat(winrate), avgDmg, parseFloat(avgFrags));

    // Show section
    document.getElementById('loadingSection').style.display = 'none';
    document.getElementById('playerSection').style.display = 'block';

    // Haptic
    if (window.Telegram?.WebApp?.HapticFeedback) {
        window.Telegram.WebApp.HapticFeedback.notificationOccurred('success');
    }
}

function displaySkillLevel(winrate, avgDmg, avgFrags) {
    let score = 0;
    score += winrate * 2;
    score += Math.min(avgDmg / 50, 40);
    score += avgFrags * 10;

    let level, icon, desc, barPercent;

    if (score >= 160) {
        level = 'Уникум'; icon = '🟣';
        desc = 'Элита танковых войск! Один из лучших.';
        barPercent = 100;
    } else if (score >= 130) {
        level = 'Отличный игрок'; icon = '🔵';
        desc = 'Мастер тактики и стратегии.';
        barPercent = 80;
    } else if (score >= 110) {
        level = 'Хороший игрок'; icon = '🟢';
        desc = 'Уверенный боец на поле боя.';
        barPercent = 60;
    } else if (score >= 90) {
        level = 'Средний игрок'; icon = '🟡';
        desc = 'Есть куда расти, продолжай!';
        barPercent = 40;
    } else {
        level = 'Новичок'; icon = '🔴';
        desc = 'Все великие начинали с малого!';
        barPercent = 20;
    }

    document.getElementById('skillIcon').textContent = icon;
    document.getElementById('skillName').textContent = level;
    document.getElementById('skillDesc').textContent = desc;

    setTimeout(() => {
        document.getElementById('skillBar').style.width = barPercent + '%';
    }, 500);
}

// ============================================================
// НЕДАВНИЕ ПОИСКИ
// ============================================================
function addToRecent(nickname) {
    recentSearches = recentSearches.filter(n => n.toLowerCase() !== nickname.toLowerCase());
    recentSearches.unshift(nickname);
    recentSearches = recentSearches.slice(0, 5);
    localStorage.setItem('wot_recent_searches', JSON.stringify(recentSearches));
    renderRecentSearches();
}

function renderRecentSearches() {
    const container = document.getElementById('recentSearches');
    const list = document.getElementById('recentList');
    if (!container || !list) return;

    if (recentSearches.length === 0) {
        container.style.display = 'none';
        return;
    }

    container.style.display = 'block';
    list.innerHTML = recentSearches.map(nick =>
        `<span class="recent-tag" onclick="quickSearch('${nick}')">${nick}</span>`
    ).join('');
}

function quickSearch(nickname) {
    const input = document.getElementById('nicknameInput');
    if (input) {
        input.value = nickname;
        searchPlayer();
    }
}

// ============================================================
// UI HELPERS
// ============================================================
function showSearch() {
    document.getElementById('searchSection').style.display = 'block';
    document.getElementById('loadingSection').style.display = 'none';
    document.getElementById('playerSection').style.display = 'none';

    const input = document.getElementById('nicknameInput');
    if (input) {
        input.value = '';
        setTimeout(() => input.focus(), 300);
    }
}

function shakeInput() {
    const input = document.getElementById('nicknameInput');
    if (input) {
        input.style.animation = 'shake 0.4s ease';
        input.style.borderColor = '#e74c3c';
        setTimeout(() => {
            input.style.animation = '';
            input.style.borderColor = '';
        }, 500);
    }
    if (window.Telegram?.WebApp?.HapticFeedback) {
        window.Telegram.WebApp.HapticFeedback.notificationOccurred('error');
    }
}

function goBack() {
    if (window.Telegram?.WebApp?.BackButton) {
        window.Telegram.WebApp.BackButton.hide();
    }
    window.location.href = 'index.html';
}

// Setup Telegram back button
if (window.Telegram?.WebApp?.BackButton) {
    window.Telegram.WebApp.BackButton.show();
    window.Telegram.WebApp.BackButton.onClick(goBack);
}

// Expose
window.searchPlayer = searchPlayer;
window.quickSearch = quickSearch;
window.showSearch = showSearch;
window.goBack = goBack;
