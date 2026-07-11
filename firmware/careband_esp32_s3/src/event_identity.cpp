#include "event_identity.h"

#include <cstdio>

std::string formatEventId(const char* device_id, std::uint32_t boot_nonce,
                          std::uint32_t uptime_ms, std::uint32_t sequence) {
  char suffix[64];
  std::snprintf(suffix, sizeof(suffix), "-%08lx-%lu-%lu",
                static_cast<unsigned long>(boot_nonce),
                static_cast<unsigned long>(uptime_ms),
                static_cast<unsigned long>(sequence));
  return std::string("HW-") + (device_id == nullptr ? "unknown" : device_id) +
         suffix;
}
