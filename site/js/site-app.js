/**
 * МИР ТАНКОВ — Автономный сайт (site-app.js)
 * Без зависимости от Telegram SDK
 * Авторизация через telegram_id
 */

const API_BASE = 'https://mir-tankov-production.up.railway.app';

// ==========================================
// АВТОРИЗАЦИЯ
// ==========================================
class SiteAuth {
    constructor() {
        this.telegramId = localStorage.getItem('site_telegram_id');
        this.username = localStorage.getItem('site_username') || 'Танкист';
        this.isLoggedIn = !!this.telegramId;
    }

    get isAdmin() {
        const ADMIN_ID = 6507474079;
        const tgId = parseInt(this.getTelegramId());
        return tgId === ADMIN_ID || localStorage.getItem('admin_mode') === 'true';
    }

    login(telegramId, username) {
        this.telegramId = String(telegramId);
        this.username = username || 'Танкист';
        this.isLoggedIn = true;
        localStorage.setItem('site_telegram_id', this.telegramId);
        localStorage.setItem('site_username', this.username);
        localStorage.setItem('my_telegram_id', this.telegramId);
    }

    logout() {
        this.telegramId = null;
        this.username = 'Танкист';
        this.isLoggedIn = false;
        localStorage.removeItem('site_telegram_id');
        localStorage.removeItem('site_username');
        localStorage.removeItem('my_telegram_id');
        window.location.href = 'index.html';
    }

    getTelegramId() {
        return this.telegramId || localStorage.getItem('my_telegram_id');
    }
}

const siteAuth = new SiteAuth();

// ==========================================
// ДАННЫЕ ПОЛЬЗОВАТЕЛЯ
// ==========================================
const DEFAULT_USER_DATA = {
    coins: 0,
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

    get(key) { return this.data[key]; }

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

    addWin() { this.data.wins += 1; this.save(); this.updateUI(); }
    addGame() { this.data.games += 1; this.save(); this.updateUI(); }

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
        const steps = 20;
        const stepValue = diff / steps;
        let step = 0;
        const interval = setInterval(() => {
            step++;
            element.textContent = Math.round(currentValue + stepValue * step);
            if (step >= steps) {
                element.textContent = targetValue;
                clearInterval(interval);
            }
        }, 25);
    }
}

const userData = new UserData();

// ==========================================
// ИНИЦИАЛИЗАЦИЯ
// ==========================================
document.addEventListener('DOMContentLoaded', () => {
    // Проверяем авторизацию
    const hasTelegramWebApp = !!window.Telegram?.WebApp?.initDataUnsafe?.user;
    const hasUrlTelegramId = new URLSearchParams(window.location.search).has('telegram_id');
    const hasLocalTelegramId = !!localStorage.getItem('my_telegram_id');
    const isOnMainPage = window.location.pathname.includes('index.html') || window.location.pathname.endsWith('/');
    
    if (!siteAuth.isLoggedIn && !hasTelegramWebApp && !hasUrlTelegramId && !hasLocalTelegramId && !isOnMainPage) {
        // Не на главной и не залогинен никаким способом — перенаправляем
        window.location.href = 'index.html';
        return;
    }

    initUser();
    userData.updateUI();
    loadBalanceFromAPI();
    createParticles();
    checkDailyBonus();
});

function initUser() {
    const nameEl = document.getElementById('userName');
    const avatarEl = document.getElementById('userAvatar');
    
    if (nameEl && siteAuth.username) {
        nameEl.textContent = siteAuth.username;
    }
    if (avatarEl) {
        avatarEl.textContent = '🪖';
    }
}

// Загрузить баланс и подписку из API
async function loadBalanceFromAPI() {
    const tgId = siteAuth.getTelegramId();
    if (!tgId) return;

    // Сбрасываем кеш подписки — всегда берём свежее с сервера
    localStorage.removeItem('is_subscribed');

    try {
        const resp = await fetch(`${API_BASE}/api/me?telegram_id=${tgId}`);
        const data = await resp.json();
        if (data.cheese !== undefined && data.cheese !== null) {
            userData.data.coins = data.cheese;
            userData.save();
            userData.updateUI();
        }
        if (data.nickname || data.wot_nickname) {
            const name = data.nickname || data.wot_nickname;
            siteAuth.username = name;
            localStorage.setItem('site_username', name);
            const nameEl = document.getElementById('userName');
            if (nameEl) nameEl.textContent = name;
        }

        // === ПОДПИСКА ===
        const isActive = !!(data.subscription && data.subscription.active);
        localStorage.setItem('is_subscribed', isActive ? '1' : '0');

        // Обновляем замки на карточках
        document.querySelectorAll('.feature-card[data-premium="1"]').forEach(card => {
            if (isActive) {
                card.classList.remove('feature-card--locked');
                const lock = card.querySelector('.lock-overlay');
                if (lock) lock.remove();
            } else {
                if (!card.classList.contains('feature-card--locked')) {
                    card.classList.add('feature-card--locked');
                    if (!card.querySelector('.lock-overlay')) {
                        const lockEl = document.createElement('div');
                        lockEl.className = 'lock-overlay';
                        lockEl.innerHTML = '🔒';
                        card.appendChild(lockEl);
                    }
                }
            }
        });

        // Если мы на премиум-странице и подписки нет — выгоняем
        if (!isActive) {
            const currentPage = window.location.pathname.split('/').pop();
            const premiumPages = ['player.html', 'top.html', 'challenges.html', 'quiz.html', 'wheel.html', 'contest.html'];
            if (premiumPages.some(p => currentPage === p)) {
                window.location.href = tgId ? `index.html?telegram_id=${tgId}` : 'index.html';
                return;
            }
        }
    } catch (e) {
        console.log('API недоступно, используем localStorage');
    }
}

// ==========================================
// ЭКРАН ЛОГИНА
// ==========================================
function showLoginScreen() {
    const loginOverlay = document.getElementById('loginOverlay');
    const mainApp = document.getElementById('mainApp');
    
    if (siteAuth.isLoggedIn) {
        if (loginOverlay) loginOverlay.style.display = 'none';
        if (mainApp) mainApp.style.display = 'block';
        return false;
    }
    
    if (loginOverlay) loginOverlay.style.display = 'flex';
    if (mainApp) mainApp.style.display = 'none';
    return true;
}

async function doLogin() {
    const input = document.getElementById('loginInput');
    const errorEl = document.getElementById('loginError');
    const value = input.value.trim();
    
    if (!value) {
        if (errorEl) errorEl.textContent = 'Введите Telegram ID или никнейм';
        input.classList.add('shake');
        setTimeout(() => input.classList.remove('shake'), 600);
        return;
    }

    const btn = document.getElementById('loginBtn');
    btn.disabled = true;
    btn.textContent = '⏳ Проверяем...';
    if (errorEl) errorEl.textContent = '';

    try {
        const isNumber = /^\d+$/.test(value);
        
        if (isNumber) {
            // Telegram ID — API автоматически создаёт пользователя
            const resp = await fetch(`${API_BASE}/api/me?telegram_id=${value}`);
            const data = await resp.json();
            console.log('[Login] API response:', data);
            
            if (data.telegram_id) {
                const name = data.wot_nickname || data.first_name || data.username || 'Танкист';
                siteAuth.login(data.telegram_id, name);
                
                const loginOverlay = document.getElementById('loginOverlay');
                const mainApp = document.getElementById('mainApp');
                if (loginOverlay) loginOverlay.style.display = 'none';
                if (mainApp) mainApp.style.display = 'block';
                
                initUser();
                loadBalanceFromAPI();
                showToast('✅', `Добро пожаловать, ${siteAuth.username}!`);
            } else {
                if (errorEl) errorEl.textContent = data.error || 'Не удалось войти. Попробуйте ещё раз.';
            }
        } else {
            // Никнейм — ищем через search API
            const resp = await fetch(`${API_BASE}/api/users/search?q=${encodeURIComponent(value)}`);
            const data = await resp.json();
            console.log('[Login] Search response:', data);
            
            if (data.users && data.users.length > 0) {
                // Нашли — берём первого совпавшего
                const user = data.users[0];
                siteAuth.login(user.telegram_id, user.wot_nickname || user.first_name || value);
                
                const loginOverlay = document.getElementById('loginOverlay');
                const mainApp = document.getElementById('mainApp');
                if (loginOverlay) loginOverlay.style.display = 'none';
                if (mainApp) mainApp.style.display = 'block';
                
                initUser();
                loadBalanceFromAPI();
                showToast('✅', `Добро пожаловать, ${siteAuth.username}!`);
            } else {
                if (errorEl) errorEl.textContent = 'Игрок с таким никнеймом не найден. Попробуйте ввести Telegram ID (число).';
            }
        }
    } catch (e) {
        console.error('[Login] Error:', e);
        if (errorEl) errorEl.textContent = 'Ошибка подключения к серверу. Попробуйте позже.';
    }

    btn.disabled = false;
    btn.textContent = '🚀 Войти';
}


// ==========================================
// ФОНОВЫЕ ЧАСТИЦЫ
// ==========================================
function createParticles() {
    const container = document.getElementById('bgParticles');
    if (!container) return;
    for (let i = 0; i < 25; i++) {
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
        if (btnEl) { btnEl.disabled = true; btnEl.textContent = '✅ Получено'; }
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
}

// Список страниц, требующих подписки
const PREMIUM_PAGES = [
    'player.html', 'top.html', 'challenges.html',
    'quiz.html', 'wheel.html', 'contest.html'
];

function isPremium() {
    return localStorage.getItem('is_subscribed') === '1';
}

function showPaywall() {
    const existing = document.getElementById('paywallOverlay');
    if (existing) existing.remove();

    const overlay = document.createElement('div');
    overlay.id = 'paywallOverlay';
    overlay.style.cssText = 'position:fixed;top:0;left:0;width:100%;height:100%;background:rgba(0,0,0,0.85);backdrop-filter:blur(12px);z-index:10000;display:flex;align-items:center;justify-content:center;padding:20px;';
    overlay.innerHTML = `
        <div style="background:linear-gradient(145deg,#1a2332,#161d28);border:2px solid rgba(255,193,7,0.3);border-radius:24px;padding:36px 28px;text-align:center;max-width:360px;width:100%;">
            <div style="font-size:4rem;margin-bottom:12px;">🔒</div>
            <div style="font-family:'Russo One',sans-serif;font-size:1.4rem;color:#FFC107;margin-bottom:12px;">ПРЕМИУМ ФУНКЦИЯ</div>
            <div style="font-size:0.9rem;color:#aaa;margin-bottom:24px;line-height:1.5;">
                Эта функция доступна только подписчикам закрытого клуба.<br>
                Оформите подписку через бота <b>@Mir_tankov_privat_bot</b>
            </div>
            <button onclick="openGame('subscribe.html')" style="width:100%;padding:14px;border:none;border-radius:14px;background:linear-gradient(135deg,#FFC107,#FF9800);color:#1a1a1a;font-family:'Russo One',sans-serif;font-size:0.95rem;cursor:pointer;margin-bottom:10px;">👑 Оформить подписку</button>
            <button onclick="document.getElementById('paywallOverlay').remove()" style="width:100%;padding:12px;border:1px solid rgba(255,255,255,0.1);border-radius:14px;background:transparent;color:#888;font-size:0.85rem;cursor:pointer;">Назад</button>
        </div>
    `;
    overlay.addEventListener('click', (e) => { if (e.target === overlay) overlay.remove(); });
    document.body.appendChild(overlay);
}

function openGame(url) {
    // Проверяем, требует ли страница подписки
    const pageName = url.split('?')[0].split('/').pop();
    const needsPremium = PREMIUM_PAGES.some(p => pageName === p);

    if (needsPremium && !isPremium()) {
        showPaywall();
        return;
    }

    // Add timestamp to bypass Telegram WebView cache
    const sep = url.includes('?') ? '&' : '?';
    url += `${sep}_t=${Date.now()}`;
    const myId = siteAuth.getTelegramId();
    if (myId) {
        url += `&telegram_id=${myId}`;
    }
    window.location.href = url;
}

// ==========================================
// УВЕДОМЛЕНИЯ
// ==========================================
function showToast(icon, text, duration = 3000) {
    const existingToast = document.querySelector('.toast');
    if (existingToast) existingToast.remove();

    const toast = document.createElement('div');
    toast.className = 'toast';
    toast.innerHTML = `
        <span class="toast__icon">${icon}</span>
        <span class="toast__text">${text}</span>
    `;
    document.body.appendChild(toast);
    requestAnimationFrame(() => toast.classList.add('toast--visible'));
    setTimeout(() => {
        toast.classList.remove('toast--visible');
        setTimeout(() => toast.remove(), 400);
    }, duration);
}

// ==========================================
// ПРОВЕРКА СТАТУСА СТРИМОВ
// ==========================================
const streamStatus = {
    youtube: { live: false, viewers: 0 },
    vkplay: { live: false, viewers: 0 },
    trovo: { live: false, viewers: 0 },
    twitch: { live: false, viewers: 0 },
};

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
    updateTotalViewers();
}

function updateTotalViewers() {
    const total = Object.values(streamStatus).reduce((sum, s) => sum + (s.live ? s.viewers : 0), 0);
    const anyLive = Object.values(streamStatus).some(s => s.live);
    const totalEl = document.getElementById('streamTotal');
    const countEl = document.getElementById('totalViewers');
    if (totalEl) totalEl.style.display = anyLive ? 'flex' : 'none';
    if (countEl) countEl.textContent = total.toLocaleString();
}

async function checkAllStreams() {
    try {
        const resp = await fetch(`${API_BASE}/api/streams/status`);
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

document.addEventListener('DOMContentLoaded', () => {
    setTimeout(checkAllStreams, 1500);
    setInterval(checkAllStreams, 120000);
});

// ==========================================
// АДМИН-ПАНЕЛЬ
// ==========================================
const ADMIN_ID = 6507474079;

function checkAdmin() {
    const tgId = parseInt(siteAuth.getTelegramId());
    let isAdmin = tgId === ADMIN_ID;
    if (!isAdmin && localStorage.getItem('admin_mode') === 'true') isAdmin = true;
    if (!isAdmin) return;

    // Show admin quick link on main page
    const adminLink = document.getElementById('adminQuickLink');
    if (adminLink) adminLink.style.display = '';

    const container = document.getElementById('adminPanelContainer');
    if (!container) return;
    container.innerHTML = `
        <section class="section-header" style="margin-top:24px">
            <h2>👑 Админ-панель</h2>
            <p>Управление промокодами</p>
        </section>
        <div style="background:linear-gradient(145deg,#1a2332,#161d28);border:1px solid rgba(200,170,110,0.2);border-radius:16px;padding:20px;margin-bottom:16px">
            <div style="text-align:center;margin-bottom:16px">
                <span style="font-size:2rem">🎟️</span>
                <h3 style="font-family:'Russo One',sans-serif;color:#C8AA6E;margin:8px 0 4px">Генератор промокодов</h3>
            </div>
            <button onclick="generatePromo()" style="width:100%;padding:14px;border:none;border-radius:12px;font-family:'Russo One',sans-serif;font-size:0.85rem;cursor:pointer;background:linear-gradient(135deg,#C8AA6E,#E8D5A3);color:#0a0e14">🎟️ Сгенерировать промокод</button>
        </div>
    `;
}

function toggleAdmin() {
    const isAdmin = localStorage.getItem('admin_mode') === 'true';
    if (isAdmin) {
        localStorage.removeItem('admin_mode');
        const c = document.getElementById('adminPanelContainer');
        if (c) c.innerHTML = '';
        showToast('🔒', 'Админ-режим отключён');
        return;
    }
    const pass = prompt('Пароль администратора:');
    if (pass === 'admin2026') {
        localStorage.setItem('admin_mode', 'true');
        checkAdmin();
        showToast('👑', 'Админ-режим активирован!');
    } else if (pass !== null) {
        showToast('❌', 'Неверный пароль');
    }
}

function generatePromo() {
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    let code = 'MT-';
    for (let i = 0; i < 6; i++) code += chars.charAt(Math.floor(Math.random() * chars.length));
    showToast('🎟️', 'Промокод создан: ' + code);
    navigator.clipboard?.writeText(code);
}

setTimeout(checkAdmin, 1000);

// Expose to global scope
window.userData = userData;
window.siteAuth = siteAuth;
window.showToast = showToast;
window.openGame = openGame;
window.claimDailyBonus = claimDailyBonus;
window.doLogin = doLogin;
window.showLoginScreen = showLoginScreen;
window.toggleAdmin = toggleAdmin;
window.generatePromo = generatePromo;
window.API_BASE = API_BASE;
