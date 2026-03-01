/**
 * Chat Widget — Мир Танков
 * Встроенный чат с поддержкой Telegram
 */

(function () {
    'use strict';

    // ========== CONFIG ==========
    const CHAT_GROUP_NAME = 'МИР ТАНКОВ — Чат';
    const MAX_MESSAGES = 100;

    // ========== STATE ==========
    let isOpen = false;
    let messages = [];
    let userName = 'Танкист';
    let unreadCount = 0;

    // Try to get Telegram user info
    try {
        if (window.Telegram && Telegram.WebApp && Telegram.WebApp.initDataUnsafe) {
            const user = Telegram.WebApp.initDataUnsafe.user;
            if (user) {
                userName = user.first_name || user.username || 'Танкист';
            }
        }
    } catch (e) { }

    // ========== DEMO MESSAGES ==========
    const demoMessages = [
        { id: 1, type: 'system', text: 'Добро пожаловать в чат клуба! 🪖' },
        { id: 2, user: 'ISERVERI', avatar: 'IS', text: 'Привет всем! Сегодня стрим в 20:00 🎮', time: '20:15', own: false },
        { id: 3, user: 'Fors777', avatar: 'F', text: 'О, круто! На каком танке будешь?', time: '20:16', own: false },
        { id: 4, user: 'ISERVERI', avatar: 'IS', text: 'T-62A, нагибаем рандом 💪', time: '20:16', own: false },
        { id: 5, user: 'Tank_Master', avatar: 'TM', text: 'Я тоже зайду, подождите!', time: '20:17', own: false },
        { id: 6, user: 'PRO_TANKER', avatar: 'PT', text: 'Кто на взвод? 3 лвл кланов 🏆', time: '20:18', own: false },
        { id: 7, user: 'ISERVERI', avatar: 'IS', text: 'Давайте! Собираемся в ТС', time: '20:19', own: false },
        { id: 8, type: 'system', text: '🎯 Новый челлендж: 5000 урона за бой!' },
        { id: 9, user: 'NoOb_KiLLeR', avatar: 'NK', text: 'Ого, вчера набил 6.2к на Объ 140 😎', time: '20:22', own: false },
        { id: 10, user: 'Fors777', avatar: 'F', text: 'Красавчик! Скрин покаж', time: '20:23', own: false },
    ];

    // ========== CREATE DOM ==========
    function createWidget() {
        // Toggle button
        const toggle = document.createElement('button');
        toggle.className = 'chat-toggle';
        toggle.id = 'chatToggle';
        toggle.innerHTML = '💬';
        toggle.onclick = toggleChat;

        // Badge
        const badge = document.createElement('span');
        badge.className = 'chat-toggle__badge';
        badge.id = 'chatBadge';
        badge.textContent = '3';
        badge.style.display = 'block';
        toggle.appendChild(badge);

        // Chat panel
        const panel = document.createElement('div');
        panel.className = 'chat-panel';
        panel.id = 'chatPanel';
        panel.innerHTML = `
            <div class="chat-header">
                <div class="chat-header__avatar">🪖</div>
                <div class="chat-header__info">
                    <div class="chat-header__title">${CHAT_GROUP_NAME}</div>
                    <div class="chat-header__status">онлайн</div>
                </div>
                <button class="chat-header__close" onclick="window.chatWidget.toggle()">✕</button>
            </div>
            <div class="chat-messages" id="chatMessages"></div>
            <div class="chat-typing" id="chatTyping">
                кто-то печатает <span class="typing-dots"><span></span><span></span><span></span></span>
            </div>
            <div class="chat-input">
                <input 
                    type="text" 
                    class="chat-input__field" 
                    id="chatInput"
                    placeholder="Написать сообщение..."
                    maxlength="500"
                    autocomplete="off"
                >
                <button class="chat-input__send" id="chatSendBtn" onclick="window.chatWidget.send()">
                    <svg viewBox="0 0 24 24"><path d="M2.01 21L23 12 2.01 3 2 10l15 2-15 2z"/></svg>
                </button>
            </div>
        `;

        document.body.appendChild(toggle);
        document.body.appendChild(panel);

        // Enter key to send
        document.getElementById('chatInput').addEventListener('keydown', (e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                sendMessage();
            }
        });

        // Load demo messages
        loadDemoMessages();
    }

    // ========== TOGGLE ==========
    function toggleChat() {
        isOpen = !isOpen;
        const panel = document.getElementById('chatPanel');
        const toggle = document.getElementById('chatToggle');
        const badge = document.getElementById('chatBadge');

        if (isOpen) {
            panel.classList.add('chat-panel--open');
            toggle.classList.add('chat-toggle--open');
            toggle.innerHTML = '✕';
            badge.style.display = 'none';
            unreadCount = 0;

            // Scroll to bottom
            setTimeout(() => {
                const msgs = document.getElementById('chatMessages');
                msgs.scrollTop = msgs.scrollHeight;
            }, 100);

            // Focus input
            setTimeout(() => {
                document.getElementById('chatInput').focus();
            }, 300);
        } else {
            panel.classList.remove('chat-panel--open');
            toggle.classList.remove('chat-toggle--open');
            toggle.innerHTML = '💬';
        }
    }

    // ========== RENDER MESSAGES ==========
    function renderMessage(msg) {
        const container = document.getElementById('chatMessages');

        const el = document.createElement('div');

        if (msg.type === 'system') {
            el.className = 'chat-msg chat-msg--system';
            el.innerHTML = `<div class="chat-msg__bubble">${msg.text}</div>`;
        } else {
            el.className = `chat-msg ${msg.own ? 'chat-msg--own' : ''}`;
            el.innerHTML = `
                <div class="chat-msg__avatar">${msg.avatar || msg.user.charAt(0)}</div>
                <div class="chat-msg__body">
                    <div class="chat-msg__name">${msg.user}</div>
                    <div class="chat-msg__bubble">${escapeHtml(msg.text)}</div>
                    <div class="chat-msg__time">${msg.time || getCurrentTime()}</div>
                </div>
            `;
        }

        container.appendChild(el);

        // Auto-scroll
        container.scrollTop = container.scrollHeight;

        // Limit messages
        while (container.children.length > MAX_MESSAGES) {
            container.removeChild(container.firstChild);
        }
    }

    function loadDemoMessages() {
        demoMessages.forEach(msg => renderMessage(msg));
    }

    // ========== SEND MESSAGE ==========
    function sendMessage() {
        const input = document.getElementById('chatInput');
        const text = input.value.trim();

        if (!text) return;

        // Add own message
        const msg = {
            id: Date.now(),
            user: userName,
            avatar: userName.charAt(0),
            text: text,
            time: getCurrentTime(),
            own: true,
        };

        renderMessage(msg);
        input.value = '';

        // Show typing indicator after a delay (simulating response)
        setTimeout(() => showTyping(), 800);
        setTimeout(() => hideTyping(), 2500);

        // Simulate a response
        setTimeout(() => {
            const responses = [
                { user: 'ISERVERI', avatar: 'IS', text: 'Норм! 👍' },
                { user: 'Fors777', avatar: 'F', text: 'Ага, согласен!' },
                { user: 'Tank_Master', avatar: 'TM', text: '🔥🔥🔥' },
                { user: 'PRO_TANKER', avatar: 'PT', text: 'Лайк!' },
                { user: 'ISERVERI', avatar: 'IS', text: 'Заходи на стрим, обсудим 😄' },
                { user: 'NoOb_KiLLeR', avatar: 'NK', text: 'Красава!' },
            ];
            const resp = responses[Math.floor(Math.random() * responses.length)];
            resp.time = getCurrentTime();
            resp.own = false;
            resp.id = Date.now();
            renderMessage(resp);

            if (!isOpen) {
                unreadCount++;
                const badge = document.getElementById('chatBadge');
                badge.textContent = unreadCount;
                badge.style.display = 'block';
            }
        }, 3000);

        // Try to send via Telegram WebApp (if available)
        try {
            if (window.Telegram && Telegram.WebApp) {
                Telegram.WebApp.sendData(JSON.stringify({
                    type: 'chat_message',
                    text: text,
                    user: userName,
                }));
            }
        } catch (e) { }
    }

    // ========== TYPING INDICATOR ==========
    function showTyping() {
        const el = document.getElementById('chatTyping');
        if (el) el.classList.add('chat-typing--visible');
    }

    function hideTyping() {
        const el = document.getElementById('chatTyping');
        if (el) el.classList.remove('chat-typing--visible');
    }

    // ========== HELPERS ==========
    function getCurrentTime() {
        const now = new Date();
        return now.getHours().toString().padStart(2, '0') + ':' +
            now.getMinutes().toString().padStart(2, '0');
    }

    function escapeHtml(text) {
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }

    // ========== INIT ==========
    function init() {
        // Load CSS
        const link = document.createElement('link');
        link.rel = 'stylesheet';
        link.href = 'css/chat-widget.css';
        document.head.appendChild(link);

        // Create widget after DOM ready
        if (document.readyState === 'loading') {
            document.addEventListener('DOMContentLoaded', createWidget);
        } else {
            createWidget();
        }
    }

    // Public API
    window.chatWidget = {
        toggle: toggleChat,
        send: sendMessage,
        open: () => { if (!isOpen) toggleChat(); },
        close: () => { if (isOpen) toggleChat(); },
    };

    init();
})();
