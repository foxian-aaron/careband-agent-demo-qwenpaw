#pragma once

#include <cstdint>
#include <string>

std::string formatEventId(const char* device_id, std::uint32_t boot_nonce,
                          std::uint32_t uptime_ms, std::uint32_t sequence);
