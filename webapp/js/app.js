/**
 * МИР ТАНКОВ — Главный скрипт (app.js)
 * Управление данными пользователя, навигация, бонусы
 */

// ==========================================
// ДАННЫЕ ПОЛЬЗОВАТЕЛЯ
// ==========================================
const DEFAULT_USER_DATA = {
    coins: 500,
    xp: 0,
    wins: 0,
    games: 0,
    lastDailyBonus: null,
    dailyStreak: 0,
};

class UserData {
    constructor() {
        this.data = this.load();
    }

    load() {
        try {
            const saved = localStorage.getItem('wot_user_data');
            if (saved) {
                return { ...DEFAULT_USER_DATA, ...JSON.parse(saved) };
            }
        } catch (e) {
            console.warn('Ошибка загрузки данных:', e);
        }
        return { ...DEFAULT_USER_DATA };
    }

    save() {
        try {
            localStorage.setItem('wot_user_data', JSON.stringify(this.data));
        } catch (e) {
            console.warn('Ошибка сохранения:', e);
        }
    }

    get(key) {
        return this.data[key];
    }

    set(key, value) {
        this.data[key] = value;
        this.save();
    }

    addCoins(amount) {
        this.data.coins += amount;
        this.save();
        this.updateUI();
        return this.data.coins;
    }

    addXP(amount) {
        this.data.xp += amount;
        this.save();
        this.updateUI();
        return this.data.xp;
    }

    addWin() {
        this.data.wins += 1;
        this.save();
        this.updateUI();
    }

    addGame() {
        this.data.games += 1;
        this.save();
        this.updateUI();
    }

    updateUI() {
        const coinsEl = document.getElementById('coinsCount');
        const xpEl = document.getElementById('xpCount');
        const winsEl = document.getElementById('winsCount');
        const gamesEl = document.getElementById('gamesCount');

        if (coinsEl) this.animateValue(coinsEl, this.data.coins);
        if (xpEl) this.animateValue(xpEl, this.data.xp);
        if (winsEl) this.animateValue(winsEl, this.data.wins);
        if (gamesEl) this.animateValue(gamesEl, this.data.games);
    }

    animateValue(element, targetValue) {
        const currentValue = parseInt(element.textContent) || 0;
        if (currentValue === targetValue) {
            element.textContent = targetValue;
            return;
        }

        const diff = targetValue - currentValue;
        const duration = 500;
        const steps = 20;
        const stepValue = diff / steps;
        let step = 0;

        const interval = setInterval(() => {
            step++;
            const value = Math.round(currentValue + stepValue * step);
            element.textContent = value;

            if (step >= steps) {
                element.textContent = targetValue;
                clearInterval(interval);
            }
        }, duration / steps);
    }
}

// ==========================================
// TELEGRAM WEBAPP
// ==========================================
let tg = null;
try {
    tg = window.Telegram?.WebApp;
    if (tg) {
        tg.ready();
        tg.expand();
        tg.setHeaderColor('#0a0e14');
        tg.setBackgroundColor('#0a0e14');
    }
} catch (e) {
    console.log('Telegram WebApp не доступен');
}

// ==========================================
// ИНИЦИАЛИЗАЦИЯ
// ==========================================
const userData = new UserData();

document.addEventListener('DOMContentLoaded', () => {
    initUser();
    userData.updateUI();
    createParticles();
    checkDailyBonus();
});

function initUser() {
    const nameEl = document.getElementById('userName');
    const avatarEl = document.getElementById('userAvatar');

    if (tg && tg.initDataUnsafe?.user) {
        const user = tg.initDataUnsafe.user;
        if (nameEl) nameEl.textContent = user.first_name || 'Танкист';
        if (avatarEl) avatarEl.textContent = '🪖';
    }
}

// ==========================================
// ФОНОВЫЕ ЧАСТИЦЫ
// ==========================================
function createParticles() {
    const container = document.getElementById('bgParticles');
    if (!container) return;

    const particleCount = 25;

    for (let i = 0; i < particleCount; i++) {
        const particle = document.createElement('div');
        particle.className = 'bg-particle';
        particle.style.left = Math.random() * 100 + '%';
        particle.style.animationDuration = (8 + Math.random() * 12) + 's';
        particle.style.animationDelay = Math.random() * 10 + 's';
        particle.style.width = (1 + Math.random() * 3) + 'px';
        particle.style.height = particle.style.width;
        container.appendChild(particle);
    }
}

// ==========================================
// ЕЖЕДНЕВНЫЙ БОНУС
// ==========================================
function checkDailyBonus() {
    const lastBonus = userData.get('lastDailyBonus');
    const today = new Date().toDateString();
    const btnEl = document.getElementById('dailyBonusBtn');
    const textEl = document.getElementById('dailyBonusText');

    if (lastBonus === today) {
        if (btnEl) {
            btnEl.disabled = true;
            btnEl.textContent = '✅ Получено';
        }
        if (textEl) textEl.textContent = 'Приходи завтра за новым бонусом!';
    } else {
        const streak = userData.get('dailyStreak') || 0;
        const bonus = 50 + streak * 10;
        if (textEl) textEl.textContent = `+${bonus} монет (серия: ${streak + 1} дн.)`;
    }
}

function claimDailyBonus() {
    const lastBonus = userData.get('lastDailyBonus');
    const today = new Date().toDateString();

    if (lastBonus === today) return;

    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    const wasYesterday = lastBonus === yesterday.toDateString();

    let streak = wasYesterday ? (userData.get('dailyStreak') || 0) + 1 : 1;
    const bonus = 50 + (streak - 1) * 10;

    userData.set('lastDailyBonus', today);
    userData.set('dailyStreak', streak);
    userData.addCoins(bonus);

    showToast('🎁', `Бонус получен! +${bonus} монет (серия: ${streak} дн.)`);
    checkDailyBonus();

    // Haptic feedback
    if (tg?.HapticFeedback) {
        tg.HapticFeedback.notificationOccurred('success');
    }
}

// ==========================================
// НАВИГАЦИЯ
// ==========================================
function openGame(url) {
    window.location.href = url;
}

// ==========================================
// УВЕДОМЛЕНИЯ
// ==========================================
function showToast(icon, text, duration = 3000) {
    // Remove existing toast
    const existingToast = document.querySelector('.toast');
    if (existingToast) existingToast.remove();

    const toast = document.createElement('div');
    toast.className = 'toast';
    toast.innerHTML = `
        <span class="toast__icon">${icon}</span>
        <span class="toast__text">${text}</span>
    `;
    document.body.appendChild(toast);

    requestAnimationFrame(() => {
        toast.classList.add('toast--visible');
    });

    setTimeout(() => {
        toast.classList.remove('toast--visible');
        setTimeout(() => toast.remove(), 400);
    }, duration);
}

// Expose to global scope
window.userData = userData;
window.showToast = showToast;
window.openGame = openGame;
window.claimDailyBonus = claimDailyBonus;

// Проверяем админ-панель при загрузке
setTimeout(checkAdmin, 300);

// ==========================================
// АДМИН-ПАНЕЛЬ (Промокоды)
// ==========================================
const ADMIN_ID = 6507474079;
let generatedPromos = JSON.parse(localStorage.getItem('admin_promos') || '[]');

function checkAdmin() {
    // ТОЛЬКО в Telegram и ТОЛЬКО для админа
    const tgApp = window.Telegram?.WebApp;
    if (!tgApp || !tgApp.initDataUnsafe?.user) return;
    if (tgApp.initDataUnsafe.user.id !== ADMIN_ID) return;

    const container = document.getElementById('adminPanelContainer');
    if (!container) return;

    // Создаём панель динамически
    container.innerHTML = `
        <section class="section-header" style="margin-top:24px">
            <h2>👑 Админ-панель</h2>
            <p>Управление промокодами</p>
        </section>
        <div style="background:linear-gradient(145deg,#1a2332,#161d28);border:1px solid rgba(200,170,110,0.2);border-radius:16px;padding:20px;margin-bottom:16px">
            <div style="text-align:center;margin-bottom:16px">
                <span style="font-size:2rem">🎟️</span>
                <h3 style="font-family:'Russo One',sans-serif;color:#C8AA6E;margin:8px 0 4px">Генератор промокодов</h3>
                <p style="color:#5A6577;font-size:0.75rem">Одноразовый код на 30 дней</p>
            </div>
            <div id="promoResult" style="display:none;margin-bottom:16px">
                <div style="background:rgba(200,170,110,0.08);border:2px dashed rgba(200,170,110,0.4);border-radius:12px;padding:16px;text-align:center">
                    <div style="font-size:0.6rem;color:#5A6577;text-transform:uppercase;letter-spacing:2px;margin-bottom:4px">Промокод</div>
                    <div id="generatedCode" style="font-family:'Russo One',monospace;font-size:1.6rem;color:#C8AA6E;letter-spacing:4px;cursor:pointer;user-select:all"></div>
                    <div style="font-size:0.65rem;color:#5A6577;margin-top:4px">Нажмите чтобы скопировать</div>
                </div>
            </div>
            <button id="generatePromoBtn" onclick="generatePromo()" style="width:100%;padding:14px;border:none;border-radius:12px;font-family:'Russo One',sans-serif;font-size:0.85rem;cursor:pointer;background:linear-gradient(135deg,#C8AA6E,#E8D5A3);color:#0a0e14;margin-bottom:8px">🎟️ Сгенерировать промокод</button>
            <button id="copyPromoBtn" onclick="copyPromo()" style="display:none;width:100%;padding:12px;border:1px solid rgba(200,170,110,0.3);border-radius:12px;font-family:'Inter',sans-serif;font-size:0.8rem;cursor:pointer;background:transparent;color:#C8AA6E">📋 Скопировать код</button>
        </div>
        <div style="background:linear-gradient(145deg,#1a2332,#161d28);border:1px solid rgba(255,255,255,0.05);border-radius:16px;padding:16px">
            <h4 style="color:#5A6577;font-size:0.75rem;text-transform:uppercase;letter-spacing:1px;margin-bottom:12px">📋 Последние коды</h4>
            <div id="promoList" style="font-size:0.8rem;color:#9AA4B5"><i>Пока пусто</i></div>
        </div>
    `;
    renderPromoHistory();
}

function generatePromo() {
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    let code = 'MT-';
    for (let i = 0; i < 6; i++) {
        code += chars.charAt(Math.floor(Math.random() * chars.length));
    }

    document.getElementById('generatedCode').textContent = code;
    document.getElementById('promoResult').style.display = 'block';
    document.getElementById('copyPromoBtn').style.display = 'block';

    generatedPromos.unshift({ code, date: new Date().toLocaleString('ru'), used: false });
    if (generatedPromos.length > 20) generatedPromos = generatedPromos.slice(0, 20);
    localStorage.setItem('admin_promos', JSON.stringify(generatedPromos));
    renderPromoHistory();

    const tgApp = window.Telegram?.WebApp;
    if (tgApp) {
        tgApp.sendData(JSON.stringify({ action: 'create_promo', code, days: 30, uses: 1 }));
    }

    if (tgApp?.HapticFeedback) tgApp.HapticFeedback.notificationOccurred('success');
    showToast('🎟️', 'Промокод создан! ' + code);

    const btn = document.getElementById('generatePromoBtn');
    btn.textContent = '✅ Создан!';
    btn.style.background = 'linear-gradient(135deg, #22c55e, #16a34a)';
    setTimeout(() => {
        btn.textContent = '🎟️ Ещё один промокод';
        btn.style.background = 'linear-gradient(135deg, #C8AA6E, #E8D5A3)';
    }, 1500);
}

function copyPromo() {
    const code = document.getElementById('generatedCode').textContent;
    navigator.clipboard.writeText(code).then(() => {
        showToast('📋', 'Скопировано: ' + code);
        const btn = document.getElementById('copyPromoBtn');
        btn.textContent = '✅ Скопировано!';
        setTimeout(() => { btn.textContent = '📋 Скопировать код'; }, 2000);
        if (tg?.HapticFeedback) tg.HapticFeedback.impactOccurred('light');
    });
}

function renderPromoHistory() {
    const listEl = document.getElementById('promoList');
    if (!listEl) return;
    if (generatedPromos.length === 0) { listEl.innerHTML = '<i>Пока пусто</i>'; return; }
    listEl.innerHTML = generatedPromos.slice(0, 10).map(p => `
        <div style="display:flex;justify-content:space-between;align-items:center;padding:8px 0;border-bottom:1px solid rgba(255,255,255,0.03)">
            <div>
                <code style="color:#C8AA6E;font-size:0.85rem;cursor:pointer" onclick="navigator.clipboard.writeText('${p.code}');showToast('📋','Скопировано!')">${p.code}</code>
                <div style="font-size:0.65rem;color:#3A4555">${p.date}</div>
            </div>
            <span style="font-size:0.7rem;color:${p.used ? '#ef4444' : '#4ade80'}">${p.used ? '❌' : '✅'}</span>
        </div>
    `).join('');
}

document.addEventListener('DOMContentLoaded', checkAdmin);
window.generatePromo = generatePromo;
window.copyPromo = copyPromo;
