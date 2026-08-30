import { Markdown } from "./Markdown";
import { useSmoothText } from "./useSmoothText";

function splitStableMarkdown(text: string) {
  const boundary = text.lastIndexOf("\n");
  if (boundary < 0) return { stable: "", pending: text };
  return {
    stable: text.slice(0, boundary + 1),
    pending: text.slice(boundary + 1),
  };
}

export function LiveMarkdown({
  text,
  animate = true,
}: {
  text: string;
  animate?: boolean;
}) {
  const projection = useSmoothText(text, animate);
  const { stable, pending } = splitStableMarkdown(projection.text);
  const pendingStart = stable.length;
  const revealStart = Math.min(
    pending.length,
    Math.max(0, projection.revealStart - pendingStart),
  );
  return (
    <div className="live-markdown">
      {stable && <Markdown text={stable} />}
      {pending && (
        <div className="live-text">
          {pending.slice(0, revealStart)}
          {pending.slice(revealStart) && (
            <span className="live-reveal" key={projection.revision}>
              {pending.slice(revealStart)}
            </span>
          )}
        </div>
      )}
    </div>
  );
}
