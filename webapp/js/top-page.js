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
    return 'https://mir-tankov-api.onrender.com'; // fallback
})();

// ============================================================
// STATE
// ============================================================
let allPlayers = [];        // Players from DB (with wot_account_ids)
let playersStats = {};      // account_id -> stats from Lesta API
let currentCategory = 'wn8';
let sortAscending = false;
let filterText = '';
let isLoading = false;

// Category config
const CATEGORIES = {
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
    const tableWrap = document.getElementById('tableWrap');
    const emptyState = document.getElementById('emptyState');
    const statusEl = document.getElementById('loadingStatus');

    // Only show full loading if no cached data
    if (allPlayers.length === 0) {
        loadingEl.style.display = 'flex';
        tableWrap.style.display = 'none';
        emptyState.style.display = 'none';
    }

    try {
        // Step 1: Get all players with WoT accounts from our bot DB
        if (statusEl) statusEl.textContent = 'Получаем список игроков...';
        const dbPlayers = await fetchBotPlayers();

        if (!dbPlayers || dbPlayers.length === 0) {
            loadingEl.style.display = 'none';
            emptyState.style.display = 'block';
            tableWrap.style.display = 'none';
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
        tableWrap.style.display = 'block';
        emptyState.style.display = 'none';
        renderTable();

        showToast('✅', `Загружено ${dbPlayers.length} игроков`);

    } catch (e) {
        console.error('Load error:', e);
        // If we have cached data, still show it
        if (allPlayers.length > 0) {
            loadingEl.style.display = 'none';
            tableWrap.style.display = 'block';
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
    try {
        const resp = await fetch(`${API_BASE}/api/top/players`);
        const data = await resp.json();
        if (data.players) return data.players;
    } catch (e) {
        console.warn('Bot API unavailable, using fallback...');
    }

    // Fallback: if API not accessible, try local cache
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
// RENDER TABLE
// ============================================================
function renderTable() {
    const tbody = document.getElementById('tableBody');
    const cfg = CATEGORIES[currentCategory];

    // Update header label
    document.getElementById('thValueLabel').textContent = cfg.label;

    // Sort players
    const sorted = getSortedPlayers();
    const filtered = filterText
        ? sorted.filter(p => p.wot_nickname.toLowerCase().includes(filterText))
        : sorted;

    document.getElementById('totalCount').textContent = filtered.length;

    if (filtered.length === 0) {
        tbody.innerHTML = `
            <tr class="loading-row">
                <td colspan="5">Нет результатов по запросу "${filterText}"</td>
            </tr>
        `;
        return;
    }

    // Build HTML efficiently (no DOM thrashing)
    const rows = [];
    for (let i = 0; i < filtered.length; i++) {
        const p = filtered[i];
        const rank = i + 1;
        const stats = playersStats[String(p.wot_account_id)];
        rows.push(createRowHTML(p, stats, rank, cfg));
    }

    tbody.innerHTML = rows.join('');
}

function getSortedPlayers() {
    const cfg = CATEGORIES[currentCategory];
    const desc = sortAscending ? !cfg.sortDesc : cfg.sortDesc;

    return [...allPlayers].sort((a, b) => {
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

function createRowHTML(player, stats, rank, cfg) {
    const rating = stats?.global_rating || 0;
    const allStats = stats?.statistics?.all || {};
    const battles = allStats.battles || 0;
    const wins = allStats.wins || 0;
    const winrate = battles > 0 ? ((wins / battles) * 100).toFixed(1) : '—';

    const value = stats ? cfg.getValue(stats) : 0;
    const formatted = stats ? cfg.format(value) : '—';

    // WN8 color
    let wn8Class = 'wn8-dot--gray';
    if (rating >= 10000) wn8Class = 'wn8-dot--purple';
    else if (rating >= 8000) wn8Class = 'wn8-dot--blue';
    else if (rating >= 6000) wn8Class = 'wn8-dot--green';
    else if (rating >= 4000) wn8Class = 'wn8-dot--yellow';
    else if (rating > 0) wn8Class = 'wn8-dot--red';

    // Rank display
    let rankClass = '';
    let rankContent = rank;
    if (rank === 1) { rankClass = 'rank-1'; rankContent = '<span class="rank-medal">🥇</span>'; }
    else if (rank === 2) { rankClass = 'rank-2'; rankContent = '<span class="rank-medal">🥈</span>'; }
    else if (rank === 3) { rankClass = 'rank-3'; rankContent = '<span class="rank-medal">🥉</span>'; }

    // Winrate color
    let wrClass = '';
    const wrNum = parseFloat(winrate);
    if (!isNaN(wrNum)) {
        if (wrNum >= 55) wrClass = 'wr-good';
        else if (wrNum >= 49) wrClass = 'wr-avg';
        else wrClass = 'wr-bad';
    }

    const tgName = player.first_name || player.username || '';

    const accountId = player.wot_account_id;

    return `
        <tr class="${rankClass}" onclick="showPlayerModal(${accountId})">
            <td class="td-rank ${rank === 1 ? 'td-rank--gold' : rank === 2 ? 'td-rank--silver' : rank === 3 ? 'td-rank--bronze' : ''}">${rankContent}</td>
            <td>
                <div class="td-player">
                    <span class="wn8-dot ${wn8Class}"></span>
                    <div>
                        <div class="player-nick">${player.wot_nickname}</div>
                        ${tgName ? `<div class="player-tg">${tgName}</div>` : ''}
                    </div>
                </div>
            </td>
            <td class="td-value">${formatted}</td>
            <td class="td-battles">${battles > 0 ? battles.toLocaleString('ru-RU') : '—'}</td>
            <td class="td-winrate ${wrClass}">${winrate}${winrate !== '—' ? '%' : ''}</td>
        </tr>
    `;
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

    const arrow = document.getElementById('sortArrow');
    arrow.classList.toggle('asc', !CATEGORIES[cat].sortDesc);

    renderTable();

    if (window.Telegram?.WebApp?.HapticFeedback) {
        window.Telegram.WebApp.HapticFeedback.selectionChanged();
    }
}

function toggleSortDir() {
    sortAscending = !sortAscending;
    const arrow = document.getElementById('sortArrow');
    const cfg = CATEGORIES[currentCategory];
    const isAsc = sortAscending ? !cfg.sortDesc : !cfg.sortDesc;
    arrow.classList.toggle('asc', sortAscending);
    renderTable();
}

// ============================================================
// FILTER
// ============================================================
function filterTable() {
    filterText = document.getElementById('filterInput').value.trim().toLowerCase();
    renderTable();
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

    overlay.innerHTML = `
        <div class="player-modal">
            <div class="modal-header">
                <div class="modal-avatar">🪖</div>
                <div class="modal-info">
                    <h3>${stats.nickname || player.wot_nickname}</h3>
                    <div class="modal-rating" style="color:${ratingColor}">${ratingText} • ${rating.toLocaleString('ru-RU')}</div>
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
            <div class="modal-actions">
                <button class="modal-btn modal-btn--primary" onclick="openStatsPage('${stats.nickname || player.wot_nickname}')">📊 Подробнее</button>
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
// EXPOSE
// ============================================================
window.switchCategory = switchCategory;
window.toggleSortDir = toggleSortDir;
window.filterTable = filterTable;
window.showPlayerModal = showPlayerModal;
window.openStatsPage = openStatsPage;
window.loadAllPlayers = loadAllPlayers;
window.goBack = goBack;
