#include "retry_queue.h"

#include <utility>

DeliveryDisposition classifyHttpStatus(int http_status) {
  if (http_status >= 200 && http_status < 300) {
    return DeliveryDisposition::Success;
  }
  if (http_status <= 0 || (http_status >= 500 && http_status < 600)) {
    return DeliveryDisposition::Retry;
  }
  return DeliveryDisposition::RejectWithoutRetry;
}

std::size_t RetryQueue::physicalIndex(std::size_t logical_offset) const {
  return (head_ + logical_offset) % kRetryQueueCapacity;
}

QueuePushResult RetryQueue::push(QueuedEvent event) {
  if (!event.isUrgent() &&
      size_ >= kRetryQueueCapacity - kReservedSosSlots) {
    return QueuePushResult::RejectedReservedForSos;
  }

  bool evicted = false;
  if (size_ >= kRetryQueueCapacity) {
    if (!event.isUrgent() || !evictOldestNonUrgent()) {
      return QueuePushResult::RejectedFullOfSos;
    }
    evicted = true;
  }

  items_[physicalIndex(size_)] = std::move(event);
  ++size_;
  return evicted ? QueuePushResult::AcceptedAfterNonUrgentEviction
                 : QueuePushResult::Accepted;
}

QueuedEvent* RetryQueue::front() {
  return size_ == 0 ? nullptr : &items_[head_];
}

const QueuedEvent* RetryQueue::front() const {
  return size_ == 0 ? nullptr : &items_[head_];
}

void RetryQueue::pop() {
  if (size_ == 0) return;
  items_[head_] = QueuedEvent{};
  head_ = physicalIndex(1);
  --size_;
}

std::size_t RetryQueue::size() const { return size_; }

bool RetryQueue::hasUrgent() const {
  for (std::size_t i = 0; i < size_; ++i) {
    if (items_[physicalIndex(i)].isUrgent()) return true;
  }
  return false;
}

bool RetryQueue::evictOldestNonUrgent() {
  std::size_t victim = size_;
  for (std::size_t i = 0; i < size_; ++i) {
    if (!items_[physicalIndex(i)].isUrgent()) {
      victim = i;
      break;
    }
  }
  if (victim == size_) return false;

  for (std::size_t i = victim; i + 1 < size_; ++i) {
    items_[physicalIndex(i)] = std::move(items_[physicalIndex(i + 1)]);
  }
  items_[physicalIndex(size_ - 1)] = QueuedEvent{};
  --size_;
  return true;
}
