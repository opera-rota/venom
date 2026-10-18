import type { Account, ApiErrorCode, Device, DeviceList, GatewayEvent, Message } from "@venom/contracts";

export type ConnectionState = "connecting" | "online" | "offline";

export type Failure = {
  readonly ok: false;
  readonly code: ApiErrorCode | "network" | "secret_word_mismatch";
  readonly reason: string;
};

export type StepResult = { readonly ok: true } | Failure;

export type SendResult = { readonly ok: true; readonly requestId: string } | Failure;

export type DevicesResult = { readonly ok: true; readonly list: DeviceList } | Failure;

export type AuthView =
  | { readonly kind: "loading" }
  | { readonly kind: "signed_out"; readonly notice: string | null }
  | { readonly kind: "signed_in"; readonly account: Account; readonly device: Device };

export interface SignupBridge {
  start(name: string, email: string): Promise<StepResult>;
  verify(code: string): Promise<StepResult>;
  secretWord(secretWord: string, repeated: string): Promise<StepResult>;
}

export interface AttachBridge {
  start(email: string, secretWord: string): Promise<StepResult>;
  confirm(code: string): Promise<StepResult>;
}

export interface VenomBridge {
  auth(): Promise<AuthView>;
  onAuth(listener: (view: AuthView) => void): () => void;
  readonly signup: SignupBridge;
  readonly attach: AttachBridge;
  cancelOnboarding(): Promise<void>;
  signOut(): Promise<StepResult>;
  devices(): Promise<DevicesResult>;
  removeDevice(deviceId: string): Promise<StepResult>;
  history(): Promise<Message[]>;
  send(text: string): Promise<SendResult>;
  connection(): Promise<ConnectionState>;
  onEvent(listener: (event: GatewayEvent) => void): () => void;
  onConnection(listener: (state: ConnectionState) => void): () => void;
}

export const channels = {
  auth: "venom:auth",
  authChanged: "venom:auth-changed",
  signupStart: "venom:signup-start",
  signupVerify: "venom:signup-verify",
  signupSecretWord: "venom:signup-secret-word",
  attachStart: "venom:attach-start",
  attachConfirm: "venom:attach-confirm",
  cancelOnboarding: "venom:cancel-onboarding",
  signOut: "venom:sign-out",
  devices: "venom:devices",
  removeDevice: "venom:remove-device",
  history: "venom:history",
  send: "venom:send",
  connection: "venom:connection",
  event: "venom:event",
  connectionChanged: "venom:connection-changed",
} as const;
