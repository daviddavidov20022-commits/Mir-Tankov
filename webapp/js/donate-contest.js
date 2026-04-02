/**
 * 🎤 Арена Донатов — Конкурсы с голосованием
 * JS для управления конкурсами, записями и голосованием
 */

// ============================================================
// STATE
// ============================================================
let dcContestId = 0;
let dcMyVote = null;
let dcTimerInterval = null;

const myTgId = (() => {
    const tg = window.Telegram?.WebApp;
    if (tg?.initDataUnsafe?.user?.id) return String(tg.initDataUnsafe.user.id);
    const p = new URLSearchParams(window.location.search);
    if (p.get('telegram_id')) return p.get('telegram_id');
    return localStorage.getItem('my_telegram_id') || '0';
})();

const DC_API = (() => {
    const params = new URLSearchParams(window.location.search);
    const host = params.get('api') || localStorage.getItem('api_host') || localStorage.getItem('bot_api_url');
    if (host) return host;
    return 'https://mir-tankov-production.up.railway.app';
})();

const ADMIN_ID = '6507474079';
const isAdmin = myTgId === ADMIN_ID;

// ============================================================
// INIT
// ============================================================
document.addEventListener('DOMContentLoaded', () => {
    if (isAdmin) {
        const adminBlock = document.getElementById('dc-admin-create');
        if (adminBlock) adminBlock.style.display = 'block';
    }
    dcLoadContests();
});

// ============================================================
// LOAD CONTESTS
// ============================================================
async function dcLoadContests() {
    const el = document.getElementById('dc-contest-list');
    if (!el) return;
    el.innerHTML = '<div style="text-align:center;padding:20px;color:#5A6577">⏳ Загрузка...</div>';
    try {
        const resp = await fetch(`${DC_API}/api/donate-contest/list?status=all`);
        const data = await resp.json();
        if (!data.contests || data.contests.length === 0) {
            el.innerHTML = `
                <div class="dc-empty">
                    <div class="dc-empty__icon">🎤</div>
                    <div class="dc-empty__title">Пока нет конкурсов</div>
                    <div class="dc-empty__desc">Конкурсы появятся здесь, когда администратор создаст новый</div>
                </div>`;
            return;
        }
        el.innerHTML = data.contests.map(c => dcRenderContestCard(c)).join('');
    } catch (e) {
        el.innerHTML = '<div style="text-align:center;padding:20px;color:#f87171">❌ Ошибка загрузки</div>';
    }
}

function dcRenderContestCard(c) {
    const isActive = c.status === 'active';
    const isFinished = c.status === 'finished';
    const statusClass = isActive ? 'dc-card__status--active' : 'dc-card__status--finished';
    const statusLabel = isActive ? '🟢 Активен' : '🏆 Завершён';
    const cardClass = isActive ? 'dc-card--active' : 'dc-card--finished';

    return `
        <div class="dc-card ${cardClass}" onclick="dcOpenContest(${c.id})">
            <div class="dc-card__header">
                <div>
                    <div class="dc-card__title">${c.title}</div>
                    ${c.prize ? `<div class="dc-card__prize">🎁 ${c.prize}</div>` : ''}
                </div>
                <span class="dc-card__status ${statusClass}">${statusLabel}</span>
            </div>
            <div class="dc-stats">
                <div class="dc-stat">
                    <div class="dc-stat__value">${c.entry_count || 0}</div>
                    <div class="dc-stat__label">участников</div>
                </div>
                <div class="dc-stat">
                    <div class="dc-stat__value">${(c.total_votes || 0).toLocaleString('ru')}</div>
                    <div class="dc-stat__label">голосов</div>
                </div>
                <div class="dc-stat">
                    <div class="dc-stat__value">🧀 ${(c.total_cheese || 0).toLocaleString('ru')}</div>
                    <div class="dc-stat__label">собрано</div>
                </div>
            </div>
            <div style="text-align:center;font-size:0.6rem;color:#5A6577">
                📌 Нажмите чтобы ${isActive ? 'участвовать и голосовать' : 'посмотреть результаты'}
            </div>
        </div>`;
}

// ============================================================
// OPEN CONTEST DETAIL
// ============================================================
async function dcOpenContest(contestId) {
    dcContestId = contestId;
    const listEl = document.getElementById('dc-contest-list');
    const detailEl = document.getElementById('dc-contest-detail');
    const adminEl = document.getElementById('dc-admin-create');
    if (listEl) listEl.style.display = 'none';
    if (adminEl) adminEl.style.display = 'none';
    if (detailEl) detailEl.style.display = 'block';
    await dcLoadEntries();
}

function dcBackToList() {
    const listEl = document.getElementById('dc-contest-list');
    const detailEl = document.getElementById('dc-contest-detail');
    const adminEl = document.getElementById('dc-admin-create');
    if (listEl) listEl.style.display = '';
    if (detailEl) detailEl.style.display = 'none';
    if (adminEl && isAdmin) adminEl.style.display = 'block';
    if (dcTimerInterval) { clearInterval(dcTimerInterval); dcTimerInterval = null; }
    dcLoadContests();
}

// ============================================================
// LOAD ENTRIES
// ============================================================
async function dcLoadEntries() {
    const el = document.getElementById('dc-detail-content');
    if (!el) return;
    el.innerHTML = '<div style="text-align:center;padding:20px;color:#5A6577">⏳</div>';
    try {
        const resp = await fetch(`${DC_API}/api/donate-contest/entries?contest_id=${dcContestId}&telegram_id=${myTgId}`);
        const data = await resp.json();
        if (data.error) { el.innerHTML = `<div style="text-align:center;color:#f87171;padding:20px">❌ ${data.error}</div>`; return; }

        const c = data.contest;
        dcMyVote = data.my_vote;
        const entries = data.entries || [];
        const isActive = c.status === 'active';
        const iAlreadySubmitted = entries.some(e => String(e.telegram_id) === myTgId);

        let html = '';

        // Title + prize
        html += `
            <div style="text-align:center;margin-bottom:16px">
                <div style="font-family:'Russo One',sans-serif;font-size:1rem;color:#E8E6E3;margin-bottom:4px">${c.title}</div>
                ${c.description ? `<div style="font-size:0.7rem;color:#5A6577;margin-bottom:6px">${c.description}</div>` : ''}
                ${c.prize ? `<div style="font-size:0.8rem;color:#c084fc;font-weight:700">🎁 Приз: ${c.prize}</div>` : ''}
            </div>`;

        // Timer
        if (isActive && c.ends_at) {
            html += `
                <div class="dc-timer">
                    <div class="dc-timer__label">⏳ До завершения</div>
                    <div class="dc-timer__value" id="dc-timer-value">--:--:--</div>
                </div>`;
        }

        // Winner banner
        if (c.status === 'finished' && c.winner_entry_id) {
            const winner = entries.find(e => e.id === c.winner_entry_id);
            if (winner) {
                html += `
                    <div class="dc-winner-banner">
                        <div class="dc-winner-banner__crown">👑</div>
                        <div class="dc-winner-banner__label">Победитель</div>
                        <div class="dc-winner-banner__name">${winner.nickname}</div>
                        <div style="font-size:0.7rem;color:#b8c0cc;margin-top:6px;font-style:italic">"${winner.message}"</div>
                        <div style="font-size:0.65rem;color:#c084fc;margin-top:4px">🗳️ ${winner.votes_count} голосов</div>
                    </div>`;
            }
        }

        // Stats
        const totalVotes = entries.reduce((s, e) => s + (e.votes_count || 0), 0);
        const totalCheese = entries.reduce((s, e) => s + (e.cheese_spent || 0), 0);
        html += `
            <div class="dc-stats">
                <div class="dc-stat">
                    <div class="dc-stat__value">${entries.length}</div>
                    <div class="dc-stat__label">участников</div>
                </div>
                <div class="dc-stat">
                    <div class="dc-stat__value">${totalVotes.toLocaleString('ru')}</div>
                    <div class="dc-stat__label">🗳️ голосов</div>
                </div>
                <div class="dc-stat">
                    <div class="dc-stat__value">🧀 ${totalCheese.toLocaleString('ru')}</div>
                    <div class="dc-stat__label">собрано</div>
                </div>
            </div>`;

        // Submit form (if active and not submitted)
        if (isActive && !iAlreadySubmitted) {
            html += `
                <div class="dc-submit-form">
                    <div class="dc-submit-form__title">✍️ Ваш креативный донат</div>
                    <textarea class="dc-textarea" id="dc-message-input" maxlength="500" placeholder="Напишите шутку, стих, историю или любой креативный текст..."></textarea>
                    <div class="dc-char-count"><span id="dc-char-counter">0</span> / 500</div>
                    <button class="dc-submit-btn" onclick="dcSubmitEntry()">
                        🎤 ОТПРАВИТЬ${c.entry_cost > 0 ? ` (${c.entry_cost} 🧀)` : ' (БЕСПЛАТНО)'}
                    </button>
                </div>`;
        } else if (isActive && iAlreadySubmitted) {
            html += `
                <div style="text-align:center;padding:12px;background:rgba(34,197,94,0.08);border-radius:12px;margin-bottom:14px;font-size:0.7rem;color:#4ade80;font-weight:600">
                    ✅ Вы уже участвуете! Ждите голосования
                </div>`;
        }

        // Entries list
        const maxVotes = entries.length > 0 ? Math.max(...entries.map(e => e.votes_count || 0), 1) : 1;
        html += `<div style="font-family:'Russo One',sans-serif;font-size:0.75rem;color:#c084fc;margin-bottom:10px">🗳️ Участники (${entries.length})</div>`;
        html += '<div class="dc-entries">';
        entries.forEach((e, i) => {
            const rank = i + 1;
            const pct = Math.round(((e.votes_count || 0) / maxVotes) * 100);
            const isVoted = dcMyVote === e.id;
            const isWinner = c.winner_entry_id === e.id;
            const isMe = String(e.telegram_id) === myTgId;
            const rankClass = rank <= 3 ? `dc-entry__rank--${rank}` : '';

            html += `
                <div class="dc-entry ${isVoted ? 'dc-entry--voted' : ''} ${isWinner ? 'dc-entry--winner' : ''}">
                    <div class="dc-entry__bar" style="width:${pct}%"></div>
                    <div class="dc-entry__content">
                        <div class="dc-entry__header">
                            <div style="display:flex;align-items:center">
                                <span class="dc-entry__rank ${rankClass}">${rank}</span>
                                <span class="dc-entry__author">${e.nickname}${isMe ? ' (вы)' : ''}</span>
                            </div>
                            <span class="dc-entry__cheese">🧀 ${e.cheese_spent || 0}</span>
                        </div>
                        <div class="dc-entry__message">${escapeHtml(e.message)}</div>
                        <div class="dc-entry__footer">
                            <span class="dc-entry__votes">🗳️ ${e.votes_count || 0} голосов</span>
                            ${isActive && !isMe ? `
                                <button class="dc-vote-btn ${isVoted ? 'dc-vote-btn--voted' : ''}"
                                    onclick="dcVote(${e.id})"
                                    ${isVoted ? '' : ''}>
                                    ${isVoted ? '✅ Ваш голос' : '👍 Голосовать'}
                                </button>` : ''}
                        </div>
                    </div>
                </div>`;
        });
        html += '</div>';

        // Admin: finish button
        if (isAdmin && isActive) {
            html += `
                <button onclick="dcFinishContest()" style="width:100%;padding:14px;border:none;border-radius:14px;background:linear-gradient(135deg,#C8AA6E,#8B7340);color:#0a0e14;font-family:'Russo One',sans-serif;font-size:0.85rem;cursor:pointer;margin-top:12px">
                    🏆 ЗАВЕРШИТЬ КОНКУРС
                </button>`;
        }

        // Widget link (admin)
        if (isAdmin) {
            const widgetUrl = `${window.location.origin}${window.location.pathname.replace(/[^/]*$/, '')}dc-widget.html?contest_id=${dcContestId}`;
            html += `
                <div style="margin-top:12px;padding:12px;background:rgba(0,0,0,0.2);border-radius:12px;text-align:center">
                    <div style="font-size:0.6rem;color:#5A6577;margin-bottom:4px">📺 OBS Виджет</div>
                    <input type="text" value="${widgetUrl}" readonly onclick="this.select();navigator.clipboard.writeText(this.value)"
                        style="width:100%;padding:8px;background:rgba(0,0,0,0.3);border:1px solid rgba(168,85,247,0.2);border-radius:8px;color:#c084fc;font-size:0.55rem;text-align:center;outline:none;cursor:pointer">
                </div>`;
        }

        el.innerHTML = html;

        // Start timer
        if (isActive && c.ends_at) {
            dcStartTimer(c.ends_at);
        }

        // Char counter
        const textarea = document.getElementById('dc-message-input');
        if (textarea) {
            textarea.addEventListener('input', () => {
                document.getElementById('dc-char-counter').textContent = textarea.value.length;
            });
        }
    } catch (e) {
        el.innerHTML = '<div style="text-align:center;color:#f87171;padding:20px">❌ Ошибка загрузки</div>';
    }
}

// ============================================================
// SUBMIT ENTRY
// ============================================================
async function dcSubmitEntry() {
    const msg = document.getElementById('dc-message-input')?.value?.trim();
    if (!msg) { dcShowToast('✏️ Напишите сообщение'); return; }
    if (myTgId === '0') { dcShowToast('❌ Авторизуйтесь через Telegram'); return; }

    try {
        const resp = await fetch(`${DC_API}/api/donate-contest/submit`, {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ telegram_id: myTgId, contest_id: dcContestId, message: msg })
        });
        const data = await resp.json();
        if (data.success) {
            dcShowToast(`🎤 Участие принято! Потрачено: ${data.cheese_spent} 🧀`);
            await dcLoadEntries();
        } else {
            dcShowToast(`❌ ${data.error}`);
        }
    } catch (e) { dcShowToast('❌ Нет подключения'); }
}

// ============================================================
// VOTE
// ============================================================
async function dcVote(entryId) {
    if (myTgId === '0') { dcShowToast('❌ Авторизуйтесь через Telegram'); return; }
    try {
        const resp = await fetch(`${DC_API}/api/donate-contest/vote`, {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ telegram_id: myTgId, contest_id: dcContestId, entry_id: entryId })
        });
        const data = await resp.json();
        if (data.success) {
            dcShowToast(data.action === 'changed' ? '🔄 Голос изменён!' : '✅ Голос принят!');
            await dcLoadEntries();
        } else {
            dcShowToast(`❌ ${data.error}`);
        }
    } catch (e) { dcShowToast('❌ Нет подключения'); }
}

// ============================================================
// FINISH CONTEST (admin)
// ============================================================
async function dcFinishContest() {
    if (!confirm('Завершить конкурс? Победитель определится по голосам.')) return;
    try {
        const resp = await fetch(`${DC_API}/api/donate-contest/finish`, {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ telegram_id: myTgId, contest_id: dcContestId })
        });
        const data = await resp.json();
        if (data.success) {
            dcShowToast(`🏆 Конкурс завершён! Победитель: ${data.winner?.nickname || '—'}`);
            await dcLoadEntries();
        } else {
            dcShowToast(`❌ ${data.error}`);
        }
    } catch (e) { dcShowToast('❌ Нет подключения'); }
}

// ============================================================
// CREATE CONTEST (admin)
// ============================================================
async function dcCreateContest() {
    const title = document.getElementById('dc-create-title')?.value?.trim();
    const description = document.getElementById('dc-create-desc')?.value?.trim();
    const prize = document.getElementById('dc-create-prize')?.value?.trim();
    const entryCost = parseInt(document.getElementById('dc-create-cost')?.value || '100');
    const duration = parseInt(document.getElementById('dc-create-duration')?.value || '120');

    if (!title) { dcShowToast('✏️ Введите название'); return; }

    try {
        const resp = await fetch(`${DC_API}/api/donate-contest/create`, {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                telegram_id: myTgId, title, description, prize,
                entry_cost: entryCost, duration_minutes: duration
            })
        });
        const data = await resp.json();
        if (data.success) {
            dcShowToast('🎉 Конкурс создан!');
            dcLoadContests();
            // Clear form
            ['dc-create-title', 'dc-create-desc', 'dc-create-prize'].forEach(id => {
                const el = document.getElementById(id);
                if (el) el.value = '';
            });
        } else {
            dcShowToast(`❌ ${data.error}`);
        }
    } catch (e) { dcShowToast('❌ Нет подключения'); }
}

// ============================================================
// TIMER
// ============================================================
function dcStartTimer(endsAt) {
    if (dcTimerInterval) clearInterval(dcTimerInterval);
    const endTime = new Date(endsAt).getTime();
    const el = document.getElementById('dc-timer-value');
    if (!el) return;
    const tick = () => {
        const diff = endTime - Date.now();
        if (diff <= 0) {
            el.textContent = '🔔 ВРЕМЯ ВЫШЛО!';
            el.style.color = '#f87171';
            clearInterval(dcTimerInterval);
            return;
        }
        const h = Math.floor(diff / 3600000);
        const m = Math.floor((diff % 3600000) / 60000);
        const s = Math.floor((diff % 60000) / 1000);
        el.textContent = `${String(h).padStart(2,'0')}:${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')}`;
    };
    tick();
    dcTimerInterval = setInterval(tick, 1000);
}

// ============================================================
// UTILS
// ============================================================
function escapeHtml(str) {
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
}

function dcShowToast(text) {
    if (typeof showToast === 'function') { showToast('', text); return; }
    const toast = document.createElement('div');
    toast.style.cssText = 'position:fixed;bottom:80px;left:50%;transform:translateX(-50%);padding:12px 24px;border-radius:14px;background:rgba(0,0,0,0.9);color:#fff;font-size:0.8rem;z-index:99999;backdrop-filter:blur(10px);border:1px solid rgba(200,170,110,0.2);';
    toast.textContent = text;
    document.body.appendChild(toast);
    setTimeout(() => toast.remove(), 3000);
}
