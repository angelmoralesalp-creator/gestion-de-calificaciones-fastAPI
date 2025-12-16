// products.js - Funciones para gestión de productos/clases
async function handleProductSubmit(e) {
    e.preventDefault();
    let itemIdRaw = String(document.getElementById('itemId')?.value || '').trim();
    const itemName = String(document.getElementById('itemName')?.value || '').trim();

    // Si no hay nombre, pedir que lo complete
    if (!itemName) {
        showNotification('⚠️ Completa el nombre de la clase', 'warning');
        return;
    }
    
    // Si no hay ID, generar uno automáticamente
    if (!itemIdRaw) {
        try {
            itemIdRaw = String(await getNextAvailableId());
            lastGeneratedId = parseInt(itemIdRaw, 10);
            document.getElementById('itemId').value = itemIdRaw;
            showNotification('📝 ID generado automáticamente: ' + itemIdRaw, 'info');
        } catch (err) {
            console.error('Error generando ID:', err);
            showNotification('❌ Error al generar ID automáticamente', 'error');
            return;
        }
    }
    
    if (!authToken || !currentUser) {
        showNotification('🔒 Debes iniciar sesión', 'warning');
        return;
    }

    const itemId = parseInt(itemIdRaw, 10);
    if (isNaN(itemId) || itemId <= 0) {
        showNotification('⚠️ ID inválido', 'warning');
        return;
    }

    const productData = {
        name: itemName,
        price: 0.0,
        is_offer: false,
        partials: currentPartials.map(p => ({
            name: p.name,
            max_score: p.max_score || 100,
            evaluation_method: p.evaluation_method || 'promedio',
            vpf_max: typeof p.vpf_max !== 'undefined' ? p.vpf_max : (p.max_score || 100),
            vpf: p.vpf || 0,
            activities: p.activities || []
        }))
    };

    try {
        const res = await fetch(`${API_BASE_URL}/items/${itemId}`, {
            method: 'PUT',
            headers: Object.assign({ 'Content-Type': 'application/json' }, getAuthHeader()),
            body: JSON.stringify(productData)
        });
        
        if (!res.ok) {
            const err = await res.json().catch(()=>({ detail: 'Error al guardar clase' }));
            showNotification(`❌ ${err.detail || 'Error al guardar clase'}`, 'error');
            return;
        }
        
        showNotification('✅ Clase guardada', 'success');
        loadAllProducts();
    } catch (e) {
        showNotification(`❌ Error: ${e.message}`, 'error');
    }
}

async function searchProduct() {
    const itemId = String(document.getElementById('searchId')?.value || '').trim();
    if (!itemId) {
        showNotification('⚠️ Ingresa un ID', 'warning');
        return;
    }
    if (!authToken) {
        showNotification('🔒 Inicia sesión', 'warning');
        return;
    }
    try {
        const res = await fetch(`${API_BASE_URL}/items/${encodeURIComponent(itemId)}`, {
            headers: getAuthHeader()
        });
        if (!res.ok) {
            const err = await res.json().catch(()=>({ detail: 'Clase no encontrada' }));
            showNotification(`❌ ${err.detail || 'Clase no encontrada'}`, 'error');
            return;
        }
        const prod = await res.json();
        displayProducts([prod], `Clase ID: ${itemId}`);
    } catch (e) {
        showNotification(`❌ Error: ${e.message}`, 'error');
    }
}

async function loadAllProducts() {
    if (!authToken) {
        if (resultsContainer) resultsContainer.innerHTML = '<p class="placeholder">Inicia sesión para ver tus clases</p>';
        return;
    }
    try {
        const res = await fetch(`${API_BASE_URL}/items/`, { headers: getAuthHeader() });
        if (!res.ok) {
            const err = await res.json().catch(()=>({ detail: 'Error al cargar clases' }));
            showNotification(`❌ ${err.detail || 'Error al cargar clases'}`, 'error');
            if (resultsContainer) resultsContainer.innerHTML = '<p class="placeholder">Error al cargar clases</p>';
            return;
        }
        const data = await res.json();
        if (!data || !Array.isArray(data.items) || data.items.length === 0) {
            if (resultsContainer) resultsContainer.innerHTML = '<p class="placeholder">No tienes clases aún</p>';
            return;
        }
        displayProducts(data.items, `Mis clases (${data.total || data.items.length})`);
    } catch (e) {
        showNotification(`❌ Error: ${e.message}`, 'error');
    }
}

// Cargar todos los IDs existentes del usuario desde el servidor
async function loadExistingIds() {
    if (!authToken || !currentUser) return [];
    
    try {
        const response = await fetch(`${API_BASE_URL}/items/`, {
            headers: getAuthHeader()
        });
        
        if (!response.ok) {
            console.error('Error cargando IDs existentes:', response.status);
            return [];
        }
        
        const data = await response.json();
        const ids = (data.items || [])
            .map(item => parseInt(item.item_id, 10))
            .filter(id => !isNaN(id) && id > 0);
        
        return ids;
    } catch (e) {
        console.error('Error cargando IDs existentes:', e);
        return [];
    }
}

// Encontrar el siguiente ID disponible
async function getNextAvailableId() {
    try {
        const existingIds = await loadExistingIds();
        const maxFromServer = existingIds.length > 0 ? Math.max(...existingIds) : 0;
        const maxId = Math.max(maxFromServer, lastGeneratedId);
        return maxId + 1;
    } catch (e) {
        console.error('Error en getNextAvailableId:', e);
        // En caso de error, usar lastGeneratedId como fallback
        return lastGeneratedId + 1;
    }
}

function displayProducts(products, title = 'Resultados') {
    if (!products || products.length === 0) {
        resultsContainer.innerHTML = '<p class="placeholder">No hay resultados</p>';
        return;
    }

    let html = `<div style="margin-bottom: 1rem;"><h3 style="margin: 0; color: var(--primary);">${title}</h3></div>`;
    html += '<div class="products-grid">';

    products.forEach(product => {
        const partialsText = product.partials && product.partials.length > 0
            ? product.partials.map(p => p.name || p).join(', ')
            : 'Sin parciales';

        // Calcular promedio de todos los parciales
        let averageScore = 0;
        if (product.partials && product.partials.length > 0) {
            const totalVPF = product.partials.reduce((sum, p) => sum + (p.vpf || 0), 0);
            averageScore = totalVPF / product.partials.length;
        }
        
        // Determinar color basado en el promedio (usando 80% del máximo como excelente, 60% como aceptable)
        let scoreColor = '#9fb3d6'; // gris (sin calificación)
        if (averageScore > 0) {
            if (averageScore >= 80) scoreColor = '#4CAF50'; // verde
            else if (averageScore >= 60) scoreColor = '#FF9800'; // naranja
            else scoreColor = '#F44336'; // rojo
        }

        html += `
            <div class="product-card">
                <div class="product-header">
                    <h4>${product.name}</h4>
                    <small class="product-owner">ID: ${product.item_id}</small>
                </div>
                <small style="color: var(--muted);">Propietario: ${product.owner}</small>
                <div style="margin: 0.5rem 0; font-size: 0.9rem;">
                    <strong>Parciales:</strong> ${partialsText}
                </div>
                <div style="margin: 0.8rem 0; padding: 0.6rem; background: rgba(0,0,0,0.05); border-radius: 6px; text-align: center;">
                    <div style="font-size: 0.85rem; color: var(--muted);">Promedio General</div>
                    <div style="font-size: 1.3rem; font-weight: bold; color: ${scoreColor};">${averageScore > 0 ? averageScore.toFixed(2) : '—'}</div>
                </div>
                <div class="product-actions">
                    <button type="button" class="btn btn-sm btn-info" onclick="editProduct(${product.item_id})">✏️ Editar</button>
                    <button type="button" class="btn btn-sm btn-danger delete-product-btn" data-item-id="${product.item_id}" ${(!currentUser || product.owner !== (currentUser && currentUser.username)) ? 'disabled title="Inicia sesión o no eres el propietario"' : ''}>🗑️ Eliminar</button>
                </div>
            </div>
        `;
    });

    html += '</div>';
    resultsContainer.innerHTML = html;
}

function editProduct(itemId) {
    document.getElementById('itemId').value = itemId;
    
    const productCard = Array.from(document.querySelectorAll('.product-card')).find(el => 
        el.textContent.includes(`ID: ${itemId}`)
    );
    
    if (productCard) {
        const name = productCard.querySelector('h4')?.textContent || '';
        document.getElementById('itemName').value = name;
    }
    
    loadEditingPartials(itemId);
    
    window.scrollTo({ top: 0, behavior: 'smooth' });
    showNotification('✏️ Edita los datos y guarda', 'info');
}

async function loadEditingPartials(itemId) {
    if (!authToken) return;
    
    try {
        const res = await fetch(`${API_BASE_URL}/items/${encodeURIComponent(itemId)}`, { 
            headers: getAuthHeader() 
        });
        
        if (res.ok) {
            const data = await res.json();
            currentPartials = data.partials || [];
            renderPartials();
        }
    } catch (e) {
        console.warn('Error cargando parciales para editar:', e);
        currentPartials = [];
        renderPartials();
    }
}

function deleteProductPrompt(itemId) {
    try {
        // Si no hay sesión activa, evitar abrir el modal
        if (!authToken || !currentUser) {
            showNotification('🔒 Debes iniciar sesión para eliminar', 'warning');
            return;
        }
        currentProductToDelete = itemId;
        const modal = document.getElementById('modal');
        const modalTitle = document.getElementById('modalTitle');
        const modalMessage = document.getElementById('modalMessage');
        
        if (modalTitle) modalTitle.textContent = 'Eliminar Clase';
        if (modalMessage) modalMessage.textContent = `¿Estás seguro de eliminar la clase con ID ${itemId}? Esta acción no se puede deshacer.`;
        
        if (modal) {
            modal.classList.remove('hidden');
            modal.setAttribute('aria-hidden', 'false');
            modal.style.display = 'flex';
        }
    } catch (e) {
        console.error('Error en deleteProductPrompt:', e);
        showNotification('❌ Error al abrir diálogo de eliminación', 'error');
    }
}

// Compatibilidad: algunos templates usan `onclick="deleteProduct(id)"`.
// Redirige a la misma lógica que `deleteProductPrompt`.
function deleteProduct(id) {
    deleteProductPrompt(id);
}

function closeModal() {
    const modal = document.getElementById('modal');
    if (modal) {
        modal.classList.add('hidden');
        modal.setAttribute('aria-hidden', 'true');
        modal.style.display = '';
    }
    currentProductToDelete = null;
}

async function confirmDelete() {
    if (!currentProductToDelete) {
        closeModal();
        return;
    }
    if (!authToken || !currentUser) {
        showNotification('🔒 Debes iniciar sesión', 'warning');
        closeModal();
        return;
    }
    try {
        // Convertir item_id a número para asegurar que sea válido
        const itemId = parseInt(currentProductToDelete, 10);
        if (isNaN(itemId)) {
            showNotification('⚠️ ID inválido', 'warning');
            closeModal();
            return;
        }
        
        const res = await fetch(`${API_BASE_URL}/items/${itemId}`, {
            method: 'DELETE',
            headers: getAuthHeader()
        });
        
        if (!res.ok) {
            const err = await res.json().catch(()=>({ detail: 'Error al eliminar clase' }));
            showNotification(`❌ ${err.detail || 'Error al eliminar clase'}`, 'error');
            closeModal();
            return;
        }
        
        showNotification('✅ Clase eliminada', 'success');
        currentProductToDelete = null;
        closeModal();
        loadAllProducts();
    } catch (e) {
        console.error('Error en confirmDelete:', e);
        // Error de red comúnmente -> backend no disponible
        if (e instanceof TypeError) {
            showNotification('❌ Error de conexión: verifica que el backend esté ejecutándose', 'error');
        } else {
            showNotification(`❌ Error: ${e.message}`, 'error');
        }
        closeModal();
    }
}