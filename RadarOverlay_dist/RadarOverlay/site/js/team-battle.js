/**
 * Team Battle JS — Команда на Команду
 * Фильтр техники как в «Общий» (Нация/Класс/Уровень).
 * Ручной старт: все нажимают «Готов», создатель запускает.
 */

const TB_COND_MAP = {
    damage:   { icon: '💥', name: 'Урон',    unit: 'урона',   img: 'img/military/cond_damage.png?v=2' },
    frags:    { icon: '🎯', name: 'Фраги',   unit: 'фрагов',  img: 'img/military/cond_frags.png?v=2' },
    xp:       { icon: '⭐', name: 'Опыт',    unit: 'опыта',   img: 'img/military/cond_xp.png?v=2' },
    spotting: { icon: '👁', name: 'Засвет',  unit: 'засвета', img: 'img/military/cond_spotting.png?v=2' },
    blocked:  { icon: '🛡️', name: 'Блок',    unit: 'блока',   img: 'img/military/cond_blocked.png?v=2' },
    wins:     { icon: '🏆', name: 'Победы',  unit: 'побед',   img: 'img/military/cond_combined.png?v=2' },
};

// ── State ──
let tbSubTab = 'browse';
let tbBattles = [];
let tbCreateState = {
    condition: 'damage',
    teamSize: 5,
    customSize: null,
    joinTime: 0, // 0 = без лимита
    wager: 100,
    battles: 5,
    // Tank filters (like global)
    tankNation: '',
    tankClass: '',
    tankTier: 0,
    tankId: null,
    tankName: null,
};
let _tbRefreshInterval = null;

// ============================================================
// INIT
// ============================================================
function tbInit() {
    tbRenderSubTabs();
    tbSwitchSubTab('browse');
    clearInterval(_tbRefreshInterval);
    _tbRefreshInterval = setInterval(() => {
        if (tbSubTab === 'browse' || tbSubTab === 'my') tbLoadBattles();
    }, 15000);
}

function tbRenderSubTabs() { /* rendered in HTML */ }

// ============================================================
// SUB-TABS
// ============================================================
function tbSwitchSubTab(tab) {
    tbSubTab = tab;
    document.querySelectorAll('.tb-subtab').forEach(b => {
        b.classList.toggle('active', b.dataset.tab === tab);
    });
    ['browse', 'create', 'my', 'history'].forEach(t => {
        const el = document.getElementById('tb-panel-' + t);
        if (el) el.style.display = tab === t ? '' : 'none';
    });
    if (tab === 'browse' || tab === 'my') tbLoadBattles();
    if (tab === 'create') tbRenderCreateForm();
    if (tab === 'history') tbLoadHistory();
}

// ============================================================
// BROWSE
// ============================================================
async function tbLoadBattles() {
    const browseEl = document.getElementById('tb-browse-list');
    const myEl = document.getElementById('tb-my-list');
    try {
        const resp = await fetch(`${BOT_API_URL}/api/team-battle/list?telegram_id=${myTelegramId}`);
        const data = await resp.json();
        tbBattles = data.battles || [];

        const active = tbBattles.filter(b => b.status !== 'finished');
        if (active.length === 0) {
            browseEl.innerHTML = `<div class="tb-empty"><div class="tb-empty__icon">⚔️</div><div class="tb-empty__title">Нет активных битв</div><div class="tb-empty__desc">Создай командный челлендж первым!</div></div>`;
        } else {
            browseEl.innerHTML = active.map(b => tbRenderBattleCard(b)).join('');
            active.forEach(b => tbStartCardTimer(b));
        }

        const myBattles = tbBattles.filter(b => {
            const allP = [...(b.team_alpha || []), ...(b.team_bravo || [])];
            return allP.some(p => String(p.telegram_id) === String(myTelegramId));
        });
        if (myBattles.length === 0) {
            myEl.innerHTML = `<div class="tb-empty"><div class="tb-empty__icon">📋</div><div class="tb-empty__title">Вы пока не участвуете</div></div>`;
        } else {
            myEl.innerHTML = myBattles.map(b => tbRenderBattleCard(b, true)).join('');
            myBattles.forEach(b => tbStartCardTimer(b));
        }
    } catch (e) {
        console.error('TB load:', e);
        browseEl.innerHTML = `<div class="tb-empty"><div class="tb-empty__icon">⚠️</div><div class="tb-empty__desc">Ошибка загрузки</div></div>`;
    }
}

// ============================================================
// HISTORY (only finished)
// ============================================================
async function tbLoadHistory() {
    const el = document.getElementById('tb-history-list');
    if (!el) return;
    try {
        const resp = await fetch(`${BOT_API_URL}/api/team-battle/history?telegram_id=${myTelegramId}`);
        const data = await resp.json();
        const battles = data.battles || [];
        if (battles.length === 0) {
            el.innerHTML = `<div class="tb-empty"><div class="tb-empty__icon">📜</div><div class="tb-empty__title">Нет истории</div><div class="tb-empty__desc">Здесь будут завершённые командные бои</div></div>`;
            return;
        }
        el.innerHTML = battles.map(b => tbRenderBattleCard(b, false, true)).join('');
    } catch (e) {
        el.innerHTML = `<div class="tb-empty"><div class="tb-empty__icon">⚠️</div><div class="tb-empty__desc">Ошибка загрузки</div></div>`;
    }
}

// ============================================================
// RENDER BATTLE CARD (with ready/start logic)
// ============================================================
function tbRenderBattleCard(b, isMy = false, isHistory = false) {
    const cond = TB_COND_MAP[b.condition] || TB_COND_MAP.damage;
    const ts = b.team_size || 5;
    const alphaPlayers = b.team_alpha || [];
    const bravoPlayers = b.team_bravo || [];
    const alphaTotal = alphaPlayers.reduce((s, p) => s + (p.current_value || 0), 0);
    const bravoTotal = bravoPlayers.reduce((s, p) => s + (p.current_value || 0), 0);
    const totalScore = alphaTotal + bravoTotal || 1;
    const alphaPct = Math.round((alphaTotal / totalScore) * 100);

    const myTgStr = String(myTelegramId);
    const iAmAlpha = alphaPlayers.some(p => String(p.telegram_id) === myTgStr);
    const iAmBravo = bravoPlayers.some(p => String(p.telegram_id) === myTgStr);
    const iAmIn = iAmAlpha || iAmBravo;
    const iAmCreator = String(b.creator_telegram_id) === myTgStr;

    const alphaFull = alphaPlayers.length >= ts;
    const bravoFull = bravoPlayers.length >= ts;
    const isWaiting = b.status === 'waiting';
    const isActive = b.status === 'active';
    const isFinished = b.status === 'finished';

    const allParticipants = [...alphaPlayers, ...bravoPlayers];
    const allReady = allParticipants.length >= 2 && allParticipants.every(p => p.is_ready);
    const myReadyState = allParticipants.find(p => String(p.telegram_id) === myTgStr);

    // Tank filter info
    let tankFilterHtml = '';
    if (b.tank_name_filter) {
        tankFilterHtml = `<span style="color:#a855f7">🎯 ${b.tank_name_filter}</span>`;
    } else if (b.tank_tier_filter) {
        const tierNames = {1:'I',2:'II',3:'III',4:'IV',5:'V',6:'VI',7:'VII',8:'VIII',9:'IX',10:'X'};
        tankFilterHtml = `<span style="color:#a855f7">Ур. ${tierNames[b.tank_tier_filter] || b.tank_tier_filter}</span>`;
    }

    // Player rows with ready indicator + tank info + clickable
    const tierLabels = ['','I','II','III','IV','V','VI','VII','VIII','IX','X'];
    const renderPlayers = (players, maxSlots) => {
        let html = '';
        for (const p of players) {
            const isMe = String(p.telegram_id) === myTgStr;
            const readyIcon = isWaiting ? (p.is_ready ? '✅' : '⬜') : '';
            const showStats = isActive || isFinished;
            const topTanks = (p.tank_logs || []).slice(0, 2);
            const tankBadges = showStats && topTanks.length > 0
                ? topTanks.map(t => `<span style="display:inline-block;padding:1px 5px;border-radius:4px;background:rgba(168,85,247,0.12);color:#c084fc;font-size:0.5rem;margin-left:3px">${tierLabels[t.tank_tier]||'?'} ${t.tank_name || ''}</span>`).join('')
                : '';
            const clickable = showStats && (p.tank_logs || []).length > 0;
            html += `<div class="tb-player ${isMe ? 'tb-player--me' : ''}" ${clickable ? `onclick="tbShowPlayerDetail(${b.id}, ${p.telegram_id})" style="cursor:pointer"` : ''}>
                <div style="display:flex;flex-direction:column;gap:1px;min-width:0;flex:1">
                    <span class="tb-player__name">${readyIcon} ${p.nickname || 'Танкист'}${p.is_creator ? ' 👑' : ''}</span>
                    ${tankBadges ? `<div style="display:flex;flex-wrap:wrap;gap:2px">${tankBadges}</div>` : ''}
                </div>
                <span class="tb-player__value">${showStats ? (p.current_value || 0).toLocaleString('ru') : '—'}</span>
            </div>`;
        }
        if (isWaiting) {
            for (let i = players.length; i < maxSlots; i++) {
                html += `<div class="tb-slot-empty">Свободно</div>`;
            }
        }
        return html;
    };

    // Result for finished
    let resultHtml = '';
    if (isFinished) {
        const winner = alphaTotal > bravoTotal ? 'alpha' : (bravoTotal > alphaTotal ? 'bravo' : 'draw');
        const winnerName = winner === 'alpha' ? '🔵 АЛЬФА' : (winner === 'bravo' ? '🔴 БРАВО' : '🤝 НИЧЬЯ');
        const totalPot = (b.wager || 0) * allParticipants.length;
        resultHtml = `
            <div class="tb-result">
                <div class="tb-result__crown">${winner === 'draw' ? '🤝' : '👑'}</div>
                <div class="tb-result__text ${winner !== 'draw' ? 'tb-result__text--' + winner : ''}">${winnerName} ПОБЕДИЛА!</div>
                <div class="tb-result__prize">🧀 ${totalPot.toLocaleString('ru')} разделено между победителями</div>
            </div>`;
    }

    // Actions
    let actionsHtml = '';
    if (isWaiting && !iAmIn) {
        actionsHtml = `
            <div class="tb-card__actions">
                <button class="tb-join-btn tb-join-btn--alpha" ${alphaFull ? 'disabled' : ''} onclick="tbJoinBattle(${b.id}, 'alpha')">
                    🔵 АЛЬФА ${alphaPlayers.length}/${ts}
                </button>
                <button class="tb-join-btn tb-join-btn--bravo" ${bravoFull ? 'disabled' : ''} onclick="tbJoinBattle(${b.id}, 'bravo')">
                    🔴 БРАВО ${bravoPlayers.length}/${ts}
                </button>
            </div>`;
    } else if (isWaiting && iAmIn) {
        const readyBtnText = myReadyState?.is_ready ? '✅ Вы готовы (нажмите чтобы отменить)' : '⬜ Нажмите ГОТОВ';
        const readyBtnStyle = myReadyState?.is_ready
            ? 'background:rgba(34,197,94,0.15);color:#22c55e;border:1px solid rgba(34,197,94,0.25)'
            : 'background:rgba(245,190,11,0.12);color:#f5be0b;border:1px solid rgba(245,190,11,0.2)';
        actionsHtml = `
            <div class="tb-card__actions" style="flex-direction:column;gap:6px">
                <button class="tb-join-btn" onclick="tbToggleReady(${b.id})" style="flex:1;${readyBtnStyle}">
                    ${readyBtnText}
                </button>
                ${iAmCreator ? `
                    <button class="tb-join-btn" onclick="tbStartBattle(${b.id})" 
                        style="flex:1;${allReady ? 'background:linear-gradient(135deg,rgba(34,197,94,0.2),rgba(16,163,74,0.2));color:#22c55e;border:1px solid rgba(34,197,94,0.3)' : 'background:rgba(90,101,119,0.1);color:#5A6577;border:1px solid rgba(90,101,119,0.15)'}"
                        ${allReady ? '' : 'disabled'}>
                        🚀 ЗАПУСТИТЬ БОЙ ${allReady ? '' : '(ждём готовности)'}
                    </button>
                ` : `
                    <div style="text-align:center;font-size:0.55rem;color:#5A6577;padding:4px">
                        ${allReady ? '✅ Все готовы! Ждём запуска от создателя 👑' : `⏳ Ждём готовности всех игроков (${allParticipants.filter(p => p.is_ready).length}/${allParticipants.length})`}
                    </div>
                `}
            </div>`;
    } else if (isActive && iAmIn) {
        actionsHtml = `
            <div class="tb-card__actions">
                <button class="tb-join-btn" disabled style="flex:1;background:rgba(34,197,94,0.1);color:#22c55e;border:1px solid rgba(34,197,94,0.2)">
                    ⚔️ БИТВА ИДЁТ — играйте!
                </button>
            </div>`;
    }

    // Widget
    let widgetHtml = '';
    if ((isActive || isWaiting) && iAmIn) {
        widgetHtml = `
            <div style="padding:0 10px 10px">
                <button onclick="tbCopyWidgetLink(${b.id})" style="width:100%;padding:8px;border-radius:8px;border:1px dashed rgba(200,170,110,0.2);background:rgba(200,170,110,0.04);color:#C8AA6E;font-size:0.6rem;font-weight:700;cursor:pointer">
                    📺 Скопировать виджет OBS
                </button>
            </div>`;
    }

    // Timer
    const timerId = `tb-timer-${b.id}`;
    const hasDeadline = b.join_deadline && isWaiting;

    return `
        <div class="tb-card" id="tb-card-${b.id}">
            <div class="tb-card__header">
                <div class="tb-card__info">
                    <div class="tb-card__title">${cond.icon} Командный ${cond.name} ${ts}×${ts}</div>
                    <div class="tb-card__meta">
                        <span>⚔️ ${b.battles_count || 5} боёв</span>
                        <span class="tb-status tb-status--${b.status}">${
                            isWaiting ? '⏳ Набор' : (isActive ? '🔥 Бой' : '🏆 Итоги')
                        }</span>
                        ${tankFilterHtml}
                        ${b.creator_nickname ? `<span class="tb-creator-badge">👤 ${b.creator_nickname}</span>` : ''}
                    </div>
                </div>
                <div class="tb-card__bet">
                    <div class="tb-card__bet-amount">🧀 ${(b.wager || 0).toLocaleString('ru')}</div>
                    <div class="tb-card__bet-label">ставка</div>
                </div>
            </div>

            ${hasDeadline ? `
                <div class="tb-card__timer">
                    <span class="tb-card__timer-label">⏱ Вступление до:</span>
                    <span class="tb-card__timer-value" id="${timerId}">--:--</span>
                </div>
            ` : (isWaiting ? `
                <div class="tb-card__timer">
                    <span class="tb-card__timer-label">♾️ Без ограничения по времени</span>
                </div>
            ` : '')}

            ${isActive || isFinished ? `
                <div class="tb-score-bar">
                    <div class="tb-score-bar__alpha" style="width:${alphaPct}%"></div>
                    <div class="tb-score-bar__bravo" style="width:${100 - alphaPct}%"></div>
                </div>
            ` : ''}

            <div class="tb-card__teams">
                <div class="tb-team tb-team--alpha">
                    <div class="tb-team__header">
                        <span class="tb-team__name">🔵 АЛЬФА</span>
                        <span class="tb-team__count">${alphaPlayers.length}/${ts}</span>
                    </div>
                    <div class="tb-team__players">
                        ${renderPlayers(alphaPlayers, ts)}
                    </div>
                    ${isActive || isFinished ? `
                        <div class="tb-team__total"><span class="tb-team__total-label">Итого</span><span class="tb-team__total-value">${alphaTotal.toLocaleString('ru')}</span></div>
                    ` : ''}
                </div>
                <div class="tb-vs"><div class="tb-vs__badge">VS</div></div>
                <div class="tb-team tb-team--bravo">
                    <div class="tb-team__header">
                        <span class="tb-team__name">🔴 БРАВО</span>
                        <span class="tb-team__count">${bravoPlayers.length}/${ts}</span>
                    </div>
                    <div class="tb-team__players">
                        ${renderPlayers(bravoPlayers, ts)}
                    </div>
                    ${isActive || isFinished ? `
                        <div class="tb-team__total"><span class="tb-team__total-label">Итого</span><span class="tb-team__total-value">${bravoTotal.toLocaleString('ru')}</span></div>
                    ` : ''}
                </div>
            </div>
            ${actionsHtml}
            ${widgetHtml}
            ${resultHtml}
        </div>`;
}

// ============================================================
// CARD TIMER
// ============================================================
function tbStartCardTimer(battle) {
    if (battle.status !== 'waiting' || !battle.join_deadline) return;
    const el = document.getElementById(`tb-timer-${battle.id}`);
    if (!el) return;
    const endTime = new Date(battle.join_deadline).getTime();
    const tick = () => {
        const diff = endTime - Date.now();
        if (diff <= 0) { el.textContent = 'Время вышло!'; return; }
        const m = Math.floor(diff / 60000);
        const s = Math.floor((diff % 60000) / 1000);
        el.textContent = `${m}:${String(s).padStart(2, '0')}`;
        requestAnimationFrame(tick);
    };
    tick();
}

// ============================================================
// JOIN
// ============================================================
async function tbJoinBattle(battleId, team) {
    if (!myTelegramId) { showToast('❌ Не удалось определить ID'); return; }
    try {
        const resp = await fetch(`${BOT_API_URL}/api/team-battle/join`, {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ battle_id: battleId, telegram_id: myTelegramId, team,
                wot_nickname: localStorage.getItem('wot_nickname') || '',
                wot_account_id: localStorage.getItem('wot_account_id') || '' })
        });
        const data = await resp.json();
        if (data.success) { showToast(`✅ Вы в команде ${team === 'alpha' ? '🔵 АЛЬФА' : '🔴 БРАВО'}!`); tbLoadBattles(); }
        else showToast(`❌ ${data.error}`);
    } catch (e) { showToast('❌ Нет подключения'); }
}

// ============================================================
// TOGGLE READY
// ============================================================
async function tbToggleReady(battleId) {
    if (!myTelegramId) return;
    try {
        const resp = await fetch(`${BOT_API_URL}/api/team-battle/ready`, {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ battle_id: battleId, telegram_id: myTelegramId })
        });
        const data = await resp.json();
        if (data.success) {
            showToast(data.is_ready ? '✅ Вы готовы!' : '⬜ Готовность снята');
            tbLoadBattles();
        } else showToast(`❌ ${data.error}`);
    } catch (e) { showToast('❌ Нет подключения'); }
}

// ============================================================
// START BATTLE (creator only)
// ============================================================
async function tbStartBattle(battleId) {
    if (!myTelegramId) return;
    try {
        const resp = await fetch(`${BOT_API_URL}/api/team-battle/start`, {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ battle_id: battleId, telegram_id: myTelegramId })
        });
        const data = await resp.json();
        if (data.success) { showToast('🚀 Бой начался!'); tbLoadBattles(); }
        else showToast(`❌ ${data.error}`);
    } catch (e) { showToast('❌ Нет подключения'); }
}

// ============================================================
// COPY WIDGET
// ============================================================
function tbCopyWidgetLink(battleId) {
    const base = 'https://daviddavidov20022-commits.github.io/Mir-Tankov/site';
    const url = `${base}/tb-widget.html?battle_id=${battleId}`;
    navigator.clipboard.writeText(url).then(() => showToast('📋 Ссылка скопирована!')).catch(() => {
        const input = document.createElement('input'); input.value = url;
        document.body.appendChild(input); input.select(); document.execCommand('copy'); document.body.removeChild(input);
        showToast('📋 Ссылка скопирована!');
    });
}

// ============================================================
// CREATE FORM (with Nation/Class/Tier like Global)
// ============================================================
function tbRenderCreateForm() {
    const st = tbCreateState;
    const cond = TB_COND_MAP[st.condition];
    const container = document.getElementById('tb-panel-create');
    container.innerHTML = `
        <!-- Step 1: Condition -->
        <div class="tb-create-step">
            <div class="tb-step-header">
                <div class="tb-step-num">1</div>
                <div class="tb-step-title">Условие</div>
            </div>
            <div class="tb-cond-grid">
                ${Object.entries(TB_COND_MAP).map(([key, val]) => `
                    <button class="tb-cond-card ${st.condition === key ? 'active' : ''}" onclick="tbSetCondition('${key}')">
                        <div class="tb-cond-card__icon"><img src="${val.img}" style="width:28px;height:28px" onerror="this.outerHTML='${val.icon}'"></div>
                        <div class="tb-cond-card__name">${val.name}</div>
                    </button>
                `).join('')}
            </div>
        </div>

        <!-- Step 2: Tank filter (Nation / Class / Tier) -->
        <div class="tb-create-step">
            <div class="tb-step-header">
                <div class="tb-step-num">2</div>
                <div class="tb-step-title">🪖 Техника <span style="color:#5A6577;font-size:0.55rem;font-weight:400">(опционально)</span></div>
            </div>
            <div class="gc-admin__row" style="gap:6px">
                <div style="flex:1">
                    <label style="font-size:0.55rem;color:#5A6577;margin-bottom:4px;display:block">🌍 Нация</label>
                    <select id="tbTankNation" onchange="tbOnNationChange()" style="width:100%;padding:8px 10px;border-radius:8px;border:1px solid rgba(200,170,110,0.15);background:rgba(0,0,0,0.4);color:#E8E6E3;font-size:0.65rem;outline:none;font-family:Inter,sans-serif">
                        <option value="">🌍 Любая</option>
                    </select>
                </div>
                <div style="flex:1">
                    <label style="font-size:0.55rem;color:#5A6577;margin-bottom:4px;display:block">Класс</label>
                    <select id="tbTankClass" onchange="tbOnClassChange()" style="width:100%;padding:8px 10px;border-radius:8px;border:1px solid rgba(200,170,110,0.15);background:rgba(0,0,0,0.4);color:#E8E6E3;font-size:0.65rem;outline:none;font-family:Inter,sans-serif">
                        <option value="">Любой</option>
                    </select>
                </div>
                <div style="flex:1">
                    <label style="font-size:0.55rem;color:#5A6577;margin-bottom:4px;display:block">Уровень</label>
                    <select id="tbTankTier" onchange="tbOnTierChange()" style="width:100%;padding:8px 10px;border-radius:8px;border:1px solid rgba(200,170,110,0.15);background:rgba(0,0,0,0.4);color:#E8E6E3;font-size:0.65rem;outline:none;font-family:Inter,sans-serif">
                        <option value="0">Любой</option>
                    </select>
                </div>
            </div>
            <div id="tbTankPicker" style="display:none;max-height:160px;overflow-y:auto;margin-top:6px;background:rgba(0,0,0,0.2);border:1px solid rgba(200,170,110,0.1);border-radius:10px;padding:4px"></div>
            <div id="tbTankSelected" style="margin-top:6px;font-size:0.6rem;color:#4ade80"></div>
        </div>

        <!-- Step 3: Team size -->
        <div class="tb-create-step">
            <div class="tb-step-header">
                <div class="tb-step-num">3</div>
                <div class="tb-step-title">Размер команд</div>
            </div>
            <div class="tb-size-selector">
                ${[2, 3, 5, 10, 15, 20].map(s => `
                    <button class="tb-size-btn ${st.teamSize === s && !st.customSize ? 'active' : ''}" onclick="tbSetSize(${s})">${s}×${s}</button>
                `).join('')}
            </div>
            <div class="tb-size-custom">
                <span>Своё:</span>
                <input type="number" id="tbCustomSize" min="2" max="50" placeholder="2-50"
                    value="${st.customSize || ''}" onchange="tbSetCustomSize(this.value)">
                <span style="color:#C8AA6E">×</span>
                <input type="number" value="${st.customSize || st.teamSize}" disabled
                    style="width:60px;padding:8px 10px;border-radius:8px;border:1px solid rgba(200,170,110,0.15);background:rgba(0,0,0,0.3);color:#5A6577;font-size:0.8rem;text-align:center;opacity:0.5;font-family:Inter,sans-serif">
            </div>
        </div>

        <!-- Step 4: Battles -->
        <div class="tb-create-step">
            <div class="tb-step-header">
                <div class="tb-step-num">4</div>
                <div class="tb-step-title">Количество боёв</div>
            </div>
            <div class="tb-battles-selector">
                ${[1, 3, 5, 10, 20].map(n => `
                    <button class="tb-battles-btn ${st.battles === n ? 'active' : ''}" onclick="tbSetBattles(${n})">${n}</button>
                `).join('')}
            </div>
        </div>

        <!-- Step 5: Join time -->
        <div class="tb-create-step">
            <div class="tb-step-header">
                <div class="tb-step-num">5</div>
                <div class="tb-step-title">Время на вступление</div>
            </div>
            <div class="tb-timer-presets">
                <button class="tb-timer-btn ${st.joinTime === 0 ? 'active' : ''}" onclick="tbSetJoinTime(0)">♾️ Без лимита</button>
                ${[5, 10, 15, 30, 60].map(m => `
                    <button class="tb-timer-btn ${st.joinTime === m ? 'active' : ''}" onclick="tbSetJoinTime(${m})">${m} мин</button>
                `).join('')}
            </div>
        </div>

        <!-- Step 6: Wager -->
        <div class="tb-create-step">
            <div class="tb-step-header">
                <div class="tb-step-num">6</div>
                <div class="tb-step-title">Ставка 🧀 (каждый игрок)</div>
            </div>
            <div class="tb-wager-wrap">
                <span class="emoji">🧀</span>
                <input type="number" id="tbWagerInput" value="${st.wager}" min="50" step="10"
                    onchange="tbSetWager(parseInt(this.value))">
            </div>
            <div class="tb-wager-presets">
                ${[50, 100, 250, 500, 1000].map(w => `
                    <button class="tb-wager-preset" onclick="tbSetWager(${w})">${w}</button>
                `).join('')}
            </div>
            <div class="tb-wager-hint">
                Минимум 50 🧀 · Банк: 🧀 ${(st.wager * st.teamSize * 2).toLocaleString('ru')} (${st.teamSize * 2} × ${st.wager})
            </div>
        </div>

        <!-- Summary -->
        <div class="tb-create-step" style="background:linear-gradient(145deg,rgba(200,170,110,0.06),rgba(0,0,0,0.1));border-color:rgba(200,170,110,0.2)">
            <div class="tb-step-header" style="margin-bottom:8px">
                <div class="tb-step-num" style="background:linear-gradient(135deg,#4ade80,#16a34a)">✓</div>
                <div class="tb-step-title">Сводка</div>
            </div>
            <div style="display:flex;flex-direction:column;gap:6px;font-size:0.7rem">
                <div style="display:flex;justify-content:space-between"><span style="color:#5A6577">Условие</span><span style="color:#E8E6E3;font-weight:700">${cond.icon} ${cond.name}</span></div>
                ${st.tankName ? `<div style="display:flex;justify-content:space-between"><span style="color:#5A6577">Техника</span><span style="color:#a855f7;font-weight:700">🎯 ${st.tankName}</span></div>` : ''}
                <div style="display:flex;justify-content:space-between"><span style="color:#5A6577">Команды</span><span style="color:#E8E6E3;font-weight:700">${st.teamSize} × ${st.teamSize}</span></div>
                <div style="display:flex;justify-content:space-between"><span style="color:#5A6577">Боёв</span><span style="color:#E8E6E3;font-weight:700">${st.battles}</span></div>
                <div style="display:flex;justify-content:space-between"><span style="color:#5A6577">Время набора</span><span style="color:#E8E6E3;font-weight:700">${st.joinTime ? st.joinTime + ' мин' : '♾️ Без лимита'}</span></div>
                <div style="display:flex;justify-content:space-between"><span style="color:#5A6577">Старт</span><span style="color:#22c55e;font-weight:700">🖐 Ручной (все готовы → запуск)</span></div>
                <div style="display:flex;justify-content:space-between"><span style="color:#5A6577">Ставка</span><span style="color:#f5d36e;font-weight:700">🧀 ${st.wager}</span></div>
                <div style="display:flex;justify-content:space-between;padding-top:6px;border-top:1px solid rgba(200,170,110,0.1)">
                    <span style="color:#C8AA6E;font-weight:700">Банк победителей</span>
                    <span style="color:#4ade80;font-weight:700;font-size:0.85rem">🧀 ${(st.wager * st.teamSize * 2).toLocaleString('ru')}</span>
                </div>
            </div>
        </div>

        <button class="tb-create-btn" onclick="tbCreateBattle()">
            ⚔️ СОЗДАТЬ КОМАНДНЫЙ ЧЕЛЛЕНДЖ
        </button>
    `;

    // Load nations on first render
    tbLoadNations();
}

// State setters
function tbSetCondition(cond) { tbCreateState.condition = cond; tbRenderCreateForm(); }
function tbSetSize(size) { tbCreateState.teamSize = size; tbCreateState.customSize = null; tbRenderCreateForm(); }
function tbSetCustomSize(val) {
    const n = parseInt(val);
    if (n >= 2 && n <= 50) { tbCreateState.teamSize = n; tbCreateState.customSize = n; tbRenderCreateForm(); }
}
function tbSetBattles(n) { tbCreateState.battles = n; tbRenderCreateForm(); }
function tbSetJoinTime(m) { tbCreateState.joinTime = m; tbRenderCreateForm(); }
function tbSetWager(w) { if (w < 50) w = 50; tbCreateState.wager = w; tbRenderCreateForm(); }

// ============================================================
// TANK FILTER — Nation / Class / Tier (like Global)
// ============================================================
let _tbNationsLoaded = false;

async function tbLoadNations() {
    if (_tbNationsLoaded) return;
    const sel = document.getElementById('tbTankNation');
    if (!sel) return;
    sel.innerHTML = '<option value="">⏳ Загрузка...</option>';
    try {
        const resp = await fetch(`${BOT_API_URL}/api/global-challenge/tank-list`);
        const data = await resp.json();
        if (!data.nations) { sel.innerHTML = '<option value="">🌍 Любая</option>'; return; }
        sel.innerHTML = '<option value="">🌍 Любая</option>';
        data.nations.forEach(n => { sel.innerHTML += `<option value="${n.id}">${n.name}</option>`; });
        _tbNationsLoaded = true;
    } catch (e) {
        sel.innerHTML = '<option value="">❌ Ошибка</option>';
    }
}

async function tbOnNationChange() {
    const nation = document.getElementById('tbTankNation')?.value || '';
    const classEl = document.getElementById('tbTankClass');
    const tierEl = document.getElementById('tbTankTier');
    const tankEl = document.getElementById('tbTankPicker');
    if (classEl) classEl.innerHTML = '<option value="">Любой</option>';
    if (tierEl) tierEl.innerHTML = '<option value="0">Любой</option>';
    if (tankEl) { tankEl.innerHTML = ''; tankEl.style.display = 'none'; }
    tbCreateState.tankClass = ''; tbCreateState.tankTier = 0;
    tbClearTankSelection();
    if (!nation) return;
    try {
        const resp = await fetch(`${BOT_API_URL}/api/global-challenge/tank-list?nation=${nation}`);
        const data = await resp.json();
        if (!data.types || !classEl) return;
        classEl.innerHTML = '<option value="">Любой</option>';
        data.types.forEach(t => { classEl.innerHTML += `<option value="${t.id}">${t.name}</option>`; });
    } catch (e) {}
}

async function tbOnClassChange() {
    const nation = document.getElementById('tbTankNation')?.value || '';
    const cls = document.getElementById('tbTankClass')?.value || '';
    tbCreateState.tankClass = cls;
    const tierEl = document.getElementById('tbTankTier');
    const tankEl = document.getElementById('tbTankPicker');
    if (tierEl) tierEl.innerHTML = '<option value="0">Любой</option>';
    if (tankEl) { tankEl.innerHTML = ''; tankEl.style.display = 'none'; }
    tbCreateState.tankTier = 0;
    tbClearTankSelection();
    if (!nation || !cls) return;
    try {
        const resp = await fetch(`${BOT_API_URL}/api/global-challenge/tank-list?nation=${nation}&type=${cls}`);
        const data = await resp.json();
        if (!data.tiers || !tierEl) return;
        tierEl.innerHTML = '<option value="0">Любой</option>';
        data.tiers.forEach(t => { tierEl.innerHTML += `<option value="${t.id}">${t.name}</option>`; });
    } catch (e) {}
}

async function tbOnTierChange() {
    const nation = document.getElementById('tbTankNation')?.value || '';
    const cls = document.getElementById('tbTankClass')?.value || '';
    const tier = parseInt(document.getElementById('tbTankTier')?.value || '0');
    tbCreateState.tankTier = tier;
    const tankEl = document.getElementById('tbTankPicker');
    if (tankEl) { tankEl.innerHTML = ''; tankEl.style.display = 'none'; }
    tbClearTankSelection();
    if (!nation || !cls || !tier) return;
    try {
        if (tankEl) {
            tankEl.style.display = '';
            tankEl.innerHTML = '<div style="font-size:0.55rem;color:#5A6577;padding:6px;text-align:center">⏳ Загрузка...</div>';
        }
        const resp = await fetch(`${BOT_API_URL}/api/global-challenge/tank-list?nation=${nation}&type=${cls}&tier=${tier}`);
        const data = await resp.json();
        if (!data.tanks || !tankEl) return;
        if (!data.tanks.length) {
            tankEl.innerHTML = '<div style="font-size:0.55rem;color:#5A6577;padding:6px;text-align:center">Нет танков</div>';
            return;
        }
        const classIcons = { heavyTank: '🛡️', mediumTank: '⚙️', lightTank: '🏎️', 'AT-SPG': '🎯', SPG: '💣' };
        tankEl.innerHTML = data.tanks.map(t => `
            <div onclick="tbSelectTank(${t.id}, '${(t.name || '').replace(/'/g, "\\'")}', '${t.type || ''}', ${t.tier || 0})"
                 style="padding:7px 10px;font-size:0.65rem;color:#e0e0e0;cursor:pointer;border-bottom:1px solid rgba(255,255,255,0.04);display:flex;align-items:center;gap:6px;transition:background 0.15s;border-radius:6px"
                 onmouseover="this.style.background='rgba(200,170,110,0.1)'" onmouseout="this.style.background=''">
                <span>${classIcons[t.type] || ''}</span>
                <span style="flex:1;font-weight:500">${t.name}</span>
            </div>
        `).join('');
    } catch (e) {
        if (tankEl) tankEl.innerHTML = '<div style="font-size:0.55rem;color:#ff6b6b;padding:6px;text-align:center">❌ Ошибка</div>';
    }
}

function tbSelectTank(tankId, name, type, tier) {
    tbCreateState.tankId = tankId;
    tbCreateState.tankName = name;
    const tankEl = document.getElementById('tbTankPicker');
    const selEl = document.getElementById('tbTankSelected');
    if (tankEl) tankEl.style.display = 'none';
    const classNames = { heavyTank: '🛡️ТТ', mediumTank: '⚙️СТ', lightTank: '🏎️ЛТ', 'AT-SPG': '🎯ПТ', SPG: '💣САУ' };
    const tierLabels = ['', 'I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII', 'IX', 'X'];
    if (selEl) {
        selEl.innerHTML = `
            <div style="display:inline-flex;align-items:center;gap:6px;padding:6px 12px;background:rgba(74,222,128,0.08);border:1px solid rgba(74,222,128,0.2);border-radius:10px;font-size:0.65rem">
                <span style="color:#C8AA6E;font-weight:700">${tierLabels[tier] || '?'}</span>
                <span>${classNames[type] || ''}</span>
                <span style="color:#4ade80;font-weight:600">${name}</span>
                <span onclick="tbClearTankSelection()" style="cursor:pointer;color:#ff6b6b;font-size:0.8rem;margin-left:4px">✕</span>
            </div>`;
    }
    showToast(`🪖 Выбран: ${name}`);
}

function tbClearTankSelection() {
    tbCreateState.tankId = null;
    tbCreateState.tankName = null;
    const selEl = document.getElementById('tbTankSelected');
    if (selEl) selEl.innerHTML = '';
}

// ============================================================
// CREATE BATTLE
// ============================================================
async function tbCreateBattle() {
    const st = tbCreateState;
    if (!myTelegramId) { showToast('❌ Не удалось определить ID'); return; }
    if (st.wager < 50) { showToast('❌ Минимальная ставка — 50 🧀'); return; }

    const btn = document.querySelector('.tb-create-btn');
    if (btn) { btn.disabled = true; btn.textContent = '⏳ Создаём...'; }

    try {
        const resp = await fetch(`${BOT_API_URL}/api/team-battle/create`, {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                telegram_id: myTelegramId,
                condition: st.condition,
                team_size: st.teamSize,
                battles_count: st.battles,
                join_time_minutes: st.joinTime,
                wager: st.wager,
                wot_nickname: localStorage.getItem('wot_nickname') || '',
                wot_account_id: localStorage.getItem('wot_account_id') || '',
                tank_id_filter: st.tankId || 0,
                tank_name_filter: st.tankName || '',
                tank_tier_filter: st.tankTier || 0,
                tank_class: st.tankClass || '',
            })
        });
        const data = await resp.json();
        if (data.success) {
            showToast(`✅ Командный челлендж создан! ${st.teamSize}×${st.teamSize}`);
            tbSwitchSubTab('browse');
        } else {
            showToast(`❌ ${data.error}`);
            if (btn) { btn.disabled = false; btn.textContent = '⚔️ СОЗДАТЬ КОМАНДНЫЙ ЧЕЛЛЕНДЖ'; }
        }
    } catch (e) {
        showToast('❌ Нет подключения');
        if (btn) { btn.disabled = false; btn.textContent = '⚔️ СОЗДАТЬ КОМАНДНЫЙ ЧЕЛЛЕНДЖ'; }
    }
}

// ============================================================
// MAIN HISTORY — for global "История" tab
// ============================================================
async function tbLoadHistoryMain() {
    const el = document.getElementById('tbHistoryMainList');
    if (!el) return;
    try {
        const resp = await fetch(`${BOT_API_URL}/api/team-battle/history?telegram_id=${myTelegramId}`);
        const data = await resp.json();
        const battles = data.battles || [];
        if (battles.length === 0) {
            el.innerHTML = `<div style="text-align:center;color:#5A6577;font-size:0.7rem;padding:16px">Нет завершённых командных боёв</div>`;
            return;
        }
        el.innerHTML = battles.slice(0, 10).map(b => {
            const cond = TB_COND_MAP[b.condition] || TB_COND_MAP.damage;
            const alphaPlayers = b.team_alpha || [];
            const bravoPlayers = b.team_bravo || [];
            const alphaTotal = alphaPlayers.reduce((s, p) => s + (p.current_value || 0), 0);
            const bravoTotal = bravoPlayers.reduce((s, p) => s + (p.current_value || 0), 0);
            const winner = b.winner_team;
            const winLabel = winner === 'alpha' ? '🔵 АЛЬФА' : (winner === 'bravo' ? '🔴 БРАВО' : '🤝 НИЧЬЯ');
            const totalPot = (b.wager || 0) * (alphaPlayers.length + bravoPlayers.length);
            const iParticipated = b.my_participation;
            const tankInfo = b.tank_name_filter ? ` · 🎯 ${b.tank_name_filter}` : '';
            return `<div style="padding:10px 12px;margin-bottom:6px;border-radius:10px;background:rgba(0,0,0,0.15);border:1px solid rgba(200,170,110,0.08)">
                <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px">
                    <span style="font-size:0.7rem;font-weight:700;color:#E8E6E3">${cond.icon} ${b.team_size}×${b.team_size} ${cond.name}${tankInfo}</span>
                    <span style="font-size:0.6rem;padding:2px 8px;border-radius:8px;background:rgba(200,170,110,0.1);color:#C8AA6E">🏆 Завершён</span>
                </div>
                <div style="display:flex;justify-content:space-between;font-size:0.65rem;margin-bottom:4px">
                    <span style="color:${winner === 'alpha' ? '#60a5fa' : '#5A6577'}">🔵 ${alphaTotal.toLocaleString('ru')}</span>
                    <span style="font-weight:700;color:${winner === 'alpha' ? '#60a5fa' : (winner === 'bravo' ? '#f87171' : '#C8AA6E')}">${winLabel}</span>
                    <span style="color:${winner === 'bravo' ? '#f87171' : '#5A6577'}">🔴 ${bravoTotal.toLocaleString('ru')}</span>
                </div>
                <div style="display:flex;justify-content:space-between;font-size:0.6rem;color:#5A6577">
                    <span>🧀 ${totalPot.toLocaleString('ru')} банк</span>
                    ${iParticipated ? '<span style="color:#4ade80">✅ Вы участвовали</span>' : ''}
                </div>
            </div>`;
        }).join('');
    } catch (e) {
        el.innerHTML = `<div style="text-align:center;color:#f87171;font-size:0.7rem;padding:16px">Ошибка загрузки</div>`;
    }
}

// ============================================================
// PLAYER DETAIL MODAL — per-tank breakdown
// ============================================================
async function tbShowPlayerDetail(battleId, telegramId) {
    // Create modal if not exists
    let modal = document.getElementById('tb-player-modal');
    if (!modal) {
        modal = document.createElement('div');
        modal.id = 'tb-player-modal';
        modal.innerHTML = `
            <div class="tb-modal-backdrop" onclick="tbClosePlayerModal()"></div>
            <div class="tb-modal-content">
                <div class="tb-modal-header">
                    <div class="tb-modal-title" id="tb-modal-title">Детали игрока</div>
                    <button class="tb-modal-close" onclick="tbClosePlayerModal()">×</button>
                </div>
                <div class="tb-modal-body" id="tb-modal-body">
                    <div style="text-align:center;padding:20px;color:#5A6577">⏳ Загрузка...</div>
                </div>
            </div>`;
        document.body.appendChild(modal);
    }

    modal.style.display = 'flex';
    document.getElementById('tb-modal-body').innerHTML = '<div style="text-align:center;padding:20px;color:#5A6577">⏳ Загрузка деталей...</div>';

    try {
        const resp = await fetch(`${BOT_API_URL}/api/team-battle/player-tanks?battle_id=${battleId}&telegram_id=${telegramId}`);
        const data = await resp.json();
        if (data.error) {
            document.getElementById('tb-modal-body').innerHTML = `<div style="text-align:center;padding:20px;color:#f87171">❌ ${data.error}</div>`;
            return;
        }

        const player = data.player;
        const tanks = data.tanks || [];
        const condInfo = TB_COND_MAP[data.condition] || TB_COND_MAP.damage;
        const teamColor = player.team === 'alpha' ? '#60a5fa' : '#f87171';
        const teamName = player.team === 'alpha' ? '🔵 АЛЬФА' : '🔴 БРАВО';

        document.getElementById('tb-modal-title').innerHTML = `
            <span style="color:${teamColor}">${player.nickname || 'Танкист'}</span>
            <span style="font-size:0.55rem;color:#5A6577;font-weight:400;margin-left:6px">${teamName}</span>`;

        if (tanks.length === 0) {
            document.getElementById('tb-modal-body').innerHTML = `
                <div style="text-align:center;padding:20px;color:#5A6577">
                    <div style="font-size:1.5rem;margin-bottom:8px">🎮</div>
                    <div>Ещё нет сыгранных боёв</div>
                </div>`;
            return;
        }

        // Summary bar
        let html = `
            <div style="display:flex;justify-content:space-around;padding:12px;margin-bottom:12px;background:rgba(0,0,0,0.2);border-radius:10px">
                <div style="text-align:center">
                    <div style="font-size:1.1rem;font-weight:700;color:#C8AA6E">${(player.total_value || 0).toLocaleString('ru')}</div>
                    <div style="font-size:0.55rem;color:#5A6577">${condInfo.icon} ${condInfo.unit}</div>
                </div>
                <div style="text-align:center">
                    <div style="font-size:1.1rem;font-weight:700;color:#E8E6E3">${player.battles_played || 0}</div>
                    <div style="font-size:0.55rem;color:#5A6577">⚔️ боёв</div>
                </div>
                <div style="text-align:center">
                    <div style="font-size:1.1rem;font-weight:700;color:#a855f7">${tanks.length}</div>
                    <div style="font-size:0.55rem;color:#5A6577">🪖 танков</div>
                </div>
            </div>`;

        // Per-tank rows
        const maxVal = tanks.length > 0 ? Math.max(...tanks.map(t => t.stat_value || 0)) : 1;
        html += `<div style="display:flex;flex-direction:column;gap:6px">`;
        for (const t of tanks) {
            const pct = Math.round(((t.stat_value || 0) / maxVal) * 100);
            const tierLabel = t.tier_label || '?';
            const classLabel = t.class_label || '';
            html += `
                <div style="position:relative;padding:10px 12px;border-radius:10px;background:rgba(0,0,0,0.15);border:1px solid rgba(200,170,110,0.08);overflow:hidden">
                    <div style="position:absolute;left:0;top:0;bottom:0;width:${pct}%;background:linear-gradient(90deg,rgba(168,85,247,0.12),rgba(168,85,247,0.03));border-radius:10px"></div>
                    <div style="position:relative;display:flex;justify-content:space-between;align-items:center">
                        <div style="display:flex;align-items:center;gap:6px;min-width:0;flex:1">
                            <span style="display:inline-block;min-width:22px;text-align:center;padding:2px 5px;border-radius:4px;background:rgba(200,170,110,0.12);color:#C8AA6E;font-size:0.6rem;font-weight:700">${tierLabel}</span>
                            <span style="font-size:0.6rem;color:#5A6577">${classLabel}</span>
                            <span style="font-size:0.7rem;font-weight:600;color:#E8E6E3;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${t.tank_name || 'Tank'}</span>
                        </div>
                        <div style="display:flex;flex-direction:column;align-items:flex-end;flex-shrink:0;margin-left:8px">
                            <span style="font-size:0.75rem;font-weight:700;color:#c084fc">${(t.stat_value || 0).toLocaleString('ru')}</span>
                            <span style="font-size:0.5rem;color:#5A6577">${t.battles_count || 0} ${t.battles_count === 1 ? 'бой' : 'боёв'}</span>
                        </div>
                    </div>
                </div>`;
        }
        html += `</div>`;

        document.getElementById('tb-modal-body').innerHTML = html;
    } catch (e) {
        document.getElementById('tb-modal-body').innerHTML = `<div style="text-align:center;padding:20px;color:#f87171">❌ Ошибка загрузки</div>`;
    }
}

function tbClosePlayerModal() {
    const modal = document.getElementById('tb-player-modal');
    if (modal) modal.style.display = 'none';
}
