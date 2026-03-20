/**
 * АДМИН-ПАНЕЛЬ — Управление Колесом Фортуны
 * Редактирование призов, предпросмотр, экспорт/импорт
 */

// ==========================================
// КОНФИГ ПО УМОЛЧАНИЮ
// ==========================================
const DEFAULT_CONFIG = {
    prizes: [
        { name: '1000 монет', icon: '💰', coins: 1000, xp: 50, color: '#C8AA6E', weight: 2, tier: 'legendary' },
        { name: '50 монет', icon: '🪙', coins: 50, xp: 5, color: '#2D5A27', weight: 20, tier: 'common' },
        { name: '500 монет', icon: '💎', coins: 500, xp: 30, color: '#4A5568', weight: 5, tier: 'epic' },
        { name: '25 монет', icon: '🪙', coins: 25, xp: 3, color: '#5C6B3C', weight: 25, tier: 'common' },
        { name: '250 монет', icon: '🏅', coins: 250, xp: 15, color: '#8B7340', weight: 10, tier: 'rare' },
        { name: '10 монет', icon: '🔩', coins: 10, xp: 1, color: '#1A3A15', weight: 30, tier: 'common' },
        { name: '100 монет', icon: '⭐', coins: 100, xp: 10, color: '#3D5A80', weight: 15, tier: 'uncommon' },
        { name: '75 монет', icon: '🎖️', coins: 75, xp: 8, color: '#6B5B3C', weight: 18, tier: 'uncommon' },
    ],
    settings: {
        freeSpinsPerDay: 1,
        spinCostCoins: 50,
        spinCostStars: 5,
        buySpinsAmount: 5,
    }
};

const TIERS = [
    { value: 'legendary', label: '🔥 Легендарный' },
    { value: 'epic', label: '💎 Эпический' },
    { value: 'rare', label: '🏅 Редкий' },
    { value: 'uncommon', label: '⭐ Необычный' },
    { value: 'common', label: '🪙 Обычный' },
];

// ==========================================
// СОСТОЯНИЕ
// ==========================================
let currentConfig = null;

// ==========================================
// ИНИЦИАЛИЗАЦИЯ
// ==========================================
document.addEventListener('DOMContentLoaded', () => {
    loadConfig();
    renderPrizes();
    renderSettings();
    updatePreview();
});

function loadConfig() {
    try {
        const saved = localStorage.getItem('wot_wheel_config');
        if (saved) {
            currentConfig = JSON.parse(saved);
        }
    } catch (e) {
        console.warn('Ошибка загрузки конфига:', e);
    }

    if (!currentConfig) {
        currentConfig = JSON.parse(JSON.stringify(DEFAULT_CONFIG));
    }

    // Убедимся что есть все поля
    if (!currentConfig.settings) currentConfig.settings = { ...DEFAULT_CONFIG.settings };
    if (!currentConfig.prizes) currentConfig.prizes = [...DEFAULT_CONFIG.prizes];
}

// ==========================================
// РЕНДЕР СПИСКА ПРИЗОВ
// ==========================================
function renderPrizes() {
    const container = document.getElementById('prizesList');
    if (!container) return;

    container.innerHTML = currentConfig.prizes.map((prize, index) => `
        <div class="prize-item" style="animation-delay: ${index * 0.03}s">
            <div class="prize-item__header">
                <span class="prize-item__number">#${index + 1}</span>
                <span class="prize-item__tier tier-${prize.tier}">${getTierLabel(prize.tier)}</span>
            </div>
            <div class="prize-item__fields">
                <div class="prize-item__field">
                    <label>Иконка</label>
                    <input type="text" value="${prize.icon}" maxlength="4"
                        oninput="updatePrize(${index}, 'icon', this.value)">
                </div>
                <div class="prize-item__field">
                    <label>Название приза</label>
                    <input type="text" value="${escapeHtml(prize.name)}" placeholder="Например: 500 монет"
                        oninput="updatePrize(${index}, 'name', this.value)">
                </div>
                <div class="prize-item__field">
                    <label>Монеты</label>
                    <input type="number" value="${prize.coins}" min="0"
                        oninput="updatePrize(${index}, 'coins', parseInt(this.value) || 0)">
                </div>
            </div>
            <div class="prize-item__row2">
                <div class="prize-item__field">
                    <label>Вес (шанс)</label>
                    <input type="number" value="${prize.weight}" min="1" max="100"
                        oninput="updatePrize(${index}, 'weight', parseInt(this.value) || 1)">
                </div>
                <div class="prize-item__field">
                    <label>Редкость</label>
                    <select onchange="updatePrize(${index}, 'tier', this.value)">
                        ${TIERS.map(t => `<option value="${t.value}" ${prize.tier === t.value ? 'selected' : ''}>${t.label}</option>`).join('')}
                    </select>
                </div>
                <div class="prize-item__field">
                    <label>Цвет</label>
                    <div class="prize-item__color-input">
                        <input type="color" value="${prize.color}"
                            oninput="updatePrize(${index}, 'color', this.value)">
                    </div>
                </div>
                <button class="prize-item__delete" title="Удалить" onclick="removePrize(${index})">🗑️</button>
            </div>
        </div>
    `).join('');
}

function getTierLabel(tier) {
    const t = TIERS.find(t => t.value === tier);
    return t ? t.label : tier;
}

function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

// ==========================================
// РЕНДЕР НАСТРОЕК
// ==========================================
function renderSettings() {
    const s = currentConfig.settings;
    document.getElementById('settingFreeSpins').value = s.freeSpinsPerDay ?? 1;
    document.getElementById('settingSpinCost').value = s.spinCostCoins ?? 50;
    document.getElementById('settingStarsCost').value = s.spinCostStars ?? 5;
    document.getElementById('settingBuyAmount').value = s.buySpinsAmount ?? 5;
}

function onSettingsChange() {
    currentConfig.settings.freeSpinsPerDay = parseInt(document.getElementById('settingFreeSpins').value) || 1;
    currentConfig.settings.spinCostCoins = parseInt(document.getElementById('settingSpinCost').value) || 50;
    currentConfig.settings.spinCostStars = parseInt(document.getElementById('settingStarsCost').value) || 5;
    currentConfig.settings.buySpinsAmount = parseInt(document.getElementById('settingBuyAmount').value) || 5;
}

// ==========================================
// ДЕЙСТВИЯ С ПРИЗАМИ
// ==========================================
function updatePrize(index, field, value) {
    if (currentConfig.prizes[index]) {
        currentConfig.prizes[index][field] = value;
        updatePreview();

        // Если изменилась редкость, перерендерим для обновления бейджа
        if (field === 'tier') {
            renderPrizes();
        }
    }
}

function addPrize() {
    if (currentConfig.prizes.length >= 12) {
        showAdminToast('⚠️', 'Максимум 12 секторов на колесе!');
        return;
    }

    currentConfig.prizes.push({
        name: 'Новый приз',
        icon: '🎁',
        coins: 100,
        xp: 10,
        color: getRandomColor(),
        weight: 10,
        tier: 'common',
    });

    renderPrizes();
    updatePreview();
    showAdminToast('✅', 'Приз добавлен!');
}

function removePrize(index) {
    if (currentConfig.prizes.length <= 2) {
        showAdminToast('⚠️', 'Минимум 2 приза на колесе!');
        return;
    }

    currentConfig.prizes.splice(index, 1);
    renderPrizes();
    updatePreview();
    showAdminToast('🗑️', 'Приз удалён');
}

function getRandomColor() {
    const colors = ['#C8AA6E', '#2D5A27', '#4A5568', '#8B7340', '#3D5A80', '#6B5B3C', '#5C6B3C', '#1A3A15', '#9B59B6', '#E74C3C'];
    return colors[Math.floor(Math.random() * colors.length)];
}

// ==========================================
// ПРЕДПРОСМОТР КОЛЕСА (Canvas)
// ==========================================
function updatePreview() {
    drawPreviewWheel();
    renderChances();
}

function drawPreviewWheel() {
    const canvas = document.getElementById('previewCanvas');
    if (!canvas) return;

    const ctx = canvas.getContext('2d');
    const dpr = window.devicePixelRatio || 1;
    const size = 300;

    canvas.width = size * dpr;
    canvas.height = size * dpr;
    canvas.style.width = size + 'px';
    canvas.style.height = size + 'px';
    ctx.scale(dpr, dpr);

    const prizes = currentConfig.prizes;
    const centerX = size / 2;
    const centerY = size / 2;
    const radius = size / 2 - 6;
    const sliceAngle = (2 * Math.PI) / prizes.length;

    // Clear
    ctx.clearRect(0, 0, size, size);

    prizes.forEach((prize, i) => {
        const startAngle = i * sliceAngle - Math.PI / 2;
        const endAngle = startAngle + sliceAngle;

        // Slice
        ctx.beginPath();
        ctx.moveTo(centerX, centerY);
        ctx.arc(centerX, centerY, radius, startAngle, endAngle);
        ctx.closePath();

        const grad = ctx.createRadialGradient(centerX, centerY, 20, centerX, centerY, radius);
        grad.addColorStop(0, lightenColor(prize.color, 20));
        grad.addColorStop(1, prize.color);
        ctx.fillStyle = grad;
        ctx.fill();

        ctx.strokeStyle = 'rgba(200, 170, 110, 0.3)';
        ctx.lineWidth = 1.5;
        ctx.stroke();

        // Text & Icon
        ctx.save();
        ctx.translate(centerX, centerY);
        ctx.rotate(startAngle + sliceAngle / 2);

        ctx.font = '20px serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(prize.icon, radius * 0.62, 0);

        ctx.font = 'bold 9px Inter, sans-serif';
        ctx.fillStyle = '#fff';
        ctx.shadowColor = 'rgba(0, 0, 0, 0.5)';
        ctx.shadowBlur = 3;

        const textParts = prize.name.split(' ');
        if (textParts.length > 1) {
            ctx.fillText(textParts[0], radius * 0.38, -6);
            ctx.fillText(textParts.slice(1).join(' '), radius * 0.38, 6);
        } else {
            ctx.fillText(prize.name, radius * 0.38, 0);
        }

        ctx.restore();
    });

    // Center circle
    ctx.beginPath();
    ctx.arc(centerX, centerY, 25, 0, 2 * Math.PI);
    ctx.fillStyle = '#111820';
    ctx.fill();
    ctx.strokeStyle = 'rgba(200, 170, 110, 0.5)';
    ctx.lineWidth = 3;
    ctx.stroke();

    ctx.font = '16px serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = '#fff';
    ctx.fillText('🏆', centerX, centerY);

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
// ШАНСЫ ВЫПАДЕНИЯ
// ==========================================
function renderChances() {
    const container = document.getElementById('chancesList');
    if (!container) return;

    const prizes = currentConfig.prizes;
    const totalWeight = prizes.reduce((sum, p) => sum + p.weight, 0);

    container.innerHTML = prizes.map(prize => {
        const percent = ((prize.weight / totalWeight) * 100).toFixed(1);
        return `
            <div class="chance-item">
                <div class="chance-item__color" style="background: ${prize.color}"></div>
                <span class="chance-item__name">${prize.icon} ${escapeHtml(prize.name)}</span>
                <div class="chance-item__bar-wrapper">
                    <div class="chance-item__bar" style="width: ${percent}%; background: ${prize.color}"></div>
                </div>
                <span class="chance-item__percent">${percent}%</span>
            </div>
        `;
    }).join('');
}

// ==========================================
// СОХРАНЕНИЕ
// ==========================================
function saveConfig() {
    try {
        onSettingsChange(); // Собрать последние настройки
        localStorage.setItem('wot_wheel_config', JSON.stringify(currentConfig));
        showAdminToast('✅', 'Конфигурация сохранена! Изменения видны на вашем устройстве.');
    } catch (e) {
        showAdminToast('❌', 'Ошибка сохранения: ' + e.message);
    }
}

function resetToDefault() {
    if (!confirm('Сбросить все призы к настройкам по умолчанию?')) return;
    currentConfig = JSON.parse(JSON.stringify(DEFAULT_CONFIG));
    renderPrizes();
    renderSettings();
    updatePreview();
    showAdminToast('🔄', 'Конфигурация сброшена');
}

// ==========================================
// ЭКСПОРТ / ИМПОРТ
// ==========================================
function downloadConfig() {
    onSettingsChange();
    const json = JSON.stringify(currentConfig, null, 4);
    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);

    const a = document.createElement('a');
    a.href = url;
    a.download = 'prizes-config.json';
    a.click();

    URL.revokeObjectURL(url);
    showAdminToast('📥', 'Файл скачан! Загрузи его в GitHub');
}

function importConfig(event) {
    const file = event.target.files[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (e) => {
        try {
            const imported = JSON.parse(e.target.result);

            if (!imported.prizes || !Array.isArray(imported.prizes)) {
                throw new Error('Неверный формат: нет массива prizes');
            }

            currentConfig = imported;
            renderPrizes();
            renderSettings();
            updatePreview();
            showAdminToast('✅', 'Конфигурация загружена!');
        } catch (err) {
            showAdminToast('❌', 'Ошибка файла: ' + err.message);
        }
    };
    reader.readAsText(file);

    // Reset file input
    event.target.value = '';
}

function copyConfigToClipboard() {
    onSettingsChange();
    const json = JSON.stringify(currentConfig, null, 4);

    navigator.clipboard.writeText(json).then(() => {
        showAdminToast('📋', 'JSON скопирован в буфер обмена!');
    }).catch(() => {
        // Fallback
        const textArea = document.createElement('textarea');
        textArea.value = json;
        document.body.appendChild(textArea);
        textArea.select();
        document.execCommand('copy');
        document.body.removeChild(textArea);
        showAdminToast('📋', 'JSON скопирован!');
    });
}

// ==========================================
// УВЕДОМЛЕНИЯ
// ==========================================
function showAdminToast(icon, text) {
    const toast = document.getElementById('toast');
    const toastIcon = document.getElementById('toastIcon');
    const toastText = document.getElementById('toastText');

    if (!toast) return;

    toastIcon.textContent = icon;
    toastText.textContent = text;

    toast.style.display = 'flex';
    requestAnimationFrame(() => {
        toast.classList.add('toast--visible');
    });

    clearTimeout(window._toastTimer);
    window._toastTimer = setTimeout(() => {
        toast.classList.remove('toast--visible');
        setTimeout(() => { toast.style.display = 'none'; }, 400);
    }, 3000);
}

// Expose
window.updatePrize = updatePrize;
window.addPrize = addPrize;
window.removePrize = removePrize;
window.saveConfig = saveConfig;
window.resetToDefault = resetToDefault;
window.downloadConfig = downloadConfig;
window.importConfig = importConfig;
window.copyConfigToClipboard = copyConfigToClipboard;
window.onSettingsChange = onSettingsChange;
window.buySpins = function () { };
