// auth.js - Funciones de autenticación y gestión de cuenta

// Helpers de auth (definidas en utils.js)

async function validateAndRestoreSession() {
    if (!authToken) {
        updateUIForAuth();
        return;
    }
    
    try {
        const res = await fetch(`${API_BASE_URL}/auth/me`, {
            headers: { 'Authorization': `Bearer ${authToken}` }
        });
        if (res.ok) {
            const user = await res.json();
            currentUser = user;
            try { localStorage.setItem('auth_user', JSON.stringify(user)); } catch (e) {}
        } else {
            clearSession();
        }
    } catch (e) {
        try {
            const raw = localStorage.getItem('auth_user');
            if (raw) currentUser = JSON.parse(raw);
        } catch (e2) { currentUser = null; }
    }
    
    updateUIForAuth();
    if (authToken && currentUser) loadAllProducts();
}

async function handleAccountSubmit(e) {
    e.preventDefault();
    const username = document.getElementById('userName').value.trim();
    const email = document.getElementById('userMail').value.trim();
    const password = document.getElementById('userPassword').value;

    if (!email || !password) {
        showNotification('⚠️ Ingresa correo y contraseña', 'warning');
        return;
    }

    try {
        // Verificar si el email existe (intenta login)
        const loginRes = await fetch(`${API_BASE_URL}/auth/login`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ email, password })
        });
        
        if (loginRes.ok) {
            // Login exitoso
            const loginData = await loginRes.json();
            saveSession(loginData.access_token, loginData.user);
            showNotification(`✅ Sesión iniciada como ${loginData.user.username}`, 'success');
            if (accountForm) accountForm.reset();
            loadAllProducts();
            return;
        }
        
        // Si el login falló, intenta registrar (requiere nombre de usuario)
        if (!username) {
            showNotification('⚠️ Para registrarse, ingresa un nombre de usuario', 'warning');
            return;
        }
        
        const regRes = await fetch(`${API_BASE_URL}/auth/register`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ username, email, password })
        });
        
        if (!regRes.ok) {
            const err = await regRes.json().catch(()=>({ detail: 'Error al registrar' }));
            showNotification(`❌ ${err.detail || 'Error'}`, 'error');
            return;
        }
        
        const regData = await regRes.json();
        if (regData && regData.access_token && regData.user) {
            saveSession(regData.access_token, regData.user);
            showNotification(`✅ Usuario registrado e inició sesión`, 'success');
            if (accountForm) accountForm.reset();
            loadAllProducts();
        }
    } catch (error) {
        showNotification(`❌ Error: ${error.message}`, 'error');
    }
}