<?php
header('Content-Type: application/json; charset=utf-8');
header('Access-Control-Allow-Origin: *');
header('Access-Control-Allow-Methods: GET, OPTIONS');
header('Access-Control-Allow-Headers: Content-Type');

if (($_SERVER['REQUEST_METHOD'] ?? '') === 'OPTIONS') {
    http_response_code(204);
    exit;
}

$archivo = __DIR__ . '/../data/gastos.json';

if (!file_exists($archivo)) {
    echo json_encode(['exito' => true, 'registros' => []], JSON_UNESCAPED_UNICODE);
    exit;
}

$contenido = @file_get_contents($archivo);

if ($contenido === false) {
    http_response_code(500);
    echo json_encode([
        'exito' => false,
        'mensaje' => 'No se pudo leer el archivo de registros.',
    ], JSON_UNESCAPED_UNICODE);
    exit;
}

$registros = json_decode($contenido, true);

if (!is_array($registros)) {
    echo json_encode(['exito' => true, 'registros' => []], JSON_UNESCAPED_UNICODE);
    exit;
}

usort($registros, static function ($a, $b) {
    $fechaA = $a['fecha'] ?? '';
    $fechaB = $b['fecha'] ?? '';
    return strcmp($fechaB, $fechaA);
});

echo json_encode([
    'exito' => true,
    'registros' => $registros,
], JSON_UNESCAPED_UNICODE);
