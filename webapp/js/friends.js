/**
 * Friends JS — Друзья, чат, аватарки, вызов на дуэль
 */

// ============================================================
// STATE  
// ============================================================
let myTelegramId = 0;
let currentChatFriend = null;
const AVATAR_KEY = 'wot_user_avatar';
const FRIENDS_KEY = 'wot_friends';
const MESSAGES_KEY = 'wot_messages';

// Эмодзи для выбора аватарки
const AVATAR_EMOJIS = [
    '🪖', '🎖️', '⭐', '🔥', '💀', '🐉',
    '🦅', '🐺', '🦁', '🐻', '🦊', '🐯',
    '👑', '💎', '🎯', '🛡️', '⚔️', '🏆',
    '🚀', '💣', '🔫', '🪓', '⚡', '🌟',
    '😎', '🤖', '👾', '🎃', '💜', '❤️',
];

// Демо-друзья (в проде — данные из БД через бот)
let friends = JSON.parse(localStorage.getItem(FRIENDS_KEY) || 'null') || [
    { telegram_id: 111, name: 'xXx_NAGIBATOR', wot_nick: 'xXx_NAGIBATOR_xXx', avatar: '💀', online: true },
    { telegram_id: 222, name: 'TankDestroyer', wot_nick: 'Tank_Destroyer_95', avatar: '🦅', online: true },
    { telegram_id: 333, name: 'Fors777', wot_nick: 'Fors777_2016', avatar: '🐺', online: false },
];

let friendRequests = [
    { telegram_id: 444, name: 'PRO_TANKER', wot_nick: 'PRO_TANKER', avatar: '👑' },
];

let messages = JSON.parse(localStorage.getItem(MESSAGES_KEY) || '{}');

// ============================================================
// INIT
// ============================================================
document.addEventListener('DOMContentLoaded', () => {
    loadAvatar();
    renderFriends();
    renderRequests();
    createParticles();
});

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
    const avatarEl = document.getElementById('myAvatar');
    avatarEl.textContent = emoji;
    avatarEl.innerHTML = emoji; // убираем img если был

    // Подсвечиваем выбранный
    document.querySelectorAll('.avatar-emoji').forEach(el => {
        el.classList.toggle('avatar-emoji--selected', el.textContent === emoji);
    });

    showToast('✅ Аватарка сохранена!');
    setTimeout(closeAvatarPicker, 500);
}

function handleAvatarUpload(event) {
    const file = event.target.files[0];
    if (!file) return;

    // Ограничение размера (500 КБ)
    if (file.size > 512000) {
        showToast('❌ Файл слишком большой (макс. 500 КБ)');
        return;
    }

    const reader = new FileReader();
    reader.onload = function (e) {
        // Ресайз до 128x128 для хранения
        const img = new Image();
        img.onload = function () {
            const canvas = document.createElement('canvas');
            canvas.width = 128;
            canvas.height = 128;
            const ctx = canvas.getContext('2d');

            // Обрезка по центру (квадрат)
            const size = Math.min(img.width, img.height);
            const sx = (img.width - size) / 2;
            const sy = (img.height - size) / 2;
            ctx.drawImage(img, sx, sy, size, size, 0, 0, 128, 128);

            const dataUrl = canvas.toDataURL('image/jpeg', 0.8);
            localStorage.setItem(AVATAR_KEY, dataUrl);

            const avatarEl = document.getElementById('myAvatar');
            avatarEl.innerHTML = `<img src="${dataUrl}" alt="avatar">`;

            showToast('✅ Фото загружено!');
            setTimeout(closeAvatarPicker, 500);
        };
        img.src = e.target.result;
    };
    reader.readAsDataURL(file);
}

// ============================================================
// FRIENDS TAB SWITCHING
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

    list.innerHTML = friends.map((f, i) => {
        const avatarContent = f.avatar && f.avatar.startsWith('data:')
            ? `<img src="${f.avatar}" alt="">` : (f.avatar || '🪖');
        const onlineClass = f.online ? 'friend-card__avatar--online' : '';
        return `
        <div class="friend-card" style="animation-delay: ${i * 0.05}s">
            <div class="friend-card__avatar ${onlineClass}">${avatarContent}</div>
            <div class="friend-card__info" onclick="openChat(${f.telegram_id})">
                <div class="friend-card__name">${f.name}</div>
                <div class="friend-card__wot">${f.wot_nick || 'Ник не привязан'} ${f.online ? '🟢' : '⚫'}</div>
            </div>
            <div class="friend-card__actions">
                <button class="friend-card__action friend-card__action--chat" onclick="openChat(${f.telegram_id})" title="Чат">💬</button>
                <button class="friend-card__action friend-card__action--duel" onclick="challengeFriendById(${f.telegram_id})" title="Дуэль">⚔️</button>
                <button class="friend-card__action friend-card__action--remove" onclick="removeFriend(${f.telegram_id})" title="Удалить">✕</button>
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

    if (friendRequests.length > 0) {
        badge.style.display = 'inline';
        badge.textContent = friendRequests.length;
    } else {
        badge.style.display = 'none';
    }

    if (!friendRequests.length) {
        list.innerHTML = `<div class="empty-state"><div class="empty-state__icon">📩</div>
            <div class="empty-state__text">Нет входящих запросов</div></div>`;
        return;
    }

    list.innerHTML = friendRequests.map(r => `
        <div class="request-card">
            <div class="request-card__avatar">${r.avatar || '🪖'}</div>
            <div class="request-card__info">
                <div class="request-card__name">${r.name}</div>
                <div class="request-card__sub">${r.wot_nick || ''}</div>
            </div>
            <div class="request-btns">
                <button class="request-btn-accept" onclick="acceptRequest(${r.telegram_id})">✅ Принять</button>
                <button class="request-btn-decline" onclick="declineRequest(${r.telegram_id})">✕</button>
            </div>
        </div>
    `).join('');
}

function acceptRequest(telegramId) {
    const req = friendRequests.find(r => r.telegram_id === telegramId);
    if (req) {
        friends.push({ ...req, online: true });
        friendRequests = friendRequests.filter(r => r.telegram_id !== telegramId);
        saveFriends();
        renderFriends();
        renderRequests();
        showToast(`✅ ${req.name} теперь ваш друг!`);
    }
}

function declineRequest(telegramId) {
    friendRequests = friendRequests.filter(r => r.telegram_id !== telegramId);
    renderRequests();
    showToast('Запрос отклонён');
}

// ============================================================
// REMOVE FRIEND
// ============================================================
function removeFriend(telegramId) {
    if (!confirm('Удалить из друзей?')) return;
    const friend = friends.find(f => f.telegram_id === telegramId);
    friends = friends.filter(f => f.telegram_id !== telegramId);
    saveFriends();
    renderFriends();
    showToast(`${friend?.name || 'Друг'} удалён`);
}

// ============================================================
// SEARCH FOR FRIEND
// ============================================================
function searchForFriend() {
    const query = document.getElementById('friendSearchInput').value.trim();
    if (query.length < 2) return;

    const results = document.getElementById('friendSearchResults');
    results.innerHTML = `<div style="text-align:center;padding:20px;color:#5A6577">🔍 Ищем...</div>`;

    setTimeout(() => {
        // Демо: генерируем результат
        results.innerHTML = `
            <div class="friend-card">
                <div class="friend-card__avatar">🪖</div>
                <div class="friend-card__info">
                    <div class="friend-card__name">${query}</div>
                    <div class="friend-card__wot">Игрок</div>
                </div>
                <button class="request-btn-accept" onclick="addFriend('${query}')">➕ Добавить</button>
            </div>
        `;
    }, 500);
}

function addFriend(name) {
    const newFriend = {
        telegram_id: Date.now(),
        name: name,
        wot_nick: name,
        avatar: '🪖',
        online: false,
    };
    friends.push(newFriend);
    saveFriends();
    renderFriends();
    showToast(`📩 Запрос отправлен ${name}!`);
}

// ============================================================
// CHAT
// ============================================================
function openChat(telegramId) {
    currentChatFriend = friends.find(f => f.telegram_id === telegramId);
    if (!currentChatFriend) return;

    const avatarContent = currentChatFriend.avatar && currentChatFriend.avatar.startsWith('data:')
        ? `<img src="${currentChatFriend.avatar}" alt="">` : (currentChatFriend.avatar || '🪖');

    document.getElementById('chatAvatar').innerHTML = avatarContent;
    document.getElementById('chatName').textContent = currentChatFriend.name;
    document.getElementById('chatStatus').textContent = currentChatFriend.online ? '🟢 В сети' : '⚫ Был недавно';

    renderMessages(telegramId);
    document.getElementById('chatOverlay').classList.add('chat-overlay--open');
    document.getElementById('chatInput').focus();
}

function closeChat() {
    document.getElementById('chatOverlay').classList.remove('chat-overlay--open');
    currentChatFriend = null;
}

function renderMessages(friendId) {
    const container = document.getElementById('chatMessages');
    const chatMsgs = messages[friendId] || [];

    if (!chatMsgs.length) {
        container.innerHTML = `<div class="empty-state" style="padding:60px 20px">
            <div class="empty-state__icon">💬</div>
            <div class="empty-state__text">Напиши первое сообщение!</div>
        </div>`;
        return;
    }

    container.innerHTML = chatMsgs.map(m => {
        const time = new Date(m.time).toLocaleTimeString('ru', { hour: '2-digit', minute: '2-digit' });
        return `<div class="msg ${m.mine ? 'msg--mine' : 'msg--theirs'}">
            ${m.text}
            <div class="msg__time">${time}</div>
        </div>`;
    }).join('');

    container.scrollTop = container.scrollHeight;
}

function sendMsg() {
    const input = document.getElementById('chatInput');
    const text = input.value.trim();
    if (!text || !currentChatFriend) return;

    const friendId = currentChatFriend.telegram_id;
    if (!messages[friendId]) messages[friendId] = [];

    messages[friendId].push({
        text: text,
        mine: true,
        time: Date.now(),
    });

    input.value = '';
    saveMessages();
    renderMessages(friendId);

    // Симуляция ответа (демо)
    if (currentChatFriend.online) {
        setTimeout(() => {
            const replies = ['👍', 'Го в бой!', 'Лан)', 'Ок', '🔥🔥🔥', 'Щас приду', 'Жди, скоро буду'];
            messages[friendId].push({
                text: replies[Math.floor(Math.random() * replies.length)],
                mine: false,
                time: Date.now(),
            });
            saveMessages();
            renderMessages(friendId);
        }, 1000 + Math.random() * 2000);
    }
}

// ============================================================
// CHALLENGE FRIEND
// ============================================================
function challengeFriend() {
    if (!currentChatFriend) return;
    challengeFriendById(currentChatFriend.telegram_id);
}

function challengeFriendById(telegramId) {
    const friend = friends.find(f => f.telegram_id === telegramId);
    if (!friend) return;

    // Переходим на арену с параметром соперника
    const params = new URLSearchParams({
        opponent: friend.wot_nick || friend.name,
        opponent_id: telegramId,
    });
    window.location.href = `challenges.html?${params.toString()}`;
}

// ============================================================
// PERSISTENCE
// ============================================================
function saveFriends() {
    localStorage.setItem(FRIENDS_KEY, JSON.stringify(friends));
}

function saveMessages() {
    localStorage.setItem(MESSAGES_KEY, JSON.stringify(messages));
}

// ============================================================
// TOAST
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

// ============================================================
// PARTICLES
// ============================================================
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

// Close modals on overlay click
document.getElementById('avatarModal')?.addEventListener('click', function (e) {
    if (e.target === this) closeAvatarPicker();
});
