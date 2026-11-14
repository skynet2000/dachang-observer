// The backend of the site's modules, installed by the api and the worker when they start (site/modules/index.ts).
import type { ServerModule } from "@aihot/backend/modules";
import reader from "@aihot/reader/server";

import language from "@aihot/language/server";
import maimai from "@aihot/maimai/server";
import coverage from "./coverage.ts";

export const SERVER_MODULES: readonly ServerModule[] = [reader, language, maimai, coverage];
