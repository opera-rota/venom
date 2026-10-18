import { AttachConfirm, AttachProve, AttachStart, SecretWordRegistration, SignupFinish, SignupStart, SignupVerify } from "@venom/contracts";
import type { FastifyInstance } from "fastify";
import type { GatewayContext } from "../context.ts";

export function identityRoutes(app: FastifyInstance, { identity, broadcastDevices }: GatewayContext): void {
  app.post("/v1/signup", async (request, reply) => {
    return reply.code(201).send(await identity.startSignup(SignupStart.parse(request.body)));
  });

  app.post("/v1/signup/verify", async (request, reply) => {
    await identity.verifySignup(SignupVerify.parse(request.body));
    return reply.code(204).send();
  });

  app.post("/v1/signup/secret-word", async (request) => {
    return identity.registerSecretWord(SecretWordRegistration.parse(request.body));
  });

  app.post("/v1/signup/finish", async (request, reply) => {
    return reply.code(201).send(await identity.finishSignup(SignupFinish.parse(request.body), request.id));
  });

  app.post("/v1/attach", async (request, reply) => {
    return reply.code(201).send(await identity.startAttach(AttachStart.parse(request.body)));
  });

  app.post("/v1/attach/prove", async (request) => {
    return identity.proveAttach(AttachProve.parse(request.body), request.id);
  });

  app.post("/v1/attach/confirm", async (request, reply) => {
    const session = await identity.confirmAttach(AttachConfirm.parse(request.body), request.id);
    await broadcastDevices(session.account.id, request.id);
    return reply.code(201).send(session);
  });
}
