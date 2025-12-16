// Variables globales (copiadas de main.js)
authToken = localStorage.getItem('auth_token') || null;
let currentUser = null;
let pendingProfileImage = null;

// Inicializar
document.addEventListener('DOMContentLoaded', function() {
    const saved = localStorage.getItem('site-theme');
    if (saved === 'dark') applyTheme('dark'); else applyTheme('light');

    // Cargar datos del usuario
    loadUserData();

    // Event listeners
    setupEventListeners();
});

function setupEventListeners() {
    const themeToggle = document.getElementById('themeToggle');
    if (themeToggle) themeToggle.addEventListener('click', toggleTheme);

    const editForm = document.getElementById('editForm');
    if (editForm) editForm.addEventListener('submit', handleSave);

    const deleteAccountBtn = document.getElementById('deleteAccountBtn');
    if (deleteAccountBtn) deleteAccountBtn.addEventListener('click', handleDeleteAccount);

    const profilePhoto = document.getElementById('profilePhoto');
    if (profilePhoto) profilePhoto.addEventListener('change', handlePhotoChange);
}

async function loadUserData() {
    // Intentar cargar desde localStorage primero
    const raw = localStorage.getItem('auth_user');
    if (raw) {
        try {
            currentUser = JSON.parse(raw);
            displayUserData();
        } catch (e) {
            console.error('Error parsing user data:', e);
        }
    }

    // Si no hay token, redirigir
    if (!authToken) {
        window.location.href = 'index.html';
        return;
    }

    // Validar con backend
    try {
        const res = await fetch(`${API_BASE_URL}/auth/me`, {
            headers: getAuthHeader()
        });
        if (res.ok) {
            currentUser = await res.json();
            localStorage.setItem('auth_user', JSON.stringify(currentUser));
            displayUserData();
        } else {
            // Sesión expirada
            clearSession();
            window.location.href = 'index.html';
        }
    } catch (e) {
        showNotification('❌ Error conectando con el servidor', 'error');
    }
}

function displayUserData() {
    if (!currentUser) return;

    document.getElementById('displayName').textContent = currentUser.username || 'Sin nombre';
    document.getElementById('displayEmail').textContent = currentUser.email || 'Sin correo';

    // Mostrar imagen de perfil
    const profileImage = document.getElementById('profileImage');
    if (profileImage) {
        profileImage.src = currentUser.profile_image || 'data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iMTUwIiBoZWlnaHQ9IjE1MCIgdmlld0JveD0iMCAwIDE1MCAxNTAiIGZpbGw9Im5vbmUiIHhtbG5zPSJodHRwOi8vd3d3LnczLm9yZy8yMDAwL3N2ZyI+CjxyZWN0IHdpZHRoPSIxNTAiIGhlaWdodD0iMTUwIiBmaWxsPSIjRDBEMEQwIi8+Cjx0ZXh0IHg9Ijc1IiB5PSI3NSIgZm9udC1mYW1pbHk9IkFyaWFsLCBzYW5zLXNlcmlmIiBmb250LXNpemU9IjI0IiBmaWxsPSIjOTk5IiB0ZXh0LWFuY2hvcj0ibWlkZGxlIiBkeT0iMC4zZW0iPk5vIGltYWdlPC90ZXh0Pgo8L3N2Zz4=';
    }

    // Mostrar rol con estilo apropiado
    const roleElement = document.getElementById('displayRole');
    if (currentUser.is_admin) {
        roleElement.textContent = '[Administrador]';
        roleElement.classList.add('admin');
    } else {
        roleElement.textContent = 'Usuario';
        roleElement.classList.remove('admin');
    }

    // Foto de perfil ya se setea arriba con currentUser.profile_image

    // Rellenar formulario
    document.getElementById('editUsername').value = currentUser.username || '';
    document.getElementById('editEmail').value = currentUser.email || '';
}

function handlePhotoChange(event) {
    const file = event.target.files[0];
    if (file) {
        const reader = new FileReader();
        reader.onload = function(e) {
            const base64 = e.target.result;
            pendingProfileImage = base64;
            document.getElementById('profileImage').src = base64;
            showNotification('✅ Foto seleccionada, guarda los cambios para aplicar', 'success');
        };
        reader.readAsDataURL(file);
    }
}

async function handleSave(event) {
    event.preventDefault();

    const username = document.getElementById('editUsername').value.trim();
    const email = document.getElementById('editEmail').value.trim();
    const password = document.getElementById('editPassword').value;

    if (!username || !email) {
        showNotification('⚠️ Completa nombre y correo', 'warning');
        return;
    }

    showLoading();
    const updates = { username, email };
    if (password) updates.password = password;
    if (pendingProfileImage !== null) updates.profile_image = pendingProfileImage;

    try {
        const res = await fetch(`${API_BASE_URL}/auth/me`, {
            method: 'PATCH',
            headers: {
                'Content-Type': 'application/json',
                ...getAuthHeader()
            },
            body: JSON.stringify(updates)
        });
        if (res.ok) {
            const updated = await res.json();
            currentUser = updated;
            localStorage.setItem('auth_user', JSON.stringify(updated));
            displayUserData();
            pendingProfileImage = null; // Reset after save
            showNotification('✅ Cuenta actualizada', 'success');
            hideLoading();
        } else {
            const err = await res.json().catch(()=>({ detail: 'Error' }));
            showNotification(`❌ ${err.detail || 'Error'}`, 'error');
            hideLoading();
        }
    } catch (e) {
        showNotification(`❌ Error: ${e.message}`, 'error');
        hideLoading();
    }
}

async function handleDeleteAccount() {
    const confirmDelete = window.confirm('⚠️ ¿Estás seguro? Esto eliminará tu cuenta y todas tus clases.\n\nEsta acción NO se puede deshacer.');
    if (!confirmDelete) return;

    showLoading();
    try {
        const res = await fetch(`${API_BASE_URL}/auth/me`, {
            method: 'DELETE',
            headers: getAuthHeader()
        });
        if (res.ok) {
            clearSession();
            showNotification('✅ Cuenta eliminada', 'success');
            hideLoading();
            // Redirigir al index
            window.location.href = 'index.html';
        } else {
            const err = await res.json().catch(()=>({ detail: 'Error' }));
            showNotification(`❌ ${err.detail || 'Error'}`, 'error');
            hideLoading();
        }
    } catch (e) {
        showNotification(`❌ Error: ${e.message}`, 'error');
        hideLoading();
    }
}

function clearSession() {
    authToken = null;
    currentUser = null;
    localStorage.removeItem('auth_token');
    localStorage.removeItem('auth_user');
}

function goBack() {
    clearSession();
    window.location.href = 'index.html';
}