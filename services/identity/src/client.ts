import * as opaque from "@serenity-kit/opaque";
import { secretWordKeyStretching } from "@venom/contracts";

export interface SecretWordRegistrationFlow {
  readonly registrationRequest: string;
  finish(registrationResponse: string): string;
}

export interface SecretWordLoginFlow {
  readonly startLoginRequest: string;
  finish(loginResponse: string): string | null;
}

export async function beginSecretWordRegistration(secretWord: string): Promise<SecretWordRegistrationFlow> {
  await opaque.ready;
  const { clientRegistrationState, registrationRequest } = opaque.client.startRegistration({ password: secretWord });

  return {
    registrationRequest,
    finish(registrationResponse) {
      return opaque.client.finishRegistration({
        clientRegistrationState,
        registrationResponse,
        password: secretWord,
        keyStretching: secretWordKeyStretching,
      }).registrationRecord;
    },
  };
}

export async function beginSecretWordLogin(secretWord: string): Promise<SecretWordLoginFlow> {
  await opaque.ready;
  const { clientLoginState, startLoginRequest } = opaque.client.startLogin({ password: secretWord });

  return {
    startLoginRequest,
    finish(loginResponse) {
      try {
        const result = opaque.client.finishLogin({
          clientLoginState,
          loginResponse,
          password: secretWord,
          keyStretching: secretWordKeyStretching,
        });
        return result?.finishLoginRequest ?? null;
      } catch {
        return null;
      }
    },
  };
}
