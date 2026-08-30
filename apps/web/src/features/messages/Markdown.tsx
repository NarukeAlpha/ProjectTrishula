import { memo, useMemo } from "react";
import { renderSafeMarkdown } from "../../shared/formatting/markdown";

export const Markdown = memo(function Markdown({ text }: { text: string }) {
  const html = useMemo(() => renderSafeMarkdown(text), [text]);
  return (
    <div className="markdown" dangerouslySetInnerHTML={{ __html: html }} />
  );
});
