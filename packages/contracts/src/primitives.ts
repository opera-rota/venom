import { z } from "zod";

export const Id = z.uuid();
export const Timestamp = z.iso.datetime({ offset: true });
export const Email = z.email();
