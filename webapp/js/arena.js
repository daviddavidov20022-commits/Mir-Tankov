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
let isAdmin = false;

// Challenge builder state
const challenge = {
    opponent: null,        // { nickname, telegram_id, account_id }
    tankTier: 10,          // 6-10
    tankType: 'any',       // 'any' | 'heavyTank' | 'mediumTank' | 'lightTank' | 'AT-SPG' | 'SPG'
    tank: null,            // specific tank { tank_id, name, tier, type, icon } — or null for class mode
    condition: null,       // 'damage' | 'spotting' | 'blocked' | 'frags' | 'xp' | 'wins'
    battles: 5,
    wager: 100,
};

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
    loadMyProfile();
    createParticles();

    // Auto-fill from friends page
    const params = new URLSearchParams(window.location.search);
    const opponent = params.get('opponent');
    const opponentId = params.get('opponent_id');
    if (opponent && opponentId) {
        selectOpponent(opponent, parseInt(opponentId), null);
    }
});

async function loadMyProfile() {
    const badge = document.getElementById('accountBadge');
    if (!myTelegramId) {
        badge.textContent = '⚠️ ID не определён';
        return;
    }
    badge.textContent = `👤 ID: ${myTelegramId}`;
    try {
        const resp = await fetch(`${BOT_API_URL}/api/me?telegram_id=${myTelegramId}`);
        const data = await resp.json();
        if (data.wot_nickname) {
            badge.textContent = `👤 ${data.wot_nickname}`;
            document.title = `Арена — ${data.wot_nickname}`;
        } else if (data.first_name) {
            badge.textContent = `👤 ${data.first_name}`;
        }
        // Admin check
        if (data.is_admin) {
            isAdmin = true;
            const adminTab = document.getElementById('adminTab');
            if (adminTab) adminTab.style.display = '';
        }
        // Cheese balance: API or localStorage fallback
        const cheeseEl = document.getElementById('cheeseBalance');
        if (data.cheese && data.cheese > 0) {
            cheeseEl.textContent = data.cheese.toLocaleString('ru');
        } else {
            // Fallback: take from localStorage (same as index.html)
            try {
                const localData = JSON.parse(localStorage.getItem('wot_user_data') || '{}');
                if (localData.coins) cheeseEl.textContent = localData.coins.toLocaleString('ru');
            } catch (e2) { }
        }
    } catch (e) {
        // API offline — take from localStorage
        try {
            const localData = JSON.parse(localStorage.getItem('wot_user_data') || '{}');
            const cheeseEl = document.getElementById('cheeseBalance');
            if (localData.coins) cheeseEl.textContent = localData.coins.toLocaleString('ru');
        } catch (e2) { }
    }
}


function identifyMe() {
    // 1. URL param — absolute priority (for testing with ?telegram_id=xxx)
    const urlParams = new URLSearchParams(window.location.search);
    const urlId = urlParams.get('telegram_id');
    if (urlId) {
        myTelegramId = parseInt(urlId);
        // Don't save to localStorage — prevents cross-tab overwriting
        return;
    }

    // 2. Telegram WebApp
    const tg = window.Telegram?.WebApp;
    if (tg?.initDataUnsafe?.user) {
        myTelegramId = tg.initDataUnsafe.user.id;
        localStorage.setItem('my_telegram_id', String(myTelegramId));
        return;
    }

    // 3. localStorage fallback (only when no URL param)
    const saved = localStorage.getItem('my_telegram_id');
    if (saved) myTelegramId = parseInt(saved);
}

// ============================================================
// TAB SWITCHING
// ============================================================
function switchTab(tabId, btn) {
    document.querySelectorAll('.tab-content').forEach(t => t.classList.remove('tab-content--active'));
    document.querySelectorAll('.arena-tab').forEach(t => t.classList.remove('arena-tab--active'));
    document.getElementById('tab-' + tabId).classList.add('tab-content--active');
    btn.classList.add('arena-tab--active');

    if (tabId === 'active') loadChallenges();
    if (tabId === 'history') loadChallenges();
    if (tabId === 'admin') loadAdminUsers();
}

// ============================================================
// LOAD CHALLENGES
// ============================================================
const COND_LABELS_SHORT = {
    damage: '💥 Урон', spotting: '👁 Засвет', blocked: '🛡 Блок',
    frags: '🎯 Фраги', xp: '⭐ Опыт', wins: '🏆 Победы'
};

async function loadChallenges() {
    if (!myTelegramId) return;

    try {
        const resp = await fetch(`${BOT_API_URL}/api/challenges?telegram_id=${myTelegramId}`);
        const data = await resp.json();
        if (!data.challenges) return;

        const incoming = data.challenges.filter(c => c.is_incoming && c.status === 'pending');
        const active = data.challenges.filter(c => c.status === 'active');
        const history = data.challenges.filter(c => c.status === 'declined' || c.status === 'finished');

        // Incoming
        const inEl = document.getElementById('incomingDuels');
        if (incoming.length) {
            inEl.innerHTML = incoming.map(c => `
                <div class="duel-card" style="animation:fadeInUp 0.3s ease">
                    <div style="display:flex;justify-content:space-between;align-items:start;margin-bottom:8px">
                        <div>
                            <div style="font-family:'Russo One',sans-serif;font-size:0.8rem;color:#E8E6E3">
                                ⚔️ ${c.opponent_name}
                            </div>
                            <div style="font-size:0.65rem;color:#5A6577;margin-top:2px">
                                ${c.tank_name} · ${COND_LABELS_SHORT[c.condition] || c.condition}
                            </div>
                        </div>
                        <div style="text-align:right">
                            <div style="font-size:0.75rem;color:#C8AA6E;font-weight:700">🧀 ${c.wager}</div>
                            <div style="font-size:0.55rem;color:#5A6577">${c.battles} боёв</div>
                        </div>
                    </div>
                    <div style="display:flex;gap:8px">
                        <button onclick="acceptChallenge(${c.id})" style="flex:1;padding:10px;border-radius:10px;border:none;background:linear-gradient(135deg,#22c55e,#16a34a);color:white;font-weight:700;font-size:0.75rem;cursor:pointer">
                            ✅ Принять
                        </button>
                        <button onclick="declineChallenge(${c.id})" style="flex:1;padding:10px;border-radius:10px;border:1px solid rgba(239,68,68,0.3);background:transparent;color:#ef4444;font-weight:700;font-size:0.75rem;cursor:pointer">
                            ❌ Отклонить
                        </button>
                    </div>
                </div>
            `).join('');
        } else {
            inEl.innerHTML = '<div style="text-align:center;color:#5A6577;font-size:0.7rem;padding:12px">Нет входящих вызовов</div>';
        }

        // Active
        const actEl = document.getElementById('activeDuels');
        const noActive = document.getElementById('noActiveDuels');
        if (active.length) {
            noActive.style.display = 'none';
            actEl.innerHTML = active.map(c => `
                <div class="duel-card" style="animation:fadeInUp 0.3s ease;border-color:rgba(34,197,94,0.2)">
                    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:10px">
                        <div>
                            <div style="font-family:'Russo One',sans-serif;font-size:0.8rem;color:#E8E6E3">
                                🔥 vs ${c.opponent_name}
                            </div>
                            <div style="font-size:0.65rem;color:#5A6577;margin-top:2px">
                                ${c.tank_name} · ${COND_LABELS_SHORT[c.condition] || c.condition} · ${c.battles} боёв
                            </div>
                        </div>
                        <div style="text-align:right">
                            <div style="font-size:0.85rem;color:#4ade80;font-weight:700">🏆 🧀 ${c.wager * 2}</div>
                            <div style="font-size:0.55rem;color:#5A6577">Приз</div>
                        </div>
                    </div>
                    <div id="results-${c.id}">
                        <div style="text-align:center;color:#5A6577;padding:8px;font-size:0.7rem">⏳ Загрузка...</div>
                    </div>
                </div>
            `).join('');
            // Auto-load results for all active challenges
            active.forEach(c => checkChallengeResults(c.id));
            // Auto-refresh every 30 seconds
            clearInterval(window._challengeRefresh);
            window._challengeRefresh = setInterval(() => {
                active.forEach(c => checkChallengeResults(c.id));
            }, 30000);
        } else {
            noActive.style.display = '';
            clearInterval(window._challengeRefresh);
            actEl.innerHTML = '';
        }

        // History — show finished with analytics
        const hEl = document.getElementById('historyList');
        const finished = data.challenges.filter(c => c.status === 'declined' || c.status === 'finished');
        if (finished.length) {
            hEl.innerHTML = finished.map(c => {
                const icon = c.status === 'declined' ? '❌' : (c.winner_telegram_id === myTelegramId ? '🏆' : '😞');
                const label = c.status === 'declined' ? 'Отклонён' : (c.winner_telegram_id === myTelegramId ? 'Победа' : 'Поражение');
                const color = c.status === 'declined' ? '#5A6577' : (c.winner_telegram_id === myTelegramId ? '#4ade80' : '#ef4444');

                let analyticsHtml = '';
                if (c.status === 'finished' && c.from_end_stats && c.to_end_stats) {
                    try {
                        const fd = typeof c.from_end_stats === 'string' ? JSON.parse(c.from_end_stats) : c.from_end_stats;
                        const td = typeof c.to_end_stats === 'string' ? JSON.parse(c.to_end_stats) : c.to_end_stats;
                        analyticsHtml = renderAnalytics(fd, td, c);
                    } catch (e) { }
                }

                return `
                    <div class="duel-card" style="border-color:${color}30">
                        <div style="display:flex;justify-content:space-between;align-items:center">
                            <div>
                                <div style="font-size:0.75rem;color:#E8E6E3">${icon} vs ${c.opponent_name}</div>
                                <div style="font-size:0.6rem;color:#5A6577">${c.tank_name} · ${c.battles} боёв</div>
                            </div>
                            <div style="font-size:0.7rem;color:${color};font-weight:700">${label}</div>
                        </div>
                        ${analyticsHtml}
                    </div>
                `;
            }).join('');
        }
    } catch (e) {
        console.warn('Load challenges failed:', e);
    }
}

const COND_DISPLAY = {
    damage: { icon: '💥', name: 'Урон', key: 'damage', unit: '' },
    spotting: { icon: '👁', name: 'Засвет', key: 'spotted', unit: '' },
    blocked: { icon: '🛡', name: 'Заблокировано', key: 'blocked', unit: '' },
    frags: { icon: '🎯', name: 'Фраги', key: 'frags', unit: '' },
    xp: { icon: '⭐', name: 'Опыт', key: 'xp', unit: '' },
    wins: { icon: '🏆', name: 'Победы', key: 'wins', unit: '' },
};

function renderAnalytics(fd, td, ch) {
    const cond = COND_DISPLAY[ch.condition] || COND_DISPLAY.damage;
    const v1 = fd[cond.key] ?? 0;
    const v2 = td[cond.key] ?? 0;
    const c1 = v1 >= v2 ? '#4ade80' : '#ef4444';
    const c2 = v2 >= v1 ? '#4ade80' : '#ef4444';
    const name1 = ch.is_incoming ? ch.opponent_name : 'Я';
    const name2 = ch.is_incoming ? 'Я' : ch.opponent_name;

    return `
        <div style="margin-top:12px;padding-top:12px;border-top:1px solid rgba(255,255,255,0.06)">
            <div style="text-align:center;font-size:0.6rem;color:#5A6577;margin-bottom:8px">
                ${cond.icon} ${cond.name} · ${ch.tank_name} · 🧀 ${ch.wager}
            </div>
            <div style="display:flex;gap:8px;align-items:center">
                <div style="flex:1;text-align:center;padding:10px;border-radius:10px;background:rgba(0,0,0,0.2)">
                    <div style="font-size:0.6rem;color:#8a94a6;margin-bottom:4px">${name1}</div>
                    <div style="font-size:1.2rem;font-family:'Russo One',sans-serif;color:${c1}">${v1}${cond.unit}</div>
                    <div style="font-size:0.55rem;color:#5A6577">${fd.battles_played} боёв</div>
                </div>
                <div style="font-size:0.9rem;color:#5A6577">⚔️</div>
                <div style="flex:1;text-align:center;padding:10px;border-radius:10px;background:rgba(0,0,0,0.2)">
                    <div style="font-size:0.6rem;color:#8a94a6;margin-bottom:4px">${name2}</div>
                    <div style="font-size:1.2rem;font-family:'Russo One',sans-serif;color:${c2}">${v2}${cond.unit}</div>
                    <div style="font-size:0.55rem;color:#5A6577">${td.battles_played} боёв</div>
                </div>
            </div>
        </div>`;
}

async function checkChallengeResults(id) {
    const el = document.getElementById(`results-${id}`);
    el.style.display = '';
    el.innerHTML = '<div style="text-align:center;color:#5A6577;padding:14px;font-size:0.8rem">⏳ Загружаем результаты...</div>';

    try {
        const resp = await fetch(`${BOT_API_URL}/api/challenges/check`, {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ challenge_id: id, telegram_id: myTelegramId })
        });
        const data = await resp.json();

        if (data.error) {
            el.innerHTML = `<div style="text-align:center;color:#ef4444;padding:14px;font-size:0.8rem">❌ ${data.error}</div>`;
            return;
        }

        if (data.snapshot_saved) {
            el.innerHTML = `<div style="text-align:center;color:#4ade80;padding:14px;font-size:0.8rem">📸 ${data.message}</div>`;
            return;
        }

        const fp = data.from_player;
        const tp = data.to_player;
        const ch = data.challenge;
        const cond = COND_DISPLAY[ch.condition] || COND_DISPLAY.damage;

        const v1 = fp.delta[cond.key] ?? 0;
        const v2 = tp.delta[cond.key] ?? 0;
        const c1 = v1 >= v2 ? '#4ade80' : '#ef4444';
        const c2 = v2 >= v1 ? '#4ade80' : '#ef4444';

        let statusHtml = '';
        if (data.both_ready && data.winner) {
            const isWinner = data.winner.telegram_id === myTelegramId;
            statusHtml = `
                <div style="text-align:center;padding:16px;margin-top:12px;border-radius:12px;
                    background:${isWinner ? 'rgba(34,197,94,0.08)' : 'rgba(239,68,68,0.08)'}; 
                    border:1px solid ${isWinner ? 'rgba(34,197,94,0.2)' : 'rgba(239,68,68,0.2)'}">
                    <div style="font-size:1.5rem">${isWinner ? '🏆' : '😞'}</div>
                    <div style="font-size:1rem;font-family:'Russo One',sans-serif;color:${isWinner ? '#4ade80' : '#ef4444'};margin-top:6px">
                        ${isWinner ? 'ПОБЕДА!' : 'ПОРАЖЕНИЕ'}
                    </div>
                    <div style="font-size:0.85rem;color:#C8AA6E;margin-top:6px">
                        ${data.winner.nickname} получает 🧀 ${ch.wager * 2}
                    </div>
                </div>`;
            setTimeout(loadChallenges, 2000);
        } else {
            statusHtml = `
                <div style="text-align:center;margin-top:10px;padding:10px;border-radius:10px;background:rgba(200,170,110,0.05)">
                    <div style="font-size:0.75rem;color:#C8AA6E;margin-bottom:4px">Прогресс боёв</div>
                    <div style="display:flex;gap:12px;justify-content:center;font-size:0.75rem">
                        <span style="color:${fp.ready ? '#4ade80' : '#8a94a6'}">${fp.nickname}: ${fp.delta.battles_played}/${ch.battles} ${fp.ready ? '✅' : '⏳'}</span>
                        <span style="color:${tp.ready ? '#4ade80' : '#8a94a6'}">${tp.nickname}: ${tp.delta.battles_played}/${ch.battles} ${tp.ready ? '✅' : '⏳'}</span>
                    </div>
                </div>`;
        }

        // OBS overlay link (admin only)
        const overlayBtn = isAdmin ? `
            <div style="margin-top:10px;display:flex;gap:8px;justify-content:center">
                <button onclick="copyOverlayLink(${id})" style="padding:8px 16px;border-radius:8px;border:1px solid rgba(200,170,110,0.2);
                    background:rgba(200,170,110,0.05);color:#C8AA6E;font-size:0.7rem;font-weight:600;cursor:pointer">
                    📋 Ссылка OBS
                </button>
                <button onclick="cancelChallenge(${id})" style="padding:8px 16px;border-radius:8px;border:1px solid rgba(239,68,68,0.2);
                    background:rgba(239,68,68,0.05);color:#ef4444;font-size:0.7rem;font-weight:600;cursor:pointer">
                    ❌ Отменить
                </button>
            </div>` : '';

        // Build per-battle history
        const history = data.battle_history || [];
        const condKey = cond.key; // damage, spotted, etc.
        let historyHtml = '';
        if (history.length > 0) {
            // Group by player
            const fromBattles = history.filter(b => b.player === 'from');
            const toBattles = history.filter(b => b.player === 'to');

            const renderBattleRows = (battles, nickname) => battles.map(b => `
                <div style="display:flex;justify-content:space-between;align-items:center;padding:6px 10px;
                    border-bottom:1px solid rgba(255,255,255,0.03);font-size:0.65rem">
                    <span style="color:#5A6577">Бой #${b.battle_num}</span>
                    <span style="color:#E8E6E3;font-weight:600">${cond.icon} ${b[condKey] ?? 0}</span>
                    <span style="color:${b.won ? '#4ade80' : '#ef4444'}">${b.won ? '🏆 Победа' : '💀 Поражение'}</span>
                </div>
            `).join('');

            historyHtml = `
                <div style="margin-top:10px">
                    <div onclick="toggleBattleHistory(${id})" style="cursor:pointer;text-align:center;
                        font-size:0.65rem;color:#C8AA6E;padding:6px;border-radius:8px;
                        background:rgba(200,170,110,0.05);border:1px solid rgba(200,170,110,0.1)">
                        📋 Побойная разбивка <span id="historyArrow-${id}">▼</span>
                    </div>
                    <div id="battleHistory-${id}" style="display:none;margin-top:8px">
                        ${fromBattles.length ? `
                            <div style="font-size:0.6rem;color:#C8AA6E;padding:4px 0;font-weight:700">${fp.nickname}</div>
                            ${renderBattleRows(fromBattles, fp.nickname)}
                        ` : ''}
                        ${toBattles.length ? `
                            <div style="font-size:0.6rem;color:#C8AA6E;padding:4px 0;margin-top:6px;font-weight:700">${tp.nickname}</div>
                            ${renderBattleRows(toBattles, tp.nickname)}
                        ` : ''}
                    </div>
                </div>`;
        }

        el.innerHTML = `
            <div style="margin-top:12px;padding-top:12px;border-top:1px solid rgba(255,255,255,0.06)">
                <div style="text-align:center;margin-bottom:10px">
                    <div style="font-size:0.65rem;color:#5A6577">${ch.tank_name} · ${cond.icon} ${cond.name} · 🧀 ${ch.wager}</div>
                </div>
                <div style="display:flex;gap:10px;align-items:center">
                    <div style="flex:1;text-align:center;padding:12px;border-radius:12px;background:rgba(0,0,0,0.3)">
                        <div style="font-size:0.7rem;color:#8a94a6;margin-bottom:6px">${fp.nickname}</div>
                        <div style="font-size:1.4rem;font-family:'Russo One',sans-serif;color:${c1}">${v1}${cond.unit}</div>
                        <div style="font-size:0.6rem;color:#5A6577;margin-top:4px">${fp.delta.battles_played}/${ch.battles} боёв</div>
                    </div>
                    <div style="font-size:1.2rem;color:#5A6577">⚔️</div>
                    <div style="flex:1;text-align:center;padding:12px;border-radius:12px;background:rgba(0,0,0,0.3)">
                        <div style="font-size:0.7rem;color:#8a94a6;margin-bottom:6px">${tp.nickname}</div>
                        <div style="font-size:1.4rem;font-family:'Russo One',sans-serif;color:${c2}">${v2}${cond.unit}</div>
                        <div style="font-size:0.6rem;color:#5A6577;margin-top:4px">${tp.delta.battles_played}/${ch.battles} боёв</div>
                    </div>
                </div>
                ${historyHtml}
                ${statusHtml}
                ${overlayBtn}
            </div>`;
    } catch (e) {
        el.innerHTML = `<div style="text-align:center;color:#ef4444;padding:14px;font-size:0.8rem">❌ Нет подключения</div>`;
    }
}

function copyOverlayLink(challengeId) {
    const url = `${window.location.origin}/webapp/overlay.html?id=${challengeId}`;
    navigator.clipboard.writeText(url).then(() => {
        showToast('📋 Ссылка для OBS скопирована!', 'success');
    }).catch(() => {
        prompt('Скопируйте ссылку:', url);
    });
}

async function acceptChallenge(id) {
    try {
        const resp = await fetch(`${BOT_API_URL}/api/challenges/accept`, {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ challenge_id: id, telegram_id: myTelegramId })
        });
        const data = await resp.json();
        if (data.success) {
            showToast('✅ Челлендж принят! Удачи!', 'success');
            loadChallenges();
        } else {
            showToast(`❌ ${data.error}`, 'error');
        }
    } catch (e) { showToast('❌ Нет подключения к серверу', 'error'); }
}

async function declineChallenge(id) {
    try {
        const resp = await fetch(`${BOT_API_URL}/api/challenges/decline`, {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ challenge_id: id, telegram_id: myTelegramId })
        });
        const data = await resp.json();
        if (data.success) {
            showToast('❌ Вызов отклонён', 'info');
            loadChallenges();
        } else {
            showToast(`❌ ${data.error}`, 'error');
        }
    } catch (e) { showToast('❌ Нет подключения к серверу', 'error'); }
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
        const nicknames = data.data.map(p => p.nickname);
        let registered = {};
        try {
            const checkResp = await fetch(`${BOT_API_URL}/api/users/check`, {
                method: 'POST', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ account_ids: accountIds, nicknames: nicknames })
            });
            const checkData = await checkResp.json();
            registered = checkData.registered || {};
        } catch (e) { console.warn('API check failed:', e); }

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
// STEP 2: TANK MODE TOGGLE + SELECTION
// ============================================================
let tankMode = 'class'; // 'class' | 'specific'
let allTanks = [];
let filteredTanks = [];
let filterType = 'all';
let filterTierVal = 10;

const CLASS_ICONS = {
    'any': '🔄', 'heavyTank': '🛡️', 'mediumTank': '⚙️',
    'lightTank': '🏎️', 'AT-SPG': '🎯', 'SPG': '💣'
};
const CLASS_NAMES = {
    'any': 'Любой', 'heavyTank': 'ТТ', 'mediumTank': 'СТ',
    'lightTank': 'ЛТ', 'AT-SPG': 'ПТ', 'SPG': 'САУ'
};

function setTankMode(mode) {
    tankMode = mode;
    document.getElementById('modeClass').classList.toggle('mode-btn--active', mode === 'class');
    document.getElementById('modeSpecific').classList.toggle('mode-btn--active', mode === 'specific');
    document.getElementById('tankModeClass').style.display = mode === 'class' ? '' : 'none';
    document.getElementById('tankModeSpecific').style.display = mode === 'specific' ? '' : 'none';

    if (mode === 'specific' && !allTanks.length) {
        loadTanks();
    }

    // Reset specific tank if switching to class mode
    if (mode === 'class') {
        challenge.tank = null;
        document.getElementById('selectedTank').style.display = 'none';
    }
    updateSummary();
}

// --- Class + Tier mode ---
function selectClass(type, btn) {
    challenge.tankType = type;
    document.querySelectorAll('#tankModeClass .class-btn').forEach(b => b.classList.remove('class-btn--active'));
    btn.classList.add('class-btn--active');
    updateTankSummary();
    unlockStep('step-condition');
    updateSummary();
}

function selectTier(tier, btn) {
    challenge.tankTier = tier;
    document.querySelectorAll('#tankModeClass .tier-btn').forEach(b => b.classList.remove('tier-btn--active'));
    btn.classList.add('tier-btn--active');
    updateTankSummary();
    unlockStep('step-condition');
    updateSummary();
}

function updateTankSummary() {
    const el = document.getElementById('selectedTankSummary');
    if (!el) return;
    const classIcon = CLASS_ICONS[challenge.tankType] || '🔄';
    const className = CLASS_NAMES[challenge.tankType] || 'Любой';
    const tierName = TIER_ROMAN[challenge.tankTier] || challenge.tankTier;
    el.textContent = `${classIcon} ${className} · ${tierName} уровень`;
}

// --- Specific tank mode ---
async function loadTanks() {
    try {
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

        allTanks.sort((a, b) => b.tier - a.tier || a.name.localeCompare(b.name));
        console.log(`[Arena] Loaded ${allTanks.length} tanks`);
        applyTankFilters();
    } catch (e) {
        console.error('Failed to load tanks:', e);
        const el = document.getElementById('tankLoading');
        if (el) el.textContent = 'Ошибка загрузки танков';
    }
}

function filterTanks(type, btn) {
    filterType = type;
    document.querySelectorAll('.class-btn2').forEach(b => b.classList.remove('class-btn2--active'));
    btn.classList.add('class-btn2--active');
    applyTankFilters();
}

function filterTier(tier, btn) {
    filterTierVal = tier;
    document.querySelectorAll('.tier-btn2').forEach(b => b.classList.remove('tier-btn2--active'));
    btn.classList.add('tier-btn2--active');
    applyTankFilters();
}

function filterTanksByName(query) { applyTankFilters(query); }

function applyTankFilters(nameQuery = '') {
    const q = (nameQuery || document.getElementById('tankSearchInput')?.value || '').toLowerCase();
    filteredTanks = allTanks.filter(t => {
        if (filterTierVal && t.tier !== filterTierVal) return false;
        if (filterType !== 'all' && t.type !== filterType) return false;
        if (q && !t.name.toLowerCase().includes(q)) return false;
        return true;
    });
    renderTankList();
}

function renderTankList() {
    const container = document.getElementById('tankList');
    if (!allTanks.length) { container.innerHTML = `<div class="tank-loading">Загружаем танки...</div>`; return; }
    if (!filteredTanks.length) { container.innerHTML = `<div class="tank-loading">Нет танков с такими фильтрами</div>`; return; }
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
    document.getElementById('tankList').style.display = '';
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

// Get display name for selected tank/class
function getTankDisplayName() {
    if (tankMode === 'specific' && challenge.tank) {
        return `${challenge.tank.name} (${TIER_ROMAN[challenge.tank.tier]})`;
    }
    const classIcon = CLASS_ICONS[challenge.tankType] || '🔄';
    const className = CLASS_NAMES[challenge.tankType] || 'Любой';
    const tierName = TIER_ROMAN[challenge.tankTier] || challenge.tankTier;
    return `${classIcon} ${className} · ${tierName}`;
}

// ============================================================
// SUMMARY
// ============================================================
function updateSummary() {
    challenge.wager = parseInt(document.getElementById('wagerAmount')?.value) || 100;

    const ready = challenge.opponent && challenge.condition;
    const summaryEl = document.getElementById('challengeSummaryFull');

    if (!ready) {
        summaryEl.style.display = 'none';
        return;
    }

    summaryEl.style.display = 'block';

    document.getElementById('sumOpponent').textContent = challenge.opponent.nickname;
    document.getElementById('sumTank').textContent = getTankDisplayName();
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
    console.log('[SEND] v2 opponent:', challenge.opponent, 'cond:', challenge.condition, 'tgId:', myTelegramId);

    if (!challenge.opponent) {
        showToast('❌ Выберите соперника!');
        return;
    }
    if (!challenge.condition) {
        showToast('❌ Выберите условие!');
        return;
    }

    if (!myTelegramId) {
        showToast('⚠️ Откройте через Telegram-бот');
        return;
    }

    const tankName = getTankDisplayName();

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
                tank_id: challenge.tank?.tank_id || null,
                tank_tier: challenge.tankTier,
                tank_type: challenge.tankType,
                tank_name: tankName,
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
    challenge.tankTier = 10;
    challenge.tankType = 'any';
    challenge.condition = null;
    challenge.battles = 5;
    challenge.wager = 100;

    document.getElementById('selectedOpponent').style.display = 'none';
    document.querySelector('#step-opponent .search-box').style.display = 'flex';
    document.getElementById('opponentSearch').style.display = '';
    document.getElementById('opponentSearch').value = '';
    document.getElementById('opponentResults').innerHTML = '';

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
window.setTankMode = setTankMode;
window.selectClass = selectClass;
window.selectTier = selectTier;
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
window.acceptChallenge = acceptChallenge;
window.declineChallenge = declineChallenge;
window.checkChallengeResults = checkChallengeResults;
window.copyOverlayLink = copyOverlayLink;
window.filterAdminUsers = filterAdminUsers;
window.toggleAdmin = toggleAdmin;
window.toggleBattleHistory = toggleBattleHistory;
window.cancelChallenge = cancelChallenge;

function toggleBattleHistory(id) {
    const el = document.getElementById(`battleHistory-${id}`);
    const arrow = document.getElementById(`historyArrow-${id}`);
    if (el.style.display === 'none') {
        el.style.display = '';
        if (arrow) arrow.textContent = '▲';
    } else {
        el.style.display = 'none';
        if (arrow) arrow.textContent = '▼';
    }
}

async function cancelChallenge(id) {
    if (!confirm('Отменить челлендж? Сыр вернётся обоим игрокам.')) return;
    try {
        const resp = await fetch(`${BOT_API_URL}/api/admin/cancel-challenge`, {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ admin_telegram_id: myTelegramId, challenge_id: id })
        });
        const data = await resp.json();
        if (data.success) {
            showToast(data.message, 'success');
            loadChallenges();
        } else {
            showToast(`❌ ${data.error}`, 'error');
        }
    } catch (e) {
        showToast('❌ Нет подключения', 'error');
    }
}

// ============================================================
// ADMIN PANEL
// ============================================================

let _adminUsersCache = [];

async function loadAdminUsers() {
    if (!isAdmin) return;
    const countEl = document.getElementById('adminUserCount');
    const listEl = document.getElementById('adminUsersList');
    countEl.textContent = '⏳ Загрузка...';

    try {
        const resp = await fetch(`${BOT_API_URL}/api/admin/users?telegram_id=${myTelegramId}`);
        const data = await resp.json();
        if (data.error) {
            countEl.textContent = `❌ ${data.error}`;
            return;
        }
        _adminUsersCache = data.users;
        countEl.textContent = `👥 Всего пользователей: ${data.total}`;
        renderAdminUsers(_adminUsersCache);
    } catch (e) {
        countEl.textContent = '❌ Нет подключения';
    }
}

function renderAdminUsers(users) {
    const listEl = document.getElementById('adminUsersList');
    if (!users.length) {
        listEl.innerHTML = '<div style="text-align:center;color:#5A6577;padding:20px;font-size:0.75rem">Нет пользователей</div>';
        return;
    }

    listEl.innerHTML = users.map(u => {
        const subInfo = u.subscription
            ? (u.subscription.active
                ? `<span style="color:#4ade80">✅ ${u.subscription.days_left} дн.</span>`
                : `<span style="color:#ef4444">❌ Истекла</span>`)
            : `<span style="color:#5A6577">Нет подписки</span>`;

        const method = u.subscription?.method
            ? `<span style="color:#8a94a6">${u.subscription.method}</span>`
            : '';

        const adminBadge = u.is_super_admin
            ? '<span style="color:#C8AA6E;font-weight:700">👑 Гл. Админ</span>'
            : (u.is_admin
                ? '<span style="color:#4ade80">🛡 Админ</span>'
                : '');

        const toggleBtn = u.is_super_admin ? '' : `
            <button onclick="toggleAdmin(${u.telegram_id})" 
                style="padding:5px 10px;border-radius:6px;font-size:0.6rem;cursor:pointer;
                border:1px solid ${u.is_admin ? 'rgba(239,68,68,0.3)' : 'rgba(34,197,94,0.3)'};
                background:${u.is_admin ? 'rgba(239,68,68,0.08)' : 'rgba(34,197,94,0.08)'};
                color:${u.is_admin ? '#ef4444' : '#4ade80'}">
                ${u.is_admin ? '❌ Снять' : '✅ Дать админку'}
            </button>`;

        return `
            <div class="duel-card" style="margin-bottom:8px">
                <div style="display:flex;justify-content:space-between;align-items:flex-start">
                    <div style="flex:1;min-width:0">
                        <div style="display:flex;gap:6px;align-items:center;flex-wrap:wrap">
                            <span style="font-family:'Russo One',sans-serif;font-size:0.8rem;color:#E8E6E3">
                                ${u.wot_nickname || u.first_name || 'Без имени'}
                            </span>
                            ${adminBadge}
                        </div>
                        <div style="font-size:0.6rem;color:#5A6577;margin-top:3px">
                            TG: ${u.username ? '@' + u.username : '—'} · ID: ${u.telegram_id}
                        </div>
                        <div style="font-size:0.6rem;color:#5A6577;margin-top:2px">
                            🎮 ${u.wot_nickname || '—'} · 🧀 ${u.cheese.toLocaleString('ru')} · ${subInfo} ${method}
                        </div>
                    </div>
                    <div style="flex-shrink:0;margin-left:8px">
                        ${toggleBtn}
                    </div>
                </div>
            </div>`;
    }).join('');
}

function filterAdminUsers() {
    const q = (document.getElementById('adminSearchInput')?.value || '').toLowerCase();
    if (!q) {
        renderAdminUsers(_adminUsersCache);
        return;
    }
    const filtered = _adminUsersCache.filter(u =>
        (u.wot_nickname || '').toLowerCase().includes(q) ||
        (u.username || '').toLowerCase().includes(q) ||
        (u.first_name || '').toLowerCase().includes(q) ||
        String(u.telegram_id).includes(q)
    );
    renderAdminUsers(filtered);
}

async function toggleAdmin(targetTgId) {
    try {
        const resp = await fetch(`${BOT_API_URL}/api/admin/toggle-admin`, {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ admin_telegram_id: myTelegramId, target_telegram_id: targetTgId })
        });
        const data = await resp.json();
        if (data.success) {
            showToast(`${data.message}`, 'success');
            loadAdminUsers();
        } else {
            showToast(`❌ ${data.error}`, 'error');
        }
    } catch (e) {
        showToast('❌ Нет подключения', 'error');
    }
}
