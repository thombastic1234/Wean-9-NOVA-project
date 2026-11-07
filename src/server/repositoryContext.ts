import { AsyncLocalStorage } from "node:async_hooks";
import type { Repository } from "./database";

// Each serverless request validates its own browser workspace. No shared process state.
export const repositoryContext = new AsyncLocalStorage<Repository>();
