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

// ==========================================
// АДМИН-ПАНЕЛЬ (Промокоды)
// ==========================================
const ADMIN_ID = 6507474079;
let generatedPromos = JSON.parse(localStorage.getItem('admin_promos') || '[]');

function checkAdmin() {
    const panel = document.getElementById('adminPanel');
    if (!panel) return;

    if (tg && tg.initDataUnsafe?.user) {
        // В Telegram — проверяем ID
        const userId = tg.initDataUnsafe.user.id;
        if (userId === ADMIN_ID) {
            panel.style.display = 'block';
            renderPromoHistory();
        }
    } else {
        // В браузере (для тестирования) — показываем всегда
        panel.style.display = 'block';
        renderPromoHistory();
    }
}

function generatePromo() {
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    let code = 'MT-';
    for (let i = 0; i < 6; i++) {
        code += chars.charAt(Math.floor(Math.random() * chars.length));
    }

    // Show the code
    const resultEl = document.getElementById('promoResult');
    const codeEl = document.getElementById('generatedCode');
    const copyBtn = document.getElementById('copyPromoBtn');

    codeEl.textContent = code;
    resultEl.style.display = 'block';
    copyBtn.style.display = 'block';

    // Save to history
    generatedPromos.unshift({
        code: code,
        date: new Date().toLocaleString('ru'),
        used: false
    });
    if (generatedPromos.length > 20) generatedPromos = generatedPromos.slice(0, 20);
    localStorage.setItem('admin_promos', JSON.stringify(generatedPromos));
    renderPromoHistory();

    // Send to bot to create in database
    if (tg) {
        tg.sendData(JSON.stringify({
            action: 'create_promo',
            code: code,
            days: 30,
            uses: 1
        }));
    }

    // Haptic
    if (tg?.HapticFeedback) {
        tg.HapticFeedback.notificationOccurred('success');
    }

    showToast('🎟️', 'Промокод создан! ' + code);

    // Animate button
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
        btn.style.borderColor = 'rgba(74, 222, 128, 0.5)';
        btn.style.color = '#4ade80';
        setTimeout(() => {
            btn.textContent = '📋 Скопировать код';
            btn.style.borderColor = '';
            btn.style.color = '';
        }, 2000);

        if (tg?.HapticFeedback) {
            tg.HapticFeedback.impactOccurred('light');
        }
    });
}

function renderPromoHistory() {
    const listEl = document.getElementById('promoList');
    if (!listEl) return;

    if (generatedPromos.length === 0) {
        listEl.innerHTML = '<i>Пока пусто</i>';
        return;
    }

    listEl.innerHTML = generatedPromos.slice(0, 10).map(p => `
        <div style="display:flex; justify-content:space-between; align-items:center; padding: 8px 0; border-bottom: 1px solid rgba(255,255,255,0.03);">
            <div>
                <code style="color: #C8AA6E; font-size: 0.85rem; cursor:pointer;" onclick="navigator.clipboard.writeText('${p.code}'); showToast('📋','Скопировано!')">${p.code}</code>
                <div style="font-size: 0.65rem; color: #3A4555;">${p.date}</div>
            </div>
            <span style="font-size: 0.7rem; color: ${p.used ? '#ef4444' : '#4ade80'};">${p.used ? '❌ Использ.' : '✅ Активен'}</span>
        </div>
    `).join('');
}

// Check admin on load
document.addEventListener('DOMContentLoaded', checkAdmin);

window.generatePromo = generatePromo;
window.copyPromo = copyPromo;
