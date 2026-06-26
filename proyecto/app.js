const app = angular.module('marviApp', []);

app.controller('MainController', function($scope, $http, $window, $timeout) {
    
    // 1. Identificar en qué página estamos
    const path = $window.location.pathname;
    $scope.activeTab = 0;
    if (path.includes('obras.html')) $scope.activeTab = 1;
    if (path.includes('comprobaciones.html')) $scope.activeTab = 2;
    if (path.includes('reportes.html')) $scope.activeTab = 3;
    if (path.includes('presupuestos.html')) $scope.activeTab = 4;

    // 2. Gestión de Sesión Persistente y Roles (RBAC)
    $scope.isLoggedIn = sessionStorage.getItem('marvi_logged_in') === 'true';
    $scope.userRole = sessionStorage.getItem('marvi_user_role') || 'lectura';
    $scope.esAdmin = $scope.userRole === 'admin';

    // Protección de rutas
    if (!$scope.isLoggedIn && !path.includes('index.html') && path !== '/' && !path.endsWith('/')) {
        $window.location.href = 'index.html';
    }

    // Inicialización de variables
    $scope.loginData = {};
    $scope.loginError = false;
    $scope.loading = false;
    $scope.configError = false;
    $scope.apiUrl = "";
    
    $scope.obras = []; 
    $scope.gastos = []; 
    $scope.presupuestos = [];
    $scope.filtroObras = {}; // NUEVO: Estado de la checklist
    
    $scope.obraActual = {}; 
    $scope.gastoActual = { 
        DEDUCIBLE: 'SI', TIPO_DE_PAGO: 'TARJETA DE DEBITO', FOLIO_FISCAL: 'NO', MONTO_TOTAL_NO_DEDUCIBLE_PAGADO: 'NO',
        SUBTOTAL: 0, IVA: 0, RET_IVA: 0, RET_ISR: 0, DESCUENTO: 0, ISH: 0, TOTAL: 0 
    };
    $scope.kpis = { total: 0, deducible: 0, noDeducible: 0, conteo: 0, gruposUnicos: 0 };
    
    let chartInstObras = null, chartInstPagos = null, chartInstTrabajadores = null, chartInstTotales = null;
    let chartInstInversion = null, chartInstDesglose = null;

    // 3. Cargar conexión a la base de datos (GAS)
    $http.get('conexion.json').then(function(res) {
        if(res.data && res.data.url) {
            $scope.apiUrl = res.data.url;
            if($scope.isLoggedIn && $scope.activeTab !== 0) {
                $scope.syncDataFromServer();
            }
        } else {
            $scope.configError = true;
        }
    }).catch(function() {
        $scope.configError = true;
    });

    // --- AUTENTICACIÓN ---
    $scope.login = function() {
        $scope.loading = true;
        $http.get('usuarios.json').then(function(res) {
            let usuarios = res.data;
            let userFound = usuarios.find(u => u.usuario === $scope.loginData.username && u.contrasena === $scope.loginData.password);
            
            if(userFound) {
                sessionStorage.setItem('marvi_logged_in', 'true');
                sessionStorage.setItem('marvi_user_role', userFound.rol);
                $window.location.href = 'obras.html';
            } else {
                $scope.loginError = true;
            }
        }).catch(function() {
            alert("Error crítico: No se pudo cargar la base de usuarios (usuarios.json).");
        }).finally(function() {
            $scope.loading = false;
        });
    };

    $scope.logout = function() { 
        sessionStorage.removeItem('marvi_logged_in');
        sessionStorage.removeItem('marvi_user_role');
        $window.location.href = 'index.html'; 
    };

    // --- SINCRONIZACIÓN DE DATOS ---
    $scope.syncDataFromServer = function() {
        if(!$scope.apiUrl) return;
        $scope.loading = true;
        $http.get($scope.apiUrl + "?action=getData").then(res => {
            if(res.data.success) {
                $scope.obras = res.data.obras;
                $scope.presupuestos = res.data.presupuestos || [];
                
                // Inicializar Checklist de Presupuestos (Todas marcadas por defecto)
                $scope.filtroObras = {};
                $scope.presupuestos.forEach(p => {
                    $scope.filtroObras[p.OBRA] = true;
                });

                $scope.gastos = res.data.gastos.map(g => { 
                    if(g.FECHA) g.FECHA = new Date(g.FECHA); 
                    if(g.FECHA_FOLIO_FISCAL) g.FECHA_FOLIO_FISCAL = new Date(g.FECHA_FOLIO_FISCAL);
                    if(g.FECHA_PAGO_NO_DEDUCIBLE) g.FECHA_PAGO_NO_DEDUCIBLE = new Date(g.FECHA_PAGO_NO_DEDUCIBLE);
                    return g; 
                });
                
                if($scope.activeTab === 3) {
                    $timeout(() => $scope.procesarMetricasYGraficos(), 100);
                }
                if($scope.activeTab === 4) {
                    $timeout(() => $scope.procesarGraficosPresupuestos(), 100);
                }
            }
        }).finally(() => $scope.loading = false);
    };

    // --- CRUD OBRAS Y GASTOS (Se mantienen intactos) ---
    $scope.guardarObra = function() { if(!$scope.esAdmin) return; $scope.loading = true; $http.post($scope.apiUrl, JSON.stringify({ action: 'saveObra', payload: $scope.obraActual })).then(() => { $scope.obraActual={}; $scope.syncDataFromServer(); }); };
    $scope.editarObra = function(o) { $scope.obraActual = angular.copy(o); $window.scrollTo({top:0}); };
    $scope.eliminarObra = function(o) { if(!$scope.esAdmin) return; if(confirm('¿Eliminar obra?')) { $scope.loading = true; $http.post($scope.apiUrl, JSON.stringify({ action: 'deleteObra', payload: o })).then(()=> $scope.syncDataFromServer()); }};
    $scope.limpiarObra = function() { $scope.obraActual = {}; };

    $scope.sincronizarObra = function() { if($scope.gastoActual.OBRA_OBJ) { $scope.gastoActual.ID_OBRA = $scope.gastoActual.OBRA_OBJ.ID_OBRA; $scope.gastoActual.OBRA = $scope.gastoActual.OBRA_OBJ.OBRA; }};
    $scope.limpiarFecha = function(fechaVar, condicionalVar) { if($scope.gastoActual[condicionalVar] === 'NO') $scope.gastoActual["_" + fechaVar + "_RAW"] = null; };
    $scope.calcularTotal = function() {
        let sub = parseFloat($scope.gastoActual.SUBTOTAL)||0, iva = parseFloat($scope.gastoActual.IVA)||0, ish = parseFloat($scope.gastoActual.ISH)||0;
        let ret = (parseFloat($scope.gastoActual.RET_IVA)||0) + (parseFloat($scope.gastoActual.RET_ISR)||0) + (parseFloat($scope.gastoActual.DESCUENTO)||0);
        $scope.gastoActual.TOTAL = Math.round(((sub + iva + ish) - ret) * 100) / 100;
    };
    $scope.guardarGasto = function() {
        if(!$scope.esAdmin) return;
        $scope.loading = true; let payload = angular.copy($scope.gastoActual); delete payload.OBRA_OBJ;
        if(payload._FECHA_RAW) payload.FECHA = payload._FECHA_RAW.toISOString();
        if(payload._FECHA_FOLIO_FISCAL_RAW) payload.FECHA_FOLIO_FISCAL = payload._FECHA_FOLIO_FISCAL_RAW.toISOString();
        if(payload._FECHA_PAGO_NO_DEDUCIBLE_RAW) payload.FECHA_PAGO_NO_DEDUCIBLE = payload._FECHA_PAGO_NO_DEDUCIBLE_RAW.toISOString();
        delete payload._FECHA_RAW; delete payload._FECHA_FOLIO_FISCAL_RAW; delete payload._FECHA_PAGO_NO_DEDUCIBLE_RAW;
        $http.post($scope.apiUrl, JSON.stringify({ action: 'saveGasto', payload: payload })).then(()=> { $scope.limpiarGasto(); $scope.syncDataFromServer(); });
    };
    $scope.editarGasto = function(g) { 
        $scope.gastoActual = angular.copy(g); 
        if(g.FECHA) $scope.gastoActual._FECHA_RAW = new Date(g.FECHA); 
        if(g.FECHA_FOLIO_FISCAL) $scope.gastoActual._FECHA_FOLIO_FISCAL_RAW = new Date(g.FECHA_FOLIO_FISCAL); 
        if(g.FECHA_PAGO_NO_DEDUCIBLE) $scope.gastoActual._FECHA_PAGO_NO_DEDUCIBLE_RAW = new Date(g.FECHA_PAGO_NO_DEDUCIBLE); 
        $scope.gastoActual.OBRA_OBJ = $scope.obras.find(o => o.ID_OBRA == g.ID_OBRA); 
        $window.scrollTo({top:0}); 
    };
    $scope.eliminarGasto = function(g) { if(!$scope.esAdmin) return; if(confirm('¿Eliminar comprobación?')) { $scope.loading = true; $http.post($scope.apiUrl, JSON.stringify({ action: 'deleteGasto', payload: g })).then(()=> $scope.syncDataFromServer()); }};
    $scope.limpiarGasto = function() { $scope.gastoActual = { DEDUCIBLE: 'SI', TIPO_DE_PAGO: 'TARJETA DE DEBITO', FOLIO_FISCAL: 'NO', MONTO_TOTAL_NO_DEDUCIBLE_PAGADO: 'NO', SUBTOTAL: 0, IVA: 0, RET_IVA: 0, RET_ISR: 0, DESCUENTO: 0, ISH: 0, TOTAL: 0 }; };

    // --- REPORTES Y ANALÍTICAS (Pestaña 3) - Se mantiene intacto ---
    $scope.procesarMetricasYGraficos = function() {
    if(typeof Chart === 'undefined') return;
            
            let total=0, deducible=0, noDeducible=0;
            let dataObrasGasto = {}, dataPagos = {}, dataTrabajadores = {};
            let gruposUnicosSet = new Set();
            let chartObraGroupData = {};
            let processedGroups = new Set();

            // Aplicamos el filtro de la checklist (filtroObras)
            let gastosFiltrados = $scope.gastos.filter(g => $scope.filtroObras[g.OBRA]);

            gastosFiltrados.forEach(g => {
                total += g.TOTAL;
                if(g.DEDUCIBLE === 'SI') deducible += g.TOTAL;
                if(g.DEDUCIBLE === 'NO') noDeducible += g.TOTAL;
                if(g.ID_GRUPO_COMPROBACION) gruposUnicosSet.add(g.ID_GRUPO_COMPROBACION);

                dataObrasGasto[g.OBRA] = (dataObrasGasto[g.OBRA] || 0) + g.TOTAL;
                dataPagos[g.TIPO_DE_PAGO] = (dataPagos[g.TIPO_DE_PAGO] || 0) + g.TOTAL;
                
                if(!dataTrabajadores[g.TRABAJADOR]) dataTrabajadores[g.TRABAJADOR] = { SI: 0, NO: 0 };
                dataTrabajadores[g.TRABAJADOR][g.DEDUCIBLE] += g.TOTAL;

                if(g.ID_GRUPO_COMPROBACION) {
                    let compositeKey = g.OBRA + '_' + g.ID_GRUPO_COMPROBACION;
                    if(!processedGroups.has(compositeKey)) {
                        processedGroups.add(compositeKey);
                        if(!chartObraGroupData[g.OBRA]) chartObraGroupData[g.OBRA] = { DED: 0, NO_DED: 0 };
                        chartObraGroupData[g.OBRA].DED += g.MONTO_TOTAL_DEDUCIBLE_A_PAGAR;
                        chartObraGroupData[g.OBRA].NO_DED += g.MONTO_TOTAL_NO_DEDUCIBLE_A_PAGAR;
                    }
                }
            });

        $scope.kpis.total = total; $scope.kpis.deducible = deducible; $scope.kpis.noDeducible = noDeducible;
        $scope.kpis.conteo = $scope.gastos.length; $scope.kpis.gruposUnicos = gruposUnicosSet.size;

        if(chartInstObras) chartInstObras.destroy();
        chartInstObras = new Chart(document.getElementById('chartObras'), { type: 'bar', data: { labels: Object.keys(dataObrasGasto), datasets: [{ label: 'Total Gastado ($)', data: Object.values(dataObrasGasto), backgroundColor: '#0ea5e9' }] }, options: { responsive: true, maintainAspectRatio: false } });

        let labelsPagos = Object.keys(dataPagos);
        if(chartInstPagos) chartInstPagos.destroy();
        chartInstPagos = new Chart(document.getElementById('chartPagos'), { type: 'doughnut', data: { labels: labelsPagos, datasets: [{ data: Object.values(dataPagos), backgroundColor: ['#8b5cf6', '#ec4899', '#14b8a6', '#f97316', '#3b82f6'] }] }, options: { responsive: true, maintainAspectRatio: false } });

        let labelsTrab = Object.keys(dataTrabajadores);
        if(chartInstTrabajadores) chartInstTrabajadores.destroy();
        chartInstTrabajadores = new Chart(document.getElementById('chartTrabajadores'), { type: 'bar', data: { labels: labelsTrab, datasets: [ { label: 'Deducibles (SI)', data: labelsTrab.map(t => dataTrabajadores[t].SI), backgroundColor: '#10b981' }, { label: 'No Deducibles (NO)', data: labelsTrab.map(t => dataTrabajadores[t].NO), backgroundColor: '#ef4444' } ] }, options: { responsive: true, maintainAspectRatio: false } });

        let labelsTotales = Object.keys(chartObraGroupData);
        if(chartInstTotales) chartInstTotales.destroy();
        chartInstTotales = new Chart(document.getElementById('chartTotalesPagar'), { type: 'bar', data: { labels: labelsTotales, datasets: [ { label: 'Monto Total Ded. a Pagar ($)', data: labelsTotales.map(l => chartObraGroupData[l].DED), backgroundColor: '#059669' }, { label: 'Monto Total No Ded. a Pagar ($)', data: labelsTotales.map(l => chartObraGroupData[l].NO_DED), backgroundColor: '#dc2626' } ] }, options: { responsive: true, maintainAspectRatio: false } });
    };

    // --- MÓDULO DE PRESUPUESTOS (Pestaña 4) ---
    $scope.vistaPresupuestos = 'deducible'; 

    // Funciones del Filtro Checklist
    $scope.toggleTodasObras = function(estado) {
        for (let obra in $scope.filtroObras) {
            $scope.filtroObras[obra] = estado;
        }
        $scope.procesarGraficosPresupuestos();
    };

    $scope.restablecerFiltrosObras = function() {
        $scope.searchPresupuesto = "";
        $scope.toggleTodasObras(true); // Selecciona todas y re-dibuja
    };

    $scope.actualizarFiltroObras = function() {
        $scope.procesarGraficosPresupuestos();
    };

    // Filtro personalizado para el ng-repeat de la tabla
    $scope.filtroPorObraSeleccionada = function(p) {
        return $scope.filtroObras[p.OBRA];
    };

    $scope.getTotalDinamico = function(p) {
        let sumDed = (p.MANO_OBRA_MONTO || 0) + (p.EQUIPOS_MONTO || 0) + (p.MATERIALES_VARIOS_MONTO || 0) + (p.LAMINA_MONTO || 0);
        return $scope.vistaPresupuestos === 'deducible' ? sumDed : (sumDed + (p.GASTOS_ADMINISTRATIVOS_MONTO || 0));
    };

    $scope.calcPorcentaje = function(monto, p) {
        let total = $scope.getTotalDinamico(p);
        if (!total || total === 0) return 0;
        return (monto / total) * 100;
    };

    $scope.setVistaPresupuesto = function(vista) {
        $scope.vistaPresupuestos = vista;
        $scope.procesarGraficosPresupuestos();
    };

    $scope.procesarGraficosPresupuestos = function() {
        if(typeof Chart === 'undefined' || !$scope.presupuestos) return;

        // Filtrado maestro (Afecta todo lo visual: KPIs y Charts)
        let presupuestosFiltrados = $scope.presupuestos.filter(p => $scope.filtroObras[p.OBRA]);

        let labelsObras = presupuestosFiltrados.map(p => p.OBRA);
        let dataPresupuestos = presupuestosFiltrados.map(p => p.PRESUPUESTO_MONTO);
        let dataInversionTotal = presupuestosFiltrados.map(p => p.TOTAL_INVERSION);
        
        let totalManoObra = presupuestosFiltrados.reduce((acc, p) => acc + p.MANO_OBRA_MONTO, 0);
        let totalEquipos = presupuestosFiltrados.reduce((acc, p) => acc + p.EQUIPOS_MONTO, 0);
        let totalMateriales = presupuestosFiltrados.reduce((acc, p) => acc + p.MATERIALES_VARIOS_MONTO, 0);
        let totalLamina = presupuestosFiltrados.reduce((acc, p) => acc + p.LAMINA_MONTO, 0);
        let totalAdminStr = presupuestosFiltrados.reduce((acc, p) => acc + p.GASTOS_ADMINISTRATIVOS_MONTO, 0);

        let totalDeducibles = totalManoObra + totalEquipos + totalMateriales + totalLamina;
        let totalGlobal = totalDeducibles + totalAdminStr;

        // KPI Acumulados Globales (Filtrados)
        $scope.kpiPresupuestos = {
            totalPresupuesto: dataPresupuestos.reduce((a, b) => a + b, 0),
            totalInversionPrevista: dataInversionTotal.reduce((a, b) => a + b, 0),
            totalGastado: $scope.vistaPresupuestos === 'deducible' ? totalDeducibles : totalGlobal,
            margenGlobal: dataPresupuestos.reduce((a, b) => a + b, 0) - ($scope.vistaPresupuestos === 'deducible' ? totalDeducibles : totalGlobal)
        };

        // 1. Gráfica Comparativa
        let dataGastadoReal = presupuestosFiltrados.map(p => $scope.getTotalDinamico(p));

        if(chartInstInversion) chartInstInversion.destroy();
        chartInstInversion = new Chart(document.getElementById('chartInversion'), {
            type: 'bar',
            data: {
                labels: labelsObras,
                datasets: [
                    { label: 'Presupuesto Asignado ($)', data: dataPresupuestos, backgroundColor: '#0ea5e9', borderRadius: 4 },
                    { label: 'Total Inversión Prevista ($)', data: dataInversionTotal, backgroundColor: '#f59e0b', borderRadius: 4 },
                    { label: 'Suma Ejecutada ('+ ($scope.vistaPresupuestos === 'deducible' ? 'Deducibles' : 'Global') +') ($)', data: dataGastadoReal, backgroundColor: $scope.vistaPresupuestos === 'deducible' ? '#10b981' : '#8b5cf6', borderRadius: 4 }
                ]
            },
            options: { responsive: true, maintainAspectRatio: false }
        });

        // 2. Gráfica de Desglose
        let labelsDesglose = ['Mano de Obra', 'Equipos', 'Materiales Varios', 'Lámina'];
        let dataDesglose = [totalManoObra, totalEquipos, totalMateriales, totalLamina];
        let bgColors = ['#10b981', '#3b82f6', '#ec4899', '#f97316'];

        if($scope.vistaPresupuestos === 'global') {
            labelsDesglose.push('Gastos Admin (No Ded.)');
            dataDesglose.push(totalAdminStr);
            bgColors.push('#ef4444');
        }

        if(chartInstDesglose) chartInstDesglose.destroy();
        chartInstDesglose = new Chart(document.getElementById('chartDesglose'), {
            type: 'doughnut',
            data: {
                labels: labelsDesglose,
                datasets: [{
                    data: dataDesglose,
                    backgroundColor: bgColors,
                    borderWidth: 0,
                    hoverOffset: 4
                }]
            },
            options: { responsive: true, maintainAspectRatio: false, cutout: '75%' }
        });
    };

    // --- EXPORTACIÓN A EXCEL PARA PRESUPUESTOS ---
    $scope.exportarPresupuestosExcel = function() {
        if (typeof XLSX === 'undefined') { alert("La librería Excel no está cargada."); return; }
        if (!$scope.presupuestos || $scope.presupuestos.length === 0) return;

        // Filtrar por Checklist de Obras y Búsqueda textual
        let datosAExportar = $scope.presupuestos.filter(p => $scope.filtroObras[p.OBRA]);
        if ($scope.searchPresupuesto) {
            let termino = $scope.searchPresupuesto.toLowerCase();
            datosAExportar = datosAExportar.filter(p => p.OBRA.toLowerCase().includes(termino) || p.ID_OBRA.toString().includes(termino));
        }

        let rows = datosAExportar.map(p => {
            let baseTotal = $scope.getTotalDinamico(p);
            let row = {
                "ID OBRA": p.ID_OBRA,
                "NOMBRE DE OBRA": p.OBRA,
                "PRESUPUESTO BASE ($)": p.PRESUPUESTO_MONTO,
                "MANO DE OBRA ($)": p.MANO_OBRA_MONTO,
                "% MANO DE OBRA": parseFloat($scope.calcPorcentaje(p.MANO_OBRA_MONTO, p).toFixed(2)),
                "EQUIPOS ($)": p.EQUIPOS_MONTO,
                "% EQUIPOS": parseFloat($scope.calcPorcentaje(p.EQUIPOS_MONTO, p).toFixed(2)),
                "MATERIALES ($)": p.MATERIALES_VARIOS_MONTO,
                "% MATERIALES": parseFloat($scope.calcPorcentaje(p.MATERIALES_VARIOS_MONTO, p).toFixed(2)),
                "LÁMINA ($)": p.LAMINA_MONTO,
                "% LÁMINA": parseFloat($scope.calcPorcentaje(p.LAMINA_MONTO, p).toFixed(2))
            };

            if ($scope.vistaPresupuestos === 'global') {
                row["GASTOS ADMIN NO DED. ($)"] = p.GASTOS_ADMINISTRATIVOS_MONTO;
                row["% GASTOS ADMIN"] = parseFloat($scope.calcPorcentaje(p.GASTOS_ADMINISTRATIVOS_MONTO, p).toFixed(2));
            }
            row["TOTAL INVERSIÓN CALCULADA ($)"] = baseTotal;
            return row;
        });

        const ws = XLSX.utils.json_to_sheet(rows);
        const wb = XLSX.utils.book_new();
        let nombreHoja = $scope.vistaPresupuestos === 'deducible' ? "Presupuestos Deducibles" : "Presupuestos Global";
        
        XLSX.utils.book_append_sheet(wb, ws, nombreHoja);
        let filename = "Reporte_Presupuestos_MarviConfort_" + new Date().toISOString().split('T')[0] + ".xlsx";
        XLSX.writeFile(wb, filename);
    };
});