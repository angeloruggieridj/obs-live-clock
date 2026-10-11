// SPDX-License-Identifier: GPL-2.0-or-later
import { useEffect, useRef, useState } from 'react';
import { wallText } from '../core/time-format';
import type { ControlView } from '../core/views';
import { useLive } from '../ui/live-context';
import { appendFeed, diffViews, type FeedEntry } from './event-feed';

/** Accumulates the session feed from successive views; waits for the first clock sample so every entry has a server time. */
export function useEventFeed(view: ControlView | null, synced: boolean): FeedEntry[] {
  const { store } = useLive();
  const prev = useRef<ControlView | null>(null);
  const state = useRef<{ feed: FeedEntry[]; nextId: number }>({ feed: [], nextId: 1 });
  const [feed, setFeed] = useState<FeedEntry[]>([]);
  useEffect(() => {
    if (!synced) return; // the first view arrives before the first pong: keep it until the clock is known
    const events = diffViews(prev.current, view);
    prev.current = view;
    if (events.length === 0) return;
    state.current = appendFeed(state.current.feed, events, store.serverNow(), state.current.nextId);
    setFeed(state.current.feed);
  }, [view, synced, store]);
  return feed;
}

export function EventFeed({ entries }: { entries: FeedEntry[] }) {
  const { t, timeZone } = useLive();
  return (
    <section className="panel feed">
      <h2 className="panel-title">{t('events')}</h2>
      <ol className="feed-list">
        {entries.map((e) => (
          <li key={e.id}>
            <span className="feed-time">{e.atWall === null ? '—' : wallText(e.atWall, timeZone)}</span>{' '}
            <span className="feed-text">{t(e.key, e.params)}</span>
          </li>
        ))}
      </ol>
    </section>
  );
}
