// =============================================
// SUBSCRIBE PAGE — Multi-Payment Logic
// =============================================

// ===== CONFIG =====
const DONATIONALERTS_URL = 'https://www.donationalerts.com/r/YOUR_CHANNEL';  // TODO: заменить
const DONATEPAY_URL = 'https://new.donatepay.ru/@YOUR_CHANNEL';              // TODO: заменить

const plans = {
    1: { price: 490, stars: 250, label: '490 ₽', starsLabel: '250 ⭐', periodName: '1 месяц', savings: null },
    3: { price: 1323, stars: 675, label: '1 323 ₽', starsLabel: '675 ⭐', periodName: '3 месяца', savings: 'Экономия 147 ₽ / 75 ⭐' },
    6: { price: 2499, stars: 1275, label: '2 499 ₽', starsLabel: '1 275 ⭐', periodName: '6 месяцев', savings: 'Экономия 441 ₽ / 225 ⭐' },
    12: { price: 4410, stars: 2250, label: '4 410 ₽', starsLabel: '2 250 ⭐', periodName: 'Год', savings: 'Экономия 1 470 ₽ / 750 ⭐' },
};

let selectedPeriod = 1;
let selectedPayMethod = 'stars';
let modalPayMethod = 'stars';

// ===== PERIOD SELECTION =====
function selectPeriod(card) {
    document.querySelectorAll('.period-card').forEach(c => c.classList.remove('period-card--selected'));
    card.classList.add('period-card--selected');
    selectedPeriod = parseInt(card.dataset.period);
    updateUI();
}

// ===== PAYMENT METHOD TAB SELECTION =====
function selectPayMethod(tab) {
    document.querySelectorAll('.pay-tab').forEach(t => t.classList.remove('pay-tab--active'));
    tab.classList.add('pay-tab--active');
    selectedPayMethod = tab.dataset.method;
    updateUI();
}

// ===== UPDATE UI =====
function updateUI() {
    const plan = plans[selectedPeriod];

    // Summary
    document.getElementById('totalPrice').textContent = plan.label;
    document.getElementById('totalStars').textContent = `или ${plan.starsLabel}`;

    // Savings
    const savingsEl = document.getElementById('savingsText');
    if (plan.savings) {
        savingsEl.textContent = plan.savings;
        savingsEl.style.display = 'block';
    } else {
        savingsEl.style.display = 'none';
    }

    // CTA Button text based on selected method
    const btn = document.getElementById('ctaBtn');
    const hint = document.getElementById('ctaHint');

    switch (selectedPayMethod) {
        case 'stars':
            btn.textContent = `⭐ Подписаться — ${plan.starsLabel}`;
            hint.textContent = 'Оплата через Telegram Stars ⭐';
            break;
        case 'wallet':
            btn.textContent = `👛 Подписаться — ${plan.label}`;
            hint.textContent = 'Оплата через Telegram Wallet 👛';
            break;
        case 'donationalerts':
            btn.textContent = `🔔 Подписаться — ${plan.label}`;
            hint.textContent = 'Оплата через DonationAlerts 🔔';
            break;
        case 'donatepay':
            btn.textContent = `💰 Подписаться — ${plan.label}`;
            hint.textContent = 'Оплата через DonatePay 💰';
            break;
    }
}

// ===== HANDLE SUBSCRIBE (opens modal) =====
function handleSubscribe() {
    openPayModal();
}

// ===== PAYMENT MODAL =====
function openPayModal() {
    const plan = plans[selectedPeriod];
    const modal = document.getElementById('payModal');

    // Fill modal data
    document.getElementById('modalPlanName').textContent = plan.periodName;
    document.getElementById('modalPlanPrice').textContent = `${plan.label} / ${plan.starsLabel}`;
    document.getElementById('modalStarsPrice').textContent = plan.starsLabel;
    document.getElementById('modalWalletPrice').textContent = plan.label;
    document.getElementById('modalDAPrice').textContent = plan.label;
    document.getElementById('modalDPPrice').textContent = plan.label;

    // Pre-select the method from tabs
    modalPayMethod = selectedPayMethod;
    document.querySelectorAll('.modal-method').forEach(m => {
        m.classList.toggle('modal-method--active', m.dataset.method === modalPayMethod);
    });
    updateModalBtn();

    // Show
    modal.classList.add('active');
    document.body.style.overflow = 'hidden';
}

function closePayModal() {
    const modal = document.getElementById('payModal');
    modal.classList.remove('active');
    document.body.style.overflow = '';
}

function selectModalMethod(el) {
    document.querySelectorAll('.modal-method').forEach(m => m.classList.remove('modal-method--active'));
    el.classList.add('modal-method--active');
    modalPayMethod = el.dataset.method;
    updateModalBtn();
}

function updateModalBtn() {
    const plan = plans[selectedPeriod];
    const btn = document.getElementById('modalPayBtn');

    switch (modalPayMethod) {
        case 'stars':
            btn.textContent = `⭐ Оплатить — ${plan.starsLabel}`;
            btn.style.background = 'linear-gradient(135deg, #f59e0b, #fbbf24)';
            break;
        case 'wallet':
            btn.textContent = `👛 Оплатить — ${plan.label}`;
            btn.style.background = 'linear-gradient(135deg, #3b82f6, #60a5fa)';
            btn.style.color = 'white';
            break;
        case 'donationalerts':
            btn.textContent = `🔔 Оплатить — ${plan.label}`;
            btn.style.background = 'linear-gradient(135deg, #f97316, #fb923c)';
            btn.style.color = 'white';
            break;
        case 'donatepay':
            btn.textContent = `💰 Оплатить — ${plan.label}`;
            btn.style.background = 'linear-gradient(135deg, #22c55e, #4ade80)';
            btn.style.color = '#1a1a1a';
            break;
    }
}

// ===== PROCESS PAYMENT =====
function processPayment() {
    const plan = plans[selectedPeriod];

    switch (modalPayMethod) {
        case 'stars':
            payWithStars(plan);
            break;
        case 'wallet':
            payWithWallet(plan);
            break;
        case 'donationalerts':
            payWithDA(plan);
            break;
        case 'donatepay':
            payWithDP(plan);
            break;
    }
}

// --- Telegram Stars ---
function payWithStars(plan) {
    try {
        if (window.Telegram && Telegram.WebApp) {
            Telegram.WebApp.sendData(JSON.stringify({
                type: 'subscribe',
                period: selectedPeriod,
                method: 'stars',
                amount: plan.stars,
            }));
            closePayModal();
            showSuccess(`Запрос отправлен! Оплатите ${plan.starsLabel} в боте.`);
            return;
        }
    } catch (e) {
        console.error('Telegram WebApp error:', e);
    }

    // Fallback
    closePayModal();
    showSuccess(
        `Для оплаты звёздами отправьте в бот:\n/subscribe ${selectedPeriod}\n\nСтоимость: ${plan.starsLabel}`
    );
}

// --- Telegram Wallet ---
function payWithWallet(plan) {
    try {
        if (window.Telegram && Telegram.WebApp) {
            Telegram.WebApp.sendData(JSON.stringify({
                type: 'subscribe',
                period: selectedPeriod,
                method: 'wallet',
                amount: plan.price,
            }));
            closePayModal();
            showSuccess(`Запрос отправлен! Проверьте бот для оплаты.`);
            return;
        }
    } catch (e) {
        console.error('Wallet error:', e);
    }

    closePayModal();
    showSuccess(
        `Для оплаты через Кошелёк отправьте в бот:\n/subscribe ${selectedPeriod}\n\nСтоимость: ${plan.label}`
    );
}

// --- DonationAlerts ---
function payWithDA(plan) {
    closePayModal();

    // Build DA link with comment for identification
    const comment = `SUB_${selectedPeriod}m`;
    const daUrl = `${DONATIONALERTS_URL}?amount=${plan.price}&message=${encodeURIComponent(comment)}`;

    showPaymentRedirect(
        '🔔 DonationAlerts',
        `Сумма: ${plan.label}\n\nВ комментарии к донату укажите:\n${comment}\n\nПосле оплаты подписка активируется автоматически!`,
        daUrl
    );
}

// --- DonatePay ---
function payWithDP(plan) {
    closePayModal();

    const comment = `SUB_${selectedPeriod}m`;
    const dpUrl = `${DONATEPAY_URL}?sum=${plan.price}&comment=${encodeURIComponent(comment)}`;

    showPaymentRedirect(
        '💰 DonatePay',
        `Сумма: ${plan.label}\n\nВ комментарии к донату укажите:\n${comment}\n\nПосле оплаты подписка активируется автоматически!`,
        dpUrl
    );
}

// ===== SUCCESS / REDIRECT MODALS =====
function showSuccess(message) {
    showOverlay('✅', 'Отлично!', message, null);
}

function showPaymentRedirect(title, message, url) {
    showOverlay('💳', title, message, url);
}

function showOverlay(emoji, title, message, url) {
    // Remove old overlays
    document.querySelectorAll('.result-overlay').forEach(el => el.remove());

    const overlay = document.createElement('div');
    overlay.className = 'result-overlay';
    overlay.style.cssText = `
        position: fixed; top: 0; left: 0; width: 100%; height: 100%;
        background: rgba(0,0,0,0.9); z-index: 20000;
        display: flex; align-items: center; justify-content: center;
        padding: 20px; animation: fadeInUp 0.3s ease;
    `;

    let btnHtml = '';
    if (url) {
        btnHtml = `
            <a href="${url}" target="_blank" rel="noopener" style="
                display: block; width: 100%; padding: 14px; border: none; border-radius: 12px;
                font-family: 'Russo One', sans-serif; font-size: 0.9rem;
                cursor: pointer; letter-spacing: 1px; text-align: center;
                background: linear-gradient(135deg, #C8AA6E, #E8D5A3);
                color: #0a0e14; text-decoration: none; margin-bottom: 10px;
            ">Перейти к оплате →</a>
        `;
    }

    overlay.innerHTML = `
        <div style="
            background: linear-gradient(145deg, #1a2332, #0f1520);
            border: 1px solid rgba(200,170,110,0.15);
            border-radius: 20px; padding: 28px 24px; max-width: 360px; width: 100%;
            text-align: center;
        ">
            <div style="font-size: 3rem; margin-bottom: 12px;">${emoji}</div>
            <div style="font-family: 'Russo One', sans-serif; font-size: 1.1rem; color: #E8E6E3; margin-bottom: 12px;">${title}</div>
            <div style="font-size: 0.8rem; color: #9AA4B5; line-height: 1.6; margin-bottom: 20px; white-space: pre-line;">${message}</div>
            ${btnHtml}
            <button onclick="this.closest('.result-overlay').remove()" style="
                width: 100%; padding: 12px; border: 1px solid rgba(255,255,255,0.1);
                border-radius: 12px; background: transparent; color: #9AA4B5;
                font-family: 'Inter', sans-serif; font-size: 0.8rem; cursor: pointer;
            ">Закрыть</button>
        </div>
    `;

    document.body.appendChild(overlay);
    overlay.addEventListener('click', (e) => {
        if (e.target === overlay) overlay.remove();
    });
}

// ===== CLOSE MODAL ON OVERLAY CLICK =====
document.getElementById('payModal').addEventListener('click', function (e) {
    if (e.target === this) closePayModal();
});

// ===== PARTICLES =====
(function createParticles() {
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
})();
