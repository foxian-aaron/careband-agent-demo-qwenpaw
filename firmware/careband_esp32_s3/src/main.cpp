#include <Arduino.h>
#include <ArduinoJson.h>
#include <HTTPClient.h>
#include <WiFi.h>
#include <esp_system.h>
#include <time.h>
#include <utility>

#include "button_state_machine.h"
#include "event_identity.h"
#include "retry_queue.h"

#if __has_include("config_local.h")
#include "config_local.h"
#else
#include "config_local.example.h"
#warning "Using placeholder config_local.example.h; copy it to config_local.h before a live demo."
#endif

namespace {

constexpr std::uint32_t kWifiRetryMs = 5000;
constexpr std::uint32_t kHttpTimeoutMs = 3500;
constexpr std::uint32_t kRetryBaseMs = 2000;
constexpr std::uint32_t kRetryMaxMs = 30000;

enum class LedState {
  Boot,
  Disconnected,
  Idle,
  Sending,
  UrgentQueued,
  Success,
  QueueFull,
  DeliveryRejected,
};

void printJson(const JsonDocument& doc) {
  serializeJson(doc, Serial);
  Serial.println();
}

void logDebug(const char* message, int http_status = 0,
              std::uint32_t latency_ms = 0) {
  JsonDocument doc;
  doc["kind"] = "debug";
  doc["message"] = message;
  if (http_status != 0) doc["http_status"] = http_status;
  if (latency_ms != 0) doc["latency_ms"] = latency_ms;
  printJson(doc);
}

class IndicatorController {
 public:
  void begin(std::size_t queue_size) {
    pinMode(CAREBAND_PIN_LED_RED, OUTPUT);
    pinMode(CAREBAND_PIN_LED_GREEN, OUTPUT);
    pinMode(CAREBAND_PIN_LED_BLUE, OUTPUT);
    pinMode(CAREBAND_PIN_VIBRATION, OUTPUT);
    setLed(false, false, false);
    setMotor(false);
    setState(LedState::Boot, millis(), queue_size);
  }

  void setState(LedState state, std::uint32_t now_ms,
                std::size_t queue_size) {
    if (state_ != state) {
      state_ = state;
      state_started_at_ms_ = now_ms;
    }
    logState(queue_size);
  }

  LedState state() const { return state_; }

  void vibrate(std::uint8_t pulses, std::uint32_t now_ms) {
    setMotor(false);
    vibration_transitions_remaining_ = pulses * 2;
    vibration_next_transition_at_ms_ = now_ms;
    vibration_on_ = false;
    switch (pulses) {
      case 1:
        vibration_pattern_ = "single";
        break;
      case 2:
        vibration_pattern_ = "double";
        break;
      case 3:
        vibration_pattern_ = "triple";
        break;
      default:
        vibration_pattern_ = pulses == 0 ? "off" : "alert";
        break;
    }
  }

  void update(std::uint32_t now_ms) {
    if (vibration_transitions_remaining_ > 0 &&
        static_cast<std::int32_t>(now_ms - vibration_next_transition_at_ms_) >=
            0) {
      vibration_on_ = !vibration_on_;
      setMotor(vibration_on_);
      --vibration_transitions_remaining_;
      vibration_next_transition_at_ms_ = now_ms + (vibration_on_ ? 120 : 100);
      if (vibration_transitions_remaining_ == 0) {
        vibration_pattern_ = "off";
      }
    }

    const auto phase = (now_ms / 250U) % 2U;
    switch (state_) {
      case LedState::Boot:
        setLed(false, false, true);
        break;
      case LedState::Disconnected:
        setLed(phase == 0, phase == 0, false);
        break;
      case LedState::Idle:
        setLed(false, true, false);
        break;
      case LedState::Sending:
        setLed(true, true, false);
        break;
      case LedState::UrgentQueued:
        setLed(phase == 0, false, false);
        break;
      case LedState::Success:
        setLed(false, true, phase == 0);
        if (now_ms - state_started_at_ms_ >= 1200) {
          setState(WiFi.status() == WL_CONNECTED ? LedState::Idle
                                                : LedState::Disconnected,
                   now_ms, 0);
        }
        break;
      case LedState::QueueFull:
        setLed(true, false, true);
        break;
      case LedState::DeliveryRejected:
        setLed(phase == 0, false, phase == 0);
        if (now_ms - state_started_at_ms_ >= 2000) {
          setState(WiFi.status() == WL_CONNECTED ? LedState::Idle
                                                : LedState::Disconnected,
                   now_ms, 0);
        }
        break;
    }
  }

 private:
  static void writeActive(int pin, bool on, bool active_high) {
    digitalWrite(pin, on == active_high ? HIGH : LOW);
  }

  void setLed(bool red, bool green, bool blue) {
    writeActive(CAREBAND_PIN_LED_RED, red, CAREBAND_LED_ACTIVE_HIGH != 0);
    writeActive(CAREBAND_PIN_LED_GREEN, green, CAREBAND_LED_ACTIVE_HIGH != 0);
    writeActive(CAREBAND_PIN_LED_BLUE, blue, CAREBAND_LED_ACTIVE_HIGH != 0);
  }

  void setMotor(bool on) {
    writeActive(CAREBAND_PIN_VIBRATION, on,
                CAREBAND_VIBRATION_ACTIVE_HIGH != 0);
  }

  void logState(std::size_t queue_size) const {
    const char* state_name = "unknown";
    const char* led_name = "off";
    switch (state_) {
      case LedState::Boot:
        state_name = "boot_blue";
        led_name = "blue";
        break;
      case LedState::Disconnected:
        state_name = "disconnected_yellow_blink";
        led_name = "yellow_blink";
        break;
      case LedState::Idle:
        state_name = "idle_green";
        led_name = "green";
        break;
      case LedState::Sending:
        state_name = "sending_yellow";
        led_name = "yellow";
        break;
      case LedState::UrgentQueued:
        state_name = "urgent_red_blink";
        led_name = "red_blink";
        break;
      case LedState::Success:
        state_name = "success_green_blue";
        led_name = "cyan_blink";
        break;
      case LedState::QueueFull:
        state_name = "queue_full_magenta";
        led_name = "magenta";
        break;
      case LedState::DeliveryRejected:
        state_name = "delivery_rejected_magenta_blink";
        led_name = "magenta_blink";
        break;
    }
    JsonDocument doc;
    doc["kind"] = "state";
    doc["device_id"] = CAREBAND_DEVICE_ID;
    doc["indicator"] = state_name;
    doc["led"] = led_name;
    doc["vibration"] = vibration_pattern_;
    doc["wifi"] = WiFi.status() == WL_CONNECTED ? "connected" : "disconnected";
    doc["queue_size"] = queue_size;
    printJson(doc);
  }

  LedState state_ = LedState::Boot;
  std::uint32_t state_started_at_ms_ = 0;
  bool vibration_on_ = false;
  std::uint8_t vibration_transitions_remaining_ = 0;
  std::uint32_t vibration_next_transition_at_ms_ = 0;
  const char* vibration_pattern_ = "off";
};

ButtonStateMachine button;
IndicatorController indicators;
RetryQueue retry_queue;
std::uint32_t next_wifi_attempt_at_ms = 0;
std::uint32_t event_sequence = 0;
std::uint32_t boot_nonce = 0;

String utcNowIso8601() {
  const time_t now = time(nullptr);
  if (now < 1700000000) return {};
  struct tm utc_time {};
  gmtime_r(&now, &utc_time);
  char buffer[25];
  strftime(buffer, sizeof(buffer), "%Y-%m-%dT%H:%M:%SZ", &utc_time);
  return String(buffer);
}

std::string makeEventId(std::uint32_t now_ms) {
  ++event_sequence;
  return formatEventId(CAREBAND_DEVICE_ID, boot_nonce, now_ms, event_sequence);
}

void logEvent(const QueuedEvent& event, const char* button_pattern,
              std::uint32_t occurred_at_ms) {
  JsonDocument doc;
  doc["kind"] = "event";
  doc["event_id"] = event.event_id.c_str();
  doc["device_id"] = CAREBAND_DEVICE_ID;
  doc["elder_id"] = CAREBAND_ELDER_ID;
  doc["event_type"] = event.event_type.c_str();
  doc["button_pattern"] = button_pattern;
  doc["occurred_at_ms"] = occurred_at_ms;
  doc["queue_size"] = retry_queue.size();
  printJson(doc);
}

QueuedEvent buildEvent(const char* event_type, const char* action,
                       const char* button_pattern, std::uint32_t now_ms) {
  QueuedEvent event;
  event.event_id = makeEventId(now_ms);
  event.event_type = event_type;
  event.next_attempt_at_ms = now_ms;

  JsonDocument doc;
  doc["event_id"] = event.event_id.c_str();
  doc["elder_id"] = CAREBAND_ELDER_ID;
  doc["event_type"] = event_type;
  doc["source"] = "esp32";
  doc["severity_hint"] = strcmp(event_type, "sos") == 0 ? "urgent" : "watch";
  doc["data_quality"] = "high";
  const String occurred_at = utcNowIso8601();
  if (!occurred_at.isEmpty()) doc["occurred_at"] = occurred_at;
  JsonObject payload = doc["payload"].to<JsonObject>();
  payload["action"] = action;
  payload["button_pattern"] = button_pattern;
  payload["device_id"] = CAREBAND_DEVICE_ID;
  payload["device_uptime_ms"] = now_ms;
  payload["retry_storage"] = "ram_only";
  String body;
  serializeJson(doc, body);
  event.body = body.c_str();
  return event;
}

void enqueueButtonEvent(const char* event_type, const char* action,
                        const char* button_pattern, std::uint8_t vibration_pulses,
                        std::uint32_t now_ms) {
  auto event = buildEvent(event_type, action, button_pattern, now_ms);
  const auto log_copy = event;
  const auto push_result = retry_queue.push(std::move(event));
  if (push_result == QueuePushResult::RejectedReservedForSos ||
      push_result == QueuePushResult::RejectedFullOfSos) {
    indicators.vibrate(4, now_ms);
    indicators.setState(LedState::QueueFull, now_ms, retry_queue.size());
    logDebug(push_result == QueuePushResult::RejectedReservedForSos
                 ? "queue_slot_reserved_for_sos_event_not_stored"
                 : "queue_full_of_sos_event_not_stored");
    return;
  }
  if (push_result == QueuePushResult::AcceptedAfterNonUrgentEviction) {
    logDebug("oldest_non_urgent_evicted_for_sos");
  }
  logEvent(log_copy, button_pattern, now_ms);
  indicators.vibrate(vibration_pulses, now_ms);
  indicators.setState(strcmp(event_type, "sos") == 0 ? LedState::UrgentQueued
                                                     : LedState::Sending,
                      now_ms, retry_queue.size());
}

void handleButtonAction(ButtonAction action, std::uint32_t now_ms) {
  switch (action) {
    case ButtonAction::ShortPress:
      enqueueButtonEvent("medication", "confirmed", "short_press", 1, now_ms);
      break;
    case ButtonAction::LongPress:
      enqueueButtonEvent("sos", "triggered", "long_press", 3, now_ms);
      break;
    case ButtonAction::TripleClick:
      enqueueButtonEvent("sos", "triggered", "triple_click", 3, now_ms);
      break;
    case ButtonAction::DoubleClickIgnored:
      logDebug("double_click_ignored");
      break;
    case ButtonAction::None:
      break;
  }
}

void maintainWifi(std::uint32_t now_ms) {
  if (WiFi.status() == WL_CONNECTED) return;
  if (static_cast<std::int32_t>(now_ms - next_wifi_attempt_at_ms) < 0) return;
  WiFi.disconnect();
  WiFi.begin(CAREBAND_WIFI_SSID, CAREBAND_WIFI_PASSWORD);
  next_wifi_attempt_at_ms = now_ms + kWifiRetryMs;
  indicators.setState(retry_queue.hasUrgent() ? LedState::UrgentQueued
                                             : LedState::Disconnected,
                      now_ms, retry_queue.size());
  logDebug("wifi_connect_attempt");
}

std::uint32_t retryDelayMs(std::uint8_t attempts) {
  const auto shift = attempts > 4 ? 4 : attempts;
  const auto delay_ms = kRetryBaseMs << shift;
  return delay_ms > kRetryMaxMs ? kRetryMaxMs : delay_ms;
}

void processRetryQueue(std::uint32_t now_ms) {
  auto* event = retry_queue.front();
  if (event == nullptr || WiFi.status() != WL_CONNECTED) return;
  if (static_cast<std::int32_t>(now_ms - event->next_attempt_at_ms) < 0) return;

  indicators.setState(LedState::Sending, now_ms, retry_queue.size());
  HTTPClient http;
  http.setTimeout(kHttpTimeoutMs);
  http.begin(CAREBAND_EVENTS_URL);
  http.addHeader("Content-Type", "application/json");
  const auto started_at_ms = millis();
  const int status = http.POST(String(event->body.c_str()));
  const auto latency_ms = millis() - started_at_ms;
  http.end();

  const auto disposition = classifyHttpStatus(status);
  if (disposition == DeliveryDisposition::Success) {
    logDebug("upload_ok", status, latency_ms);
    retry_queue.pop();
    indicators.vibrate(2, now_ms);
    indicators.setState(retry_queue.hasUrgent() ? LedState::UrgentQueued
                                               : LedState::Success,
                        now_ms, retry_queue.size());
    return;
  }

  if (disposition == DeliveryDisposition::RejectWithoutRetry) {
    logDebug("upload_rejected_not_retried", status, latency_ms);
    retry_queue.pop();
    indicators.vibrate(4, now_ms);
    indicators.setState(retry_queue.hasUrgent() ? LedState::UrgentQueued
                                               : LedState::DeliveryRejected,
                        now_ms, retry_queue.size());
    return;
  }

  ++event->attempts;
  event->next_attempt_at_ms = now_ms + retryDelayMs(event->attempts);
  logDebug("upload_retry_scheduled", status, latency_ms);
  indicators.setState(retry_queue.hasUrgent() ? LedState::UrgentQueued
                                             : LedState::Disconnected,
                      now_ms, retry_queue.size());
}

}  // namespace

void setup() {
  Serial.begin(115200);
  delay(250);
  boot_nonce = esp_random();
  if (boot_nonce == 0) {
    boot_nonce = static_cast<std::uint32_t>(ESP.getEfuseMac()) ^ micros();
  }
  indicators.begin(retry_queue.size());

  pinMode(CAREBAND_PIN_BUTTON,
          CAREBAND_BUTTON_ACTIVE_LOW ? INPUT_PULLUP : INPUT_PULLDOWN);
  WiFi.mode(WIFI_STA);
  configTime(0, 0, "pool.ntp.org", "time.nist.gov");
  maintainWifi(millis());
  logDebug("careband_firmware_ready");
}

void loop() {
  const auto now_ms = millis();
  const bool input_high = digitalRead(CAREBAND_PIN_BUTTON) == HIGH;
  const bool raw_pressed = CAREBAND_BUTTON_ACTIVE_LOW ? !input_high : input_high;
  handleButtonAction(button.update(raw_pressed, now_ms), now_ms);
  maintainWifi(now_ms);
  processRetryQueue(now_ms);

  if (WiFi.status() == WL_CONNECTED && retry_queue.size() == 0 &&
      indicators.state() == LedState::Disconnected) {
    indicators.setState(LedState::Idle, now_ms, retry_queue.size());
    logDebug("wifi_connected");
  }
  indicators.update(now_ms);
  delay(5);
}
