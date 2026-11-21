import { readdirSync, readFileSync } from "node:fs";
import { extname, join, relative, sep } from "node:path";
import type { FastifyInstance, FastifyReply } from "fastify";

export interface PhoneFile {
  readonly body: Buffer;
  readonly type: string;
  readonly lasting: boolean;
}

export type PhoneApp = ReadonlyMap<string, PhoneFile>;

const types: Readonly<Record<string, string>> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json",
  ".webmanifest": "application/manifest+json",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".ico": "image/x-icon",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".wasm": "application/wasm",
};

function filesUnder(folder: string): string[] {
  return readdirSync(folder, { withFileTypes: true, recursive: true })
    .filter((entry) => entry.isFile())
    .map((entry) => join(entry.parentPath, entry.name));
}

export function loadPhoneApp(folder: string): PhoneApp | null {
  let paths: string[];
  try {
    paths = filesUnder(folder);
  } catch {
    return null;
  }
  const files = new Map<string, PhoneFile>();
  for (const path of paths) {
    const type = types[extname(path).toLowerCase()];
    if (type !== undefined) {
      const name = relative(folder, path).split(sep).join("/");
      files.set(name, { body: readFileSync(path), type, lasting: name.startsWith("assets/") });
    }
  }
  return files.has("index.html") ? files : null;
}

function send(reply: FastifyReply, file: PhoneFile): FastifyReply {
  return reply
    .header("content-type", file.type)
    .header("cache-control", file.lasting ? "public, max-age=31536000, immutable" : "no-cache")
    .header("x-content-type-options", "nosniff")
    .header("referrer-policy", "no-referrer")
    .send(file.body);
}

export function phoneRoutes(app: FastifyInstance, phone: PhoneApp): void {
  const page = phone.get("index.html");
  if (page === undefined) {
    return;
  }
  app.get("/phone", async (_request, reply) => reply.redirect("/phone/"));
  app.get<{ Params: { "*": string } }>("/phone/*", async (request, reply) => {
    const name = request.params["*"];
    const file = phone.get(name);
    if (file !== undefined) {
      return send(reply, file);
    }
    if (extname(name) !== "") {
      return reply.code(404).send({ error: "not_found", message: "That part of the phone app does not exist." });
    }
    return send(reply, page);
  });
}
