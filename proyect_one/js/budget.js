(function () {
    const MONEDAS = [
        { codigo: 'USD', simbolo: '$', nombre: 'Dólares' },
        { codigo: 'VES', simbolo: 'Bs.', nombre: 'Bolívares' },
    ];

    const STORAGE_KEY = 'dormiust_registros';

    function urlPhp(archivo) {
        return new URL(`php/${archivo}`, window.location.href).href;
    }

    function urlData(archivo) {
        return new URL(`data/${archivo}`, window.location.href).href;
    }

    async function parsearRespuestaJson(respuesta) {
        const texto = await respuesta.text();

        if (!texto.trim()) {
            throw new Error('El servidor devolvió una respuesta vacía.');
        }

        try {
            return JSON.parse(texto);
        } catch {
            throw new Error('El servidor no devolvió JSON válido. Verifica que PHP esté habilitado en tu hosting.');
        }
    }

    function leerRegistrosLocal() {
        try {
            const raw = localStorage.getItem(STORAGE_KEY);
            const datos = raw ? JSON.parse(raw) : [];
            return Array.isArray(datos) ? datos : [];
        } catch {
            return [];
        }
    }

    function guardarRegistrosLocal(registros) {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(registros));
    }

    function agregarRegistroLocal(registro) {
        const existentes = leerRegistrosLocal();
        existentes.push(registro);
        guardarRegistrosLocal(existentes);
    }

    function fusionarRegistros(...listas) {
        const mapa = new Map();

        listas.flat().forEach((reg) => {
            if (reg && reg.id) {
                mapa.set(reg.id, reg);
            }
        });

        return Array.from(mapa.values()).sort((a, b) => (b.fecha || '').localeCompare(a.fecha || ''));
    }

    function construirRegistro(payload) {
        return {
            id: `reg_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`,
            fecha: payload.fecha,
            tasa_bcv: payload.tasa_bcv,
            presupuesto_limite: payload.presupuesto_limite,
            movimientos: payload.movimientos,
            totales: payload.totales,
            guardado_en: new Date().toISOString(),
            almacenado_local: true,
        };
    }

    async function obtenerRegistrosServidor() {
        const respuesta = await fetch(urlPhp('obtener_registros.php'));
        const datos = await parsearRespuestaJson(respuesta);

        if (!respuesta.ok || !datos.exito) {
            throw new Error(datos.mensaje || 'No se pudieron cargar los registros del servidor.');
        }

        return datos.registros || [];
    }

    async function obtenerRegistrosArchivo() {
        const respuesta = await fetch(urlData('gastos.json'));

        if (!respuesta.ok) {
            throw new Error('No se pudo leer data/gastos.json.');
        }

        const datos = await respuesta.json();
        return Array.isArray(datos) ? datos : [];
    }

    async function obtenerRegistrosTodos() {
        const locales = leerRegistrosLocal();
        let servidor = [];

        try {
            servidor = await obtenerRegistrosServidor();
        } catch {
            try {
                servidor = await obtenerRegistrosArchivo();
            } catch {
                if (locales.length === 0) {
                    throw new Error('No se pudieron cargar los registros. El servidor PHP no está disponible.');
                }
            }
        }

        return {
            registros: fusionarRegistros(servidor, locales),
            tieneLocales: locales.length > 0,
            tieneServidor: servidor.length > 0,
        };
    }

    async function guardarRegistroRemoto(payload) {
        const respuesta = await fetch(urlPhp('guardar_gasto.php'), {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload),
        });

        const datos = await parsearRespuestaJson(respuesta);

        if (!respuesta.ok || !datos.exito) {
            throw new Error(datos.mensaje || 'Error al guardar el registro en el servidor.');
        }

        return { datos, almacenamiento: 'servidor' };
    }

    function guardarRegistroLocal(payload) {
        const registro = construirRegistro(payload);
        agregarRegistroLocal(registro);

        return {
            datos: {
                exito: true,
                mensaje: 'Registro guardado en este dispositivo.',
                id: registro.id,
            },
            almacenamiento: 'local',
        };
    }

    const form = document.getElementById('budget-form');
    const listaGastos = document.getElementById('lista-gastos');
    const listaAhorros = document.getElementById('lista-ahorros');
    const tasaInput = document.getElementById('tasa-cambio');
    const tasaDisplay = document.getElementById('tasa-bcv-display');
    const bcvMeta = document.getElementById('bcv-meta');
    const presupuestoInput = document.getElementById('presupuesto-limite');
    const montoInput = document.getElementById('gasto-monto');
    const monedaSelect = document.getElementById('gasto-moneda');
    const descripcionInput = document.getElementById('gasto-descripcion');
    const previewConversion = document.getElementById('preview-conversion');
    const btnAgregarGasto = document.getElementById('btn-agregar-gasto');
    const btnAgregarAhorro = document.getElementById('btn-agregar-ahorro');
    const btnGuardar = document.getElementById('btn-guardar');
    const mensajeEstado = document.getElementById('mensaje-estado');

    const subtotalGastosEl = document.getElementById('subtotal-gastos');
    const subtotalAhorrosEl = document.getElementById('subtotal-ahorros');
    const totalGastosUsdEl = document.getElementById('total-gastos-usd');
    const totalAhorrosUsdEl = document.getElementById('total-ahorros-usd');
    const totalGastosVesEl = document.getElementById('total-gastos-ves');
    const totalAhorrosVesEl = document.getElementById('total-ahorros-ves');
    const totalNetoEl = document.getElementById('total-neto');
    const restanteEl = document.getElementById('presupuesto-restante');

    const btnVerRegistros = document.getElementById('btn-ver-registros');
    const modalRegistros = document.getElementById('modal-registros');
    const listaRegistros = document.getElementById('lista-registros');
    const historialTotalGastos = document.getElementById('historial-total-gastos');
    const historialTotalAhorros = document.getElementById('historial-total-ahorros');
    const historialNetoTotal = document.getElementById('historial-neto-total');
    const canvasGrafica = document.getElementById('grafica-registros');

    let movimientos = [];
    let tasaBcv = 0;
    let graficaInstancia = null;

    function obtenerTasa() {
        return Number.isFinite(tasaBcv) && tasaBcv > 0 ? tasaBcv : 0;
    }

    function calcularMontos(monto, moneda) {
        const tasa = obtenerTasa();
        if (moneda === 'USD') {
            return {
                monto_usd: monto,
                monto_ves: tasa > 0 ? monto * tasa : 0,
            };
        }
        return {
            monto_usd: tasa > 0 ? monto / tasa : 0,
            monto_ves: monto,
        };
    }

    function formatearMoneda(monto, moneda) {
        const info = MONEDAS.find((m) => m.codigo === moneda);
        const simbolo = info ? info.simbolo : '';
        return `${simbolo} ${monto.toLocaleString('es-VE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
    }

    function escapeHtml(texto) {
        const div = document.createElement('div');
        div.textContent = texto;
        return div.innerHTML;
    }

    function mostrarMensaje(texto, tipo) {
        mensajeEstado.textContent = texto;
        mensajeEstado.className = `mensaje-estado ${tipo}`;
        if (tipo === 'exito') {
            setTimeout(() => {
                mensajeEstado.textContent = '';
                mensajeEstado.className = 'mensaje-estado';
            }, 4000);
        }
    }

    function actualizarPreviewConversion() {
        const monto = parseFloat(montoInput.value);
        const moneda = monedaSelect.value;
        const tasa = obtenerTasa();

        if (!Number.isFinite(monto) || monto <= 0) {
            previewConversion.textContent = '';
            previewConversion.className = 'preview-conversion';
            return;
        }

        if (moneda === 'USD' && tasa > 0) {
            const equivalente = monto * tasa;
            previewConversion.textContent = `Conversión BCV: ${formatearMoneda(monto, 'USD')} = ${formatearMoneda(equivalente, 'VES')}`;
            previewConversion.className = 'preview-conversion preview-activa';
        } else if (moneda === 'VES') {
            previewConversion.textContent = `Monto en bolívares (sin conversión): ${formatearMoneda(monto, 'VES')}`;
            previewConversion.className = 'preview-conversion preview-activa';
        } else {
            previewConversion.textContent = 'Esperando tasa BCV para calcular la conversión…';
            previewConversion.className = 'preview-conversion preview-pendiente';
        }
    }

    function aplicarTasaBcv(datos) {
        tasaBcv = datos.tasa;
        tasaInput.value = String(tasaBcv);
        tasaDisplay.textContent = tasaBcv.toLocaleString('es-VE', { minimumFractionDigits: 2, maximumFractionDigits: 4 });

        const fecha = datos.fecha_efectiva ? `Vigente: ${datos.fecha_efectiva}` : '';
        const fuente = datos.fuente || 'BCV';
        const partes = [fuente, fecha].filter(Boolean);
        if (datos.desactualizada) {
            partes.push('última tasa conocida');
        }
        bcvMeta.textContent = partes.join(' · ');
    }

    async function obtenerTasaDesdeNavegador() {
        const respuesta = await fetch('https://bcv.today/api/v1/rate.json', {
            headers: { Accept: 'application/json' },
        });

        if (!respuesta.ok) {
            throw new Error('No se pudo consultar la tasa BCV desde el navegador.');
        }

        const datos = await respuesta.json();
        if (!datos || !Number.isFinite(datos.USD) || datos.USD <= 0) {
            throw new Error('La respuesta del BCV no contiene una tasa válida.');
        }

        return {
            exito: true,
            tasa: datos.USD,
            fecha_efectiva: datos.effective_date || datos.date || null,
            fuente: 'bcv.org.ve (consulta directa)',
        };
    }

    async function cargarTasaBcv() {
        tasaDisplay.textContent = 'Cargando…';
        bcvMeta.textContent = 'Consultando Banco Central de Venezuela…';

        try {
            let datos = null;

            try {
                const respuesta = await fetch(urlPhp('obtener_tasa_bcv.php'));
                datos = await parsearRespuestaJson(respuesta);

                if (!respuesta.ok || !datos.exito) {
                    throw new Error(datos.mensaje || 'No se pudo obtener la tasa BCV.');
                }
            } catch (errPhp) {
                datos = await obtenerTasaDesdeNavegador();
                datos.fallback = true;
            }

            aplicarTasaBcv(datos);
            mostrarMensaje('', '');
        } catch (err) {
            tasaBcv = 0;
            tasaDisplay.textContent = 'No disponible';
            bcvMeta.textContent = `${err.message} · Intenta recargar la página.`;
            mostrarMensaje(err.message, 'error');
        }

        actualizarPreviewConversion();
        renderizarListas();
    }

    function filtrarPorTipo(tipo) {
        return movimientos.filter((m) => m.tipo === tipo);
    }

    function sumarTotales(tipo) {
        return filtrarPorTipo(tipo).reduce(
            (acc, mov) => ({
                usd: acc.usd + mov.monto_usd,
                ves: acc.ves + mov.monto_ves,
            }),
            { usd: 0, ves: 0 }
        );
    }

    function calcularTotales() {
        const tasa = obtenerTasa();
        const gastos = sumarTotales('gasto');
        const ahorros = sumarTotales('ahorro');
        const netoUsd = ahorros.usd - gastos.usd;
        const presupuesto = parseFloat(presupuestoInput.value) || 0;
        const restante = presupuesto - gastos.usd;

        subtotalGastosEl.textContent = formatearMoneda(gastos.usd, 'USD');
        subtotalAhorrosEl.textContent = formatearMoneda(ahorros.usd, 'USD');
        totalGastosUsdEl.textContent = formatearMoneda(gastos.usd, 'USD');
        totalAhorrosUsdEl.textContent = formatearMoneda(ahorros.usd, 'USD');
        totalGastosVesEl.textContent = tasa > 0 ? formatearMoneda(gastos.ves, 'VES') : '—';
        totalAhorrosVesEl.textContent = tasa > 0 ? formatearMoneda(ahorros.ves, 'VES') : '—';
        totalNetoEl.textContent = formatearMoneda(netoUsd, 'USD');
        totalNetoEl.classList.toggle('negativo', netoUsd < 0);
        totalNetoEl.classList.toggle('positivo', netoUsd > 0);

        if (presupuesto > 0) {
            restanteEl.textContent = formatearMoneda(restante, 'USD');
            restanteEl.classList.toggle('sobrepasado', restante < 0);
        } else {
            restanteEl.textContent = '—';
            restanteEl.classList.remove('sobrepasado');
        }
    }

    function crearItemLista(mov, indexGlobal) {
        const li = document.createElement('li');
        li.className = `gasto-item gasto-item-${mov.tipo}`;
        const detalleMoneda = mov.moneda === 'USD'
            ? `${formatearMoneda(mov.monto, 'USD')} → ${formatearMoneda(mov.monto_ves, 'VES')}`
            : formatearMoneda(mov.monto, 'VES');

        li.innerHTML = `
            <div class="gasto-info">
                <span class="gasto-desc">${escapeHtml(mov.descripcion)}</span>
                <span class="gasto-monto">${detalleMoneda}</span>
                <span class="gasto-equiv">≈ ${formatearMoneda(mov.monto_usd, 'USD')}</span>
            </div>
            <button type="button" class="btn-eliminar" data-index="${indexGlobal}" aria-label="Eliminar registro">×</button>
        `;
        return li;
    }

    function renderizarListaContenedor(contenedor, tipo, mensajeVacio) {
        contenedor.innerHTML = '';
        const items = movimientos
            .map((mov, index) => ({ mov, index }))
            .filter(({ mov }) => mov.tipo === tipo);

        if (items.length === 0) {
            contenedor.innerHTML = `<li class="gasto-vacio">${mensajeVacio}</li>`;
            return;
        }

        items.forEach(({ mov, index }) => {
            contenedor.appendChild(crearItemLista(mov, index));
        });

        contenedor.querySelectorAll('.btn-eliminar').forEach((btn) => {
            btn.addEventListener('click', () => {
                const idx = parseInt(btn.dataset.index, 10);
                movimientos.splice(idx, 1);
                renderizarListas();
            });
        });
    }

    function renderizarListas() {
        renderizarListaContenedor(listaGastos, 'gasto', 'No hay gastos registrados hoy.');
        renderizarListaContenedor(listaAhorros, 'ahorro', 'No hay ahorros registrados hoy.');
        calcularTotales();
    }

    function agregarMovimiento(tipo) {
        const monto = parseFloat(montoInput.value);
        const moneda = monedaSelect.value;
        const descripcion = descripcionInput.value.trim() || 'Sin descripción';

        if (!Number.isFinite(monto) || monto <= 0) {
            mostrarMensaje('Ingresa un monto válido mayor a cero.', 'error');
            montoInput.focus();
            return;
        }

        if (obtenerTasa() <= 0) {
            mostrarMensaje('La tasa BCV no está disponible. Intenta recargar la página.', 'error');
            return;
        }

        const montos = calcularMontos(monto, moneda);

        movimientos.push({
            descripcion,
            monto,
            moneda,
            monto_usd: Math.round(montos.monto_usd * 100) / 100,
            monto_ves: Math.round(montos.monto_ves * 100) / 100,
            tipo,
        });

        montoInput.value = '';
        descripcionInput.value = '';
        previewConversion.textContent = '';
        montoInput.focus();
        mostrarMensaje('', '');
        renderizarListas();
    }

    async function guardarRegistro(e) {
        e.preventDefault();

        if (movimientos.length === 0) {
            mostrarMensaje('Agrega al menos un gasto o ahorro antes de guardar.', 'error');
            return;
        }

        const tasa = obtenerTasa();
        if (tasa <= 0) {
            mostrarMensaje('La tasa BCV no está disponible.', 'error');
            return;
        }

        const gastos = sumarTotales('gasto');
        const ahorros = sumarTotales('ahorro');

        const payload = {
            fecha: new Date().toISOString().split('T')[0],
            tasa_bcv: tasa,
            presupuesto_limite: parseFloat(presupuestoInput.value) || 0,
            movimientos,
            totales: {
                gastos_usd: Math.round(gastos.usd * 100) / 100,
                gastos_ves: Math.round(gastos.ves * 100) / 100,
                ahorros_usd: Math.round(ahorros.usd * 100) / 100,
                ahorros_ves: Math.round(ahorros.ves * 100) / 100,
            },
        };

        btnGuardar.disabled = true;
        btnGuardar.textContent = 'Guardando...';

        try {
            let resultado;

            try {
                resultado = await guardarRegistroRemoto(payload);
            } catch {
                resultado = guardarRegistroLocal(payload);
            }

            const mensaje = resultado.almacenamiento === 'local'
                ? 'Registro guardado en este dispositivo (servidor no disponible).'
                : 'Registro guardado correctamente.';

            mostrarMensaje(mensaje, 'exito');
            movimientos = [];
            renderizarListas();
        } catch (err) {
            mostrarMensaje(err.message, 'error');
        } finally {
            btnGuardar.disabled = false;
            btnGuardar.textContent = 'Guardar registro del día';
        }
    }

    function normalizarRegistro(registro) {
        const movs = registro.movimientos || registro.gastos || [];
        const totales = registro.totales || {
            gastos_usd: registro.total_usd || 0,
            gastos_ves: registro.total_ves || 0,
            ahorros_usd: 0,
            ahorros_ves: 0,
        };

        return {
            ...registro,
            tasa_bcv: registro.tasa_bcv || registro.tasa_cambio || 0,
            movimientos: movs.map((mov) => ({
                ...mov,
                tipo: mov.tipo || 'gasto',
                monto_usd: mov.monto_usd ?? (mov.moneda === 'USD' ? mov.monto : 0),
                monto_ves: mov.monto_ves ?? (mov.moneda === 'VES' ? mov.monto : 0),
            })),
            totales,
        };
    }

    function renderizarGrafica(registros) {
        if (typeof Chart === 'undefined') return;

        const etiquetas = registros.map((r) => r.fecha).reverse();
        const datosGastos = registros.map((r) => r.totales.gastos_usd || 0).reverse();
        const datosAhorros = registros.map((r) => r.totales.ahorros_usd || 0).reverse();

        if (graficaInstancia) {
            graficaInstancia.destroy();
        }

        graficaInstancia = new Chart(canvasGrafica, {
            type: 'bar',
            data: {
                labels: etiquetas,
                datasets: [
                    {
                        label: 'Gastos (USD)',
                        data: datosGastos,
                        backgroundColor: 'rgba(248, 113, 113, 0.85)',
                        borderRadius: 6,
                    },
                    {
                        label: 'Ahorros (USD)',
                        data: datosAhorros,
                        backgroundColor: 'rgba(94, 234, 212, 0.85)',
                        borderRadius: 6,
                    },
                ],
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: {
                    legend: { position: 'bottom' },
                },
                scales: {
                    y: {
                        beginAtZero: true,
                        ticks: {
                            callback: (value) => `$ ${value}`,
                        },
                    },
                },
            },
        });
    }

    function renderizarHistorial(registros) {
        if (registros.length === 0) {
            listaRegistros.innerHTML = '<p class="registros-vacio">Aún no hay registros guardados.</p>';
            historialTotalGastos.textContent = formatearMoneda(0, 'USD');
            historialTotalAhorros.textContent = formatearMoneda(0, 'USD');
            historialNetoTotal.textContent = formatearMoneda(0, 'USD');
            historialNetoTotal.classList.remove('positivo', 'negativo');
            if (graficaInstancia) {
                graficaInstancia.destroy();
                graficaInstancia = null;
            }
            return;
        }

        let sumaGastos = 0;
        let sumaAhorros = 0;

        listaRegistros.innerHTML = registros.map((reg) => {
            const normalizado = normalizarRegistro(reg);
            sumaGastos += normalizado.totales.gastos_usd || 0;
            sumaAhorros += normalizado.totales.ahorros_usd || 0;

            const movsHtml = normalizado.movimientos.map((mov) => {
                const badge = mov.tipo === 'ahorro' ? 'badge-ahorro' : 'badge-gasto';
                const etiqueta = mov.tipo === 'ahorro' ? 'Ahorro' : 'Gasto';
                const detalle = mov.moneda === 'USD'
                    ? `${formatearMoneda(mov.monto, 'USD')} → ${formatearMoneda(mov.monto_ves, 'VES')}`
                    : formatearMoneda(mov.monto, 'VES');

                return `
                    <li class="registro-movimiento">
                        <span class="badge-tipo ${badge}">${etiqueta}</span>
                        <span class="registro-mov-desc">${escapeHtml(mov.descripcion)}</span>
                        <span class="registro-mov-monto">${detalle}</span>
                    </li>
                `;
            }).join('');

            return `
                <article class="registro-dia">
                    <header class="registro-dia-header">
                        <h3>${escapeHtml(normalizado.fecha)}</h3>
                        <span class="registro-tasa">BCV: ${Number(normalizado.tasa_bcv).toLocaleString('es-VE', { minimumFractionDigits: 2 })} Bs./USD</span>
                    </header>
                    <ul class="registro-movimientos">${movsHtml}</ul>
                    <footer class="registro-dia-totales">
                        <span class="total-gasto-hist">Gastos: ${formatearMoneda(normalizado.totales.gastos_usd || 0, 'USD')}</span>
                        <span class="total-ahorro-hist">Ahorros: ${formatearMoneda(normalizado.totales.ahorros_usd || 0, 'USD')}</span>
                    </footer>
                </article>
            `;
        }).join('');

        const netoTotal = sumaAhorros - sumaGastos;

        historialTotalGastos.textContent = formatearMoneda(sumaGastos, 'USD');
        historialTotalAhorros.textContent = formatearMoneda(sumaAhorros, 'USD');
        historialNetoTotal.textContent = formatearMoneda(netoTotal, 'USD');
        historialNetoTotal.classList.toggle('positivo', netoTotal > 0);
        historialNetoTotal.classList.toggle('negativo', netoTotal < 0);
        renderizarGrafica(registros.map(normalizarRegistro));
    }

    async function abrirModalRegistros() {
        modalRegistros.hidden = false;
        document.body.classList.add('modal-abierto');
        listaRegistros.innerHTML = '<p class="registros-cargando">Cargando registros…</p>';

        try {
            const { registros, tieneLocales, tieneServidor } = await obtenerRegistrosTodos();
            renderizarHistorial(registros.map(normalizarRegistro));

            if (tieneLocales && !tieneServidor) {
                listaRegistros.insertAdjacentHTML(
                    'afterbegin',
                    '<p class="registros-aviso">Mostrando registros guardados en este dispositivo porque el servidor no está disponible.</p>'
                );
            }
        } catch (err) {
            listaRegistros.innerHTML = `<p class="registros-error">${escapeHtml(err.message)}</p>`;
        }
    }

    function cerrarModalRegistros() {
        modalRegistros.hidden = true;
        document.body.classList.remove('modal-abierto');
    }

    btnAgregarGasto.addEventListener('click', () => agregarMovimiento('gasto'));
    btnAgregarAhorro.addEventListener('click', () => agregarMovimiento('ahorro'));
    montoInput.addEventListener('input', actualizarPreviewConversion);
    monedaSelect.addEventListener('change', actualizarPreviewConversion);
    montoInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
            e.preventDefault();
            agregarMovimiento('gasto');
        }
    });
    presupuestoInput.addEventListener('input', calcularTotales);
    form.addEventListener('submit', guardarRegistro);
    btnVerRegistros.addEventListener('click', abrirModalRegistros);

    modalRegistros.querySelectorAll('[data-cerrar-modal]').forEach((el) => {
        el.addEventListener('click', cerrarModalRegistros);
    });

    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape' && !modalRegistros.hidden) {
            cerrarModalRegistros();
        }
    });

    renderizarListas();
    cargarTasaBcv();
})();
