// partials.js - Funciones para gestión de parciales
function handleAddPartial() {
    const val = (partialInput && partialInput.value || '').trim();
    if (!val) {
        showNotification('⚠️ Ingresa un nombre de parcial', 'warning');
        return;
    }

    if (currentPartials.some(p => p.name === val)) {
        showNotification('⚠️ Ya existe un parcial con ese nombre', 'warning');
        partialInput.value = '';
        return;
    }

    const newPartial = {
        name: val,
        max_score: 100.0,
        evaluation_method: "promedio",
        activities: [],
        vpf: 0,
        vpf_max: 100,
        penalties: 0,
        extras: 0,
        categories: {
            activities: { name: "Actividades", percentage: 20, score: 0, count: 0 },
            attendance: { name: "Asistencia", percentage: 10, score: 0, count: 0 },
            projects: { name: "Proyectos", percentage: 30, score: 0, count: 0 },
            exams: { name: "Exámenes", percentage: 40, score: 0, count: 0 }
        }
    };

    const itemId = String(document.getElementById('itemId')?.value || '').trim();

    if (itemId && authToken) {
        (async () => {
            try {
                const res = await fetch(`${API_BASE_URL}/items/${encodeURIComponent(itemId)}/partials`, {
                    method: 'POST',
                    headers: Object.assign({ 'Content-Type': 'application/json' }, getAuthHeader()),
                    body: JSON.stringify(newPartial)
                });
                if (!res.ok) {
                    if (res.status === 401) {
                        clearSession();
                        showNotification('🔒 Sesión expiró', 'warning');
                        return;
                    }
                    const err = await res.json().catch(()=>({ detail: 'Error al agregar parcial' }));
                    showNotification(`❌ ${err.detail || 'Error al agregar parcial'}`, 'error');
                    return;
                }
                const data = await res.json().catch(()=>({ partial: newPartial }));
                const serverPartial = data && data.partial ? data.partial : newPartial;
                currentPartials.push(serverPartial);
                partialInput.value = '';
                renderPartials();
                showNotification('✅ Parcial agregado', 'success');
            } catch (e) {
                showNotification(`❌ Error: ${e.message}`, 'error');
            }
        })();
    } else {
        currentPartials.push(newPartial);
        partialInput.value = '';
        renderPartials();
        showNotification('✅ Parcial agregado (local)', 'success');
    }
}

function renderPartials() {
    if (!partialsListEl) return;
    partialsListEl.innerHTML = '';
    currentPartials.forEach((p, idx) => {
        const li = document.createElement('li');
        
        const titleDiv = document.createElement('div');
        titleDiv.style.display = 'flex';
        titleDiv.style.flexDirection = 'column';
        const nameSpan = document.createElement('span');
        nameSpan.textContent = `${p.name}`;
        nameSpan.style.fontWeight = '600';
        const small = document.createElement('small');
        small.style.opacity = '0.8';
        const vpfText = `VPF: ${typeof p.vpf !== 'undefined' ? p.vpf : 0} / ${typeof p.vpf_max !== 'undefined' ? p.vpf_max : (p.max_score || 100)}`;
        small.textContent = vpfText;
        titleDiv.appendChild(nameSpan);
        titleDiv.appendChild(small);
        li.appendChild(titleDiv);
        
        const btnDiv = document.createElement('div');
        btnDiv.style.display = 'flex';
        btnDiv.style.gap = '0.3rem';
        
        const editBtn = document.createElement('button');
        editBtn.textContent = '✏️';
        editBtn.className = 'btn btn-sm btn-info';
        editBtn.type = 'button';
        editBtn.onclick = () => openPartialModal(idx);
        btnDiv.appendChild(editBtn);
        
        const remBtn = document.createElement('button');
        remBtn.textContent = '🗑️';
        remBtn.className = 'btn btn-sm btn-danger';
        remBtn.type = 'button';
        remBtn.onclick = async () => {
            const itemId = String(document.getElementById('itemId')?.value || '').trim();
            const partialName = p.name;
            if (itemId && authToken) {
                try {
                    const res = await fetch(`${API_BASE_URL}/items/${encodeURIComponent(itemId)}/partials/${encodeURIComponent(partialName)}`, {
                        method: 'DELETE',
                        headers: getAuthHeader()
                    });
                    if (!res.ok) {
                        if (res.status === 401) { clearSession(); showNotification('🔒 Sesión expiró', 'warning'); return; }
                        const err = await res.json().catch(()=>({ detail: 'No se pudo eliminar parcial' }));
                        showNotification(`❌ ${err.detail || 'No se pudo eliminar parcial'}`, 'error');
                        return;
                    }
                    currentPartials.splice(idx, 1);
                    renderPartials();
                    showNotification('✅ Parcial eliminado', 'success');
                } catch (e) {
                    showNotification(`❌ Error: ${e.message}`, 'error');
                }
            } else {
                currentPartials.splice(idx, 1);
                renderPartials();
                showNotification('✅ Parcial eliminado (local)', 'success');
            }
        };
        btnDiv.appendChild(remBtn);
        
        li.appendChild(btnDiv);
        partialsListEl.appendChild(li);
    });
}

async function openPartialModal(idx) {
    editingPartialIndex = idx;
    
    // Recargar datos frescos del servidor si estamos autenticados
    const itemId = String(document.getElementById('itemId')?.value || '').trim();
    if (itemId && authToken) {
        try {
            const refreshed = await loadPartialData(itemId);
            if (Array.isArray(refreshed) && refreshed.length > 0) {
                const originalPartialName = currentPartials[idx]?.name || '';
                currentPartials = refreshed;
                // Buscar el índice del parcial que estamos editando (por nombre)
                const newIdx = currentPartials.findIndex(p => p.name === originalPartialName);
                if (newIdx >= 0) {
                    editingPartialIndex = newIdx;
                }
            }
        } catch (e) {
            console.warn('Error recargando parciales:', e);
            // Continuar con los datos locales si falla la recarga
        }
    }
    
    const partial = currentPartials[editingPartialIndex];
    if (!partial) {
        showNotification('⚠️ Parcial no encontrado', 'warning');
        return;
    }
    
    const nameInput = document.getElementById('partialName');
    if (nameInput) {
        nameInput.value = partial.name || '';
    }
    editingOriginalPartialName = partial.name || null;
    
    document.getElementById('partialMaxScore').value = partial.max_score || 100;
    document.getElementById('partialMethod').value = partial.evaluation_method || 'promedio';
    document.getElementById('partialVpfMax').value = typeof partial.vpf_max !== 'undefined' ? partial.vpf_max : (partial.max_score || 100);
    
    // Limpiar campos de entrada
    document.getElementById('penaltyValue').value = '';
    document.getElementById('extraValue').value = '';
        // Cargar porcentajes de categorías
        renderCategoryInputs(partial);
    
    
    // Mostrar penalizaciones y extras del parcial
    updatePenaltyExtrasDisplay();
    
    renderActivitiesList(partial.activities || []);
    updateAndDisplayScore();
    
    // Asegurar que otros modales estén cerrados
    closeAccountEditModal();
    
    partialModal.classList.remove('hidden');
}

// Aquí irían más funciones de parciales, como savePartialModal, etc.
// Por brevedad, solo incluyo algunas. En una refactorización completa, mover todas.

function updatePenaltyExtrasDisplay() {
    const display = document.getElementById('penaltyExtrasDisplay');
    if (!display) return;
    
    display.innerHTML = '';
    
    // Obtener el parcial actual en edición
    if (typeof editingPartialIndex !== 'number' || editingPartialIndex < 0 || editingPartialIndex >= currentPartials.length) {
        return;
    }
    
    const partial = currentPartials[editingPartialIndex];
    const penalties = partial.penalties || 0;
    const extras = partial.extras || 0;
    
    if (penalties > 0) {
        const penaltyEl = document.createElement('div');
        penaltyEl.className = 'penalty-item';
        penaltyEl.innerHTML = `➖ Penalización: ${penalties} <button onclick="removePenalty()">❌</button>`;
        display.appendChild(penaltyEl);
    }
    
    if (extras > 0) {
        const extraEl = document.createElement('div');
        extraEl.className = 'extra-item';
        extraEl.innerHTML = `➕ Extras: ${extras} <button onclick="removeExtra()">❌</button>`;
        display.appendChild(extraEl);
    }
}

function addPenalty() {
    const value = parseFloat(document.getElementById('penaltyValue').value);
    if (isNaN(value) || value <= 0) {
        showNotification('⚠️ Ingresa una penalización válida', 'warning');
        return;
    }
    
    if (typeof editingPartialIndex !== 'number' || editingPartialIndex < 0 || editingPartialIndex >= currentPartials.length) {
        showNotification('⚠️ Selecciona un parcial primero', 'warning');
        return;
    }
    
    const partial = currentPartials[editingPartialIndex];
    partial.penalties = (partial.penalties || 0) + value;
    document.getElementById('penaltyValue').value = '';
    updatePenaltyExtrasDisplay();
    updateAndDisplayScore();
}

function addExtra() {
    const value = parseFloat(document.getElementById('extraValue').value);
    if (isNaN(value) || value <= 0) {
        showNotification('⚠️ Ingresa puntos extras válidos', 'warning');
        return;
    }
    
    if (typeof editingPartialIndex !== 'number' || editingPartialIndex < 0 || editingPartialIndex >= currentPartials.length) {
        showNotification('⚠️ Selecciona un parcial primero', 'warning');
        return;
    }
    
    const partial = currentPartials[editingPartialIndex];
    partial.extras = (partial.extras || 0) + value;
    document.getElementById('extraValue').value = '';
    updatePenaltyExtrasDisplay();
    updateAndDisplayScore();
}

function removePenalty() {
    if (typeof editingPartialIndex !== 'number' || editingPartialIndex < 0 || editingPartialIndex >= currentPartials.length) {
        return;
    }
    
    const partial = currentPartials[editingPartialIndex];
    partial.penalties = 0;
    updatePenaltyExtrasDisplay();
    updateAndDisplayScore();
}

function removeExtra() {
    if (typeof editingPartialIndex !== 'number' || editingPartialIndex < 0 || editingPartialIndex >= currentPartials.length) {
        return;
    }
    
    const partial = currentPartials[editingPartialIndex];
    partial.extras = 0;
    updatePenaltyExtrasDisplay();
    updateAndDisplayScore();
}

function handlePeriodComparison() {
    const method = document.getElementById('periodComparison')?.value || 'none';
    const result = document.getElementById('comparisonResult');
    
    if (!result) return;
    
    if (method === 'none') {
        result.classList.add('hidden');
        return;
    }
    
    const currentAvg = currentPartials.reduce((sum, p) => sum + (p.vpf || 0), 0) / (currentPartials.length || 1);
    
    if (method === 'previous') {
        const trend = analyzePeriodTrend('actual');
        if (trend) {
            const emoji = trend.trend === 'mejora' ? '📈' : trend.trend === 'baja' ? '📉' : '➡️';
            result.innerHTML = `${emoji} Comparado con periodo anterior: ${trend.previous} → ${trend.current} (${trend.difference})`;
            result.classList.remove('hidden');
        }
    } else if (method === 'average') {
        const avg = periodHistory['actual'] ? periodHistory['actual'].reduce((a, b) => a + b, 0) / periodHistory['actual'].length : currentAvg;
        const diff = currentAvg - avg;
        const emoji = diff > 0 ? '📈' : diff < 0 ? '📉' : '➡️';
        result.innerHTML = `${emoji} Promedio histórico: ${avg.toFixed(2)}, Actual: ${currentAvg.toFixed(2)} (Diferencia: ${diff.toFixed(2)})`;
        result.classList.remove('hidden');
    }
}

function analyzePeriodTrend(periodName) {
    // Simular análisis de tendencia del periodo
    if (!periodHistory[periodName]) {
        periodHistory[periodName] = [];
    }
    
    const currentAvg = currentPartials.reduce((sum, p) => sum + (p.vpf || 0), 0) / (currentPartials.length || 1);
    periodHistory[periodName].push(currentAvg);
    
    if (periodHistory[periodName].length < 2) return null;
    
    const previous = periodHistory[periodName][periodHistory[periodName].length - 2];
    const current = periodHistory[periodName][periodHistory[periodName].length - 1];
    const difference = current - previous;
    
    return {
        previous: previous.toFixed(2),
        current: current.toFixed(2),
        difference: difference.toFixed(2),
        trend: difference > 0 ? 'mejora' : difference < 0 ? 'baja' : 'estable'
    };
}

// Mostrar resultado del cálculo de esfuerzo en el modal
function showEffortResult(value) {
    const el = document.getElementById('effortResult');
    if (!el) return;
    if (value === null || typeof value === 'undefined') {
        el.textContent = '—';
        return;
    }
    // Si es número lo formateamos, si es objeto o string lo mostramos tal cual
    let text = '';
    if (typeof value === 'number') {
        text = value.toFixed(2) + '%';
        // Colorear según umbrales si es número
        el.className = 'effort-result';
        if (value >= 80) el.classList.add('good');
        else if (value >= 60) el.classList.add('warning');
        else el.classList.add('bad');
    } else {
        text = String(value);
    }

    el.textContent = text;
    // Colorear según umbrales si es número
    el.className = 'effort-result';
    if (typeof value === 'number') {
        if (value >= 80) el.classList.add('good');
        else if (value >= 60) el.classList.add('warning');
        else el.classList.add('bad');
    }
}

// ============================================================================
// FUNCIONES DE ANÁLISIS Y GESTIÓN DE PENALIZACIONES/EXTRAS
// ============================================================================

function calculateEffortEfficiency(activities, maxScore = 100) {
    // Devuelve un porcentaje 0-100 representando la "eficiencia" basada
    // en el promedio ponderado de las calificaciones respecto a la calificación máxima.
    if (!activities || activities.length === 0) return 0;

    const totalWeighted = activities.reduce((sum, a) => {
        const weight = a.weight || 1;
        return sum + (a.score * weight);
    }, 0);

    const totalWeight = activities.reduce((sum, a) => sum + (a.weight || 1), 0);

    if (totalWeight === 0) return 0;

    const weightedAvg = totalWeighted / totalWeight;
    const percent = (weightedAvg / maxScore) * 100;
    return percent;
}

function closePartialModal() {
    partialModal.classList.add('hidden');
    editingPartialIndex = null;
    editingOriginalPartialName = null;
    const pn = document.getElementById('partialName');
    if (pn) pn.value = '';
    document.getElementById('activityName').value = '';
    document.getElementById('activityScore').value = '';
    document.getElementById('activityWeight').value = '1';
    document.getElementById('penaltyValue').value = '';
    document.getElementById('extraValue').value = '';
    document.getElementById('extraValue').value = '';
}