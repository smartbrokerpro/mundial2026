"use client";

import { useEffect, useState } from "react";
import useSWR from "swr";
import MatchCard, { FeedMatch } from "@/components/MatchCard";
import Groups from "@/components/Groups";
import Bracket from "@/components/Bracket";
import RadialBracket from "@/components/RadialBracket";
import RadialBracket2 from "@/components/RadialBracket2";

const fetcher = (url: string) => fetch(url).then((r) => r.json());
const REFRESH = 15000; // 15s -> sensación "en vivo"

type Tab = "resumen" | "grupos" | "llaves";
type BracketView = "clasico" | "radial" | "radial2";

export default function Home() {
  const [tab, setTab] = useState<Tab>("llaves");
  const [bracketView, setBracketView] = useState<BracketView>("radial");

  // Deep-link de pestañas vía hash (#grupos, #llaves) — útil para compartir.
  useEffect(() => {
    const apply = () => {
      const h = window.location.hash.replace("#", "");
      if (h === "grupos" || h === "llaves" || h === "resumen") setTab(h as Tab);
    };
    apply();
    window.addEventListener("hashchange", apply);
    return () => window.removeEventListener("hashchange", apply);
  }, []);

  const select = (t: Tab) => {
    setTab(t);
    window.location.hash = t;
  };

  const { data: feed } = useSWR("/api/matches", fetcher, {
    refreshInterval: REFRESH,
  });
  const { data: groupsData } = useSWR("/api/groups", fetcher, {
    refreshInterval: REFRESH,
  });
  const { data: bracketData } = useSWR("/api/bracket", fetcher, {
    refreshInterval: REFRESH,
  });

  const live: FeedMatch[] = feed?.live ?? [];
  const upcoming: FeedMatch[] = feed?.upcoming ?? [];
  const recent: FeedMatch[] = feed?.recent ?? [];
  const liveCount = live.length;

  return (
    <main className="app">
      <header className="hero">
        <div>
          <h1>WC 2026</h1>
          <div className="sub">
            Canadá · México · Estados Unidos · datos en vivo
          </div>
        </div>
        <span className="badge">
          <span className={`dot ${liveCount ? "live" : ""}`} />
          {liveCount
            ? `${liveCount} partido${liveCount > 1 ? "s" : ""} en vivo`
            : "Sin partidos en vivo"}
        </span>
      </header>

      <div className="tabbar">
        <nav className="tabs">
          <button
            className={tab === "llaves" ? "active" : ""}
            onClick={() => select("llaves")}
          >
            Llaves
          </button>
          <button
            className={tab === "grupos" ? "active" : ""}
            onClick={() => select("grupos")}
          >
            Grupos
          </button>
          <button
            className={tab === "resumen" ? "active" : ""}
            onClick={() => select("resumen")}
          >
            Resumen
          </button>
        </nav>
        {tab === "llaves" && (
          <div className="tabs">
            <button
              className={bracketView === "radial" ? "active" : ""}
              onClick={() => setBracketView("radial")}
            >
              Radial
            </button>
            <button
              className={bracketView === "radial2" ? "active" : ""}
              onClick={() => setBracketView("radial2")}
            >
              Radial 2 ⚡
            </button>
            <button
              className={bracketView === "clasico" ? "active" : ""}
              onClick={() => setBracketView("clasico")}
            >
              Clásico
            </button>
          </div>
        )}
      </div>

      {tab === "resumen" && (
        <>
          {live.length > 0 && (
            <section>
              <h2 className="section-title">🔴 En vivo</h2>
              <div className="ticker">
                {live.map((m) => (
                  <MatchCard key={m.matchId} m={m} />
                ))}
              </div>
            </section>
          )}
          <section>
            <h2 className="section-title">Próximos partidos</h2>
            <div className="ticker">
              {upcoming.map((m) => (
                <MatchCard key={m.matchId} m={m} />
              ))}
              {!upcoming.length && <div className="loading">—</div>}
            </div>
          </section>
          <section>
            <h2 className="section-title">Resultados recientes</h2>
            <div className="ticker">
              {recent.map((m) => (
                <MatchCard key={m.matchId} m={m} />
              ))}
            </div>
          </section>
        </>
      )}

      {tab === "grupos" && <Groups groups={groupsData?.groups ?? []} />}

      {tab === "llaves" && (
        <>
          {bracketView === "clasico" && live.length > 0 && (
            <section>
              <h2 className="section-title">🔴 En vivo ahora</h2>
              <div className="ticker">
                {live.map((m) => (
                  <MatchCard key={m.matchId} m={m} />
                ))}
              </div>
            </section>
          )}
          {bracketView === "clasico" ? (
            <Bracket rounds={bracketData?.rounds ?? []} />
          ) : bracketView === "radial2" ? (
            <RadialBracket2 rounds={bracketData?.rounds ?? []} />
          ) : (
            <RadialBracket rounds={bracketData?.rounds ?? []} />
          )}
        </>
      )}

      {!feed && <div className="loading">Cargando datos del torneo…</div>}
    </main>
  );
}
