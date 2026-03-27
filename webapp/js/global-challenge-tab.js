/**
 * Global Challenge Tab JS — встроенный в challenges.html
 * Все функции имеют префикс gc чтобы не конфликтовать с arena.js
 * 
 * Автоматическое отслеживание статистики через Lesta API
 */

const GC_CONDITION_MAP = {
    damage: { icon: '<img src="img/military/cond_damage.png?v=2" style="width:1.2em;height:1.2em;vertical-align:middle;margin-right:2px">', name: 'Урон', unit: 'урона' },
    frags: { icon: '<img src="img/military/cond_frags.png?v=2" style="width:1.2em;height:1.2em;vertical-align:middle;margin-right:2px">', name: 'Фраги', unit: 'фрагов' },
    xp: { icon: '<img src="img/military/cond_xp.png?v=2" style="width:1.2em;height:1.2em;vertical-align:middle;margin-right:2px">', name: 'Опыт', unit: 'опыта' },
    spotting: { icon: '<img src="img/military/cond_spotting.png?v=2" style="width:1.2em;height:1.2em;vertical-align:middle;margin-right:2px">', name: 'Засвет', unit: 'засвета' },
    blocked: { icon: '<img src="img/military/cond_blocked.png?v=2" style="width:1.2em;height:1.2em;vertical-align:middle;margin-right:2px">', name: 'Блок', unit: 'блока' },
    wins: { icon: '<img src="img/military/cond_wins.png?v=2" style="width:1.2em;height:1.2em;vertical-align:middle;margin-right:2px">', name: 'Победы', unit: 'побед' },
    combined: { icon: '<img src="img/military/cond_combined.png?v=2" style="width:1.2em;height:1.2em;vertical-align:middle;margin-right:2px">', name: 'Суммарка', unit: 'суммарки' },
};

let gcCurrentChallenge = null;
let gcTimerInterval = null;
let gcAdminConditions = ['damage'];
let gcAdminTankClass = null;
let gcAdminTankTier = null;
let gcAdminTankId = null;
let gcAdminTankName = null;
let gcAllSubscribers = [];
let _gcLastDataHash = null;
let _gcIsFirstLoad = true;
let _gcLoadInProgress = false;
let _gcLastRefreshTime = 0; // throttle refresh-stats

// ============================================================
// LOAD CHALLENGE
// ============================================================
async function gcLoadChallenge(forceRefresh) {
    // Предотвращаем параллельные запросы
    if (_gcLoadInProgress) return;
    _gcLoadInProgress = true;

    // Убеждаемся, что используем глобальные переменные (для синхронизации с arena.js)
    if (typeof window.isAdmin !== 'undefined' && !window.isAdmin && (window.myTelegramId || localStorage.getItem('my_telegram_id'))) {
        const tid = window.myTelegramId || localStorage.getItem('my_telegram_id');
        try {
            const meResp = await fetch(`${BOT_API_URL}/api/me?telegram_id=${tid}`);
            const meData = await meResp.json();
            if (meData.is_admin) {
                window.isAdmin = true;
                if (typeof isAdmin !== 'undefined') isAdmin = true; // Fallback for local scope
            }
        } catch(e) { console.error('Admin check failed', e); }
    }

    try {
        const isAdminNow = window.isAdmin || (typeof isAdmin !== 'undefined' && isAdmin);
        
        // Показываем админ-панель СРАЗУ если админ
        if (isAdminNow) {
            const adminPanel = document.getElementById('gcAdminPanel');
            if (adminPanel) {
                adminPanel.style.display = '';
                // Принудительно убираем display:none если оно там застряло
                adminPanel.classList.remove('hidden'); 
            }
            gcLoadNations(); // Load nation dropdown
        }

        // Обновляем статистику в фоне НЕ ЧАЩЕ раз в 30 секунд
        const now = Date.now();
        if (now - _gcLastRefreshTime > 30000) {
            _gcLastRefreshTime = now;
            const refreshController = new AbortController();
            setTimeout(() => refreshController.abort(), 10000);
            fetch(`${BOT_API_URL}/api/global-challenge/refresh-stats`, { 
                method: 'POST', 
                signal: refreshController.signal 
            }).catch(() => {});
        }

        const resp = await fetch(`${BOT_API_URL}/api/global-challenge/active`);
        const data = await resp.json();

        // Anti-flicker: проверяем изменились ли данные
        const dataHash = JSON.stringify({
            status: data.status,
            id: data.challenge?.id,
            participants: data.challenge?.participants_count,
            leaderboard: data.challenge?.leaderboard?.map(p => `${p.telegram_id}:${p.current_value}:${p.battles_played}`),
        });

        const isFirstLoad = _gcIsFirstLoad;
        _gcIsFirstLoad = false;

        // Скрываем загрузку при первом рендере
        if (isFirstLoad) {
            document.getElementById('gcLoading').style.display = 'none';
        }

        // Если данные НЕ изменились — обновляем только таймер, лидерборд не трогаем
        if (!isFirstLoad && !forceRefresh && _gcLastDataHash === dataHash) {
            // Данные не изменились — ничего не перерисовываем 
        } else {
            _gcLastDataHash = dataHash;

            if (isFirstLoad) {
                document.getElementById('gcLoading').style.display = 'none';
            }

            if (data.status === 'active' && data.challenge) {
                gcShowActive(data.challenge);
            } else if (data.status === 'finished' && data.challenge) {
                gcShowFinished(data.challenge);
            } else {
                gcShowEmpty();
            }
            
            // Загружаем историю параллельно
            gcLoadHistory();
        }

        // Повторно убеждаемся что админ-панель показана
        if (isAdminNow) {
            const adminPanel = document.getElementById('gcAdminPanel');
            if (adminPanel) adminPanel.style.display = '';
        }
    } catch (e) {
        console.error('GC load error:', e);
        if (_gcIsFirstLoad) {
            _gcIsFirstLoad = false;
            document.getElementById('gcLoading').style.display = 'none';
            gcShowEmpty();
        }
        // Даже при ошибке — показываем admin panel
        if (isAdminNow) {
            const adminPanel = document.getElementById('gcAdminPanel');
            if (adminPanel) adminPanel.style.display = '';
        }
    } finally {
        _gcLoadInProgress = false;
    }
}

// ============================================================
// SHOW STATES
// ============================================================
function gcShowEmpty() {
    document.getElementById('gcEmpty').style.display = '';
    document.getElementById('gcActive').style.display = 'none';
    document.getElementById('gcFinished').style.display = 'none';
}

function gcShowActive(ch) {
    gcCurrentChallenge = ch;

    document.getElementById('gcEmpty').style.display = 'none';
    document.getElementById('gcActive').style.display = '';
    document.getElementById('gcFinished').style.display = 'none';

    // Header
    document.getElementById('gcIcon').innerHTML = ch.icon || '🔥';
    document.getElementById('gcTitle').textContent = ch.title;
    document.getElementById('gcDesc').textContent = ch.description || '';

    // Multi-condition support
    const conditions = (ch.condition || 'damage').split(',');
    const firstCond = GC_CONDITION_MAP[conditions[0]] || GC_CONDITION_MAP.damage;
    document.getElementById('gcCondition').innerHTML = conditions.map(c => (GC_CONDITION_MAP[c] || GC_CONDITION_MAP.damage).icon).join(' ');
    
    if (conditions.length > 1) {
        document.getElementById('gcCondLabel').textContent = conditions.length + ' условия';
        // Show condition badges
        const badgesEl = document.getElementById('gcCondBadges');
        if (badgesEl) {
            badgesEl.style.display = '';
            badgesEl.innerHTML = conditions.map(c => {
                const ci = GC_CONDITION_MAP[c] || GC_CONDITION_MAP.damage;
                return `<span style="display:inline-block;padding:3px 10px;background:rgba(200,170,110,0.1);border:1px solid rgba(200,170,110,0.2);border-radius:20px;font-size:0.6rem;color:#C8AA6E;font-weight:600">${ci.icon} ${ci.name}</span>`;
            }).join(' ');
        }
    } else {
        document.getElementById('gcCondLabel').textContent = firstCond.name;
        const badgesEl = document.getElementById('gcCondBadges');
        if (badgesEl) badgesEl.style.display = 'none';
    }

    // Stats
    document.getElementById('gcParticipants').textContent = ch.participants_count || 0;
    document.getElementById('gcReward').textContent = `🧀 ${ch.reward_coins || 0}`;

    // Vehicle filter badges
    const filterEl = document.getElementById('gcVehicleFilter');
    if (filterEl) {
        const hasFilter = ch.tank_class || ch.tank_tier_filter || ch.tank_name_filter;
        if (hasFilter) {
            filterEl.style.display = '';
            let parts = [];
            const classNames = { heavyTank: '🛡️ ТТ', mediumTank: '⚙️ СТ', lightTank: '🏎️ ЛТ', 'AT-SPG': '🎯 ПТ', SPG: '💣 САУ' };
            if (ch.tank_name_filter) parts.push(`🪖 ${ch.tank_name_filter}`);
            else if (ch.tank_class) parts.push(classNames[ch.tank_class] || ch.tank_class);
            if (ch.tank_tier_filter) {
                const tierLabels = ['', 'I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII', 'IX', 'X'];
                parts.push(`${tierLabels[ch.tank_tier_filter] || ch.tank_tier_filter} ур.`);
            }
            filterEl.innerHTML = parts.map(p => `<span style="display:inline-block;padding:3px 10px;background:rgba(74,222,128,0.1);border:1px solid rgba(74,222,128,0.2);border-radius:20px;font-size:0.6rem;color:#4ade80;font-weight:600">${p}</span>`).join(' ');
        } else {
            filterEl.style.display = 'none';
        }
    }

    // Timer
    gcStartTimer(ch.ends_at, ch.duration_minutes);

    // Leaderboard
    gcRenderLeaderboard(ch.leaderboard || []);

    // Join button
    const joinBtn = document.getElementById('gcJoinBtn');
    const myId = parseInt(myTelegramId);
    const isParticipant = (ch.leaderboard || []).some(p => parseInt(p.telegram_id) === myId);

    if (isParticipant) {
        joinBtn.disabled = true;
        joinBtn.textContent = '✅ ВЫ УЧАСТВУЕТЕ — статистика обновляется автоматически';
    } else {
        joinBtn.disabled = false;
        joinBtn.textContent = '⚔️ ВСТУПИТЬ В ЧЕЛЛЕНДЖ';
    }

    // Widget link
    const linkEl = document.getElementById('gcWidgetLink');
    if (linkEl) {
        linkEl.style.display = '';
    }

    // Admin controls
    if (isAdmin) {
        const stopBtn = document.getElementById('adminGcStopBtn');
        const deleteBtn = document.getElementById('adminGcDeleteBtn');
        stopBtn.style.display = '';
        stopBtn.setAttribute('data-id', ch.id);
        if (deleteBtn) {
            deleteBtn.style.display = '';
            deleteBtn.setAttribute('data-id', ch.id);
        }
        document.getElementById('adminGcLaunchBtn').style.display = 'none';

        // OBS link section
        const obsSection = document.getElementById('gcObsSection');
        if (obsSection) {
            obsSection.style.display = '';
            const obsUrl = document.getElementById('gcObsUrl');
            if (obsUrl) {
                // Строим URL корректно для любой страницы (challenges.html или global-challenge.html)
                const pathParts = window.location.pathname.split('/');
                pathParts[pathParts.length - 1] = 'gc-widget.html';
                const base = window.location.origin + pathParts.join('/');
                const url = myTelegramId ? `${base}?telegram_id=${myTelegramId}` : base;
                obsUrl.textContent = url;
            }
        }
    }
}

function gcShowFinished(ch) {
    gcCurrentChallenge = ch;

    document.getElementById('gcEmpty').style.display = 'none';
    document.getElementById('gcActive').style.display = 'none';
    document.getElementById('gcFinished').style.display = '';

    const conditions = (ch.condition || 'damage').split(',');
    const firstCond = GC_CONDITION_MAP[conditions[0]] || GC_CONDITION_MAP.damage;

    document.getElementById('gcWinnerName').textContent = ch.winner_nickname || 'Нет участников';
    document.getElementById('gcWinnerValue').innerHTML = gcFormatLbValue({
        current_value: ch.winner_value,
        condition_values: ch.winner_condition_values
    }, ch);
    document.getElementById('gcWinnerLabel').textContent = conditions.length > 1 ? 'результат' : firstCond.unit;

    // Show Reward
    const winCard = document.getElementById('gcWinnerCard');
    if (winCard) {
        winCard.style.cursor = 'pointer';
        winCard.onclick = () => gcShowPlayerDetail(ch.winner_telegram_id, ch.winner_nickname, true, ch.id);
        
        let rewardHtml = '';
        if (ch.reward_coins > 0) {
            rewardHtml = `<div class="gc-winner-reward" style="margin-top:10px; font-weight:800; color:#f5d36e; font-size:0.9rem">
                🏆 ВЫИГРЫШ: 🧀 ${ch.reward_coins.toLocaleString('ru')}
            </div>`;
        }
        
        // Remove old reward if exists
        const oldRew = winCard.querySelector('.gc-winner-reward');
        if (oldRew) oldRew.remove();
        winCard.insertAdjacentHTML('beforeend', rewardHtml);
    }

    // Final leaderboard
    const lb = ch.leaderboard || [];
    let html = '';
    if (lb.length > 0) {
        html += '<div class="gc-lb-title" style="margin-top:20px;justify-content:center">🏆 ИТОГОВАЯ ТАБЛИЦА</div>';
        html += '<div class="gc-lb-list">';
        lb.forEach((p, i) => {
            const medals = ['🥇', '🥈', '🥉'];
            const medal = medals[i] || `${i + 1}`;
            const cls = i === 0 ? 'gc-lb-item--1st' : i === 1 ? 'gc-lb-item--2nd' : i === 2 ? 'gc-lb-item--3rd' : 'gc-lb-item--other';
            const rankCls = i < 3 ? ['gc-lb-rank--1st', 'gc-lb-rank--2nd', 'gc-lb-rank--3rd'][i] : 'gc-lb-rank--other';
            
            html += `
                <div class="gc-lb-item ${cls}" style="cursor:pointer; position:relative" onclick="gcShowPlayerDetail(${p.telegram_id}, '${(p.nickname || '').replace(/'/g, "\\'")}', true, ${ch.id})">
                    <div class="gc-lb-rank ${rankCls}">${medal}</div>
                    <div class="gc-lb-info">
                        <div class="gc-lb-name">${p.nickname}</div>
                        <div class="gc-lb-battles">${p.battles_played || 0} боёв <span style="font-size:0.5rem; opacity:0.6; margin-left:4px">🔍 подробно</span></div>
                    </div>
                    <div class="gc-lb-value" style="text-align:right">${gcFormatLbValue(p, ch)}</div>
                </div>`;
        });
        html += '</div>';
    }
    // Admin: add "New Challenge" button directly on finished screen
    if (isAdmin) {
        html += `
            <div style="margin-top:20px;display:flex;flex-direction:column;gap:8px">
                <button onclick="document.getElementById('gcAdminPanel').scrollIntoView({behavior:'smooth'})" 
                    style="width:100%;padding:14px;border-radius:12px;border:2px solid rgba(74,222,128,0.4);
                    background:linear-gradient(135deg, rgba(74,222,128,0.15), rgba(74,222,128,0.05));
                    color:#4ade80;font-family:'Russo One',sans-serif;font-size:0.85rem;cursor:pointer;
                    transition:all 0.3s;letter-spacing:0.5px">
                    🚀 ЗАПУСТИТЬ НОВЫЙ ЧЕЛЛЕНДЖ
                </button>
                <button onclick="gcDeleteChallenge()" data-id="${ch.id}"
                    style="width:100%;padding:10px;border-radius:10px;border:1px solid rgba(239,68,68,0.2);
                    background:rgba(239,68,68,0.05);color:#ef4444;font-size:0.7rem;cursor:pointer;
                    font-weight:700;transition:all 0.2s">
                    🗑 Удалить этот челлендж из истории
                </button>
            </div>`;
    }

    document.getElementById('gcFinalLb').innerHTML = html;

    // Widget link hide
    const linkEl = document.getElementById('gcWidgetLink');
    if (linkEl) linkEl.style.display = 'none';

    // Admin: show launch again
    if (isAdmin) {
        document.getElementById('adminGcLaunchBtn').style.display = '';
        document.getElementById('adminGcStopBtn').style.display = 'none';
        const deleteBtn = document.getElementById('adminGcDeleteBtn');
        if (deleteBtn) {
            deleteBtn.style.display = '';
            deleteBtn.setAttribute('data-id', ch.id);
        }
        const obsSection = document.getElementById('gcObsSection');
        if (obsSection) obsSection.style.display = 'none';
    }

    if (ch.winner_nickname) {
        setTimeout(gcLaunchConfetti, 300);
    }
}

// ============================================================
// TIMER
// ============================================================
function gcStartTimer(endsAtStr, durationMinutes) {
    if (gcTimerInterval) clearInterval(gcTimerInterval);

    const endsAt = new Date(endsAtStr);
    const totalSeconds = (durationMinutes || 60) * 60;
    const circumference = 2 * Math.PI * 90;

    const progressEl = document.getElementById('gcTimerProgress');
    const valueEl = document.getElementById('gcTimerValue');
    progressEl.style.strokeDasharray = circumference;

    function tick() {
        const now = new Date();
        const diff = Math.max(0, Math.floor((endsAt - now) / 1000));

        if (diff <= 0) {
            valueEl.textContent = '00:00';
            progressEl.style.strokeDashoffset = circumference;
            clearInterval(gcTimerInterval);
            setTimeout(gcLoadChallenge, 2000);
            return;
        }

        const hours = Math.floor(diff / 3600);
        const minutes = Math.floor((diff % 3600) / 60);
        const seconds = diff % 60;

        if (hours > 0) {
            valueEl.textContent = `${hours}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
        } else {
            valueEl.textContent = `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
        }

        const elapsed = totalSeconds - diff;
        const fraction = elapsed / totalSeconds;
        progressEl.style.strokeDashoffset = fraction * circumference;

        if (diff < 60) {
            valueEl.classList.add('gc-timer-value--danger');
            progressEl.classList.add('gc-timer-progress--danger');
        } else {
            valueEl.classList.remove('gc-timer-value--danger');
            progressEl.classList.remove('gc-timer-progress--danger');
        }
    }

    tick();
    gcTimerInterval = setInterval(tick, 1000);
}

// ============================================================
// MULTI-CONDITION VALUE FORMATTER
// ============================================================
function gcFormatLbValue(player, challenge) {
    if (!challenge) return (player.current_value || 0).toLocaleString('ru');
    const conditions = (challenge.condition || 'damage').split(',');
    
    if (conditions.length <= 1) {
        return (player.current_value || 0).toLocaleString('ru');
    }
    
    // Multi-condition: show breakdown if player has condition_values
    let condVals = player.condition_values;
    if (typeof condVals === 'string') {
        try { condVals = JSON.parse(condVals); } catch(e) { condVals = null; }
    }
    if (condVals && typeof condVals === 'object') {
        return conditions.map(c => {
            const ci = GC_CONDITION_MAP[c] || GC_CONDITION_MAP.damage;
            const val = condVals[c] || 0;
            return `<span style="display:block;font-size:0.6rem;line-height:1.3">${ci.icon} ${val.toLocaleString('ru')}</span>`;
        }).join('');
    }
    
    // Fallback: show total
    return (player.current_value || 0).toLocaleString('ru');
}

// ============================================================
// LEADERBOARD
// ============================================================
function gcRenderLeaderboard(leaders) {
    const list = document.getElementById('gcLbList');

    if (!leaders || leaders.length === 0) {
        list.innerHTML = '<div class="gc-lb-empty">Пока нет участников</div>';
        return;
    }

    const medals = ['🥇', '🥈', '🥉'];
    const maxBattles = gcCurrentChallenge?.max_battles || 0;

    list.innerHTML = leaders.map((p, i) => {
        const medal = medals[i] || `${i + 1}`;
        let cls;
        if (i === 0) cls = 'gc-lb-item--1st';
        else if (i === 1) cls = 'gc-lb-item--2nd';
        else if (i === 2) cls = 'gc-lb-item--3rd';
        else cls = 'gc-lb-item--other';

        const isMe = parseInt(p.telegram_id) === parseInt(myTelegramId);
        if (isMe) cls += ' gc-lb-item--me';

        const rankCls = i < 3 ? ['gc-lb-rank--1st', 'gc-lb-rank--2nd', 'gc-lb-rank--3rd'][i] : 'gc-lb-rank--other';
        const battlesText = maxBattles > 0 
            ? `${p.battles_played || 0}/${maxBattles} боёв` 
            : `${p.battles_played || 0} боёв`;

        return `
            <div class="gc-lb-item ${cls}" style="animation-delay:${i * 0.06}s; cursor:pointer" onclick="gcShowPlayerDetail(${p.telegram_id}, '${(p.nickname || 'Танкист').replace(/'/g, "\\'")}')">
                <div class="gc-lb-rank ${rankCls}">${medal}</div>
                <div class="gc-lb-info">
                    <div class="gc-lb-name">${isMe ? '⭐ ' : ''}${p.nickname || 'Танкист'}</div>
                    <div class="gc-lb-battles">${battlesText}</div>
                </div>
                <div class="gc-lb-value">${gcFormatLbValue(p, gcCurrentChallenge)}</div>
            </div>`;
    }).join('');

    // Кнопка подробной таблицы
    list.innerHTML += `
        <div class="gc-detail-btn" onclick="gcShowFullTable()" style="text-align:center; margin-top:12px; cursor:pointer;">
            <span style="background:rgba(255,255,255,0.1); padding:8px 20px; border-radius:12px; font-size:14px; display:inline-block">
                📊 Подробная таблица
            </span>
        </div>`;
}

// ============================================================
// DETAIL: Модалка деталей игрока (побоевая разбивка)
// ============================================================
async function gcShowPlayerDetail(telegramId, nickname) {
    if (!gcCurrentChallenge) return;

    // Создаём модалку если нет
    let modal = document.getElementById('gcDetailModal');
    if (!modal) {
        modal = document.createElement('div');
        modal.id = 'gcDetailModal';
        modal.className = 'gc-modal-overlay';
        document.body.appendChild(modal);
    }

    const ch = gcCurrentChallenge;
    const conditions = (ch.condition || 'damage').split(',').map(c => c.trim()).filter(Boolean);
    const isMulti = conditions.length > 1;
    const firstCond = GC_CONDITION_MAP[conditions[0]] || GC_CONDITION_MAP.damage;

    modal.innerHTML = `
        <div class="gc-modal">
            <div class="gc-modal__header">
                <span>🎯 ${nickname}</span>
                <button class="gc-modal__close" onclick="document.getElementById('gcDetailModal').style.display='none'">✕</button>
            </div>
            <div class="gc-modal__body" id="gcDetailBody">
                <div style="text-align:center; padding:20px; color:#aaa">⏳ Загрузка боёв...</div>
            </div>
        </div>`;
    modal.style.display = 'flex';

    try {
        const resp = await fetch(`${BOT_API_URL}/api/global-challenge/battle-log?challenge_id=${ch.id}&telegram_id=${telegramId}`);
        const data = await resp.json();

        // Find this player in leaderboard for condition_values
        const player = (ch.leaderboard || []).find(p => String(p.telegram_id) === String(telegramId));

        const body = document.getElementById('gcDetailBody');
        if (!data.battles || data.battles.length === 0) {
            // Even without battle log, show condition_values if available
            if (isMulti && player) {
                let cv = player.condition_values;
                if (typeof cv === 'string') try { cv = JSON.parse(cv); } catch(e) { cv = null; }
                if (cv && typeof cv === 'object') {
                    let condHtml = '<div style="padding:12px">';
                    condHtml += '<div style="text-align:center;color:#aaa;margin-bottom:12px">Побоевая разбивка недоступна для мульти-условий</div>';
                    condHtml += '<div style="display:flex;flex-direction:column;gap:8px">';
                    conditions.forEach(c => {
                        const ci = GC_CONDITION_MAP[c] || GC_CONDITION_MAP.damage;
                        const val = (cv[c] || 0).toLocaleString('ru');
                        condHtml += `<div style="display:flex;justify-content:space-between;align-items:center;padding:10px 14px;background:rgba(200,170,110,0.06);border:1px solid rgba(200,170,110,0.12);border-radius:10px">
                            <span style="display:flex;align-items:center;gap:6px;font-size:14px">${ci.icon} ${ci.name}</span>
                            <span style="font-weight:700;color:#C8AA6E;font-size:16px">${val}</span>
                        </div>`;
                    });
                    condHtml += '</div>';
                    const total = (player.current_value || 0).toLocaleString('ru');
                    condHtml += `<div class="gc-battles-total">Сумма: <b>${total}</b> за <b>${player.battles_played || 0}</b> боёв</div>`;
                    condHtml += '</div>';
                    body.innerHTML = condHtml;
                    return;
                }
            }
            body.innerHTML = '<div style="text-align:center; padding:20px; color:#aaa">Боёв пока не обнаружено. Данные обновляются каждые 15 сек.</div>';
            return;
        }

        const tierLabels = ['', 'I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII', 'IX', 'X'];
        let totalDmg = 0;
        let html = '<div class="gc-battles-list">';
        data.battles.forEach(b => {
            totalDmg += b.damage;
            const tierStr = tierLabels[b.tank_tier] || b.tank_tier;
            html += `
                <div class="gc-battle-row">
                    <div class="gc-battle-num">#${b.battle_num}</div>
                    <div class="gc-battle-tank">
                        <span class="gc-battle-tier">${tierStr}</span>
                        ${b.tank_name}
                    </div>
                    <div class="gc-battle-dmg">${(b.damage || 0).toLocaleString('ru')} ${firstCond.unit}</div>
                </div>`;
        });
        html += '</div>';

        // Multi-condition summary
        if (isMulti && player) {
            let cv = player.condition_values;
            if (typeof cv === 'string') try { cv = JSON.parse(cv); } catch(e) { cv = null; }
            if (cv && typeof cv === 'object') {
                html += '<div style="display:flex;gap:6px;flex-wrap:wrap;justify-content:center;padding:8px 12px">';
                conditions.forEach(c => {
                    const ci = GC_CONDITION_MAP[c] || GC_CONDITION_MAP.damage;
                    const val = (cv[c] || 0).toLocaleString('ru');
                    html += `<span style="display:inline-flex;align-items:center;gap:4px;padding:5px 10px;background:rgba(200,170,110,0.08);border:1px solid rgba(200,170,110,0.18);border-radius:14px;font-size:13px">
                        ${ci.icon} <span style="color:#aaa">${ci.name}:</span> <b style="color:#C8AA6E">${val}</b>
                    </span>`;
                });
                html += '</div>';
            }
        }

        const totalLabel = isMulti
            ? `Сумма: <b>${(player?.current_value || totalDmg).toLocaleString('ru')}</b> за <b>${data.battles.length}</b> боёв`
            : `Итого: <b>${totalDmg.toLocaleString('ru')}</b> ${firstCond.unit} за <b>${data.battles.length}</b> боёв`;
        html += `<div class="gc-battles-total">${totalLabel}</div>`;
        body.innerHTML = html;
    } catch (e) {
        document.getElementById('gcDetailBody').innerHTML = '<div style="color:red; padding:20px">❌ Ошибка загрузки</div>';
    }
}

// ============================================================
// FULL TABLE: Полная таблица всех участников
// ============================================================
async function gcShowFullTable() {
    if (!gcCurrentChallenge) return;
    const ch = gcCurrentChallenge;
    const leaders = ch.leaderboard || [];
    const conditions = (ch.condition || 'damage').split(',').map(c => c.trim()).filter(Boolean);
    const isMulti = conditions.length > 1;
    const maxBattles = ch.max_battles || 0;

    let modal = document.getElementById('gcDetailModal');
    if (!modal) {
        modal = document.createElement('div');
        modal.id = 'gcDetailModal';
        modal.className = 'gc-modal-overlay';
        document.body.appendChild(modal);
    }

    // Build header columns for each condition
    const condHeaders = isMulti
        ? conditions.map(c => {
            const ci = GC_CONDITION_MAP[c] || GC_CONDITION_MAP.damage;
            return `<th style="font-size:12px;white-space:nowrap">${ci.icon} ${ci.name}</th>`;
        }).join('') + '<th>Σ</th>'
        : `<th>${(GC_CONDITION_MAP[conditions[0]] || GC_CONDITION_MAP.damage).name}</th>`;

    let html = `
        <div class="gc-modal gc-modal--wide">
            <div class="gc-modal__header">
                <span>📊 Турнирная таблица</span>
                <button class="gc-modal__close" onclick="document.getElementById('gcDetailModal').style.display='none'">✕</button>
            </div>
            <div class="gc-modal__body">
                <table class="gc-table">
                    <thead>
                        <tr>
                            <th>#</th>
                            <th>Игрок</th>
                            <th>Боёв</th>
                            ${condHeaders}
                        </tr>
                    </thead>
                    <tbody>`;

    const sorted = [...leaders].sort((a, b) => (b.current_value || 0) - (a.current_value || 0));
    sorted.forEach((p, i) => {
        const battlesText = maxBattles > 0 ? `${p.battles_played || 0}/${maxBattles}` : `${p.battles_played || 0}`;

        let condCells = '';
        if (isMulti) {
            let cv = p.condition_values;
            if (typeof cv === 'string') try { cv = JSON.parse(cv); } catch(e) { cv = null; }
            conditions.forEach(c => {
                const val = (cv && cv[c]) ? cv[c] : 0;
                condCells += `<td class="gc-table__value" style="font-size:13px">${val.toLocaleString('ru')}</td>`;
            });
            condCells += `<td class="gc-table__value" style="font-weight:700;color:#C8AA6E">${(p.current_value || 0).toLocaleString('ru')}</td>`;
        } else {
            condCells = `<td class="gc-table__value">${(p.current_value || 0).toLocaleString('ru')}</td>`;
        }

        html += `
            <tr class="gc-table__row" onclick="gcShowPlayerDetail(${p.telegram_id}, '${(p.nickname || '').replace(/'/g, "\\'")}')">
                <td class="gc-table__rank">${i + 1}</td>
                <td class="gc-table__name">${p.nickname || 'Танкист'}</td>
                <td class="gc-table__battles">${battlesText}</td>
                ${condCells}
            </tr>`;
    });

    html += `</tbody></table></div></div>`;
    modal.innerHTML = html;
    modal.style.display = 'flex';
}

// ============================================================
// JOIN — вступление + сообщение
// ============================================================
async function gcJoinChallenge() {
    if (!myTelegramId) {
        showToast('⚠️ Откройте через Telegram-бот');
        return;
    }
    if (!gcCurrentChallenge) return;

    const btn = document.getElementById('gcJoinBtn');
    btn.disabled = true;
    btn.textContent = '⏳ Вступаем...';

    // Передаём WoT данные из localStorage чтобы сервер мог обновить БД
    const joinData = {
        telegram_id: myTelegramId,
        challenge_id: gcCurrentChallenge.id,
        wot_nickname: localStorage.getItem('wot_nickname') || '',
        wot_account_id: localStorage.getItem('wot_account_id') || ''
    };

    // Имя из Telegram
    const tg = window.Telegram?.WebApp;
    if (tg?.initDataUnsafe?.user) {
        joinData.first_name = tg.initDataUnsafe.user.first_name || '';
        joinData.username = tg.initDataUnsafe.user.username || '';
    }

    try {
        const resp = await fetch(`${BOT_API_URL}/api/global-challenge/join`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(joinData)
        });
        const data = await resp.json();

        if (data.success) {
            showToast(data.message || `🎯 Вы вступили! Условия приняты — вперёд!`);
            btn.textContent = '✅ ВЫ УЧАСТВУЕТЕ — статистика обновляется автоматически';
            gcLoadChallenge();
        } else {
            showToast(`❌ ${data.error}`);
            btn.disabled = false;
            btn.textContent = '⚔️ ВСТУПИТЬ В ЧЕЛЛЕНДЖ';
        }
    } catch (e) {
        showToast('❌ Нет подключения');
        btn.disabled = false;
        btn.textContent = '⚔️ ВСТУПИТЬ В ЧЕЛЛЕНДЖ';
    }
}

// ============================================================
// WIDGET LINK — копирование ссылки
// ============================================================
function gcCopyWidgetLink() {
    const base = window.location.origin + window.location.pathname.replace('challenges.html', 'gc-widget.html');
    const url = myTelegramId ? `${base}?telegram_id=${myTelegramId}` : base;
    navigator.clipboard.writeText(url).then(() => {
        showToast('📋 Ссылка на виджет скопирована!');
    }).catch(() => {
        const input = document.createElement('input');
        input.value = url;
        document.body.appendChild(input);
        input.select();
        document.execCommand('copy');
        document.body.removeChild(input);
        showToast('📋 Ссылка на виджет скопирована!');
    });
}

// ============================================================
// ADMIN: SUBSCRIBERS
// ============================================================
async function gcLoadSubscribers() {
    const list = document.getElementById('subsList');
    list.innerHTML = '<div class="gc-subs__loading">⏳ Загрузка подписчиков...</div>';

    try {
        const resp = await fetch(`${BOT_API_URL}/api/admin/users?telegram_id=${myTelegramId}`);
        const data = await resp.json();

        if (!data.users) {
            list.innerHTML = '<div class="gc-subs__loading">❌ Ошибка загрузки</div>';
            return;
        }

        gcAllSubscribers = data.users.filter(u => u.subscription && u.subscription.active);
        document.getElementById('subsCount').textContent = gcAllSubscribers.length;
        gcRenderSubscribers(gcAllSubscribers);
    } catch (e) {
        console.error('Load subscribers error:', e);
        list.innerHTML = '<div class="gc-subs__loading">❌ Нет подключения к API</div>';
    }
}

function gcRenderSubscribers(subs) {
    const list = document.getElementById('subsList');

    if (!subs || subs.length === 0) {
        list.innerHTML = '<div class="gc-subs__loading">Нет подписчиков</div>';
        return;
    }

    list.innerHTML = subs.map((u, i) => {
        const nick = u.wot_nickname || u.first_name || u.username || 'Танкист';
        const initials = nick.substring(0, 2).toUpperCase();
        const sub = u.subscription;
        const daysLeft = sub ? sub.days_remaining : 0;
        const isActive = sub && sub.active;
        const badgeCls = isActive ? 'gc-sub-card__badge--active' : 'gc-sub-card__badge--expired';
        const badgeText = isActive ? `${daysLeft} дн.` : 'Истёк';
        const meta = u.wot_nickname ? `@${u.username || '—'}` : `TG: ${u.telegram_id}`;

        return `
            <div class="gc-sub-card" style="animation-delay:${i * 0.03}s">
                <div class="gc-sub-card__avatar">${initials}</div>
                <div class="gc-sub-card__info">
                    <div class="gc-sub-card__nick">${nick}</div>
                    <div class="gc-sub-card__meta">${meta}</div>
                </div>
                <div class="gc-sub-card__badge ${badgeCls}">${badgeText}</div>
            </div>`;
    }).join('');
}

function gcFilterSubscribers() {
    const query = (document.getElementById('subsSearch').value || '').toLowerCase().trim();
    if (!query) {
        gcRenderSubscribers(gcAllSubscribers);
        return;
    }
    const filtered = gcAllSubscribers.filter(u => {
        const nick = (u.wot_nickname || u.first_name || u.username || '').toLowerCase();
        return nick.includes(query) || String(u.telegram_id).includes(query);
    });
    gcRenderSubscribers(filtered);
}

// ============================================================
// ADMIN: CREATE / STOP / DELETE
// ============================================================
function gcToggleCond(cond, btn) {
    const idx = gcAdminConditions.indexOf(cond);
    if (idx >= 0) {
        // Deselect — but don't allow empty
        if (gcAdminConditions.length <= 1) {
            showToast('⚠️ Нужно хотя бы 1 условие');
            return;
        }
        gcAdminConditions.splice(idx, 1);
        btn.classList.remove('gc-cond-btn--active');
    } else {
        // Combined is exclusive — deselect all others
        if (cond === 'combined') {
            gcAdminConditions = ['combined'];
            document.querySelectorAll('.gc-cond-btn').forEach(b => b.classList.remove('gc-cond-btn--active'));
            btn.classList.add('gc-cond-btn--active');
        } else {
            // If combined was selected, deselect it first
            const combIdx = gcAdminConditions.indexOf('combined');
            if (combIdx >= 0) {
                gcAdminConditions.splice(combIdx, 1);
                const combBtn = document.querySelector('.gc-cond-btn[data-cond="combined"]');
                if (combBtn) combBtn.classList.remove('gc-cond-btn--active');
            }
            // Select — limit to 3
            if (gcAdminConditions.length >= 3) {
                showToast('⚠️ Максимум 3 условия');
                return;
            }
            gcAdminConditions.push(cond);
            btn.classList.add('gc-cond-btn--active');
        }
    }
    gcUpdateCondSelectedBadges();
    if (typeof gcUpdatePreview === 'function') gcUpdatePreview();
}

function gcUpdateCondSelectedBadges() {
    const el = document.getElementById('gcCondSelected');
    if (!el) return;
    if (gcAdminConditions.length <= 1) {
        el.innerHTML = '';
        return;
    }
    el.innerHTML = gcAdminConditions.map(c => {
        const ci = GC_CONDITION_MAP[c] || GC_CONDITION_MAP.damage;
        return `<span style="display:inline-flex;align-items:center;gap:3px;padding:3px 8px;background:rgba(200,170,110,0.12);border:1px solid rgba(200,170,110,0.25);border-radius:16px;font-size:0.55rem;color:#C8AA6E;font-weight:600">${ci.icon} ${ci.name}</span>`;
    }).join('');
}

// === Vehicle filter admin functions ===
// Cascading selectors: Нация → Класс → Уровень → Танк
let _gcNationsLoaded = false;

async function gcLoadNations() {
    if (_gcNationsLoaded) return;
    const sel = document.getElementById('adminGcTankNation');
    if (!sel) return;
    
    // Индикация загрузки
    sel.innerHTML = '<option value="">⏳ Загрузка наций...</option>';
    
    try {
        const resp = await fetch(`${BOT_API_URL}/api/global-challenge/tank-list`);
        const data = await resp.json();
        
        if (data.error) {
            console.error('API Error:', data.error);
            showToast('❌', 'Ошибка API: ' + data.error);
            sel.innerHTML = '<option value="">⚠️ ' + data.error + '</option>';
            return;
        }
        
        if (!data.nations) {
            sel.innerHTML = '<option value="">🌎 Нации не найдены</option>';
            return;
        }
        
        sel.innerHTML = '<option value="">🌍 Любая</option>';
        data.nations.forEach(n => {
            sel.innerHTML += `<option value="${n.id}">${n.name}</option>`;
        });
        _gcNationsLoaded = true;
    } catch (e) { 
        console.error('Failed to load nations', e);
        showToast('❌', 'Ошибка сети при загрузке наций');
        sel.innerHTML = '<option value="">❌ Ошибка сети</option>';
    }
}

async function gcOnNationChange() {
    const nation = document.getElementById('adminGcTankNation')?.value || '';
    const classEl = document.getElementById('adminGcTankClass');
    const tierEl = document.getElementById('adminGcTankTier');
    const tankEl = document.getElementById('adminGcTankPicker');
    if (classEl) classEl.innerHTML = '<option value="">Любой</option>';
    if (tierEl) tierEl.innerHTML = '<option value="0">Любой</option>';
    if (tankEl) { tankEl.innerHTML = ''; tankEl.style.display = 'none'; }
    gcAdminTankClass = null;
    gcAdminTankTier = null;
    gcClearTank();
    if (!nation) return;
    try {
        const resp = await fetch(`${BOT_API_URL}/api/global-challenge/tank-list?nation=${nation}`);
        const data = await resp.json();
        
        if (data.error) {
            showToast('❌', 'Ошибка типов: ' + data.error);
            classEl.innerHTML = '<option value="">⚠️ ' + data.error + '</option>';
            return;
        }
        
        if (!data.types || !classEl) return;
        classEl.innerHTML = '<option value="">Любой</option>';
        data.types.forEach(t => {
            classEl.innerHTML += `<option value="${t.id}">${t.name}</option>`;
        });
    } catch (e) { 
        console.error('Failed to load types', e);
        showToast('❌', 'Ошибка сети при загрузке типов');
    }
}

async function gcOnTankClassChange() {
    const nation = document.getElementById('adminGcTankNation')?.value || '';
    const cls = document.getElementById('adminGcTankClass')?.value || '';
    gcAdminTankClass = cls || null;
    const tierEl = document.getElementById('adminGcTankTier');
    const tankEl = document.getElementById('adminGcTankPicker');
    if (tierEl) tierEl.innerHTML = '<option value="0">Любой</option>';
    if (tankEl) { tankEl.innerHTML = ''; tankEl.style.display = 'none'; }
    gcAdminTankTier = null;
    gcClearTank();
    if (!nation || !cls) return;
    try {
        const resp = await fetch(`${BOT_API_URL}/api/global-challenge/tank-list?nation=${nation}&type=${cls}`);
        const data = await resp.json();
        
        if (data.error) {
            showToast('❌', 'Ошибка уровней: ' + data.error);
            tierEl.innerHTML = '<option value="0">⚠️ ' + data.error + '</option>';
            return;
        }
        
        if (!data.tiers || !tierEl) return;
        tierEl.innerHTML = '<option value="0">Любой</option>';
        data.tiers.forEach(t => {
            tierEl.innerHTML += `<option value="${t.id}">${t.name}</option>`;
        });
    } catch (e) { 
        console.error('Failed to load tiers', e);
        showToast('❌', 'Ошибка сети при загрузке уровней');
    }
}

async function gcOnTankTierChange() {
    const nation = document.getElementById('adminGcTankNation')?.value || '';
    const cls = document.getElementById('adminGcTankClass')?.value || '';
    const tier = parseInt(document.getElementById('adminGcTankTier')?.value || '0');
    gcAdminTankTier = tier || null;
    const tankEl = document.getElementById('adminGcTankPicker');
    if (tankEl) { tankEl.innerHTML = ''; tankEl.style.display = 'none'; }
    gcClearTank();
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
        const classNames = { heavyTank: '🛡️', mediumTank: '⚙️', lightTank: '🏎️', 'AT-SPG': '🎯', SPG: '💣' };
        tankEl.innerHTML = data.tanks.map(t => `
            <div onclick="gcSelectTank(${t.id}, '${(t.name || '').replace(/'/g, "\\'")}', '${t.type || ''}', ${t.tier || 0})" 
                 style="padding:7px 10px;font-size:0.65rem;color:#e0e0e0;cursor:pointer;border-bottom:1px solid rgba(255,255,255,0.04);display:flex;align-items:center;gap:6px;transition:background 0.15s;border-radius:6px"
                 onmouseover="this.style.background='rgba(200,170,110,0.1)'" onmouseout="this.style.background=''">
                <span>${classNames[t.type] || ''}</span>
                <span style="flex:1;font-weight:500">${t.name}</span>
            </div>
        `).join('');
    } catch (e) {
        if (tankEl) tankEl.innerHTML = '<div style="font-size:0.55rem;color:#ff6b6b;padding:6px;text-align:center">❌ Ошибка</div>';
    }
}

function gcSelectTank(tankId, name, type, tier) {
    gcAdminTankId = tankId;
    gcAdminTankName = name;
    const tankEl = document.getElementById('adminGcTankPicker');
    const selectedEl = document.getElementById('adminGcTankSelected');
    if (tankEl) tankEl.style.display = 'none';
    const classNames = { heavyTank: '🛡️ТТ', mediumTank: '⚙️СТ', lightTank: '🏎️ЛТ', 'AT-SPG': '🎯ПТ', SPG: '💣САУ' };
    const tierLabels = ['', 'I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII', 'IX', 'X'];
    if (selectedEl) {
        selectedEl.innerHTML = `
            <div style="display:inline-flex;align-items:center;gap:6px;padding:6px 12px;background:rgba(74,222,128,0.08);border:1px solid rgba(74,222,128,0.2);border-radius:10px;font-size:0.65rem">
                <span style="color:#C8AA6E;font-weight:700">${tierLabels[tier] || '?'}</span>
                <span>${classNames[type] || ''}</span>
                <span style="color:#4ade80;font-weight:600">${name}</span>
                <span onclick="gcClearTank()" style="cursor:pointer;color:#ff6b6b;font-size:0.8rem;margin-left:4px">✕</span>
            </div>
        `;
    }
    showToast(`🪖 Выбран: ${name}`);
}

function gcClearTank() {
    gcAdminTankId = null;
    gcAdminTankName = null;
    const selectedEl = document.getElementById('adminGcTankSelected');
    if (selectedEl) selectedEl.innerHTML = '';
}

function gcSetDuration(min) {
    document.getElementById('adminGcDuration').value = min;
    document.querySelectorAll('#gcAdminPanel .gc-preset-btn').forEach(b => b.classList.remove('gc-preset-btn--active'));
    event.target.classList.add('gc-preset-btn--active');
}

async function gcLaunchChallenge() {
    if (!myTelegramId) { showToast('⚠️ Нет Telegram ID'); return; }

    const title = document.getElementById('adminGcTitle').value || 'Общий Челлендж';
    const desc = document.getElementById('adminGcDesc').value || '';
    const duration = parseInt(document.getElementById('adminGcDuration').value) || 60;
    const reward = parseInt(document.getElementById('adminGcReward').value) || 500;
    const maxBattles = parseInt(document.getElementById('adminGcMaxBattles')?.value) || 0;

    const btn = document.getElementById('adminGcLaunchBtn');
    btn.disabled = true;
    btn.textContent = '⏳ Запускаем...';

    try {
        const resp = await fetch(`${BOT_API_URL}/api/global-challenge/create`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                admin_telegram_id: myTelegramId,
                title,
                description: desc,
                icon: '🔥',
                condition: gcAdminConditions.join(','),
                duration_minutes: duration,
                max_battles: maxBattles,
                reward_coins: reward,
                reward_description: `${reward} 🧀`,
                wot_nickname: localStorage.getItem('wot_nickname') || '',
                wot_account_id: localStorage.getItem('wot_account_id') || '',
                tank_class: gcAdminTankClass || '',
                tank_tier_filter: gcAdminTankTier || 0,
                tank_id_filter: gcAdminTankId || 0,
                tank_name_filter: gcAdminTankName || ''
            })
        });
        const data = await resp.json();

        if (data.success) {
            showToast('🚀 Челлендж запущен! Вы автоматически вступили.');
            gcLoadChallenge();
        } else {
            showToast(`❌ ${data.error}`);
        }
    } catch (e) {
        showToast('❌ Нет подключения');
    }

    btn.disabled = false;
    btn.textContent = '🚀 ЗАПУСТИТЬ ЧЕЛЛЕНДЖ';
}

async function gcStopChallenge() {
    if (!confirm('Завершить челлендж досрочно? Победитель будет определён по текущим результатам.')) return;

    const btn = document.getElementById('adminGcStopBtn');
    const challengeId = btn.getAttribute('data-id');

    try {
        const resp = await fetch(`${BOT_API_URL}/api/global-challenge/finish`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                admin_telegram_id: myTelegramId,
                challenge_id: parseInt(challengeId)
            })
        });
        const data = await resp.json();

        if (data.success) {
            showToast('✅ Челлендж завершён!');
            gcLoadChallenge();
        } else {
            showToast(`❌ ${data.error}`);
        }
    } catch (e) {
        showToast('❌ Нет подключения');
    }
}

async function gcDeleteChallenge() {
    if (!confirm('🗑 Удалить челлендж полностью? Все результаты будут утеряны!')) return;

    const deleteBtn = document.getElementById('adminGcDeleteBtn');
    const challengeId = deleteBtn.getAttribute('data-id') ||
        (document.getElementById('adminGcStopBtn').getAttribute('data-id'));

    if (!challengeId) {
        showToast('❌ Не найден ID челленджа');
        return;
    }

    try {
        const resp = await fetch(`${BOT_API_URL}/api/global-challenge/delete`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                admin_telegram_id: myTelegramId,
                challenge_id: parseInt(challengeId)
            })
        });
        const data = await resp.json();

        if (data.success) {
            showToast('🗑 Челлендж удалён');
            gcLoadChallenge();
        } else {
            showToast(`❌ ${data.error}`);
        }
    } catch (e) {
        showToast('❌ Нет подключения');
    }
}

// ============================================================
// CONFETTI 🎊
// ============================================================
function gcLaunchConfetti() {
    const canvas = document.getElementById('confettiCanvas');
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    canvas.width = window.innerWidth;
    canvas.height = window.innerHeight;

    const particles = [];
    const colors = ['#f5be0b', '#C8AA6E', '#ef4444', '#22c55e', '#3b82f6', '#f59e0b', '#a855f7'];

    for (let i = 0; i < 120; i++) {
        particles.push({
            x: Math.random() * canvas.width,
            y: -20 - Math.random() * 100,
            w: 4 + Math.random() * 6,
            h: 8 + Math.random() * 8,
            vx: (Math.random() - 0.5) * 4,
            vy: 2 + Math.random() * 4,
            color: colors[Math.floor(Math.random() * colors.length)],
            rot: Math.random() * 360,
            rotSpeed: (Math.random() - 0.5) * 8,
            opacity: 1,
        });
    }

    let frame = 0;
    function animate() {
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        let alive = 0;

        particles.forEach(p => {
            if (p.opacity <= 0) return;
            alive++;
            p.x += p.vx;
            p.y += p.vy;
            p.vy += 0.05;
            p.rot += p.rotSpeed;
            if (p.y > canvas.height + 20) { p.opacity = 0; return; }
            if (frame > 80) p.opacity -= 0.015;

            ctx.save();
            ctx.globalAlpha = Math.max(0, p.opacity);
            ctx.translate(p.x, p.y);
            ctx.rotate((p.rot * Math.PI) / 180);
            ctx.fillStyle = p.color;
            ctx.fillRect(-p.w / 2, -p.h / 2, p.w, p.h);
            ctx.restore();
        });

        frame++;
        if (alive > 0 && frame < 200) {
            requestAnimationFrame(animate);
        } else {
            ctx.clearRect(0, 0, canvas.width, canvas.height);
        }
    }

    animate();
}

// ============================================================
// AUTO-REFRESH & URL TAB SWITCHING
// ============================================================

// Auto-refresh данных каждые 15 секунд (без мерцания)
// Работает и на challenges.html (вкладка global) и на standalone global-challenge.html
setInterval(() => {
    const globalTab = document.getElementById('tab-global');
    // Если вкладка global активна ИЛИ мы на standalone странице (нет tab-global)
    const isGlobalTabActive = globalTab ? globalTab.classList.contains('tab-content--active') : true;
    if (isGlobalTabActive && gcCurrentChallenge) {
        gcLoadChallenge(false);
    }
}, 15000);

// Данные обновляются внутри gcLoadChallenge — отдельный refresh убран (был дублирующим)

// Check URL for ?tab=global on load
document.addEventListener('DOMContentLoaded', () => {
    const urlParams = new URLSearchParams(window.location.search);
    if (urlParams.get('tab') === 'global') {
        const globalBtn = document.querySelector('.arena-tab[onclick*="global"]');
        if (globalBtn) {
            switchTab('global', globalBtn);
        }
    }
});

// ============================================================
// WIDGET CONSTRUCTOR
// ============================================================

// Theme definitions
const WC_THEMES = {
    gold: {
        bg: 'rgba(26,21,8,{opacity})',
        accent: '#f5d36e',
        accentDark: '#8B6914',
        timerColor: '#f5d36e',
        timerShadow: '0 1px 0 #8B6914, 0 2px 4px rgba(0,0,0,0.5)',
        titleColor: '#ffeeb0',
        border: '#d4a745',
        meNick: '#f5d36e',
        meVal: '#ffeeb0',
        lbVal: '#d4a745',
        avatarBg: 'linear-gradient(135deg, #d4a745, #8B6914)',
        avatarText: '#1a1408',
    },
    neon: {
        bg: 'rgba(15,5,32,{opacity})',
        accent: '#a855f7',
        accentDark: '#6d28d9',
        timerColor: '#a855f7',
        timerShadow: '0 0 12px rgba(168,85,247,0.5)',
        titleColor: '#d8b4fe',
        border: '#7c3aed',
        meNick: '#c084fc',
        meVal: '#d8b4fe',
        lbVal: '#a855f7',
        avatarBg: 'linear-gradient(135deg, #a855f7, #6d28d9)',
        avatarText: '#1a0530',
    },
    military: {
        bg: 'rgba(15,26,10,{opacity})',
        accent: '#22c55e',
        accentDark: '#14532d',
        timerColor: '#22c55e',
        timerShadow: '0 1px 0 #14532d, 0 2px 4px rgba(0,0,0,0.5)',
        titleColor: '#bbf7d0',
        border: '#16a34a',
        meNick: '#4ade80',
        meVal: '#bbf7d0',
        lbVal: '#22c55e',
        avatarBg: 'linear-gradient(135deg, #22c55e, #14532d)',
        avatarText: '#052e16',
    },
    fire: {
        bg: 'rgba(26,8,0,{opacity})',
        accent: '#ff6b35',
        accentDark: '#b33d00',
        timerColor: '#ff6b35',
        timerShadow: '0 0 12px rgba(255,107,53,0.5), 0 2px 0 #b33d00',
        titleColor: '#ffd4b0',
        border: '#e55a00',
        meNick: '#ff8c5a',
        meVal: '#ffd4b0',
        lbVal: '#ff6b35',
        avatarBg: 'linear-gradient(135deg, #ff6b35, #b33d00)',
        avatarText: '#1a0800',
    },
    ice: {
        bg: 'rgba(4,10,20,{opacity})',
        accent: '#38bdf8',
        accentDark: '#0369a1',
        timerColor: '#38bdf8',
        timerShadow: '0 0 12px rgba(56,189,248,0.5), 0 2px 0 #0369a1',
        titleColor: '#bae6fd',
        border: '#0ea5e9',
        meNick: '#7dd3fc',
        meVal: '#bae6fd',
        lbVal: '#38bdf8',
        avatarBg: 'linear-gradient(135deg, #38bdf8, #0369a1)',
        avatarText: '#040a14',
    }
};

let wcCurrentTheme = 'gold';
let wcCurrentAccent = '#f5d36e';
let wcCurrentBorder = 'gold';
let wcCurrentLayout = 1;

function gcSelectLayout(num) {
    wcCurrentLayout = num;
    for (let i = 1; i <= 5; i++) {
        const el = document.getElementById(`wcLayout-${i}`);
        if (el) el.classList.toggle('wc-theme--active', i === num);
    }
    gcUpdatePreview();
}

function gcToggleWidgetConstructor() {
    const body = document.getElementById('wcBody');
    const arrow = document.getElementById('wcArrow');
    if (body.style.display === 'none') {
        body.style.display = '';
        arrow.classList.add('wc-section__arrow--open');
    } else {
        body.style.display = 'none';
        arrow.classList.remove('wc-section__arrow--open');
    }
}

function gcSelectTheme(theme) {
    wcCurrentTheme = theme;
    // Update theme card states
    document.querySelectorAll('.wc-theme').forEach(el => el.classList.remove('wc-theme--active'));
    const themeEl = document.getElementById(`wcTheme-${theme}`);
    if (themeEl) themeEl.classList.add('wc-theme--active');

    // Set accent from theme
    const t = WC_THEMES[theme];
    wcCurrentAccent = t.accent;

    // Update accent color active state
    document.querySelectorAll('.wc-color').forEach(el => {
        el.classList.toggle('wc-color--active', el.dataset.color === wcCurrentAccent);
    });

    gcUpdatePreview();
}

function gcSetAccent(el) {
    wcCurrentAccent = el.dataset.color;
    document.querySelectorAll('.wc-color').forEach(c => c.classList.remove('wc-color--active'));
    el.classList.add('wc-color--active');
    gcUpdatePreview();
}

function gcSetBorder(el) {
    wcCurrentBorder = el.dataset.border;
    document.querySelectorAll('.wc-toggle').forEach(b => b.classList.remove('wc-toggle--active'));
    el.classList.add('wc-toggle--active');
    gcUpdatePreview();
}

function gcUpdatePreview() {
    const wrap = document.getElementById('wcPreview');
    if (!wrap) return;

    const theme = WC_THEMES[wcCurrentTheme] || WC_THEMES.gold;
    const opacity = (document.getElementById('wcBgOpacity')?.value || 90) / 100;
    const fontScale = (document.getElementById('wcFontSize')?.value || 100) / 100;
    const showTimer = document.getElementById('wcShowTimer')?.checked !== false;
    const showMe = document.getElementById('wcShowMyStats')?.checked !== false;
    const showTop = document.getElementById('wcShowTop3')?.checked !== false;
    const showLive = document.getElementById('wcShowLive')?.checked !== false;

    const bgVal = document.getElementById('wcBgVal');
    if (bgVal) bgVal.textContent = Math.round(opacity * 100) + '%';
    const fontVal = document.getElementById('wcFontVal');
    if (fontVal) fontVal.textContent = Math.round(fontScale * 100) + '%';

    const ac = wcCurrentAccent;
    const bg = theme.bg.replace('{opacity}', opacity.toFixed(2));
    const tc = theme.titleColor;

    // Multi-condition preview data
    const selConds = (typeof gcAdminConditions !== 'undefined') ? gcAdminConditions : ['damage'];
    const isMulti = selConds.length > 1;
    const condIcons = selConds.map(c => (GC_CONDITION_MAP[c] || GC_CONDITION_MAP.damage).icon).join(' ');
    const condLabel = isMulti ? selConds.map(c => (GC_CONDITION_MAP[c] || GC_CONDITION_MAP.damage).icon).join('+') : (GC_CONDITION_MAP[selConds[0]] || GC_CONDITION_MAP.damage).name;
    
    // Fake multi-value data for preview
    const fakeMultiMeVal = isMulti 
        ? selConds.map(c => { const ci = GC_CONDITION_MAP[c] || GC_CONDITION_MAP.damage; return `${ci.icon}${Math.floor(Math.random()*5000+8000).toLocaleString('ru')}`; }).join(' · ')
        : '15,230';
    const fakeMultiP1 = isMulti
        ? selConds.map(c => `${(GC_CONDITION_MAP[c]||GC_CONDITION_MAP.damage).icon}${Math.floor(Math.random()*5000+12000).toLocaleString('ru')}`).join(' · ')
        : '18,500';
    const fakeMultiP2 = isMulti
        ? selConds.map(c => `${(GC_CONDITION_MAP[c]||GC_CONDITION_MAP.damage).icon}${Math.floor(Math.random()*5000+8000).toLocaleString('ru')}`).join(' · ')
        : '15,230';
    const fakeMultiP3 = isMulti
        ? selConds.map(c => `${(GC_CONDITION_MAP[c]||GC_CONDITION_MAP.damage).icon}${Math.floor(Math.random()*5000+5000).toLocaleString('ru')}`).join(' · ')
        : '12,100';
    // Short versions for compact layouts
    const fakeShortP1 = isMulti ? selConds.map(c => `${(GC_CONDITION_MAP[c]||GC_CONDITION_MAP.damage).icon}18k`).join('·') : '18k';
    const fakeShortP2 = isMulti ? selConds.map(c => `${(GC_CONDITION_MAP[c]||GC_CONDITION_MAP.damage).icon}15k`).join('·') : '15k';
    const fakeShortP3 = isMulti ? selConds.map(c => `${(GC_CONDITION_MAP[c]||GC_CONDITION_MAP.damage).icon}12k`).join('·') : '12k';

    // Condition badges for preview
    const condBadgeHtml = isMulti ? `<div style="display:flex;gap:2px;justify-content:center;margin:3px 0;flex-wrap:wrap">${selConds.map(c => {
        const ci = GC_CONDITION_MAP[c] || GC_CONDITION_MAP.damage;
        return `<span style="font-size:.2rem;padding:1px 4px;background:${ac}15;border:1px solid ${ac}33;border-radius:8px;color:${ac}">${ci.icon} ${ci.name}</span>`;
    }).join('')}</div>` : '';

    const live = showLive ? `<div style="position:absolute;top:4px;right:4px;background:#e00;color:#fff;font-size:.3rem;padding:1px 4px;border-radius:3px;font-weight:900">● LIVE</div>` : '';
    const timerHtml = showTimer ? `<div style="font-family:'Russo One',sans-serif;font-size:1.3rem;color:${theme.timerColor};text-shadow:${theme.timerShadow};line-height:1">52:30</div>` : '';
    const meHtml = showMe ? `<div style="display:flex;align-items:center;gap:4px;padding:4px 6px;border:1px solid ${ac}33;background:${ac}0d">
        <div style="width:16px;height:16px;border-radius:50%;background:${theme.avatarBg};display:flex;align-items:center;justify-content:center;font-size:.25rem;font-weight:900">FA</div>
        <div style="flex:1;font-size:.35rem;font-weight:700;color:${theme.meNick}">Fara777</div>
        <div style="font-family:'Russo One',sans-serif;font-size:${isMulti ? '.3' : '.45'}rem;color:${theme.meVal}">${fakeMultiMeVal}</div></div>` : '';
    const topHtml = showTop ? `<div style="font-size:.25rem">
        <div style="display:flex;gap:3px;padding:2px 4px;background:${ac}10;border-left:2px solid ${ac};margin-bottom:1px"><span style="color:${tc};font-weight:900">1</span><span style="flex:1">TankAce</span><span style="color:${theme.lbVal};font-weight:700;font-size:${isMulti ? '.2' : '.25'}rem">${fakeMultiP1}</span></div>
        <div style="display:flex;gap:3px;padding:2px 4px;background:${ac}08;border-left:2px solid #aaa;margin-bottom:1px"><span style="color:#aaa;font-weight:900">2</span><span style="flex:1">Fara777</span><span style="color:${theme.lbVal};font-weight:700;font-size:${isMulti ? '.2' : '.25'}rem">${fakeMultiP2}</span></div>
        <div style="display:flex;gap:3px;padding:2px 4px;background:${ac}06;border-left:2px solid #cd7f32"><span style="color:#cd7f32;font-weight:900">3</span><span style="flex:1">Wolf</span><span style="color:${theme.lbVal};font-weight:700;font-size:${isMulti ? '.2' : '.25'}rem">${fakeMultiP3}</span></div></div>` : '';

    // Border
    let border = `2px solid ${ac}`;
    let shadow = `0 0 10px ${ac}15`;
    if (wcCurrentBorder === 'glow') { border = `1px solid ${ac}44`; shadow = `0 0 15px ${ac}33`; }
    else if (wcCurrentBorder === 'minimal') { border = `1px solid ${ac}22`; shadow = 'none'; }
    else if (wcCurrentBorder === 'none') { border = 'none'; shadow = 'none'; }

    let html = '';
    const baseStyle = `background:${bg};border:${border};box-shadow:${shadow};border-radius:8px;position:relative;font-size:${(10 * fontScale)}px;overflow:hidden`;

    switch (wcCurrentLayout) {
        case 1: // Classic vertical
            html = `<div style="${baseStyle};width:180px;padding:10px;text-align:center">
                ${live}
                <div style="font-family:'Russo One',sans-serif;font-size:.45rem;color:${tc};margin-bottom:4px">${condIcons} Челлендж</div>
                ${timerHtml}
                <div style="font-size:.28rem;opacity:.4;margin:3px 0 6px">👥 3 · 🧀 500</div>
                ${condBadgeHtml}
                ${meHtml}
                <div style="margin-top:4px">${topHtml}</div>
            </div>`;
            break;

        case 2: // Compact horizontal
            html = `<div style="${baseStyle};width:240px;padding:8px">
                ${live}
                <div style="display:flex;gap:8px;align-items:center;margin-bottom:6px">
                    <div style="text-align:center">${timerHtml}<div style="font-size:.2rem;color:${ac};opacity:.5">ОСТАЛОСЬ</div></div>
                    <div style="flex:1"><div style="font-family:'Russo One',sans-serif;font-size:.4rem;color:${tc};margin-bottom:3px">${condIcons} Челлендж</div>${condBadgeHtml}${meHtml}</div>
                </div>
                <div style="display:flex;gap:2px">${showTop ? `
                    <div style="flex:1;font-size:.22rem;padding:3px 4px;background:${ac}10;border-radius:2px"><span style="color:${tc};font-weight:900">1</span> Ace <span style="color:${theme.lbVal}">${fakeShortP1}</span></div>
                    <div style="flex:1;font-size:.22rem;padding:3px 4px;background:${ac}08;border-radius:2px"><span style="color:#aaa;font-weight:900">2</span> Fara <span style="color:${theme.lbVal}">${fakeShortP2}</span></div>
                    <div style="flex:1;font-size:.22rem;padding:3px 4px;background:${ac}06;border-radius:2px"><span style="color:#cd7f32;font-weight:900">3</span> Wolf <span style="color:${theme.lbVal}">${fakeShortP3}</span></div>
                ` : ''}</div>
            </div>`;
            break;

        case 3: // Strip
            html = `<div style="${baseStyle};width:280px;padding:6px 10px;display:flex;align-items:center;gap:6px;border-radius:5px">
                ${showLive ? `<div style="background:#e00;color:#fff;font-size:.25rem;padding:1px 3px;border-radius:2px;font-weight:900">LIVE</div>` : ''}
                <div style="width:1px;height:14px;background:${ac};opacity:.15"></div>
                <div style="font-family:'Russo One',sans-serif;font-size:.35rem;color:${tc}">${condIcons} Челлендж</div>
                <div style="width:1px;height:14px;background:${ac};opacity:.15"></div>
                ${showTimer ? `<div style="font-family:'Russo One',sans-serif;font-size:.5rem;color:${theme.timerColor}">52:30</div>` : ''}
                ${showMe ? `<div style="width:1px;height:14px;background:${ac};opacity:.15"></div><div style="font-size:.3rem;color:${ac}">Fara: <span style="color:${tc}">${fakeMultiMeVal}</span></div>` : ''}
            </div>`;
            break;

        case 4: // Scoreboard
            html = `<div style="${baseStyle};width:${isMulti ? 220 : 180}px;border-radius:3px">
                ${live}
                <div style="padding:6px;text-align:center;border-bottom:1px solid rgba(255,255,255,.06)">
                    <div style="font-size:.3rem;color:${ac};letter-spacing:1px;opacity:.5">ЧЕЛЛЕНДЖ</div>
                    ${timerHtml}
                    ${condBadgeHtml}
                </div>
                <div style="padding:2px 4px;font-size:.2rem;opacity:.3;display:flex;border-bottom:1px solid rgba(255,255,255,.04)"><span style="width:14px">#</span><span style="flex:1">Игрок</span><span>${condLabel}</span></div>
                ${showTop ? `
                <div style="padding:3px 4px;font-size:.25rem;display:flex;align-items:center;border-bottom:1px solid rgba(255,255,255,.03)"><span style="width:14px;color:gold;font-weight:900">1</span><span style="flex:1">TankAce</span><span style="color:${theme.lbVal};font-size:${isMulti ? '.2' : '.25'}rem">${fakeMultiP1}</span></div>
                <div style="padding:3px 4px;font-size:.25rem;display:flex;align-items:center;background:${ac}10;border-left:2px solid ${ac};border-bottom:1px solid rgba(255,255,255,.03)"><span style="width:14px;color:silver;font-weight:900">2</span><span style="flex:1">⭐ Fara777</span><span style="color:${theme.lbVal};font-size:${isMulti ? '.2' : '.25'}rem">${fakeMultiP2}</span></div>
                <div style="padding:3px 4px;font-size:.25rem;display:flex;align-items:center"><span style="width:14px;color:#cd7f32;font-weight:900">3</span><span style="flex:1">Wolf</span><span style="color:${theme.lbVal};font-size:${isMulti ? '.2' : '.25'}rem">${fakeMultiP3}</span></div>
                ` : ''}
            </div>`;
            break;

        case 5: // HUD corners
            html = `<div style="width:200px;position:relative">
                ${showLive ? `<div style="position:absolute;top:0;left:50%;transform:translateX(-50%);background:${ac};color:#000;font-size:.25rem;padding:1px 6px;border-radius:0 0 3px 3px;font-weight:900;z-index:5">LIVE</div>` : ''}
                <div style="display:flex;gap:3px;margin-bottom:3px">
                    <div style="${baseStyle};flex:1;padding:6px;text-align:center;border-radius:5px">
                        <div style="font-size:.2rem;color:${ac};letter-spacing:1px;opacity:.5">⏱ ОСТАЛОСЬ</div>
                        ${timerHtml}
                        <div style="font-size:.25rem;color:${ac};margin-top:1px">${condIcons} Челлендж</div>
                    </div>
                    ${showMe ? `<div style="${baseStyle};flex:1;padding:6px;text-align:center;border-radius:5px">
                        <div style="font-size:.2rem;color:${ac};letter-spacing:1px;opacity:.5">👤 ${condLabel}</div>
                        <div style="font-size:.3rem;color:${ac};margin:2px 0">Fara777</div>
                        <div style="font-family:'Russo One',sans-serif;font-size:${isMulti ? '.45' : '.7'}rem;color:${tc}">${fakeMultiMeVal}</div>
                    </div>`: ''}
                </div>
                ${showTop ? `<div style="${baseStyle};display:flex;gap:2px;padding:3px;border-radius:4px">
                    <div style="flex:1;font-size:.22rem;padding:3px;background:${ac}10;border-radius:3px"><span style="color:gold;font-weight:900">1</span> Ace <span style="color:${theme.lbVal}">${fakeShortP1}</span></div>
                    <div style="flex:1;font-size:.22rem;padding:3px;background:${ac}08;border-radius:3px"><span style="color:silver;font-weight:900">2</span> Fara <span style="color:${theme.lbVal}">${fakeShortP2}</span></div>
                    <div style="flex:1;font-size:.22rem;padding:3px;background:${ac}06;border-radius:3px"><span style="color:#cd7f32;font-weight:900">3</span> Wolf <span style="color:${theme.lbVal}">${fakeShortP3}</span></div>
                </div>`: ''}
            </div>`;
            break;
    }

    wrap.innerHTML = html;
}

function gcGetWidgetConfig() {
    return {
        layout: wcCurrentLayout,
        theme: wcCurrentTheme,
        accent: wcCurrentAccent,
        border: wcCurrentBorder,
        bgOpacity: parseInt(document.getElementById('wcBgOpacity')?.value || 90),
        fontSize: parseInt(document.getElementById('wcFontSize')?.value || 100),
        showTimer: document.getElementById('wcShowTimer')?.checked !== false,
        showMyStats: document.getElementById('wcShowMyStats')?.checked !== false,
        showTop3: document.getElementById('wcShowTop3')?.checked !== false,
        showLive: document.getElementById('wcShowLive')?.checked !== false,
    };
}

function gcCopyCustomWidgetLink() {
    const config = gcGetWidgetConfig();
    const pathParts = window.location.pathname.split('/');
    pathParts[pathParts.length - 1] = 'gc-widget.html';
    const base = window.location.origin + pathParts.join('/');
    const params = new URLSearchParams();
    if (myTelegramId) params.set('telegram_id', myTelegramId);
    params.set('layout', config.layout);
    params.set('theme', config.theme);
    params.set('accent', config.accent.replace('#', ''));
    params.set('border', config.border);
    params.set('bg', config.bgOpacity);
    params.set('font', config.fontSize);
    if (!config.showTimer) params.set('timer', '0');
    if (!config.showMyStats) params.set('me', '0');
    if (!config.showTop3) params.set('top', '0');
    if (!config.showLive) params.set('live', '0');

    const url = `${base}?${params.toString()}`;
    navigator.clipboard.writeText(url).then(() => {
        showToast('📋 Ссылка на виджет скопирована!');
    }).catch(() => {
        const input = document.createElement('input');
        input.value = url;
        document.body.appendChild(input);
        input.select();
        document.execCommand('copy');
        document.body.removeChild(input);
        showToast('📋 Ссылка на виджет скопирована!');
    });
}
// ============================================================
// HISTORY: Загрузка завершенных челленджей
// ============================================================
async function gcLoadHistory() {
    const section = document.getElementById('gcHistorySection');
    const list = document.getElementById('gcHistoryList');
    if (!section || !list) return;

    try {
        const tgId = window.Telegram?.WebApp?.initDataUnsafe?.user?.id || '';
        const url = tgId
            ? `${BOT_API_URL}/api/global-challenge/history?telegram_id=${tgId}`
            : `${BOT_API_URL}/api/global-challenge/history`;
        const resp = await fetch(url);
        const data = await resp.json();

        if (data.history && data.history.length > 0) {
            section.style.display = '';

            const placeEmoji = ['🥇', '🥈', '🥉'];

            list.innerHTML = data.history.map(ch => {
                const date = new Date(ch.finished_at || ch.ends_at).toLocaleDateString('ru', {
                    day: 'numeric', month: 'short', year: 'numeric'
                });
                const conds = (ch.condition || 'damage').split(',');
                const icons = conds.map(c => (GC_CONDITION_MAP[c.trim()] || GC_CONDITION_MAP.damage).icon).join(' ');

                // Топ-3 участников
                const top3html = (ch.leaderboard_top3 || []).map((p, i) => `
                    <div class="gc-hist-top-row">
                        <span class="gc-hist-place">${placeEmoji[i] || `#${i+1}`}</span>
                        <span class="gc-hist-nick">${p.nickname}</span>
                        <span class="gc-hist-val">${(p.current_value||0).toLocaleString('ru')}</span>
                    </div>`).join('');

                // Личный результат
                let myHtml = '';
                if (ch.my_result) {
                    const pEmoji = placeEmoji[ch.my_result.place - 1] || `#${ch.my_result.place}`;
                    myHtml = `<div class="gc-hist-my-result">
                        <span>🎮 Мой результат: ${pEmoji} место</span>
                        <span>${(ch.my_result.value||0).toLocaleString('ru')} · ${ch.my_result.battles} боёв</span>
                    </div>`;
                }

                return `
                    <div class="gc-history-card" onclick="gcShowHistoryChallenge(${ch.id})">
                        <div class="gc-history-header">
                            <div class="gc-history-title">${icons} ${ch.title}</div>
                            <div class="gc-history-date">${date}</div>
                        </div>
                        <div class="gc-hist-top3">${top3html}</div>
                        ${myHtml}
                        <div class="gc-hist-footer">
                            <span>👥 ${ch.participants_count} участников</span>
                            <span>🧀 Приз: ${ch.reward_coins}</span>
                            <span style="color:#C8AA6E;font-weight:600">Подробнее →</span>
                        </div>
                    </div>
                `;
            }).join('');
        } else {
            section.style.display = 'none';
        }
    } catch(e) {
        console.error('History load error:', e);
    }
}


async function gcShowHistoryChallenge(id) {
    try {
        const resp = await fetch(`${BOT_API_URL}/api/global-challenge/active?challenge_id=${id}`);
        const data = await resp.json();
        if (data.challenge) {
            // Устанавливаем как текущий, чтобы "Подробно" работало для исторических боёв
            gcCurrentChallenge = data.challenge;
            gcShowFinished(data.challenge);
            window.scrollTo({ top: 0, behavior: 'smooth' });
        } else {
            showToast('❌ Данные этого челленджа недоступны');
        }
    } catch(e) {
        showToast('❌ Ошибка загрузки деталей');
    }
}

// ============================================================
// MODAL MANAGEMENT
// ============================================================
function gcCloseModal() {
    document.getElementById('gcModal').style.display = 'none';
}

async function gcShowPlayerDetail(tgId, nickname, isFinished = false, challengeId = null) {
    const modal = document.getElementById('gcModal');
    const title = document.getElementById('gcModalTitle');
    const summary = document.getElementById('gcModalSummary');
    const body = document.getElementById('gcModalBody');
    
    if (!modal) return;
    
    title.textContent = `Результаты: ${nickname}`;
    summary.innerHTML = `<div class="gc-modal-stat__label">Загрузка информации...</div>`;
    body.innerHTML = `<div style="text-align:center;padding:40px;color:#5A6577">⏳ Загрузка боёв...</div>`;
    modal.style.display = 'flex';

    const chId = challengeId || gcCurrentChallenge?.id;
    if (!chId) {
        body.innerHTML = 'Ошибка: ID челленджа не найден';
        return;
    }

    try {
        const resp = await fetch(`${BOT_API_URL}/api/global-challenge/battle-log?challenge_id=${chId}&telegram_id=${tgId}`);
        const data = await resp.json();
        
        if (!data.battles || data.battles.length === 0) {
            body.innerHTML = `<div style="text-align:center;padding:40px;color:#5A6577">Данных по боям пока нет.<br><span style="font-size:0.7rem">Убедитесь, что игрок сыграл хотя бы один бой после вступления.</span></div>`;
            summary.innerHTML = '';
            return;
        }

        const ch = gcCurrentChallenge; 
        const conditions = (ch?.condition || 'damage').split(',');
        
        // Рендерим бои
        let html = '<div class="gc-battles-list">';
        
        data.battles.forEach((b, i) => {
            const winCls = b.wins ? 'gc-battle-stat--win' : 'gc-battle-stat--loss';
            const winText = b.wins ? 'ПОБЕДА' : 'ПОРАЖЕНИЕ';
            
            let statsHtml = '';
            conditions.forEach(c => {
                const ci = GC_CONDITION_MAP[c] || GC_CONDITION_MAP.damage;
                const val = b[c] || 0;
                statsHtml += `<div class="gc-battle-stat gc-battle-stat--active">${ci.icon} ${val.toLocaleString('ru')}</div>`;
            });

            html += `
                <div class="gc-battle-row">
                    <div class="gc-battle-num">#${i+1}</div>
                    <div style="flex:1">
                        <div class="gc-battle-tank"><span class="gc-battle-tier">${b.tank_tier}</span> ${b.tank_name}</div>
                        <div class="gc-battle-stats">
                            <div class="gc-battle-stat ${winCls}">${winText}</div>
                            ${statsHtml}
                        </div>
                    </div>
                    <div style="font-size:0.5rem;color:#3E4A5C;text-align:right">
                        ${new Date(b.detected_at).toLocaleTimeString('ru', {hour:'2-digit', minute:'2-digit'})}
                    </div>
                </div>
            `;
        });
        html += '</div>';
        body.innerHTML = html;

        // Summary bar
        const totalDmg = data.battles.reduce((a, b) => a + (b.damage || 0), 0);
        const winsCount = data.battles.filter(b => b.wins).length;
        const wr = ((winsCount / data.battles.length) * 100).toFixed(0);
        
        summary.innerHTML = `
            <div class="gc-modal-results" style="width:100%;margin-bottom:0">
                <div class="gc-modal-stat">
                    <div class="gc-modal-stat__val">${data.battles.length}</div>
                    <div class="gc-modal-stat__label">Боёв</div>
                </div>
                <div class="gc-modal-stat">
                    <div class="gc-modal-stat__val">${wr}%</div>
                    <div class="gc-modal-stat__label">Побед</div>
                </div>
                <div class="gc-modal-stat gc-modal-stat--active">
                    <div class="gc-modal-stat__val">💥 ${totalDmg.toLocaleString('ru')}</div>
                    <div class="gc-modal-stat__label">Всего урона</div>
                </div>
                 <div class="gc-modal-stat">
                    <div class="gc-modal-stat__val">🎯 ${data.battles.reduce((a,b)=>a+(b.frags||0),0)}</div>
                    <div class="gc-modal-stat__label">Фрагов</div>
                </div>
            </div>
        `;

    } catch(e) {
        body.innerHTML = `<div style="color:#ef4444;text-align:center;padding:20px">Ошибка загрузки данных</div>`;
    }
}
