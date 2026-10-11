import { z } from "zod";

export const contracts = z.registry<{ id: string }>();
