const app = angular.module('marviApp', []);

// Solución CORS
app.config(['$httpProvider', function($httpProvider) {
    $httpProvider.defaults.headers.post['Content-Type'] = 'text/plain;charset=utf-8';
}]);

app.controller('MainController', function($scope, $http, $window, $timeout) {
    
    $scope.resumenes = [];
    const path = $window.location.pathname;
    $scope.activeTab = 0;
    if (path.includes('obras.html')) $scope.activeTab = 1;
    if (path.includes('comprobaciones.html')) $scope.activeTab = 2;
    if (path.includes('reportes.html')) $scope.activeTab = 3;
    if (path.includes('presupuestos.html')) $scope.activeTab = 4;

    $scope.isLoggedIn = sessionStorage.getItem('marvi_logged_in') === 'true';
    $scope.currentUser = sessionStorage.getItem('marvi_user') || 'Desconocido';
    $scope.permissions = JSON.parse(sessionStorage.getItem('marvi_permissions')) || {};

    if (!$scope.isLoggedIn && !path.includes('index.html') && path !== '/' && !path.endsWith('/')) {
        $window.location.href = 'index.html';
    } else if ($scope.isLoggedIn && $scope.activeTab !== 0) {
        const mapTabsToModules = { 1: 'OBRAS', 2: 'COMPROBACIONES', 3: 'REPORTES', 4: 'PRESUPUESTOS' };
        const moduloActual = mapTabsToModules[$scope.activeTab];
        if (moduloActual && $scope.permissions[moduloActual] === 'sin_acceso') {
            alert("No tienes acceso a este módulo.");
            $window.location.href = 'index.html';
        }
    }

    $scope.busqueda = { id: '' };
    $scope.loginData = {};
    $scope.loginError = false;
    $scope.loginErrorMessage = "";
    $scope.loading = false;
    $scope.configError = false;
    $scope.apiUrl = "";
    
    $scope.obras = []; 
    $scope.obraActual = {}; 
    $scope.comprobaciones = [];
    $scope.trabajadoresUnicos = [];
    $scope.gruposPreviosDetectados = false;
    $scope.opcionPeriodoSeleccionado = '';
    
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

    $scope.login = function() {
        if(!$scope.apiUrl) return;
        $scope.loading = true;
        let requestPayload = { action: 'login', payload: { username: $scope.loginData.username, password: $scope.loginData.password } };
        $http.post($scope.apiUrl, JSON.stringify(requestPayload)).then(function(res) {
            if(res.data.success) {
                sessionStorage.setItem('marvi_logged_in', 'true');
                sessionStorage.setItem('marvi_user', res.data.user.usuario);
                sessionStorage.setItem('marvi_permissions', JSON.stringify(res.data.user.permissions));
                if(res.data.user.permissions.OBRAS !== 'sin_acceso') $window.location.href = 'obras.html';
                else if(res.data.user.permissions.COMPROBACIONES !== 'sin_acceso') $window.location.href = 'comprobaciones.html';
                else $window.location.href = 'reportes.html';
            } else {
                $scope.loginError = true;
                $scope.loginErrorMessage = res.data.message;
            }
        }).finally(() => $scope.loading = false);
    };

    $scope.logout = function() { sessionStorage.clear(); $window.location.href = 'index.html'; };

    $scope.syncDataFromServer = function() {
        if(!$scope.apiUrl) return;
        $scope.loading = true;
        $http.get($scope.apiUrl + "?action=getData").then(res => {
            if(res.data.success) {
                $scope.obras = res.data.obras || [];
                $scope.comprobaciones = res.data.comprobaciones || [];
                
                // La variable de resúmenes debe asignarse aquí adentro, cuando "res" ya existe
                $scope.resumenes = res.data.resumenes || [];
                
                // Extraer el autocompletado de TRABAJADOR
                let trabajadores = $scope.comprobaciones.map(c => c.TRABAJADOR).filter(Boolean);
                $scope.trabajadoresUnicos = [...new Set(trabajadores)];
            }
        }).finally(() => $scope.loading = false);
    };

    $scope.obtenerResumenActual = function() {
        if (!$scope.comprobacionActual || !$scope.comprobacionActual.ID_GRUPO_COMPROBACION) return null;
        return $scope.resumenes.find(r => r.ID_GRUPO_COMPROBACION === $scope.comprobacionActual.ID_GRUPO_COMPROBACION);
    };

    $scope.exportarExcel = function(tipo, filtroExtra) {
        let dataComprobaciones = [];
        let dataResumenes = [];
        let nombreArchivo = "";

        if (tipo === 'grupo') {
            if (!$scope.comprobacionActual.ID_GRUPO_COMPROBACION) {
                alert("Primero busca o selecciona un Grupo de Comprobación.");
                return;
            }
            dataComprobaciones = $scope.comprobaciones.filter(c => c.ID_GRUPO_COMPROBACION === $scope.comprobacionActual.ID_GRUPO_COMPROBACION);
            dataResumenes = $scope.resumenes.filter(r => r.ID_GRUPO_COMPROBACION === $scope.comprobacionActual.ID_GRUPO_COMPROBACION);
            nombreArchivo = "Comprobaciones_Grupo_" + $scope.comprobacionActual.ID_GRUPO_COMPROBACION + ".xlsx";
            if(dataComprobaciones.length === 0) { alert("No hay datos en este grupo para exportar."); return; }
        
        } else if (tipo === 'obra') {
            if (!filtroExtra) return;
            
            // 1. Filtramos las comprobaciones de esa obra
            dataComprobaciones = $scope.comprobaciones.filter(c => c.ID_OBRA == filtroExtra);
            
            // 2. Extraemos qué grupos pertenecen a esa obra para traernos sus resúmenes
            let gruposDeObra = [...new Set(dataComprobaciones.map(c => c.ID_GRUPO_COMPROBACION))];
            dataResumenes = $scope.resumenes.filter(r => gruposDeObra.includes(r.ID_GRUPO_COMPROBACION));
            
            // 3. Preparamos el nombre del archivo
            let obraObj = $scope.obras.find(o => o.ID_OBRA == filtroExtra);
            let nombreObraLimpio = obraObj ? obraObj.OBRA.replace(/\s+/g, '_') : filtroExtra;
            nombreArchivo = "Exportacion_Obra_" + nombreObraLimpio + ".xlsx";
            
            // Reseteamos el botón select visualmente
            $scope.obraParaExportar = "";
            
            if(dataComprobaciones.length === 0) { alert("No hay datos registrados en esta obra para exportar."); return; }

        } else {
            dataComprobaciones = $scope.comprobaciones;
            dataResumenes = $scope.resumenes;
            nombreArchivo = "Historial_Completo_Comprobaciones.xlsx";
            if(dataComprobaciones.length === 0) { alert("El historial está vacío."); return; }
        }

        // MAPEO QUIRÚRGICO: Seleccionamos solo las columnas hasta ID_GRUPO_COMPROBACION y en orden
        let exportComprobacionesLimpio = dataComprobaciones.map(c => ({
            "ID_COMPROBACION": c.ID_COMPROBACION,
            "FECHA": c.FECHA,
            "DEDUCIBLE": c.DEDUCIBLE,
            "FACTURA": c.FACTURA,
            "PROVEEDOR": c.PROVEEDOR,
            "TRABAJADOR": c.TRABAJADOR,
            "OBRA": c.OBRA,
            "SUBTOTAL": c.SUBTOTAL,
            "IVA": c.IVA,
            "RET_IVA": c.RET_IVA,
            "RET_ISR": c.RET_ISR,
            "DESCUENTO": c.DESCUENTO,
            "ISH": c.ISH,
            "TOTAL": c.TOTAL,
            "TIPO_DE_PAGO": c.TIPO_DE_PAGO,
            "DESCRIPCION": c.DESCRIPCION,
            "RFC": c.RFC,
            "CATEGORIA": c.CATEGORIA,
            "ID_OBRA": c.ID_OBRA,
            "ID_GRUPO_COMPROBACION": c.ID_GRUPO_COMPROBACION
        }));

        // Creación del Libro de Excel
        const wb = XLSX.utils.book_new();
        
        // Añadir Pestaña 1: Detalle de Comprobaciones
        const wsComp = XLSX.utils.json_to_sheet(exportComprobacionesLimpio);
        XLSX.utils.book_append_sheet(wb, wsComp, "Detalle Comprobaciones");
        
        // Añadir Pestaña 2: Resúmenes Financieros (Si existen)
        if (dataResumenes.length > 0) {
            const wsRes = XLSX.utils.json_to_sheet(dataResumenes);
            XLSX.utils.book_append_sheet(wb, wsRes, "Resumen Financiero");
        }

        // Forzar la descarga
        XLSX.writeFile(wb, nombreArchivo);
    };

    // --- CRUD OBRAS --- (Mantenido intacto)
    $scope.guardarObra = function() {
        if($scope.permissions.OBRAS !== 'total') return;
        if(!confirm($scope.obraActual.ID_OBRA ? "¿Actualizar obra?" : "¿Dar de alta nueva obra?")) return;
        $scope.loading = true;
        let requestPayload = { action: 'saveObra', usuario: $scope.currentUser, payload: $scope.obraActual };
        $http.post($scope.apiUrl, JSON.stringify(requestPayload)).then(res => {
            if(res.data.success) {
                alert($scope.obraActual.ID_OBRA ? "Obra actualizada." : "Obra registrada.");
                $scope.obraActual = {}; $scope.syncDataFromServer();
            } else alert(res.data.message);
        }).finally(() => $scope.loading = false);
    };
    $scope.editarObra = function(o) { $scope.obraActual = angular.copy(o); $window.scrollTo({top:0, behavior: 'smooth'}); };
    $scope.eliminarObra = function(o) { 
        if($scope.permissions.OBRAS !== 'total' || !confirm(`¿Eliminar la obra "${o.OBRA}"?`)) return;
        $scope.loading = true; 
        $http.post($scope.apiUrl, JSON.stringify({action: 'deleteObra', usuario: $scope.currentUser, payload: o})).then(res => {
            if(res.data.success) { alert("Obra eliminada."); $scope.syncDataFromServer(); } else alert(res.data.message); 
        }).finally(() => $scope.loading = false);
    };
    $scope.limpiarObra = function() { $scope.obraActual = {}; };


    // --- LÓGICA DE COMPROBACIONES ---

    // Función auxiliar para parsear fechas string (YYYY-MM-DD) al formato Date que requiere el Input HTML5
    function parseDateString(dateStr) {
        if (!dateStr) return null;
        let parts = dateStr.split('-');
        if (parts.length === 3) {
            return new Date(parts[0], parts[1] - 1, parts[2]); // Evita desfase horario local
        }
        return null;
    }

    // Función auxiliar para convertir Date a String (YYYY-MM-DD) antes de enviar a Google Apps Script
    function formatDateToString(dateObj) {
        if (!dateObj) return '';
        let d = new Date(dateObj);
        if (isNaN(d.getTime())) return '';
        let month = '' + (d.getMonth() + 1), day = '' + d.getDate(), year = d.getFullYear();
        if (month.length < 2) month = '0' + month;
        if (day.length < 2) day = '0' + day;
        return [year, month, day].join('-');
    }

    $scope.buscarComprobacionPorId = function(id_buscado) {
        if(!id_buscado) return;
        // Búsqueda case-insensitive para strings (CMP-...)
        let idLimpio = id_buscado.toString().trim().toUpperCase();
        let encontrada = $scope.comprobaciones.find(c => c.ID_COMPROBACION && c.ID_COMPROBACION.toString().toUpperCase() === idLimpio);
        
        if(encontrada) {
            $scope.comprobacionActual = angular.copy(encontrada);
            // Parsear fechas a objetos Date locales
            $scope.comprobacionActual.FECHA = parseDateString($scope.comprobacionActual.FECHA);
            $scope.comprobacionActual.FECHA_FOLIO_FISCAL = parseDateString($scope.comprobacionActual.FECHA_FOLIO_FISCAL);
            $scope.comprobacionActual.FECHA_PAGO_NO_DEDUCIBLE = parseDateString($scope.comprobacionActual.FECHA_PAGO_NO_DEDUCIBLE);
            
            // SOLUCIÓN: Convertir a Número para que coincida exactamente con la lista de Obras
            if ($scope.comprobacionActual.ID_OBRA) {
                $scope.comprobacionActual.ID_OBRA = parseInt($scope.comprobacionActual.ID_OBRA, 10);
            }
            
            $window.scrollTo({top:0, behavior: 'smooth'});
        } else {
            alert("No se encontró ninguna comprobación con el ID: " + idLimpio);
        }
    };

    $scope.calcularTotal = function(item) {
        if (!item) return; 
        let subtotal = parseFloat(item.SUBTOTAL) || 0;
        let descuento = parseFloat(item.DESCUENTO) || 0;
        let iva = parseFloat(item.IVA) || 0;
        let ish = parseFloat(item.ISH) || 0;
        let retIva = parseFloat(item.RET_IVA) || 0;
        let retIsr = parseFloat(item.RET_ISR) || 0;

        item.TOTAL = parseFloat((subtotal - descuento + iva + ish - retIva - retIsr).toFixed(2));
    };

    $scope.limpiarDependenciasDeducible = function() {
        if ($scope.comprobacionActual.DEDUCIBLE === 'SI') {
            $scope.comprobacionActual.MONTO_TOTAL_NO_DEDUCIBLE_PAGADO = 0;
            $scope.comprobacionActual.FECHA_PAGO_NO_DEDUCIBLE = null;
        } else if ($scope.comprobacionActual.DEDUCIBLE === 'NO') {
            $scope.comprobacionActual.FOLIO_FISCAL = '';
            $scope.comprobacionActual.FECHA_FOLIO_FISCAL = null;
        }
    };

    $scope.evaluarGrupoComprobacion = function() {
        let obra = $scope.comprobacionActual.ID_OBRA;
        let trabajador = $scope.comprobacionActual.TRABAJADOR;

        if (!obra || !trabajador) {
            $scope.gruposPreviosDetectados = false;
            $scope.comprobacionActual.ID_GRUPO_COMPROBACION = '';
            $scope.ultimoFiltroEvaluado = ''; // Reseteo de memoria
            return;
        }

        let obraNorm = obra.toString().trim().toUpperCase();
        let trabNorm = trabajador.toString().trim().toUpperCase().replace(/\s+/g, '_'); 
        let baseId = obraNorm + '-' + trabNorm;

        // CANDADO DE MEMORIA: Previene sobreescrituras accidentales
        if ($scope.ultimoFiltroEvaluado === baseId) {
            return; 
        }
        
        $scope.ultimoFiltroEvaluado = baseId;

        let gruposEncontrados = [];
        if ($scope.comprobaciones && $scope.comprobaciones.length > 0) {
            $scope.comprobaciones.forEach(function(fila) {
                let idFila = fila.ID_GRUPO_COMPROBACION;
                if (idFila && idFila.startsWith(baseId + '-')) {
                    if (gruposEncontrados.indexOf(idFila) === -1) gruposEncontrados.push(idFila);
                }
            });
        }

        if (gruposEncontrados.length === 0) {
            $scope.gruposPreviosDetectados = false;
            $scope.comprobacionActual.ID_GRUPO_COMPROBACION = baseId + '-01';
        } else {
            // 1. Ordenamos el historial para que siempre aparezcan en orden (01, 02, 03...)
            gruposEncontrados.sort();
            
            let maxCiclo = 0;
            gruposEncontrados.forEach(function(id) {
                let partes = id.split('-');
                let cicloNum = parseInt(partes[partes.length - 1], 10);
                if (!isNaN(cicloNum) && cicloNum > maxCiclo) maxCiclo = cicloNum;
            });

            // 2. Exponemos el historial completo a la vista (HTML)
            $scope.gruposHistoricos = gruposEncontrados;
            
            // 3. Calculamos el nuevo consecutivo
            $scope.grupoNuevo = baseId + '-' + ((maxCiclo + 1) < 10 ? '0' : '') + (maxCiclo + 1);
            $scope.gruposPreviosDetectados = true;
            
            // 4. Por defecto, seleccionamos el último periodo utilizado para agilizar el CRUD
            $scope.comprobacionActual.ID_GRUPO_COMPROBACION = gruposEncontrados[gruposEncontrados.length - 1];
        }
    };
    /*
    $scope.aplicarSeleccionPeriodo = function() {
            if ($scope.opcionPeriodoSeleccionado === 'existente') {
                $scope.comprobacionActual.ID_GRUPO_COMPROBACION = $scope.grupoExistente;
            } else if ($scope.opcionPeriodoSeleccionado === 'nuevo') {
                $scope.comprobacionActual.ID_GRUPO_COMPROBACION = $scope.grupoNuevo;
            }
    };
    */
    $scope.guardarComprobacion = function() {
        if($scope.permissions.COMPROBACIONES !== 'total') return;
        
        if(!$scope.comprobacionActual.ID_GRUPO_COMPROBACION) {
            alert("Error: No se ha generado el ID de grupo. Por favor revisa la Obra y el Trabajador.");
            return;
        }

        // --- NUEVA VALIDACIÓN DE MONTO (Regla de Negocio) ---
        if (!$scope.comprobacionActual.TOTAL || $scope.comprobacionActual.TOTAL <= 0) {
            alert("Operación Denegada: El total de la comprobación debe ser mayor a cero.");
            return;
        }

        // Validación de HTML5 manual por si el navegador dejó pasar algo
        let formulario = document.querySelector('form');
        if (formulario && !formulario.checkValidity()) {
            formulario.reportValidity();
            return;
        }

        if(!confirm($scope.comprobacionActual.ID_COMPROBACION ? "¿Actualizar registro?" : "¿Guardar nueva comprobación?")) return;

        // Clonamos el objeto y convertimos fechas a formato ISO YYYY-MM-DD corto
        let payloadPreparado = angular.copy($scope.comprobacionActual);
        payloadPreparado.FECHA = formatDateToString(payloadPreparado.FECHA);
        payloadPreparado.FECHA_FOLIO_FISCAL = formatDateToString(payloadPreparado.FECHA_FOLIO_FISCAL);
        payloadPreparado.FECHA_PAGO_NO_DEDUCIBLE = formatDateToString(payloadPreparado.FECHA_PAGO_NO_DEDUCIBLE);

        $scope.loading = true;
        let requestPayload = { action: 'saveComprobacion', usuario: $scope.currentUser, payload: payloadPreparado };

        $http.post($scope.apiUrl, JSON.stringify(requestPayload)).then(res => {
            if(res.data.success) {
                
                // INYECCIÓN EN MEMORIA LOCAL: Burlamos la latencia de red guardando el registro localmente al instante
                if (!payloadPreparado.ID_COMPROBACION && res.data.idGenerado) {
                    payloadPreparado.ID_COMPROBACION = res.data.idGenerado;
                    $scope.comprobaciones.push(payloadPreparado);
                }

                alert(payloadPreparado.ID_COMPROBACION ? "Comprobación actualizada." : "Comprobación registrada.");
                $scope.limpiarComprobacion();
                $scope.syncDataFromServer();
            } else {
                alert(res.data.message);
            }
        }).catch(err => alert("Error de red al conectar con el servidor.")).finally(() => $scope.loading = false);
    };

    $scope.eliminarComprobacion = function(comprobacion) {
        if($scope.permissions.COMPROBACIONES !== 'total') return;
        
        if(!confirm(`⚠️ ADVERTENCIA: ¿Realmente deseas eliminar de forma permanente la comprobación ${comprobacion.ID_COMPROBACION} de la base de datos? Esta acción actualizará los totales del grupo.`)) {
            return;
        }

        $scope.loading = true;
        let requestPayload = { action: 'deleteComprobacion', usuario: $scope.currentUser, payload: comprobacion };

        $http.post($scope.apiUrl, JSON.stringify(requestPayload)).then(res => {
            if(res.data.success) {
                alert("Comprobación eliminada exitosamente.");
                $scope.limpiarComprobacion();
                $scope.syncDataFromServer(); // Refresca la tabla y los resúmenes
            } else {
                alert(res.data.message);
            }
        }).catch(err => alert("Error de red al conectar con el servidor.")).finally(() => $scope.loading = false);
    };

    $scope.limpiarComprobacion = function() {
        $scope.comprobacionActual = {
            ID_COMPROBACION: null,
            ID_GRUPO_COMPROBACION: '',
            FECHA: null,
            FACTURA: '',
            DEDUCIBLE: '',
            TIPO_DE_PAGO: '',
            PROVEEDOR: '',
            RFC: '',
            TRABAJADOR: '',
            ID_OBRA: '',
            DESCRIPCION: '',
            SUBTOTAL: 0,
            IVA: 0,
            RET_IVA: 0,
            RET_ISR: 0,
            DESCUENTO: 0,
            ISH: 0,
            TOTAL: 0,
            FOLIO_FISCAL: '',
            FECHA_FOLIO_FISCAL: null,
            MONTO_TOTAL_NO_DEDUCIBLE_PAGADO: 0,
            FECHA_PAGO_NO_DEDUCIBLE: null
        };
        
        $scope.gruposPreviosDetectados = false;
        $scope.opcionPeriodoSeleccionado = '';
        
        // APLICACIÓN DE LA REGLA DEL PUNTO: Limpieza directa al objeto
        $scope.busqueda.id = '';
        
        // Vaciamos la memoria de estado para la siguiente captura
        $scope.ultimoFiltroEvaluado = ''; 
    };

    $scope.limpiarComprobacion();
});