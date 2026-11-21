export function liveChallengeText(deviceId: string, challengeId: string, nonce: string): string {
  return `venom-live-v1\n${deviceId}\n${challengeId}\n${nonce}`;
}

export function commandText(payload: string): string {
  return `venom-command-v1\n${payload}`;
}
