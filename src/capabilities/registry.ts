import { cardTools } from "@/capabilities/tools/cards";
import { loanTools } from "@/capabilities/tools/loans";
import { sharedTools } from "@/capabilities/tools/shared";
import { ToolRegistry } from "@/platform/tools/registry";

/** One registry for the whole platform; workflows select from it by name. */
const g = globalThis as unknown as { __kestrelRegistry?: ToolRegistry };
export const registry: ToolRegistry = (g.__kestrelRegistry ??= new ToolRegistry().register(...sharedTools, ...loanTools, ...cardTools));
