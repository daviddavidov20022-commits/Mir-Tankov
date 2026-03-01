/**
 * МИР ТАНКОВ — Колесо Фортуны
 * Полная логика колеса: отрисовка, вращение, призы
 * Призы загружаются из конфига (админ-панель)
 */

// ==========================================
// КОНФИГУРАЦИЯ ПРИЗОВ (по умолчанию)
// ==========================================
const DEFAULT_PRIZES = [
    { name: '1000 монет', icon: '💰', coins: 1000, xp: 50, color: '#C8AA6E', weight: 2, tier: 'legendary' },
    { name: '50 монет', icon: '🪙', coins: 50, xp: 5, color: '#2D5A27', weight: 20, tier: 'common' },
    { name: '500 монет', icon: '💎', coins: 500, xp: 30, color: '#4A5568', weight: 5, tier: 'epic' },
    { name: '25 монет', icon: '🪙', coins: 25, xp: 3, color: '#5C6B3C', weight: 25, tier: 'common' },
    { name: '250 монет', icon: '🏅', coins: 250, xp: 15, color: '#8B7340', weight: 10, tier: 'rare' },
    { name: '10 монет', icon: '🔩', coins: 10, xp: 1, color: '#1A3A15', weight: 30, tier: 'common' },
    { name: '100 монет', icon: '⭐', coins: 100, xp: 10, color: '#3D5A80', weight: 15, tier: 'uncommon' },
    { name: '75 монет', icon: '🎖️', coins: 75, xp: 8, color: '#6B5B3C', weight: 18, tier: 'uncommon' },
];

// Активный список призов (загружается из конфига)
let PRIZES = [...DEFAULT_PRIZES];

const TIER_COLORS = {
    legendary: { bg: '#C8AA6E', glow: 'rgba(200, 170, 110, 0.8)' },
    epic: { bg: '#9B59B6', glow: 'rgba(155, 89, 182, 0.8)' },
    rare: { bg: '#3498DB', glow: 'rgba(52, 152, 219, 0.8)' },
    uncommon: { bg: '#2ECC71', glow: 'rgba(46, 204, 113, 0.8)' },
    common: { bg: '#95A5A6', glow: 'rgba(149, 165, 166, 0.8)' },
};

// ==========================================
// СОСТОЯНИЕ
// ==========================================
let isSpinning = false;
let currentRotation = 0;
let freeSpins = 1;
let MAX_FREE_SPINS = 1;
let SPIN_COST_COINS = 50;
let SPIN_COST_STARS = 5;
let BUY_SPINS_AMOUNT = 5;
const DAILY_RESET_MS = 24 * 60 * 60 * 1000;

let spinHistory = [];

// ==========================================
// ЗАГРУЗКА КОНФИГА
// ==========================================
async function loadPrizesConfig() {
    // 1. Сначала ВСЕГДА пробуем файл prizes-config.json (чтобы бот был главным)
    try {
        const response = await fetch('prizes-config.json?t=' + Date.now());
        if (response.ok) {
            const config = await response.json();
            if (config.prizes && config.prizes.length >= 2) {
                PRIZES = config.prizes;
                applySettings(config.settings);
                console.log('✅ Конфиг загружен из prizes-config.json (установлен ботом)');
                return;
            }
        }
    } catch (e) {
        console.log('Файл конфига не найден или недоступен, пробуем localStorage...');
    }

    // 2. Пробуем localStorage (если файл не загрузился)
    try {
        const saved = localStorage.getItem('wot_wheel_config');
        if (saved) {
            const config = JSON.parse(saved);
            if (config.prizes && config.prizes.length >= 2) {
                PRIZES = config.prizes;
                applySettings(config.settings);
                console.log('Конфиг загружен из localStorage');
                return;
            }
        }
    } catch (e) { /* продолжаем */ }

    // 3. Используем значения по умолчанию
    PRIZES = [...DEFAULT_PRIZES];
    console.log('Используется конфиг по умолчанию');
}

function applySettings(settings) {
    if (!settings) return;
    MAX_FREE_SPINS = settings.freeSpinsPerDay ?? 1;
    SPIN_COST_COINS = settings.spinCostCoins ?? 50;
    SPIN_COST_STARS = settings.spinCostStars ?? 5;
    BUY_SPINS_AMOUNT = settings.buySpinsAmount ?? 5;
}

// ==========================================
// ИНИЦИАЛИЗАЦИЯ
// ==========================================
document.addEventListener('DOMContentLoaded', async () => {
    await loadPrizesConfig();
    loadState();
    drawWheel();
    createWheelLights();
    updateUI();
    startCooldownTimer();
});

function loadState() {
    try {
        const saved = localStorage.getItem('wot_wheel_state');
        if (saved) {
            const state = JSON.parse(saved);
            freeSpins = state.freeSpins ?? MAX_FREE_SPINS;
            spinHistory = state.spinHistory ?? [];
            currentRotation = state.currentRotation ?? 0;

            // Daily reset check
            if (state.lastFreeSpinDate) {
                const today = new Date().toDateString();
                if (state.lastFreeSpinDate !== today) {
                    freeSpins = MAX_FREE_SPINS;
                }
            } else {
                freeSpins = MAX_FREE_SPINS;
            }
        }
    } catch (e) {
        console.warn('Ошибка загрузки состояния колеса:', e);
    }
}

function saveState() {
    try {
        const existing = JSON.parse(localStorage.getItem('wot_wheel_state') || '{}');
        localStorage.setItem('wot_wheel_state', JSON.stringify({
            freeSpins,
            spinHistory: spinHistory.slice(0, 20),
            currentRotation,
            lastFreeSpinDate: existing.lastFreeSpinDate || null,
            lastSpinTime: Date.now(),
        }));
    } catch (e) {
        console.warn('Ошибка сохранения:', e);
    }
}

// ==========================================
// ОТРИСОВКА КОЛЕСА (Canvas)
// ==========================================
function drawWheel() {
    const canvas = document.getElementById('wheelCanvas');
    if (!canvas) return;

    const ctx = canvas.getContext('2d');
    const dpr = window.devicePixelRatio || 1;
    const size = 320;

    canvas.width = size * dpr;
    canvas.height = size * dpr;
    canvas.style.width = size + 'px';
    canvas.style.height = size + 'px';
    ctx.scale(dpr, dpr);

    const centerX = size / 2;
    const centerY = size / 2;
    const radius = size / 2 - 6;
    const sliceAngle = (2 * Math.PI) / PRIZES.length;

    // Draw slices
    PRIZES.forEach((prize, i) => {
        const startAngle = i * sliceAngle - Math.PI / 2;
        const endAngle = startAngle + sliceAngle;

        // Slice background
        ctx.beginPath();
        ctx.moveTo(centerX, centerY);
        ctx.arc(centerX, centerY, radius, startAngle, endAngle);
        ctx.closePath();

        // Gradient for each slice
        const grad = ctx.createRadialGradient(centerX, centerY, 20, centerX, centerY, radius);
        grad.addColorStop(0, lightenColor(prize.color, 20));
        grad.addColorStop(1, prize.color);
        ctx.fillStyle = grad;
        ctx.fill();

        // Slice border
        ctx.strokeStyle = 'rgba(200, 170, 110, 0.3)';
        ctx.lineWidth = 1.5;
        ctx.stroke();

        // Icon and text
        ctx.save();
        ctx.translate(centerX, centerY);
        ctx.rotate(startAngle + sliceAngle / 2);

        // Icon
        ctx.font = '24px serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(prize.icon, radius * 0.62, 0);

        // Prize name
        ctx.rotate(0);
        ctx.font = 'bold 10px Inter, sans-serif';
        ctx.fillStyle = '#fff';
        ctx.textAlign = 'center';
        ctx.shadowColor = 'rgba(0, 0, 0, 0.5)';
        ctx.shadowBlur = 4;

        // Split text for better display
        const textParts = prize.name.split(' ');
        if (textParts.length > 1) {
            ctx.fillText(textParts[0], radius * 0.4, -7);
            ctx.fillText(textParts.slice(1).join(' '), radius * 0.4, 7);
        } else {
            ctx.fillText(prize.name, radius * 0.4, 0);
        }

        ctx.restore();
    });

    // Inner shadow circle
    const innerGrad = ctx.createRadialGradient(centerX, centerY, 0, centerX, centerY, 40);
    innerGrad.addColorStop(0, 'rgba(10, 14, 20, 0.6)');
    innerGrad.addColorStop(1, 'transparent');
    ctx.beginPath();
    ctx.arc(centerX, centerY, 40, 0, 2 * Math.PI);
    ctx.fillStyle = innerGrad;
    ctx.fill();

    // Outer ring
    ctx.beginPath();
    ctx.arc(centerX, centerY, radius, 0, 2 * Math.PI);
    ctx.strokeStyle = 'rgba(200, 170, 110, 0.5)';
    ctx.lineWidth = 3;
    ctx.stroke();
}

function lightenColor(hex, percent) {
    const num = parseInt(hex.replace('#', ''), 16);
    const amt = Math.round(2.55 * percent);
    const R = Math.min(255, (num >> 16) + amt);
    const G = Math.min(255, ((num >> 8) & 0x00FF) + amt);
    const B = Math.min(255, (num & 0x0000FF) + amt);
    return `rgb(${R}, ${G}, ${B})`;
}

// ==========================================
// ЛАМПОЧКИ ПО КРУГУ
// ==========================================
function createWheelLights() {
    const container = document.getElementById('wheelLights');
    if (!container) return;

    const lightCount = 24;
    const radius = 168; // half of outer ring

    for (let i = 0; i < lightCount; i++) {
        const light = document.createElement('div');
        light.className = 'wheel-light';
        const angle = (i / lightCount) * 360;
        const rad = (angle * Math.PI) / 180;
        const x = Math.cos(rad) * radius;
        const y = Math.sin(rad) * radius;
        light.style.transform = `translate(${x}px, ${y}px)`;
        container.appendChild(light);
    }
}

// ==========================================
// ВЫБОР ПРИЗА (взвешенный рандом)
// ==========================================
function selectPrize() {
    const totalWeight = PRIZES.reduce((sum, p) => sum + p.weight, 0);
    let random = Math.random() * totalWeight;

    for (let i = 0; i < PRIZES.length; i++) {
        random -= PRIZES[i].weight;
        if (random <= 0) return i;
    }

    return PRIZES.length - 1;
}

// ==========================================
// ВРАЩЕНИЕ КОЛЕСА
// ==========================================
function spinWheel() {
    if (isSpinning) return;
    if (freeSpins <= 0) {
        showToast('❌', 'Нет бесплатных вращений!');
        return;
    }

    freeSpins--;
    isSpinning = true;
    performSpin();
}

function spinWheelPaid() {
    if (isSpinning) return;

    const coins = userData.get('coins');
    if (coins < SPIN_COST_COINS) {
        showToast('❌', `Недостаточно монет! Нужно ${SPIN_COST_COINS}`);
        return;
    }

    userData.addCoins(-SPIN_COST_COINS);
    isSpinning = true;
    performSpin();
}

/**
 * ФУНКЦИЯ ДЛЯ ПОКУПКИ ВРАЩЕНИЙ (ДОНАТ)
 * Использует Telegram Stars или перенаправляет на оплату
 */
function buySpins() {
    if (window.Telegram?.WebApp) {
        const tg = window.Telegram.WebApp;

        tg.showConfirm(`Купить ${BUY_SPINS_AMOUNT} вращений за ${SPIN_COST_STARS} ⭐ Stars?`, (ok) => {
            if (ok) {
                freeSpins += BUY_SPINS_AMOUNT;
                saveState();
                updateUI();
                showToast('✅', `Покупка успешно завершена! +${BUY_SPINS_AMOUNT} вращений`);

                if (tg.HapticFeedback) {
                    tg.HapticFeedback.notificationOccurred('success');
                }
            }
        });
    } else {
        // Для браузера
        if (confirm(`Купить ${BUY_SPINS_AMOUNT} вращений за ${SPIN_COST_STARS} Stars? (Симуляция)`)) {
            freeSpins += BUY_SPINS_AMOUNT;
            saveState();
            updateUI();
            showToast('✅', `Покупка симулирована! +${BUY_SPINS_AMOUNT} вращений`);
        }
    }
}

function performSpin() {
    const canvas = document.getElementById('wheelCanvas');
    const spinBtn = document.getElementById('spinBtn');
    const spinBtnCoins = document.getElementById('spinBtnCoins');
    const pointer = document.querySelector('.wheel-pointer');

    // Disable buttons
    if (spinBtn) spinBtn.disabled = true;
    if (spinBtnCoins) spinBtnCoins.disabled = true;

    // Stop pointer animation
    if (pointer) pointer.classList.add('wheel-pointer--spinning');

    // Select prize
    const prizeIndex = selectPrize();
    const prize = PRIZES[prizeIndex];

    // Calculate rotation
    const sliceAngle = 360 / PRIZES.length;
    const targetAngle = 360 - (prizeIndex * sliceAngle + sliceAngle / 2);
    const fullRotations = 5 + Math.floor(Math.random() * 3);
    const totalRotation = fullRotations * 360 + targetAngle;

    currentRotation = totalRotation;

    // Apply rotation
    canvas.style.transition = 'none';
    canvas.offsetHeight; // force reflow
    canvas.classList.add('spinning');
    canvas.style.transition = 'transform 5s cubic-bezier(0.17, 0.67, 0.12, 0.99)';
    canvas.style.transform = `rotate(${totalRotation}deg)`;

    // Haptic during spin
    if (window.Telegram?.WebApp?.HapticFeedback) {
        window.Telegram.WebApp.HapticFeedback.impactOccurred('medium');
    }

    // After spin completes
    setTimeout(() => {
        isSpinning = false;
        canvas.classList.remove('spinning');

        // Restore pointer animation
        if (pointer) pointer.classList.remove('wheel-pointer--spinning');

        // Award prizes
        userData.addCoins(prize.coins);
        userData.addXP(prize.xp);
        userData.addGame();

        if (prize.tier === 'legendary' || prize.tier === 'epic') {
            userData.addWin();
        }

        // Show prize modal
        showPrizeModal(prize);

        // Add to history
        addToHistory(prize);

        // Mark the daily free spin date
        if (freeSpins === 0) {
            const state = JSON.parse(localStorage.getItem('wot_wheel_state') || '{}');
            state.lastFreeSpinDate = new Date().toDateString();
            localStorage.setItem('wot_wheel_state', JSON.stringify(state));
        }

        saveState();
        updateUI();

        // Re-enable buttons
        if (spinBtn) spinBtn.disabled = false;
        if (spinBtnCoins) spinBtnCoins.disabled = false;

        // Haptic feedback
        if (window.Telegram?.WebApp?.HapticFeedback) {
            const type = prize.tier === 'legendary' ? 'success' :
                prize.tier === 'epic' ? 'success' : 'light';
            window.Telegram.WebApp.HapticFeedback.notificationOccurred(type);
        }
    }, 5200);
}

// ==========================================
// МОДАЛЬНОЕ ОКНО ПРИЗА
// ==========================================
function showPrizeModal(prize) {
    const modal = document.getElementById('prizeModal');
    const icon = document.getElementById('prizeIcon');
    const title = document.getElementById('prizeTitle');
    const desc = document.getElementById('prizeDesc');
    const value = document.getElementById('prizeValue');

    if (!modal) return;

    // Set content
    icon.textContent = prize.icon;
    value.textContent = prize.name;

    if (prize.tier === 'legendary') {
        title.textContent = '🔥 ДЖЕКПОТ!';
        desc.textContent = 'Невероятная удача!';
        modal.classList.add('prize-modal--jackpot');
    } else if (prize.tier === 'epic') {
        title.textContent = '💎 ЭПИЧЕСКИЙ!';
        desc.textContent = 'Отличный выигрыш!';
        modal.classList.remove('prize-modal--jackpot');
    } else if (prize.tier === 'rare') {
        title.textContent = '🏅 Редкий приз!';
        desc.textContent = 'Хороший выигрыш!';
        modal.classList.remove('prize-modal--jackpot');
    } else {
        title.textContent = 'Поздравляем!';
        desc.textContent = 'Вы выиграли';
        modal.classList.remove('prize-modal--jackpot');
    }

    modal.classList.add('prize-modal--visible');

    // Create confetti
    createConfetti();
}

function closePrizeModal() {
    const modal = document.getElementById('prizeModal');
    if (modal) {
        modal.classList.remove('prize-modal--visible');
        modal.classList.remove('prize-modal--jackpot');
    }
}

function createConfetti() {
    const container = document.getElementById('prizeParticles');
    if (!container) return;
    container.innerHTML = '';

    const colors = ['#C8AA6E', '#E8D5A3', '#2D5A27', '#4A5568', '#F56565', '#48BB78', '#4299E1'];

    for (let i = 0; i < 40; i++) {
        const confetti = document.createElement('div');
        confetti.className = 'confetti';
        confetti.style.left = Math.random() * 100 + '%';
        confetti.style.top = -10 + 'px';
        confetti.style.background = colors[Math.floor(Math.random() * colors.length)];
        confetti.style.animationDelay = Math.random() * 0.5 + 's';
        confetti.style.animationDuration = (1.5 + Math.random()) + 's';
        confetti.style.width = (4 + Math.random() * 8) + 'px';
        confetti.style.height = (4 + Math.random() * 8) + 'px';
        container.appendChild(confetti);
    }
}

// ==========================================
// ИСТОРИЯ
// ==========================================
function addToHistory(prize) {
    const now = new Date();
    const timeStr = now.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });

    spinHistory.unshift({
        icon: prize.icon,
        name: prize.name,
        tier: prize.tier,
        coins: prize.coins,
        time: timeStr,
    });

    // Keep only last 10
    spinHistory = spinHistory.slice(0, 10);

    renderHistory();
}

function renderHistory() {
    const list = document.getElementById('historyList');
    if (!list) return;

    if (spinHistory.length === 0) {
        list.innerHTML = '<div class="history-empty">Пока нет результатов. Крути колесо!</div>';
        return;
    }

    list.innerHTML = spinHistory.map((item, idx) => `
        <div class="history-item" style="animation-delay: ${idx * 0.05}s">
            <div class="history-item__icon">${item.icon}</div>
            <div class="history-item__info">
                <div class="history-item__name">${item.name}</div>
                <div class="history-item__time">${item.time}</div>
            </div>
            <div class="history-item__value">+${item.coins} 🪙</div>
        </div>
    `).join('');
}

// ==========================================
// UI UPDATES
// ==========================================
function updateUI() {
    // Coins display
    const coinsDisplay = document.getElementById('coinsDisplay');
    if (coinsDisplay && userData) {
        coinsDisplay.textContent = userData.get('coins');
    }

    // Spins count
    const freeSpinsEl = document.getElementById('freeSpinsCount');
    if (freeSpinsEl) freeSpinsEl.textContent = freeSpins;

    // Show/hide buttons
    const spinBtn = document.getElementById('spinBtn');
    const spinBtnCoins = document.getElementById('spinBtnCoins');

    if (freeSpins > 0) {
        if (spinBtn) spinBtn.style.display = '';
        if (spinBtnCoins) spinBtnCoins.style.display = 'none';
    } else {
        if (spinBtn) spinBtn.style.display = 'none';
        if (spinBtnCoins) spinBtnCoins.style.display = '';
    }

    // Timer
    const timerEl = document.getElementById('spinsTimer');
    if (timerEl) {
        timerEl.style.display = freeSpins < MAX_FREE_SPINS ? '' : 'none';
    }

    // Update buy button text with current config values
    const buyBtn = document.getElementById('buySpinsBtn');
    if (buyBtn) {
        const btnText = buyBtn.querySelector('.spin-btn__text');
        const btnSub = buyBtn.querySelector('.spin-btn__sub');
        if (btnText) btnText.textContent = `КУПИТЬ ${BUY_SPINS_AMOUNT}`;
        if (btnSub) btnSub.textContent = `⭐ ${SPIN_COST_STARS} Stars`;
    }

    // Render history
    renderHistory();
}

// ==========================================
// ТАЙМЕР ВОССТАНОВЛЕНИЯ
// ==========================================
function startCooldownTimer() {
    setInterval(() => {
        const today = new Date().toDateString();
        const saved = JSON.parse(localStorage.getItem('wot_wheel_state') || '{}');

        if (saved.lastFreeSpinDate && saved.lastFreeSpinDate !== today && freeSpins < MAX_FREE_SPINS) {
            freeSpins = MAX_FREE_SPINS;
            saveState();
            updateUI();
        }

        // Обновление текста таймера до следующего дня
        const now = new Date();
        const tomorrow = new Date(now);
        tomorrow.setDate(now.getDate() + 1);
        tomorrow.setHours(0, 0, 0, 0);

        const diff = tomorrow - now;
        const hours = Math.floor(diff / 3600000);
        const minutes = Math.floor((diff % 3600000) / 60000);
        const seconds = Math.floor((diff % 60000) / 1000);

        const timerText = document.getElementById('timerText');
        if (timerText) {
            timerText.textContent = `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
        }

    }, 1000);
}

// ==========================================
// НАВИГАЦИЯ
// ==========================================
function goBack() {
    if (window.Telegram?.WebApp?.BackButton) {
        window.Telegram.WebApp.BackButton.hide();
    }
    window.location.href = 'index.html';
}

// Setup Telegram back button
if (window.Telegram?.WebApp?.BackButton) {
    window.Telegram.WebApp.BackButton.show();
    window.Telegram.WebApp.BackButton.onClick(goBack);
}

// Expose to global
window.spinWheel = spinWheel;
window.spinWheelPaid = spinWheelPaid;
window.closePrizeModal = closePrizeModal;
window.goBack = goBack;
window.buySpins = buySpins;
