// utils.js - Funciones de utilidad y configuración
const API_BASE_URL = 'http://127.0.0.1:8000';
const THEME_KEY = 'site-theme';

function applyTheme(theme) {
    if (theme === 'dark') {
        document.documentElement.setAttribute('data-theme', 'dark');
        const btn = document.getElementById('themeToggle');
        if (btn) btn.textContent = '☀️';
    } else {
        document.documentElement.removeAttribute('data-theme');
        const btn = document.getElementById('themeToggle');
        if (btn) btn.textContent = '🌙';
    }
    try {
        localStorage.setItem(THEME_KEY, theme);
    } catch (e) {}
}

function toggleTheme() {
    const current = localStorage.getItem(THEME_KEY) || 'light';
    const next = current === 'dark' ? 'light' : 'dark';
    applyTheme(next);
}

function showLoading() {
    if (loadingOverlay) loadingOverlay.classList.remove('hidden');
}

function hideLoading() {
    if (loadingOverlay) loadingOverlay.classList.add('hidden');
}

function showNotification(message, type = 'info') {
    const notification = document.createElement('div');
    notification.className = `notification ${type}`;
    notification.textContent = message;
    document.body.appendChild(notification);
    setTimeout(() => {
        if (notification.parentNode) {
            notification.parentNode.removeChild(notification);
        }
    }, 3000);
}

function getAuthHeader() {
    if (!authToken) return {};
    return { 'Authorization': `Bearer ${authToken}` };
}

function saveSession(token, user) {
    authToken = token;
    currentUser = user;
    try { localStorage.setItem('auth_token', token); } catch (e) {}
    try { localStorage.setItem('auth_user', JSON.stringify(user)); } catch (e) {}
    try { localStorage.setItem('last_email', user.email); } catch (e) {}
    try { localStorage.setItem('last_username', user.username); } catch (e) {}
    updateUIForAuth();
}

function clearSession() {
    authToken = null;
    currentUser = null;
    try { localStorage.removeItem('auth_token'); } catch (e) {}
    try { localStorage.removeItem('auth_user'); } catch (e) {}
    try { localStorage.removeItem('last_email'); } catch (e) {}
    try { localStorage.removeItem('last_username'); } catch (e) {}
    updateUIForAuth();
}

function updateUIForAuth() {
    const accountCard = document.getElementById('accountCard');
    const classCard = document.getElementById('classCard');
    const searchCard = document.getElementById('searchCard');
    const resultsCard = document.getElementById('resultsCard');
    const accountMenuBtn = document.getElementById('accountMenuBtn');
    const accountMenuHeader = document.getElementById('accountMenuHeader');

    if (currentUser && authToken) {
        if (accountCard) accountCard.classList.add('hidden');
        if (classCard) classCard.classList.remove('hidden');
        if (searchCard) searchCard.classList.remove('hidden');
        if (resultsCard) resultsCard.classList.remove('hidden');
        if (accountMenuBtn) accountMenuBtn.style.display = 'block';
        if (accountMenuHeader) accountMenuHeader.textContent = `👤 ${currentUser.username}`;
    } else {
        if (accountCard) accountCard.classList.remove('hidden');
        if (classCard) classCard.classList.add('hidden');
        if (searchCard) searchCard.classList.add('hidden');
        if (resultsCard) resultsCard.classList.add('hidden');
        if (accountMenuBtn) accountMenuBtn.style.display = 'none';
        // Rellenar email si hay uno guardado
        const lastEmail = localStorage.getItem('last_email');
        if (lastEmail) {
            const userMail = document.getElementById('userMail');
            if (userMail) userMail.value = lastEmail;
        }
        // Rellenar username si hay uno guardado
        const lastUsername = localStorage.getItem('last_username');
        if (lastUsername) {
            const userName = document.getElementById('userName');
            if (userName) userName.value = lastUsername;
        }
    }
}