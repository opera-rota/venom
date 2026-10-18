import { hostname } from "node:os";
import { DeviceInfo, type Platform } from "@venom/contracts";

const platforms: Partial<Record<NodeJS.Platform, Platform>> = {
  win32: "windows",
  darwin: "macos",
  linux: "linux",
};

export function describeThisComputer(profile: string | null): DeviceInfo {
  const host = hostname().trim() || "Computer";
  const name = profile === null ? host : `${host} (${profile})`;

  return DeviceInfo.parse({
    type: "computer",
    name: name.slice(0, 80),
    platform: platforms[process.platform] ?? "linux",
    capabilities: {
      screen_control: false,
      microphone: false,
      speaker: false,
      shortcuts: false,
      notifications: false,
      network: true,
    },
  });
}
