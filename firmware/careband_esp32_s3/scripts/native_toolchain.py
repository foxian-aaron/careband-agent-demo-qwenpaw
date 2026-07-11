"""Expose PlatformIO's portable MinGW package to the native test builder."""

import os
from os.path import join

Import("env")  # type: ignore[name-defined]  # provided by PlatformIO/SCons

package_dir = env.PioPlatform().get_package_dir("toolchain-gccmingw32")
if package_dir:
    tool_bin = join(package_dir, "bin")
    env.PrependENVPath("PATH", tool_bin)
    # PlatformIO's native test runner launches the executable outside the
    # SCons command environment, so its runtime DLL lookup also needs PATH.
    os.environ["PATH"] = tool_bin + os.pathsep + os.environ.get("PATH", "")
    # Keep the generated native test executable self-contained so PlatformIO's
    # separate test process does not depend on MinGW runtime DLL lookup.
    env.Append(LINKFLAGS=["-static", "-static-libgcc", "-static-libstdc++"])
