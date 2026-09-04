import { classifyInput } from "../../../src/pathPlanner/index.js";

export const runtime = "nodejs";

/** Thin wrapper over classifyInput() — the New entry screen's classify step, confirmed/overridden client-side before anything is generated. */
export async function POST(request: Request): Promise<Response> {
  const body = (await request.json()) as { input?: string };
  const input = body.input?.trim();
  if (!input) {
    return Response.json({ message: "Missing required 'input' field." }, { status: 400 });
  }

  const result = await classifyInput(input);
  return Response.json(result);
}
