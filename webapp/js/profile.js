/**
 * Профиль — JS логика
 * Управление никнеймом, аватаркой, реальная статистика через API Lesta Games
 * Данные сохраняются на сервер через POST /api/profile/save
 */

// ============================================================
// КОНФИГ API
// ============================================================
const LESTA_API_URL = 'https://api.tanki.su/wot';
const LESTA_APP_ID = 'c984faa7dc529f4cb0139505d5e8043c';

// API сервера бота (единый источник — Railway, как и во всех остальных JS)
const PROFILE_API_BASE = (() => {
    const params = new URLSearchParams(window.location.search);
    const host = params.get('api') || localStorage.getItem('api_host') || localStorage.getItem('bot_api_url');
    if (host) return host;
    if (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1') {
        return `http://${window.location.hostname}:8081`;
    }
    return 'https://mir-tankov-production.up.railway.app';
})();

// ============================================================
// ИНИЦИАЛИЗАЦИЯ
// ============================================================
document.addEventListener('DOMContentLoaded', () => {
    checkVerifyParams();
    loadProfile();
    loadProgress();
    checkAchievements();
    setupAvatarPicker();
    loadProfileFromServer();
});

// ============================================================
// ПРОФИЛЬ
// ============================================================
function loadProfile() {
    // Telegram данные
    const tg = window.Telegram?.WebApp;
    if (tg?.initDataUnsafe?.user) {
        const user = tg.initDataUnsafe.user;
        const nameEl = document.getElementById('profileName');
        if (nameEl) nameEl.textContent = user.first_name || 'Танкист';
    }

    // Загрузить сохранённый ник (только верифицированный!)
    const savedNick = localStorage.getItem('wot_nickname');
    const isVerified = localStorage.getItem('wot_verified') === 'true';

    if (savedNick && isVerified) {
        // Есть в localStorage — показываем сразу
        showSavedNickname(savedNick);
        loadQuickStats(savedNick);
        // Но всё равно пытаемся синхронизировать с CloudStorage
        syncToCloud(savedNick, localStorage.getItem('wot_account_id'));
    } else if (savedNick && !isVerified) {
        // Старый ник без верификации — сбрасываем
        localStorage.removeItem('wot_nickname');
        localStorage.removeItem('wot_cached_stats');
        // Пробуем восстановить из облака
        restoreFromCloud();
    } else {
        // Нет данных — ВСЕГДА пробуем восстановить из Telegram CloudStorage
        restoreFromCloud();
    }

    // Уровень
    updateLevel();
}

// Синхронизация в CloudStorage (если ещё не там)
function syncToCloud(nickname, accountId) {
    const tg = window.Telegram?.WebApp;
    if (!tg?.CloudStorage) return;
    tg.CloudStorage.setItem('wot_nickname', nickname);
    if (accountId) tg.CloudStorage.setItem('wot_account_id', String(accountId));
    tg.CloudStorage.setItem('wot_verified', 'true');
}

// Сохраняем верифицированный аккаунт в Telegram CloudStorage (не сбрасывается!)
function saveToCloud(nickname, accountId) {
    const tg = window.Telegram?.WebApp;
    if (tg?.CloudStorage) {
        tg.CloudStorage.setItem('wot_nickname', nickname);
        tg.CloudStorage.setItem('wot_account_id', String(accountId));
        tg.CloudStorage.setItem('wot_verified', 'true');
    }
}

// ============================================================
// СОХРАНЕНИЕ НА СЕРВЕР (критично для Топ Игроков!)
// ============================================================
function getTelegramId() {
    const tg = window.Telegram?.WebApp;
    if (tg?.initDataUnsafe?.user?.id) return tg.initDataUnsafe.user.id;
    // Из URL
    const params = new URLSearchParams(window.location.search);
    const urlId = params.get('telegram_id');
    if (urlId) return parseInt(urlId);
    // Из localStorage
    return localStorage.getItem('my_telegram_id');
}

function getFirstName() {
    const tg = window.Telegram?.WebApp;
    return tg?.initDataUnsafe?.user?.first_name || '';
}

async function saveToServer(data) {
    const telegramId = getTelegramId();
    if (!telegramId) {
        console.warn('No telegram_id, cannot save to server');
        return;
    }

    try {
        const payload = {
            telegram_id: telegramId,
            first_name: getFirstName(),
            ...data,
        };
        console.log('Saving to server:', payload);

        const resp = await fetch(`${PROFILE_API_BASE}/api/profile/save`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload),
        });
        const result = await resp.json();
        if (result.ok) {
            console.log('Profile saved to server!');
        } else {
            console.warn('Server save failed:', result.error);
        }
    } catch (e) {
        console.warn('Cannot reach API server:', e.message);
    }
}

async function loadProfileFromServer() {
    const telegramId = getTelegramId();
    if (!telegramId) return;

    try {
        const resp = await fetch(`${PROFILE_API_BASE}/api/profile?telegram_id=${telegramId}`);
        const data = await resp.json();

        if (data.wot_nickname && data.wot_account_id) {
            // Восстанавливаем из сервера если в localStorage нет
            if (!localStorage.getItem('wot_nickname')) {
                localStorage.setItem('wot_nickname', data.wot_nickname);
                localStorage.setItem('wot_account_id', String(data.wot_account_id));
                localStorage.setItem('wot_verified', 'true');
                showSavedNickname(data.wot_nickname);
                loadQuickStats(data.wot_nickname);
                showToast('✅', 'Аккаунт восстановлен с сервера');
            }
        }

        // Восстанавливаем аватарку с сервера
        if (data.avatar) {
            localStorage.setItem('user_avatar', data.avatar);
            updateAvatarDisplay(data.avatar);
        }
    } catch (e) {
        console.warn('Cannot load profile from server:', e.message);
    }
}

// ============================================================
// АВАТАРКА — выбор и сохранение
// ============================================================
const AVATAR_EMOJIS = ['🪖', '🎖', '⭐', '🏆', '🔥', '💎', '🐱', '🐶', '🦊', '🐻', '🦁', '🐺', '🎯', '🚀', '💀', '👑', '🛡️', '⚔️'];

function setupAvatarPicker() {
    const avatarImage = document.getElementById('avatarImage');
    if (!avatarImage) return;

    // Загружаем сохранённую аватарку
    const saved = localStorage.getItem('user_avatar');
    if (saved) updateAvatarDisplay(saved);

    // Клик по аватарке — открывает выбор
    avatarImage.style.cursor = 'pointer';
    avatarImage.addEventListener('click', showAvatarPicker);
}

function showAvatarPicker() {
    // Удаляем старый пикер если есть
    const old = document.getElementById('avatarPickerOverlay');
    if (old) old.remove();

    const overlay = document.createElement('div');
    overlay.id = 'avatarPickerOverlay';
    overlay.style.cssText = `
        position: fixed; top: 0; left: 0; width: 100%; height: 100%;
        background: rgba(0,0,0,0.7); z-index: 5000;
        display: flex; align-items: center; justify-content: center;
        padding: 20px; backdrop-filter: blur(8px);
    `;
    overlay.onclick = (e) => { if (e.target === overlay) overlay.remove(); };

    const modal = document.createElement('div');
    modal.style.cssText = `
        background: #151b24; border: 1px solid rgba(200,170,110,0.3);
        border-radius: 18px; padding: 20px; width: 100%; max-width: 340px;
        animation: fadeInUp 0.3s ease;
    `;

    let emojisHtml = '<div style="display:grid;grid-template-columns:repeat(6,1fr);gap:8px;margin-bottom:16px;">';
    AVATAR_EMOJIS.forEach(emoji => {
        emojisHtml += `<button onclick="selectAvatarEmoji('${emoji}')" style="
            font-size:1.6rem;padding:10px;background:rgba(255,255,255,0.04);
            border:1px solid rgba(255,255,255,0.08);border-radius:12px;cursor:pointer;
            transition:all 0.2s;" onmouseover="this.style.background='rgba(200,170,110,0.15)'" 
            onmouseout="this.style.background='rgba(255,255,255,0.04)'">${emoji}</button>`;
    });
    emojisHtml += '</div>';

    modal.innerHTML = `
        <h3 style="font-family:'Russo One',sans-serif;color:#C8AA6E;margin-bottom:14px;font-size:0.95rem;">📸 Выберите аватарку</h3>
        <p style="font-size:0.75rem;color:#8b9bb4;margin-bottom:12px;">Нажмите на эмодзи или загрузите фото:</p>
        ${emojisHtml}
        <div style="display:flex;gap:8px;">
            <label style="flex:1;padding:11px;border-radius:10px;background:linear-gradient(135deg,#C8AA6E,#E8D5A3);
                color:#0a0e14;text-align:center;cursor:pointer;font-size:0.8rem;font-weight:600;">
                📷 Загрузить фото
                <input type="file" accept="image/*" onchange="uploadAvatarPhoto(event)" style="display:none;">
            </label>
            <button onclick="document.getElementById('avatarPickerOverlay').remove()" style="
                flex:1;padding:11px;border-radius:10px;background:transparent;
                border:1px solid rgba(255,255,255,0.1);color:#8b9bb4;cursor:pointer;font-size:0.8rem;">Закрыть</button>
        </div>
    `;

    overlay.appendChild(modal);
    document.body.appendChild(overlay);

    if (window.Telegram?.WebApp?.HapticFeedback) {
        window.Telegram.WebApp.HapticFeedback.impactOccurred('light');
    }
}

function selectAvatarEmoji(emoji) {
    localStorage.setItem('user_avatar', emoji);
    updateAvatarDisplay(emoji);
    saveToServer({ avatar: emoji });
    const overlay = document.getElementById('avatarPickerOverlay');
    if (overlay) overlay.remove();
    showToast('✅', 'Аватарка сохранена!');
}

function uploadAvatarPhoto(event) {
    const file = event.target.files[0];
    if (!file) return;

    // Ограничение размера (500KB макс для base64)
    if (file.size > 500000) {
        showToast('❌', 'Фото слишком большое (макс 500KB)');
        return;
    }

    const reader = new FileReader();
    reader.onload = (e) => {
        // Создаём миниатюру 64x64
        const img = new Image();
        img.onload = () => {
            const canvas = document.createElement('canvas');
            canvas.width = 64;
            canvas.height = 64;
            const ctx = canvas.getContext('2d');
            // Круг
            ctx.beginPath();
            ctx.arc(32, 32, 32, 0, Math.PI * 2);
            ctx.closePath();
            ctx.clip();
            // Масштаб и центрирование
            const scale = Math.max(64 / img.width, 64 / img.height);
            const w = img.width * scale, h = img.height * scale;
            ctx.drawImage(img, (64 - w) / 2, (64 - h) / 2, w, h);

            const base64 = canvas.toDataURL('image/webp', 0.7);
            localStorage.setItem('user_avatar', base64);
            updateAvatarDisplay(base64);
            saveToServer({ avatar: base64 });

            const overlay = document.getElementById('avatarPickerOverlay');
            if (overlay) overlay.remove();
            showToast('✅', 'Фото сохранено!');
        };
        img.src = e.target.result;
    };
    reader.readAsDataURL(file);
}

function updateAvatarDisplay(avatar) {
    const el = document.getElementById('avatarImage');
    if (!el) return;

    if (avatar.startsWith('data:')) {
        // Фото
        el.innerHTML = '';
        el.style.backgroundImage = `url(${avatar})`;
        el.style.backgroundSize = 'cover';
        el.style.backgroundPosition = 'center';
        el.style.fontSize = '0';
    } else {
        // Эмодзи
        el.textContent = avatar;
        el.style.backgroundImage = 'none';
        el.style.fontSize = '';
    }
}

// Восстанавливаем аккаунт из CloudStorage
function restoreFromCloud() {
    const tg = window.Telegram?.WebApp;
    if (!tg?.CloudStorage) return;

    tg.CloudStorage.getItems(['wot_nickname', 'wot_account_id', 'wot_verified'], (err, values) => {
        if (err || !values) return;
        const nick = values.wot_nickname;
        const verified = values.wot_verified;
        const accId = values.wot_account_id;

        if (nick && verified === 'true') {
            // Восстанавливаем в localStorage
            localStorage.setItem('wot_nickname', nick);
            localStorage.setItem('wot_account_id', accId);
            localStorage.setItem('wot_verified', 'true');

            showSavedNickname(nick);
            loadQuickStats(nick);
            showToast('✅', 'Аккаунт восстановлен');
        }
    });
}

// ============================================================
// НИКНЕЙМ — ПРИВЯЗКА ЧЕРЕЗ LESTA OAUTH
// ============================================================

/**
 * Привязка аккаунта через Lesta Games OAuth.
 * Нельзя просто ввести ник — нужно войти через Lesta,
 * чтобы подтвердить что это ТВОЙ аккаунт.
 */

// URL для OAuth авторизации через Lesta Games
const LESTA_AUTH_URL = 'https://api.tanki.su/wot/auth/login/';
// redirect_uri — наша страница verify.html
function getRedirectUri() {
    // Определяем базовый URL (GitHub Pages или localhost)
    const origin = window.location.origin;
    const path = window.location.pathname.replace(/\/[^\/]*$/, '/');
    return origin + path + 'verify.html';
}

function linkAccount() {
    // Открываем Lesta OAuth
    const redirectUri = getRedirectUri();
    const authUrl = `${LESTA_AUTH_URL}?application_id=${LESTA_APP_ID}&redirect_uri=${encodeURIComponent(redirectUri)}`;

    // В Telegram WebApp открываем через openLink
    if (window.Telegram?.WebApp?.openLink) {
        window.Telegram.WebApp.openLink(authUrl);
    } else {
        // Для браузера — переходим прямо по ссылке
        window.location.href = authUrl;
    }
}

function unlinkAccount() {
    if (!confirm('Отвязать аккаунт Мир Танков?')) return;

    localStorage.removeItem('wot_nickname');
    localStorage.removeItem('wot_account_id');
    localStorage.removeItem('wot_verified');
    localStorage.removeItem('wot_cached_stats');

    // Показываем кнопку привязки
    const displayEl = document.getElementById('nicknameDisplay');
    const linkEl = document.getElementById('nicknameLinkSection');
    if (displayEl) displayEl.style.display = 'none';
    if (linkEl) linkEl.style.display = 'block';

    // Скрываем статистику
    const section = document.getElementById('quickStatsSection');
    if (section) section.style.display = 'none';

    showToast('🔓', 'Аккаунт отвязан');
}

function showSavedNickname(nickname) {
    const displayEl = document.getElementById('nicknameDisplay');
    const linkEl = document.getElementById('nicknameLinkSection');
    const nameEl = document.getElementById('savedNickname');
    const verifiedBadge = document.getElementById('verifiedBadge');

    if (displayEl) displayEl.style.display = 'flex';
    if (linkEl) linkEl.style.display = 'none';
    if (nameEl) nameEl.textContent = nickname;

    // Показываем бейдж верификации
    const isVerified = localStorage.getItem('wot_verified') === 'true';
    if (verifiedBadge) {
        verifiedBadge.style.display = isVerified ? 'inline' : 'none';
    }
}

// Проверяем URL на параметры верификации (после redirect от Lesta)
function checkVerifyParams() {
    const params = new URLSearchParams(window.location.search);
    const nickname = params.get('verified_nick');
    const accountId = params.get('verified_id');

    if (nickname && accountId) {
        localStorage.setItem('wot_nickname', nickname);
        localStorage.setItem('wot_account_id', accountId);
        localStorage.setItem('wot_verified', 'true');
        saveToCloud(nickname, accountId);

        // ✅ СОХРАНЯЕМ НА СЕРВЕР!
        saveToServer({ wot_nickname: nickname, wot_account_id: parseInt(accountId) });

        showSavedNickname(nickname);
        loadQuickStats(nickname);
        showToast('✅', `Аккаунт ${nickname} привязан!`);

        // Убираем параметры из URL
        window.history.replaceState({}, '', window.location.pathname);
    }
}

// ============================================================
// ВВОД КОДА В ПРИЛОЖЕНИИ
// ============================================================
function showStep2() {
    const step1 = document.getElementById('linkStep1');
    const step2 = document.getElementById('linkStep2');
    if (step1) step1.style.display = 'none';
    if (step2) step2.style.display = 'block';

    const nickInput = document.getElementById('verifyNickInput');
    if (nickInput) setTimeout(() => nickInput.focus(), 100);
}

// Тот же алгоритм генерации кода что и в verify.html
function generateCode(accountId) {
    let hash = 0;
    const str = String(accountId) + '_MIRTANKOV_2026';
    for (let i = 0; i < str.length; i++) {
        const char = str.charCodeAt(i);
        hash = ((hash << 5) - hash) + char;
        hash = hash & hash;
    }
    return 'MT' + Math.abs(hash).toString(36).toUpperCase().slice(0, 6);
}

async function verifyCode() {
    const nickInput = document.getElementById('verifyNickInput');
    const codeInput = document.getElementById('verifyCodeInput');
    const nickname = nickInput.value.trim();
    const code = codeInput.value.trim().toUpperCase();

    if (!nickname || nickname.length < 2) {
        nickInput.style.borderColor = '#e74c3c';
        showToast('❌', 'Введите ваш ник');
        return;
    }
    if (!code || code.length < 4) {
        codeInput.style.borderColor = '#e74c3c';
        showToast('❌', 'Введите код верификации');
        return;
    }

    // Ищем игрока через Lesta API
    showToast('🔍', 'Проверяю...');

    try {
        const searchUrl = `${LESTA_API_URL}/account/list/?application_id=${LESTA_APP_ID}&search=${encodeURIComponent(nickname)}&type=exact&limit=1`;
        const resp = await fetch(searchUrl);
        const data = await resp.json();

        if (data.status !== 'ok' || !data.data || data.data.length === 0) {
            showToast('❌', 'Игрок не найден в Мир Танков');
            return;
        }

        const accountId = data.data[0].account_id;
        const realNick = data.data[0].nickname;

        // Генерируем код из account_id тем же алгоритмом
        const expectedCode = generateCode(accountId);

        if (code === expectedCode) {
            // ✅ КОД СОВПАЛ — привязываем!
            localStorage.setItem('wot_nickname', realNick);
            localStorage.setItem('wot_account_id', String(accountId));
            localStorage.setItem('wot_verified', 'true');

            // Сохраняем в облако Telegram (навсегда!)
            saveToCloud(realNick, accountId);

            // ✅ СОХРАНЯЕМ НА СЕРВЕР (для Топ Игроков!)
            saveToServer({ wot_nickname: realNick, wot_account_id: accountId });

            showSavedNickname(realNick);
            loadQuickStats(realNick);
            showToast('✅', `Аккаунт ${realNick} привязан навсегда!`);

            if (window.Telegram?.WebApp?.HapticFeedback) {
                window.Telegram.WebApp.HapticFeedback.notificationOccurred('success');
            }
        } else {
            // ❌ Код не совпадает
            codeInput.style.borderColor = '#e74c3c';
            showToast('❌', 'Неверный код! Получите новый через Lesta');

            if (window.Telegram?.WebApp?.HapticFeedback) {
                window.Telegram.WebApp.HapticFeedback.notificationOccurred('error');
            }
        }
    } catch (err) {
        console.error('Ошибка верификации:', err);
        showToast('❌', 'Ошибка сети. Попробуйте позже');
    }
}

// Enter key
document.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && document.activeElement?.id === 'verifyCodeInput') {
        verifyCode();
    }
});

// ============================================================
// БЫСТРАЯ СТАТИСТИКА — РЕАЛЬНЫЙ API
// ============================================================
async function loadQuickStats(nickname) {
    const section = document.getElementById('quickStatsSection');
    if (!section) return;

    // Показываем секцию с индикатором загрузки
    section.style.display = 'block';
    setStatLoading(true);

    try {
        // 1) Поиск игрока
        const searchUrl = `${LESTA_API_URL}/account/list/?application_id=${LESTA_APP_ID}&search=${encodeURIComponent(nickname)}&limit=1`;
        const searchResp = await fetch(searchUrl);
        const searchData = await searchResp.json();

        if (searchData.status !== 'ok' || !searchData.data || searchData.data.length === 0) {
            setStatsError('Игрок не найден');
            return;
        }

        const accountId = searchData.data[0].account_id;
        const realNick = searchData.data[0].nickname;

        // Обновляем ник если отличается
        const savedNameEl = document.getElementById('savedNickname');
        if (savedNameEl && realNick) savedNameEl.textContent = realNick;

        // 2) Получаем статистику
        const statsUrl = `${LESTA_API_URL}/account/info/?application_id=${LESTA_APP_ID}&account_id=${accountId}`;
        const statsResp = await fetch(statsUrl);
        const statsData = await statsResp.json();

        if (statsData.status !== 'ok' || !statsData.data || !statsData.data[accountId]) {
            setStatsError('Ошибка загрузки');
            return;
        }

        const player = statsData.data[accountId];
        const allStats = player.statistics?.all || {};

        // Вычисляем показатели
        const battles = allStats.battles || 0;
        const wins = allStats.wins || 0;
        const damage = allStats.damage_dealt || 0;
        const rating = player.global_rating || 0;

        const winrate = battles > 0 ? ((wins / battles) * 100).toFixed(1) : '0';
        const avgDamage = battles > 0 ? Math.round(damage / battles) : 0;

        // Отображаем реальные данные
        animateValue('qsBattles', battles > 10000 ? (battles / 1000).toFixed(1) + 'K' : battles.toLocaleString());
        animateValue('qsWinrate', winrate + '%');
        animateValue('qsDamage', avgDamage.toLocaleString());
        animateValue('qsRating', rating.toLocaleString());

        // Цвет винрейта
        const wrEl = document.getElementById('qsWinrate');
        if (wrEl) {
            const wr = parseFloat(winrate);
            if (wr >= 55) wrEl.style.color = '#bb86fc';
            else if (wr >= 52) wrEl.style.color = '#64b5f6';
            else if (wr >= 49) wrEl.style.color = '#81c784';
            else if (wr >= 46) wrEl.style.color = '#ffd54f';
            else wrEl.style.color = '#ef5350';
        }

        // Сохраняем данные для оффлайн доступа
        localStorage.setItem('wot_cached_stats', JSON.stringify({
            nickname: realNick,
            accountId,
            battles,
            winrate,
            avgDamage,
            rating,
            clanId: player.clan_id,
            cachedAt: Date.now()
        }));

        setStatLoading(false);

    } catch (err) {
        console.error('Ошибка загрузки статистики:', err);

        // Пробуем кеш
        const cached = localStorage.getItem('wot_cached_stats');
        if (cached) {
            try {
                const data = JSON.parse(cached);
                document.getElementById('qsBattles').textContent =
                    data.battles > 10000 ? (data.battles / 1000).toFixed(1) + 'K' : data.battles.toLocaleString();
                document.getElementById('qsWinrate').textContent = data.winrate + '%';
                document.getElementById('qsDamage').textContent = data.avgDamage.toLocaleString();
                document.getElementById('qsRating').textContent = data.rating.toLocaleString();
                setStatLoading(false);
            } catch (e) {
                setStatsError('Нет сети');
            }
        } else {
            setStatsError('Нет сети');
        }
    }
}

function setStatLoading(isLoading) {
    const items = document.querySelectorAll('.qs-value');
    items.forEach(el => {
        if (isLoading) {
            el.classList.add('loading');
        } else {
            el.classList.remove('loading');
        }
    });
}

function setStatsError(message) {
    setStatLoading(false);
    document.getElementById('qsBattles').textContent = '—';
    document.getElementById('qsWinrate').textContent = '—';
    document.getElementById('qsDamage').textContent = '—';
    document.getElementById('qsRating').textContent = '—';

    showToast('⚠️', message);
}

function animateValue(id, finalValue) {
    const el = document.getElementById(id);
    if (!el) return;

    el.style.opacity = '0';
    el.style.transform = 'translateY(8px)';

    setTimeout(() => {
        el.textContent = finalValue;
        el.style.transition = 'all 0.4s ease';
        el.style.opacity = '1';
        el.style.transform = 'translateY(0)';
    }, 100);
}

function viewMyStats() {
    const nickname = localStorage.getItem('wot_nickname');
    if (nickname) {
        window.location.href = 'stats.html?nick=' + encodeURIComponent(nickname);
    } else {
        window.location.href = 'stats.html';
    }
}

// ============================================================
// ПРОГРЕСС — загрузка с сервера
// ============================================================
async function loadProgress() {
    try {
        const data = JSON.parse(localStorage.getItem('wot_user_data') || '{}');
        const xp = data.xp || 0;

        // XP Level (декоративно)
        const level = Math.floor(xp / 100) + 1;
        const xpInLevel = xp % 100;
        setText('progXP', xp.toLocaleString());
        setText('xpProgress', `${xpInLevel} / 100 XP`);
        setText('xpLevel', `Уровень ${level}`);

        const avatarLevel = document.getElementById('avatarLevel');
        if (avatarLevel) avatarLevel.textContent = level;

        setTimeout(() => {
            const bar = document.getElementById('xpBar');
            if (bar) bar.style.width = xpInLevel + '%';
        }, 300);

        updateTag(level);

        // Загружаем реальную статистику с сервера
        const telegramId = getTelegramId();
        if (!telegramId) return;

        const resp = await fetch(`${PROFILE_API_BASE}/api/profile/battle-stats?telegram_id=${telegramId}`);
        if (!resp.ok) return;
        const stats = await resp.json();

        // Сыр
        setText('progCoins', (stats.cheese_balance || 0).toLocaleString());

        // Серия дней
        const daily = stats.daily || {};
        setText('progStreak', (daily.current_streak || 0) + ' дн.');

        // Сражения
        const b = stats.battles || {};
        setText('progBattles', b.total || 0);
        setText('pvpCount', b.pvp?.total || 0);
        setText('gcCount', b.global?.total || 0);
        setText('teamCount', b.team?.total || 0);

        // Активные
        if (b.active > 0) {
            const activeRow = document.getElementById('activeRow');
            if (activeRow) activeRow.style.display = 'flex';
            setText('activeCount', b.active);
        }

        // Победы / Поражения
        setText('progWinLoss', `${b.wins || 0}W / ${b.losses || 0}L`);
        setText('pvpWinLoss', `${b.pvp?.wins || 0}W / ${b.pvp?.losses || 0}L`);
        setText('gcWinLoss', `${b.global?.wins || 0}W / ${b.global?.losses || 0}L`);
        setText('teamWinLoss', `${b.team?.wins || 0}W / ${b.team?.losses || 0}L`);

        // Winrate bar
        if (b.total > 0) {
            const winrateWrap = document.getElementById('winrateBarWrap');
            const winrateLabel = document.getElementById('winrateLabel');
            if (winrateWrap) winrateWrap.style.display = 'flex';
            if (winrateLabel) {
                winrateLabel.style.display = 'flex';
                winrateLabel.innerHTML = `<span style="color:#2ecc71">Побед: ${b.winrate}%</span><span style="color:#e74c3c">Поражений: ${(100 - b.winrate).toFixed(1)}%</span>`;
            }
            setTimeout(() => {
                const winsBar = document.getElementById('winrateBarWins');
                const lossBar = document.getElementById('winrateBarLosses');
                if (winsBar) winsBar.style.width = b.winrate + '%';
                if (lossBar) lossBar.style.width = (100 - b.winrate) + '%';
            }, 400);
        }

        // Cheese P&L
        const pnl = stats.cheese_pnl || {};
        setText('cheeseWon', '+' + (pnl.won || 0).toLocaleString());
        setText('cheeseLost', '-' + (pnl.lost || 0).toLocaleString());

        const netEl = document.getElementById('cheeseNet');
        if (netEl) {
            const net = pnl.net || 0;
            netEl.textContent = (net >= 0 ? '+' : '') + net.toLocaleString();
            netEl.className = 'detail-value ' + (net >= 0 ? 'detail-value--green' : 'detail-value--red');
        }

    } catch (e) {
        console.warn('Ошибка загрузки прогресса:', e);
    }
}

// Toggle expand/collapse
function toggleBattleDetails(el) {
    el.classList.toggle('progress-item--expanded');
    if (window.Telegram?.WebApp?.HapticFeedback) {
        window.Telegram.WebApp.HapticFeedback.impactOccurred('light');
    }
}
function toggleWinDetails(el) {
    el.classList.toggle('progress-item--expanded');
    if (window.Telegram?.WebApp?.HapticFeedback) {
        window.Telegram.WebApp.HapticFeedback.impactOccurred('light');
    }
}
window.toggleBattleDetails = toggleBattleDetails;
window.toggleWinDetails = toggleWinDetails;


function updateLevel() {
    try {
        const data = JSON.parse(localStorage.getItem('wot_user_data') || '{}');
        const xp = data.xp || 0;
        const level = Math.floor(xp / 100) + 1;
        updateTag(level);
    } catch (e) { }
}

function updateTag(level) {
    const tagEl = document.getElementById('profileTag');
    if (!tagEl) return;

    if (level >= 10) { tagEl.textContent = '👑 Легенда'; tagEl.style.borderColor = 'rgba(155,89,182,0.5)'; tagEl.style.color = '#bb86fc'; }
    else if (level >= 7) { tagEl.textContent = '⭐ Ветеран'; tagEl.style.borderColor = 'rgba(52,152,219,0.5)'; tagEl.style.color = '#64b5f6'; }
    else if (level >= 4) { tagEl.textContent = '🪖 Боец'; tagEl.style.borderColor = 'rgba(46,204,113,0.5)'; tagEl.style.color = '#81c784'; }
    else { tagEl.textContent = '🔰 Новобранец'; }
}

// ============================================================
// ДОСТИЖЕНИЯ
// ============================================================
function checkAchievements() {
    try {
        const data = JSON.parse(localStorage.getItem('wot_user_data') || '{}');
        const coins = data.coins || 0;
        const games = data.games || 0;
        const streak = data.dailyStreak || 0;
        const xp = data.xp || 0;
        const level = Math.floor(xp / 100) + 1;

        if (games >= 1) unlockAchievement('achFirst');
        else lockAchievement('achFirst');

        if (games >= 50) unlockAchievement('achVeteran');
        else lockAchievement('achVeteran');

        if (coins >= 5000) unlockAchievement('achRich');
        else lockAchievement('achRich');

        if (streak >= 7) unlockAchievement('achStreak');
        else lockAchievement('achStreak');

        if (level >= 10) {
            const el = document.getElementById('achPro');
            if (el) { el.classList.remove('achievement--locked'); el.classList.add('achievement--unlocked'); }
        }
    } catch (e) { }
}

function unlockAchievement(id) {
    const el = document.getElementById(id);
    if (el) {
        el.classList.remove('achievement--locked');
        el.classList.add('achievement--unlocked');
    }
}
function lockAchievement(id) {
    const el = document.getElementById(id);
    if (el && !el.classList.contains('achievement--locked')) {
        // Не блокировать если уже разблокировано
    }
}

// ============================================================
// HELPERS
// ============================================================
function setText(id, text) {
    const el = document.getElementById(id);
    if (el) el.textContent = text;
}

function goBack() {
    if (window.Telegram?.WebApp?.BackButton) {
        window.Telegram.WebApp.BackButton.hide();
    }
    window.location.href = 'index.html';
}

// Toast (если не определена в app.js)
if (typeof showToast !== 'function') {
    window.showToast = function (icon, text) {
        const existing = document.querySelector('.toast');
        if (existing) existing.remove();

        const toast = document.createElement('div');
        toast.className = 'toast';
        toast.innerHTML = `<span>${icon}</span> ${text}`;
        toast.style.cssText = `
            position: fixed; bottom: 80px; left: 50%; transform: translateX(-50%);
            background: rgba(30,30,30,0.95); color: #fff; padding: 12px 24px;
            border-radius: 12px; font-size: 14px; z-index: 9999;
            backdrop-filter: blur(10px); border: 1px solid rgba(255,255,255,0.1);
            animation: fadeInUp 0.3s ease;
        `;
        document.body.appendChild(toast);
        setTimeout(() => toast.remove(), 3000);
    };
}

// Telegram back button
if (window.Telegram?.WebApp?.BackButton) {
    window.Telegram.WebApp.BackButton.show();
    window.Telegram.WebApp.BackButton.onClick(goBack);
}

// Expose
window.linkAccount = linkAccount;
window.unlinkAccount = unlinkAccount;
window.showStep2 = showStep2;
window.verifyCode = verifyCode;
window.viewMyStats = viewMyStats;
window.goBack = goBack;
window.selectAvatarEmoji = selectAvatarEmoji;
window.uploadAvatarPhoto = uploadAvatarPhoto;
window.showAvatarPicker = showAvatarPicker;
