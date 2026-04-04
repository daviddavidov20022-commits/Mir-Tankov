(function() {
    const originalFetch = window.fetch;
    window.fetch = async function() {
        let [resource, config] = arguments;
        
        if (typeof resource === 'string' && resource.includes('/api/')) {
            config = config || {};
            config.headers = config.headers || {};
            
            const tmaData = window.Telegram?.WebApp?.initData;
            
            if (tmaData) {
                if (config.headers instanceof Headers) {
                    config.headers.set('X-Telegram-Init-Data', tmaData);
                } else if (Array.isArray(config.headers)) {
                    config.headers.push(['X-Telegram-Init-Data', tmaData]);
                } else {
                    config.headers['X-Telegram-Init-Data'] = tmaData;
                }
            } else if (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1') {
                const manuallyPassed = new URLSearchParams(window.location.search).get('telegram_id');
                if (manuallyPassed) {
                   if (config.headers instanceof Headers) {
                        config.headers.set('X-Local-Dev-Tg-Id', manuallyPassed);
                    } else if (!Array.isArray(config.headers)) {
                        config.headers['X-Local-Dev-Tg-Id'] = manuallyPassed;
                    } 
                }
            }
        }
        
        return originalFetch(resource, config);
    };
})();
