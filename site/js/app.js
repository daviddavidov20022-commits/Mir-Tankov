/**
 * МИР ТАНКОВ — Главный скрипт (app.js)
 * Управление данными пользователя, навигация, бонусы
 */

let BOT_API_URL = 'https://mir-tankov-production.up.railway.app';


// ==========================================
// ДАННЫЕ ПОЛЬЗОВАТЕЛЯ
// ==========================================
const DEFAULT_USER_DATA = {
    coins: 500,  // СЫР (🧀)
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

const BOT_API_URL_APP = 'https://mir-tankov-production.up.railway.app';

document.addEventListener('DOMContentLoaded', () => {
    initUser();
    userData.updateUI();
    // Сбрасываем кеш подписки при каждой загрузке — всегда берём свежее с API
    localStorage.removeItem('is_subscribed');
    loadBalanceFromAPI();
    createParticles();
    checkDailyBonus();
});

// Загрузить баланс и статус подписки из API (единый источник правды)
async function loadBalanceFromAPI() {
    try {
        // Определяем telegram_id
        let tgId = null;
        const urlParams = new URLSearchParams(window.location.search);
        const urlId = urlParams.get('telegram_id');
        if (urlId) {
            tgId = urlId;
            localStorage.setItem('my_telegram_id', tgId);
        }
        if (!tgId) {
            const tg = window.Telegram?.WebApp;
            if (tg?.initDataUnsafe?.user?.id) {
                tgId = tg.initDataUnsafe.user.id;
                localStorage.setItem('my_telegram_id', String(tgId));
            }
        }
        if (!tgId) tgId = localStorage.getItem('my_telegram_id');
        if (!tgId) return;

        const resp = await fetch(`${BOT_API_URL_APP}/api/me?telegram_id=${tgId}`);
        const data = await resp.json();
        if (data.cheese !== undefined && data.cheese !== null) {
            userData.data.coins = data.cheese;
            userData.save();
            userData.updateUI();
        }

        // Статус подписки — всегда берём с сервера, кеш не доверяем
        const isActive = !!(data.subscription && data.subscription.active);
        localStorage.setItem('is_subscribed', isActive ? '1' : '0');
        updateLockCards(isActive);

        // Если мы на премиум-странице и подписки нет — выгоняем на главную
        if (!isActive) {
            const currentPage = window.location.pathname.split('/').pop();
            const onPremiumPage = PREMIUM_PAGES && PREMIUM_PAGES.some(p => currentPage === p);
            if (onPremiumPage) {
                const myId = localStorage.getItem('my_telegram_id');
                window.location.href = myId ? `index.html?telegram_id=${myId}` : 'index.html';
                return;
            }
        }
    } catch (e) {
        // API не доступно — используем кеш (но не доверяем ему надолго)
        console.log('API недоступно, используем localStorage');
    }
}

// Проверяем, есть ли подписка
function isPremium() {
    return localStorage.getItem('is_subscribed') === '1';
}

// Обновляем внешний вид карточек на главной (убираем/добавляем замок)
function updateLockCards(hasSubscription) {
    document.querySelectorAll('.feature-card[data-premium="1"]').forEach(card => {
        if (hasSubscription) {
            card.classList.remove('feature-card--locked');
            const lock = card.querySelector('.lock-overlay');
            if (lock) lock.remove();
        }
    });
}

function initUser() {
    const nameEl = document.getElementById('userName');
    const avatarEl = document.getElementById('userAvatar');

    let telegramId = null;

    if (tg && tg.initDataUnsafe?.user) {
        const user = tg.initDataUnsafe.user;
        if (nameEl) nameEl.textContent = user.first_name || 'Танкист';
        if (avatarEl) avatarEl.textContent = '🪖';
        telegramId = user.id;
    }

    // Берём telegram_id из URL (?telegram_id=xxx)
    if (!telegramId) {
        const urlParams = new URLSearchParams(window.location.search);
        const idFromUrl = urlParams.get('telegram_id');
        if (idFromUrl) telegramId = parseInt(idFromUrl);
    }

    // Сохраняем Telegram ID для друзей/чата
    if (telegramId) {
        localStorage.setItem('my_telegram_id', String(telegramId));
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
        if (textEl) textEl.textContent = `+${bonus} сыр 🧀 (серия: ${streak + 1} дн.)`;
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

    showToast('🎁', `Бонус получен! +${bonus} сыр 🧀 (серия: ${streak} дн.)`);
    checkDailyBonus();

    // Haptic feedback
    if (tg?.HapticFeedback) {
        tg.HapticFeedback.notificationOccurred('success');
    }
}

// ==========================================
// НАВИГАЦИЯ
// ==========================================
// Список страниц, требующих подписки
const PREMIUM_PAGES = [
    'player.html',     // Донаты и Музыка
    'top.html',        // Рейтинги
    'challenges.html', // Арена
    'quiz.html',       // Танковая Викторина
    'wheel.html',      // Колесо Фортуны
    // cheese.html НЕ блокируем — это страница покупки, всем доступна
    'contest.html',    // Голосование
];
// Бесплатные страницы: stats.html, donate.html (Спасибо), subscribe.html, profile.html...

function openGame(url) {
    // Проверяем, требует ли страница подписки
    const pageName = url.split('?')[0].split('/').pop();
    const needsPremium = PREMIUM_PAGES.some(p => pageName === p || url.includes(p));

    if (needsPremium && !isPremium()) {
        // Показываем красивый попап с предложением подписки
        showPaywall();
        return;
    }

    // Add unique timestamp + telegram_id to bypass ALL caching layers
    const sep = url.includes('?') ? '&' : '?';
    url += `${sep}_t=${Date.now()}`;
    const myId = localStorage.getItem('my_telegram_id');
    if (myId) {
        url += `&telegram_id=${myId}`;
    }
    window.location.href = url;
}

// Показываем paywall при попытке открыть платную функцию
function showPaywall() {
    // Удаляем предыдущий если есть
    let existing = document.getElementById('paywallModal');
    if (existing) existing.remove();

    const modal = document.createElement('div');
    modal.id = 'paywallModal';
    modal.style.cssText = `
        position: fixed; inset: 0; z-index: 9999;
        background: rgba(0,0,0,0.85); backdrop-filter: blur(8px);
        display: flex; align-items: center; justify-content: center;
        padding: 20px; animation: fadeInUp 0.3s ease;
    `;
    modal.innerHTML = `
        <div style="
            background: linear-gradient(145deg, #1a2332, #0f1520);
            border: 1px solid rgba(200,170,110,0.3);
            border-radius: 24px; padding: 32px 24px;
            max-width: 380px; width: 100%; text-align: center;
            position: relative; box-shadow: 0 20px 60px rgba(0,0,0,0.6);
        ">
            <button onclick="document.getElementById('paywallModal').remove()" style="
                position: absolute; top: 16px; right: 16px;
                background: rgba(255,255,255,0.06); border: none; color: #9AA4B5;
                width: 32px; height: 32px; border-radius: 50%; cursor: pointer;
                font-size: 18px; display:flex; align-items:center; justify-content:center;
            ">✕</button>

            <div style="font-size: 3rem; margin-bottom: 12px;">🔒</div>
            <div style="
                font-family: 'Russo One', sans-serif;
                font-size: 1.2rem; color: #C8AA6E; margin-bottom: 8px;
            ">Только для подписчиков</div>
            <div style="font-size: 0.85rem; color: #8B95A5; margin-bottom: 24px; line-height: 1.6;">
                Эта функция доступна с подпиской.<br>
                Оформи подписку и открой весь клуб!
            </div>

            <div style="display: grid; gap: 8px; margin-bottom: 20px; text-align: left;">
                <div style="display:flex; align-items:center; gap:8px; font-size:0.8rem; color:#9AA4B5;">
                    <span style="color:#C8AA6E">✅</span> Донаты и Музыка
                </div>
                <div style="display:flex; align-items:center; gap:8px; font-size:0.8rem; color:#9AA4B5;">
                    <span style="color:#C8AA6E">✅</span> Рейтинги
                </div>
                <div style="display:flex; align-items:center; gap:8px; font-size:0.8rem; color:#9AA4B5;">
                    <span style="color:#C8AA6E">✅</span> Арена PvP
                </div>
                <div style="display:flex; align-items:center; gap:8px; font-size:0.8rem; color:#9AA4B5;">
                    <span style="color:#C8AA6E">✅</span> Танковая Викторина
                </div>
                <div style="display:flex; align-items:center; gap:8px; font-size:0.8rem; color:#9AA4B5;">
                    <span style="color:#C8AA6E">✅</span> Ежедневная Награда
                </div>
                <div style="display:flex; align-items:center; gap:8px; font-size:0.8rem; color:#9AA4B5;">
                    <span style="color:#C8AA6E">✅</span> Колесо Фортуны
                </div>
            </div>

            <button onclick="
                document.getElementById('paywallModal').remove();
                window.location.href='subscribe.html';
            " style="
                width: 100%; padding: 16px;
                background: linear-gradient(135deg, #C8AA6E, #E8D5A3);
                border: none; border-radius: 14px;
                font-family: 'Russo One', sans-serif;
                font-size: 1rem; color: #0a0e14;
                cursor: pointer; transition: all 0.2s;
                box-shadow: 0 4px 20px rgba(200,170,110,0.3);
            ">💎 Оформить подписку — от 490 ₽</button>

            <div style="font-size:0.65rem; color:#4A5568; margin-top:10px;">
                Первый месяц — промо цена · Скидки до −25%
            </div>
        </div>
    `;
    document.body.appendChild(modal);
    modal.addEventListener('click', e => {
        if (e.target === modal) modal.remove();
    });
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

// Проверяем админ-панель при загрузке (ждём загрузку Telegram SDK)
setTimeout(() => {
    console.log('[ADMIN] Checking admin...', window.Telegram?.WebApp?.initDataUnsafe?.user);
    checkAdmin();
}, 1000);

// ==========================================
// АДМИН-ПАНЕЛЬ (Промокоды)
// ==========================================
const ADMIN_ID = 6507474079;
let generatedPromos = JSON.parse(localStorage.getItem('admin_promos') || '[]');

function checkAdmin() {
    const tgApp = window.Telegram?.WebApp;
    const tgUser = tgApp?.initDataUnsafe?.user;

    console.log('[ADMIN] tgUser:', tgUser, 'ADMIN_ID:', ADMIN_ID);

    // Способ 1: через Telegram initData
    let isAdmin = tgUser && tgUser.id === ADMIN_ID;

    // Способ 2: через localStorage (секретный режим)
    if (!isAdmin && localStorage.getItem('admin_mode') === 'true') {
        isAdmin = true;
    }

    if (!isAdmin) return;

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

// Вход в админку по кнопке ⚙️ с паролем
function toggleAdmin() {
    const isAdmin = localStorage.getItem('admin_mode') === 'true';
    if (isAdmin) {
        localStorage.removeItem('admin_mode');
        const c = document.getElementById('adminPanelContainer');
        if (c) c.innerHTML = '';
        showToast('🔒', 'Админ-режим отключён');
        return;
    }

    // Создаём модал ввода пароля (prompt не работает в Telegram)
    const overlay = document.createElement('div');
    overlay.id = 'adminPassOverlay';
    overlay.style.cssText = 'position:fixed;top:0;left:0;width:100%;height:100%;background:rgba(0,0,0,0.8);z-index:10000;display:flex;align-items:center;justify-content:center;padding:20px;';

    overlay.innerHTML = `
        <div style="background:#131a24;border:1px solid rgba(200,170,110,0.3);border-radius:20px;padding:24px;width:100%;max-width:320px;text-align:center;">
            <div style="font-size:2rem;margin-bottom:8px;">🔐</div>
            <div style="font-family:'Russo One',sans-serif;color:#C8AA6E;font-size:0.95rem;margin-bottom:16px;">Пароль администратора</div>
            <input type="password" id="adminPassInput" placeholder="Введите пароль..." 
                   style="width:100%;padding:14px;background:#0a0e14;border:2px solid rgba(200,170,110,0.3);border-radius:12px;color:#fff;font-size:1rem;text-align:center;outline:none;margin-bottom:12px;font-family:'Inter',sans-serif;">
            <div style="display:flex;gap:8px;">
                <button onclick="document.getElementById('adminPassOverlay').remove()" 
                        style="flex:1;padding:12px;background:rgba(255,255,255,0.06);border:1px solid rgba(255,255,255,0.1);border-radius:12px;color:#9AA4B5;font-size:0.85rem;cursor:pointer;">
                    Отмена
                </button>
                <button onclick="submitAdminPass()" 
                        style="flex:1;padding:12px;background:linear-gradient(135deg,#C8AA6E,#E8D5A3);border:none;border-radius:12px;color:#0a0e14;font-weight:700;font-size:0.85rem;cursor:pointer;">
                    Войти
                </button>
            </div>
        </div>
    `;
    document.body.appendChild(overlay);

    // Фокус на поле ввода
    setTimeout(() => document.getElementById('adminPassInput').focus(), 100);

    // Enter = submit
    document.getElementById('adminPassInput').addEventListener('keydown', (e) => {
        if (e.key === 'Enter') submitAdminPass();
    });

    // Клик по оверлею = закрыть
    overlay.addEventListener('click', (e) => {
        if (e.target === overlay) overlay.remove();
    });
}

function submitAdminPass() {
    const input = document.getElementById('adminPassInput');
    const overlay = document.getElementById('adminPassOverlay');
    if (input.value === 'admin2026') {
        localStorage.setItem('admin_mode', 'true');
        if (overlay) overlay.remove();
        checkAdmin();
        showToast('👑', 'Админ-режим активирован!');
    } else {
        input.style.borderColor = '#e74c3c';
        input.value = '';
        input.placeholder = 'Неверный пароль!';
        showToast('❌', 'Неверный пароль');
    }
}

window.toggleAdmin = toggleAdmin;
window.submitAdminPass = submitAdminPass;

// ==========================================
// ПРОВЕРКА СТАТУСА СТРИМОВ (LIVE/OFFLINE)
// ==========================================

// Конфиг — замените на свои ключи
const STREAM_CONFIG = {
    // YouTube Data API v3 ключ (получить: https://console.cloud.google.com/)
    YOUTUBE_API_KEY: 'AIzaSyAT7aSehc7wNkebqwXWrwAwIauUw7TUMAc',  // TODO: вставить ключ
    YOUTUBE_CHANNEL_ID: 'UClMCysoDnCFN2oQUu9fcQRg',  // TODO: вставить Channel ID (не @handle)

    // Twitch API (получить: https://dev.twitch.tv/console/apps)
    TWITCH_CLIENT_ID: '',  // TODO: вставить Client ID

    // Интервал обновления (мс)
    REFRESH_INTERVAL: 120000,  // 2 минуты
};

// Хранилище статусов
const streamStatus = {
    youtube: { live: false, viewers: 0 },
    vkplay: { live: false, viewers: 0 },
    trovo: { live: false, viewers: 0 },
    twitch: { live: false, viewers: 0 },
};

// === Обновить UI карточки ===
function updateStreamCard(platform, isLive, viewers = 0) {
    streamStatus[platform] = { live: isLive, viewers };

    const badgeMap = { youtube: 'ytBadge', vkplay: 'vkBadge', trovo: 'trovoBadge', twitch: 'twitchBadge' };
    const viewerMap = { youtube: 'ytViewers', vkplay: 'vkViewers', trovo: 'trovoViewers', twitch: 'twitchViewers' };
    const cardMap = { youtube: 'linkYoutube', vkplay: 'linkVkplay', trovo: 'linkTrovo', twitch: 'linkTwitch' };

    const badge = document.getElementById(badgeMap[platform]);
    const viewerEl = document.getElementById(viewerMap[platform]);
    const card = document.getElementById(cardMap[platform]);

    if (!badge) return;

    if (isLive) {
        badge.textContent = 'LIVE';
        badge.className = 'stream-card__badge stream-badge--live';
        if (viewerEl) {
            viewerEl.style.display = 'flex';
            viewerEl.querySelector('.viewers-count').textContent = viewers.toLocaleString();
        }
        if (card) card.classList.add('stream-card--live');
    } else {
        badge.textContent = 'OFFLINE';
        badge.className = 'stream-card__badge stream-badge--offline';
        if (viewerEl) viewerEl.style.display = 'none';
        if (card) card.classList.remove('stream-card--live');
    }

    // Обновить общий счётчик
    updateTotalViewers();
}

// === Общий счётчик зрителей ===
function updateTotalViewers() {
    const total = Object.values(streamStatus).reduce((sum, s) => sum + (s.live ? s.viewers : 0), 0);
    const anyLive = Object.values(streamStatus).some(s => s.live);
    const totalEl = document.getElementById('streamTotal');
    const countEl = document.getElementById('totalViewers');

    if (totalEl) {
        totalEl.style.display = anyLive ? 'flex' : 'none';
    }
    if (countEl) {
        countEl.textContent = total.toLocaleString();
    }
}

// === Запуск всех проверок через бэкенд ===
async function checkAllStreams() {
    try {
        const resp = await fetch(`${BOT_API_URL}/api/streams/status`);
        const data = await resp.json();

        for (const platform of ['youtube', 'vkplay', 'trovo', 'twitch']) {
            if (data[platform]) {
                updateStreamCard(platform, data[platform].live, data[platform].viewers || 0);
            }
        }
    } catch (e) {
        console.warn('Streams check error:', e);
    }
}

// Запуск при загрузке + автообновление
document.addEventListener('DOMContentLoaded', () => {
    setTimeout(checkAllStreams, 1500);
    setInterval(checkAllStreams, STREAM_CONFIG.REFRESH_INTERVAL);
});

// ==========================================
// НАВИГАЦИЯ С ПЕРЕДАЧЕЙ telegram_id
// ==========================================
function _getMyTelegramId() {
    // 1. Telegram SDK
    const tg = window.Telegram?.WebApp;
    if (tg?.initDataUnsafe?.user?.id) {
        const id = String(tg.initDataUnsafe.user.id);
        localStorage.setItem('my_telegram_id', id);
        return id;
    }
    // 2. URL параметры
    const urlId = new URLSearchParams(window.location.search).get('telegram_id');
    if (urlId) {
        localStorage.setItem('my_telegram_id', urlId);
        return urlId;
    }
    // 3. localStorage (несколько ключей)
    return localStorage.getItem('my_telegram_id') ||
           localStorage.getItem('tg_user_id') ||
           localStorage.getItem('site_telegram_id') ||
           null;
}

function goToProfile() {
    const tgId = _getMyTelegramId();
    const url = tgId ? `profile.html?telegram_id=${tgId}&_t=${Date.now()}` : `profile.html?_t=${Date.now()}`;
    window.location.href = url;
}

window.goToProfile = goToProfile;
