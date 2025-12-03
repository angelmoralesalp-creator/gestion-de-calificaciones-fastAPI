// Configuración de la API (puedes cambiar la URL según tu backend)
const API_BASE_URL = 'http://127.0.0.1:8000';

// Tema
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
    } catch (e) {
        /* ignorar */
    }
}

function toggleTheme() {
    const current = localStorage.getItem(THEME_KEY) || 'light';
    const next = current === 'dark' ? 'light' : 'dark';
    applyTheme(next);
}

const productForm = document.getElementById('productForm');
const resultsContainer = document.getElementById('results');
const modal = document.getElementById('modal');
const searchBtn = document.getElementById('searchBtn');
const seeAllBtn = document.getElementById('verTodosBtn');
const accountForm = document.getElementById('accountForm');
const addPartialBtn = document.getElementById('addPartialBtn');
const partialsListEl = document.getElementById('partialsList');
const partialInput = document.getElementById('itemPartial');

let currentProductToDelete = null;
let authToken = localStorage.getItem('auth_token') || null;
let currentUser = null;
let currentPartials = [];

// Inicializar
document.addEventListener('DOMContentLoaded', function() {
    const saved = localStorage.getItem(THEME_KEY);
    if (saved === 'dark') applyTheme('dark'); else applyTheme('light');
    setupEventListeners();
    validateAndRestoreSession(); // esto llama a updateUIForAuth() al final
});

function setupEventListeners() {
    if (productForm) productForm.addEventListener('submit', handleProductSubmit);
    if (searchBtn) searchBtn.addEventListener('click', searchProduct);
    if (seeAllBtn) seeAllBtn.addEventListener('click', loadAllProducts);
    const modalCancel = document.getElementById('modalCancel');
    const modalConfirm = document.getElementById('modalConfirm');
    if (modalCancel) modalCancel.addEventListener('click', closeModal);
    if (modalConfirm) modalConfirm.addEventListener('click', confirmDelete);
    if (modal) modal.addEventListener('click', function(e) {
        if (e.target === modal) closeModal();
    });
    const themeToggle = document.getElementById('themeToggle');
    if (themeToggle) themeToggle.addEventListener('click', toggleTheme);
    if (accountForm) accountForm.addEventListener('submit', handleAccountSubmit);
    if (addPartialBtn) addPartialBtn.addEventListener('click', handleAddPartial);
}

// Helpers de auth
function getAuthHeader() {
    if (!authToken) return {};
    return { 'Authorization': `Bearer ${authToken}` };
}

function saveSession(token, user) {
    authToken = token;
    currentUser = user;
    try { localStorage.setItem('auth_token', token); } catch (e) {}
    try { localStorage.setItem('auth_user', JSON.stringify(user)); } catch (e) {}
    renderUserPanel();
    updateUIForAuth();
}

function clearSession() {
    authToken = null;
    currentUser = null;
    try { localStorage.removeItem('auth_token'); } catch (e) {}
    try { localStorage.removeItem('auth_user'); } catch (e) {}
    removeUserPanel();
    updateUIForAuth();
}

// Validar que el token sea válido antes de restaurar sesión
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
            renderUserPanel();
        } else {
            // Token inválido o expirado
            clearSession();
        }
    } catch (e) {
        // Error de conexión — mantener token por si el servidor no está disponible
        try {
            const raw = localStorage.getItem('auth_user');
            if (raw) currentUser = JSON.parse(raw);
        } catch (e2) { currentUser = null; }
        if (currentUser) renderUserPanel();
    }
    
    updateUIForAuth();
    if (authToken && currentUser) loadAllProducts();
}

function updateUIForAuth() {
    const accountCard = document.getElementById('accountCard');
    const classCard = document.getElementById('classCard');
    const searchCard = document.getElementById('searchCard');
    const resultsCard = document.getElementById('resultsCard');

    if (currentUser && authToken) {
        // Usuario autenticado: mostrar menú de clases, ocultar inicio/registro
        if (accountCard) accountCard.classList.add('hidden');
        if (classCard) classCard.classList.remove('hidden');
        if (searchCard) searchCard.classList.remove('hidden');
        if (resultsCard) resultsCard.classList.remove('hidden');
    } else {
        // No autenticado: mostrar inicio/registro, ocultar menú de clases
        if (accountCard) accountCard.classList.remove('hidden');
        if (classCard) classCard.classList.add('hidden');
        if (searchCard) searchCard.classList.add('hidden');
        if (resultsCard) resultsCard.classList.add('hidden');
    }
}

// Manejo del formulario de cuenta: comprobar, registrar o iniciar sesión
async function handleAccountSubmit(e) {
    e.preventDefault();
    const username = document.getElementById('userName').value.trim();
    const email = document.getElementById('userMail').value.trim();
    const password = document.getElementById('userPassword').value;

    if (!username || !email || !password) {
        showNotification('⚠️ Completa todos los campos', 'warning');
        return;
    }

    try {
        // 1) Comprobar existencia de username
        const checkRes = await fetch(`${API_BASE_URL}/auth/check/${encodeURIComponent(username)}`);
        if (!checkRes.ok) {
            showNotification('❌ Error al verificar usuario', 'error');
            return;
        }
        const checkData = await checkRes.json();
        if (checkData.exists) {
            // Intentar login
            const loginRes = await fetch(`${API_BASE_URL}/auth/login`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
                body: JSON.stringify({ username_or_email: username, password })
            });
            if (!loginRes.ok) {
                const err = await loginRes.json().catch(()=>({ detail: 'Credenciales inválidas' }));
                showNotification(`❌ Inicio de sesión fallido: ${err.detail || 'Error'}`, 'error');
                return;
            }
            const loginData = await loginRes.json();
            saveSession(loginData.access_token, loginData.user);
            showNotification(`✅ Sesión iniciada como ${loginData.user.username}`, 'success');
            accountForm.reset();
            loadAllProducts();
        } else {
            // Registrar y usar respuesta para iniciar sesión automáticamente
            const regRes = await fetch(`${API_BASE_URL}/auth/register`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
                body: JSON.stringify({ username, email, password })
            });
            if (!regRes.ok) {
                // intentar leer detalle de error
                const err = await regRes.json().catch(()=>({ detail: 'Error al registrar' }));
                showNotification(`❌ Registro fallido: ${err.detail || 'Error'}`, 'error');
                return;
            }

            // Procesar respuesta: puede devolver TokenResponse (access_token + user)
            const regData = await regRes.json();

            // Caso ideal: register devuelve token y user
            if (regData && regData.access_token && regData.user) {
                saveSession(regData.access_token, regData.user);
                showNotification(`✅ Usuario ${regData.user.username} registrado e inició sesión`, 'success');
                accountForm.reset();
                loadAllProducts();
                return;
            }

            // Fallback: si register no devuelve token por alguna razón, intentar login automáticamente
            // (esto cubre APIs que devuelven solo UserResponse)
            try {
                const loginRes2 = await fetch(`${API_BASE_URL}/auth/login`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
                    body: JSON.stringify({ username_or_email: username, password })
                });
                if (loginRes2.ok) {
                    const loginData2 = await loginRes2.json();
                    saveSession(loginData2.access_token, loginData2.user);
                    showNotification(`✅ Usuario ${loginData2.user.username} registrado e inició sesión`, 'success');
                    accountForm.reset();
                    loadAllProducts();
                    return;
                } else {
                    const err2 = await loginRes2.json().catch(()=>({ detail: 'Error al iniciar sesión' }));
                    showNotification(`⚠️ Registrado pero no se pudo iniciar sesión automáticamente: ${err2.detail || ''}`, 'warning');
                }
            } catch (_) {
                showNotification('⚠️ Registrado pero no se pudo iniciar sesión automáticamente (error de conexión)', 'warning');
            }
        }
    } catch (error) {
        showNotification(`❌ Error de conexión: ${error.message}`, 'error');
    }
}

// Crear/Actualizar clase (sin costo, is_offer opcional)
async function handleProductSubmit(e) {
    e.preventDefault();

    if (!authToken || !currentUser) {
        showNotification('🔒 Debes iniciar sesión para crear o modificar clases', 'warning');
        return;
    }

    const itemId = document.getElementById('itemId').value;
    const itemName = document.getElementById('itemName').value.trim();
    const itemOfferCheckbox = document.getElementById('itemOffer');
    const itemOffer = itemOfferCheckbox ? itemOfferCheckbox.checked : false;

    if (!itemId || !itemName) {
        showNotification('⚠️ Completa ID y nombre', 'warning');
        return;
    }

    const productData = {
        name: itemName,
        is_offer: itemOffer,
        partials: currentPartials.slice(),
        price: 0.0  // siempre enviar 0.0 ya que no hay campo de precio
    };

    try {
        const headers = Object.assign({ 'Content-Type': 'application/json' }, getAuthHeader());
        const response = await fetch(`${API_BASE_URL}/items/${itemId}`, {
            method: 'PUT',
            headers,
            body: JSON.stringify(productData)
        });
        if (response.ok) {
            showNotification('✅ Clase guardada exitosamente!', 'success');
            productForm.reset();
            currentPartials = [];
            renderPartials();
            loadAllProducts();
        } else {
            const error = await response.json().catch(()=>({ detail: 'Error' }));
            showNotification(`❌ Error: ${error.detail || 'Error'}`, 'error');
        }
    } catch (error) {
        showNotification(`❌ Error de conexión: ${error.message}`, 'error');
    }
}

// Buscar clase
async function searchProduct() {
    const itemId = document.getElementById('searchId').value;
    const query = document.getElementById('searchQuery').value;
    if (!itemId) {
        showNotification('⚠️ Por favor ingresa un ID de clase', 'warning');
        return;
    }
    try {
        const headers = getAuthHeader();
        let url = `${API_BASE_URL}/items/${itemId}`;
        const response = await fetch(url, { headers });
        if (response.ok) {
            const product = await response.json();
            displayProducts([product], `Clase ID: ${itemId}`);
        } else if (response.status === 404) {
            showNotification(`❌ Clase con ID ${itemId} no encontrada`, 'error');
            resultsContainer.innerHTML = '<p class="placeholder">Clase no encontrada</p>';
        } else {
            const error = await response.json();
            showNotification(`❌ Error: ${error.detail}`, 'error');
        }
    } catch (error) {
        showNotification(`❌ Error de conexión: ${error.message}`, 'error');
    }
}

// Cargar todas las clases visibles del usuario (o todas si admin)
async function loadAllProducts() {
    if (!authToken) {
        showNotification('🔒 Inicia sesión para ver tus clases', 'warning');
        return;
    }
    try {
        const response = await fetch(`${API_BASE_URL}/items/`, { headers: getAuthHeader() });
        if (response.ok) {
            const data = await response.json();
            if (data.items && data.items.length > 0) {
                displayProducts(data.items, `Mis clases (${data.total})`);
            } else {
                resultsContainer.innerHTML = '<p class="placeholder">No hay clases guardadas</p>';
            }
        } else {
            showNotification('❌ Error al cargar clases', 'error');
        }
    } catch (error) {
        showNotification(`❌ Error de conexión: ${error.message}`, 'error');
    }
}

// Renderizar clases (sin costo)
function displayProducts(products, title) {
    let html = `<h3>${title}</h3><div class="products-grid">`;
    products.forEach(product => {
        const isOwner = currentUser && product.owner && (currentUser.username === product.owner || currentUser.is_admin);
        // show partials
        const partialsHtml = (product.partials && product.partials.length) ? `<ul class="partials-list">${product.partials.map(p => `<li>${p.name || 'Parcial'}</li>`).join('')}</ul>` : '';
        html += `
            <div class="product-card">
                <div class="product-header">
                    <h4>${product.name}</h4>
                    <span class="product-id">ID: ${product.item_id}</span>
                </div>
                <div class="product-owner">Propietario: ${product.owner || '—'}</div>
                ${partialsHtml}
                <div class="product-actions">
                    ${isOwner ? `<button onclick="editProduct(${product.item_id}, '${escapeHtml(product.name)}', ${product.is_offer}, ${encodeURIComponent(JSON.stringify(product.partials || []))})" class="btn btn-sm btn-secondary">✏️ Editar</button>` : ''}
                    ${isOwner ? `<button onclick="deleteProduct(${product.item_id})" class="btn btn-sm btn-danger">🗑️ Eliminar</button>` : ''}
                </div>
            </div>
        `;
    });
    html += '</div>';
    resultsContainer.innerHTML = html;
}

// Simple escape para nombre al inyectar en onclick
function escapeHtml(str) {
    return String(str).replace(/'/g, "\\'").replace(/"/g, '&quot;');
}

// Editar clase (sin is_offer)
function editProduct(id, name, partialsEncoded) {
    document.getElementById('itemId').value = id;
    document.getElementById('itemName').value = name;
    try {
        const decoded = decodeURIComponent(partialsEncoded);
        const parsed = JSON.parse(decoded);
        currentPartials = parsed || [];
    } catch {
        currentPartials = [];
    }
    renderPartials();
    document.querySelector('.form-section').scrollIntoView({ behavior: 'smooth' });
    showNotification('📝 Datos cargados para edición', 'info');
}

// Eliminar clase
function deleteProduct(id) {
    if (!authToken || !currentUser) {
        showNotification('🔒 Debes iniciar sesión para eliminar clases', 'warning');
        return;
    }
    currentProductToDelete = id;
    document.getElementById('modalTitle').textContent = 'Confirmar Eliminación';
    document.getElementById('modalMessage').textContent = `¿Estás seguro de que quieres eliminar la clase con ID ${id}?`;
    modal.style.display = 'flex';
}

async function confirmDelete() {
    if (!currentProductToDelete) return;
    try {
        const headers = getAuthHeader();
        const response = await fetch(`${API_BASE_URL}/items/${currentProductToDelete}`, { method: 'DELETE', headers });
        if (response.ok) {
            showNotification('✅ Clase eliminada exitosamente!', 'success');
            loadAllProducts();
        } else {
            const error = await response.json().catch(()=>({ detail: 'Error' }));
            showNotification(`❌ Error: ${error.detail || 'Error'}`, 'error');
        }
    } catch (error) {
        showNotification(`❌ Error de conexión: ${error.message}`, 'error');
    } finally {
        closeModal();
        currentProductToDelete = null;
    }
}

function closeModal() {
    modal.style.display = 'none';
    currentProductToDelete = null;
}

function showNotification(message, type = 'info') {
    const existingNotification = document.querySelector('.notification');
    if (existingNotification) existingNotification.remove();
    const notification = document.createElement('div');
    notification.className = `notification notification-${type}`;
    notification.textContent = message;
    document.body.appendChild(notification);
    setTimeout(() => notification.classList.add('show'), 100);
    setTimeout(() => {
        notification.classList.remove('show');
        setTimeout(() => notification.remove(), 300);
    }, 3000);
}

// Renderiza el panel de usuario en el header (llamado por saveSession y validateAndRestoreSession)
function renderUserPanel(){
    const header = document.getElementById('headerRight');
    if(!header) return;
    // Evitar duplicados
    let existing = document.getElementById('headerUserPanel');
    if(existing) existing.remove();

    const panel = document.createElement('div');
    panel.id = 'headerUserPanel';
    panel.className = 'user-panel';
    const nameSpan = document.createElement('span');
    nameSpan.className = 'user-name';
    nameSpan.textContent = (currentUser && currentUser.username) ? currentUser.username : 'Usuario';
    const emailSpan = document.createElement('span');
    emailSpan.className = 'user-email';
    emailSpan.style.opacity = '0.8';
    emailSpan.style.fontSize = '0.9rem';
    if(currentUser && currentUser.email) emailSpan.textContent = `(${currentUser.email})`;

    const logoutBtn = document.createElement('button');
    logoutBtn.className = 'btn btn-sm';
    logoutBtn.style.marginLeft = '0.6rem';
    logoutBtn.textContent = 'Cerrar sesión';
    logoutBtn.addEventListener('click', () => {
        clearSession();
        showNotification('✅ Sesión cerrada', 'info');
    });

    panel.appendChild(nameSpan);
    if(emailSpan.textContent) panel.appendChild(emailSpan);
    panel.appendChild(logoutBtn);
    header.appendChild(panel);
}

// Remueve el panel de usuario del header (llamado por clearSession)
function removeUserPanel(){
    const existing = document.getElementById('headerUserPanel');
    if(existing) existing.remove();
}