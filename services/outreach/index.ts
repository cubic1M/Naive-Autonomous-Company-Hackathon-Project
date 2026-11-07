// Andrew: export your real tool implementations here. Shapes: contracts/tools.ts, runtime: contracts/runtime.ts.
// Until a tool is exported here, the API serves its mock (apps/api/src/tools/mocks.ts), so agents keep working.
//
// Example:
//   import type { ToolImpl } from "../../contracts/runtime";
//   export const find_people: ToolImpl<"find_people"> = async ({ job_id, limit }, ctx) => { ... };
//   export default { find_people };
import type { ServiceModule } from "../../contracts/runtime";

const impl: ServiceModule = {};
export default impl;
