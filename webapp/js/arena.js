/**
 * Arena JS — PvP Дуэли и Челленджи
 * Мир Танков Webapp
 */

// ============================================================
// STATE
// ============================================================
let selectedBattles = 10;
let currentEnemy = null;     // { nickname, account_id, battles, wr, wn8 }
let currentChallenge = null; // текущий выбранный пресет
let searchTimeout = null;

// Пресеты челленджей
const CHALLENGE_PRESETS = {
    lt_spotting: {
        title: '🔦 Мастер Засвета',
        desc: 'ЛТ-10 — кто насветит больше?',
        condition: 'ЛТ-10 · Засвет',
        tank_class: 'light',
        tank_tier: 10,
        metric: 'spotted',
        default_battles: 10,
    },
    damage_dealer: {
        title: '💥 Дамагер',
        desc: 'Набей больше суммарного урона',
        condition: 'Любые · Урон',
        tank_class: 'any',
        tank_tier: 10,
        metric: 'damage',
        default_battles: 10,
    },
    frag_hunter: {
        title: '🎯 Охотник',
        desc: 'Набей больше фрагов',
        condition: 'Любые · Фраги',
        tank_class: 'any',
        tank_tier: null,
        metric: 'frags',
        default_battles: 10,
    },
    win_streak: {
        title: '🏆 Победитель',
        desc: 'Выиграй больше боёв из N',
        condition: 'Любые · Победы',
        tank_class: 'any',
        tank_tier: null,
        metric: 'wins',
        default_battles: 15,
    },
    xp_grind: {
        title: '⭐ XP Машина',
        desc: 'Набери больше суммарного опыта',
        condition: 'Любые · Опыт',
        tank_class: 'any',
        tank_tier: null,
        metric: 'xp',
        default_battles: 10,
    },
};

// Моковые данные подписчиков (для демо; в проде -> API)
const DEMO_PLAYERS = [
    { nickname: 'xXx_NAGIBATOR_xXx', account_id: 111, battles: '16.2k', wr: '52.8%', wn8: '1840' },
    { nickname: 'Tank_Destroyer_95', account_id: 222, battles: '24.1k', wr: '54.3%', wn8: '2150' },
    { nickname: 'Fors777_2016', account_id: 333, battles: '8.7k', wr: '49.1%', wn8: '1120' },
    { nickname: 'PRO_TANKER', account_id: 444, battles: '52k', wr: '59%', wn8: '3200' },
    { nickname: 'NoOb_KiLLeR_99', account_id: 555, battles: '8.3k', wr: '47%', wn8: '980' },
];

// ============================================================
// TAB SWITCHING
// ============================================================
function switchTab(tabId, btn) {
    document.querySelectorAll('.tab-content').forEach(t => t.classList.remove('tab-content--active'));
    document.querySelectorAll('.arena-tab').forEach(t => t.classList.remove('arena-tab--active'));
    document.getElementById('tab-' + tabId).classList.add('tab-content--active');
    btn.classList.add('arena-tab--active');
}

// ============================================================
// CHALLENGE SELECTION
// ============================================================
function selectChallenge(presetKey) {
    currentChallenge = { key: presetKey, ...CHALLENGE_PRESETS[presetKey] };
    // Переключаем на вкладку поиска
    const searchTab = document.querySelectorAll('.arena-tab')[1];
    switchTab('search', searchTab);
}

// ============================================================
// SEARCH PLAYER
// ============================================================
function onSearchInput(value) {
    clearTimeout(searchTimeout);
    if (value.length < 2) return;
    searchTimeout = setTimeout(() => searchPlayer(), 400);
}

function searchPlayer() {
    const query = document.getElementById('searchInput').value.trim();
    if (query.length < 2) return;

    const resultsDiv = document.getElementById('searchResults');
    resultsDiv.innerHTML = `
        <div class="search-loading">
            <div class="search-loading__spinner"></div>
            <div>Ищем игрока...</div>
        </div>
    `;

    // Демо-поиск (фильтруем по нику)
    setTimeout(() => {
        const filtered = DEMO_PLAYERS.filter(p =>
            p.nickname.toLowerCase().includes(query.toLowerCase())
        );

        // Если ничего не нашли в демо — создаём карточку с введённым ником
        if (filtered.length === 0) {
            filtered.push({
                nickname: query,
                account_id: 99999,
                battles: '—',
                wr: '—',
                wn8: '—',
            });
        }

        renderSearchResults(filtered);
    }, 600);
}

function renderSearchResults(players) {
    const resultsDiv = document.getElementById('searchResults');

    if (!players.length) {
        resultsDiv.innerHTML = `
            <div class="empty-state">
                <div class="empty-state__icon">❌</div>
                <div class="empty-state__text">Игрок не найден</div>
            </div>
        `;
        return;
    }

    let html = '';
    players.forEach((p, i) => {
        const initials = p.nickname.substring(0, 2).toUpperCase();
        html += `
            <div class="player-card" style="animation-delay: ${i * 0.05}s"
                 onclick="openChallenge('${p.nickname}', '${p.battles}', '${p.wr}', '${p.wn8}', ${p.account_id})">
                <div class="player-card__avatar">${initials}</div>
                <div class="player-card__info">
                    <div class="player-card__nick">${p.nickname}</div>
                    <div class="player-card__stats-row">
                        <div class="player-card__stat">Боёв: <span>${p.battles}</span></div>
                        <div class="player-card__stat">WR: <span>${p.wr}</span></div>
                        <div class="player-card__stat">WN8: <span>${p.wn8}</span></div>
                    </div>
                </div>
                <button class="player-card__challenge-btn"
                        onclick="event.stopPropagation(); openChallenge('${p.nickname}', '${p.battles}', '${p.wr}', '${p.wn8}', ${p.account_id})">
                    ⚔️ БОЙ
                </button>
            </div>
        `;
    });

    resultsDiv.innerHTML = html;
}

// ============================================================
// CHALLENGE MODAL
// ============================================================
function openChallenge(nick, battles, wr, wn8, accountId) {
    currentEnemy = { nickname: nick, account_id: accountId, battles, wr, wn8 };

    // Если нет выбранного челленджа — ставим дефолтный
    if (!currentChallenge) {
        currentChallenge = { key: 'lt_spotting', ...CHALLENGE_PRESETS['lt_spotting'] };
    }

    // Заполняем модалку
    document.getElementById('modalEnemyName').textContent = nick;
    document.getElementById('modalEnemyAvatar').textContent = nick.substring(0, 2).toUpperCase();
    document.getElementById('modalChallengeTitle').textContent = currentChallenge.title;
    document.getElementById('modalChallengeDesc').textContent = currentChallenge.desc;

    // Устанавливаем кол-во боёв по умолчанию из пресета
    selectedBattles = currentChallenge.default_battles || 10;
    document.querySelectorAll('.battles-btn').forEach(b => {
        b.classList.toggle('battles-btn--selected', parseInt(b.dataset.val) === selectedBattles);
    });

    updateSummary();
    document.getElementById('challengeModal').classList.add('modal-overlay--open');
}

function closeModal() {
    document.getElementById('challengeModal').classList.remove('modal-overlay--open');
}

// ============================================================
// BATTLES & WAGER
// ============================================================
function selectBattles(btn) {
    document.querySelectorAll('.battles-btn').forEach(b => b.classList.remove('battles-btn--selected'));
    btn.classList.add('battles-btn--selected');
    selectedBattles = parseInt(btn.dataset.val);
    updateSummary();
}

function setWager(val) {
    document.getElementById('wagerAmount').value = val;
    updateSummary();
}

function updateSummary() {
    const wager = parseInt(document.getElementById('wagerAmount').value) || 0;

    if (currentChallenge) {
        document.getElementById('sumChallenge').textContent = currentChallenge.title;
        document.getElementById('sumCondition').textContent = currentChallenge.condition;
    }
    document.getElementById('sumBattles').textContent = selectedBattles;
    document.getElementById('sumWager').textContent = '🧀 ' + wager.toLocaleString();
    document.getElementById('sumPrize').textContent = '🧀 ' + (wager * 2).toLocaleString();
}

// ============================================================
// SEND CHALLENGE
// ============================================================
function sendChallenge() {
    const wager = parseInt(document.getElementById('wagerAmount').value) || 0;
    const balance = (typeof userData !== 'undefined' && userData) ? userData.get('coins') : 0;

    if (wager > balance) {
        showToast('❌ Недостаточно СЫР! Баланс: ' + balance + ' 🧀', 'error');
        return;
    }
    if (wager < 10) {
        showToast('❌ Минимальная ставка: 10 🧀', 'error');
        return;
    }

    closeModal();

    showToast(
        `⚔️ Вызов отправлен!\n${currentEnemy.nickname}\n` +
        `${currentChallenge.title}\n` +
        `${selectedBattles} боёв · Ставка ${wager} 🧀`,
        'success'
    );

    // Сбрасываем выбранный челлендж
    currentChallenge = null;
}

// ============================================================
// INCOMING DUEL MODAL
// ============================================================
function closeIncomingModal() {
    document.getElementById('incomingModal').classList.remove('modal-overlay--open');
}

function acceptIncoming() {
    closeIncomingModal();
    showToast('✅ Вызов принят! Играй и покажи лучший результат!', 'success');
}

function declineIncoming() {
    closeIncomingModal();
    showToast('❌ Вызов отклонён', 'info');
}

// ============================================================
// TOAST NOTIFICATIONS
// ============================================================
function showToast(message, type = 'info') {
    // Удаляем предыдущий тост
    const existing = document.querySelector('.arena-toast');
    if (existing) existing.remove();

    const toast = document.createElement('div');
    toast.className = 'arena-toast arena-toast--' + type;
    toast.textContent = message;
    toast.style.cssText = `
        position: fixed;
        top: 20px;
        left: 50%;
        transform: translateX(-50%);
        padding: 14px 24px;
        border-radius: 14px;
        font-size: 0.8rem;
        font-weight: 600;
        color: white;
        z-index: 999;
        animation: fadeInUp 0.3s ease;
        max-width: 90%;
        text-align: center;
        line-height: 1.4;
        white-space: pre-line;
        backdrop-filter: blur(10px);
        box-shadow: 0 8px 32px rgba(0,0,0,0.4);
        background: ${type === 'success' ? 'rgba(34,197,94,0.9)' :
            type === 'error' ? 'rgba(239,68,68,0.9)' :
                'rgba(200,170,110,0.9)'};
    `;
    document.body.appendChild(toast);
    setTimeout(() => {
        toast.style.animation = 'fadeIn 0.3s ease reverse';
        setTimeout(() => toast.remove(), 300);
    }, 3000);
}

// ============================================================
// UTILITIES
// ============================================================
function buyCheese() {
    window.location.href = 'cheese.html';
}

// Close modals on overlay click
document.getElementById('challengeModal').addEventListener('click', function (e) {
    if (e.target === this) closeModal();
});
document.getElementById('incomingModal').addEventListener('click', function (e) {
    if (e.target === this) closeIncomingModal();
});

// ============================================================
// PARTICLES
// ============================================================
(function () {
    const container = document.getElementById('bgParticles');
    if (!container) return;
    for (let i = 0; i < 20; i++) {
        const p = document.createElement('div');
        p.className = 'bg-particle';
        p.style.left = Math.random() * 100 + '%';
        p.style.animationDuration = (8 + Math.random() * 12) + 's';
        p.style.animationDelay = Math.random() * 10 + 's';
        p.style.width = p.style.height = (1 + Math.random() * 2) + 'px';
        container.appendChild(p);
    }
})();

// ============================================================
// AUTO-FILL FROM FRIENDS PAGE
// ============================================================
(function () {
    const params = new URLSearchParams(window.location.search);
    const opponent = params.get('opponent');
    if (opponent) {
        // Пришли со страницы друзей — сразу открываем модал вызова
        setTimeout(() => {
            openChallenge(opponent, '—', '—', '—', parseInt(params.get('opponent_id')) || 99999);
        }, 300);
    }
})();
