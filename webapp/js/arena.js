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
const BOT_API_URL = (() => {
    const params = new URLSearchParams(window.location.search);
    const host = params.get('api') || localStorage.getItem('api_host') || localStorage.getItem('bot_api_url');
    if (host) return host;
    return 'https://mir-tankov-production.up.railway.app';
})();
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
    damage: { icon: '💥', name: 'Урон', desc: 'Суммарный урон' },
    spotting: { icon: '👁', name: 'Засвет', desc: 'Урон по засвету' },
    blocked: { icon: '🛡️', name: 'Блок', desc: 'Заблокированный урон' },
    frags: { icon: '🎯', name: 'Фраги', desc: 'Суммарные фраги' },
    xp: { icon: '⭐', name: 'Опыт', desc: 'Суммарный опыт' },
    wins: { icon: '🏆', name: 'Победы', desc: 'Кол-во побед' },
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

    // Load my PVP challenges on the create tab
    setTimeout(() => loadMyPvpChallenges(), 500);

    // Auto-fill from friends page
    const params = new URLSearchParams(window.location.search);
    const opponent = params.get('opponent');
    const opponentId = params.get('opponent_id');
    if (opponent && opponentId) {
        selectOpponent(opponent, parseInt(opponentId), null);
    }

    // Auto-switch to Global Challenge tab if coming from Челленджи card
    const tab = params.get('tab');
    if (tab === 'challenge') {
        const globalTabBtn = document.querySelectorAll('.arena-tab')[1]; // "Общий" tab
        if (globalTabBtn) {
            setTimeout(() => switchTab('global', globalTabBtn), 100);
        }
    } else if (tab === 'bounty') {
        const bountyTabBtn = Array.from(document.querySelectorAll('.arena-tab')).find(b => b.textContent.includes('Охота'));
        if (bountyTabBtn) {
            setTimeout(() => switchTab('bounty', bountyTabBtn), 100);
        }
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
        // Передаём WoT данные из localStorage чтобы сервер мог восстановить после редеплоя
        let meUrl = `${BOT_API_URL}/api/me?telegram_id=${myTelegramId}`;
        const savedNick = localStorage.getItem('wot_nickname');
        const savedAccId = localStorage.getItem('wot_account_id');
        if (savedNick) meUrl += `&wot_nickname=${encodeURIComponent(savedNick)}`;
        if (savedAccId) meUrl += `&wot_account_id=${encodeURIComponent(savedAccId)}`;
        
        const resp = await fetch(meUrl);
        const data = await resp.json();
        if (data.wot_nickname) {
            badge.textContent = `👤 ${data.wot_nickname}`;
            document.title = `Арена — ${data.wot_nickname}`;
            // Сохраняем в localStorage для использования при создании/вступлении в челлендж
            localStorage.setItem('wot_nickname', data.wot_nickname);
            if (data.wot_account_id) {
                localStorage.setItem('wot_account_id', String(data.wot_account_id));
            }
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

    if (tabId === 'history') {
        loadChallenges();
        loadMyPvpChallenges();
        loadGcHistory();
        if (typeof tbLoadHistoryMain === 'function') tbLoadHistoryMain();
    }
    if (tabId === 'admin') loadAdminUsers();
    if (tabId === 'global' && typeof gcLoadChallenge === 'function') gcLoadChallenge(true);
    if (tabId === 'teams' && typeof tbInit === 'function') tbInit();
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
        const outgoing = data.challenges.filter(c => !c.is_incoming && c.status === 'pending');
        const active = data.challenges.filter(c => c.status === 'active');
        const finished = data.challenges.filter(c => c.status === 'declined' || c.status === 'finished').slice(0, 10);

        // Incoming
        const inEl = document.getElementById('incomingDuels');
        if (incoming.length) {
            inEl.innerHTML = incoming.map(c => `
                <div class="duel-card" style="animation:fadeInUp 0.3s ease">
                    <div style="display:flex;justify-content:space-between;align-items:start;margin-bottom:8px">
                        <div>
                            <div style="font-family:'Russo One',sans-serif;font-size:0.8rem;color:#E8E6E3">⚔️ ${c.opponent_name}</div>
                            <div style="font-size:0.65rem;color:#5A6577;margin-top:2px">${c.tank_name} · ${COND_LABELS_SHORT[c.condition] || c.condition}</div>
                        </div>
                        <div style="text-align:right">
                            <div style="font-size:0.75rem;color:#C8AA6E;font-weight:700">🧀 ${c.wager}</div>
                            <div style="font-size:0.55rem;color:#5A6577">${c.battles} боёв</div>
                        </div>
                    </div>
                    <div style="display:flex;gap:8px">
                        <button onclick="acceptChallenge(${c.id})" style="flex:1;padding:10px;border-radius:10px;border:none;background:linear-gradient(135deg,#22c55e,#16a34a);color:white;font-weight:700;font-size:0.75rem;cursor:pointer">✅ Принять</button>
                        <button onclick="declineChallenge(${c.id})" style="flex:1;padding:10px;border-radius:10px;border:1px solid rgba(239,68,68,0.3);background:transparent;color:#ef4444;font-weight:700;font-size:0.75rem;cursor:pointer">❌ Отклонить</button>
                    </div>
                </div>`).join('');
        } else {
            inEl.innerHTML = '<div style="text-align:center;color:#5A6577;font-size:0.7rem;padding:12px">Нет входящих вызовов</div>';
        }

        // Outgoing (sent by me, pending)
        const outEl = document.getElementById('outgoingDuels');
        if (outEl) {
            if (outgoing.length) {
                outEl.innerHTML = '<div style="font-size:0.7rem;color:#C8AA6E;font-weight:700;margin:16px 0 8px;font-family:\'Russo One\',sans-serif">📤 Отправленные</div>' +
                    outgoing.map(c => `<div class="duel-card" style="animation:fadeInUp .3s ease;border-color:rgba(200,170,110,0.15)">
                        <div style="display:flex;justify-content:space-between;align-items:center">
                            <div><div style="font-size:0.75rem;color:#E8E6E3">📤 → ${c.opponent_name}</div>
                            <div style="font-size:0.6rem;color:#5A6577">${c.tank_name} · ${c.battles} боёв · 🧀 ${c.wager}</div></div>
                            <button onclick="deleteChallenge(${c.id})" style="padding:6px 10px;border-radius:8px;border:1px solid rgba(239,68,68,0.3);background:transparent;color:#ef4444;font-size:0.6rem;cursor:pointer">🗑 Отмена</button>
                        </div>
                        <div style="font-size:0.55rem;color:#5A6577;margin-top:6px;text-align:center">⏳ Ожидает ответа...</div>
                    </div>`).join('');
            } else { outEl.innerHTML = ''; }
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
                            <div style="font-family:'Russo One',sans-serif;font-size:0.8rem;color:#E8E6E3">🔥 vs ${c.opponent_name}</div>
                            <div style="font-size:0.65rem;color:#5A6577;margin-top:2px">${c.tank_name} · ${COND_LABELS_SHORT[c.condition] || c.condition} · ${c.battles} боёв</div>
                        </div>
                        <div style="text-align:right">
                            <div style="font-size:0.85rem;color:#4ade80;font-weight:700">🏆 🧀 ${c.wager * 2}</div>
                            <div style="font-size:0.55rem;color:#5A6577">Приз</div>
                        </div>
                    </div>
                    <div id="results-${c.id}"><div style="text-align:center;color:#5A6577;padding:8px;font-size:0.7rem">⏳ Загрузка...</div></div>
                </div>`).join('');
            active.forEach(c => checkChallengeResults(c.id));
            clearInterval(window._challengeRefresh);
            window._challengeRefresh = setInterval(() => { active.forEach(c => checkChallengeResults(c.id)); }, 30000);
        } else {
            noActive.style.display = '';
            clearInterval(window._challengeRefresh);
            actEl.innerHTML = '';
        }

        // History — clickable, max 10
        const hEl = document.getElementById('historyList');
        if (finished.length) {
            window._historyData = {};
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
                    } catch (e) {}
                }
                window._historyData[c.id] = c;
                return `<div class="duel-card" style="border-color:${color}30;cursor:pointer;transition:all .2s" onclick="showChallengeDetail(${c.id})"
                     onmouseenter="this.style.transform='translateY(-2px)'" onmouseleave="this.style.transform=''">
                    <div style="display:flex;justify-content:space-between;align-items:center">
                        <div style="flex:1">
                            <div style="font-size:0.75rem;color:#E8E6E3">${icon} vs ${c.opponent_name}</div>
                            <div style="font-size:0.6rem;color:#5A6577">${c.tank_name} · ${c.battles} боёв · 🧀 ${c.wager}</div>
                        </div>
                        <div style="display:flex;align-items:center;gap:6px">
                            <span style="font-size:0.7rem;color:${color};font-weight:700">${label}</span>
                            <button onclick="event.stopPropagation();deleteChallenge(${c.id})" style="padding:3px 7px;border-radius:6px;border:1px solid rgba(255,255,255,0.08);background:transparent;color:#5A6577;font-size:0.5rem;cursor:pointer">🗑</button>
                        </div>
                    </div>
                    ${analyticsHtml}
                </div>`;
            }).join('');
        }
    } catch (e) {
        console.warn('Load challenges failed:', e);
    }
}




const COND_DISPLAY = {
    damage: { icon: '💥', name: 'Урон', key: 'damage', unit: '' },
    spotting: { icon: '👁', name: 'Засвет', key: 'spotting', unit: '' },
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
    const fmt = (n) => typeof n === 'number' ? n.toLocaleString('ru') : n;
    return `
        <div style="margin-top:12px;padding-top:12px;border-top:1px solid rgba(255,255,255,0.06)">
            <div style="text-align:center;font-size:0.6rem;color:#5A6577;margin-bottom:8px">
                ${cond.icon} ${cond.name} · ${ch.tank_name} · 🧀 ${ch.wager}
            </div>
            <div style="display:flex;gap:8px;align-items:center">
                <div style="flex:1;text-align:center;padding:10px;border-radius:10px;background:rgba(0,0,0,0.2)">
                    <div style="font-size:0.6rem;color:#8a94a6;margin-bottom:4px">${name1}</div>
                    <div style="font-size:1.2rem;font-family:'Russo One',sans-serif;color:${c1}">${fmt(v1)}${cond.unit}</div>
                    <div style="font-size:0.55rem;color:#5A6577">${fd.battles_played || '?'} боёв</div>
                </div>
                <div style="font-size:0.9rem;color:#5A6577">⚔️</div>
                <div style="flex:1;text-align:center;padding:10px;border-radius:10px;background:rgba(0,0,0,0.2)">
                    <div style="font-size:0.6rem;color:#8a94a6;margin-bottom:4px">${name2}</div>
                    <div style="font-size:1.2rem;font-family:'Russo One',sans-serif;color:${c2}">${fmt(v2)}${cond.unit}</div>
                    <div style="font-size:0.55rem;color:#5A6577">${td.battles_played || '?'} боёв</div>
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
        if (data.error) { el.innerHTML = `<div style="text-align:center;color:#ef4444;padding:14px;font-size:0.8rem">❌ ${data.error}</div>`; return; }
        if (data.snapshot_saved) { el.innerHTML = `<div style="text-align:center;color:#4ade80;padding:14px;font-size:0.8rem">📸 ${data.message}</div>`; return; }
        const fp = data.from_player, tp = data.to_player, ch = data.challenge;
        const cond = COND_DISPLAY[ch.condition] || COND_DISPLAY.damage;
        const v1 = fp.delta[cond.key] ?? 0, v2 = tp.delta[cond.key] ?? 0;
        const c1 = v1 >= v2 ? '#4ade80' : '#ef4444', c2 = v2 >= v1 ? '#4ade80' : '#ef4444';
        let statusHtml = '';
        if (data.both_ready && data.winner) {
            const isWinner = data.winner.telegram_id === myTelegramId;
            statusHtml = `<div style="text-align:center;padding:16px;margin-top:12px;border-radius:12px;
                background:${isWinner ? 'rgba(34,197,94,0.08)' : 'rgba(239,68,68,0.08)'}; 
                border:1px solid ${isWinner ? 'rgba(34,197,94,0.2)' : 'rgba(239,68,68,0.2)'}">
                <div style="font-size:1.5rem">${isWinner ? '🏆' : '😞'}</div>
                <div style="font-size:1rem;font-family:'Russo One',sans-serif;color:${isWinner ? '#4ade80' : '#ef4444'};margin-top:6px">${isWinner ? 'ПОБЕДА!' : 'ПОРАЖЕНИЕ'}</div>
                <div style="font-size:0.85rem;color:#C8AA6E;margin-top:6px">${data.winner.nickname} получает 🧀 ${ch.wager * 2}</div>
            </div>`;
            setTimeout(loadChallenges, 2000);
        } else {
            statusHtml = `<div style="text-align:center;margin-top:10px;padding:10px;border-radius:10px;background:rgba(200,170,110,0.05)">
                <div style="font-size:0.75rem;color:#C8AA6E;margin-bottom:4px">Прогресс боёв</div>
                <div style="display:flex;gap:12px;justify-content:center;font-size:0.75rem">
                    <span style="color:${fp.ready ? '#4ade80' : '#8a94a6'}">${fp.nickname}: ${fp.delta.battles_played}/${ch.battles} ${fp.ready ? '✅' : '⏳'}</span>
                    <span style="color:${tp.ready ? '#4ade80' : '#8a94a6'}">${tp.nickname}: ${tp.delta.battles_played}/${ch.battles} ${tp.ready ? '✅' : '⏳'}</span>
                </div>
            </div>`;
        }
        const canManage = isAdmin || (ch && ch.from_telegram_id === myTelegramId);
        const overlayBtn = canManage ? `<div style="margin-top:10px;display:flex;gap:8px;justify-content:center">
                <button onclick="copyOverlayLink(${id})" style="padding:8px 16px;border-radius:8px;border:1px solid rgba(200,170,110,0.2);
                    background:rgba(200,170,110,0.05);color:#C8AA6E;font-size:0.7rem;font-weight:600;cursor:pointer">📋 Ссылка OBS</button>
                <button onclick="deleteChallenge(${id})" style="padding:8px 16px;border-radius:8px;border:1px solid rgba(239,68,68,0.2);
                    background:rgba(239,68,68,0.05);color:#ef4444;font-size:0.7rem;font-weight:600;cursor:pointer">❌ Отменить</button>
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
    // Use widget constructor settings if available
    if (typeof _wcBuildUrl === 'function') {
        const url = _wcBuildUrl(challengeId);
        navigator.clipboard.writeText(url).then(() => {
            showToast('📋 Ссылка для OBS скопирована (с настройками виджета)!', 'success');
        }).catch(() => {
            prompt('Скопируйте ссылку:', url);
        });
        return;
    }
    const url = `https://mir-tankov-production.up.railway.app/webapp/overlay.html?id=${challengeId}`;
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

async function deleteChallenge(id) {
    if (!confirm('Удалить/отменить этот вызов?')) return;
    try {
        const resp = await fetch(`${BOT_API_URL}/api/challenges/delete`, {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ challenge_id: id, telegram_id: myTelegramId })
        });
        const data = await resp.json();
        if (data.success) {
            showToast('🗑 Вызов удалён', 'info');
            loadChallenges();
            if (typeof loadMyPvpChallenges === 'function') loadMyPvpChallenges();
        } else {
            showToast(`❌ ${data.error}`, 'error');
        }
    } catch (e) { showToast('❌ Ошибка', 'error'); }
}

function showChallengeDetail(id) {
    const c = (window._historyData || {})[id];
    if (!c) return;
    const condLabel = COND_LABELS_SHORT[c.condition] || c.condition;
    const isWin = c.winner_telegram_id === myTelegramId;
    let result, resultColor;
    if (c.status === 'declined') {
        result = '❌ Отклонён'; resultColor = '#5A6577';
    } else if (c.status === 'active') {
        result = '🔥 В бою'; resultColor = '#f5be0b';
    } else if (c.status === 'pending') {
        result = '⏳ Ожидание'; resultColor = '#f5be0b';
    } else if (c.status === 'finished' && c.winner_telegram_id) {
        result = isWin ? '🏆 Победа' : '😞 Поражение';
        resultColor = isWin ? '#4ade80' : '#ef4444';
    } else {
        result = '⚔️ Челлендж'; resultColor = '#C8AA6E';
    }
    let statsHtml = '';
    if (c.status === 'finished' && c.from_end_stats && c.to_end_stats) {
        try {
            const fd = typeof c.from_end_stats === 'string' ? JSON.parse(c.from_end_stats) : c.from_end_stats;
            const td = typeof c.to_end_stats === 'string' ? JSON.parse(c.to_end_stats) : c.to_end_stats;
            const name1 = c.is_incoming ? c.opponent_name : 'Я';
            const name2 = c.is_incoming ? 'Я' : c.opponent_name;
            const fmt = (n) => typeof n === 'number' ? n.toLocaleString('ru') : (n || '—');
            const rows = [['💥 Урон',fd.damage,td.damage],['🎯 Фраги',fd.frags,td.frags],['👁 Засвет',fd.spotting,td.spotting],
                ['🛡 Заблок.',fd.blocked,td.blocked],['⭐ Опыт',fd.xp,td.xp],['🏆 Победы',fd.wins,td.wins],['⚔️ Боёв',fd.battles_played,td.battles_played]];
            statsHtml = `<table style="width:100%;border-collapse:collapse;margin-top:12px">
                <tr style="border-bottom:1px solid rgba(255,255,255,0.08)"><th style="text-align:left;padding:6px;font-size:0.6rem;color:#5A6577"></th>
                <th style="text-align:center;padding:6px;font-size:0.65rem;color:#C8AA6E;font-weight:700">${name1}</th>
                <th style="text-align:center;padding:6px;font-size:0.65rem;color:#C8AA6E;font-weight:700">${name2}</th></tr>
                ${rows.map(([label,v1,v2]) => {
                    const c1 = (v1||0)>=(v2||0)?'#4ade80':'#E8E6E3', c2 = (v2||0)>=(v1||0)?'#4ade80':'#E8E6E3';
                    return `<tr style="border-bottom:1px solid rgba(255,255,255,0.04)"><td style="padding:5px 6px;font-size:0.6rem;color:#8a94a6">${label}</td>
                    <td style="text-align:center;padding:5px;font-size:0.7rem;color:${c1};font-weight:600">${fmt(v1)}</td>
                    <td style="text-align:center;padding:5px;font-size:0.7rem;color:${c2};font-weight:600">${fmt(v2)}</td></tr>`;
                }).join('')}</table>`;
        } catch(e){}
    }
    const createdDate = c.created_at ? new Date(c.created_at).toLocaleString('ru') : '—';
    const modal = document.createElement('div');
    modal.id = 'challengeDetailModal';
    modal.style.cssText = 'position:fixed;inset:0;z-index:9999;display:flex;align-items:center;justify-content:center;background:rgba(0,0,0,0.7);backdrop-filter:blur(6px)';
    modal.onclick = (e) => { if (e.target === modal) modal.remove(); };
    modal.innerHTML = `<div style="max-width:400px;width:90%;max-height:85vh;overflow-y:auto;background:linear-gradient(145deg,#1a2332,#0f1520);border:1px solid rgba(200,170,110,0.2);border-radius:20px;padding:24px">
        <div style="text-align:center;margin-bottom:16px">
            <div style="font-size:1.5rem">${c.status==='declined'?'❌':'⚔️'}</div>
            <div style="font-family:'Russo One',sans-serif;font-size:1rem;color:#E8E6E3">vs ${c.opponent_name}</div>
            <div style="font-size:1rem;font-weight:800;color:${resultColor};margin-top:6px">${result}</div>
        </div>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-bottom:14px">
            <div style="background:rgba(0,0,0,0.25);border-radius:10px;padding:10px;text-align:center">
                <div style="font-size:0.55rem;color:#5A6577">Техника</div><div style="font-size:0.7rem;color:#E8E6E3;font-weight:600">🪖 ${c.tank_name}</div></div>
            <div style="background:rgba(0,0,0,0.25);border-radius:10px;padding:10px;text-align:center">
                <div style="font-size:0.55rem;color:#5A6577">Условие</div><div style="font-size:0.7rem;color:#E8E6E3;font-weight:600">${condLabel}</div></div>
            <div style="background:rgba(0,0,0,0.25);border-radius:10px;padding:10px;text-align:center">
                <div style="font-size:0.55rem;color:#5A6577">Боёв</div><div style="font-size:0.7rem;color:#E8E6E3;font-weight:600">${c.battles}</div></div>
            <div style="background:rgba(0,0,0,0.25);border-radius:10px;padding:10px;text-align:center">
                <div style="font-size:0.55rem;color:#5A6577">Ставка</div><div style="font-size:0.7rem;color:#C8AA6E;font-weight:600">🧀 ${c.wager}</div></div>
        </div>
        ${c.status==='finished'?`<div style="text-align:center;padding:8px;background:rgba(${isWin?'34,197,94':'239,68,68'},0.08);border-radius:10px;margin-bottom:12px">
            <div style="font-size:0.6rem;color:#5A6577">Приз</div>
            <div style="font-size:1rem;font-family:'Russo One',sans-serif;color:${isWin?'#4ade80':'#ef4444'}">${isWin?'+':'-'}🧀 ${isWin?c.wager*2:c.wager}</div></div>`:''}
        ${statsHtml}
        <div style="margin-top:14px;font-size:0.55rem;color:#5A6577">📅 Создан: ${createdDate}</div>
        <button onclick="document.getElementById('challengeDetailModal').remove()" style="width:100%;margin-top:14px;padding:12px;border-radius:12px;border:1px solid rgba(200,170,110,0.2);background:transparent;color:#E8E6E3;font-size:0.75rem;cursor:pointer;font-weight:600">Закрыть</button>
    </div>`;
    document.body.appendChild(modal);
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

        // Also fetch basic Lesta stats for registered users 
        let playerStats = {};
        try {
            const idsToCheck = data.data.map(p => p.account_id).join(',');
            const statsResp = await fetch(`${LESTA_API}/account/info/?application_id=${LESTA_APP}&account_id=${idsToCheck}&fields=statistics.all.battles,statistics.all.wins`);
            const statsData = await statsResp.json();
            if (statsData.status === 'ok' && statsData.data) playerStats = statsData.data;
        } catch(e) {}

        // Check who's already friends
        let myFriends = [];
        try {
            const fResp = await fetch(`${BOT_API_URL}/api/friends?telegram_id=${myTelegramId}`);
            const fData = await fResp.json();
            myFriends = (fData.friends || []).map(f => f.telegram_id);
        } catch(e) {}

        results.innerHTML = data.data.map((p, i) => {
            const reg = registered[String(p.account_id)];
            const isMe = reg && reg.telegram_id === myTelegramId;
            const isFriend = reg && myFriends.includes(reg.telegram_id);

            // Stats
            const st = playerStats[String(p.account_id)];
            let statsLine = '';
            if (st && st.statistics) {
                const b = st.statistics.all.battles || 0;
                const w = st.statistics.all.wins || 0;
                const wr = b > 0 ? ((w / b) * 100).toFixed(1) : '—';
                const wrColor = wr >= 55 ? '#4ade80' : wr >= 50 ? '#C8AA6E' : wr >= 47 ? '#8a94a6' : '#ef4444';
                statsLine = `<span class="player-card__stat" style="color:${wrColor}">${wr}% WR</span> · <span class="player-card__stat">${b.toLocaleString()} боёв</span>`;
            }

            if (isMe) {
                return `<div class="player-card" style="opacity:0.4;animation-delay:${i * 0.04}s">
                    <div class="player-card__avatar">👤</div>
                    <div class="player-card__info">
                        <div class="player-card__nick">${p.nickname}</div>
                        <div class="player-card__stats-row"><span class="player-card__stat" style="color:#C8AA6E">Это вы</span></div>
                    </div></div>`;
            }

            if (reg) {
                const friendBtn = isFriend
                    ? `<span style="font-size:0.55rem;color:#4ade80;padding:4px 6px">✅ Друг</span>`
                    : `<button onclick="event.stopPropagation();addFriendFromArena('${p.nickname.replace(/'/g, "\\'")}',${reg.telegram_id})" style="padding:5px 8px;border-radius:6px;border:1px solid rgba(34,197,94,0.3);background:transparent;color:#4ade80;font-size:0.55rem;cursor:pointer" title="Добавить в друзья">➕👥</button>`;
                return `<div class="player-card" style="animation-delay:${i * 0.04}s" onclick="selectOpponent('${p.nickname.replace(/'/g, "\\'")}', ${reg.telegram_id}, ${p.account_id})">
                    <div class="player-card__avatar">🪖</div>
                    <div class="player-card__info">
                        <div class="player-card__nick">${p.nickname}</div>
                        <div class="player-card__stats-row">
                            <span class="player-card__stat" style="color:#4ade80">● В приложении</span>
                            ${statsLine ? ` · ${statsLine}` : ''}
                        </div>
                    </div>
                    <div style="display:flex;gap:4px;align-items:center">
                        ${friendBtn}
                        <button class="player-card__challenge-btn">⚔️</button>
                    </div></div>`;
            }

            return `<div class="player-card" style="opacity:0.5;animation-delay:${i * 0.04}s">
                <div class="player-card__avatar" style="background:#3A4555">🪖</div>
                <div class="player-card__info">
                    <div class="player-card__nick">${p.nickname}</div>
                    <div class="player-card__stats-row">
                        <span class="player-card__stat">⚫ Не в приложении</span>
                        ${statsLine ? ` · ${statsLine}` : ''}
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
    // Hide both modes
    const searchMode = document.getElementById('oppSearchMode');
    const friendsMode = document.getElementById('oppFriendsMode');
    const sourceToggle = document.querySelector('.opp-source-toggle');
    if (searchMode) searchMode.style.display = 'none';
    if (friendsMode) friendsMode.style.display = 'none';
    if (sourceToggle) sourceToggle.style.display = 'none';

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
    // Restore source toggle
    const sourceToggle = document.querySelector('.opp-source-toggle');
    if (sourceToggle) sourceToggle.style.display = 'flex';
    // Restore the active mode
    const searchBtn = document.getElementById('oppSrcSearch');
    const friendsBtn = document.getElementById('oppSrcFriends');
    const isSearchActive = searchBtn && searchBtn.style.color === 'rgb(200, 170, 110)';
    const searchMode = document.getElementById('oppSearchMode');
    const friendsMode = document.getElementById('oppFriendsMode');
    if (!isSearchActive && friendsMode) {
        // Friends mode was active
        if (searchMode) searchMode.style.display = 'none';
        friendsMode.style.display = '';
    } else {
        // Default: search mode
        if (searchMode) searchMode.style.display = '';
        if (friendsMode) friendsMode.style.display = 'none';
    }
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

async function addFriendFromArena(nickname, toTelegramId) {
    if (!myTelegramId) { showToast('⚠️ Войдите в аккаунт'); return; }
    try {
        const resp = await fetch(`${BOT_API_URL}/api/friends/add`, {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ from_telegram_id: myTelegramId, to_telegram_id: toTelegramId })
        });
        const data = await resp.json();
        if (data.success) {
            showToast(data.auto_accepted ? `🤝 ${nickname} — теперь друг!` : `📩 Запрос отправлен ${nickname}!`, 'success');
            searchOpponent(); // re-render results
        } else {
            showToast(`ℹ️ ${data.error || 'Ошибка'}`);
        }
    } catch(e) { showToast('❌ Ошибка подключения', 'error'); }
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

    if (challenge.wager < 100) {
        showToast('❌ Минимальная ставка: 100 🧀', 'error');
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
                resetChallengeBuilder();
                // Switch to History > Мои tab
                const histTab = document.querySelector('.arena-tab[onclick*="history"]');
                if (histTab) switchTab('history', histTab);
                loadMyPvpChallenges();
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

// ============================================================
// MY PVP CHALLENGES (inline on create tab)
// ============================================================
const STATUS_MAP = {
    pending:  { label: '⏳ Ожидание', color: '#f5be0b', bg: 'rgba(245,190,11,0.08)', border: 'rgba(245,190,11,0.2)' },
    active:   { label: '🔥 В бою', color: '#4ade80', bg: 'rgba(34,197,94,0.08)', border: 'rgba(34,197,94,0.2)' },
    finished: { label: '✅ Завершён', color: '#60a5fa', bg: 'rgba(96,165,250,0.08)', border: 'rgba(96,165,250,0.2)' },
    declined: { label: '❌ Отклонён', color: '#ef4444', bg: 'rgba(239,68,68,0.08)', border: 'rgba(239,68,68,0.2)' },
};

function timeAgo(dateStr) {
    if (!dateStr) return '';
    const d = new Date(dateStr);
    const now = new Date();
    const diffMs = now - d;
    const mins = Math.floor(diffMs / 60000);
    if (mins < 1) return 'только что';
    if (mins < 60) return `${mins} мин. назад`;
    const hrs = Math.floor(mins / 60);
    if (hrs < 24) return `${hrs} ч. назад`;
    const days = Math.floor(hrs / 24);
    return `${days} дн. назад`;
}

async function loadMyPvpChallenges() {
    if (!myTelegramId) return;
    const container = document.getElementById('myPvpList');
    if (!container) return;

    try {
        const resp = await fetch(`${BOT_API_URL}/api/challenges?telegram_id=${myTelegramId}`);
        const data = await resp.json();
        if (!data.challenges || !data.challenges.length) {
            container.innerHTML = `
                <div style="text-align:center;padding:24px">
                    <div style="font-size:1.5rem;margin-bottom:8px">⚔️</div>
                    <div style="color:#5A6577;font-size:0.72rem">У вас пока нет вызовов</div>
                    <div style="color:#3A4555;font-size:0.6rem;margin-top:4px">Создайте первый вызов выше ☝️</div>
                </div>`;
            return;
        }

        // Show recent challenges (last 15)
        const recent = data.challenges.slice(0, 15);
        window._historyData = window._historyData || {};
        recent.forEach(c => window._historyData[c.id] = c);

        container.innerHTML = recent.map(c => {
            const st = STATUS_MAP[c.status] || STATUS_MAP.pending;
            const cond = COND_LABELS_SHORT[c.condition] || c.condition;
            const isSent = !c.is_incoming; // I sent this challenge
            const direction = isSent ? '📤' : '📩';
            const dirLabel = isSent ? 'Вы вызвали' : 'Вас вызвал';
            const ago = timeAgo(c.created_at);

            // Winner info for finished
            let winnerHtml = '';
            if (c.status === 'finished' && c.winner_telegram_id) {
                const isWin = c.winner_telegram_id === myTelegramId;
                winnerHtml = `
                    <div style="margin-top:8px;padding:8px 12px;border-radius:10px;text-align:center;
                        background:${isWin ? 'rgba(34,197,94,0.08)' : 'rgba(239,68,68,0.08)'};
                        border:1px solid ${isWin ? 'rgba(34,197,94,0.15)' : 'rgba(239,68,68,0.15)'}">
                        <span style="font-size:0.8rem">${isWin ? '🏆' : '😞'}</span>
                        <span style="font-size:0.7rem;color:${isWin ? '#4ade80' : '#ef4444'};font-weight:700;margin-left:4px">
                            ${isWin ? `Победа! +🧀 ${c.wager * 2}` : `Поражение. -🧀 ${c.wager}`}
                        </span>
                    </div>`;
            }

            // Cancel button (only for pending challenges I sent)
            let cancelHtml = '';
            if (c.status === 'pending' && isSent) {
                cancelHtml = `
                    <button onclick="event.stopPropagation();cancelMyChallenge(${c.id})" style="margin-top:8px;width:100%;padding:8px;
                        border-radius:8px;border:1px solid rgba(239,68,68,0.2);background:rgba(239,68,68,0.06);
                        color:#ef4444;font-size:0.65rem;font-weight:600;cursor:pointer;
                        font-family:'Inter',sans-serif;transition:all 0.2s"
                        onmouseover="this.style.background='rgba(239,68,68,0.12)'"
                        onmouseout="this.style.background='rgba(239,68,68,0.06)'">
                        ✕ Отменить вызов
                    </button>`;
            }

            // Accept/Decline (only for incoming pending)
            let actionHtml = '';
            if (c.status === 'pending' && c.is_incoming) {
                actionHtml = `
                    <div style="display:flex;gap:6px;margin-top:8px">
                        <button onclick="event.stopPropagation();acceptChallenge(${c.id});setTimeout(loadMyPvpChallenges,1000)" style="flex:1;padding:8px;border-radius:8px;border:none;
                            background:linear-gradient(135deg,#22c55e,#16a34a);color:white;font-weight:700;font-size:0.65rem;cursor:pointer">
                            ✅ Принять
                        </button>
                        <button onclick="event.stopPropagation();declineChallenge(${c.id});setTimeout(loadMyPvpChallenges,1000)" style="flex:1;padding:8px;border-radius:8px;
                            border:1px solid rgba(239,68,68,0.3);background:transparent;color:#ef4444;font-weight:700;font-size:0.65rem;cursor:pointer">
                            ❌ Отклонить
                        </button>
                    </div>`;
            }

            // Check results button for active
            let activeHtml = '';
            if (c.status === 'active') {
                activeHtml = `
                    <div style="margin-top:8px;display:flex;gap:6px">
                        <button onclick="event.stopPropagation();switchTab('active', document.querySelectorAll('.arena-tab')[3])" style="flex:1;padding:8px;
                            border-radius:8px;border:1px solid rgba(200,170,110,0.2);background:rgba(200,170,110,0.06);
                            color:#C8AA6E;font-size:0.65rem;font-weight:600;cursor:pointer;font-family:'Inter',sans-serif">
                            📊 Смотреть результаты
                        </button>
                    </div>`;
            }

            return `
                <div onclick="showChallengeDetail(${c.id})" style="padding:14px;border-radius:14px;background:${st.bg};border:1px solid ${st.border};
                    margin-bottom:8px;animation:fadeInUp 0.3s ease;cursor:pointer;transition:transform 0.2s"
                    onmouseover="this.style.transform='scale(1.01)'" onmouseout="this.style.transform='scale(1)'">
                    <!-- Header: opponent + status -->
                    <div style="display:flex;justify-content:space-between;align-items:flex-start">
                        <div style="flex:1;min-width:0">
                            <div style="display:flex;align-items:center;gap:6px">
                                <span style="font-size:0.65rem">${direction}</span>
                                <span style="font-family:'Russo One',sans-serif;font-size:0.8rem;color:#E8E6E3">
                                    ${c.opponent_name}
                                </span>
                            </div>
                            <div style="font-size:0.55rem;color:#5A6577;margin-top:3px">${dirLabel} · ${ago}</div>
                        </div>
                        <div style="display:flex;align-items:center;gap:6px">
                            <div style="padding:4px 10px;border-radius:8px;background:${st.bg};border:1px solid ${st.border};
                                font-size:0.6rem;font-weight:700;color:${st.color};white-space:nowrap">
                                ${st.label}
                            </div>
                            ${c.status !== 'active' ? `
                            <button onclick="event.stopPropagation();deleteChallenge(${c.id})" style="padding:4px;border-radius:6px;border:none;background:transparent;color:#5A6577;font-size:0.85rem;cursor:pointer;transition:color 0.2s" 
                                onmouseover="this.style.color='#ef4444'" onmouseout="this.style.color='#5A6577'" title="Удалить">
                                🗑
                            </button>
                            ` : ''}
                        </div>
                    </div>

                    <!-- Details row -->
                    <div style="display:flex;gap:6px;margin-top:10px;flex-wrap:wrap">
                        <div style="padding:4px 8px;border-radius:6px;background:rgba(0,0,0,0.2);font-size:0.6rem;color:#8a94a6">
                            🪖 ${c.tank_name || 'Любой'}
                        </div>
                        <div style="padding:4px 8px;border-radius:6px;background:rgba(0,0,0,0.2);font-size:0.6rem;color:#8a94a6">
                            ${cond}
                        </div>
                        <div style="padding:4px 8px;border-radius:6px;background:rgba(0,0,0,0.2);font-size:0.6rem;color:#8a94a6">
                            ⚔️ ${c.battles} боёв
                        </div>
                        <div style="padding:4px 8px;border-radius:6px;background:rgba(0,0,0,0.2);font-size:0.6rem;color:#C8AA6E;font-weight:600">
                            🧀 ${c.wager}
                        </div>
                    </div>

                    ${winnerHtml}
                    ${cancelHtml}
                    ${actionHtml}
                    ${activeHtml}
                </div>`;
        }).join('');

    } catch (e) {
        console.error('loadMyPvpChallenges error:', e);
        container.innerHTML = '<div style="text-align:center;color:#ef4444;font-size:0.7rem;padding:16px">❌ Ошибка загрузки</div>';
    }
}

async function cancelMyChallenge(id) {
    if (!confirm('Отменить вызов? Сыр вернётся вам.')) return;
    try {
        const resp = await fetch(`${BOT_API_URL}/api/challenges/delete`, {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ challenge_id: id, telegram_id: myTelegramId })
        });
        const data = await resp.json();
        if (data.success) {
            showToast('✅ Вызов отменён, сыр возвращён', 'success');
            loadMyPvpChallenges();
            loadChallenges();
        } else {
            showToast(`❌ ${data.error}`, 'error');
        }
    } catch (e) {
        showToast('❌ Нет подключения', 'error');
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
window.deleteChallenge = deleteChallenge;
window.showChallengeDetail = showChallengeDetail;
window.checkChallengeResults = checkChallengeResults;
window.copyOverlayLink = copyOverlayLink;
window.filterAdminUsers = filterAdminUsers;
window.toggleAdmin = toggleAdmin;
window.toggleBattleHistory = toggleBattleHistory;
window.cancelChallenge = cancelChallenge;
window.addFriendFromArena = addFriendFromArena;
window.openGiftModal = openGiftModal;
window.giftCheese = giftCheese;
window.switchHistorySub = switchHistorySub;
window.switchOppSource = switchOppSource;
window.loadFriendsForOpponent = loadFriendsForOpponent;

// ============================================================
// HISTORY SUB-TABS
// ============================================================
function switchHistorySub(sub) {
    const myBtn = document.getElementById('histSubMy');
    const histBtn = document.getElementById('histSubHistory');
    const myPanel = document.getElementById('histPanelMy');
    const histPanel = document.getElementById('histPanelHistory');

    if (sub === 'my') {
        myBtn.style.border = '1px solid rgba(200,170,110,0.3)';
        myBtn.style.background = 'linear-gradient(135deg,rgba(200,170,110,0.12),rgba(200,170,110,0.04))';
        myBtn.style.color = '#C8AA6E';
        histBtn.style.border = '1px solid rgba(255,255,255,0.06)';
        histBtn.style.background = 'rgba(255,255,255,0.03)';
        histBtn.style.color = '#5A6577';
        myPanel.style.display = '';
        histPanel.style.display = 'none';
        loadChallenges();
        loadMyPvpChallenges();
    } else {
        histBtn.style.border = '1px solid rgba(200,170,110,0.3)';
        histBtn.style.background = 'linear-gradient(135deg,rgba(200,170,110,0.12),rgba(200,170,110,0.04))';
        histBtn.style.color = '#C8AA6E';
        myBtn.style.border = '1px solid rgba(255,255,255,0.06)';
        myBtn.style.background = 'rgba(255,255,255,0.03)';
        myBtn.style.color = '#5A6577';
        myPanel.style.display = 'none';
        histPanel.style.display = '';
        loadGcHistory();
        if (typeof tbLoadHistoryMain === 'function') tbLoadHistoryMain();
    }
}

// ============================================================
// OPPONENT SOURCE TOGGLE (Search / Friends)
// ============================================================
function switchOppSource(mode) {
    const searchBtn = document.getElementById('oppSrcSearch');
    const friendsBtn = document.getElementById('oppSrcFriends');
    const searchMode = document.getElementById('oppSearchMode');
    const friendsMode = document.getElementById('oppFriendsMode');

    if (mode === 'search') {
        searchBtn.style.border = '1px solid rgba(200,170,110,0.3)';
        searchBtn.style.background = 'rgba(200,170,110,0.12)';
        searchBtn.style.color = '#C8AA6E';
        friendsBtn.style.border = '1px solid rgba(255,255,255,0.06)';
        friendsBtn.style.background = 'rgba(255,255,255,0.03)';
        friendsBtn.style.color = '#5A6577';
        searchMode.style.display = '';
        friendsMode.style.display = 'none';
    } else {
        friendsBtn.style.border = '1px solid rgba(200,170,110,0.3)';
        friendsBtn.style.background = 'rgba(200,170,110,0.12)';
        friendsBtn.style.color = '#C8AA6E';
        searchBtn.style.border = '1px solid rgba(255,255,255,0.06)';
        searchBtn.style.background = 'rgba(255,255,255,0.03)';
        searchBtn.style.color = '#5A6577';
        searchMode.style.display = 'none';
        friendsMode.style.display = '';
        loadFriendsForOpponent();
    }
}

// ============================================================
// LOAD FRIENDS LIST FOR OPPONENT PICKER
// ============================================================
async function loadFriendsForOpponent() {
    const container = document.getElementById('friendsListForOpponent');
    if (!container) return;
    if (!myTelegramId) {
        container.innerHTML = '<div style="text-align:center;color:#ef4444;font-size:0.7rem;padding:16px">\u26a0\ufe0f ID \u043d\u0435 \u043e\u043f\u0440\u0435\u0434\u0435\u043b\u0451\u043d</div>';
        return;
    }

    container.innerHTML = '<div style="text-align:center;color:#5A6577;font-size:0.7rem;padding:16px"><div class="search-loading__spinner" style="margin:0 auto 8px"></div>\u0417\u0430\u0433\u0440\u0443\u0437\u043a\u0430 \u0434\u0440\u0443\u0437\u0435\u0439...</div>';

    try {
        const resp = await fetch(`${BOT_API_URL}/api/friends?telegram_id=${myTelegramId}`);
        const data = await resp.json();
        const friends = data.friends || [];

        if (friends.length === 0) {
            container.innerHTML = `<div style="text-align:center;padding:20px">
                <div style="font-size:1.5rem;margin-bottom:8px">\ud83d\udc65</div>
                <div style="font-size:0.75rem;color:#5A6577">\u0414\u0440\u0443\u0437\u0435\u0439 \u043f\u043e\u043a\u0430 \u043d\u0435\u0442</div>
                <div style="font-size:0.6rem;color:#5A6577;margin-top:4px">\u0414\u043e\u0431\u0430\u0432\u044c \u0434\u0440\u0443\u0437\u0435\u0439 \u0447\u0435\u0440\u0435\u0437 \u043f\u043e\u0438\u0441\u043a \u0438\u043b\u0438 \u0432\u043a\u043b\u0430\u0434\u043a\u0443 \u0414\u0440\u0443\u0437\u044c\u044f</div>
            </div>`;
            return;
        }

        container.innerHTML = friends.map((f, i) => {
            const nick = f.wot_nickname || f.nickname || `ID:${f.telegram_id}`;
            const safeNick = nick.replace(/'/g, "\\'");
            const isMe = f.telegram_id === myTelegramId;
            if (isMe) return '';

            return `<div class="player-card" style="animation:fadeInUp 0.3s ease;animation-delay:${i * 0.04}s;animation-fill-mode:both;cursor:pointer" onclick="selectOpponent('${safeNick}', ${f.telegram_id}, ${f.account_id || 0})">
                <div class="player-card__avatar" style="background:linear-gradient(135deg,rgba(74,222,128,0.15),rgba(34,197,94,0.05));border-color:rgba(74,222,128,0.3)">\ud83d\udc65</div>
                <div class="player-card__info" style="flex:1">
                    <div class="player-card__nick">${nick}</div>
                    <div class="player-card__stats-row"><span class="player-card__stat" style="color:#4ade80">\u2705 \u0414\u0440\u0443\u0433</span></div>
                </div>
                <div style="color:#C8AA6E;font-size:0.7rem;font-weight:700">\u2694\ufe0f</div>
            </div>`;
        }).filter(Boolean).join('');

        if (!container.innerHTML.trim()) {
            container.innerHTML = '<div style="text-align:center;color:#5A6577;font-size:0.7rem;padding:16px">\u041d\u0435\u0442 \u0434\u0440\u0443\u0437\u0435\u0439 \u0434\u043b\u044f \u0432\u044b\u0437\u043e\u0432\u0430</div>';
        }
    } catch (e) {
        console.error('loadFriendsForOpponent error:', e);
        container.innerHTML = '<div style="text-align:center;color:#ef4444;font-size:0.7rem;padding:16px">\u2716 \u041e\u0448\u0438\u0431\u043a\u0430 \u0437\u0430\u0433\u0440\u0443\u0437\u043a\u0438</div>';
    }
}
window.addSelfCheese = addSelfCheese;
window.closeGiftModal = closeGiftModal;
window.loadMyPvpChallenges = loadMyPvpChallenges;
window.cancelMyChallenge = cancelMyChallenge;
window.toggleWidgetConstructor = toggleWidgetConstructor;
window.wcSelectTheme = wcSelectTheme;
window.wcSelectLayout = wcSelectLayout;
window.wcSelectFont = wcSelectFont;
window.wcUpdateSlider = wcUpdateSlider;
window.wcUpdatePreview = wcUpdatePreview;
window.wcCopyLink = wcCopyLink;
window.wcResetDefaults = wcResetDefaults;

// ============================================================
// PVP WIDGET CONSTRUCTOR
// ============================================================
const wcConfig = {
    theme: 'gold',
    layout: 'full',
    font: 'russo',
    scale: 1.0,
    bgOp: 94,
    radius: 18,
    header: true,
    info: true,
    progress: true,
    history: true,
    footer: true,
    brand: true,
    anim: true,
    glow: false,
    accentOn: false,
    accent: '#C8AA6E',
};

// Try to restore from localStorage
try {
    const saved = localStorage.getItem('pvp_wc_config');
    if (saved) Object.assign(wcConfig, JSON.parse(saved));
} catch (e) {}

function saveWcConfig() {
    localStorage.setItem('pvp_wc_config', JSON.stringify(wcConfig));
}

function toggleWidgetConstructor() {
    const body = document.getElementById('wcBody');
    const btn = document.getElementById('wcToggleBtn');
    if (body.style.display === 'none') {
        body.style.display = '';
        btn.textContent = '▲';
        wcRestoreUI();
        wcUpdatePreview();
    } else {
        body.style.display = 'none';
        btn.textContent = '▼';
    }
}

function wcRestoreUI() {
    // Restore theme buttons
    document.querySelectorAll('#wcThemes .wc-theme-btn').forEach(b => {
        b.classList.toggle('wc-theme-active', b.dataset.theme === wcConfig.theme);
    });
    // Restore layout buttons
    document.querySelectorAll('#wcLayouts .wc-layout-btn').forEach(b => {
        b.classList.remove('wc-theme-active');
    });
    const layouts = ['full', 'compact', 'minimal', 'horizontal'];
    const layoutBtns = document.querySelectorAll('#wcLayouts .wc-layout-btn');
    const li = layouts.indexOf(wcConfig.layout);
    if (li >= 0 && layoutBtns[li]) layoutBtns[li].classList.add('wc-theme-active');

    // Sliders
    document.getElementById('wcScale').value = wcConfig.scale;
    document.getElementById('wcScaleVal').textContent = wcConfig.scale.toFixed(1);
    document.getElementById('wcBgOp').value = wcConfig.bgOp;
    document.getElementById('wcBgVal').textContent = wcConfig.bgOp + '%';
    document.getElementById('wcRadius').value = wcConfig.radius;
    document.getElementById('wcRadiusVal').textContent = wcConfig.radius + 'px';

    // Toggles
    document.getElementById('wcHeader').checked = wcConfig.header;
    document.getElementById('wcInfo').checked = wcConfig.info;
    document.getElementById('wcProgress').checked = wcConfig.progress;
    document.getElementById('wcHistory').checked = wcConfig.history;
    document.getElementById('wcFooter').checked = wcConfig.footer;
    document.getElementById('wcBrand').checked = wcConfig.brand;
    document.getElementById('wcAnim').checked = wcConfig.anim;
    document.getElementById('wcGlow').checked = wcConfig.glow;
    document.getElementById('wcAccentOn').checked = wcConfig.accentOn;
    document.getElementById('wcAccent').value = wcConfig.accent;
}

function wcSelectTheme(theme, btn) {
    wcConfig.theme = theme;
    document.querySelectorAll('#wcThemes .wc-theme-btn').forEach(b => b.classList.remove('wc-theme-active'));
    btn.classList.add('wc-theme-active');
    saveWcConfig();
    wcUpdatePreview();
}

function wcSelectLayout(layout, btn) {
    wcConfig.layout = layout;
    document.querySelectorAll('#wcLayouts .wc-layout-btn').forEach(b => b.classList.remove('wc-theme-active'));
    btn.classList.add('wc-theme-active');
    saveWcConfig();
    wcUpdatePreview();
}

function wcSelectFont(font, btn) {
    wcConfig.font = font;
    btn.parentElement.querySelectorAll('.wc-layout-btn').forEach(b => b.classList.remove('wc-theme-active'));
    btn.classList.add('wc-theme-active');
    saveWcConfig();
    wcUpdatePreview();
}

function wcUpdateSlider() {
    wcConfig.scale = parseFloat(document.getElementById('wcScale').value);
    wcConfig.bgOp = parseInt(document.getElementById('wcBgOp').value);
    wcConfig.radius = parseInt(document.getElementById('wcRadius').value);
    document.getElementById('wcScaleVal').textContent = wcConfig.scale.toFixed(1);
    document.getElementById('wcBgVal').textContent = wcConfig.bgOp + '%';
    document.getElementById('wcRadiusVal').textContent = wcConfig.radius + 'px';
    saveWcConfig();
    wcUpdatePreview();
}

function wcUpdatePreview() {
    wcConfig.header = document.getElementById('wcHeader').checked;
    wcConfig.info = document.getElementById('wcInfo').checked;
    wcConfig.progress = document.getElementById('wcProgress').checked;
    wcConfig.history = document.getElementById('wcHistory').checked;
    wcConfig.footer = document.getElementById('wcFooter').checked;
    wcConfig.brand = document.getElementById('wcBrand').checked;
    wcConfig.anim = document.getElementById('wcAnim').checked;
    wcConfig.glow = document.getElementById('wcGlow').checked;
    wcConfig.accentOn = document.getElementById('wcAccentOn').checked;
    wcConfig.accent = document.getElementById('wcAccent').value;
    saveWcConfig();

    const c = wcConfig;
    const preview = document.getElementById('wcPreview');
    if (!preview) return;

    // Build a static demo preview
    const url = _wcBuildUrl('preview');
    preview.innerHTML = `<iframe src="${url}" style="width:580px;height:340px;border:none;border-radius:14px;pointer-events:none" scrolling="no"></iframe>`;
}

function _wcBuildUrl(challengeId) {
    const c = wcConfig;
    const base = 'https://mir-tankov-production.up.railway.app/webapp/overlay.html';
    const p = new URLSearchParams();
    if (challengeId) p.set('id', challengeId);
    if (c.theme !== 'gold') p.set('theme', c.theme);
    if (c.layout !== 'full') p.set('layout', c.layout);
    if (c.font !== 'russo') p.set('font', c.font);
    if (c.scale !== 1.0) p.set('scale', c.scale);
    if (c.bgOp !== 94) p.set('bgop', (c.bgOp / 100).toFixed(2));
    if (c.radius !== 18) p.set('radius', c.radius);
    if (!c.header) p.set('header', '0');
    if (!c.info) p.set('info', '0');
    if (!c.progress) p.set('progress', '0');
    if (!c.history) p.set('history', '0');
    if (!c.footer) p.set('footer', '0');
    if (!c.brand) p.set('brand', '0');
    if (!c.anim) p.set('anim', '0');
    if (c.glow) p.set('glow', '1');
    if (c.accentOn && c.accent) p.set('accent', c.accent.replace('#', ''));
    return base + '?' + p.toString();
}

function wcCopyLink() {
    // Find the latest active challenge ID to use
    // Or use a generic link
    const url = _wcBuildUrl('CHALLENGE_ID');
    const display = url.replace('CHALLENGE_ID', '<ID вашего челленджа>');
    
    navigator.clipboard.writeText(url).then(() => {
        showToast('📋 Шаблон OBS ссылки скопирован! Замените CHALLENGE_ID на ID вызова', 'success');
    }).catch(() => {
        prompt('Скопируйте ссылку (замените CHALLENGE_ID на ID вызова):', url);
    });

    // Show preview
    const linkEl = document.getElementById('wcLinkPreview');
    linkEl.style.display = '';
    linkEl.innerHTML = `<div style="color:#C8AA6E;margin-bottom:4px;font-size:0.55rem;font-family:Inter,sans-serif">📋 Скопировано! Замените CHALLENGE_ID на номер</div>${display}`;
}

function wcResetDefaults() {
    Object.assign(wcConfig, {
        theme: 'gold', layout: 'full', font: 'russo',
        scale: 1.0, bgOp: 94, radius: 18,
        header: true, info: true, progress: true, history: true,
        footer: true, brand: true, anim: true, glow: false,
        accentOn: false, accent: '#C8AA6E',
    });
    saveWcConfig();
    wcRestoreUI();
    wcUpdatePreview();
    showToast('🔄 Настройки сброшены', 'info');
}

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

    // Admin self-cheese button at top
    let selfBtnHtml = '';
    if (isAdmin) {
        selfBtnHtml = `
            <div style="margin-bottom:12px;padding:12px;border-radius:12px;background:linear-gradient(135deg,rgba(200,170,110,0.08),rgba(200,170,110,0.03));
                border:1px solid rgba(200,170,110,0.15)">
                <div style="display:flex;align-items:center;gap:10px;margin-bottom:8px">
                    <span style="font-size:1rem">🧀</span>
                    <span style="font-family:'Russo One',sans-serif;font-size:0.75rem;color:#C8AA6E">Сыр админа</span>
                </div>
                <div style="display:flex;gap:6px">
                    <input type="number" id="adminSelfCheeseAmount" placeholder="Кол-во" min="1" value="1000"
                        style="flex:1;padding:8px 10px;border-radius:8px;background:rgba(0,0,0,0.3);border:1px solid rgba(200,170,110,0.15);
                        color:#E8E6E3;font-size:0.7rem;outline:none;font-family:'Inter',sans-serif">
                    <button onclick="addSelfCheese()" style="padding:8px 16px;border-radius:8px;border:none;
                        background:linear-gradient(135deg,#C8AA6E,#a08540);color:#0a0e14;font-size:0.7rem;font-weight:700;
                        cursor:pointer;white-space:nowrap">➕ Добавить себе</button>
                </div>
            </div>`;
    }

    listEl.innerHTML = selfBtnHtml + users.map(u => {
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

        const blockedBadge = u.is_blocked
            ? '<span style="color:#ef4444;font-weight:700;margin-left:6px">🚫 Заблокирован</span>'
            : '';

        let fnNameInput = u.wot_nickname || u.first_name || '';
        if (typeof fnNameInput !== 'string') fnNameInput = String(fnNameInput);
        const safeName = fnNameInput.replace(/'/g, "\\'").replace(/"/g, "&quot;");

        const toggleBtn = u.is_super_admin ? '' : `
            <button onclick="toggleAdmin(${u.telegram_id})" 
                style="padding:5px 10px;border-radius:6px;font-size:0.6rem;cursor:pointer;
                border:1px solid ${u.is_admin ? 'rgba(239,68,68,0.3)' : 'rgba(34,197,94,0.3)'};
                background:${u.is_admin ? 'rgba(239,68,68,0.08)' : 'rgba(34,197,94,0.08)'};
                color:${u.is_admin ? '#ef4444' : '#4ade80'}">
                ${u.is_admin ? '❌ Снять' : '✅ Дать админку'}
            </button>`;

        const deleteBtn = u.is_super_admin ? '' : `
            <button onclick="adminDeleteUser(${u.telegram_id}, '${safeName}')" 
                style="padding:5px 10px;border-radius:6px;font-size:0.6rem;cursor:pointer;
                border:1px solid rgba(239,68,68,0.3);background:rgba(239,68,68,0.08);color:#ef4444">
                🗑 Удалить
            </button>`;

        const blockBtn = u.is_super_admin ? '' : `
            <button onclick="adminBlockUser(${u.telegram_id}, '${safeName}', ${!u.is_blocked})" 
                style="padding:5px 10px;border-radius:6px;font-size:0.6rem;cursor:pointer;
                border:1px solid rgba(245,158,11,0.3);background:rgba(245,158,11,0.08);color:#f59e0b">
                ${u.is_blocked ? '✅ Разблокировать' : '🚫 Заблокировать'}
            </button>`;

        const giftBtn = `
            <button onclick="openGiftModal(${u.telegram_id}, '${safeName}')" 
                style="padding:5px 10px;border-radius:6px;font-size:0.6rem;cursor:pointer;
                border:1px solid rgba(200,170,110,0.3);background:rgba(200,170,110,0.08);color:#C8AA6E">
                🎁 Подарить 🧀
            </button>`;

        return `
            <div class="duel-card" style="margin-bottom:8px; ${u.is_blocked ? 'opacity:0.6;border:1px solid rgba(239,68,68,0.3);' : ''}">
                <div style="display:flex;justify-content:space-between;align-items:flex-start">
                    <div style="flex:1;min-width:0">
                        <div style="display:flex;gap:6px;align-items:center;flex-wrap:wrap">
                            <span style="font-family:'Russo One',sans-serif;font-size:0.8rem;color:#E8E6E3">
                                ${u.wot_nickname || u.first_name || 'Без имени'}
                            </span>
                            ${adminBadge} ${blockedBadge}
                        </div>
                        <div style="font-size:0.6rem;color:#5A6577;margin-top:3px">
                            TG: ${u.username ? '@' + u.username : '—'} · ID: ${u.telegram_id}
                        </div>
                        <div style="font-size:0.6rem;color:#5A6577;margin-top:2px">
                            🎮 ${u.wot_nickname || '—'} · 🧀 ${u.cheese.toLocaleString('ru')} · ${subInfo} ${method}
                        </div>
                    </div>
                    <div style="flex-shrink:0;margin-left:8px;display:flex;flex-direction:column;align-items:flex-end">
                        <div style="display:flex; gap:4px; margin-bottom:4px; justify-content:flex-end; width:100%;">
                            ${toggleBtn}
                            ${giftBtn}
                        </div>
                        <div style="display:flex; gap:4px; justify-content:flex-end; width:100%;">
                            ${blockBtn}
                            ${deleteBtn}
                        </div>
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

// ============================================================
// GLOBAL CHALLENGE HISTORY
// ============================================================
const GC_COND_ICONS = {
    damage: '💥', frags: '🎯', xp: '⭐', spotting: '👁',
    blocked: '🛡', wins: '🏆', combined: '📊'
};
const GC_COND_NAMES = {
    damage: 'Урон', frags: 'Фраги', xp: 'Опыт', spotting: 'Засвет',
    blocked: 'Заблокировано', wins: 'Победы', combined: 'Комбинированный'
};

async function loadGcHistory() {
    const container = document.getElementById('gcHistoryList');
    if (!container) return;

    try {
        const url = isAdmin
            ? `${BOT_API_URL}/api/global-challenge/history?telegram_id=${myTelegramId}`
            : `${BOT_API_URL}/api/global-challenge/history?telegram_id=${myTelegramId}`;
        const resp = await fetch(url);
        const data = await resp.json();

        if (!data.history || data.history.length === 0) {
            container.innerHTML = `<div style="text-align:center;color:#5A6577;font-size:0.7rem;padding:20px">
                <div style="font-size:1.5rem;margin-bottom:8px">🏆</div>
                Завершённых челленджей пока нет
            </div>`;
            return;
        }

        container.innerHTML = data.history.map(ch => renderGcHistoryCard(ch)).join('');
    } catch (e) {
        console.error('loadGcHistory error:', e);
        container.innerHTML = '<div style="text-align:center;color:#ef4444;font-size:0.7rem;padding:16px">❌ Ошибка загрузки</div>';
    }
}

function renderGcHistoryCard(ch) {
    const condIcon = GC_COND_ICONS[ch.condition] || '🏆';
    const condName = GC_COND_NAMES[ch.condition] || ch.condition;
    const date = ch.finished_at ? new Date(ch.finished_at).toLocaleDateString('ru', {day:'numeric',month:'short',hour:'2-digit',minute:'2-digit'}) : '';
    const statusLabel = ch.status === 'wheel_pending' ? '🎡 Рулетка' : '✅ Завершён';
    const statusColor = ch.status === 'wheel_pending' ? '#f5be0b' : '#4ade80';

    // Top-3 leaderboard
    const medals = ['🥇', '🥈', '🥉'];
    let top3Html = '';
    if (ch.leaderboard_top3 && ch.leaderboard_top3.length > 0) {
        top3Html = ch.leaderboard_top3.map((p, i) => `
            <div style="display:flex;align-items:center;gap:8px;padding:4px 0">
                <span style="font-size:0.8rem">${medals[i] || `#${i+1}`}</span>
                <span style="flex:1;color:#E8E6E3;font-size:0.7rem">${p.nickname}</span>
                <span style="color:#C8AA6E;font-size:0.7rem;font-weight:700">${condIcon} ${(p.current_value || 0).toLocaleString('ru')}</span>
            </div>
        `).join('');
    }

    // My result
    let myResultHtml = '';
    if (ch.my_result) {
        const placeColor = ch.my_result.place <= 3 ? '#4ade80' : '#E8E6E3';
        myResultHtml = `
            <div style="margin-top:8px;padding:8px 12px;border-radius:10px;background:rgba(200,170,110,0.06);
                border:1px solid rgba(200,170,110,0.1)">
                <div style="display:flex;justify-content:space-between;align-items:center">
                    <span style="font-size:0.65rem;color:#8a94a6">Мой результат</span>
                    <span style="font-size:0.75rem;color:${placeColor};font-weight:700">
                        ${ch.my_result.place} место · ${condIcon} ${(ch.my_result.value || 0).toLocaleString('ru')}
                    </span>
                </div>
            </div>
        `;
    }

    // Prize / wheel winner
    let prizeHtml = '';
    if (ch.prize_mode) {
        const prizeDesc = ch.prize_description || ch.reward_description || '';
        if (ch.wheel_winner_nickname) {
            prizeHtml = `
                <div style="margin-top:8px;padding:10px 12px;border-radius:10px;
                    background:linear-gradient(135deg,rgba(245,190,11,0.08),rgba(200,170,110,0.05));
                    border:1px solid rgba(245,190,11,0.2)">
                    <div style="text-align:center">
                        <span style="font-size:0.65rem;color:#f5be0b">🎡 Победитель рулетки</span>
                        <div style="font-size:0.85rem;color:#E8E6E3;font-weight:700;margin-top:4px">${ch.wheel_winner_nickname}</div>
                        <div style="font-size:0.65rem;color:#C8AA6E;margin-top:2px">🏆 ${prizeDesc}</div>
                    </div>
                </div>`;
        } else if (prizeDesc) {
            prizeHtml = `
                <div style="margin-top:8px;text-align:center;font-size:0.65rem;color:#f5be0b">
                    🏆 Приз: ${prizeDesc}
                    ${ch.status === 'wheel_pending' ? ' · 🎡 Ожидает рулетку' : ''}
                </div>`;
        }
    }

    // Reward coins (non-prize mode)
    let rewardHtml = '';
    if (!ch.prize_mode && ch.reward_coins > 0 && ch.winner_nickname) {
        rewardHtml = `
            <div style="margin-top:6px;text-align:center;font-size:0.65rem;color:#4ade80">
                🏆 ${ch.winner_nickname} получил 🧀 ${ch.reward_coins}
            </div>`;
    }

    return `
        <div class="duel-card" style="margin-bottom:10px;border-color:${statusColor}20">
            <div style="display:flex;justify-content:space-between;align-items:start;margin-bottom:8px">
                <div>
                    <div style="font-family:'Russo One',sans-serif;font-size:0.75rem;color:#E8E6E3">
                        ${ch.icon || '🏆'} ${ch.title || 'Челлендж #' + ch.id}
                    </div>
                    <div style="font-size:0.6rem;color:#5A6577;margin-top:2px">
                        ${condIcon} ${condName} · ${ch.participants_count || 0} участников
                    </div>
                </div>
                <div style="text-align:right">
                    <div style="font-size:0.6rem;color:${statusColor};font-weight:600">${statusLabel}</div>
                    <div style="font-size:0.55rem;color:#5A6577;margin-top:2px">${date}</div>
                </div>
            </div>
            ${top3Html ? `<div style="padding:6px 0;border-top:1px solid rgba(255,255,255,0.04)">${top3Html}</div>` : ''}
            ${myResultHtml}
            ${prizeHtml}
            ${rewardHtml}
        </div>`;
}

// ============================================================
// ADMIN: GIFT CHEESE
// ============================================================

function openGiftModal(targetTgId, targetName) {
    // Remove existing modal
    const existing = document.getElementById('giftCheeseModal');
    if (existing) existing.remove();

    const modal = document.createElement('div');
    modal.id = 'giftCheeseModal';
    modal.style.cssText = `
        position:fixed;top:0;left:0;width:100%;height:100%;z-index:1000;
        display:flex;align-items:center;justify-content:center;
        background:rgba(0,0,0,0.7);backdrop-filter:blur(6px);
        animation:fadeInUp 0.2s ease;
    `;
    modal.innerHTML = `
        <div style="background:linear-gradient(145deg,#131a24,#0e1420);border:1px solid rgba(200,170,110,0.2);
            border-radius:20px;padding:24px;max-width:340px;width:90%;text-align:center">
            <div style="font-size:1.5rem;margin-bottom:8px">🎁</div>
            <div style="font-family:'Russo One',sans-serif;font-size:0.85rem;color:#C8AA6E;margin-bottom:4px">
                Подарить сыр
            </div>
            <div style="font-size:0.7rem;color:#8a94a6;margin-bottom:16px">
                Игрок: <b style="color:#E8E6E3">${targetName || targetTgId}</b>
            </div>
            <input type="number" id="giftCheeseAmount" min="1" value="100" placeholder="Количество 🧀"
                style="width:100%;padding:12px 14px;border-radius:10px;background:rgba(0,0,0,0.3);
                border:1px solid rgba(200,170,110,0.2);color:#E8E6E3;font-size:0.8rem;
                text-align:center;outline:none;margin-bottom:8px;font-family:'Inter',sans-serif">
            <input type="text" id="giftCheeseReason" placeholder="Причина (необязательно)"
                style="width:100%;padding:10px 14px;border-radius:10px;background:rgba(0,0,0,0.2);
                border:1px solid rgba(200,170,110,0.1);color:#8a94a6;font-size:0.7rem;
                outline:none;margin-bottom:16px;font-family:'Inter',sans-serif">
            <div style="display:flex;gap:8px">
                <button onclick="closeGiftModal()" style="flex:1;padding:12px;border-radius:10px;
                    border:1px solid rgba(255,255,255,0.1);background:transparent;color:#8a94a6;
                    font-size:0.75rem;cursor:pointer">Отмена</button>
                <button onclick="giftCheese(${targetTgId}, '${(targetName || '').replace(/'/g, "\\\\'")}')"
                    style="flex:1;padding:12px;border-radius:10px;border:none;
                    background:linear-gradient(135deg,#C8AA6E,#a08540);color:#0a0e14;
                    font-size:0.75rem;font-weight:700;cursor:pointer">🎁 Подарить</button>
            </div>
        </div>
    `;
    modal.addEventListener('click', (e) => { if (e.target === modal) closeGiftModal(); });
    document.body.appendChild(modal);
    document.getElementById('giftCheeseAmount').focus();
}

function closeGiftModal() {
    const modal = document.getElementById('giftCheeseModal');
    if (modal) modal.remove();
}

async function giftCheese(targetTgId, targetName) {
    const amount = parseInt(document.getElementById('giftCheeseAmount')?.value) || 0;
    const reason = document.getElementById('giftCheeseReason')?.value || 'Подарок от админа';

    if (amount <= 0) {
        showToast('❌ Введите сумму больше 0', 'error');
        return;
    }

    try {
        const resp = await fetch(`${BOT_API_URL}/api/admin/gift-cheese`, {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                admin_telegram_id: myTelegramId,
                target_telegram_id: targetTgId,
                amount: amount,
                reason: reason,
            })
        });
        const data = await resp.json();
        if (data.success) {
            showToast(data.message, 'success');
            closeGiftModal();
            loadAdminUsers(); // refresh balances
            loadMyProfile(); // refresh own balance if self
        } else {
            showToast(`❌ ${data.error}`, 'error');
        }
    } catch (e) {
        showToast('❌ Нет подключения', 'error');
    }
}

async function addSelfCheese() {
    const amount = parseInt(document.getElementById('adminSelfCheeseAmount')?.value) || 0;
    if (amount <= 0) {
        showToast('❌ Введите сумму больше 0', 'error');
        return;
    }
    try {
        const resp = await fetch(`${BOT_API_URL}/api/admin/gift-cheese`, {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                admin_telegram_id: myTelegramId,
                target_telegram_id: myTelegramId,
                amount: amount,
                reason: 'Админ-начисление',
            })
        });
        const data = await resp.json();
        if (data.success) {
            showToast(`✅ Добавлено ${amount} 🧀. Баланс: ${data.new_balance}`, 'success');
            loadMyProfile(); // refresh balance on page
            // Update cheese display
            const cheeseEl = document.getElementById('cheeseBalance');
            if (cheeseEl) cheeseEl.textContent = data.new_balance.toLocaleString('ru');
        } else {
            showToast(`❌ ${data.error}`, 'error');
        }
    } catch (e) {
        showToast('❌ Нет подключения', 'error');
    }
}

async function adminDeleteUser(targetId, name) {
    if(!confirm(`Вы уверены, что хотите УДАЛИТЬ пользователя ${name}? Он сможет заново зарегистрироваться.`)) return;
    
    try {
        const resp = await fetch(`${BOT_API_URL}/api/admin/delete-user`, {
            method: 'POST',
            headers: {'Content-Type': 'application/json'},
            body: JSON.stringify({ admin_telegram_id: myTelegramId, target_telegram_id: targetId })
        });
        const d = await resp.json();
        if(d.error) return alert(d.error);
        alert(d.message || "Удалено");
        loadAdminUsers();
    } catch(e) {
        alert("Ошибка сети");
    }
}

async function adminBlockUser(targetId, name, doBlock) {
    const actionName = doBlock ? 'ЗАБЛОКИРОВАТЬ' : 'РАЗБЛОКИРОВАТЬ';
    if(!confirm(`Вы уверены, что хотите ${actionName} пользователя ${name}?`)) return;

    let reason = "Нарушение правил";
    if (doBlock) {
        reason = prompt("Причина блокировки:", "Нарушение правил");
        if (reason === null) return;
    }

    try {
        const resp = await fetch(`${BOT_API_URL}/api/admin/block-user`, {
            method: 'POST',
            headers: {'Content-Type': 'application/json'},
            body: JSON.stringify({ 
                admin_telegram_id: myTelegramId, 
                target_telegram_id: targetId,
                action: doBlock ? 'block' : 'unblock',
                reason: reason || "Нарушение правил"
            })
        });
        const d = await resp.json();
        if(d.error) return alert(d.error);
        alert(d.message || "Успешно");
        loadAdminUsers();
    } catch(e) {
        alert("Ошибка сети");
    }
}
