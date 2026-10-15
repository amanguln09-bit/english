"use client";
import { useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import { GameArtwork, QuestionArtwork } from "./components/game-artwork";
type User = { id: string; email: string; role: string };
type G = {
  id: string;
  title: string;
  grade: number;
  term: number;
  topic: string;
  template: string;
  objective: string;
  instructions: string;
  sample: boolean;
  status: string;
  owner: string | null;
  questions: any[];
};
async function api(path: string, body?: unknown, token?: string) {
  const r = await fetch("/api" + path, {
    method: body === undefined ? "GET" : "POST",
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: "Bearer " + token } : {}),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const data = await r.json();
  if (!r.ok) throw Error(data.error || "Request failed");
  return data;
}
const icons: Record<string, string> = {
  "word-race": "⚡",
  picture: "🖼️",
  "odd-one-out": "🔎",
  "mystery-box": "🎁",
  "brain-battle": "🧠",
};
export default function Client() {
  const path = usePathname();
  const [lang, L] = useState("kk");
  const [me, M] = useState<User | null>(null);
  const [ready, R] = useState(false);
  const [error, E] = useState("");
  const [items, I] = useState<G[]>([]);
  const [history, H] = useState<any[]>([]);
  const [grade, F] = useState("");
  const [term, T] = useState("");
  const [search, S] = useState("");
  const [email, Em] = useState("");
  const [password, Pw] = useState("");
  const [game, Gm] = useState<G | null>(null);
  const [editor, Ed] = useState("");
  const [duration, D] = useState(180);
  const [feedback, Fb] = useState("teacher");
  const [pin, Pin] = useState("");
  const [name, N] = useState("");
  const [busy, B] = useState(false);
  const [snapshot, V] = useState<any>(null);
  const [choice, C] = useState<string[]>([]);
  const [qr, Q] = useState("");
  const [connected, Conn] = useState(false);
  const [now, Now] = useState(Date.now());
  const [received, Recv] = useState(Date.now());
  const t = (kk: string, en: string) => (lang === "kk" ? kk : en);
  const parts = path.split("/").filter(Boolean);
  const sessionId =
    parts[0] === "sessions" ? parts[1] : parts[0] === "play" ? parts[1] : null;
  const role =
    parts[0] === "play"
      ? "student"
      : parts[2] === "display"
        ? "display"
        : "host";
  const act = async (fn: () => Promise<void>) => {
    E("");
    B(true);
    try {
      await fn();
    } catch (e) {
      E((e as Error).message);
    } finally {
      B(false);
    }
  };
  useEffect(() => {
    const saved = localStorage.getItem("ebg-lang");
    if (saved) L(saved);
    api("/me")
      .then((x) => M(x.user))
      .catch((e) => E(e.message))
      .finally(() => R(true));
    Pin(new URLSearchParams(location.search).get("pin") || "");
  }, []);
  useEffect(() => {
    if (!ready) return;
    let alive = true;
    const load = async () => {
      try {
        if (
          ["/dashboard", "/curriculum", "/admin"].includes(path) ||
          parts[0] === "topics"
        ) {
          if (me) {
            const list = await api("/games");
            if (alive) I(list);
          }
          if (path === "/dashboard" && me) H(await api("/sessions"));
        }
        if (parts[0] === "games") {
          const g = await api("/games/" + parts[1]);
          if (alive) {
            Gm(g);
            Ed(JSON.stringify(g, null, 2));
          }
        }
      } catch (e) {
        if (alive) E((e as Error).message);
      }
    };
    load();
    return () => {
      alive = false;
    };
  }, [path, ready, me]);
  useEffect(() => {
    if (!sessionId || !ready) return;
    let stopped = false,
      ws: WebSocket | undefined,
      retry: ReturnType<typeof setTimeout>;
    const token = localStorage.getItem("participant:" + sessionId) || "";
    const receive = (v: any) => {
      V(v);
      Recv(Date.now());
    };
    const connect = async () => {
      let relay: string | null = null;
      try {
        relay = (
          await api(
            `/sessions/${sessionId}/realtime?role=${role}`,
            undefined,
            token,
          )
        ).url;
      } catch {}
      if (stopped) return;
      ws = new WebSocket(
        relay ||
          `${location.protocol === "https:" ? "wss" : "ws"}://${location.host}/realtime`,
      );
      ws.onopen = () => {
        if (!relay) ws?.send(JSON.stringify({ id: sessionId, role, token }));
      };
      ws.onmessage = (e) => {
        Conn(true);
        E("");
        receive(JSON.parse(e.data));
      };
      ws.onclose = () => {
        Conn(false);
        if (!stopped) retry = setTimeout(connect, 2000);
      };
      ws.onerror = () => Conn(false);
    };
    api(`/sessions/${sessionId}?role=${role}`, undefined, token)
      .then(receive)
      .catch((e) => E(e.message));
    connect();
    const poll = setInterval(() => {
      api(`/sessions/${sessionId}?role=${role}`, undefined, token)
        .then(receive)
        .catch((e) => E(e.message));
    }, 3000);
    const tick = setInterval(() => Now(Date.now()), 250);
    if (role === "host")
      api(`/sessions/${sessionId}/qr`)
        .then((x) => Q(x.image))
        .catch(() => {});
    return () => {
      stopped = true;
      clearTimeout(retry);
      clearInterval(poll);
      clearInterval(tick);
      ws?.close();
    };
  }, [sessionId, role, ready]);
  useEffect(() => C([]), [snapshot?.index]);
  const start = async (id: string) => {
    const s = await api("/sessions", { gameId: id, duration, feedback });
    location.href = `/sessions/${s.id}/host`;
  };
  const protectedPage =
    ["dashboard", "games", "topics", "admin"].includes(parts[0]) ||
    (parts[0] === "sessions" && role === "host");
  let content: React.ReactNode;
  if (!ready) content = <p role="status">{t("Жүктелуде…", "Loading…")}</p>;
  else if (protectedPage && !me)
    content = (
      <section className="card narrow">
        <h1>{t("Мұғалім ретінде кіру", "Teacher sign in")}</h1>
        <p>
          {t(
            "Бұл бетке кіру үшін тіркелгі қажет.",
            "Sign in to access this page.",
          )}
        </p>
        <a className="button" href="/login">
          {t("Кіру", "Sign in")}
        </a>
      </section>
    );
  else if (path === "/")
    content = (
      <>
        <section className="hero">
          <div>
            <div className="eyebrow">English • Grades 6–8 • Kazakhstan</div>
            <h1>
              {t("Ойна. Ойлан.", "Play. Think.")}
              <br />
              <span className="accent">
                {t("Ағылшынша сөйле.", "Speak English.")}
              </span>
            </h1>
            <p className="muted">
              {t(
                "Бүкіл сыныпты бір ойынға біріктіріңіз. Мұғалімге басқару, оқушыға телефон, сыныпқа ортақ экран.",
                "Bring your whole classroom together. One teacher, every phone, one shared adventure.",
              )}
            </p>
            <div className="row">
              <a className="button" href="/dashboard">
                {t("Мұғалім кабинеті", "Teacher workspace")} →
              </a>
              <a className="button secondary" href="/join">
                {t("Ойынға қосылу", "Join a game")}
              </a>
            </div>
            <p className="small muted">
              {t(
                "Оқушыға тіркелгі қажет емес · QR немесе PIN",
                "No student account needed · QR or PIN",
              )}
            </p>
          </div>
          <div className="hero-art hero-art--illustrated">
            <GameArtwork template="brain-battle" priority />
            <div className="hero-art-caption">
              <span className="eyebrow">English Brain Games</span>
              <strong>
                {t(
                  "Бес ойын. Бір қызықты сабақ.",
                  "Five games. One brilliant lesson.",
                )}
              </strong>
              <span>
                {t(
                  "Бірге ойла. Бірге үйрен.",
                  "Think together. Learn together.",
                )}
              </span>
            </div>
          </div>
        </section>
        <div className="grid">
          {[
            [
              "01",
              t("Ойынды таңдаңыз", "Choose a challenge"),
              t(
                "Бес ойын үлгісі, 6–8 сыныптарға арналған мысалдар.",
                "Five game templates with labelled classroom samples.",
              ),
            ],
            [
              "02",
              t("Сыныпты қосыңыз", "Bring everyone in"),
              t(
                "QR-кодты көрсетіңіз немесе PIN беріңіз.",
                "Show a QR code or share the session PIN.",
              ),
            ],
            [
              "03",
              t("Нәтижені талқылаңыз", "Make learning visible"),
              t(
                "Жауаптарды ашып, нәтижелерді бірге талдаңыз.",
                "Reveal answers and discuss the results together.",
              ),
            ],
          ].map((x) => (
            <div className="card" key={x[0]}>
              <span className="eyebrow">{x[0]}</span>
              <h2>{x[1]}</h2>
              <p className="muted">{x[2]}</p>
            </div>
          ))}
        </div>
        <div className="notice">
          {t(
            "Ойындар — авторлық мысалдар. Ресми оқу бағдарламасымен сәйкестік әлі расталмаған.",
            "Games are original samples. Official curriculum alignment is not yet verified.",
          )}
        </div>
      </>
    );
  else if (path === "/login")
    content = (
      <form
        className="card narrow stack"
        onSubmit={(e) => {
          e.preventDefault();
          act(async () => {
            await api("/login", { email, password });
            location.href = "/dashboard";
          });
        }}
      >
        <span className="eyebrow">Teacher workspace</span>
        <h1>{t("Қош келдіңіз", "Welcome back")}</h1>
        <label>
          Email
          <input
            autoComplete="username"
            type="email"
            required
            value={email}
            onChange={(e) => Em(e.target.value)}
          />
        </label>
        <label>
          {t("Құпиясөз", "Password")}
          <input
            autoComplete="current-password"
            type="password"
            required
            value={password}
            onChange={(e) => Pw(e.target.value)}
          />
        </label>
        <button disabled={busy}>{t("Кіру", "Sign in")}</button>
        <p className="small muted">
          {t(
            "Тіркелгіні әкімші береді. Жергілікті орта үшін README нұсқаулығын қараңыз.",
            "Accounts are provisioned by your administrator. See README for local setup.",
          )}
        </p>
      </form>
    );
  else if (path === "/join")
    content = (
      <form
        className="card narrow stack"
        onSubmit={(e) => {
          e.preventDefault();
          act(async () => {
            const r = await api("/join", { pin, name });
            localStorage.setItem("participant:" + r.sessionId, r.token);
            location.href = "/play/" + r.sessionId;
          });
        }}
      >
        <span className="eyebrow">Let’s play</span>
        <h1>{t("Ойынға қосыл", "Join your class")}</h1>
        <label>
          PIN
          <input
            inputMode="numeric"
            pattern="[0-9]{6}"
            maxLength={6}
            required
            value={pin}
            onChange={(e) => Pin(e.target.value)}
          />
        </label>
        <label>
          {t("Лақап ат", "Nickname")}
          <input
            maxLength={24}
            required
            value={name}
            onChange={(e) => N(e.target.value)}
          />
        </label>
        <p className="small muted">
          {t(
            "Толық атыңызды жазбаңыз. Мұғалім берген лақап атты пайдаланыңыз.",
            "Use a classroom nickname, not your full name.",
          )}
        </p>
        <button disabled={busy}>{t("Қосылу", "Join game")} →</button>
      </form>
    );
  else if (path === "/curriculum")
    content = (
      <>
        <div className="eyebrow">Curriculum • Sources & verification</div>
        <h1>{t("Оқу бағдарламасы", "Curriculum explorer")}</h1>
        <div className="notice">
          {t(
            "Ресми мақсаттар: 0 тексерілген. №399 бұйрық, 49-қосымша мәтініне қолжетімділік бұғатталған. Толық қамту туралы мәлімдеме жасалмайды.",
            "0 verified official objectives. Access to Order 399, Annex 49 was blocked. No full coverage claim is made.",
          )}
        </div>
        <p>
          <a
            href="https://adilet.zan.kz/rus/docs/V2200029767"
            target="_blank"
            rel="noreferrer"
          >
            Әділет — №399 ↗
          </a>
        </p>
        <h2>
          {t(
            "Авторлық тақырыптар — сәйкестік тексерілмеген",
            "Sample topics — mappings unverified",
          )}
        </h2>
        <div className="grid">
          {items
            .filter((g) => g.sample)
            .map((g) => (
              <a
                className="card topic-card"
                key={g.id}
                href={"/topics/" + g.id}
              >
                <GameArtwork template={g.template} />
                <span className="tag">
                  Grade {g.grade} · Term {g.term}
                </span>
                <h2>{g.topic}</h2>
                <p>{g.objective}</p>
                <span className="muted">Unverified mapping</span>
              </a>
            ))}
        </div>
        {!me && (
          <p>
            <a href="/login">
              {t(
                "Мысалдарды көру үшін кіріңіз",
                "Sign in to browse sample topics",
              )}
            </a>
          </p>
        )}
      </>
    );
  else if (path === "/dashboard" || parts[0] === "topics")
    content = (
      <>
        <div className="eyebrow">Teacher workspace</div>
        <h1>
          {parts[0] === "topics"
            ? items.find((g) => g.id === parts[1])?.topic ||
              t("Тақырып", "Topic")
            : t("Бүгін не үйренеміз?", "What will we learn today?")}
        </h1>
        <div className="notice">
          {t(
            "Мысал ойындар. Ресми оқу мақсаттарына сәйкестік тексерілмеген.",
            "Sample games. Official objective mappings remain unverified.",
          )}
        </div>
        <div className="row">
          <label>
            {t("Сынып", "Grade")}
            <select value={grade} onChange={(e) => F(e.target.value)}>
              <option value="">All</option>
              {[6, 7, 8].map((n) => (
                <option key={n}>{n}</option>
              ))}
            </select>
          </label>
          <label>
            {t("Тоқсан", "Term")}
            <select value={term} onChange={(e) => T(e.target.value)}>
              <option value="">All</option>
              {[1, 2, 3, 4].map((n) => (
                <option key={n}>{n}</option>
              ))}
            </select>
          </label>
          <label>
            {t("Тақырып / мақсат", "Topic / objective")}
            <input
              value={search}
              onChange={(e) => S(e.target.value)}
              placeholder="Search…"
            />
          </label>
        </div>
        <br />
        <div className="grid">
          {items
            .filter(
              (g) =>
                (!grade || g.grade === +grade) &&
                (!term || g.term === +term) &&
                (!search ||
                  (g.title + " " + g.topic + " " + g.objective)
                    .toLowerCase()
                    .includes(search.toLowerCase())) &&
                (parts[0] !== "topics" || g.id === parts[1]),
            )
            .map((g) => (
              <article
                className="card stack game-card"
                key={g.id}
                data-template={g.template}
              >
                <GameArtwork template={g.template} />
                <div className="row">
                  <span className="icon">{icons[g.template]}</span>
                  <span className="tag">
                    Grade {g.grade} · {g.status}
                  </span>
                </div>
                <h2>{g.title}</h2>
                <p className="muted">{g.topic}</p>
                <p className="small">{g.instructions}</p>
                <a className="button" href={"/games/" + g.id}>
                  {t("Ойынды ашу", "Explore game")} →
                </a>
              </article>
            ))}
        </div>
        {!items.length && <p>{t("Ойындар әзірге жоқ.", "No games yet.")}</p>}
        {path === "/dashboard" && (
          <>
            <h2>{t("Сессиялар тарихы", "Session history")}</h2>
            {history.length ? (
              history.map((s) => (
                <div className="card row" key={s.id}>
                  <strong>{s.title}</strong>
                  <span className="tag">{s.state}</span>
                  <span>{s.count} players</span>
                  <a href={`/sessions/${s.id}/host`}>Host →</a>
                  <a href={`/sessions/${s.id}/results`}>Results →</a>
                </div>
              ))
            ) : (
              <p className="muted">
                {t(
                  "Алғашқы ойыныңызды бастаңыз.",
                  "Start your first classroom game.",
                )}
              </p>
            )}
          </>
        )}
      </>
    );
  else if (parts[0] === "games")
    content = game ? (
      <div className="stack">
        <span className="eyebrow">
          {game.template} · Grade {game.grade}
        </span>
        <h1>{game.title}</h1>
        <GameArtwork
          template={game.template}
          className="game-preview-art"
          priority
        />
        <div className="card stack">
          <p>{game.objective}</p>
          <p>{game.instructions}</p>
          <span className="tag">{game.status} · Sample content</span>
          <div className="row">
            <label>
              {t("Ұзақтығы", "Duration")}
              <select value={duration} onChange={(e) => D(+e.target.value)}>
                {[180, 240, 300, 360, 420].map((n) => (
                  <option value={n} key={n}>
                    {n / 60} min
                  </option>
                ))}
              </select>
            </label>
            <label>
              {t("Кері байланыс", "Feedback")}
              <select value={feedback} onChange={(e) => Fb(e.target.value)}>
                <option value="teacher">
                  {t("Мұғалім ашады", "Teacher reveal")}
                </option>
                <option value="immediate">{t("Бірден", "Immediate")}</option>
              </select>
            </label>
            <button disabled={busy} onClick={() => act(() => start(game.id))}>
              {t("Сессия құру", "Launch session")}
            </button>
            <button
              className="secondary"
              disabled={busy}
              onClick={() =>
                act(async () => {
                  const g = await api("/games/" + game.id + "/copy", {});
                  location.href = "/games/" + g.id;
                })
              }
            >
              {t("Жеке көшірме жасау", "Make my copy")}
            </button>
          </div>
        </div>
        <h2>{t("Сұрақтар мен жауап кілті", "Questions & answer key")}</h2>
        {game.questions.map((q: any) => (
          <div className="card" key={q.id}>
            <h2>{q.prompt}</h2>
            {q.image && (
              <QuestionArtwork src={q.image} alt="Animal illustration" />
            )}
            <p>{q.options.join(" · ")}</p>
            <p className="success">
              {q.kind === "discussion"
                ? "Discussion — teacher feedback"
                : q.answer.join(" → ")}
            </p>
            <p>{q.explanation}</p>
          </div>
        ))}
        {game.owner === me?.id && (
          <div className="card stack">
            <h2>{t("Жеке көшірмені өңдеу", "Edit personal copy")}</h2>
            <p>
              Saving returns this copy to draft. Published originals stay
              unchanged.
            </p>
            <label>
              Game JSON
              <textarea value={editor} onChange={(e) => Ed(e.target.value)} />
            </label>
            <button
              disabled={busy}
              onClick={() =>
                act(async () => {
                  const g = await api("/games/" + game.id, JSON.parse(editor));
                  Gm(g);
                  Ed(JSON.stringify(g, null, 2));
                })
              }
            >
              {t("Жобаны сақтау", "Save draft")}
            </button>
          </div>
        )}
      </div>
    ) : (
      <p>{t("Ойын жүктелуде…", "Loading game…")}</p>
    );
  else if (sessionId)
    content = snapshot ? (
      <section className="stack game-session" data-template={snapshot.template}>
        <div className="row">
          <span className="tag">{snapshot.state}</span>
          <span className="tag">
            {snapshot.count} {t("қатысушы", "players")}
          </span>
          <span className="small" role="status">
            {connected
              ? t("Қосылды", "Connected")
              : t("Қайта қосылуда…", "Reconnecting…")}
          </span>
          <span className="timer">
            {Math.ceil(
              Math.max(
                0,
                snapshot.remaining -
                  (snapshot.state === "ACTIVE" ? now - received : 0),
              ) / 1000,
            )}
            s
          </span>
        </div>
        <h1>{snapshot.title}</h1>
        {snapshot.state === "LOBBY" && (
          <div className="card session-lobby">
            <GameArtwork
              template={snapshot.template}
              className="lobby-art"
              priority
            />
            <div className="lobby-details">
              <span className="eyebrow">
                {t("Сынып дайын ба?", "Ready, class?")}
              </span>
              <p>{t("PIN арқылы қосылыңыз", "Join with PIN")}</p>
              <div className="pin">{snapshot.pin}</div>
              {qr && (
                <img
                  src={qr}
                  width={180}
                  height={180}
                  alt="Join session QR code"
                />
              )}
              <p>
                {role === "student"
                  ? t(
                      "Мұғалімнің бастауын күтіңіз.",
                      "Wait for your teacher to start.",
                    )
                  : t(
                      "Оқушылар join бетінде PIN енгізеді.",
                      "Students enter the PIN on the join page.",
                    )}
              </p>
            </div>
          </div>
        )}
        {role === "host" && (
          <div className="card stack">
            <div className="row">
              <a
                className="button secondary"
                href={`/sessions/${sessionId}/display`}
                target="_blank"
              >
                {t("Тақта экраны", "Open board")} ↗
              </a>
              <button
                className="secondary"
                onClick={() => document.documentElement.requestFullscreen?.()}
              >
                {t("Толық экран", "Fullscreen")}
              </button>
              <a
                className="button secondary"
                href={`/api/sessions/${sessionId}/export`}
              >
                CSV
              </a>
            </div>
            <div className="row">
              {(snapshot.state === "LOBBY"
                ? ["start", "cancel"]
                : snapshot.state === "ACTIVE"
                  ? ["pause", "reveal", "next", "finish"]
                  : snapshot.state === "PAUSED"
                    ? ["resume", "reveal", "next", "finish"]
                    : []
              ).map((action) => (
                <button
                  key={action}
                  disabled={busy}
                  onClick={() =>
                    act(async () => {
                      V(
                        await api(`/sessions/${sessionId}/command`, { action }),
                      );
                      Recv(Date.now());
                    })
                  }
                >
                  {(
                    {
                      start: "Бастау",
                      cancel: "Болдырмау",
                      pause: "Үзіліс",
                      resume: "Жалғастыру",
                      reveal: "Жауапты ашу",
                      next: "Келесі",
                      finish: "Аяқтау",
                    } as any
                  )[lang === "kk" ? action : ""] || action}
                </button>
              ))}
            </div>
            <p>
              {snapshot.answered ?? 0} answered ·{" "}
              {snapshot.participants.map((p: any) => p.name).join(", ")}
            </p>
          </div>
        )}
        {role === "display" && (
          <button
            onClick={() => document.documentElement.requestFullscreen?.()}
          >
            {t("Толық экран", "Fullscreen")}
          </button>
        )}
        {snapshot.question && (
          <div className="card stack">
            <span className="eyebrow">
              {snapshot.index + 1} / {snapshot.total} · {snapshot.question.kind}
            </span>
            <h2 className="question">{snapshot.question.prompt}</h2>
            {snapshot.question.image && (
              <QuestionArtwork
                src={snapshot.question.image}
                alt="Question illustration"
              />
            )}
            {role === "student" ? (
              <>
                <fieldset
                  disabled={
                    snapshot.state !== "ACTIVE" ||
                    snapshot.submitted ||
                    snapshot.revealed ||
                    busy
                  }
                >
                  <legend className="sr-only">
                    {t("Жауабыңыз", "Your answer")}
                  </legend>
                  {["text", "discussion"].includes(snapshot.question.kind) ? (
                    <label>
                      {t("Жауабыңыз", "Your answer")}
                      <input
                        maxLength={500}
                        value={choice[0] || ""}
                        onChange={(e) => C([e.target.value])}
                      />
                    </label>
                  ) : (
                    <div className="options">
                      {snapshot.question.options.map((option: string) => (
                        <button
                          type="button"
                          className={choice.includes(option) ? "selected" : ""}
                          aria-pressed={choice.includes(option)}
                          key={option}
                          onClick={() =>
                            C(
                              snapshot.question.kind === "single"
                                ? [option]
                                : choice.includes(option)
                                  ? choice.filter((x) => x !== option)
                                  : [...choice, option],
                            )
                          }
                        >
                          {snapshot.question.kind === "ordering" &&
                          choice.includes(option)
                            ? `${choice.indexOf(option) + 1}. `
                            : ""}
                          {option}
                        </button>
                      ))}
                    </div>
                  )}
                  {snapshot.question.kind === "ordering" && (
                    <p>{choice.join(" → ")}</p>
                  )}
                  <br />
                  <button
                    disabled={
                      !choice.length ||
                      snapshot.submitted ||
                      snapshot.revealed ||
                      busy
                    }
                    onClick={() =>
                      act(async () => {
                        const v = await api(
                          `/sessions/${sessionId}/answer`,
                          { index: snapshot.index, answer: choice },
                          localStorage.getItem("participant:" + sessionId) ||
                            "",
                        );
                        V(v);
                        Recv(Date.now());
                      })
                    }
                  >
                    {t("Жауапты жіберу", "Submit answer")}
                  </button>
                </fieldset>
                {snapshot.submitted && (
                  <p className="success" role="status">
                    {t("Жауап қабылданды", "Answer submitted")} ✓{" "}
                    {snapshot.own &&
                      (snapshot.own.correct === null
                        ? t(
                            "Талқылау — мұғалім пікірін күтіңіз",
                            "Discussion — awaiting teacher feedback",
                          )
                        : snapshot.own.correct
                          ? t("Дұрыс · +100", "Correct · +100")
                          : t(
                              "Жауап ашылғанда түсіндірмені оқыңыз",
                              "Keep learning — see the explanation after reveal",
                            ))}
                  </p>
                )}
              </>
            ) : (
              <div className="options">
                {snapshot.question.options.map((o: string) => (
                  <div className="card" key={o}>
                    {o}
                  </div>
                ))}
              </div>
            )}
            {snapshot.revealed && (
              <div className="success">
                <strong>
                  {snapshot.question.kind === "discussion"
                    ? "Discussion — no automatic grade"
                    : snapshot.question.answer.join(" → ")}
                </strong>
                <p>{snapshot.question.explanation}</p>
              </div>
            )}
          </div>
        )}
        {snapshot.state === "PAUSED" && (
          <div className="notice">
            {t("Ойын уақытша тоқтатылды.", "Game paused by teacher.")}
          </div>
        )}
        {["CANCELLED", "EXPIRED"].includes(snapshot.state) && (
          <div className="notice">
            {t(
              "Сессия жабық. Мұғалімнен жаңа PIN сұраңыз.",
              "This session is closed. Ask your teacher for a new PIN.",
            )}
          </div>
        )}
        {snapshot.state === "FINISHED" && (
          <div className="card stack results-card">
            <GameArtwork template={snapshot.template} className="results-art" />
            <h2>{t("Ойын нәтижелері", "Final results")}</h2>
            <table>
              <thead>
                <tr>
                  <th>{t("Қатысушы", "Player")}</th>
                  <th>{t("Ұпай", "Score")}</th>
                </tr>
              </thead>
              <tbody>
                {snapshot.leaderboard.map((p: any) => (
                  <tr key={p.id}>
                    <td>{p.name}</td>
                    <td>{p.score}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {role === "host" && (
              <>
                <button
                  onClick={() =>
                    act(() => start(game?.id || snapshot.template))
                  }
                >
                  {t("Қайта ойнау", "Play again")}
                </button>
                <button
                  className="secondary"
                  onClick={() =>
                    act(async () => {
                      await api(`/sessions/${sessionId}/delete`, {});
                      location.href = "/dashboard";
                    })
                  }
                >
                  {t("Сессия деректерін жою", "Delete session data")}
                </button>
              </>
            )}
          </div>
        )}
      </section>
    ) : (
      <p role="status">{t("Сессия жүктелуде…", "Loading session…")}</p>
    );
  else if (path === "/admin")
    content =
      me?.role === "admin" ? (
        <>
          <h1>{t("Контентті басқару", "Content administration")}</h1>
          <form
            className="card stack"
            onSubmit={(e) => {
              e.preventDefault();
              act(async () => {
                await api("/admin/users", { email, password });
                Em("");
                Pw("");
                alert(
                  t("Мұғалім тіркелгісі жасалды", "Teacher account created"),
                );
              });
            }}
          >
            <h2>{t("Мұғалімді қосу", "Add teacher")}</h2>
            <label>
              Email
              <input
                type="email"
                required
                value={email}
                onChange={(e) => Em(e.target.value)}
              />
            </label>
            <label>
              {t(
                "Уақытша құпиясөз (12+ таңба)",
                "Temporary password (12+ characters)",
              )}
              <input
                type="password"
                minLength={12}
                required
                value={password}
                onChange={(e) => Pw(e.target.value)}
              />
            </label>
            <button disabled={busy}>
              {t("Тіркелгі жасау", "Create account")}
            </button>
          </form>
          <p>
            Review each answer key before publication. Sample status never
            proves official alignment.
          </p>
          <div className="stack">
            {items.map((g) => (
              <div className="card row" key={g.id}>
                <GameArtwork template={g.template} className="admin-game-art" />
                <a href={"/games/" + g.id}>
                  <strong>{g.title}</strong>
                </a>
                <span className="tag">{g.status}</span>
                {["draft", "reviewed", "published", "archived"].map(
                  (status) => (
                    <button
                      className="secondary"
                      key={status}
                      disabled={busy || g.status === status}
                      onClick={() =>
                        act(async () => {
                          await api(`/games/${g.id}/approve`, { status });
                          I(await api("/games"));
                        })
                      }
                    >
                      {status}
                    </button>
                  ),
                )}
              </div>
            ))}
          </div>
        </>
      ) : (
        <div className="error">
          {t("Тек әкімшіге рұқсат етіледі.", "Administrator access required.")}
        </div>
      );
  else
    content = (
      <div className="card">
        <h1>404</h1>
        <a href="/">{t("Басты бетке", "Go home")}</a>
      </div>
    );
  return (
    <div className={role === "display" && sessionId ? "display" : ""}>
      <header>
        <a href="/" className="brand">
          ✦ English <span>Brain Games</span>
        </a>
        <nav>
          <a href="/dashboard">{t("Ойындар", "Games")}</a>
          <a href="/curriculum">{t("Оқу бағдарламасы", "Curriculum")}</a>
          <a href="/join">{t("Қосылу", "Join")}</a>
          {me?.role === "admin" && <a href="/admin">Admin</a>}
          <button
            className="secondary"
            onClick={() => {
              const l = lang === "kk" ? "en" : "kk";
              L(l);
              localStorage.setItem("ebg-lang", l);
              document.documentElement.lang = l;
            }}
          >
            {lang === "kk" ? "EN" : "ҚАЗ"}
          </button>
          {me ? (
            <button
              className="secondary"
              onClick={() =>
                act(async () => {
                  await api("/logout", {});
                  location.href = "/";
                })
              }
            >
              {t("Шығу", "Sign out")}
            </button>
          ) : (
            <a href="/login">{t("Кіру", "Sign in")}</a>
          )}
        </nav>
      </header>
      <main>
        {error && (
          <div className="error" role="alert">
            {error}{" "}
            <button className="secondary" onClick={() => location.reload()}>
              {t("Қайталау", "Retry")}
            </button>
          </div>
        )}
        {content}
        <footer className="footer small">
          English Brain Games · Grades 6–8 ·{" "}
          {t("Сыныпта бірге үйренеміз", "Made for learning together")}
        </footer>
      </main>
    </div>
  );
}
