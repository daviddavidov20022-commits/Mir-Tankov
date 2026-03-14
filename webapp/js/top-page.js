/**
 * Топ Игроков — Мир Танков
 * Добавляй игроков по нику и сравнивай по разным категориям:
 * WN8, Средний урон, Ветеран (дата регистрации), Количество боёв, Время в игре
 */

// ============================================================
// API CONFIG
// ============================================================
const LESTA_APP_ID = "c984faa7dc529f4cb0139505d5e8043c";
const LESTA_API_URL = "https://api.tanki.su/wot";

// ============================================================
// STATE
// ============================================================
let topPlayers = JSON.parse(localStorage.getItem('top_players_data') || '[]');
let currentCategory = 'wn8';
let isSearching = false;
let searchDebounceTimer = null;

// Category config
const CATEGORIES = {
    wn8: {
        icon: '🎖',
        title: 'Топ по WN8 рейтингу',
        subtitle: 'Лучшие игроки по личному рейтингу',
        getValue: (p) => p.global_rating || 0,
        format: (v) => v.toLocaleString(),
        unit: 'WN8',
        sortDesc: true,
    },
    damage: {
        icon: '💥',
        title: 'Топ по среднему урону',
        subtitle: 'Кто наносит больше всего урона за бой',
        getValue: (p) => {
            const s = p.statistics?.all || {};
            return s.battles > 0 ? Math.round(s.damage_dealt / s.battles) : 0;
        },
        format: (v) => v.toLocaleString(),
        unit: 'Ср. урон',
        sortDesc: true,
    },
    veteran: {
        icon: '📅',
        title: 'Старейшие игроки',
        subtitle: 'Кто раньше всех зарегистрировался в Мир Танков',
        getValue: (p) => p.created_at || Infinity,
        format: (v) => {
            if (!v || v === Infinity) return '—';
            return new Date(v * 1000).toLocaleDateString('ru-RU', {
                day: '2-digit', month: '2-digit', year: 'numeric'
            });
        },
        unit: 'Регистрация',
        sortDesc: false, // Ascending — oldest first
    },
    battles: {
        icon: '⚔️',
        title: 'Топ по количеству боёв',
        subtitle: 'Самые активные танкисты по числу боёв',
        getValue: (p) => {
            const s = p.statistics?.all || {};
            return s.battles || 0;
        },
        format: (v) => v.toLocaleString(),
        unit: 'Боёв',
        sortDesc: true,
    },
    playtime: {
        icon: '⏱',
        title: 'Топ по времени в игре',
        subtitle: 'Кто проводит больше всего времени в танках',
        getValue: (p) => {
            // Estimate playtime: battles × avg ~7 min per battle
            const s = p.statistics?.all || {};
            const battles = s.battles || 0;
            // Better estimate: use actual battle time if available, otherwise ~7 min per battle
            return Math.round(battles * 7); // minutes
        },
        format: (v) => {
            const hours = Math.floor(v / 60);
            if (hours >= 1000) return (hours / 1000).toFixed(1) + 'K ч';
            return hours.toLocaleString() + ' ч';
        },
        unit: 'Время',
        sortDesc: true,
    },
};

// ============================================================
// INITIALIZATION
// ============================================================
document.addEventListener('DOMContentLoaded', () => {
    renderLeaderboard();

    const input = document.getElementById('addPlayerInput');
    if (input) {
        input.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') addPlayerToTop();
        });

        // Live search suggestions
        input.addEventListener('input', () => {
            clearTimeout(searchDebounceTimer);
            const val = input.value.trim();
            if (val.length >= 2) {
                searchDebounceTimer = setTimeout(() => showSearchSuggestions(val), 400);
            } else {
                removeSuggestions();
            }
        });

        // Close suggestions on outside click
        document.addEventListener('click', (e) => {
            if (!e.target.closest('.add-player-card')) {
                removeSuggestions();
            }
        });
    }
});

// ============================================================
// SEARCH & ADD PLAYERS
// ============================================================
async function addPlayerToTop() {
    const input = document.getElementById('addPlayerInput');
    const nickname = input.value.trim();

    if (nickname.length < 2) {
        shakeInput(input);
        return;
    }

    // Check if already added
    if (topPlayers.some(p => p.nickname.toLowerCase() === nickname.toLowerCase())) {
        showToast('⚠️', 'Игрок уже в списке!');
        return;
    }

    showLoading(true);
    removeSuggestions();

    if (window.Telegram?.WebApp?.HapticFeedback) {
        window.Telegram.WebApp.HapticFeedback.impactOccurred('light');
    }

    try {
        const playerData = await fetchPlayerData(nickname);
        if (playerData) {
            topPlayers.push(playerData);
            saveTopPlayers();
            input.value = '';
            renderLeaderboard();
            showToast('✅', `${playerData.nickname} добавлен в топ!`);

            if (window.Telegram?.WebApp?.HapticFeedback) {
                window.Telegram.WebApp.HapticFeedback.notificationOccurred('success');
            }
        } else {
            showToast('❌', 'Игрок не найден');
            if (window.Telegram?.WebApp?.HapticFeedback) {
                window.Telegram.WebApp.HapticFeedback.notificationOccurred('error');
            }
        }
    } catch (e) {
        console.error('Error adding player:', e);
        showToast('❌', 'Ошибка загрузки');
    }

    showLoading(false);
}

async function fetchPlayerData(nickname) {
    // Step 1: Search for player by nickname
    const searchUrl = `${LESTA_API_URL}/account/list/?application_id=${LESTA_APP_ID}&search=${encodeURIComponent(nickname)}&limit=1&type=exact`;
    let searchResp = await fetch(searchUrl);
    let searchData = await searchResp.json();

    // If exact match fails, try startswith
    if (searchData.status !== 'ok' || !searchData.data || searchData.data.length === 0) {
        const searchUrl2 = `${LESTA_API_URL}/account/list/?application_id=${LESTA_APP_ID}&search=${encodeURIComponent(nickname)}&limit=1`;
        searchResp = await fetch(searchUrl2);
        searchData = await searchResp.json();
    }

    if (searchData.status !== 'ok' || !searchData.data || searchData.data.length === 0) {
        return null;
    }

    const accountId = searchData.data[0].account_id;

    // Step 2: Get full stats
    const infoUrl = `${LESTA_API_URL}/account/info/?application_id=${LESTA_APP_ID}&account_id=${accountId}`;
    const infoResp = await fetch(infoUrl);
    const infoData = await infoResp.json();

    if (infoData.status !== 'ok' || !infoData.data) {
        return null;
    }

    const data = infoData.data[String(accountId)];
    if (!data) return null;

    // Add fetch timestamp
    data._fetchedAt = Date.now();

    return data;
}

async function fetchPlayerByAccountId(accountId) {
    const infoUrl = `${LESTA_API_URL}/account/info/?application_id=${LESTA_APP_ID}&account_id=${accountId}`;
    const infoResp = await fetch(infoUrl);
    const infoData = await infoResp.json();

    if (infoData.status !== 'ok' || !infoData.data) return null;

    const data = infoData.data[String(accountId)];
    if (!data) return null;
    data._fetchedAt = Date.now();
    return data;
}

// ============================================================
// SEARCH SUGGESTIONS
// ============================================================
async function showSearchSuggestions(query) {
    try {
        const url = `${LESTA_API_URL}/account/list/?application_id=${LESTA_APP_ID}&search=${encodeURIComponent(query)}&limit=5`;
        const resp = await fetch(url);
        const data = await resp.json();

        if (data.status !== 'ok' || !data.data || data.data.length === 0) {
            removeSuggestions();
            return;
        }

        renderSuggestions(data.data);
    } catch (e) {
        console.warn('Search suggestions error:', e);
    }
}

function renderSuggestions(players) {
    removeSuggestions();

    const addCard = document.querySelector('.add-player-card');
    if (!addCard) return;

    addCard.style.position = 'relative';

    const box = document.createElement('div');
    box.className = 'search-suggestions';
    box.id = 'searchSuggestions';

    players.forEach(p => {
        // Skip if already in list
        const alreadyAdded = topPlayers.some(tp => tp.account_id === p.account_id);

        const item = document.createElement('div');
        item.className = 'suggestion-item';
        item.innerHTML = `
            <span class="suggestion-avatar">🪖</span>
            <div>
                <div class="suggestion-name">${p.nickname}</div>
                <div class="suggestion-id">ID: ${p.account_id}${alreadyAdded ? ' • ✅ В списке' : ''}</div>
            </div>
        `;

        if (!alreadyAdded) {
            item.onclick = () => selectSuggestion(p);
        } else {
            item.style.opacity = '0.5';
        }

        box.appendChild(item);
    });

    addCard.appendChild(box);
}

function removeSuggestions() {
    const existing = document.getElementById('searchSuggestions');
    if (existing) existing.remove();
}

async function selectSuggestion(player) {
    removeSuggestions();
    showLoading(true);

    try {
        const data = await fetchPlayerByAccountId(player.account_id);
        if (data) {
            if (topPlayers.some(p => p.account_id === data.account_id)) {
                showToast('⚠️', 'Уже в списке!');
            } else {
                topPlayers.push(data);
                saveTopPlayers();
                renderLeaderboard();
                showToast('✅', `${data.nickname} добавлен!`);
            }
        } else {
            showToast('❌', 'Не удалось загрузить');
        }
    } catch (e) {
        showToast('❌', 'Ошибка');
    }

    const input = document.getElementById('addPlayerInput');
    if (input) input.value = '';
    showLoading(false);
}

// ============================================================
// CATEGORY SWITCHING
// ============================================================
function switchCategory(cat) {
    currentCategory = cat;

    // Update active tab
    document.querySelectorAll('.cat-tab').forEach(tab => {
        tab.classList.toggle('cat-tab--active', tab.dataset.cat === cat);
    });

    // Update description
    const cfg = CATEGORIES[cat];
    document.getElementById('catTitle').textContent = cfg.title;
    document.getElementById('catSubtitle').textContent = cfg.subtitle;
    document.querySelector('.category-desc__icon').textContent = cfg.icon;

    // Animate description
    const desc = document.querySelector('.category-desc');
    desc.style.animation = 'none';
    desc.offsetHeight; // force reflow
    desc.style.animation = 'fadeIn 0.4s ease-out';

    // Re-render
    renderLeaderboard();

    if (window.Telegram?.WebApp?.HapticFeedback) {
        window.Telegram.WebApp.HapticFeedback.selectionChanged();
    }
}

// ============================================================
// RENDER LEADERBOARD
// ============================================================
function renderLeaderboard() {
    const cfg = CATEGORIES[currentCategory];
    const emptyState = document.getElementById('emptyState');
    const podium = document.getElementById('podium');
    const playersList = document.getElementById('playersList');

    if (topPlayers.length === 0) {
        emptyState.style.display = 'block';
        podium.style.display = 'none';
        playersList.innerHTML = '';
        return;
    }

    emptyState.style.display = 'none';

    // Sort players
    const sorted = [...topPlayers].sort((a, b) => {
        const va = cfg.getValue(a);
        const vb = cfg.getValue(b);
        return cfg.sortDesc ? (vb - va) : (va - vb);
    });

    // Get max value for bar widths
    const values = sorted.map(p => cfg.getValue(p));
    const maxVal = cfg.sortDesc
        ? Math.max(...values)
        : Math.max(...values.map((v, i) => {
            // For veteran (oldest), invert for visual bar
            return sorted.length - i;
        }));

    // Render podium (top 3)
    if (sorted.length >= 3) {
        podium.style.display = 'flex';
        renderPodiumSlot('podium1', sorted[0], 1, cfg);
        renderPodiumSlot('podium2', sorted[1], 2, cfg);
        renderPodiumSlot('podium3', sorted[2], 3, cfg);
    } else {
        podium.style.display = 'none';
    }

    // Render player list (starting from position 4 if podium shown, else from 1)
    const startIdx = sorted.length >= 3 ? 3 : 0;
    const listPlayers = sorted.slice(startIdx);

    if (sorted.length < 3) {
        // Render all in list mode if <3 players
        playersList.innerHTML = sorted.map((p, i) => createPlayerRow(p, i + 1, cfg, values)).join('');
    } else {
        playersList.innerHTML = listPlayers.map((p, i) => createPlayerRow(p, i + 4, cfg, values)).join('');
    }

    // Animate bars
    setTimeout(() => {
        document.querySelectorAll('.podium-bar__fill').forEach(bar => {
            bar.style.width = bar.dataset.width || '0%';
        });
    }, 200);
}

function renderPodiumSlot(slotId, player, rank, cfg) {
    const slot = document.getElementById(slotId);
    if (!slot || !player) return;

    const value = cfg.getValue(player);
    const formatted = cfg.format(value);

    slot.querySelector('.podium-name').textContent = player.nickname || '—';
    slot.querySelector('.podium-value').textContent = formatted;

    // Bar percentage
    const allValues = topPlayers.map(p => cfg.getValue(p));
    const maxV = cfg.sortDesc ? Math.max(...allValues) : 1;
    let barPct;
    if (cfg.sortDesc) {
        barPct = maxV > 0 ? Math.round((value / maxV) * 100) : 0;
    } else {
        // For veteran mode, rank-based percentage
        barPct = Math.round(((topPlayers.length - rank + 1) / topPlayers.length) * 100);
    }
    const bar = slot.querySelector('.podium-bar__fill');
    bar.dataset.width = barPct + '%';

    // Click to view detail
    slot.onclick = () => showPlayerModal(player);
}

function createPlayerRow(player, rank, cfg, allValues) {
    const value = cfg.getValue(player);
    const formatted = cfg.format(value);

    // WN8 color for rating
    const rating = player.global_rating || 0;
    let wn8Class = 'wn8--red';
    if (rating >= 10000) wn8Class = 'wn8--purple';
    else if (rating >= 8000) wn8Class = 'wn8--blue';
    else if (rating >= 6000) wn8Class = 'wn8--green';
    else if (rating >= 4000) wn8Class = 'wn8--yellow';

    // Sub info based on category
    const stats = player.statistics?.all || {};
    const battles = stats.battles || 0;
    const winrate = battles > 0 ? ((stats.wins / battles) * 100).toFixed(1) : 0;
    let subText = `${battles.toLocaleString()} боёв • ${winrate}% побед`;

    const animDelay = Math.min((rank - 1) * 0.06, 0.6);

    return `
        <div class="player-row" style="animation-delay: ${animDelay}s" onclick="showPlayerModal(topPlayers.find(p => p.account_id === ${player.account_id}))">
            <div class="player-rank ${rank <= 10 ? 'player-rank--top' : ''}">${rank}</div>
            <div class="player-row-avatar">
                <span class="wn8-indicator ${wn8Class}"></span>
                🪖
            </div>
            <div class="player-row-info">
                <div class="player-row-name">${player.nickname || '—'}</div>
                <div class="player-row-sub">${subText}</div>
            </div>
            <div class="player-row-value">
                <div class="player-row-value__main">${formatted}</div>
                <div class="player-row-value__unit">${cfg.unit}</div>
            </div>
            <button class="player-row-remove" onclick="event.stopPropagation(); removePlayer(${player.account_id})" title="Удалить">✕</button>
        </div>
    `;
}

// ============================================================
// PLAYER MODAL
// ============================================================
function showPlayerModal(player) {
    if (!player) return;

    const stats = player.statistics?.all || {};
    const battles = stats.battles || 0;
    const wins = stats.wins || 0;
    const winrate = battles > 0 ? ((wins / battles) * 100).toFixed(1) : 0;
    const avgDmg = battles > 0 ? Math.round(stats.damage_dealt / battles) : 0;
    const avgFrags = battles > 0 ? (stats.frags / battles).toFixed(2) : 0;
    const survRate = battles > 0 ? ((stats.survived_battles / battles) * 100).toFixed(1) : 0;
    const rating = player.global_rating || 0;
    const playtimeH = Math.round(battles * 7 / 60);
    const created = player.created_at
        ? new Date(player.created_at * 1000).toLocaleDateString('ru-RU')
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
                    <h3>${player.nickname || '—'}</h3>
                    <div class="modal-rating" style="color:${ratingColor}">${ratingText} • ${rating.toLocaleString()}</div>
                </div>
            </div>

            <div class="modal-stats">
                <div class="modal-stat">
                    <div class="modal-stat__value">${battles.toLocaleString()}</div>
                    <div class="modal-stat__label">⚔️ Боёв</div>
                </div>
                <div class="modal-stat">
                    <div class="modal-stat__value">${winrate}%</div>
                    <div class="modal-stat__label">🏆 Побед</div>
                </div>
                <div class="modal-stat">
                    <div class="modal-stat__value">${avgDmg.toLocaleString()}</div>
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
                    <div class="modal-stat__value">${playtimeH.toLocaleString()} ч</div>
                    <div class="modal-stat__label">⏱ Время</div>
                </div>
                <div class="modal-stat">
                    <div class="modal-stat__value">${created}</div>
                    <div class="modal-stat__label">📅 Регистрация</div>
                </div>
                <div class="modal-stat">
                    <div class="modal-stat__value">${(stats.max_damage || 0).toLocaleString()}</div>
                    <div class="modal-stat__label">🔥 Макс. урон</div>
                </div>
            </div>

            <div class="modal-actions">
                <button class="modal-btn modal-btn--primary" onclick="openStatsPage('${player.nickname}')">📊 Подробнее</button>
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

    const myId = localStorage.getItem('my_telegram_id');
    let url = `stats.html?nick=${encodeURIComponent(nickname)}`;
    if (myId) url += `&telegram_id=${myId}`;
    window.location.href = url;
}

// ============================================================
// PLAYER MANAGEMENT
// ============================================================
function removePlayer(accountId) {
    topPlayers = topPlayers.filter(p => p.account_id !== accountId);
    saveTopPlayers();
    renderLeaderboard();
    showToast('🗑', 'Игрок удалён из списка');

    if (window.Telegram?.WebApp?.HapticFeedback) {
        window.Telegram.WebApp.HapticFeedback.impactOccurred('light');
    }
}

function saveTopPlayers() {
    localStorage.setItem('top_players_data', JSON.stringify(topPlayers));
}

// ============================================================
// UI HELPERS
// ============================================================
function showLoading(show) {
    const el = document.getElementById('topLoading');
    if (el) el.style.display = show ? 'flex' : 'none';
}

function shakeInput(input) {
    if (!input) return;
    input.style.animation = 'shake 0.4s ease';
    input.style.borderColor = '#e74c3c';
    setTimeout(() => {
        input.style.animation = '';
        input.style.borderColor = '';
    }, 500);

    if (window.Telegram?.WebApp?.HapticFeedback) {
        window.Telegram.WebApp.HapticFeedback.notificationOccurred('error');
    }
}

// Inject shake animation
(function () {
    if (!document.getElementById('shakeStyleTop')) {
        const style = document.createElement('style');
        style.id = 'shakeStyleTop';
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
})();

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

// ============================================================
// EXPOSE
// ============================================================
window.addPlayerToTop = addPlayerToTop;
window.switchCategory = switchCategory;
window.removePlayer = removePlayer;
window.showPlayerModal = showPlayerModal;
window.openStatsPage = openStatsPage;
window.goBack = goBack;
