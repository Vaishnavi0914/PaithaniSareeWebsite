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
    if (!headerTop && !isAdminAuthPage) {
        return;
    }

    const button = document.createElement('button');
    button.id = 'back-fab';
    button.type = 'button';
    button.className = isAdminAuthPage ? 'back-fab' : 'back-fab back-fab-header';
    button.setAttribute('aria-label', 'Go back');
    button.title = 'Back';
    button.innerHTML = '&#8592;';
    button.setAttribute('aria-label', 'Go back');

    const fallback = window.location.pathname.toLowerCase().includes('admin')
        ? 'admin-dashboard.html'
        : 'index.html';

    const goBack = () => {
        try {
            const referrer = document.referrer;
            if (referrer) {
                const refUrl = new URL(referrer);
                if (refUrl.origin === window.location.origin && window.history.length > 1) {
                    window.history.back();
                    return;
                }
            }
        } catch (err) {
            // ignore referrer parsing issues
        }
        if (window.history.length > 1) {
            window.history.back();
            return;
        }
        window.location.href = fallback;
    };

    button.addEventListener('click', goBack);
    if (isAdminAuthPage || !headerTop) {
        document.body.appendChild(button);
    } else {
        headerTop.appendChild(button);
    }

    const updateVisibility = () => {
        const hasHistory = window.history.length > 1;
        const hasReferrer = !!document.referrer;
        button.classList.toggle('is-hidden', !(hasHistory || hasReferrer));
    };

    updateVisibility();
    window.addEventListener('popstate', updateVisibility);
}

document.addEventListener('DOMContentLoaded', initBackButton);
