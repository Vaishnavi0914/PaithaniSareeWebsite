function initBackButton() {
    if (document.getElementById('back-fab')) return;

    const path = window.location.pathname.toLowerCase();
    if (path.endsWith('/') || path.endsWith('/index.html') || path === '/index.html') {
        return;
    }

    const isAdminAuthPage = path.endsWith('/admin-login.html')
        || path.endsWith('admin-login.html')
        || path.endsWith('/admin-forgot-password.html')
        || path.endsWith('admin-forgot-password.html')
        || path.endsWith('/admin-reset-password.html')
        || path.endsWith('admin-reset-password.html');
    const headerTop = document.querySelector('.header-top');
    const headerMain = document.querySelector('.header-main');
    const headerAnchor = headerTop || headerMain;

    const button = document.createElement('button');
    button.id = 'back-fab';
    button.type = 'button';
    button.className = isAdminAuthPage ? 'back-fab' : 'back-fab back-fab-header';
    button.setAttribute('aria-label', 'Go back');
    button.title = 'Back';
    button.innerHTML = '<span class="back-fab-icon" aria-hidden="true"></span>';
    button.setAttribute('aria-label', 'Go back');

    const fallback = window.location.pathname.toLowerCase().includes('admin')
        ? 'admin-dashboard.html'
        : 'index.html';

    const goBack = () => {
        const currentPath = window.location.pathname + window.location.search + window.location.hash;
        let usedHistory = false;
        try {
            const referrer = document.referrer;
            if (referrer) {
                const refUrl = new URL(referrer);
                if (refUrl.origin === window.location.origin && window.history.length > 1) {
                    window.history.back();
                    usedHistory = true;
                }
            }
        } catch (err) {
            // ignore referrer parsing issues
        }
        if (!usedHistory && window.history.length > 1) {
            window.history.back();
            usedHistory = true;
        }
        if (!usedHistory) {
            window.location.href = fallback;
            return;
        }
        // If history navigation doesn't change the page, fallback to home.
        setTimeout(() => {
            const nextPath = window.location.pathname + window.location.search + window.location.hash;
            if (nextPath === currentPath) {
                window.location.href = fallback;
            }
        }, 300);
    };

    button.addEventListener('click', goBack);
    document.body.appendChild(button);

    // Always show the back button for a consistent UI
    button.classList.remove('is-hidden');
}

document.addEventListener('DOMContentLoaded', initBackButton);
