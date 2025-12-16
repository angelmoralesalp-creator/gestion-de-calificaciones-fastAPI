// main.js - Inicialización y variables globales
// elementos del DOM (se inicializan al cargar para evitar nulls)
let productForm, resultsContainer, modal, partialModal, searchBtn, seeAllBtn, accountForm, addPartialBtn, partialsListEl, partialInput, accountMenuBtn, accountMenu, loadingOverlay;

let currentProductToDelete = null;
authToken = localStorage.getItem('auth_token') || null;
let currentUser = null;
let currentPartials = [];
let editingPartialIndex = null;
let editingOriginalPartialName = null;
let periodHistory = {}; // Almacenar histórico de periodos
let products_db = {}; // Base de datos local de productos/clases
let lastGeneratedId = 0; // Rastrear el último ID generado en esta sesión

// Mantener comportamiento por defecto de `console.log` (sin override)

// Inicializar
document.addEventListener('DOMContentLoaded', function() {
    const saved = localStorage.getItem(THEME_KEY);
    if (saved === 'dark') applyTheme('dark'); else applyTheme('light');
    setupEventListeners();
    validateAndRestoreSession();
});

function setupEventListeners() {
    // obtener elementos del DOM aquí (asegura que existen)
    productForm = document.getElementById('productForm');
    resultsContainer = document.getElementById('results');
    modal = document.getElementById('modal');
    partialModal = document.getElementById('partialModal');
    loadingOverlay = document.getElementById('loadingOverlay');
    searchBtn = document.getElementById('searchBtn');
    seeAllBtn = document.getElementById('verTodosBtn');
    accountForm = document.getElementById('accountForm');
    addPartialBtn = document.getElementById('addPartialBtn');
    partialsListEl = document.getElementById('partialsList');
    partialInput = document.getElementById('itemPartial');
    accountMenuBtn = document.getElementById('accountMenuBtn');
    accountMenu = document.getElementById('accountMenu');

    if (productForm) productForm.addEventListener('submit', handleProductSubmit);
    if (searchBtn) searchBtn.addEventListener('click', searchProduct);
    if (seeAllBtn) seeAllBtn.addEventListener('click', loadAllProducts);
    
    const modalCancel = document.getElementById('modalCancel');
    const modalConfirm = document.getElementById('modalConfirm');
    
    if (modalCancel) {
        modalCancel.addEventListener('click', closeModal);
    }
    if (modalConfirm) {
        modalConfirm.addEventListener('click', confirmDelete);
    }
    
    // Cerrar modal al hacer clic fuera de él
    if (modal) {
        modal.addEventListener('click', function(e) {
            if (e.target === modal) {
                closeModal();
            }
        });
    }
    
    const themeToggle = document.getElementById('themeToggle');
    if (themeToggle) themeToggle.addEventListener('click', toggleTheme);
    if (accountForm) accountForm.addEventListener('submit', handleAccountSubmit);
    if (addPartialBtn) addPartialBtn.addEventListener('click', handleAddPartial);
    
    // Event listeners para penalizaciones, extras y comparación
    const addPenaltyBtn = document.getElementById('addPenaltyBtn');
    const addExtraBtn = document.getElementById('addExtraBtn');
    const periodComparison = document.getElementById('periodComparison');
    
    if (addPenaltyBtn) addPenaltyBtn.addEventListener('click', addPenalty);
    if (addExtraBtn) addExtraBtn.addEventListener('click', addExtra);
    if (periodComparison) periodComparison.addEventListener('change', handlePeriodComparison);
    
    // Menu de cuenta
    if (accountMenuBtn) accountMenuBtn.addEventListener('click', toggleAccountMenu);
    document.addEventListener('click', function(e) {
        if (!e.target.closest('.account-menu-wrapper')) {
            if (accountMenu && !accountMenu.classList.contains('hidden')) {
                accountMenu.classList.add('hidden');
            }
        }
    });

    // Botones del menú de cuenta
    const logoutBtn = document.getElementById('logoutBtn');

    if (logoutBtn) logoutBtn.addEventListener('click', () => {
        clearSession();
        showNotification('✅ Sesión cerrada', 'success');
        if (accountMenu) accountMenu.classList.add('hidden');
    });

    // Modal de parciales
    const partialModalCancel = document.getElementById('partialModalCancel');
    const partialModalSave = document.getElementById('partialModalSave');
    const addActivityBtn = document.getElementById('addActivityBtn');
    const partialMethod = document.getElementById('partialMethod');
    if (partialModalCancel) partialModalCancel.addEventListener('click', closePartialModal);
    if (partialModalSave) partialModalSave.addEventListener('click', savePartialModal);
    if (addActivityBtn) addActivityBtn.addEventListener('click', handleAddActivity);
    if (partialMethod) partialMethod.addEventListener('change', updateAndDisplayScore);
    // Botón para calcular esfuerzo (se añade si existe en el DOM)
    const calculateEffortBtn = document.getElementById('calculateEffortBtn');
    if (calculateEffortBtn) {
        calculateEffortBtn.addEventListener('click', () => {
            const activities = (currentPartials[editingPartialIndex] && currentPartials[editingPartialIndex].activities) || [];
            const partial = (currentPartials[editingPartialIndex]) || null;
            const maxScore = partial ? (Number(partial.max_score) || Number(partial.vpf_max) || 100) : 100;
            let result = null;
            try {
                result = calculateEffortEfficiency(activities, maxScore);
            } catch (e) {
                console.error('Error calculando esfuerzo:', e);
                showNotification('Error al calcular esfuerzo', 'error');
                return;
            }
            showEffortResult(result);
        });
    }

    if (partialModal) {
        partialModal.addEventListener('click', function(e) {
            if (e.target === partialModal) closePartialModal();
        });
    }

    const cancelEditBtn = document.getElementById('cancelEditBtn');
    if (cancelEditBtn) cancelEditBtn.addEventListener('click', cancelEdit);

    // Event delegation para botones de eliminar producto
    if (resultsContainer) {
        resultsContainer.addEventListener('click', function(e) {
            const deleteBtn = e.target.closest('.delete-product-btn');
            if (deleteBtn) {
                e.preventDefault();
                e.stopPropagation();
                const itemId = deleteBtn.getAttribute('data-item-id');
                if (itemId) {
                    deleteProductPrompt(itemId);
                }
            }
        });
    } else {
        console.warn('resultsContainer no encontrado en setupEventListeners');
    }
}

function toggleAccountMenu() {
    if (!accountMenu) return;
    accountMenu.classList.toggle('hidden');
}

async function validateAndRestoreSession() {
    // Cargar desde localStorage
    const token = localStorage.getItem('auth_token');
    const userRaw = localStorage.getItem('auth_user');
    if (!token || !userRaw) {
        updateUIForAuth(); // Asegurar que la UI esté en estado no logueado
        return;
    }

    showLoading(); // Mostrar pantalla de carga

    try {
        const user = JSON.parse(userRaw);
        // Setear provisionalmente para ocultar UI de login
        authToken = token;
        currentUser = user;
        updateUIForAuth(); // Ocultar formulario inmediatamente

        // Validar token con backend
        const res = await fetch(`${API_BASE_URL}/auth/me`, {
            headers: { 'Authorization': `Bearer ${token}` }
        });
        if (res.ok) {
            const freshUser = await res.json();
            currentUser = freshUser;
            localStorage.setItem('auth_user', JSON.stringify(freshUser)); // Actualizar con datos frescos
            updateUIForAuth(); // Actualizar con datos frescos si necesario
            loadAllProducts(); // Cargar productos si la sesión es válida
        } else if (res.status === 401) {
            // Token inválido, limpiar
            clearSession();
        } else {
            // Otro error (servidor down, etc.), mantener sesión provisional
            console.warn('No se pudo validar la sesión con el servidor, manteniendo sesión local');
            loadAllProducts(); // Intentar cargar productos de todas formas
        }
    } catch (e) {
        // Error de red, mantener sesión provisional
        console.error('Error de conexión al validar sesión:', e);
        console.warn('Manteniendo sesión local debido a error de conexión');
    } finally {
        hideLoading(); // Ocultar pantalla de carga
    }
}