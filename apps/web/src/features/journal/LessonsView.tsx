import { useState } from "react";
import type {
  JournalLessonReadModel,
  JournalTradeReadModel,
} from "../../convex/types";
import { formatUpdatedDate, pluralize } from "./formatting";
import { BookOpenIcon, EditIcon, SearchIcon } from "./icons";

export function LessonsView({
  lessons,
  trades,
  onOpenLesson,
  onOpenTrade,
  onAddLesson,
}: {
  lessons: JournalLessonReadModel[];
  trades: JournalTradeReadModel[];
  onOpenLesson: (lesson: JournalLessonReadModel) => void;
  onOpenTrade: (trade: JournalTradeReadModel) => void;
  onAddLesson: () => void;
}) {
  const [query, setQuery] = useState("");
  const term = query.trim().toLocaleLowerCase("en-US");
  const tradeById = new Map(trades.map((trade) => [trade.stableId, trade]));

  if (lessons.length === 0) {
    return (
      <section className="journal-card">
        <div className="journal-empty">
          <span className="journal-empty-icon">
            <BookOpenIcon />
          </span>
          <strong>No lessons yet</strong>
          <p>Save a rule or reminder you want to carry into your next trade.</p>
          <button
            type="button"
            className="journal-button journal-button--secondary"
            onClick={onAddLesson}
          >
            Write a lesson
          </button>
        </div>
      </section>
    );
  }

  const matches = lessons.filter((lesson) => {
    if (!term) return true;
    const linked = lesson.tradeStableId
      ? tradeById.get(lesson.tradeStableId)
      : null;
    return [lesson.title, lesson.body, linked?.symbol ?? ""].some((text) =>
      text.toLocaleLowerCase("en-US").includes(term),
    );
  });

  return (
    <div className="journal-view-stack">
      <div className="journal-lesson-filter">
        <label className="journal-search-field">
          <SearchIcon />
          <input
            type="search"
            aria-label="Search lessons"
            placeholder="Search lessons"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
        </label>
        <span className="journal-result-count" aria-live="polite">
          {pluralize(matches.length, "lesson")}
        </span>
      </div>
      {matches.length > 0 ? (
        <div className="journal-lesson-grid">
          {matches.map((lesson) => {
            const linked = lesson.tradeStableId
              ? tradeById.get(lesson.tradeStableId)
              : null;
            return (
              <article
                className="journal-card journal-padded-card journal-lesson-card"
                key={lesson.stableId}
              >
                <div className="journal-card-heading">
                  <h2>{lesson.title}</h2>
                  <button
                    type="button"
                    className="journal-icon-button"
                    aria-label={`Edit lesson ${lesson.title}`}
                    onClick={() => onOpenLesson(lesson)}
                  >
                    <EditIcon />
                  </button>
                </div>
                <p>{lesson.body}</p>
                <footer>
                  <span>Updated {formatUpdatedDate(lesson.updatedAt)}</span>
                  {linked && (
                    <button
                      type="button"
                      className="journal-text-button"
                      onClick={() => onOpenTrade(linked)}
                    >
                      {linked.symbol} trade
                    </button>
                  )}
                </footer>
              </article>
            );
          })}
        </div>
      ) : (
        <section className="journal-card">
          <div className="journal-empty">
            <span className="journal-empty-icon">
              <BookOpenIcon />
            </span>
            <strong>No matching lessons</strong>
            <p>Try a different search term.</p>
          </div>
        </section>
      )}
    </div>
  );
}
