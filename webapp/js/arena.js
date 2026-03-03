/**
 * Arena JS — PvP Челленджи
 * Мир Танков Webapp
 * 
 * Пошаговый конфигуратор: Соперник → Танк → Условие → Бои → Ставка → Отправить
 * Танки загружаются из Lesta Encyclopedia API (уровень 6+)
 * Соперник ищется через Lesta API + проверка регистрации в боте
 */

// ============================================================
// CONFIG & STATE
// ============================================================
const LESTA_API = 'https://api.tanki.su/wot';
const LESTA_APP = 'c984faa7dc529f4cb0139505d5e8043c';
const BOT_API_URL = localStorage.getItem('bot_api_url') || 'http://localhost:8081';
const BOT_USERNAME = 'Mir_tankov_privat_bot';

let myTelegramId = 0;

// Challenge builder state
const challenge = {
    opponent: null,        // { nickname, telegram_id, account_id }
    tank: null,            // { tank_id, name, tier, type, icon }
    condition: null,       // 'damage' | 'spotting' | 'blocked' | 'frags' | 'xp' | 'wins'
    battles: 5,
    wager: 100,
};

// Tanks cache
let allTanks = [];
let filteredTanks = [];
let currentTankType = 'all';
let currentTier = 10;

const CONDITION_LABELS = {
    damage: { icon: '💥', name: 'Урон', desc: 'Средний урон' },
    spotting: { icon: '👁', name: 'Засвет', desc: 'Средний засвет' },
    blocked: { icon: '🛡️', name: 'Блок', desc: 'Заблокированный' },
    frags: { icon: '🎯', name: 'Фраги', desc: 'Среднее убийств' },
    xp: { icon: '⭐', name: 'Опыт', desc: 'Средний опыт' },
    wins: { icon: '🏆', name: 'Победы', desc: '% побед' },
};

const TYPE_LABELS = {
    heavyTank: 'ТТ', mediumTank: 'СТ', lightTank: 'ЛТ', 'AT-SPG': 'ПТ', SPG: 'САУ'
};

const TIER_ROMAN = { 6: 'VI', 7: 'VII', 8: 'VIII', 9: 'IX', 10: 'X' };

// ============================================================
// INIT
// ============================================================
document.addEventListener('DOMContentLoaded', () => {
    identifyMe();
    loadTanks();
    createParticles();

    // Auto-fill from friends page
    const params = new URLSearchParams(window.location.search);
    const opponent = params.get('opponent');
    const opponentId = params.get('opponent_id');
    if (opponent && opponentId) {
        selectOpponent(opponent, parseInt(opponentId), null);
    }
});

function identifyMe() {
    const tg = window.Telegram?.WebApp;
    if (tg?.initDataUnsafe?.user) {
        myTelegramId = tg.initDataUnsafe.user.id;
        localStorage.setItem('my_telegram_id', String(myTelegramId));
    }
    if (!myTelegramId) {
        const urlParams = new URLSearchParams(window.location.search);
        const id = urlParams.get('telegram_id');
        if (id) myTelegramId = parseInt(id);
    }
    if (!myTelegramId) {
        const saved = localStorage.getItem('my_telegram_id');
        if (saved) myTelegramId = parseInt(saved);
    }
}

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
// STEP 1: OPPONENT SEARCH
// ============================================================
async function searchOpponent() {
    const query = document.getElementById('opponentSearch').value.trim();
    if (query.length < 2) { showToast('Введите минимум 2 символа'); return; }

    const results = document.getElementById('opponentResults');
    results.innerHTML = `<div class="search-loading"><div class="search-loading__spinner"></div><br>Ищем «${query}»...</div>`;

    try {
        // Lesta API search
        const url = `${LESTA_API}/account/list/?application_id=${LESTA_APP}&search=${encodeURIComponent(query)}&type=startswith&limit=10`;
        const resp = await fetch(url);
        const data = await resp.json();

        if (data.status !== 'ok' || !data.data?.length) {
            results.innerHTML = `<div class="empty-state"><div class="empty-state__icon">😕</div>
                <div class="empty-state__text">Игрок «${query}» не найден</div></div>`;
            return;
        }

        // Check who's registered in our bot
        const accountIds = data.data.map(p => p.account_id);
        let registered = {};
        try {
            const checkResp = await fetch(`${BOT_API_URL}/api/users/check`, {
                method: 'POST', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ account_ids: accountIds })
            });
            const checkData = await checkResp.json();
            registered = checkData.registered || {};
        } catch (e) { /* API not available */ }

        results.innerHTML = data.data.map((p, i) => {
            const reg = registered[String(p.account_id)];
            const isMe = reg && reg.telegram_id === myTelegramId;

            if (isMe) {
                return `<div class="player-card" style="opacity:0.4;animation-delay:${i * 0.04}s">
                    <div class="player-card__avatar">👤</div>
                    <div class="player-card__info">
                        <div class="player-card__nick">${p.nickname}</div>
                        <div class="player-card__stats-row"><span class="player-card__stat" style="color:#C8AA6E">Это вы</span></div>
                    </div></div>`;
            }

            if (reg) {
                return `<div class="player-card" style="animation-delay:${i * 0.04}s" onclick="selectOpponent('${p.nickname.replace(/'/g, "\\'")}', ${reg.telegram_id}, ${p.account_id})">
                    <div class="player-card__avatar">🪖</div>
                    <div class="player-card__info">
                        <div class="player-card__nick">${p.nickname}</div>
                        <div class="player-card__stats-row">
                            <span class="player-card__stat" style="color:#4ade80">● В приложении</span>
                        </div>
                    </div>
                    <button class="player-card__challenge-btn">⚔️ Вызвать</button></div>`;
            }

            return `<div class="player-card" style="opacity:0.5;animation-delay:${i * 0.04}s">
                <div class="player-card__avatar" style="background:#3A4555">🪖</div>
                <div class="player-card__info">
                    <div class="player-card__nick">${p.nickname}</div>
                    <div class="player-card__stats-row">
                        <span class="player-card__stat">⚫ Не в приложении</span>
                    </div>
                </div>
                <button class="invite-btn" onclick="event.stopPropagation();invitePlayer('${p.nickname}')">📨</button></div>`;
        }).join('');
    } catch (e) {
        results.innerHTML = `<div class="empty-state"><div class="empty-state__icon">⚠️</div>
            <div class="empty-state__text">Ошибка поиска</div></div>`;
    }
}

function selectOpponent(nickname, telegramId, accountId) {
    challenge.opponent = { nickname, telegram_id: telegramId, account_id: accountId };

    document.getElementById('opponentResults').innerHTML = '';
    document.getElementById('opponentSearch').style.display = 'none';
    document.querySelector('#step-opponent .search-box').style.display = 'none';

    const sel = document.getElementById('selectedOpponent');
    sel.style.display = 'flex';
    document.getElementById('selectedOpponentName').textContent = `⚔️ ${nickname}`;
    document.getElementById('selectedOpponentStatus').textContent = '● В приложении';

    // Unlock next step
    unlockStep('step-tank');
    updateSummary();
}

function changeOpponent() {
    challenge.opponent = null;
    document.getElementById('selectedOpponent').style.display = 'none';
    document.querySelector('#step-opponent .search-box').style.display = 'flex';
    document.getElementById('opponentSearch').style.display = '';
    lockStepsFrom('step-tank');
    updateSummary();
}

function invitePlayer(nickname) {
    const url = `https://t.me/${BOT_USERNAME}?start=invite`;
    const tg = window.Telegram?.WebApp;
    if (tg?.openTelegramLink) {
        tg.openTelegramLink(`https://t.me/share/url?url=${encodeURIComponent(url)}&text=${encodeURIComponent(`Привет! Присоединяйся к «Мир Танков Клуб» 🎮🪖`)}`);
    } else {
        navigator.clipboard.writeText(`Присоединяйся к «Мир Танков Клуб»! ${url}`).then(() => showToast('📋 Ссылка скопирована!'));
    }
}

// ============================================================
// STEP 2: TANK SELECTION
// ============================================================
async function loadTanks() {
    try {
        // Load all tanks tier 6-10
        const fields = 'name,tank_id,tier,type,nation,images.contour_icon';
        const url = `${LESTA_API}/encyclopedia/vehicles/?application_id=${LESTA_APP}&tier=6,7,8,9,10&fields=${fields}&limit=100&page_no=`;

        let page = 1;
        let totalPages = 1;
        allTanks = [];

        while (page <= totalPages && page <= 10) {
            const resp = await fetch(url + page);
            const data = await resp.json();
            if (data.status !== 'ok') break;

            totalPages = data.meta.page_total || 1;
            const tanks = Object.values(data.data).map(t => ({
                tank_id: t.tank_id,
                name: t.name,
                tier: t.tier,
                type: t.type,
                nation: t.nation,
                icon: t.images?.contour_icon || '',
            }));
            allTanks.push(...tanks);
            page++;
        }

        // Sort: by tier DESC, then name ASC
        allTanks.sort((a, b) => b.tier - a.tier || a.name.localeCompare(b.name));

        console.log(`[Arena] Loaded ${allTanks.length} tanks`);
        applyTankFilters();
    } catch (e) {
        console.error('Failed to load tanks:', e);
        document.getElementById('tankLoading').textContent = 'Ошибка загрузки танков';
    }
}

function filterTanks(type, btn) {
    currentTankType = type;
    document.querySelectorAll('.class-btn').forEach(b => b.classList.remove('class-btn--active'));
    btn.classList.add('class-btn--active');
    applyTankFilters();
}

function filterTier(tier, btn) {
    currentTier = tier;
    document.querySelectorAll('.tier-btn').forEach(b => b.classList.remove('tier-btn--active'));
    btn.classList.add('tier-btn--active');
    applyTankFilters();
}

function filterTanksByName(query) {
    applyTankFilters(query);
}

function applyTankFilters(nameQuery = '') {
    const q = (nameQuery || document.getElementById('tankSearchInput')?.value || '').toLowerCase();

    filteredTanks = allTanks.filter(t => {
        if (currentTier && t.tier !== currentTier) return false;
        if (currentTankType !== 'all' && t.type !== currentTankType) return false;
        if (q && !t.name.toLowerCase().includes(q)) return false;
        return true;
    });

    renderTankList();
}

function renderTankList() {
    const container = document.getElementById('tankList');

    if (!allTanks.length) {
        container.innerHTML = `<div class="tank-loading">Загружаем танки...</div>`;
        return;
    }

    if (!filteredTanks.length) {
        container.innerHTML = `<div class="tank-loading">Нет танков с такими фильтрами</div>`;
        return;
    }

    // Show max 30 tanks to keep performance
    const toShow = filteredTanks.slice(0, 30);

    container.innerHTML = toShow.map((t, i) => `
        <div class="tank-item" onclick="selectTank(${t.tank_id})" style="animation-delay:${i * 0.02}s">
            <img class="tank-item__icon" src="${t.icon}" alt="" onerror="this.style.display='none'">
            <div class="tank-item__info">
                <div class="tank-item__name">${t.name}</div>
                <div class="tank-item__meta">${TIER_ROMAN[t.tier]} • ${TYPE_LABELS[t.type] || t.type}</div>
            </div>
        </div>
    `).join('') + (filteredTanks.length > 30 ? `<div style="text-align:center;padding:8px;color:#5A6577;font-size:0.7rem">${filteredTanks.length - 30} ещё… Используй поиск ↑</div>` : '');
}

function selectTank(tankId) {
    const tank = allTanks.find(t => t.tank_id === tankId);
    if (!tank) return;

    challenge.tank = tank;

    document.getElementById('tankFilters').style.display = 'none';
    document.getElementById('tankList').style.display = 'none';

    const sel = document.getElementById('selectedTank');
    sel.style.display = 'flex';
    document.getElementById('selectedTankIcon').src = tank.icon;
    document.getElementById('selectedTankName').textContent = `${tank.name} (${TIER_ROMAN[tank.tier]} ${TYPE_LABELS[tank.type] || ''})`;

    unlockStep('step-condition');
    updateSummary();
}

function changeTank() {
    challenge.tank = null;
    document.getElementById('selectedTank').style.display = 'none';
    document.getElementById('tankFilters').style.display = '';
    document.getElementById('tankList').style.display = '';
    lockStepsFrom('step-condition');
    updateSummary();
}

// ============================================================
// STEP 3: CONDITION
// ============================================================
function selectCondition(cond, btn) {
    challenge.condition = cond;
    document.querySelectorAll('.condition-card').forEach(c => c.classList.remove('condition-card--selected'));
    btn.classList.add('condition-card--selected');

    unlockStep('step-battles');
    updateSummary();
}

// ============================================================
// STEP 4: BATTLES
// ============================================================
function selectBattles(count, btn) {
    challenge.battles = count;
    document.querySelectorAll('.battles-btn').forEach(b => b.classList.remove('battles-btn--selected'));
    btn.classList.add('battles-btn--selected');

    unlockStep('step-wager');
    updateSummary();
}

// ============================================================
// STEP 5: WAGER
// ============================================================
function setWager(val) {
    document.getElementById('wagerAmount').value = val;
    challenge.wager = val;
    updateSummary();
}

// ============================================================
// STEP UNLOCKING
// ============================================================
const STEPS = ['step-opponent', 'step-tank', 'step-condition', 'step-battles', 'step-wager'];

function unlockStep(stepId) {
    const el = document.getElementById(stepId);
    if (el) {
        el.classList.remove('create-step--locked');
        // Smooth scroll to step
        setTimeout(() => el.scrollIntoView({ behavior: 'smooth', block: 'center' }), 200);
    }
}

function lockStepsFrom(stepId) {
    const idx = STEPS.indexOf(stepId);
    for (let i = idx; i < STEPS.length; i++) {
        document.getElementById(STEPS[i])?.classList.add('create-step--locked');
    }
    document.getElementById('challengeSummaryFull').style.display = 'none';
}

// ============================================================
// SUMMARY
// ============================================================
function updateSummary() {
    challenge.wager = parseInt(document.getElementById('wagerAmount')?.value) || 100;

    const ready = challenge.opponent && challenge.tank && challenge.condition;
    const summaryEl = document.getElementById('challengeSummaryFull');

    if (!ready) {
        summaryEl.style.display = 'none';
        return;
    }

    summaryEl.style.display = 'block';

    document.getElementById('sumOpponent').textContent = challenge.opponent.nickname;
    document.getElementById('sumTank').textContent = challenge.tank.name;
    document.getElementById('sumCondition').textContent = `${CONDITION_LABELS[challenge.condition].icon} ${CONDITION_LABELS[challenge.condition].name}`;
    document.getElementById('sumBattles').textContent = challenge.battles;
    document.getElementById('sumWager').textContent = `🧀 ${challenge.wager}`;
    document.getElementById('sumPrize').textContent = `🧀 ${challenge.wager * 2}`;

    setTimeout(() => summaryEl.scrollIntoView({ behavior: 'smooth', block: 'center' }), 200);
}

// Watch wager input changes
document.addEventListener('DOMContentLoaded', () => {
    const w = document.getElementById('wagerAmount');
    if (w) w.addEventListener('input', updateSummary);
});

// ============================================================
// SEND CHALLENGE
// ============================================================
async function sendChallenge() {
    if (!challenge.opponent || !challenge.tank || !challenge.condition) {
        showToast('Заполните все шаги!');
        return;
    }

    if (!myTelegramId) {
        showToast('⚠️ Откройте через Telegram-бот');
        return;
    }

    const btn = document.getElementById('sendChallengeBtn');
    btn.disabled = true;
    btn.textContent = '⏳ Отправляем...';

    try {
        const resp = await fetch(`${BOT_API_URL}/api/challenges/create`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                from_telegram_id: myTelegramId,
                to_telegram_id: challenge.opponent.telegram_id,
                tank_id: challenge.tank.tank_id,
                tank_name: challenge.tank.name,
                condition: challenge.condition,
                battles: challenge.battles,
                wager: challenge.wager,
            }),
        });

        const data = await resp.json();

        if (data.success) {
            showToast(`⚔️ Вызов отправлен ${challenge.opponent.nickname}!`, 'success');
            btn.textContent = '✅ Отправлено!';
            btn.style.background = 'linear-gradient(135deg, #22c55e, #16a34a)';

            // Telegram notification
            const tg = window.Telegram?.WebApp;
            if (tg?.HapticFeedback) tg.HapticFeedback.notificationOccurred('success');

            setTimeout(() => {
                switchTab('active', document.querySelectorAll('.arena-tab')[1]);
                resetChallengeBuilder();
            }, 1500);
        } else {
            showToast(`❌ ${data.error || 'Ошибка'}`, 'error');
            btn.disabled = false;
            btn.textContent = '⚔️ ОТПРАВИТЬ ВЫЗОВ';
        }
    } catch (e) {
        showToast('❌ Нет подключения к серверу', 'error');
        btn.disabled = false;
        btn.textContent = '⚔️ ОТПРАВИТЬ ВЫЗОВ';
    }
}

function resetChallengeBuilder() {
    challenge.opponent = null;
    challenge.tank = null;
    challenge.condition = null;
    challenge.battles = 5;
    challenge.wager = 100;

    document.getElementById('selectedOpponent').style.display = 'none';
    document.querySelector('#step-opponent .search-box').style.display = 'flex';
    document.getElementById('opponentSearch').style.display = '';
    document.getElementById('opponentSearch').value = '';
    document.getElementById('opponentResults').innerHTML = '';

    changeTank();
    document.querySelectorAll('.condition-card').forEach(c => c.classList.remove('condition-card--selected'));
    document.getElementById('wagerAmount').value = 100;

    lockStepsFrom('step-tank');
    document.getElementById('challengeSummaryFull').style.display = 'none';

    const btn = document.getElementById('sendChallengeBtn');
    btn.disabled = false;
    btn.textContent = '⚔️ ОТПРАВИТЬ ВЫЗОВ';
    btn.style.background = '';
}

// ============================================================
// TOAST
// ============================================================
function showToast(message, type = 'info') {
    const existing = document.querySelector('.arena-toast');
    if (existing) existing.remove();

    const colors = {
        info: 'rgba(200,170,110,0.9)',
        success: 'rgba(34,197,94,0.9)',
        error: 'rgba(239,68,68,0.9)',
    };

    const toast = document.createElement('div');
    toast.className = 'arena-toast';
    toast.textContent = message;
    toast.style.cssText = `
        position:fixed;top:20px;left:50%;transform:translateX(-50%);
        padding:14px 24px;border-radius:14px;font-size:0.8rem;font-weight:600;color:white;z-index:999;
        animation:fadeInUp 0.3s ease;max-width:90%;text-align:center;
        backdrop-filter:blur(10px);box-shadow:0 8px 32px rgba(0,0,0,0.4);
        background:${colors[type] || colors.info};
    `;
    document.body.appendChild(toast);
    setTimeout(() => toast.remove(), 3000);
}

// ============================================================
// UTILITIES
// ============================================================
function buyCheese() {
    window.location.href = 'cheese.html';
}

// Background particles
function createParticles() {
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
}

// Expose functions
window.switchTab = switchTab;
window.searchOpponent = searchOpponent;
window.selectOpponent = selectOpponent;
window.changeOpponent = changeOpponent;
window.invitePlayer = invitePlayer;
window.filterTanks = filterTanks;
window.filterTier = filterTier;
window.filterTanksByName = filterTanksByName;
window.selectTank = selectTank;
window.changeTank = changeTank;
window.selectCondition = selectCondition;
window.selectBattles = selectBattles;
window.setWager = setWager;
window.sendChallenge = sendChallenge;
window.buyCheese = buyCheese;
window.showToast = showToast;
