/**
 * Team Battle JS — Команда на Команду
 * Любой подписчик может создать командный челлендж.
 * Играют на сыр, минимальная ставка 50.
 */

const TB_COND_MAP = {
    damage:   { icon: '💥', name: 'Урон',    unit: 'урона' },
    frags:    { icon: '🎯', name: 'Фраги',   unit: 'фрагов' },
    xp:      { icon: '⭐', name: 'Опыт',    unit: 'опыта' },
    spotting: { icon: '👁', name: 'Засвет',  unit: 'засвета' },
    blocked:  { icon: '🛡️', name: 'Блок',    unit: 'блока' },
    wins:    { icon: '🏆', name: 'Победы',  unit: 'побед' },
};

// ── State ──
let tbSubTab = 'browse'; // 'browse' | 'create' | 'my' | 'history'
let tbBattles = [];
let tbCreateState = {
    condition: 'damage',
    teamSize: 5,
    customSize: null,
    joinTime: 5,
    wager: 100,
    battles: 5,
    // Tank filters
    tankClass: null,
    tankTier: null,
    tankId: null,
    tankName: null,
    tankSearchResults: [],
};
let _tbRefreshInterval = null;

// ============================================================
// INIT — called when Team tab is activated
// ============================================================
function tbInit() {
    tbRenderSubTabs();
    tbSwitchSubTab('browse');
    // Auto-refresh active battles every 15s
    clearInterval(_tbRefreshInterval);
    _tbRefreshInterval = setInterval(() => {
        if (tbSubTab === 'browse' || tbSubTab === 'my') {
            tbLoadBattles();
        }
    }, 15000);
}

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
// BROWSE — Load active team battles
// ============================================================
async function tbLoadBattles() {
    const browseEl = document.getElementById('tb-browse-list');
    const myEl = document.getElementById('tb-my-list');

    try {
        const resp = await fetch(`${BOT_API_URL}/api/team-battle/list?telegram_id=${myTelegramId}`);
        const data = await resp.json();
        tbBattles = data.battles || [];

        // Browse: all non-finished
        const active = tbBattles.filter(b => b.status !== 'finished');
        if (active.length === 0) {
            browseEl.innerHTML = `
                <div class="tb-empty">
                    <div class="tb-empty__icon">⚔️</div>
                    <div class="tb-empty__title">Нет активных битв</div>
                    <div class="tb-empty__desc">Создай командный челлендж первым!<br>Нажми «Создать» выше.</div>
                </div>`;
        } else {
            browseEl.innerHTML = active.map(b => tbRenderBattleCard(b)).join('');
            active.forEach(b => tbStartCardTimer(b));
        }

        // My: battles where I participate
        const myBattles = tbBattles.filter(b => {
            const allP = [...(b.team_alpha || []), ...(b.team_bravo || [])];
            return allP.some(p => String(p.telegram_id) === String(myTelegramId));
        });

        if (myBattles.length === 0) {
            myEl.innerHTML = `
                <div class="tb-empty">
                    <div class="tb-empty__icon">📋</div>
                    <div class="tb-empty__title">Вы пока не участвуете</div>
                    <div class="tb-empty__desc">Присоединитесь к битве или создайте свою!</div>
                </div>`;
        } else {
            myEl.innerHTML = myBattles.map(b => tbRenderBattleCard(b, true)).join('');
            myBattles.forEach(b => tbStartCardTimer(b));
        }
    } catch (e) {
        console.error('TB load error:', e);
        browseEl.innerHTML = `<div class="tb-empty"><div class="tb-empty__icon">⚠️</div><div class="tb-empty__desc">Ошибка загрузки</div></div>`;
    }
}

// ============================================================
// HISTORY — Load finished battles
// ============================================================
async function tbLoadHistory() {
    const el = document.getElementById('tb-history-list');
    if (!el) return;

    try {
        const resp = await fetch(`${BOT_API_URL}/api/team-battle/history?telegram_id=${myTelegramId}`);
        const data = await resp.json();
        const battles = data.battles || [];

        if (battles.length === 0) {
            el.innerHTML = `
                <div class="tb-empty">
                    <div class="tb-empty__icon">📜</div>
                    <div class="tb-empty__title">Нет истории</div>
                    <div class="tb-empty__desc">Здесь будут завершённые командные бои</div>
                </div>`;
            return;
        }

        el.innerHTML = battles.map(b => tbRenderBattleCard(b, false, true)).join('');
    } catch (e) {
        el.innerHTML = `<div class="tb-empty"><div class="tb-empty__icon">⚠️</div><div class="tb-empty__desc">Ошибка загрузки истории</div></div>`;
    }
}

// ============================================================
// RENDER BATTLE CARD
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
    const bravoPct = 100 - alphaPct;

    const myTgStr = String(myTelegramId);
    const iAmAlpha = alphaPlayers.some(p => String(p.telegram_id) === myTgStr);
    const iAmBravo = bravoPlayers.some(p => String(p.telegram_id) === myTgStr);
    const iAmIn = iAmAlpha || iAmBravo;

    const alphaFull = alphaPlayers.length >= ts;
    const bravoFull = bravoPlayers.length >= ts;
    const isWaiting = b.status === 'waiting';
    const isActive = b.status === 'active';
    const isFinished = b.status === 'finished';

    const timerId = `tb-timer-${b.id}`;

    // Tank filter info
    let tankFilterHtml = '';
    if (b.tank_name_filter) {
        tankFilterHtml = `<span style="color:#a855f7">🎯 ${b.tank_name_filter}</span>`;
    } else if (b.tank_tier_filter) {
        const tierNames = {1:'I',2:'II',3:'III',4:'IV',5:'V',6:'VI',7:'VII',8:'VIII',9:'IX',10:'X'};
        tankFilterHtml = `<span style="color:#a855f7">Уровень ${tierNames[b.tank_tier_filter] || b.tank_tier_filter}</span>`;
    }

    // Build player rows
    const renderPlayers = (players, maxSlots, teamClass) => {
        let html = '';
        for (let i = 0; i < players.length; i++) {
            const p = players[i];
            const isMe = String(p.telegram_id) === myTgStr;
            html += `<div class="tb-player ${isMe ? 'tb-player--me' : ''}">
                <span class="tb-player__name">${p.nickname || 'Танкист'}${p.is_creator ? ' <span class="tb-creator-badge">👑</span>' : ''}</span>
                <span class="tb-player__value">${isActive || isFinished ? (p.current_value || 0).toLocaleString('ru') : '—'}</span>
            </div>`;
        }
        for (let i = players.length; i < maxSlots; i++) {
            html += `<div class="tb-slot-empty">Свободно</div>`;
        }
        return html;
    };

    // Result for finished
    let resultHtml = '';
    if (isFinished) {
        const winner = alphaTotal > bravoTotal ? 'alpha' : (bravoTotal > alphaTotal ? 'bravo' : 'draw');
        const winnerName = winner === 'alpha' ? '🔵 АЛЬФА' : (winner === 'bravo' ? '🔴 БРАВО' : '🤝 НИЧЬЯ');
        const totalPot = (b.wager || 0) * (alphaPlayers.length + bravoPlayers.length);
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
                    🔵 В АЛЬФУ ${alphaPlayers.length}/${ts}
                </button>
                <button class="tb-join-btn tb-join-btn--bravo" ${bravoFull ? 'disabled' : ''} onclick="tbJoinBattle(${b.id}, 'bravo')">
                    🔴 В БРАВО ${bravoPlayers.length}/${ts}
                </button>
            </div>`;
    } else if (isWaiting && iAmIn) {
        actionsHtml = `
            <div class="tb-card__actions">
                <button class="tb-join-btn" disabled style="flex:1;background:rgba(34,197,94,0.1);color:#22c55e;border:1px solid rgba(34,197,94,0.2)">
                    ✅ Вы в команде ${iAmAlpha ? '🔵 АЛЬФА' : '🔴 БРАВО'}
                </button>
            </div>`;
    } else if (isActive && iAmIn) {
        actionsHtml = `
            <div class="tb-card__actions">
                <button class="tb-join-btn" disabled style="flex:1;background:rgba(34,197,94,0.1);color:#22c55e;border:1px solid rgba(34,197,94,0.2)">
                    ⚔️ БИТВА ИДЁТ — играйте!
                </button>
            </div>`;
    }

    // Widget link
    let widgetHtml = '';
    if ((isActive || isWaiting) && iAmIn) {
        const widgetUrl = `${location.origin}${location.pathname.replace(/[^/]*$/, '')}tb-widget.html?battle_id=${b.id}`;
        widgetHtml = `
            <div style="padding:0 10px 10px">
                <button onclick="tbCopyWidgetLink(${b.id})" style="width:100%;padding:8px;border-radius:8px;border:1px dashed rgba(200,170,110,0.2);background:rgba(200,170,110,0.04);color:#C8AA6E;font-size:0.6rem;font-weight:700;cursor:pointer">
                    📺 Скопировать виджет OBS
                </button>
            </div>`;
    }

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

            ${isWaiting ? `
                <div class="tb-card__timer">
                    <span class="tb-card__timer-label">⏱ Вступление до:</span>
                    <span class="tb-card__timer-value" id="${timerId}">--:--</span>
                </div>
            ` : ''}

            ${isActive || isFinished ? `
                <div class="tb-score-bar">
                    <div class="tb-score-bar__alpha" style="width:${alphaPct}%"></div>
                    <div class="tb-score-bar__bravo" style="width:${bravoPct}%"></div>
                </div>
            ` : ''}

            <div class="tb-card__teams">
                <div class="tb-team tb-team--alpha">
                    <div class="tb-team__header">
                        <span class="tb-team__name">🔵 АЛЬФА</span>
                        <span class="tb-team__count">${alphaPlayers.length}/${ts}</span>
                    </div>
                    <div class="tb-team__players">
                        ${renderPlayers(alphaPlayers, Math.min(ts, isWaiting ? ts : alphaPlayers.length), 'alpha')}
                    </div>
                    ${isActive || isFinished ? `
                        <div class="tb-team__total">
                            <span class="tb-team__total-label">Итого</span>
                            <span class="tb-team__total-value">${alphaTotal.toLocaleString('ru')}</span>
                        </div>
                    ` : ''}
                </div>

                <div class="tb-vs">
                    <div class="tb-vs__badge">VS</div>
                </div>

                <div class="tb-team tb-team--bravo">
                    <div class="tb-team__header">
                        <span class="tb-team__name">🔴 БРАВО</span>
                        <span class="tb-team__count">${bravoPlayers.length}/${ts}</span>
                    </div>
                    <div class="tb-team__players">
                        ${renderPlayers(bravoPlayers, Math.min(ts, isWaiting ? ts : bravoPlayers.length), 'bravo')}
                    </div>
                    ${isActive || isFinished ? `
                        <div class="tb-team__total">
                            <span class="tb-team__total-label">Итого</span>
                            <span class="tb-team__total-value">${bravoTotal.toLocaleString('ru')}</span>
                        </div>
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
    if (battle.status !== 'waiting') return;
    const el = document.getElementById(`tb-timer-${battle.id}`);
    if (!el) return;

    const endTime = new Date(battle.join_deadline).getTime();

    const tick = () => {
        const now = Date.now();
        const diff = endTime - now;
        if (diff <= 0) {
            el.textContent = 'Время вышло!';
            return;
        }
        const m = Math.floor(diff / 60000);
        const s = Math.floor((diff % 60000) / 1000);
        el.textContent = `${m}:${String(s).padStart(2, '0')}`;
        requestAnimationFrame(tick);
    };
    tick();
}

// ============================================================
// JOIN BATTLE
// ============================================================
async function tbJoinBattle(battleId, team) {
    if (!myTelegramId) {
        showToast('❌ Не удалось определить ваш ID');
        return;
    }

    try {
        const resp = await fetch(`${BOT_API_URL}/api/team-battle/join`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                battle_id: battleId,
                telegram_id: myTelegramId,
                team: team,
                wot_nickname: localStorage.getItem('wot_nickname') || '',
                wot_account_id: localStorage.getItem('wot_account_id') || '',
            })
        });
        const data = await resp.json();
        if (data.success) {
            showToast(`✅ Вы вступили в команду ${team === 'alpha' ? '🔵 АЛЬФА' : '🔴 БРАВО'}!`);
            tbLoadBattles();
        } else {
            showToast(`❌ ${data.error}`);
        }
    } catch (e) {
        showToast('❌ Нет подключения к серверу');
    }
}

// ============================================================
// COPY WIDGET LINK
// ============================================================
function tbCopyWidgetLink(battleId) {
    // Use GitHub Pages URL for the widget
    const base = 'https://daviddavidov20022-commits.github.io/Mir-Tankov/site';
    const url = `${base}/tb-widget.html?battle_id=${battleId}`;
    navigator.clipboard.writeText(url).then(() => {
        showToast('📋 Ссылка скопирована! Добавьте в OBS → Браузер');
    }).catch(() => {
        // Fallback
        const input = document.createElement('input');
        input.value = url;
        document.body.appendChild(input);
        input.select();
        document.execCommand('copy');
        document.body.removeChild(input);
        showToast('📋 Ссылка скопирована!');
    });
}

// ============================================================
// CREATE FORM  (with tank filter)
// ============================================================
function tbRenderCreateForm() {
    const st = tbCreateState;
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
                        <div class="tb-cond-card__icon">${val.icon}</div>
                        <div class="tb-cond-card__name">${val.name}</div>
                    </button>
                `).join('')}
            </div>
        </div>

        <!-- Step 2: Tank filter -->
        <div class="tb-create-step">
            <div class="tb-step-header">
                <div class="tb-step-num">2</div>
                <div class="tb-step-title">Техника <span style="color:#5A6577;font-size:0.6rem;font-family:Inter,sans-serif">(необязательно)</span></div>
            </div>
            <div style="margin-bottom:8px">
                <input type="text" id="tbTankSearch" placeholder="🔍 Поиск танка (например ИС-7, Maus)..."
                    style="width:100%;padding:10px 14px;border-radius:10px;border:1px solid rgba(200,170,110,0.15);background:rgba(0,0,0,0.3);color:#E8E6E3;font-size:0.75rem;outline:none;box-sizing:border-box;font-family:Inter,sans-serif"
                    oninput="tbSearchTank(this.value)">
                <div id="tbTankResults" style="margin-top:6px;max-height:140px;overflow-y:auto"></div>
            </div>
            ${st.tankName ? `
                <div style="display:flex;align-items:center;gap:8px;padding:8px 12px;background:rgba(168,85,247,0.1);border:1px solid rgba(168,85,247,0.2);border-radius:10px">
                    <span style="font-size:0.7rem;color:#a855f7;font-weight:700">🎯 ${st.tankName}</span>
                    <button onclick="tbClearTank()" style="margin-left:auto;background:none;border:none;color:#f87171;cursor:pointer;font-size:0.7rem">✕</button>
                </div>
            ` : ''}
            <div style="margin-top:8px">
                <div style="font-size:0.6rem;color:#5A6577;margin-bottom:6px">Или фильтр по уровню:</div>
                <div style="display:flex;gap:4px;flex-wrap:wrap">
                    ${[0,6,7,8,9,10].map(t => {
                        const label = t === 0 ? 'Все' : ['','I','II','III','IV','V','VI','VII','VIII','IX','X'][t];
                        return `<button class="tb-timer-btn ${(st.tankTier||0) === t ? 'active' : ''}" onclick="tbSetTankTier(${t})" style="min-width:40px;padding:6px">${label}</button>`;
                    }).join('')}
                </div>
            </div>
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
                <input type="number" value="${st.customSize || st.teamSize}" disabled style="width:60px;padding:8px 10px;border-radius:8px;border:1px solid rgba(200,170,110,0.15);background:rgba(0,0,0,0.3);color:#5A6577;font-size:0.8rem;text-align:center;opacity:0.5;font-family:Inter,sans-serif">
            </div>
        </div>

        <!-- Step 4: Battles count -->
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
                ${[3, 5, 10, 15, 30].map(m => `
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
                Минимум 50 🧀 · Банк: 🧀 ${(st.wager * st.teamSize * 2).toLocaleString('ru')} (${st.teamSize * 2} игроков × ${st.wager} 🧀)
            </div>
        </div>

        <!-- Summary & Create -->
        <div class="tb-create-step" style="background:linear-gradient(145deg,rgba(200,170,110,0.06),rgba(0,0,0,0.1));border-color:rgba(200,170,110,0.2);">
            <div class="tb-step-header" style="margin-bottom:8px">
                <div class="tb-step-num" style="background:linear-gradient(135deg,#4ade80,#16a34a)">✓</div>
                <div class="tb-step-title">Сводка</div>
            </div>
            <div style="display:flex;flex-direction:column;gap:6px;font-size:0.7rem">
                <div style="display:flex;justify-content:space-between">
                    <span style="color:#5A6577">Условие</span>
                    <span style="color:#E8E6E3;font-weight:700">${TB_COND_MAP[st.condition].icon} ${TB_COND_MAP[st.condition].name}</span>
                </div>
                ${st.tankName ? `<div style="display:flex;justify-content:space-between">
                    <span style="color:#5A6577">Техника</span>
                    <span style="color:#a855f7;font-weight:700">🎯 ${st.tankName}</span>
                </div>` : ''}
                ${st.tankTier ? `<div style="display:flex;justify-content:space-between">
                    <span style="color:#5A6577">Уровень</span>
                    <span style="color:#a855f7;font-weight:700">${['','I','II','III','IV','V','VI','VII','VIII','IX','X'][st.tankTier]}</span>
                </div>` : ''}
                <div style="display:flex;justify-content:space-between">
                    <span style="color:#5A6577">Команды</span>
                    <span style="color:#E8E6E3;font-weight:700">${st.teamSize} × ${st.teamSize}</span>
                </div>
                <div style="display:flex;justify-content:space-between">
                    <span style="color:#5A6577">Боёв</span>
                    <span style="color:#E8E6E3;font-weight:700">${st.battles}</span>
                </div>
                <div style="display:flex;justify-content:space-between">
                    <span style="color:#5A6577">Время набора</span>
                    <span style="color:#E8E6E3;font-weight:700">${st.joinTime} мин</span>
                </div>
                <div style="display:flex;justify-content:space-between">
                    <span style="color:#5A6577">Ставка каждого</span>
                    <span style="color:#f5d36e;font-weight:700">🧀 ${st.wager}</span>
                </div>
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
}

// State setters
function tbSetCondition(cond) {
    tbCreateState.condition = cond;
    tbRenderCreateForm();
}

function tbSetSize(size) {
    tbCreateState.teamSize = size;
    tbCreateState.customSize = null;
    tbRenderCreateForm();
}

function tbSetCustomSize(val) {
    const n = parseInt(val);
    if (n >= 2 && n <= 50) {
        tbCreateState.teamSize = n;
        tbCreateState.customSize = n;
        tbRenderCreateForm();
    }
}

function tbSetBattles(n) {
    tbCreateState.battles = n;
    tbRenderCreateForm();
}

function tbSetJoinTime(m) {
    tbCreateState.joinTime = m;
    tbRenderCreateForm();
}

function tbSetWager(w) {
    if (w < 50) w = 50;
    tbCreateState.wager = w;
    tbRenderCreateForm();
}

// Tank search
let _tbSearchTimeout = null;
async function tbSearchTank(query) {
    clearTimeout(_tbSearchTimeout);
    const el = document.getElementById('tbTankResults');
    if (!query || query.length < 2) {
        el.innerHTML = '';
        return;
    }
    _tbSearchTimeout = setTimeout(async () => {
        try {
            const resp = await fetch(`${BOT_API_URL}/api/global-challenge/search-tanks?search=${encodeURIComponent(query)}&limit=8`);
            const data = await resp.json();
            const tanks = data.tanks || [];
            if (tanks.length === 0) {
                el.innerHTML = `<div style="font-size:0.6rem;color:#5A6577;padding:6px">Не найдено</div>`;
                return;
            }
            el.innerHTML = tanks.map(t => `
                <div onclick="tbSelectTank(${t.tank_id}, '${(t.name||'').replace(/'/g,"\\'")}', ${t.tier || 0})"
                    style="padding:8px 10px;border-radius:8px;cursor:pointer;display:flex;justify-content:space-between;align-items:center;font-size:0.65rem;transition:background 0.15s;border:1px solid transparent"
                    onmouseover="this.style.background='rgba(200,170,110,0.08)';this.style.borderColor='rgba(200,170,110,0.15)'"
                    onmouseout="this.style.background='none';this.style.borderColor='transparent'">
                    <span style="color:#E8E6E3;font-weight:600">${t.name}</span>
                    <span style="color:#5A6577">Ур. ${t.tier || '?'}</span>
                </div>
            `).join('');
        } catch (e) {
            el.innerHTML = `<div style="font-size:0.6rem;color:#f87171;padding:6px">Ошибка поиска</div>`;
        }
    }, 300);
}

function tbSelectTank(tankId, tankName, tier) {
    tbCreateState.tankId = tankId;
    tbCreateState.tankName = tankName;
    tbCreateState.tankTier = tier || null;
    tbRenderCreateForm();
}

function tbClearTank() {
    tbCreateState.tankId = null;
    tbCreateState.tankName = null;
    tbRenderCreateForm();
}

function tbSetTankTier(tier) {
    tbCreateState.tankTier = tier || null;
    tbCreateState.tankId = null;
    tbCreateState.tankName = null;
    tbRenderCreateForm();
}

// ============================================================
// CREATE BATTLE
// ============================================================
async function tbCreateBattle() {
    const st = tbCreateState;
    if (!myTelegramId) {
        showToast('❌ Не удалось определить ваш ID');
        return;
    }
    if (st.wager < 50) {
        showToast('❌ Минимальная ставка — 50 🧀');
        return;
    }

    const btn = document.querySelector('.tb-create-btn');
    if (btn) {
        btn.disabled = true;
        btn.textContent = '⏳ Создаём...';
    }

    try {
        const resp = await fetch(`${BOT_API_URL}/api/team-battle/create`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
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
            })
        });
        const data = await resp.json();
        if (data.success) {
            showToast(`✅ Командный челлендж создан! ${st.teamSize}×${st.teamSize}`);
            tbSwitchSubTab('browse');
        } else {
            showToast(`❌ ${data.error}`);
            if (btn) {
                btn.disabled = false;
                btn.textContent = '⚔️ СОЗДАТЬ КОМАНДНЫЙ ЧЕЛЛЕНДЖ';
            }
        }
    } catch (e) {
        showToast('❌ Нет подключения к серверу');
        if (btn) {
            btn.disabled = false;
            btn.textContent = '⚔️ СОЗДАТЬ КОМАНДНЫЙ ЧЕЛЛЕНДЖ';
        }
    }
}
