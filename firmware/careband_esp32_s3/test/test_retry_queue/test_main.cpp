#include <unity.h>

#include <string>

#include "event_identity.h"
#include "retry_queue.h"

void setUp() {}
void tearDown() {}

namespace {

QueuedEvent makeEvent(const char* id, const char* type) {
  QueuedEvent event;
  event.event_id = id;
  event.event_type = type;
  event.body = "{}";
  return event;
}

void test_network_and_5xx_retry_but_4xx_does_not() {
  TEST_ASSERT_EQUAL_INT(static_cast<int>(DeliveryDisposition::Retry),
                        static_cast<int>(classifyHttpStatus(-1)));
  TEST_ASSERT_EQUAL_INT(static_cast<int>(DeliveryDisposition::Retry),
                        static_cast<int>(classifyHttpStatus(0)));
  TEST_ASSERT_EQUAL_INT(static_cast<int>(DeliveryDisposition::Retry),
                        static_cast<int>(classifyHttpStatus(500)));
  TEST_ASSERT_EQUAL_INT(static_cast<int>(DeliveryDisposition::Retry),
                        static_cast<int>(classifyHttpStatus(503)));
  TEST_ASSERT_EQUAL_INT(
      static_cast<int>(DeliveryDisposition::RejectWithoutRetry),
      static_cast<int>(classifyHttpStatus(400)));
  TEST_ASSERT_EQUAL_INT(
      static_cast<int>(DeliveryDisposition::RejectWithoutRetry),
      static_cast<int>(classifyHttpStatus(404)));
  TEST_ASSERT_EQUAL_INT(
      static_cast<int>(DeliveryDisposition::RejectWithoutRetry),
      static_cast<int>(classifyHttpStatus(429)));
  TEST_ASSERT_EQUAL_INT(static_cast<int>(DeliveryDisposition::Success),
                        static_cast<int>(classifyHttpStatus(201)));
}

void test_one_slot_is_reserved_for_sos() {
  RetryQueue queue;
  for (int i = 0; i < 7; ++i) {
    const auto result = queue.push(makeEvent(("med-" + std::to_string(i)).c_str(),
                                             "medication"));
    TEST_ASSERT_EQUAL_INT(static_cast<int>(QueuePushResult::Accepted),
                          static_cast<int>(result));
  }
  TEST_ASSERT_EQUAL_INT(
      static_cast<int>(QueuePushResult::RejectedReservedForSos),
      static_cast<int>(queue.push(makeEvent("med-8", "medication"))));
  TEST_ASSERT_EQUAL_INT(static_cast<int>(QueuePushResult::Accepted),
                        static_cast<int>(queue.push(makeEvent("sos-1", "sos"))));
  TEST_ASSERT_EQUAL_UINT32(8, queue.size());
  TEST_ASSERT_TRUE(queue.hasUrgent());
}

void test_sos_preempts_oldest_non_urgent_when_full() {
  RetryQueue queue;
  for (int i = 0; i < 7; ++i) {
    queue.push(makeEvent(("med-" + std::to_string(i)).c_str(), "medication"));
  }
  queue.push(makeEvent("sos-1", "sos"));

  TEST_ASSERT_EQUAL_INT(
      static_cast<int>(QueuePushResult::AcceptedAfterNonUrgentEviction),
      static_cast<int>(queue.push(makeEvent("sos-2", "sos"))));
  TEST_ASSERT_EQUAL_UINT32(8, queue.size());
  TEST_ASSERT_EQUAL_STRING("med-1", queue.front()->event_id.c_str());

  bool saw_first_sos = false;
  bool saw_second_sos = false;
  while (queue.front() != nullptr) {
    saw_first_sos |= queue.front()->event_id == "sos-1";
    saw_second_sos |= queue.front()->event_id == "sos-2";
    TEST_ASSERT_NOT_EQUAL(0, queue.front()->event_id.compare("med-0"));
    queue.pop();
  }
  TEST_ASSERT_TRUE(saw_first_sos);
  TEST_ASSERT_TRUE(saw_second_sos);
}

void test_queue_full_of_sos_rejects_ninth_sos() {
  RetryQueue queue;
  for (int i = 0; i < 8; ++i) {
    TEST_ASSERT_EQUAL_INT(
        static_cast<int>(QueuePushResult::Accepted),
        static_cast<int>(
            queue.push(makeEvent(("sos-" + std::to_string(i)).c_str(), "sos"))));
  }
  TEST_ASSERT_EQUAL_INT(
      static_cast<int>(QueuePushResult::RejectedFullOfSos),
      static_cast<int>(queue.push(makeEvent("sos-9", "sos"))));
  TEST_ASSERT_EQUAL_UINT32(8, queue.size());
}

void test_fifo_order_remains_stable_without_preemption() {
  RetryQueue queue;
  queue.push(makeEvent("one", "medication"));
  queue.push(makeEvent("two", "medication"));
  TEST_ASSERT_EQUAL_STRING("one", queue.front()->event_id.c_str());
  queue.pop();
  TEST_ASSERT_EQUAL_STRING("two", queue.front()->event_id.c_str());
  queue.pop();
  TEST_ASSERT_NULL(queue.front());
}

void test_boot_nonce_prevents_restart_event_id_collision() {
  const auto first_boot = formatEventId("proto-1", 0x12345678, 1500, 1);
  const auto second_boot = formatEventId("proto-1", 0x87654321, 1500, 1);
  TEST_ASSERT_NOT_EQUAL(0, first_boot.compare(second_boot));
  TEST_ASSERT_EQUAL_STRING("HW-proto-1-12345678-1500-1", first_boot.c_str());
  TEST_ASSERT_EQUAL_STRING("HW-proto-1-87654321-1500-1", second_boot.c_str());
}

}  // namespace

int main(int, char**) {
  UNITY_BEGIN();
  RUN_TEST(test_network_and_5xx_retry_but_4xx_does_not);
  RUN_TEST(test_one_slot_is_reserved_for_sos);
  RUN_TEST(test_sos_preempts_oldest_non_urgent_when_full);
  RUN_TEST(test_queue_full_of_sos_rejects_ninth_sos);
  RUN_TEST(test_fifo_order_remains_stable_without_preemption);
  RUN_TEST(test_boot_nonce_prevents_restart_event_id_collision);
  return UNITY_END();
}
