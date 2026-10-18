import { ApiError } from "@venom/contracts";
import type { z } from "zod";
import type { Failure } from "../shared/bridge.ts";

export type Result<T> = { readonly ok: true; readonly value: T } | Failure;

export interface RequestOptions<T> {
  readonly schema?: z.ZodType<T>;
  readonly body?: unknown;
  readonly token?: string | null;
}

export const unreachable: Failure = {
  ok: false,
  code: "network",
  reason: "VENOM's gateway is not reachable. Check that it is running, then try again.",
};

export class Api {
  readonly #base: URL;
  readonly #timeoutMs: number;

  constructor(baseUrl: string, timeoutMs = 10_000) {
    this.#base = new URL(baseUrl);
    this.#timeoutMs = timeoutMs;
  }

  url(path: string): URL {
    return new URL(path, this.#base);
  }

  async request<T = undefined>(method: string, path: string, { schema, body, token }: RequestOptions<T> = {}): Promise<Result<T>> {
    let response: Response;
    try {
      response = await fetch(this.url(path), {
        method,
        headers: {
          ...(body === undefined ? {} : { "content-type": "application/json" }),
          ...(token == null ? {} : { authorization: `Bearer ${token}` }),
        },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        signal: AbortSignal.timeout(this.#timeoutMs),
      });
    } catch {
      return unreachable;
    }

    const payload: unknown = response.status === 204 ? undefined : await response.json().catch(() => undefined);

    if (!response.ok) {
      const error = ApiError.safeParse(payload);
      return error.success
        ? { ok: false, code: error.data.error, reason: error.data.message }
        : { ok: false, code: "internal", reason: `The gateway answered with status ${response.status}.` };
    }

    if (schema === undefined) {
      return { ok: true, value: undefined as T };
    }
    const parsed = schema.safeParse(payload);
    return parsed.success ? { ok: true, value: parsed.data } : { ok: false, code: "internal", reason: "The gateway sent an answer VENOM could not read." };
  }
}
