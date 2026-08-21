import { useState } from "react";
import { FormattedMessage, defineMessages, useIntl } from "react-intl";
import type {
  LearnLink,
  LearnPractice,
  LearnVideo,
  QuizQuestion,
} from "../lib/api";
import { Quiz } from "./Quiz";

const msgs = defineMessages({
  learnAria: { defaultMessage: "Learn about this topic" },
  shrinkAria: { defaultMessage: "Shrink learn panel" },
  expandAria: { defaultMessage: "Expand learn panel" },
  shrinkTitle: { defaultMessage: "Shrink" },
  expandTitle: { defaultMessage: "Expand" },
  collapseAria: { defaultMessage: "Collapse learn panel" },
  playVideoAria: { defaultMessage: "Play {title}" },
  fallbackRead: { defaultMessage: "Finding the clearest explanations…" },
  fallbackWatch: { defaultMessage: "Finding videos on this…" },
  fallbackHandsOn: { defaultMessage: "Finding hands-on material…" },
  fallbackQuiz: { defaultMessage: "Writing questions…" },
});

type SideStatus = { status: "gathering" | "ready" | "error"; activity?: string; error?: string };

/** One topic Claude offered background on. Hands-on practice and the quiz
 *  are independent opt-ins; the Practice tab pools whichever are present. */
export type LearnTopic = {
  id: string;
  topic: string;
  reason: string;
  links: LearnLink[];
  videos: LearnVideo[];
  practice?: LearnPractice[];
  quiz?: QuizQuestion[];
  read: SideStatus;
  watch: SideStatus;
  practiceStatus?: SideStatus;
  quizStatus?: SideStatus;
};

type Tab = "watch" | "read" | "practice";

type Props = {
  /** Newest last — the panel opens on whichever topic came up most recently. */
  offers: LearnTopic[];
  onDismiss: () => void;
  /** Course generation happens in a fresh chat tab; the parent creates it,
   *  switches to it, and drives the wizard there. */
  onGenerateCourse?: (topic: string) => void;
};

/** A gather is in flight if any of its side-statuses is still gathering. */
function isOfferLoading(offer: LearnTopic) {
  return (
    offer.read.status === "gathering" ||
    offer.watch.status === "gathering" ||
    offer.practiceStatus?.status === "gathering" ||
    offer.quizStatus?.status === "gathering"
  );
}

/** The small four-point spark — Claude-family motif — that stands in for the
 *  orange dot while a gather is running. Rotates and pulses subtly. */
function ClaudeSpark() {
  return (
    <span className="bg-spark" aria-hidden="true">
      <svg viewBox="0 0 24 24" fill="currentColor">
        <path d="M12 0.5 L13.4 10.6 L23.5 12 L13.4 13.4 L12 23.5 L10.6 13.4 L0.5 12 L10.6 10.6 Z" />
      </svg>
    </span>
  );
}

/** The bare host — "developer.mozilla.org" reads better than a full URL. */
function host(url: string) {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}

function Status({ side, fallback }: { side: SideStatus; fallback: string }) {
  if (side.status === "gathering") {
    return (
      <p className="bg-status muted small">
        <span className="bg-spinner" aria-hidden="true" />
        {side.activity ?? fallback}
      </p>
    );
  }
  if (side.status === "error") {
    return <p className="error small bg-status">{side.error}</p>;
  }
  return (
    <p className="muted small bg-status">
      <FormattedMessage defaultMessage="Nothing solid came back on this one." />
    </p>
  );
}

function Links({ background }: { background: LearnTopic }) {
  const intl = useIntl();
  if (background.links.length === 0) {
    return (
      <Status side={background.read} fallback={intl.formatMessage(msgs.fallbackRead)} />
    );
  }
  return (
    <ul className="bg-links">
      {background.links.map((link) => (
        <li key={link.url}>
          <a href={link.url} target="_blank" rel="noreferrer noopener" title={link.title}>
            <span className="bg-link-title">{link.title}</span>
            <span className="bg-link-site muted small">{link.site || host(link.url)}</span>
            <span className="bg-link-why muted small">{link.why}</span>
          </a>
        </li>
      ))}
    </ul>
  );
}

/** A YouTube video tile. Loads the iframe player only after the user clicks —
 *  five iframes per topic would be a lot of JS to pull in eagerly. */
function VideoTile({ video }: { video: LearnVideo }) {
  const intl = useIntl();
  const [playing, setPlaying] = useState(false);
  const thumb = `https://i.ytimg.com/vi/${video.videoId}/hqdefault.jpg`;
  return (
    <li className="bg-video">
      <div className="bg-video-frame">
        {playing ? (
          <iframe
            title={video.title}
            src={`https://www.youtube-nocookie.com/embed/${video.videoId}?autoplay=1&rel=0`}
            allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
            allowFullScreen
          />
        ) : (
          <button
            type="button"
            className="bg-video-thumb"
            onClick={() => setPlaying(true)}
            aria-label={intl.formatMessage(msgs.playVideoAria, { title: video.title })}
            style={{ backgroundImage: `url(${thumb})` }}
          >
            <span className="bg-play" aria-hidden="true">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
                <polygon points="6 3 22 12 6 21 6 3" />
              </svg>
            </span>
          </button>
        )}
      </div>
      <div className="bg-video-meta">
        <a
          className="bg-video-title"
          href={video.url}
          target="_blank"
          rel="noreferrer noopener"
          title={video.title}
        >
          {video.title}
        </a>
        <div className="bg-video-sub muted small">
          {video.channel}
          <span className="sep">·</span>
          <span>{video.why}</span>
        </div>
      </div>
    </li>
  );
}

function Videos({ background }: { background: LearnTopic }) {
  const intl = useIntl();
  if (background.videos.length === 0) {
    return (
      <Status side={background.watch} fallback={intl.formatMessage(msgs.fallbackWatch)} />
    );
  }
  return (
    <ul className="bg-videos">
      {background.videos.map((video) => (
        <VideoTile key={video.videoId} video={video} />
      ))}
    </ul>
  );
}

/** Small badge saying "video / article / sandbox" — the practice tab is mixed. */
function KindBadge({ kind }: { kind: LearnPractice["kind"] }) {
  const label =
    kind === "video" ? (
      <FormattedMessage defaultMessage="Video" />
    ) : kind === "sandbox" ? (
      <FormattedMessage defaultMessage="Sandbox" />
    ) : kind === "course" ? (
      <FormattedMessage defaultMessage="Course" />
    ) : (
      <FormattedMessage defaultMessage="Article" />
    );
  return <span className={`bg-kind bg-kind-${kind}`}>{label}</span>;
}

function HandsOn({ background }: { background: LearnTopic }) {
  const intl = useIntl();
  const items = background.practice ?? [];
  if (items.length === 0) {
    return (
      <Status
        side={background.practiceStatus ?? { status: "gathering" }}
        fallback={intl.formatMessage(msgs.fallbackHandsOn)}
      />
    );
  }
  return (
    <ul className="bg-practice">
      {items.map((item) =>
        item.kind === "video" && item.videoId ? (
          <li key={item.url} className="bg-practice-video">
            <VideoTile
              video={{
                videoId: item.videoId,
                title: item.title,
                url: item.url,
                channel: item.source,
                why: item.why,
              }}
            />
          </li>
        ) : (
          <li key={item.url} className="bg-practice-item">
            <a href={item.url} target="_blank" rel="noreferrer noopener" title={item.title}>
              <span className="bg-practice-row">
                <KindBadge kind={item.kind} />
                <span className="bg-practice-title">{item.title}</span>
              </span>
              <span className="bg-practice-sub muted small">
                {item.source || host(item.url)}
                <span className="sep">·</span>
                <span>{item.why}</span>
              </span>
            </a>
          </li>
        ),
      )}
    </ul>
  );
}

function Practice({ background }: { background: LearnTopic }) {
  const intl = useIntl();
  const hasQuiz = background.quiz !== undefined;
  const hasHands = background.practice !== undefined;
  const quizReady = (background.quiz?.length ?? 0) > 0;
  const quizStatus = background.quizStatus ?? { status: "gathering" as const };

  return (
    <div className="bg-practice-wrap">
      {hasQuiz && (
        <>
          <div className="bg-section-hd">
            <FormattedMessage defaultMessage="Check yourself" />
            <span className="rule" />
          </div>
          {quizReady ? (
            <Quiz questions={background.quiz!} />
          ) : (
            <Status side={quizStatus} fallback={intl.formatMessage(msgs.fallbackQuiz)} />
          )}
        </>
      )}
      {hasHands && (
        <>
          <div className="bg-section-hd">
            <FormattedMessage defaultMessage="Try it hands-on" />
            <span className="rule" />
          </div>
          <HandsOn background={background} />
        </>
      )}
    </div>
  );
}

/**
 * Floating panel, bottom right. Nothing renders until Claude decides the user
 * is missing context; after that it stays available — collapsed to a pill if
 * the user closes it — so earlier topics can be read back at any point.
 */
export function LearnPanel({ offers, onDismiss, onGenerateCourse }: Props) {
  const intl = useIntl();
  const [open, setOpen] = useState(true);
  const [expanded, setExpanded] = useState(false);
  const [picked, setPicked] = useState<string | null>(null);
  const [pickedTab, setPickedTab] = useState<Tab | null>(null);
  // Which topic the user last saw expanded, so a new one can take over.
  const [newestSeen, setNewestSeen] = useState<string | null>(null);

  const newest = offers.at(-1) ?? null;

  // A newly offered topic reopens the panel and becomes the one on show —
  // Claude only offers when it thinks the user needs it, so it earns the space.
  if (newest && newest.id !== newestSeen) {
    setNewestSeen(newest.id);
    setPicked(newest.id);
    setPickedTab(null);
    setOpen(true);
  }

  if (offers.length === 0) return null;

  const showing = offers.find((offer) => offer.id === picked) ?? newest;
  if (!showing) return null;

  const earlier = offers.filter((offer) => offer.id !== showing.id).reverse();
  const hasPracticeTab = showing.practice !== undefined || showing.quiz !== undefined;
  const practiceCount = (showing.practice?.length ?? 0) + (showing.quiz?.length ?? 0);
  // Land on Watch by default — the user is already reading the assistant's
  // reply, so a video is the most useful next surface. The spinner while it
  // loads is fine; jumping in with more text isn't.
  const tab: Tab =
    pickedTab && (pickedTab !== "practice" || hasPracticeTab) ? pickedTab : "watch";

  const anyLoading = offers.some(isOfferLoading);

  if (!open) {
    return (
      <button type="button" className="bg-pill" onClick={() => setOpen(true)}>
        {anyLoading ? <ClaudeSpark /> : <span className="bg-dot" aria-hidden="true" />}
        <FormattedMessage defaultMessage="Learn" />
        <span className="bg-count">{offers.length}</span>
      </button>
    );
  }

  return (
    <aside
      className={`bg-panel ${expanded ? "bg-panel-expanded" : ""}`}
      aria-label={intl.formatMessage(msgs.learnAria)}
    >
      <div className="bg-hd">
        <div className="bg-hd-text">
          <div className="bg-eyebrow">
            <span className="bg-dot" aria-hidden="true" />
            <FormattedMessage defaultMessage="Learn" />
          </div>
          <h2 className="bg-topic">{showing.topic}</h2>
          {showing.reason && <p className="bg-reason muted small">{showing.reason}</p>}
        </div>
        <button
          type="button"
          className="bg-collapse"
          aria-label={intl.formatMessage(expanded ? msgs.shrinkAria : msgs.expandAria)}
          onClick={() => setExpanded(!expanded)}
          title={intl.formatMessage(expanded ? msgs.shrinkTitle : msgs.expandTitle)}
        >
          {expanded ? (
            <svg
              width="14"
              height="14"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              aria-hidden="true"
            >
              <path d="M4 14h6v6M20 10h-6V4M14 10l7-7M3 21l7-7" />
            </svg>
          ) : (
            <svg
              width="14"
              height="14"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              aria-hidden="true"
            >
              <path d="M15 3h6v6M9 21H3v-6M21 3l-7 7M3 21l7-7" />
            </svg>
          )}
        </button>
        <button
          type="button"
          className="bg-collapse"
          aria-label={intl.formatMessage(msgs.collapseAria)}
          onClick={() => setOpen(false)}
        >
          <svg
            width="14"
            height="14"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            aria-hidden="true"
          >
            <path d="M6 9l6 6 6-6" />
          </svg>
        </button>
      </div>

      {onGenerateCourse && (
        <button
          type="button"
          className="bg-generate-course"
          onClick={() => onGenerateCourse(showing.topic)}
        >
          <FormattedMessage defaultMessage="Generate a full course on this →" />
        </button>
      )}

      <div className="bg-tabs" role="tablist">
        {(["watch", "read", ...(hasPracticeTab ? (["practice"] as const) : [])] as const).map(
          (name) => {
            const count =
              name === "watch"
                ? showing.videos.length
                : name === "read"
                  ? showing.links.length
                  : practiceCount;
            return (
              <button
                key={name}
                type="button"
                role="tab"
                aria-selected={tab === name}
                className={`bg-tab ${tab === name ? "active" : ""}`}
                onClick={() => setPickedTab(name)}
              >
                {name === "watch" ? (
                  <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" aria-hidden="true">
                    <polygon points="5 3 19 12 5 21 5 3" />
                  </svg>
                ) : name === "read" ? (
                  <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" aria-hidden="true">
                    <path d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z" />
                    <path d="M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z" />
                  </svg>
                ) : (
                  <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" aria-hidden="true">
                    <path d="M9 3v18M15 3v18M3 9h18M3 15h18" />
                  </svg>
                )}
                {name === "watch" ? (
                  <FormattedMessage defaultMessage="Watch" />
                ) : name === "read" ? (
                  <FormattedMessage defaultMessage="Read" />
                ) : (
                  <FormattedMessage defaultMessage="Practice" />
                )}
                {count > 0 && <span className="bg-count">{count}</span>}
              </button>
            );
          },
        )}
      </div>

      <div className="bg-body">
        {tab === "watch" ? (
          <Videos background={showing} />
        ) : tab === "read" ? (
          <Links background={showing} />
        ) : (
          <Practice background={showing} />
        )}

        {earlier.length > 0 && (
          <>
            <div className="bg-section-hd">
              <FormattedMessage defaultMessage="Earlier in this chat" />
              <span className="rule" />
            </div>
            <ul className="bg-earlier">
              {earlier.map((offer) => (
                <li key={offer.id}>
                  <button
                    type="button"
                    onClick={() => {
                      setPicked(offer.id);
                      setPickedTab(null);
                    }}
                  >
                    {offer.topic}
                    <span className="muted small">
                      {(() => {
                        const parts: string[] = [];
                        if (offer.videos.length)
                          parts.push(
                            intl.formatMessage(
                              {
                                defaultMessage:
                                  "{count, plural, one {# video} other {# videos}}",
                              },
                              { count: offer.videos.length },
                            ),
                          );
                        if (offer.links.length)
                          parts.push(
                            intl.formatMessage(
                              {
                                defaultMessage:
                                  "{count, plural, one {# link} other {# links}}",
                              },
                              { count: offer.links.length },
                            ),
                          );
                        if (parts.length) return parts.join(" · ");
                        return offer.read.status === "gathering" ||
                          offer.watch.status === "gathering"
                          ? intl.formatMessage({ defaultMessage: "…" })
                          : intl.formatMessage({ defaultMessage: "empty" });
                      })()}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          </>
        )}
      </div>

      <div className="bg-ft">
        <span className="muted small">
          <FormattedMessage defaultMessage="Claude opens this when a topic looks unfamiliar" />
        </span>
        <button type="button" className="bg-linkish" onClick={onDismiss}>
          <FormattedMessage defaultMessage="Clear" />
        </button>
      </div>
    </aside>
  );
}
