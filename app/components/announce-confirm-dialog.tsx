import { Megaphone } from "lucide-react";
import { Button } from "~/components/ui/button";
import { Card, CardContent, CardHeader } from "~/components/ui/card";

// ─── The Announce confirmation ───
// Both Announce paths — one lesson from the lesson editor, a batch from the
// course editor — put the same dialog in front of the same irreversible act.
// Each names its own blast radius in its own words; the furniture lives here
// once so the two can't drift apart.

export function AnnounceConfirmDialog({
  heading,
  children,
  onCancel,
  onConfirm,
}: {
  heading: string;
  /** What is about to be announced, to how many Students, and that it's final. */
  children: React.ReactNode;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
      <Card className="mx-4 w-full max-w-md">
        <CardHeader>
          <h2 className="text-lg font-semibold">{heading}</h2>
          <p className="text-sm text-muted-foreground">{children}</p>
        </CardHeader>
        <CardContent className="flex justify-end gap-3">
          <Button variant="outline" onClick={onCancel}>
            Cancel
          </Button>
          <Button onClick={onConfirm}>
            <Megaphone className="mr-1.5 size-4" />
            Announce
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}

/** "1 Student" / "214 Students" — the same count, said the same way on both paths. */
export function enrolledStudentsPhrase(count: number): string {
  return `${count} enrolled ${count === 1 ? "Student" : "Students"}`;
}

/** "1 lesson" / "3 lessons". */
export function lessonsPhrase(count: number): string {
  return `${count} ${count === 1 ? "lesson" : "lessons"}`;
}
