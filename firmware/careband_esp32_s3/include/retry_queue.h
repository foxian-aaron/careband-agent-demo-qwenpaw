#pragma once

#include <cstddef>
#include <cstdint>
#include <string>

constexpr std::size_t kRetryQueueCapacity = 8;
constexpr std::size_t kReservedSosSlots = 1;

struct QueuedEvent {
  std::string event_id;
  std::string event_type;
  std::string body;
  std::uint8_t attempts = 0;
  std::uint32_t next_attempt_at_ms = 0;

  bool isUrgent() const { return event_type == "sos"; }
};

enum class QueuePushResult {
  Accepted,
  AcceptedAfterNonUrgentEviction,
  RejectedReservedForSos,
  RejectedFullOfSos,
};

enum class DeliveryDisposition {
  Success,
  Retry,
  RejectWithoutRetry,
};

DeliveryDisposition classifyHttpStatus(int http_status);

class RetryQueue {
 public:
  QueuePushResult push(QueuedEvent event);
  QueuedEvent* front();
  const QueuedEvent* front() const;
  void pop();
  std::size_t size() const;
  bool hasUrgent() const;

 private:
  bool evictOldestNonUrgent();
  std::size_t physicalIndex(std::size_t logical_offset) const;

  QueuedEvent items_[kRetryQueueCapacity];
  std::size_t head_ = 0;
  std::size_t size_ = 0;
};
