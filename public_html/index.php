<?php
// Set NEXT_APP_URL in cPanel, or replace this value with the public URL of the Node app.
$nextAppUrl = getenv('NEXT_APP_URL') ?: 'https://arathamizh.example.com';

if (!filter_var($nextAppUrl, FILTER_VALIDATE_URL)) {
    http_response_code(500);
    exit('NEXT_APP_URL is not configured.');
}

$requestPath = parse_url($_SERVER['REQUEST_URI'] ?? '/', PHP_URL_PATH) ?: '/';
$query = isset($_SERVER['QUERY_STRING']) && $_SERVER['QUERY_STRING'] !== ''
    ? '?' . $_SERVER['QUERY_STRING']
    : '';
$target = rtrim($nextAppUrl, '/') . $requestPath . $query;

header('Cache-Control: no-store');
header('Location: ' . $target, true, 302);
exit;
