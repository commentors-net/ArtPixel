// Theme Manager for Pixel Mission (Dark / Light mode)
(function() {
    // Immediately apply saved theme to documentElement to prevent flash of wrong theme
    const savedTheme = localStorage.getItem('pixel_theme') || 'dark';
    document.documentElement.setAttribute('data-theme', savedTheme);

    function updateThemeBtn() {
        const btn = document.getElementById('themeToggleBtn');
        if (!btn) return;
        const isLight = document.documentElement.getAttribute('data-theme') === 'light';
        btn.innerHTML = isLight ? '☀️ Light' : '🌙 Dark';
        btn.setAttribute('aria-label', isLight ? 'Switch to Dark Theme' : 'Switch to Light Theme');
        btn.title = isLight ? 'Switch to Dark Theme' : 'Switch to Light Theme';
    }

    window.toggleTheme = function() {
        const currentTheme = document.documentElement.getAttribute('data-theme') === 'light' ? 'light' : 'dark';
        const newTheme = currentTheme === 'light' ? 'dark' : 'light';
        document.documentElement.setAttribute('data-theme', newTheme);
        localStorage.setItem('pixel_theme', newTheme);
        updateThemeBtn();
        if (typeof window.onThemeChange === 'function') {
            window.onThemeChange(newTheme);
        }
    };

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', updateThemeBtn);
    } else {
        updateThemeBtn();
    }
})();
