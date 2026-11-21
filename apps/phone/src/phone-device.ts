import { DeviceInfo, type Platform } from "@venom/contracts";

interface HighEntropyHints {
  getHighEntropyValues(hints: readonly string[]): Promise<{ readonly model?: string }>;
}

const nameCharacters = 80;

export function phonePlatform(userAgent: string): Platform {
  if (/iPhone|iPad|iPod/u.test(userAgent)) {
    return "ios";
  }
  if (/Android/u.test(userAgent)) {
    return "android";
  }
  if (/Windows/u.test(userAgent)) {
    return "windows";
  }
  return /Macintosh|Mac OS X/u.test(userAgent) ? "macos" : "linux";
}

function phoneName(platform: Platform, model: string): string {
  const kind = platform === "ios" ? "iPhone" : platform === "android" ? "Android phone" : "Phone";
  return (model === "" ? kind : `${kind} (${model})`).slice(0, nameCharacters);
}

export function describeThisPhone(userAgent: string, model: string): DeviceInfo {
  const platform = phonePlatform(userAgent);
  return DeviceInfo.parse({
    type: "phone",
    name: phoneName(platform, model.trim()),
    platform,
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

export async function phoneModel(): Promise<string> {
  const hints = (navigator as Navigator & { readonly userAgentData?: HighEntropyHints }).userAgentData;
  if (hints === undefined) {
    return "";
  }
  try {
    return (await hints.getHighEntropyValues(["model"])).model ?? "";
  } catch {
    return "";
  }
}
