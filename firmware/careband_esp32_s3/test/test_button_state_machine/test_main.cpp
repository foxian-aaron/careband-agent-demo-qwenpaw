#include <unity.h>

#include "button_state_machine.h"

void setUp() {}
void tearDown() {}

namespace {

void settle(ButtonStateMachine& button, bool pressed, std::uint32_t at_ms) {
  TEST_ASSERT_EQUAL_INT(static_cast<int>(ButtonAction::None),
                        static_cast<int>(button.update(pressed, at_ms)));
  TEST_ASSERT_EQUAL_INT(
      static_cast<int>(ButtonAction::None),
      static_cast<int>(button.update(pressed, at_ms + 40)));
}

void click(ButtonStateMachine& button, std::uint32_t at_ms) {
  settle(button, true, at_ms);
  settle(button, false, at_ms + 100);
}

void test_bounce_does_not_create_an_event() {
  ButtonStateMachine button;
  TEST_ASSERT_EQUAL_INT(static_cast<int>(ButtonAction::None),
                        static_cast<int>(button.update(true, 10)));
  TEST_ASSERT_EQUAL_INT(static_cast<int>(ButtonAction::None),
                        static_cast<int>(button.update(false, 20)));
  TEST_ASSERT_EQUAL_INT(static_cast<int>(ButtonAction::None),
                        static_cast<int>(button.update(true, 30)));
  TEST_ASSERT_EQUAL_INT(static_cast<int>(ButtonAction::None),
                        static_cast<int>(button.update(false, 60)));
  TEST_ASSERT_EQUAL_INT(static_cast<int>(ButtonAction::None),
                        static_cast<int>(button.update(false, 700)));
}

void test_single_click_becomes_delayed_short_press() {
  ButtonStateMachine button;
  click(button, 100);
  TEST_ASSERT_EQUAL_INT(
      static_cast<int>(ButtonAction::None),
      static_cast<int>(button.update(false, 839)));
  TEST_ASSERT_EQUAL_INT(
      static_cast<int>(ButtonAction::ShortPress),
      static_cast<int>(button.update(false, 840)));
}

void test_long_press_emits_once_while_held() {
  ButtonStateMachine button;
  settle(button, true, 100);
  TEST_ASSERT_EQUAL_INT(
      static_cast<int>(ButtonAction::LongPress),
      static_cast<int>(button.update(true, 1640)));
  TEST_ASSERT_EQUAL_INT(static_cast<int>(ButtonAction::None),
                        static_cast<int>(button.update(true, 2200)));
  settle(button, false, 2300);
  TEST_ASSERT_EQUAL_INT(static_cast<int>(ButtonAction::None),
                        static_cast<int>(button.update(false, 3000)));
}

void test_three_clicks_emit_triple_click_without_short_press() {
  ButtonStateMachine button;
  click(button, 100);
  click(button, 300);
  settle(button, true, 500);
  TEST_ASSERT_EQUAL_INT(static_cast<int>(ButtonAction::None),
                        static_cast<int>(button.update(false, 600)));
  TEST_ASSERT_EQUAL_INT(
      static_cast<int>(ButtonAction::TripleClick),
      static_cast<int>(button.update(false, 640)));
  TEST_ASSERT_EQUAL_INT(static_cast<int>(ButtonAction::None),
                        static_cast<int>(button.update(false, 1300)));
}

void test_two_clicks_are_explicitly_ignored() {
  ButtonStateMachine button;
  click(button, 100);
  click(button, 300);
  TEST_ASSERT_EQUAL_INT(
      static_cast<int>(ButtonAction::DoubleClickIgnored),
      static_cast<int>(button.update(false, 1040)));
}

}  // namespace

int main(int, char**) {
  UNITY_BEGIN();
  RUN_TEST(test_bounce_does_not_create_an_event);
  RUN_TEST(test_single_click_becomes_delayed_short_press);
  RUN_TEST(test_long_press_emits_once_while_held);
  RUN_TEST(test_three_clicks_emit_triple_click_without_short_press);
  RUN_TEST(test_two_clicks_are_explicitly_ignored);
  return UNITY_END();
}
