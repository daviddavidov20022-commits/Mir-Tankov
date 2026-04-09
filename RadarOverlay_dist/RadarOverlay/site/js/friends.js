/**
 * Friends JS — Друзья, чат, аватарки
 * Работает через серверный API (bot.py → aiohttp)
 * 
 * Telegram ID определяется автоматически:
 * 1. Telegram WebApp (initDataUnsafe.user.id) — основной способ
 * 2. URL параметр ?telegram_id=xxx — для тестирования
 * 3. localStorage — сохранённый ранее ID
 * 
 * Поиск: Lesta API (все игроки) + наша БД (кто зарегистрирован)
 * Добавить в друзья можно ТОЛЬКО зарегистрированных в боте.
 * Незарегистрированным — ссылка-приглашение на бот.
 */

// ============================================================
// STATE  
// ============================================================
let myTelegramId = 0;
let myDisplayName = '';
let currentChatFriend = null;
const AVATAR_KEY = 'wot_user_avatar';
const LESTA_API = 'https://api.tanki.su/wot';
const LESTA_APP = 'c984faa7dc529f4cb0139505d5e8043c';
const BOT_USERNAME = 'Mir_tankov_privat_bot'; // username бота для приглашений

// URL API бота — должен быть запущен bot.py
const BOT_API_URL = localStorage.getItem('bot_api_url') || 'https://mir-tankov-production.up.railway.app';

// Данные с сервера
let friends = [];
let friendRequests = [];

// Эмодзи для выбора аватарки
const AVATAR_EMOJIS = [
    '🪖', '🎖️', '⭐', '🔥', '💀', '🐉',
    '🦅', '🐺', '🦁', '🐻', '🦊', '🐯',
    '👑', '💎', '🎯', '🛡️', '⚔️', '🏆',
    '🚀', '💣', '🔫', '🪓', '⚡', '🌟',
    '😎', '🤖', '👾', '🎃', '💜', '❤️',
];

// ============================================================
// INIT
// ============================================================
document.addEventListener('DOMContentLoaded', async () => {
    loadAvatar();
    createParticles();

    // Определяем текущего пользователя
    identifyMe();

    if (myTelegramId) {
        loadFriendsFromServer();
    } else {
        showConnectionHint();
    }

    // Enter в поле поиска
    const searchInput = document.getElementById('friendSearchInput');
    if (searchInput) {
        searchInput.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') searchForFriend();
        });
    }

    // Автообновление каждые 30 сек
    setInterval(() => {
        if (myTelegramId) loadFriendsFromServer();
    }, 30000);
});

// ============================================================
// ОПРЕДЕЛЕНИЕ ТЕКУЩЕГО ПОЛЬЗОВАТЕЛЯ
// ============================================================
function identifyMe() {
    // Способ 1: из Telegram WebApp (основной — при открытии из бота)
    const tg = window.Telegram?.WebApp;
    if (tg?.initDataUnsafe?.user) {
        myTelegramId = tg.initDataUnsafe.user.id;
        myDisplayName = tg.initDataUnsafe.user.first_name || 'Танкист';
        localStorage.setItem('my_telegram_id', String(myTelegramId));
    }

    // Способ 2: из URL (?telegram_id=xxx)
    if (!myTelegramId) {
        const urlParams = new URLSearchParams(window.location.search);
        const idFromUrl = urlParams.get('telegram_id');
        if (idFromUrl) {
            myTelegramId = parseInt(idFromUrl);
            localStorage.setItem('my_telegram_id', String(myTelegramId));
        }
    }

    // Способ 3: из localStorage
    if (!myTelegramId) {
        const saved = localStorage.getItem('my_telegram_id');
        if (saved) myTelegramId = parseInt(saved);
    }

    // Имя
    if (!myDisplayName) {
        myDisplayName = localStorage.getItem('wot_nickname') || 'Танкист';
    }
    const nameEl = document.getElementById('myName');
    if (nameEl) nameEl.textContent = myDisplayName;

    console.log('[Friends] My Telegram ID:', myTelegramId);
}

function showConnectionHint() {
    const list = document.getElementById('friendsList');
    if (list) {
        list.innerHTML = `<div class="empty-state">
            <div class="empty-state__icon">🔑</div>
            <div class="empty-state__text">
                Откройте приложение через<br>Telegram-бот, чтобы<br>система вас узнала.
            </div>
        </div>`;
    }
}

// ============================================================
// API HELPERS
// ============================================================
async function apiGet(path) {
    try {
        const resp = await fetch(`${BOT_API_URL}${path}`);
        if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
        return await resp.json();
    } catch (e) {
        console.warn('API GET error:', path, e);
        return null;
    }
}

async function apiPost(path, body) {
    try {
        const resp = await fetch(`${BOT_API_URL}${path}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body),
        });
        if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
        return await resp.json();
    } catch (e) {
        console.warn('API POST error:', path, e);
        return null;
    }
}

// ============================================================
// ЗАГРУЗКА ДРУЗЕЙ С СЕРВЕРА
// ============================================================
async function loadFriendsFromServer() {
    if (!myTelegramId) return;

    const data = await apiGet(`/api/friends?telegram_id=${myTelegramId}`);
    if (!data) {
        showServerError();
        return;
    }
    if (data.error) return;

    friends = data.friends || [];
    friendRequests = data.requests || [];

    renderFriends();
    renderRequests();
}

function showServerError() {
    const list = document.getElementById('friendsList');
    if (list && !list.querySelector('.friend-card')) {
        list.innerHTML = `<div class="empty-state">
            <div class="empty-state__icon">📡</div>
            <div class="empty-state__text">
                Нет подключения к серверу.<br>
                Убедитесь что бот запущен<br>
                <small style="color:#5A6577">(bot.py → порт ${BOT_API_URL.split(':').pop()})</small>
            </div>
        </div>`;
    }
}

// ============================================================
// AVATAR SYSTEM
// ============================================================
function loadAvatar() {
    const saved = localStorage.getItem(AVATAR_KEY);
    const avatarEl = document.getElementById('myAvatar');
    if (!avatarEl) return;
    if (saved && saved.startsWith('data:image')) {
        avatarEl.innerHTML = `<img src="${saved}" alt="avatar">`;
    } else {
        avatarEl.textContent = saved || '🪖';
    }
}

function openAvatarPicker() {
    const grid = document.getElementById('avatarGrid');
    const current = localStorage.getItem(AVATAR_KEY) || '🪖';
    grid.innerHTML = AVATAR_EMOJIS.map(emoji => `
        <button class="avatar-emoji ${emoji === current ? 'avatar-emoji--selected' : ''}" 
                onclick="selectAvatar('${emoji}')">${emoji}</button>
    `).join('');
    document.getElementById('avatarModal').classList.add('modal-overlay--open');
}

function closeAvatarPicker() {
    document.getElementById('avatarModal').classList.remove('modal-overlay--open');
}

function selectAvatar(emoji) {
    localStorage.setItem(AVATAR_KEY, emoji);
    document.getElementById('myAvatar').innerHTML = emoji;
    document.querySelectorAll('.avatar-emoji').forEach(el => {
        el.classList.toggle('avatar-emoji--selected', el.textContent === emoji);
    });
    showToast('✅ Аватарка сохранена!');
    setTimeout(closeAvatarPicker, 500);
}

function handleAvatarUpload(event) {
    const file = event.target.files[0];
    if (!file) return;
    if (file.size > 512000) { showToast('❌ Макс. 500 КБ'); return; }
    const reader = new FileReader();
    reader.onload = function (e) {
        const img = new Image();
        img.onload = function () {
            const canvas = document.createElement('canvas');
            canvas.width = 128; canvas.height = 128;
            const ctx = canvas.getContext('2d');
            const size = Math.min(img.width, img.height);
            ctx.drawImage(img, (img.width - size) / 2, (img.height - size) / 2, size, size, 0, 0, 128, 128);
            const dataUrl = canvas.toDataURL('image/jpeg', 0.8);
            localStorage.setItem(AVATAR_KEY, dataUrl);
            document.getElementById('myAvatar').innerHTML = `<img src="${dataUrl}" alt="avatar">`;
            showToast('✅ Фото загружено!');
            setTimeout(closeAvatarPicker, 500);
        };
        img.src = e.target.result;
    };
    reader.readAsDataURL(file);
}

// ============================================================
// TAB SWITCHING
// ============================================================
function switchFriendsTab(tabId, btn) {
    document.querySelectorAll('.ftab-content').forEach(t => t.classList.remove('ftab-content--active'));
    document.querySelectorAll('.friends-tab').forEach(t => t.classList.remove('friends-tab--active'));
    document.getElementById('ftab-' + tabId).classList.add('ftab-content--active');
    btn.classList.add('friends-tab--active');
}

// ============================================================
// RENDER FRIENDS
// ============================================================
function renderFriends() {
    const list = document.getElementById('friendsList');
    if (!friends.length) {
        list.innerHTML = `<div class="empty-state"><div class="empty-state__icon">👥</div>
            <div class="empty-state__text">У тебя пока нет друзей.<br>Найди игрока и добавь!</div></div>`;
        return;
    }

    const sorted = [...friends].sort((a, b) => {
        if (a.status === 'accepted' && b.status !== 'accepted') return -1;
        if (a.status !== 'accepted' && b.status === 'accepted') return 1;
        return 0;
    });

    list.innerHTML = sorted.map((f, i) => {
        const avatar = f.avatar || '🪖';
        const avatarContent = avatar.startsWith('data:') ? `<img src="${avatar}" alt="">` : avatar;
        const isPending = f.status === 'pending';
        const statusClass = isPending ? 'friend-card--pending' : 'friend-card--accepted';
        const name = f.wot_nickname || f.first_name || f.username || 'Игрок';
        const statusLabel = isPending ? '⏳ Ожидает подтверждения' : '✅ Друг';

        return `
        <div class="friend-card ${statusClass}" style="animation-delay: ${i * 0.05}s">
            <div class="friend-card__avatar">${avatarContent}</div>
            <div class="friend-card__info" onclick="${isPending ? '' : `openChat(${f.telegram_id})`}">
                <div class="friend-card__name">${name}</div>
                <div class="friend-card__wot">${f.wot_nickname || 'Ник не привязан'}</div>
                <div style="font-size:0.6rem;color:${isPending ? '#5A6577' : '#4ade80'};margin-top:2px;">${statusLabel}</div>
            </div>
            <div class="friend-card__actions">
                ${isPending ? `
                    <button class="friend-card__action" style="opacity:0.4;cursor:default">⏳</button>
                ` : `
                    <button class="friend-card__action friend-card__action--chat" onclick="openChat(${f.telegram_id})">💬</button>
                    <button class="friend-card__action friend-card__action--duel" onclick="challengeFriendById(${f.telegram_id})">⚔️</button>
                `}
                <button class="friend-card__action friend-card__action--remove" onclick="removeFriend(${f.telegram_id})">✕</button>
            </div>
        </div>`;
    }).join('');
}

// ============================================================
// FRIEND REQUESTS
// ============================================================
function renderRequests() {
    const list = document.getElementById('requestsList');
    const badge = document.getElementById('requestsBadge');

    badge.style.display = friendRequests.length > 0 ? 'inline' : 'none';
    badge.textContent = friendRequests.length;

    if (!friendRequests.length) {
        list.innerHTML = `<div class="empty-state"><div class="empty-state__icon">📩</div>
            <div class="empty-state__text">Нет входящих запросов</div></div>`;
        return;
    }

    list.innerHTML = friendRequests.map(r => {
        const name = r.wot_nickname || r.first_name || r.username || 'Игрок';
        return `
        <div class="request-card">
            <div class="request-card__avatar">${r.avatar || '🪖'}</div>
            <div class="request-card__info">
                <div class="request-card__name">${name}</div>
                <div class="request-card__sub">${r.wot_nickname || ''}</div>
            </div>
            <div class="request-btns">
                <button class="request-btn-accept" onclick="acceptRequest(${r.telegram_id})">✅ Принять</button>
                <button class="request-btn-decline" onclick="declineRequest(${r.telegram_id})">✕</button>
            </div>
        </div>`;
    }).join('');
}

async function acceptRequest(fromTelegramId) {
    const result = await apiPost('/api/friends/accept', {
        my_telegram_id: myTelegramId,
        from_telegram_id: fromTelegramId,
    });
    if (result?.success) {
        showToast('✅ Запрос принят!');
        loadFriendsFromServer();
    } else {
        showToast(`❌ ${result?.error || 'Ошибка'}`);
    }
}

async function declineRequest(fromTelegramId) {
    await apiPost('/api/friends/decline', {
        my_telegram_id: myTelegramId,
        from_telegram_id: fromTelegramId,
    });
    showToast('Запрос отклонён');
    loadFriendsFromServer();
}

async function removeFriend(friendTelegramId) {
    if (!confirm('Удалить из друзей?')) return;
    await apiPost('/api/friends/remove', {
        my_telegram_id: myTelegramId,
        friend_telegram_id: friendTelegramId,
    });
    showToast('Друг удалён');
    loadFriendsFromServer();
}

// ============================================================
// SEARCH — LESTA API + ПРОВЕРКА В НАШЕЙ СИСТЕМЕ
// Найти игрока можно через Lesta, но добавить в друзья
// только если он зарегистрирован в боте.
// Если не зарегистрирован — кнопка "Пригласить"
// ============================================================
async function searchForFriend() {
    const query = document.getElementById('friendSearchInput').value.trim();
    if (query.length < 2) { showToast('Введите минимум 2 символа'); return; }

    const results = document.getElementById('friendSearchResults');
    results.innerHTML = `<div style="text-align:center;padding:20px;color:#5A6577">
        <div style="font-size:1.5rem;margin-bottom:8px">🔍</div>Ищем «${query}»...</div>`;

    try {
        // Шаг 1: Ищем через Lesta API (все игроки Мир Танков)
        const url = `${LESTA_API}/account/list/?application_id=${LESTA_APP}&search=${encodeURIComponent(query)}&type=startswith&limit=10`;
        const resp = await fetch(url);
        const data = await resp.json();

        if (data.status !== 'ok' || !data.data || data.data.length === 0) {
            results.innerHTML = `<div class="empty-state" style="padding:30px">
                <div class="empty-state__icon">😕</div>
                <div class="empty-state__text">Игрок «${query}» не найден в Мир Танков</div></div>`;
            return;
        }

        // Шаг 2: Проверяем кто из них зарегистрирован у нас в боте
        const accountIds = data.data.map(p => p.account_id);
        const nicknames = data.data.map(p => p.nickname);
        let registered = {};
        const checkResult = await apiPost('/api/users/check', { account_ids: accountIds, nicknames: nicknames });
        if (checkResult?.registered) {
            registered = checkResult.registered;
        }

        // Шаг 3: Отображаем результаты
        const myAccountId = localStorage.getItem('wot_account_id');

        results.innerHTML = data.data.map(player => {
            const isMe = String(player.account_id) === String(myAccountId);
            const regInfo = registered[String(player.account_id)];
            const alreadyFriend = friends.some(f =>
                f.wot_account_id && String(f.wot_account_id) === String(player.account_id)
            );

            let badge, actionBtn;

            if (isMe) {
                // Это я
                badge = `<span style="font-size:0.6rem;color:#C8AA6E;font-weight:700;">👤 Это вы</span>`;
                actionBtn = '';
            } else if (alreadyFriend) {
                // Уже друзья
                badge = `<span style="font-size:0.6rem;color:#4ade80">✅ В друзьях</span>`;
                actionBtn = '';
            } else if (regInfo) {
                // Зарегистрирован в боте → можно добавить
                badge = `<span style="font-size:0.6rem;color:#4ade80">● Участник бота</span>`;
                actionBtn = `<button class="request-btn-accept" onclick="addFriend('${player.nickname.replace(/'/g, "\\'")}', ${regInfo.telegram_id})">➕ Добавить</button>`;
            } else {
                // НЕ зарегистрирован — кнопка "Пригласить"
                const inviteUrl = `https://t.me/${BOT_USERNAME}?start=invite`;
                badge = `<span style="font-size:0.6rem;color:#5A6577">⚫ Не в приложении</span>`;
                actionBtn = `<button class="invite-btn" onclick="invitePlayer('${player.nickname}', '${inviteUrl}')">📨 Пригласить</button>`;
            }

            return `
            <div class="friend-card" style="margin-bottom:6px;${regInfo ? '' : 'opacity:0.65;'}">
                <div class="friend-card__avatar">🪖</div>
                <div class="friend-card__info">
                    <div class="friend-card__name">${player.nickname}</div>
                    <div class="friend-card__wot">${badge}</div>
                    <div style="font-size:0.55rem;color:#3A4555">ID: ${player.account_id}</div>
                </div>
                ${actionBtn}
            </div>`;
        }).join('');

    } catch (err) {
        console.error('Search error:', err);
        results.innerHTML = `<div class="empty-state" style="padding:30px">
            <div class="empty-state__icon">⚠️</div>
            <div class="empty-state__text">Ошибка поиска. Проверьте подключение.</div></div>`;
    }
}

// Пригласить игрока — копирует ссылку на бот
function invitePlayer(nickname, url) {
    const text = `Привет! Присоединяйся к "Мир Танков Клуб" — ${url}`;

    // Попытка поделиться через Telegram
    const tg = window.Telegram?.WebApp;
    if (tg?.openTelegramLink) {
        // Формируем ссылку для шаринга через Telegram
        const shareUrl = `https://t.me/share/url?url=${encodeURIComponent(url)}&text=${encodeURIComponent(`Привет! Присоединяйся к «Мир Танков Клуб»! 🎮🪖`)}`;
        tg.openTelegramLink(shareUrl);
        showToast(`📨 Отправь ссылку ${nickname}!`);
        return;
    }

    // Фолбэк — копируем в буфер
    navigator.clipboard.writeText(text).then(() => {
        showToast(`📋 Ссылка скопирована! Отправьте ${nickname}`);
    }).catch(() => {
        showToast(`📨 Ссылка: ${url}`);
    });
}

// ============================================================
// ADD FRIEND (по telegram_id зарегистрированного пользователя)
// ============================================================
async function addFriend(name, toTelegramId) {
    if (!myTelegramId) {
        showToast('⚠️ Откройте приложение через Telegram-бот');
        return;
    }

    showToast('📩 Отправляю запрос...');

    const result = await apiPost('/api/friends/add', {
        from_telegram_id: myTelegramId,
        to_telegram_id: toTelegramId,
    });

    if (!result) {
        showToast('❌ Нет подключения к серверу');
        return;
    }

    if (result.success) {
        if (result.auto_accepted) {
            showToast(`🤝 ${name} — теперь друзья!`);
        } else {
            showToast(`📩 Запрос отправлен ${name}!`);
        }
        loadFriendsFromServer();
        searchForFriend(); // обновить кнопки
    } else {
        showToast(`ℹ️ ${result.error || 'Ошибка'}`);
    }
}

// ============================================================
// CHAT
// ============================================================
async function openChat(telegramId) {
    currentChatFriend = friends.find(f => f.telegram_id == telegramId);
    if (!currentChatFriend || currentChatFriend.status === 'pending') {
        showToast('⏳ Дождитесь подтверждения дружбы');
        return;
    }

    const name = currentChatFriend.wot_nickname || currentChatFriend.first_name || 'Друг';
    const avatar = currentChatFriend.avatar || '🪖';
    document.getElementById('chatAvatar').innerHTML = avatar.startsWith('data:') ? `<img src="${avatar}" alt="">` : avatar;
    document.getElementById('chatName').textContent = name;
    document.getElementById('chatStatus').textContent = '💬 Чат';

    await loadChatMessages(telegramId);
    document.getElementById('chatOverlay').classList.add('chat-overlay--open');
    document.getElementById('chatInput').focus();

    if (window._chatInterval) clearInterval(window._chatInterval);
    window._chatInterval = setInterval(() => {
        if (currentChatFriend) loadChatMessages(currentChatFriend.telegram_id);
    }, 5000);
}

async function loadChatMessages(friendTelegramId) {
    const data = await apiGet(`/api/messages?my_id=${myTelegramId}&friend_id=${friendTelegramId}`);
    if (!data || !data.messages) return;

    const container = document.getElementById('chatMessages');
    if (!data.messages.length) {
        container.innerHTML = `<div class="empty-state" style="padding:60px 20px">
            <div class="empty-state__icon">💬</div>
            <div class="empty-state__text">Напиши первое сообщение!</div></div>`;
        return;
    }

    container.innerHTML = data.messages.map(m => {
        const mine = m.sender_telegram_id == myTelegramId;
        const time = new Date(m.created_at).toLocaleTimeString('ru', { hour: '2-digit', minute: '2-digit' });
        return `<div class="msg ${mine ? 'msg--mine' : 'msg--theirs'}">
            ${m.text}
            <div class="msg__time">${time}</div>
        </div>`;
    }).join('');
    container.scrollTop = container.scrollHeight;
}

function closeChat() {
    document.getElementById('chatOverlay').classList.remove('chat-overlay--open');
    currentChatFriend = null;
    if (window._chatInterval) { clearInterval(window._chatInterval); window._chatInterval = null; }
}

async function sendMsg() {
    const input = document.getElementById('chatInput');
    const text = input.value.trim();
    if (!text || !currentChatFriend) return;
    input.value = '';

    const result = await apiPost('/api/messages/send', {
        from_telegram_id: myTelegramId,
        to_telegram_id: currentChatFriend.telegram_id,
        text: text,
    });

    if (result?.success) {
        await loadChatMessages(currentChatFriend.telegram_id);
    } else {
        showToast('❌ Ошибка отправки');
    }
}

// ============================================================
// CHALLENGE
// ============================================================
function challengeFriend() {
    if (!currentChatFriend) return;
    challengeFriendById(currentChatFriend.telegram_id);
}

function challengeFriendById(telegramId) {
    const friend = friends.find(f => f.telegram_id == telegramId);
    if (!friend) return;
    window.location.href = `challenges.html?opponent=${encodeURIComponent(friend.wot_nickname || 'Соперник')}&opponent_id=${telegramId}`;
}

// ============================================================
// TOAST & PARTICLES
// ============================================================
function showToast(message) {
    const existing = document.querySelector('.friends-toast');
    if (existing) existing.remove();
    const toast = document.createElement('div');
    toast.className = 'friends-toast';
    toast.textContent = message;
    toast.style.cssText = `
        position: fixed; top: 20px; left: 50%; transform: translateX(-50%);
        padding: 14px 24px; border-radius: 14px; font-size: 0.8rem;
        font-weight: 600; color: white; z-index: 999;
        animation: fadeInUp 0.3s ease; max-width: 90%; text-align: center;
        backdrop-filter: blur(10px); box-shadow: 0 8px 32px rgba(0,0,0,0.4);
        background: rgba(200,170,110,0.9);
    `;
    document.body.appendChild(toast);
    setTimeout(() => toast.remove(), 3000);
}

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

// Close modals — запускаем ПОСЛЕ загрузки DOM
document.addEventListener('DOMContentLoaded', function() {
    const avatarModal = document.getElementById('avatarModal');
    if (avatarModal) {
        avatarModal.addEventListener('click', function(e) {
            if (e.target === this) closeAvatarPicker();
        });
    }
});

// Expose
window.switchFriendsTab = switchFriendsTab;
window.openAvatarPicker = openAvatarPicker;
window.closeAvatarPicker = closeAvatarPicker;
window.selectAvatar = selectAvatar;
window.handleAvatarUpload = handleAvatarUpload;
window.searchForFriend = searchForFriend;
window.addFriend = addFriend;
window.invitePlayer = invitePlayer;
window.acceptRequest = acceptRequest;
window.declineRequest = declineRequest;
window.removeFriend = removeFriend;
window.openChat = openChat;
window.closeChat = closeChat;
window.sendMsg = sendMsg;
window.challengeFriend = challengeFriend;
window.challengeFriendById = challengeFriendById;
