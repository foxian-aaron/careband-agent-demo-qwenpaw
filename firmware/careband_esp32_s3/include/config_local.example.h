#pragma once

// Copy this file to config_local.h and edit that ignored local file.
// Never commit a real SSID, password, token, or production endpoint.
#define CAREBAND_WIFI_SSID "REPLACE_WITH_DEMO_WIFI"
#define CAREBAND_WIFI_PASSWORD "REPLACE_WITH_DEMO_WIFI_PASSWORD"
#define CAREBAND_EVENTS_URL "http://192.168.1.100:8787/api/events"

#define CAREBAND_DEVICE_ID "careband-proto-001"
#define CAREBAND_ELDER_ID "E001"

// Example pins for an external common-cathode RGB LED and transistor-driven motor.
// Confirm the labels on the exact ESP32-S3 DevKitC-1 revision before wiring.
#define CAREBAND_PIN_BUTTON 4
#define CAREBAND_PIN_LED_RED 5
#define CAREBAND_PIN_LED_GREEN 6
#define CAREBAND_PIN_LED_BLUE 7
#define CAREBAND_PIN_VIBRATION 8

#define CAREBAND_BUTTON_ACTIVE_LOW 1
#define CAREBAND_LED_ACTIVE_HIGH 1
#define CAREBAND_VIBRATION_ACTIVE_HIGH 1
