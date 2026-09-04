import { notFound } from "next/navigation";
import { eq } from "drizzle-orm";
import { getDb } from "../../../src/db/client.js";
import { modules } from "../../../src/db/schema.js";
import { PracticeClient } from "../../../components/PracticeClient.js";

export default async function PracticePage({ params }: { params: Promise<{ moduleId: string }> }) {
  const { moduleId } = await params;
  const db = await getDb();
  const [mod] = await db.select().from(modules).where(eq(modules.id, moduleId));
  if (!mod) notFound();

  return (
    <div className="space-y-4">
      <h1 className="text-xl font-medium">Practice: {mod.title}</h1>
      <PracticeClient moduleId={moduleId} courseId={mod.courseId} />
    </div>
  );
}
