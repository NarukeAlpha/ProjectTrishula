import { useState } from "react";
import { readChartReview, type ReviewChart } from "./chartReviewParser";
import { ExternalLinkIcon } from "./icons";

function percent(value: number, total: number): string {
  return `${(100 * value) / total}%`;
}

function ChartFigure({
  chart,
  source,
  loading,
  timeZone,
}: {
  chart: ReviewChart;
  source: string | undefined;
  loading: boolean;
  timeZone: string;
}) {
  const [failedSource, setFailedSource] = useState<string | null>(null);
  const { crop, focus } = chart;
  const unavailable = !loading && (!source || failedSource === source);

  return (
    <figure className="journal-review-chart">
      {loading ? (
        <p className="journal-chart-unavailable" role="status">
          Loading chart screenshot…
        </p>
      ) : unavailable ? (
        <p className="journal-chart-unavailable" role="status">
          The chart screenshot is unavailable.
        </p>
      ) : (
        <div role="img" aria-label={chart.alt}>
          <div className="journal-chart-board" aria-hidden="true">
            <div
              className="journal-chart-viewport"
              style={{ aspectRatio: `${crop.width} / ${crop.height}` }}
            >
              <img
                src={source}
                alt=""
                width={chart.width}
                height={chart.height}
                onError={() => {
                  if (source) setFailedSource(source);
                }}
                style={{
                  left: percent(-crop.x, crop.width),
                  top: percent(-crop.y, crop.height),
                  width: percent(chart.width, crop.width),
                  height: percent(chart.height, crop.height),
                }}
              />
              <svg
                className="journal-chart-marks"
                viewBox={`${crop.x} ${crop.y} ${crop.width} ${crop.height}`}
              >
                {chart.levels.map((level) => (
                  <path
                    key={`${level.y}-${level.label}`}
                    className="journal-chart-guide"
                    vectorEffect="non-scaling-stroke"
                    d={`M ${crop.x} ${level.y} H ${focus.x} M ${focus.x + focus.width} ${level.y} H ${crop.x + crop.width}`}
                  />
                ))}
                <rect
                  className="journal-chart-focus"
                  x={focus.x}
                  y={focus.y}
                  width={focus.width}
                  height={focus.height}
                  rx={4}
                  vectorEffect="non-scaling-stroke"
                />
              </svg>
            </div>
            <div className="journal-chart-scale">
              {chart.levels.map((level) => (
                <span
                  key={`${level.y}-${level.label}`}
                  style={{ top: percent(level.y - crop.y, crop.height) }}
                >
                  {level.label}
                </span>
              ))}
            </div>
          </div>
          <div className="journal-chart-axis" aria-hidden="true">
            <div className="journal-chart-times">
              {chart.ticks.map((tick) => (
                <span
                  key={`${tick.x}-${tick.label}`}
                  style={{ left: percent(tick.x - crop.x, crop.width) }}
                >
                  {tick.label}
                </span>
              ))}
            </div>
            <span className="journal-chart-zone">{timeZone}</span>
          </div>
        </div>
      )}
      <figcaption>
        <span className="journal-chart-key">{chart.focusLabel}</span>
        {source && (
          <a
            href={source}
            target="_blank"
            rel="noopener noreferrer"
            aria-label={`Open the full ${chart.interval} TradingView screenshot in a new tab`}
          >
            Full screenshot <ExternalLinkIcon />
          </a>
        )}
      </figcaption>
    </figure>
  );
}

export function ChartReview({
  assistantReview,
  chartUrls,
}: {
  assistantReview: string | null;
  chartUrls: Record<string, string> | undefined;
}) {
  if (!assistantReview) {
    return (
      <p className="journal-review-pending">
        Chart review pending. Ask Journal Chat to review this trade with
        TradingView snapshots.
      </p>
    );
  }

  const review = readChartReview(assistantReview);
  if (!review) {
    return (
      <div className="journal-review-prose">
        {assistantReview
          .split(/\n\s*\n/)
          .filter((paragraph) => paragraph.trim().length > 0)
          .map((paragraph, index) => (
            <p key={index}>{paragraph}</p>
          ))}
      </div>
    );
  }

  const loading = chartUrls === undefined;

  return (
    <div className="journal-illustrated-review">
      <p className="journal-review-summary">{review.summary}</p>
      <div className="journal-review-source">
        <span>TradingView · {review.instrument}</span>
        {review.timing && <span>{review.timing}</span>}
      </div>
      {review.charts.map((chart, index) => (
        <section
          className="journal-chart-section"
          key={`${chart.image}-${index}`}
        >
          <div className="journal-chart-heading">
            <span className="journal-chart-interval">{chart.interval}</span>
            <h4>{chart.heading}</h4>
          </div>
          <p>{chart.text}</p>
          <ChartFigure
            chart={chart}
            source={chartUrls?.[chart.image]}
            loading={loading}
            timeZone={review.timeZone}
          />
        </section>
      ))}
      <section className="journal-review-next">
        <h4>Next time</h4>
        <p>{review.nextTime}</p>
      </section>
      {review.note && <p className="journal-review-evidence">{review.note}</p>}
    </div>
  );
}
