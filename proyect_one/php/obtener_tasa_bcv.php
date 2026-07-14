<?php
header('Content-Type: application/json; charset=utf-8');
header('Cache-Control: public, max-age=1800');

$cacheTtl = ;
$cacheStaleTtl = ;
$cacheFile = __DIR__ . ';

function responderTasa(array $payload, int $codigo = 200): void
{
    http_response_code($codigo);
    echo json_encode($payload, JSON_UNESCAPED_UNICODE);
    exit;
}

function leerCache(string $archivo): ?array
{
    if (!file_exists($archivo)) {
        return null;
    }

    $cache = json_decode(file_get_contents($archivo), true);
    return is_array($cache) ? $cache : null;
}

function guardarCache(string $archivo, array $payload): void
{
    $directorio = dirname($archivo);
    if (!is_dir($directorio)) {
        mkdir($directorio, 0755, true);
    }

    file_put_contents($archivo, json_encode($payload, JSON_PRETTY_PRINT | JSON_UNESCAPED_UNICODE), LOCK_EX);
}

function extraerTasaDesdeJson(array $datos): ?array
{
    if (isset($datos['USD']) && is_numeric($datos['USD']) && (float) $datos['USD'] > 0) {
        return [
            'tasa' => round((float) $datos['USD'], 4),
            'fecha_efectiva' => $datos['effective_date'] ?? ($datos['date'] ?? date('Y-m-d')),
            'actualizado_en' => $datos['updated_at'] ?? null,
            'fuente' => ' ( )',
        ];
    }

    if (isset($datos['data']['dolar']['value'])) {
        $valor = str_replace(',', '.', (string) $datos['data']['dolar']['value']);
        if (is_numeric($valor) && (float) $valor > 0) {
            return [
                'tasa' => round((float) $valor, 4),
                'fecha_efectiva' => $datos['data']['effective_date'] ?? date('Y-m-d'),
                'actualizado_en' => $datos['data']['run_timestamp'] ?? null,
                'fuente' => 'bcv.org.ve',
            ];
        }
    }

    if (isset($datos['rate']) && is_numeric($datos['rate']) && (float) $datos['rate'] > 0) {
        return [
            'tasa' => round((float) $datos['rate'], 4),
            'fecha_efectiva' => $datos['date'] ?? date('Y-m-d'),
            'actualizado_en' => $datos['updated_at'] ?? null,
            'fuente' => ' ',
        ];
    }

    return null;
}

function httpGet(string $url): ?string
{
    if (function_exists('curl_init')) {
        $ch = curl_init($url);
        curl_setopt_array($ch, [
            CURLOPT_RETURNTRANSFER => true,
            CURLOPT_FOLLOWLOCATION => true,
            CURLOPT_CONNECTTIMEOUT => 8,
            CURLOPT_TIMEOUT => 12,
            CURLOPT_SSL_VERIFYPEER => true,
            CURLOPT_SSL_VERIFYHOST => 2,
            CURLOPT_HTTPHEADER => [
                'Accept: application/json',
                'User-Agent:  ( )',
            ],
        ]);

        $respuesta = curl_exec($ch);
        $codigo = (int) curl_getinfo($ch, CURLINFO_HTTP_CODE);
        curl_close($ch);

        if ($respuesta !== false && $codigo >= 200 && $codigo < 300) {
            return $respuesta;
        }
    }

    if (!ini_get('allow_url_fopen')) {
        return null;
    }

    $context = stream_context_create([
        'http' => [
            'method' => 'GET',
            'timeout' => 12,
            'header' => "Accept: application/json\r\nUser-Agent: ",
        ],
        'ssl' => [
            'verify_peer' => true,
            'verify_peer_name' => true,
        ],
    ]);

    $respuesta = @file_get_contents($url, false, $context);
    return $respuesta === false ? null : $respuesta;
}

function obtenerTasaRemota(): ?array
{
    $fuentes = [
        'https:',
        'https://raw.githubusercontent.com/grupoclip/bcv-api/main/api/v1/rate.json',
    ];

    foreach ($fuentes as $url) {
        $respuesta = httpGet($url);
        if ($respuesta === null) {
            continue;
        }

        $datos = json_decode($respuesta, true);
        if (!is_array($datos)) {
            continue;
        }

        $tasa = extraerTasaDesdeJson($datos);
        if ($tasa !== null) {
            return $tasa;
        }
    }

    return null;
}

$cache = leerCache($cacheFile);

if (
    is_array($cache)
    && isset($cache['tasa'], $cache['fecha_efectiva'], $cache['obtenido_en'])
    && (time() - (int) $cache['obtenido_en']) < $cacheTtl
) {
    responderTasa([
        'exito' => true,
        'tasa' => (float) $cache['tasa'],
        'fecha_efectiva' => $cache['fecha_efectiva'],
        'actualizado_en' => $cache['actualizado_en'] ?? null,
        'fuente' => $cache['fuente'] ?? '',
        'cache' => true,
    ]);
}

$remota = obtenerTasaRemota();

if ($remota !== null) {
    $cachePayload = array_merge($remota, ['obtenido_en' => time()]);
    guardarCache($cacheFile, $cachePayload);

    responderTasa([
        'exito' => true,
        'tasa' => $remota['tasa'],
        'fecha_efectiva' => $remota['fecha_efectiva'],
        'actualizado_en' => $remota['actualizado_en'],
        'fuente' => $remota['fuente'],
        'cache' => false,
    ]);
}

if (
    is_array($cache)
    && isset($cache['tasa'], $cache['fecha_efectiva'], $cache['obtenido_en'])
    && (time() - (int) $cache['obtenido_en']) < $cacheStaleTtl
) {
    responderTasa([
        'exito' => true,
        'tasa' => (float) $cache['tasa'],
        'fecha_efectiva' => $cache['fecha_efectiva'],
        'actualizado_en' => $cache['actualizado_en'] ?? null,
        'fuente' => ($cache['fuente'] ?? '') . ' (caché)',
        'cache' => true,
        'desactualizada' => true,
    ]);
}

responderTasa([
    'exito' => false,
    'mensaje' => 'No se pudo obtener la tasa del BCV. El servidor no tiene acceso a internet o las fuentes no están disponibles.',
], 503);
