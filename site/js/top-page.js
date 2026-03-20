/**
 * Топ Игроков — Мир Танков
 * Автоматическая загрузка всех подписчиков из БД + стата Lesta API
 * Табличный формат на тысячи игроков
 */

// ============================================================
// CONFIG
// ============================================================
const LESTA_APP_ID = "c984faa7dc529f4cb0139505d5e8043c";
const LESTA_API_URL = "https://api.tanki.su/wot";

// API URL — определяем автоматически
const API_BASE = (() => {
    const params = new URLSearchParams(window.location.search);
    const host = params.get('api') || localStorage.getItem('api_host');
    if (host) return host;
    // Default: same origin or stored
    if (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1') {
        return `http://${window.location.hostname}:8081`;
    }
    // GitHub Pages — нужен внешний API
    const savedApi = localStorage.getItem('api_url');
    if (savedApi) return savedApi;
    return 'https://mir-tankov-production.up.railway.app'; // fallback
})();

// ============================================================
// STATE
// ============================================================
let allPlayers = [];        // Players from DB (with wot_account_ids)
let playersStats = {};      // account_id -> stats from Lesta API
let currentCategory = 'all';
let sortAscending = false;
let filterText = '';
let isLoading = false;
let onlineOnly = false;

// Онлайн-определение (надёжный метод):
// - last_battle_time < 5 мин → активно играет (бой был только что)
// - logout_at < 5 мин → только что был в клиенте
// Lesta API обновляет logout_at при КАЖДОМ выходе, поэтому
// logout_at < updated_at — НЕ показатель онлайна!
function isPlayerOnline(accountId) {
    const stats = playersStats[String(accountId)];
    if (!stats) return false;
    const now = Math.floor(Date.now() / 1000);
    const THRESHOLD = 5 * 60; // 5 минут

    const lastBattle = stats.last_battle_time || 0;
    const logoutAt = stats.logout_at || 0;

    // Был в бою менее 5 минут назад
    if (lastBattle > 0 && (now - lastBattle) < THRESHOLD) return true;

    // Вышел из клиента менее 5 минут назад
    if (logoutAt > 0 && (now - logoutAt) < THRESHOLD) return true;

    return false;
}

// Текущий пользователь
function getMyTelegramId() {
    const tg = window.Telegram?.WebApp;
    if (tg?.initDataUnsafe?.user?.id) return tg.initDataUnsafe.user.id;
    const params = new URLSearchParams(window.location.search);
    return params.get('telegram_id') || localStorage.getItem('my_telegram_id');
}

// Category config
const CATEGORIES = {
    all: {
        label: 'Ник',
        getValue: (s) => (s?.nickname || '').toLowerCase(),
        format: (v) => '',
        sortDesc: false,
        sortAlpha: true,
    },
    wn8: {
        label: 'WN8',
        getValue: (s) => s.global_rating || 0,
        format: (v) => v.toLocaleString('ru-RU'),
        sortDesc: true,
    },
    damage: {
        label: 'Ср. урон',
        getValue: (s) => {
            const a = s.statistics?.all || {};
            return a.battles > 0 ? Math.round(a.damage_dealt / a.battles) : 0;
        },
        format: (v) => v.toLocaleString('ru-RU'),
        sortDesc: true,
    },
    veteran: {
        label: 'Регистрация',
        getValue: (s) => s.created_at || Infinity,
        format: (v) => {
            if (!v || v === Infinity) return '—';
            return new Date(v * 1000).toLocaleDateString('ru-RU', {
                day: '2-digit', month: '2-digit', year: 'numeric'
            });
        },
        sortDesc: false,
    },
    battles: {
        label: 'Боёв',
        getValue: (s) => (s.statistics?.all?.battles) || 0,
        format: (v) => v.toLocaleString('ru-RU'),
        sortDesc: true,
    },
    playtime: {
        label: 'Время',
        getValue: (s) => {
            const b = s.statistics?.all?.battles || 0;
            return Math.round(b * 7); // минуты (~7 мин/бой)
        },
        format: (v) => {
            const h = Math.floor(v / 60);
            if (h >= 1000) return (h / 1000).toFixed(1) + 'K ч';
            return h.toLocaleString('ru-RU') + ' ч';
        },
        sortDesc: true,
    },
};

// ============================================================
// INITIALIZATION
// ============================================================
document.addEventListener('DOMContentLoaded', () => {
    // Try to load cached data first for instant display
    const cached = localStorage.getItem('top_players_cache');
    if (cached) {
        try {
            const data = JSON.parse(cached);
            playersStats = data.stats || {};
            allPlayers = data.players || [];
            if (allPlayers.length > 0) {
                renderTable();
                document.getElementById('loadingFull').style.display = 'none';
                document.getElementById('tableWrap').style.display = 'block';
            }
        } catch (e) { /* ignore */ }
    }

    // Then refresh from API
    loadAllPlayers();
});

// ============================================================
// LOAD ALL PLAYERS FROM BOT API + LESTA STATS
// ============================================================
async function loadAllPlayers() {
    if (isLoading) return;
    isLoading = true;

    const refreshBtn = document.getElementById('refreshBtn');
    refreshBtn?.classList.add('spinning');

    const loadingEl = document.getElementById('loadingFull');
    const playersList = document.getElementById('playersList');
    const emptyState = document.getElementById('emptyState');
    const statusEl = document.getElementById('loadingStatus');

    // Only show full loading if no cached data
    if (allPlayers.length === 0) {
        loadingEl.style.display = 'flex';
        if (playersList) playersList.style.display = 'none';
        emptyState.style.display = 'none';
    }

    try {
        // Step 1: Get all players with WoT accounts from our bot DB
        if (statusEl) statusEl.textContent = 'Получаем список игроков...';
        const dbPlayers = await fetchBotPlayers();

        if (!dbPlayers || dbPlayers.length === 0) {
            loadingEl.style.display = 'none';
            emptyState.style.display = 'block';
            if (playersList) playersList.style.display = 'none';
            isLoading = false;
            refreshBtn?.classList.remove('spinning');
            return;
        }

        allPlayers = dbPlayers;
        document.getElementById('totalCount').textContent = dbPlayers.length;

        // Step 2: Batch fetch stats from Lesta API
        if (statusEl) statusEl.textContent = `Загружаем статистику ${dbPlayers.length} игроков...`;

        const accountIds = dbPlayers.map(p => p.wot_account_id);
        await batchFetchLestaStats(accountIds);

        // Step 3: Cache and render
        cacheData();
        loadingEl.style.display = 'none';
        if (playersList) playersList.style.display = 'block';
        emptyState.style.display = 'none';
        renderTable();

        showToast('✅', `Загружено ${dbPlayers.length} игроков`);

    } catch (e) {
        console.error('Load error:', e);
        // If we have cached data, still show it
        if (allPlayers.length > 0) {
            loadingEl.style.display = 'none';
            if (playersList) playersList.style.display = 'block';
            renderTable();
            showToast('⚠️', 'Показаны кэшированные данные');
        } else {
            loadingEl.style.display = 'none';
            emptyState.style.display = 'block';
            showToast('❌', 'Ошибка загрузки');
        }
    }

    isLoading = false;
    refreshBtn?.classList.remove('spinning');
}

async function fetchBotPlayers() {
    // Способ 1: API бота (если бот на сервере или localhost)
    try {
        const resp = await fetch(`${API_BASE}/api/top/players`, { signal: AbortSignal.timeout(5000) });
        const data = await resp.json();
        if (data.players && data.players.length > 0) {
            console.log(`✅ Загружено ${data.players.length} игроков из API`);
            return data.players;
        }
    } catch (e) {
        console.warn('Bot API недоступен, пробуем JSON файл...', e.message);
    }

    // Способ 2: Статический JSON файл на GitHub Pages
    try {
        const jsonUrl = 'data/players.json';
        const resp = await fetch(jsonUrl, { signal: AbortSignal.timeout(5000) });
        if (resp.ok) {
            const data = await resp.json();
            if (data.players && data.players.length > 0) {
                console.log(`✅ Загружено ${data.players.length} игроков из JSON файла`);
                return data.players;
            }
        }
    } catch (e) {
        console.warn('JSON файл недоступен:', e.message);
    }

    // Способ 3: Кэш
    return allPlayers.length > 0 ? allPlayers : null;
}

async function batchFetchLestaStats(accountIds) {
    // Lesta API supports up to 100 accounts per request
    const BATCH_SIZE = 100;
    const batches = [];

    for (let i = 0; i < accountIds.length; i += BATCH_SIZE) {
        batches.push(accountIds.slice(i, i + BATCH_SIZE));
    }

    const progressBar = document.querySelector('.progress-bar');
    let loaded = 0;

    for (const batch of batches) {
        try {
            const ids = batch.join(',');
            const url = `${LESTA_API_URL}/account/info/?application_id=${LESTA_APP_ID}&account_id=${ids}`;
            const resp = await fetch(url);
            const data = await resp.json();

            if (data.status === 'ok' && data.data) {
                for (const [id, stats] of Object.entries(data.data)) {
                    if (stats) {
                        playersStats[id] = stats;
                    }
                }
            }
        } catch (e) {
            console.warn('Batch fetch error:', e);
        }

        loaded += batch.length;
        const pct = Math.round((loaded / accountIds.length) * 100);
        if (progressBar) progressBar.style.width = pct + '%';

        const statusEl = document.getElementById('loadingStatus');
        if (statusEl) statusEl.textContent = `Загружено ${loaded} из ${accountIds.length}...`;
    }
}

function cacheData() {
    try {
        // Cache for 10 minutes
        localStorage.setItem('top_players_cache', JSON.stringify({
            players: allPlayers,
            stats: playersStats,
            timestamp: Date.now(),
        }));
    } catch (e) { /* quota exceeded, ignore */ }
}

// ============================================================
// RENDER CARDS
// ============================================================
function renderTable() {
    const container = document.getElementById('playersListInner');
    if (!container) return;
    const cfg = CATEGORIES[currentCategory];

    // Sort players
    const sorted = getSortedPlayers();
    let filtered = filterText
        ? sorted.filter(p => p.wot_nickname.toLowerCase().includes(filterText))
        : sorted;

    // Онлайн фильтр
    if (onlineOnly) {
        filtered = filtered.filter(p => isPlayerOnline(p.wot_account_id));
    }

    // Обновляем счётчик
    const onlineCount = sorted.filter(p => isPlayerOnline(p.wot_account_id)).length;
    document.getElementById('totalCount').textContent = onlineOnly
        ? `${filtered.length}`
        : filtered.length;

    // Подзаголовок
    const headerSub = document.getElementById('headerSub');
    if (headerSub) {
        if (onlineOnly) {
            headerSub.textContent = `🟢 Сейчас в игре`;
        } else if (currentCategory === 'all') {
            headerSub.textContent = `Все участники • ${onlineCount} онлайн`;
        } else {
            headerSub.textContent = `Рейтинг: ${cfg.label}`;
        }
    }

    if (filtered.length === 0) {
        container.innerHTML = `<div class="no-results">🔍 Нет результатов ${onlineOnly ? '(никто не в игре)' : ''}</div>`;
        return;
    }

    const cards = [];
    for (let i = 0; i < filtered.length; i++) {
        cards.push(createCardHTML(filtered[i], playersStats[String(filtered[i].wot_account_id)], i + 1, cfg));
    }
    container.innerHTML = cards.join('');
}

function getSortedPlayers() {
    const cfg = CATEGORIES[currentCategory];
    const desc = sortAscending ? !cfg.sortDesc : cfg.sortDesc;

    return [...allPlayers].sort((a, b) => {
        if (cfg.sortAlpha) {
            const na = (a.wot_nickname || '').toLowerCase();
            const nb = (b.wot_nickname || '').toLowerCase();
            return desc ? nb.localeCompare(na) : na.localeCompare(nb);
        }
        const sa = playersStats[String(a.wot_account_id)];
        const sb = playersStats[String(b.wot_account_id)];
        if (!sa && !sb) return 0;
        if (!sa) return 1;
        if (!sb) return -1;
        const va = cfg.getValue(sa);
        const vb = cfg.getValue(sb);
        return desc ? (vb - va) : (va - vb);
    });
}

function createCardHTML(player, stats, rank, cfg) {
    const rating = stats?.global_rating || 0;
    const allS = stats?.statistics?.all || {};
    const battles = allS.battles || 0;
    const wins = allS.wins || 0;
    const winrate = battles > 0 ? ((wins / battles) * 100).toFixed(1) : '—';
    const accountId = player.wot_account_id;
    const online = isPlayerOnline(accountId);
    const tgName = player.first_name || player.username || '';

    // Main stat value
    let mainStat = stats ? cfg.format(cfg.getValue(stats)) : '—';
    if (cfg.sortAlpha && stats) {
        mainStat = rating > 0 ? rating.toLocaleString('ru-RU') : '—';
    }

    // WN8 color bar
    let wn8Color = 'wn8-gray';
    if (rating >= 10000) wn8Color = 'wn8-purple';
    else if (rating >= 8000) wn8Color = 'wn8-blue';
    else if (rating >= 6000) wn8Color = 'wn8-green';
    else if (rating >= 4000) wn8Color = 'wn8-yellow';
    else if (rating > 0) wn8Color = 'wn8-red';

    // Rank badge
    let rankBadge = `<div class="rank-badge">${rank}</div>`;
    if (rank === 1) rankBadge = `<div class="rank-badge rank-badge--gold">🥇</div>`;
    else if (rank === 2) rankBadge = `<div class="rank-badge rank-badge--silver">🥈</div>`;
    else if (rank === 3) rankBadge = `<div class="rank-badge rank-badge--bronze">🥉</div>`;

    // Card class
    let cardClass = 'player-card';
    if (rank === 1) cardClass += ' rank-1';
    else if (rank === 2) cardClass += ' rank-2';
    else if (rank === 3) cardClass += ' rank-3';
    if (online) cardClass += ' player-card--online';

    // Avatar (first letter or emoji)
    const avatarContent = player.avatar && !player.avatar.startsWith('data:')
        ? player.avatar
        : (player.wot_nickname || '?')[0].toUpperCase();

    // Winrate color
    let wrClass = '';
    const wrNum = parseFloat(winrate);
    if (!isNaN(wrNum)) {
        if (wrNum >= 55) wrClass = 'wr-good';
        else if (wrNum >= 49) wrClass = 'wr-avg';
        else wrClass = 'wr-bad';
    }

    // Online dot & subtitle
    const onlineDot = online ? '<div class="player-avatar__online"></div>' : '';
    const subLine = online
        ? '<span class="player-online-text"><span class="dot"></span>В игре</span>'
        : (tgName ? `<span class="player-tg-name">${tgName}</span>` : '');

    return `
    <div class="${cardClass}" onclick="showPlayerModal(${accountId})">
        ${rankBadge}
        <div class="player-avatar">
            ${avatarContent}
            ${onlineDot}
        </div>
        <div class="wn8-indicator ${wn8Color}"></div>
        <div class="player-info">
            <div class="player-name">${player.wot_nickname}</div>
            <div class="player-sub">
                ${subLine}
            </div>
        </div>
        <div class="player-stats">
            <div class="player-main-stat">${mainStat}</div>
            <div class="player-secondary">
                <span>${battles > 0 ? battles.toLocaleString('ru-RU') + ' боёв' : ''}</span>
                <span class="${wrClass}">${winrate !== '—' ? winrate + '%' : ''}</span>
            </div>
        </div>
    </div>`;
}

// ============================================================
// CATEGORY SWITCHING
// ============================================================
function switchCategory(cat) {
    currentCategory = cat;
    sortAscending = false;

    document.querySelectorAll('.cat-tab').forEach(tab => {
        tab.classList.toggle('cat-tab--active', tab.dataset.cat === cat);
    });

    renderTable();

    if (window.Telegram?.WebApp?.HapticFeedback) {
        window.Telegram.WebApp.HapticFeedback.selectionChanged();
    }
}

function toggleSortDir() {
    sortAscending = !sortAscending;
    renderTable();
}

// ============================================================
// FILTER
// ============================================================
function filterTable() {
    filterText = document.getElementById('filterInput').value.trim().toLowerCase();
    renderTable();
}

function toggleOnlineFilter() {
    onlineOnly = !onlineOnly;
    const btn = document.getElementById('onlineToggle');
    btn.classList.toggle('active', onlineOnly);
    renderTable();

    if (window.Telegram?.WebApp?.HapticFeedback) {
        window.Telegram.WebApp.HapticFeedback.selectionChanged();
    }
}

// ============================================================
// PLAYER MODAL
// ============================================================
function showPlayerModal(accountId) {
    const stats = playersStats[String(accountId)];
    const player = allPlayers.find(p => p.wot_account_id === accountId);
    if (!stats || !player) return;

    const allS = stats.statistics?.all || {};
    const battles = allS.battles || 0;
    const wins = allS.wins || 0;
    const winrate = battles > 0 ? ((wins / battles) * 100).toFixed(1) : '0';
    const avgDmg = battles > 0 ? Math.round(allS.damage_dealt / battles) : 0;
    const avgFrags = battles > 0 ? (allS.frags / battles).toFixed(2) : '0';
    const survRate = battles > 0 ? ((allS.survived_battles / battles) * 100).toFixed(1) : '0';
    const rating = stats.global_rating || 0;
    const playtimeH = Math.round(battles * 7 / 60);
    const created = stats.created_at
        ? new Date(stats.created_at * 1000).toLocaleDateString('ru-RU')
        : '—';

    let ratingText, ratingColor;
    if (rating >= 10000) { ratingText = '🟣 Уникум'; ratingColor = '#bb86fc'; }
    else if (rating >= 8000) { ratingText = '🔵 Отличный'; ratingColor = '#64b5f6'; }
    else if (rating >= 6000) { ratingText = '🟢 Хороший'; ratingColor = '#81c784'; }
    else if (rating >= 4000) { ratingText = '🟡 Средний'; ratingColor = '#ffd54f'; }
    else { ratingText = '🔴 Новичок'; ratingColor = '#e57373'; }

    const overlay = document.createElement('div');
    overlay.className = 'player-modal-overlay';
    overlay.id = 'playerModal';
    overlay.onclick = (e) => { if (e.target === overlay) overlay.remove(); };

    const myTgId = getMyTelegramId();
    const isMe = myTgId && String(player.telegram_id) === String(myTgId);
    const nick = stats.nickname || player.wot_nickname;

    overlay.innerHTML = `
        <div class="player-modal">
            <div class="modal-header">
                <div class="modal-avatar">${player.avatar && !player.avatar.startsWith('data:') ? player.avatar : '🪖'}</div>
                <div class="modal-info">
                    <h3>${nick}</h3>
                    <div class="modal-rating" style="color:${ratingColor}">${ratingText} • ${rating.toLocaleString('ru-RU')}</div>
                    ${player.first_name ? `<div style="font-size:0.65rem;color:#8b9bb4;margin-top:2px;">👤 ${player.first_name}</div>` : ''}
                </div>
            </div>
            <div class="modal-stats">
                <div class="modal-stat">
                    <div class="modal-stat__value">${battles.toLocaleString('ru-RU')}</div>
                    <div class="modal-stat__label">⚔️ Боёв</div>
                </div>
                <div class="modal-stat">
                    <div class="modal-stat__value">${winrate}%</div>
                    <div class="modal-stat__label">🏆 Побед</div>
                </div>
                <div class="modal-stat">
                    <div class="modal-stat__value">${avgDmg.toLocaleString('ru-RU')}</div>
                    <div class="modal-stat__label">💥 Ср. урон</div>
                </div>
                <div class="modal-stat">
                    <div class="modal-stat__value">${avgFrags}</div>
                    <div class="modal-stat__label">🎯 Ср. фраги</div>
                </div>
                <div class="modal-stat">
                    <div class="modal-stat__value">${survRate}%</div>
                    <div class="modal-stat__label">💚 Выживание</div>
                </div>
                <div class="modal-stat">
                    <div class="modal-stat__value">${playtimeH.toLocaleString('ru-RU')} ч</div>
                    <div class="modal-stat__label">⏱ Время</div>
                </div>
                <div class="modal-stat">
                    <div class="modal-stat__value">${created}</div>
                    <div class="modal-stat__label">📅 Регистрация</div>
                </div>
                <div class="modal-stat">
                    <div class="modal-stat__value">${(allS.max_damage || 0).toLocaleString('ru-RU')}</div>
                    <div class="modal-stat__label">🔥 Макс. урон</div>
                </div>
            </div>
            ${!isMe ? `
            <div class="modal-actions" style="margin-bottom:8px;">
                <button class="modal-btn modal-btn--friend" onclick="sendFriendRequest(${player.telegram_id}, '${nick}')">
                    👥 В друзья
                </button>
                <button class="modal-btn modal-btn--challenge" onclick="sendChallenge(${player.telegram_id}, '${nick}')">
                    ⚔️ Вызов
                </button>
            </div>` : `
            <div style="text-align:center;padding:8px;font-size:0.75rem;color:#C8AA6E;margin-bottom:8px;">✨ Это ваш аккаунт</div>
            `}
            <div class="modal-actions">
                <button class="modal-btn modal-btn--primary" onclick="openStatsPage('${nick}')">📊 Подробнее</button>
                <button class="modal-btn modal-btn--secondary" onclick="document.getElementById('playerModal').remove()">Закрыть</button>
            </div>
        </div>
    `;

    document.body.appendChild(overlay);
    if (window.Telegram?.WebApp?.HapticFeedback) {
        window.Telegram.WebApp.HapticFeedback.impactOccurred('medium');
    }
}

function openStatsPage(nickname) {
    const modal = document.getElementById('playerModal');
    if (modal) modal.remove();
    window.location.href = `stats.html?nick=${encodeURIComponent(nickname)}`;
}

// ============================================================
// UI HELPERS
// ============================================================
function goBack() {
    if (window.Telegram?.WebApp?.BackButton) {
        window.Telegram.WebApp.BackButton.hide();
    }
    window.location.href = 'index.html';
}

if (window.Telegram?.WebApp?.BackButton) {
    window.Telegram.WebApp.BackButton.show();
    window.Telegram.WebApp.BackButton.onClick(goBack);
}

// ============================================================
// FRIEND REQUEST & CHALLENGE
// ============================================================
async function sendFriendRequest(targetTgId, nickname) {
    const myTgId = getMyTelegramId();
    if (!myTgId) {
        showToast('❌', 'Войдите через Telegram');
        return;
    }
    if (String(myTgId) === String(targetTgId)) {
        showToast('😅', 'Нельзя добавить себя');
        return;
    }

    try {
        const resp = await fetch(`${API_BASE}/api/friends/add`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                telegram_id: parseInt(myTgId),
                friend_telegram_id: parseInt(targetTgId),
            }),
        });
        const data = await resp.json();

        if (data.error) {
            showToast('⚠️', data.error);
        } else {
            showToast('✅', `Заявка отправлена ${nickname}!`);
            if (window.Telegram?.WebApp?.HapticFeedback) {
                window.Telegram.WebApp.HapticFeedback.notificationOccurred('success');
            }
        }
    } catch (e) {
        showToast('❌', 'Ошибка сети');
    }
}

async function sendChallenge(targetTgId, nickname) {
    const myTgId = getMyTelegramId();
    if (!myTgId) {
        showToast('❌', 'Войдите через Telegram');
        return;
    }

    // Закрываем модалку и переходим на арену с предзаполненным оппонентом
    const modal = document.getElementById('playerModal');
    if (modal) modal.remove();

    window.location.href = `challenges.html?opponent_id=${targetTgId}&opponent_nick=${encodeURIComponent(nickname)}`;
}

// ============================================================
// EXPOSE
// ============================================================
window.switchCategory = switchCategory;
window.toggleSortDir = toggleSortDir;
window.filterTable = filterTable;
window.toggleOnlineFilter = toggleOnlineFilter;
window.showPlayerModal = showPlayerModal;
window.openStatsPage = openStatsPage;
window.loadAllPlayers = loadAllPlayers;
window.goBack = goBack;
window.sendFriendRequest = sendFriendRequest;
window.sendChallenge = sendChallenge;
