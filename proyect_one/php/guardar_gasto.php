<?php
header('Content-Type: application/json; charset=utf-8');
header('Access-Control-Allow-Origin: *');
header('Access-Control-Allow-Methods: POST, OPTIONS');
header('Access-Control-Allow-Headers: Content-Type');

if (($_SERVER['REQUEST_METHOD'] ?? '') === 'OPTIONS') {
    http_response_code(204);
    exit;
}

if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
    http_response_code(405);
    echo json_encode(['exito' => false, 'mensaje' => 'Método no permitido.']);
    exit;
}

$raw = file_get_contents('php://input');
$datos = json_decode($raw, true);

if (!is_array($datos)) {
    http_response_code(400);
    echo json_encode(['exito' => false, 'mensaje' => 'Datos inválidos.']);
    exit;
}

$fecha = $datos['fecha'] ?? '';
$tasa = $datos['tasa_bcv'] ?? ($datos['tasa_cambio'] ?? 0);
$presupuesto = $datos['presupuesto_limite'] ?? 0;
$movimientos = $datos['movimientos'] ?? ($datos['gastos'] ?? []);
$totales = $datos['totales'] ?? null;

if (!preg_match('/^\d{4}-\d{2}-\d{2}$/', $fecha)) {
    http_response_code(400);
    echo json_encode(['exito' => false, 'mensaje' => 'Fecha inválida.']);
    exit;
}

if (!is_numeric($tasa) || $tasa <= 0) {
    http_response_code(400);
    echo json_encode(['exito' => false, 'mensaje' => 'Tasa BCV inválida.']);
    exit;
}

if (!is_array($movimientos) || count($movimientos) === 0) {
    http_response_code(400);
    echo json_encode(['exito' => false, 'mensaje' => 'No hay movimientos para guardar.']);
    exit;
}

$monedasPermitidas = ['USD', 'VES'];
$tiposPermitidos = ['gasto', 'ahorro'];
$movimientosLimpios = [];

foreach ($movimientos as $mov) {
    if (!is_array($mov)) {
        continue;
    }

    $descripcion = trim($mov['descripcion'] ?? '');
    $monto = $mov['monto'] ?? 0;
    $moneda = $mov['moneda'] ?? '';
    $tipo = strtolower(trim($mov['tipo'] ?? 'gasto'));

    if ($descripcion === '' || !is_numeric($monto) || $monto <= 0) {
        continue;
    }

    if (!in_array($moneda, $monedasPermitidas, true)) {
        continue;
    }

    if (!in_array($tipo, $tiposPermitidos, true)) {
        $tipo = 'gasto';
    }

    $montoUsd = isset($mov['monto_usd']) && is_numeric($mov['monto_usd'])
        ? round((float) $mov['monto_usd'], 2)
        : ($moneda === 'USD' ? round((float) $monto, 2) : round((float) $monto / (float) $tasa, 2));

    $montoVes = isset($mov['monto_ves']) && is_numeric($mov['monto_ves'])
        ? round((float) $mov['monto_ves'], 2)
        : ($moneda === 'VES' ? round((float) $monto, 2) : round((float) $monto * (float) $tasa, 2));

    $movimientosLimpios[] = [
        'descripcion' => htmlspecialchars($descripcion, ENT_QUOTES, 'UTF-8'),
        'monto' => round((float) $monto, 2),
        'moneda' => $moneda,
        'monto_usd' => $montoUsd,
        'monto_ves' => $montoVes,
        'tipo' => $tipo,
    ];
}

if (count($movimientosLimpios) === 0) {
    http_response_code(400);
    echo json_encode(['exito' => false, 'mensaje' => 'Los movimientos enviados no son válidos.']);
    exit;
}

$gastosUsd = 0;
$gastosVes = 0;
$ahorrosUsd = 0;
$ahorrosVes = 0;

foreach ($movimientosLimpios as $mov) {
    if ($mov['tipo'] === 'ahorro') {
        $ahorrosUsd += $mov['monto_usd'];
        $ahorrosVes += $mov['monto_ves'];
    } else {
        $gastosUsd += $mov['monto_usd'];
        $gastosVes += $mov['monto_ves'];
    }
}

$totalesLimpios = is_array($totales) ? [
    'gastos_usd' => round((float) ($totales['gastos_usd'] ?? $gastosUsd), 2),
    'gastos_ves' => round((float) ($totales['gastos_ves'] ?? $gastosVes), 2),
    'ahorros_usd' => round((float) ($totales['ahorros_usd'] ?? $ahorrosUsd), 2),
    'ahorros_ves' => round((float) ($totales['ahorros_ves'] ?? $ahorrosVes), 2),
] : [
    'gastos_usd' => round($gastosUsd, 2),
    'gastos_ves' => round($gastosVes, 2),
    'ahorros_usd' => round($ahorrosUsd, 2),
    'ahorros_ves' => round($ahorrosVes, 2),
];

$registro = [
    'id' => uniqid('reg_', true),
    'fecha' => $fecha,
    'tasa_bcv' => round((float) $tasa, 4),
    'presupuesto_limite' => round((float) $presupuesto, 2),
    'movimientos' => $movimientosLimpios,
    'totales' => $totalesLimpios,
    'guardado_en' => date('c'),
];

$archivo = __DIR__ . '/../data/gastos.json';
$directorio = dirname($archivo);

if (!is_dir($directorio)) {
    if (!@mkdir($directorio, 0755, true) && !is_dir($directorio)) {
        http_response_code(500);
        echo json_encode([
            'exito' => false,
            'mensaje' => 'No se pudo crear la carpeta data/. Verifica permisos en el servidor.',
        ], JSON_UNESCAPED_UNICODE);
        exit;
    }
}

if (!is_writable($directorio)) {
    http_response_code(500);
    echo json_encode([
        'exito' => false,
        'mensaje' => 'La carpeta data/ no tiene permisos de escritura en el servidor.',
    ], JSON_UNESCAPED_UNICODE);
    exit;
}

if (file_exists($archivo) && !is_writable($archivo)) {
    http_response_code(500);
    echo json_encode([
        'exito' => false,
        'mensaje' => 'El archivo data/gastos.json no tiene permisos de escritura.',
    ], JSON_UNESCAPED_UNICODE);
    exit;
}

$existentes = [];

if (file_exists($archivo)) {
    $contenido = file_get_contents($archivo);
    $decodificado = json_decode($contenido, true);
    if (is_array($decodificado)) {
        $existentes = $decodificado;
    }
}

$existentes[] = $registro;

$json = json_encode($existentes, JSON_PRETTY_PRINT | JSON_UNESCAPED_UNICODE);

if ($json === false || file_put_contents($archivo, $json, LOCK_EX) === false) {
    http_response_code(500);
    echo json_encode(['exito' => false, 'mensaje' => 'No se pudo guardar el archivo.']);
    exit;
}

echo json_encode([
    'exito' => true,
    'mensaje' => 'Registro guardado correctamente.',
    'id' => $registro['id'],
], JSON_UNESCAPED_UNICODE);
