#include "button_state_machine.h"

ButtonStateMachine::ButtonStateMachine(ButtonTiming timing) : timing_(timing) {}

std::uint32_t ButtonStateMachine::elapsed(std::uint32_t now_ms,
                                          std::uint32_t since_ms) {
  // Unsigned subtraction remains correct across millis() rollover.
  return now_ms - since_ms;
}

void ButtonStateMachine::reset(std::uint32_t now_ms) {
  raw_pressed_ = false;
  stable_pressed_ = false;
  long_emitted_ = false;
  click_count_ = 0;
  raw_changed_at_ms_ = now_ms;
  pressed_at_ms_ = now_ms;
  last_release_at_ms_ = now_ms;
}

ButtonAction ButtonStateMachine::update(bool raw_pressed,
                                        std::uint32_t now_ms) {
  if (raw_pressed != raw_pressed_) {
    raw_pressed_ = raw_pressed;
    raw_changed_at_ms_ = now_ms;
  }

  if (raw_pressed_ != stable_pressed_ &&
      elapsed(now_ms, raw_changed_at_ms_) >= timing_.debounce_ms) {
    stable_pressed_ = raw_pressed_;

    if (stable_pressed_) {
      pressed_at_ms_ = now_ms;
      long_emitted_ = false;
    } else if (!long_emitted_) {
      if (elapsed(now_ms, pressed_at_ms_) >= timing_.long_press_ms) {
        click_count_ = 0;
        long_emitted_ = true;
        return ButtonAction::LongPress;
      }

      ++click_count_;
      last_release_at_ms_ = now_ms;
      if (click_count_ >= 3) {
        click_count_ = 0;
        return ButtonAction::TripleClick;
      }
    }
  }

  if (stable_pressed_ && !long_emitted_ &&
      elapsed(now_ms, pressed_at_ms_) >= timing_.long_press_ms) {
    long_emitted_ = true;
    click_count_ = 0;
    return ButtonAction::LongPress;
  }

  if (!stable_pressed_ && click_count_ > 0 &&
      elapsed(now_ms, last_release_at_ms_) >=
          timing_.multi_click_window_ms) {
    const auto completed_clicks = click_count_;
    click_count_ = 0;
    return completed_clicks == 1 ? ButtonAction::ShortPress
                                 : ButtonAction::DoubleClickIgnored;
  }

  return ButtonAction::None;
}
