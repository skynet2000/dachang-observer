import { defineModule } from "@aihot/contracts/modules";
export default defineModule({ name: "maimai", pages: [{ path: "workplace-leads", file: "web/leads.tsx" }],
  apiPaths: [/^\/api\/maimai\/leads$/] });
