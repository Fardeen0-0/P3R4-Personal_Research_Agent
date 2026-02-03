import React, { useEffect,useMemo, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

type Msg = { role: "user" | "assistant"; text: string };

function clsx(...xs: Array<string | false | null | undefined>) {
  return xs.filter(Boolean).join(" ");
}

type LLMResponse = {
  query: string,
  results: string
}
async function LLMAnswer(query: string): Promise<string>{
  const MOCK_MODE = false; // make it true to mock..... duh

  if (MOCK_MODE) {
    // Simulate network latency
    await new Promise((resolve) => setTimeout(resolve, 1000));
    
    return `### Mock Research Report
    
    Searching for: **${query}**

    1. This is a simulated response.
    2. It allows you to test the "Write to Docs" feature.
    3. No API credits were harmed in the making of this message.`;
  }
  const res = await fetch(`http://localhost:8000/ask?query=${encodeURIComponent(query)}`);

  if (!res.ok){
    const text = await res.text().catch(()=>"");
    throw new Error(text || `Backend error: ${res.status} ${res.statusText}`);
  }

  const data: LLMResponse = await res.json();
  return data.results
}

export default function App() {
  const [screen, setScreen] = useState<"welcome" | "chat">("welcome");
  const [messages, setMessages] = useState<Msg[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [lastAnswerDone, setLastAnswerDone] = useState(false);
  const [writeOpen, setWriteOpen] = useState(false);
  const [writeChecking, setWriteChecking] = useState(false);
  const [docUrl, setDocUrl] = useState("");
  const [writeStatus, setWriteStatus] = useState<"idle" | "sending" | "done">(
    "idle"
  );
  const [writeError, setWriteError] = useState<string | null>(null);

  const scrollRef = useRef<HTMLDivElement | null>(null);

  const canSend = useMemo(() => input.trim().length > 0 && !loading, [input, loading]);

  function scrollToBottom() {
    requestAnimationFrame(() => {
      scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
    });
  }

  async function onSend() {
    const q = input.trim();
    if (!q || loading) return;

    setLastAnswerDone(false);
    setLoading(true);
    setInput("");

    setMessages((prev) => [...prev, { role: "user", text: q }]);
    scrollToBottom();

    try {
      const answer = await LLMAnswer(q);

      setMessages((prev) => [...prev, { role: "assistant", text: answer }]);
      setLastAnswerDone(true);
      scrollToBottom();
    } catch (e: any) {
      setMessages((prev) => [
        ...prev,
        { role: "assistant", text: `Error (mock): ${e?.message ?? String(e)}` },
      ]);
      setLastAnswerDone(true);
    } finally {
      setLoading(false);
      scrollToBottom();
    }
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      onSend();
    }
  }

  async function handleWriteClick() {
    setWriteError(null);
    setWriteStatus("idle");
    setWriteChecking(true);

    try {
      const res = await fetch("http://localhost:8000/docs/status", {
        credentials: "include", // so FastAPI can see session cookie
      });

      if (!res.ok) {
        const text = await res.text().catch(() => "");
        throw new Error(text || `Status ${res.status}`);
      }

      const data = (await res.json()) as { connected: boolean };
      console.log("status response in frontend:", data);

      if (data.connected) {
        // User already connected -> show popup for Docs link
        setWriteOpen(true);
      } else {
        // Not connected -> send them to Google OAuth
        window.location.href = "http://localhost:8000/auth/google/start";
      }
    } catch (e: any) {
      console.error(e);
      setWriteError(e?.message ?? "Failed to check Google Docs connection.");
    } finally {
      setWriteChecking(false);
    }
  }

  function getLastAssistantMessage(): string | null {
    for (let i = messages.length - 1; i >= 0; i--) {
      if (messages[i].role === "assistant") {
        return messages[i].text;
      }
    }
    return null;
  }

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get("write") === "1") {
      // Clear the flag from the URL
      window.history.replaceState({}, "", window.location.pathname);
      // This will run the same logic as clicking "Write"
      void handleWriteClick();
    }
  }, []);

  useEffect(() => {
    try {
      const saved = window.localStorage.getItem("p3r4.messages");
      if (saved) {
        const parsed = JSON.parse(saved) as Msg[];
        if (parsed.length > 0) {
          setMessages(parsed);
          setScreen("chat");        // jump straight into chat if there's history
          setLastAnswerDone(true);  // so Write button appears after auth
        }
      }
    } catch (e) {
      console.error("Failed to load messages from localStorage", e);
    }
  }, []);

  useEffect(() => {
    try {
      window.localStorage.setItem("p3r4.messages", JSON.stringify(messages));
    } catch (e) {
      console.error("Failed to save messages to localStorage", e);
    }
  }, [messages]);



  async function writeToDocs(docUrl: string): Promise<void> {
    const content = getLastAssistantMessage();

    if (!content) {
      setWriteError("There is no assistant response to write yet.");
      return;
    }

    setWriteError(null);
    setWriteStatus("sending");

    try {
      const res = await fetch("http://localhost:8000/docs/write", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        credentials: "include", // sends the session cookie
        body: JSON.stringify({
          doc_url: docUrl,
          text: content,
        }),
      });

      if (!res.ok) {
        const text = await res.text().catch(() => "");
        throw new Error(text || `Write failed: ${res.status}`);
      }

      setWriteStatus("done");
    } catch (e: any) {
      console.error(e);
      setWriteError(e?.message ?? "Failed to write to Google Docs.");
      setWriteStatus("idle");
    }
  }


  return (
    <div style={styles.page}>
      <div style={styles.bgGlow1} />
      <div style={styles.bgGlow2} />

      <div style={styles.shell}>
        <header style={styles.header}>
          <div style={styles.brand}>
            <div style={styles.logo} aria-hidden />
            <div>
              <div style={styles.title}>P3R4</div>
              <div style={styles.subtitle}>Personal Research Agent</div>
            </div>
          </div>

          {screen === "chat" && (
            <button
              style={styles.ghostBtn}
              onClick={() => {
                setScreen("welcome");
                setMessages([]);
                setInput("");
                setLoading(false);
                setLastAnswerDone(false);
                window.localStorage.removeItem("p3r4.messages");
              }}
            >
              Reset
            </button>
          )}
        </header>

        {screen === "welcome" ? (
          <main style={styles.card}>
            <div style={styles.hero}>
              <h1 style={styles.heroH1}>Welcome to P3R4</h1>
              <p style={styles.heroP}>
                Search the web, verify sources, and turn answers into clean write-ups.
              </p>

              <div style={styles.heroRow}>
                <button style={styles.primaryBtn} className="primary-glow" onClick={() => setScreen("chat")}>
                  Start chatting
                </button>
              </div>
            </div>
          </main>
        ) : (
          <main style={styles.chatLayout}>
            <section style={styles.chatCard}>
              <div style={styles.chatTop}>
                <div>
                  <div style={styles.chatTitle}>Chat</div>
                  <div style={styles.chatHint}>
                    Ask a question. You’ll see the response appear below.
                  </div>
                </div>

                <div style={styles.statusPill}>
                  <span
                    className={clsx(
                      "dot",
                      loading ? "loading" : "ready"
                    )}
                  />
                  <span style={{ fontSize: 12, opacity: 0.9 }}>
                    {loading ? "Thinking..." : "Ready"}
                  </span>
                </div>
              </div>

              <div ref={scrollRef} style={styles.messages}>
                {
                  messages.map((m, i) => (
                    <div
                      key={i}
                      style={{
                        ...styles.bubble,
                        ...(m.role === "user" ? styles.userBubble : styles.assistantBubble),
                      }}
                    >
                      <div style={styles.bubbleRole}>
                        {m.role === "user" ? "You" : "P3R4"}
                      </div>
                      <div style={styles.bubbleText}>
                        <ReactMarkdown
                          remarkPlugins={[remarkGfm]}
                          components={{
                            a: ({ node, ...props }) => (
                              <a {...props} target="_blank" rel="noreferrer" />
                            ),
                          }}
                        >
                          {m.text}
                        </ReactMarkdown>
                      </div>
                    </div>
                  ))
                }
                {writeOpen && (
                  <div style={styles.modalOverlay}>
                    <div style={styles.modal}>
                      <div style={styles.modalTitle}>Send to Google Docs</div>
                      <div style={styles.modalBody}>
                        <p style={styles.modalText}>
                          Paste the link to your Google Docs file. The latest answer from P3R4
                          will be written into that document.
                        </p>

                        <input
                          type="text"
                          value={docUrl}
                          onChange={(e) => setDocUrl(e.target.value)}
                          placeholder="https://docs.google.com/document/d/…"
                          style={styles.modalInput}
                        />

                        {writeError && (
                          <div style={styles.modalError}>
                            {writeError}
                          </div>
                        )}

                        {writeStatus === "sending" && (
                          <div style={styles.modalHint}>
                            Please wait. Writing in progress…
                          </div>
                        )}

                        {writeStatus === "done" && (
                          <div style={styles.modalSuccess}>
                            Done! Your content has been written to your docs page.
                          </div>
                        )}
                      </div>

                      <div style={styles.modalButtons}>
                        <button
                          style={styles.modalSecondaryBtn}
                          onClick={() => {
                            setWriteOpen(false);
                            setDocUrl("");
                            setWriteStatus("idle");
                            setWriteError(null);
                          }}
                        >
                          Cancel
                        </button>

                        <button
                          style={styles.modalPrimaryBtn}
                          onClick={() => {
                            if (!docUrl.trim()) return;
                            void writeToDocs(docUrl.trim());
                          }}
                          disabled={!docUrl.trim() || writeStatus === "sending"}
                        >
                          {writeStatus === "sending"
                            ? "Writing…"
                            : writeStatus === "done"
                            ? "Done"
                            : "Write to Docs"}
                        </button>
                      </div>
                    </div>
                  </div>
                )}
              </div>

              <div style={styles.composer}>
                <textarea
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  onKeyDown={onKeyDown}
                  placeholder="Type your question…"
                  style={styles.textarea}
                  rows={2}
                />
                <button
                  style={styles.sendBtn}
                  className={clsx(!canSend && "disabled")}
                  onClick={onSend}
                  disabled={!canSend}
                >
                  Send
                </button>
              </div>

              <div style={styles.footerRow}>
                {lastAnswerDone && (
                  <div style={styles.writeWrap}>
                    <button
                      style={styles.writeBtn}
                      onClick={handleWriteClick}
                      disabled={writeChecking}
                    >
                      {writeChecking ? "Checking..." : "Write"}
                    </button>
                    <div style={styles.writeDesc}>
                      Link your Google account to write into your Docs file.
                    </div>
                  </div>
                )}
              </div>
            </section>
          </main>
        )}
      </div>

      {/* tiny CSS for the status dot */}
      <style>{`
        .dot{
          width:10px;height:10px;border-radius:999px;display:inline-block;
          box-shadow: 0 0 0 3px rgba(255,255,255,0.06);
          margin-right:8px;
        }
        .dot.ready{ background: rgba(130,255,180,0.9); }
        .dot.loading{ background: rgba(255,200,120,0.9); animation: pulse 1.05s infinite; }
        @keyframes pulse { 0%{transform:scale(1)} 50%{transform:scale(1.35)} 100%{transform:scale(1)} }
        .disabled{ opacity:0.55; cursor:not-allowed; 
        }
        .primary-glow:hover {
          transform: translateY(-2px);
          box-shadow:
            0 10px 30px rgba(120, 140, 255, 0.35),
            0 0 0 6px rgba(120, 140, 255, 0.12);
          filter: brightness(1.05);
        }

        .primary-glow:active {
          transform: translateY(0);
          box-shadow:
            0 6px 18px rgba(120, 140, 255, 0.25);
      }  
      `}</style>
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  page: {
    minHeight: "100vh",
    width: "100%",
    height: "100vh",
    background: "radial-gradient(1200px 600px at 20% 10%, rgba(120,140,255,0.18), transparent 60%), radial-gradient(900px 500px at 90% 30%, rgba(255,130,200,0.16), transparent 55%), #070A12",
    color: "rgba(255,255,255,0.92)",
    fontFamily:
      'ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, Helvetica, Arial, "Apple Color Emoji","Segoe UI Emoji"',
    position: "relative",
    overflow: "hidden",
  },
  bgGlow1: {
    position: "absolute",
    inset: "-20% auto auto -20%",
    width: 420,
    height: 420,
    filter: "blur(60px)",
    background: "rgba(120,140,255,0.25)",
    borderRadius: 999,
    pointerEvents: "none",
  },
  bgGlow2: {
    position: "absolute",
    inset: "10% -20% auto auto",
    width: 380,
    height: 380,
    filter: "blur(60px)",
    background: "rgba(255,130,200,0.20)",
    borderRadius: 999,
    pointerEvents: "none",
  },
  shell: {
    width: "min(1200px, 92vw)",
    margin: "0 auto",
    padding: "26px 0 36px",
    position: "relative",
    zIndex: 1,
  },
  header: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 18,
  },
  brand: { display: "flex", gap: 12, alignItems: "center" },
  logo: {
    width: 42,
    height: 42,
    borderRadius: 14,
    background:
      "linear-gradient(135deg, rgba(120,140,255,0.95), rgba(255,130,200,0.9))",
    boxShadow: "0 18px 60px rgba(120,140,255,0.15)",
  },
  title: { fontSize: 18, fontWeight: 800, letterSpacing: 0.3 },
  subtitle: { fontSize: 12, opacity: 0.7, marginTop: 2 },

  ghostBtn: {
    background: "rgba(255,255,255,0.06)",
    border: "1px solid rgba(255,255,255,0.12)",
    color: "rgba(255,255,255,0.9)",
    borderRadius: 12,
    padding: "10px 12px",
    cursor: "pointer",
  },

  card: {
    background: "rgba(255,255,255,0.06)",
    border: "1px solid rgba(255,255,255,0.10)",
    borderRadius: 20,
    padding: "64px 56px",
    boxShadow: "0 30px 120px rgba(0,0,0,0.45)",
    backdropFilter: "blur(10px)",
  },
  hero: { padding: 48, textAlign: "center"  },
  heroH1: { margin: 0, fontSize: 48, letterSpacing: -0.6, lineHeight: 1.25 },
  heroP: { marginTop: 10, marginBottom: 40, fontSize: 15, opacity: 0.85, lineHeight: 1.8, maxWidth: 900, marginLeft: "auto", marginRight: "auto", textAlign: "center" },
  heroRow: { display: "flex", alignItems: "center", gap: 14, flexWrap: "wrap", justifyContent: "center" },
  primaryBtn: {
    background:
      "linear-gradient(135deg, rgba(120,140,255,0.95), rgba(255,130,200,0.92))",
    border: "none",
    color: "rgba(10,10,18,0.95)",
    fontSize: 18,
    fontWeight: 800,
    borderRadius: 14,
    padding: "20px 24px",
    cursor: "pointer",
    transition: "transform 0.25s ease, box-shadow 0.25s ease, filter 0.25s ease",
  },
  miniNote: { fontSize: 12, opacity: 0.75 },

  feature: {
    background: "rgba(0,0,0,0.20)",
    border: "1px solid rgba(255,255,255,0.10)",
    borderRadius: 16,
    padding: 14,
  },
  featureKicker: { fontSize: 12, opacity: 0.7, fontWeight: 700, marginBottom: 6 },
  featureText: { fontSize: 13, opacity: 0.86, lineHeight: 1.35 },

  chatLayout: { height: "calc(100vh - 120px)",},
  chatCard: {
    background: "rgba(255,255,255,0.06)",
    border: "1px solid rgba(255,255,255,0.10)",
    borderRadius: 20,
    overflow: "hidden",
    boxShadow: "0 30px 120px rgba(0,0,0,0.45)",
    backdropFilter: "blur(10px)",
    height: "100%",
    display: "flex",
    flexDirection: "column",
  },
  chatTop: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    padding: 18,
    borderBottom: "1px solid rgba(255,255,255,0.08)",
  },
  chatTitle: { fontSize: 16, fontWeight: 800 },
  chatHint: { fontSize: 12, opacity: 0.7, marginTop: 4 },
  statusPill: {
    display: "flex",
    alignItems: "center",
    gap: 8,
    background: "rgba(0,0,0,0.22)",
    border: "1px solid rgba(255,255,255,0.10)",
    borderRadius: 999,
    padding: "8px 10px",
  },

  messages: {
    flex: 1,
    overflow: "auto",
    padding: 18,
  },
  emptyState: {
    background: "rgba(0,0,0,0.18)",
    border: "1px dashed rgba(255,255,255,0.16)",
    borderRadius: 16,
    padding: 16,
  },
  emptyTitle: { fontSize: 13, fontWeight: 700, opacity: 0.9, marginBottom: 10 },
  emptyChips: { display: "flex", gap: 10, flexWrap: "wrap" },
  chip: {
    background: "rgba(255,255,255,0.06)",
    border: "1px solid rgba(255,255,255,0.12)",
    color: "rgba(255,255,255,0.9)",
    borderRadius: 999,
    padding: "8px 10px",
    cursor: "pointer",
    fontSize: 12,
  },

  bubble: {
    borderRadius: 16,
    padding: 14,
    marginBottom: 12,
    border: "1px solid rgba(255,255,255,0.10)",
  },
  userBubble: {
    background: "rgba(120,140,255,0.12)",
  },
  assistantBubble: {
    background: "rgba(0,0,0,0.22)",
  },
  bubbleRole: { fontSize: 12, opacity: 0.7, fontWeight: 700, marginBottom: 8 },
  bubbleText: {
    margin: 0,
    whiteSpace: "pre-wrap",
    fontFamily:
      'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace',
    fontSize: 13,
    lineHeight: 1.55,
    opacity: 0.95,
  },

  composer: {
    display: "flex",
    gap: 10,
    padding: 14,
    borderTop: "1px solid rgba(255,255,255,0.08)",
    background: "rgba(0,0,0,0.16)",
  },
  textarea: {
    flex: 1,
    resize: "none",
    background: "rgba(255,255,255,0.06)",
    border: "1px solid rgba(255,255,255,0.10)",
    borderRadius: 14,
    color: "rgba(255,255,255,0.92)",
    padding: 12,
    outline: "none",
  },
  sendBtn: {
    width: 110,
    borderRadius: 14,
    border: "none",
    fontWeight: 800,
    cursor: "pointer",
    background:
      "linear-gradient(135deg, rgba(120,140,255,0.95), rgba(255,130,200,0.92))",
    color: "rgba(10,10,18,0.95)",
  },

  footerRow: {
    display: "flex",
    alignItems: "flex-end",
    justifyContent: "space-between",
    gap: 12,
    padding: "12px 14px 16px",
    borderTop: "1px solid rgba(255,255,255,0.06)",
  },
  smallPrint: { fontSize: 12, opacity: 0.65 },
  writeWrap: { display: "flex", alignItems: "center", gap: 10 },
  writeBtn: {
    background: "rgba(255,255,255,0.08)",
    border: "1px solid rgba(255,255,255,0.14)",
    color: "rgba(255,255,255,0.92)",
    borderRadius: 12,
    padding: "10px 12px",
    cursor: "pointer",
    fontWeight: 800,
  },
  writeDesc: { fontSize: 12, opacity: 0.7, maxWidth: 320 },

  modalOverlay: {
    position: "fixed",
    inset: 0,
    background: "rgba(0,0,0,0.55)",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    zIndex: 40,
  },
  modal: {
    width: "min(480px, 92vw)",
    background: "rgba(10,10,16,0.96)",
    borderRadius: 20,
    border: "1px solid rgba(255,255,255,0.12)",
    boxShadow: "0 30px 120px rgba(0,0,0,0.65)",
    padding: 22,
  },
  modalTitle: {
    fontSize: 18,
    fontWeight: 800,
    marginBottom: 8,
  },
  modalBody: {
    marginTop: 8,
    marginBottom: 16,
  },
  modalText: {
    fontSize: 14,
    opacity: 0.8,
    marginBottom: 12,
  },
  modalInput: {
    width: "100%",
    padding: 10,
    borderRadius: 12,
    border: "1px solid rgba(255,255,255,0.16)",
    background: "rgba(255,255,255,0.04)",
    color: "rgba(255,255,255,0.92)",
    fontSize: 13,
    outline: "none",
    marginBottom: 10,
  },
  modalButtons: {
    display: "flex",
    justifyContent: "flex-end",
    gap: 10,
    marginTop: 6,
  },
  modalSecondaryBtn: {
    background: "rgba(255,255,255,0.04)",
    border: "1px solid rgba(255,255,255,0.14)",
    color: "rgba(255,255,255,0.9)",
    borderRadius: 12,
    padding: "8px 12px",
    cursor: "pointer",
    fontSize: 13,
    fontWeight: 500,
  },
  modalPrimaryBtn: {
    background:
      "linear-gradient(135deg, rgba(120,140,255,0.95), rgba(255,130,200,0.92))",
    border: "none",
    color: "rgba(10,10,18,0.95)",
    borderRadius: 12,
    padding: "8px 14px",
    cursor: "pointer",
    fontSize: 13,
    fontWeight: 700,
  },
  modalError: {
    marginTop: 6,
    fontSize: 12,
    color: "#ffb3b3",
  },
  modalHint: {
    marginTop: 6,
    fontSize: 12,
    opacity: 0.8,
  },
  modalSuccess: {
    marginTop: 6,
    fontSize: 12,
    color: "#a5ffbf",
  },

};
