import { useCallback, useEffect, useState } from "react";
import { FormattedMessage, useIntl, defineMessages } from "react-intl";
import { Navigate, Outlet, useMatch, useNavigate } from "react-router-dom";
import { useSetAtom, useStore } from "jotai";
import { Sidebar } from "../components/Sidebar";
import { DailyQuizFab, DailyQuizPanel } from "../components/DailyQuizPanel";
import { useAuth, useAuthMutations } from "../hooks/auth";
import { useChatList, useChatMutations } from "../hooks/chats";
import { chatFamily, chatIdsAtom } from "../store/chats";
import { courseJobFamily } from "../store/courseJobs";
import { cancelCourseJob } from "../streams/runCourseGeneration";
import { useSaveEffect } from "../store/saveEffect";
import "./Root.css";

const msgs = defineMessages({
  openSidebar: { defaultMessage: "Open chat list" },
  closeSidebar: { defaultMessage: "Close chat list" },
  closeSidebarBackdrop: { defaultMessage: "Close chat list" },
});

export function Root() {
  const auth = useAuth();
  const authM = useAuthMutations();
  const chatM = useChatMutations();
  const navigate = useNavigate();
  const store = useStore();
  const intl = useIntl();
  const setChatIds = useSetAtom(chatIdsAtom);
  const chatList = useChatList(auth.data?.authenticated === true);
  const match = useMatch("/chats/:id");
  const activeId = match?.params.id ?? "";
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const closeSidebar = useCallback(() => setSidebarOpen(false), []);

  // Keep chatIdsAtom populated from the server chat list so the save effect
  // observes every persisted chat, not just the active one. Also seed each
  // chat atom with the summary so sidebarEntriesAtom shows the real title
  // and createdAt before the full chat hydrates.
  useEffect(() => {
    if (!chatList.data) return;
    for (const c of chatList.data) {
      const atomRef = chatFamily(c.id);
      const prev = store.get(atomRef);
      if (prev.createdAt === 0) {
        store.set(atomRef, {
          ...prev,
          title: c.title,
          createdAt: c.createdAt,
          updatedAt: c.updatedAt,
        });
      }
    }
    const serverIds = chatList.data.map((c) => c.id);
    setChatIds((prev) => {
      // Preserve ONLY ids with a live course job. Any other id absent from
      // the server list is stale (multi-tab deletion, session expiry,
      // cache eviction) and must not be resurrected.
      const serverSet = new Set(serverIds);
      const placeholders = prev.filter(
        (id) => !serverSet.has(id) && store.get(courseJobFamily(id)) !== null,
      );
      return [...placeholders, ...serverIds];
    });
  }, [chatList.data, setChatIds, store]);

  // Subscribe to every chat atom and debounce PATCHes on change.
  useSaveEffect();

  if (auth.isPending)
    return (
      <div className="centered muted">
        <FormattedMessage defaultMessage="Loading…" />
      </div>
    );
  if (!auth.data?.authenticated) return <Navigate to="/signin" replace />;

  const onNew = () => {
    closeSidebar();
    void chatM.create.mutateAsync().then((chat) => navigate(`/chats/${chat.id}`));
  };

  const onDelete = (id: string) => {
    if (store.get(courseJobFamily(id))) {
      cancelCourseJob(store, id);
      return;
    }
    // No manual chatIdsAtom filter — the sync effect (gated on live course
    // job presence) drops the id automatically once the mutation's optimistic
    // ['chats'] update lands. Navigation handled by mutation onSuccess.
    void chatM.remove.mutateAsync(id).catch(() => {
      /* optimistic delete stands */
    });
  };

  return (
    <div className={`app ${sidebarOpen ? "sidebar-drawer-open" : ""}`}>
      <header>
        <button
          type="button"
          className="sidebar-toggle"
          aria-label={intl.formatMessage(sidebarOpen ? msgs.closeSidebar : msgs.openSidebar)}
          aria-expanded={sidebarOpen}
          aria-controls="app-sidebar"
          onClick={() => setSidebarOpen((v) => !v)}
        >
          <svg
            width="18"
            height="18"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            aria-hidden="true"
          >
            <path d="M3 6h18M3 12h18M3 18h18" />
          </svg>
        </button>
        <span className="brand">
          <FormattedMessage defaultMessage="claude-learning" />
        </span>
        <span className="spacer" />
        <span className="muted small user-chip">
          <FormattedMessage
            defaultMessage="signed in as {username}"
            values={{ username: auth.data.username }}
          />
        </span>
        <button type="button" className="ghost" onClick={() => authM.signOut.mutate()}>
          <FormattedMessage defaultMessage="Sign out" />
        </button>
      </header>
      <main>
        <button
          type="button"
          className="sidebar-backdrop"
          aria-label={intl.formatMessage(msgs.closeSidebarBackdrop)}
          onClick={closeSidebar}
          tabIndex={sidebarOpen ? 0 : -1}
        />
        <Sidebar
          id="app-sidebar"
          open={sidebarOpen}
          activeId={activeId}
          onSelect={(id) => {
            closeSidebar();
            navigate(`/chats/${id}`);
          }}
          onNew={onNew}
          onDelete={onDelete}
          onFocusJob={(id) => {
            closeSidebar();
            navigate(`/chats/${id}`);
          }}
          onCancelJob={(id) => cancelCourseJob(store, id)}
        />
        <section className="chat-area">
          <Outlet />
        </section>
      </main>
      <DailyQuizPanel enabled={auth.data?.authenticated === true} />
      <DailyQuizFab enabled={auth.data?.authenticated === true} />
    </div>
  );
}
