#pragma once

#include <cstdint>

enum class ButtonAction {
  None,
  ShortPress,
  LongPress,
  TripleClick,
  DoubleClickIgnored,
};

struct ButtonTiming {
  std::uint32_t debounce_ms = 40;
  std::uint32_t long_press_ms = 1500;
  std::uint32_t multi_click_window_ms = 600;
};

class ButtonStateMachine {
 public:
  explicit ButtonStateMachine(ButtonTiming timing = {});

  // raw_pressed is already normalized: true means physically pressed,
  // regardless of whether the hardware input is active-low or active-high.
  ButtonAction update(bool raw_pressed, std::uint32_t now_ms);
  void reset(std::uint32_t now_ms = 0);

 private:
  static std::uint32_t elapsed(std::uint32_t now_ms, std::uint32_t since_ms);

  ButtonTiming timing_;
  bool raw_pressed_ = false;
  bool stable_pressed_ = false;
  bool long_emitted_ = false;
  std::uint8_t click_count_ = 0;
  std::uint32_t raw_changed_at_ms_ = 0;
  std::uint32_t pressed_at_ms_ = 0;
  std::uint32_t last_release_at_ms_ = 0;
};
