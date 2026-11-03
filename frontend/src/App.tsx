import { lazy, Suspense, useRef, useState } from "react";
import { BrowserRouter, NavLink, Route, Routes } from "react-router";
import { api, withRetry } from "./api/client";
import { Loading, Notice } from "./components/common";
import { MetaContext, useAsync, useDocumentTitle } from "./lib/hooks";
import { useSmoothWheel } from "./lib/media";
import AnalyzePage from "./pages/AnalyzePage";

// Pages with charts load on demand, so the first page appears quickly on phones.
const ExplorerPage = lazy(() => import("./pages/ExplorerPage"));
const DatasetsPage = lazy(() => import("./pages/DatasetsPage"));
const DatasetPage = lazy(() => import("./pages/DatasetPage"));
const DictionariesPage = lazy(() => import("./pages/DictionariesPage"));
const MethodPage = lazy(() => import("./pages/MethodPage"));

const NAV = [
  { to: "/", label: "Analyze a text", end: true },
  { to: "/un", label: "UN General Debate" },
  { to: "/datasets", label: "My datasets" },
  { to: "/dictionaries", label: "Dictionaries" },
  { to: "/method", label: "Method" },
];

export default function App() {
  const meta = useAsync(() => withRetry(() => api.meta()), []);
  useSmoothWheel();
  // On phones the menu is a drawer under the header; on wider screens the same nav is a row and this stays unused
  const [menuOpen, setMenuOpen] = useState(false);
  const menuButton = useRef<HTMLButtonElement>(null);
  const closeMenu = () => setMenuOpen(false);
  return (
    <BrowserRouter>
      <a className="skip-link" href="#main">Skip to content</a>
      <header className="site-header" onKeyDown={(e) => {
        if (e.key === "Escape" && menuOpen) {
          closeMenu();
          menuButton.current?.focus();
        }
      }}>
        <div className="container">
          <NavLink to="/" className="brand">
            <svg className="brand-mark" viewBox="0 0 32 32" aria-hidden="true">
              <path d="M3 18c3.4-8 6.8-8 9-2.3s5.6 5.7 8-1.1 4.5-6.8 9-4" fill="none" stroke="currentColor"
                strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />
              <path d="M3 26h26" stroke="currentColor" strokeOpacity=".45" strokeWidth="2.2" strokeLinecap="round" />
            </svg>
            <span className="brand-text">
              <span className="brand-name">Undertone Lab</span>
              <span className="brand-tag">Diplomatic language analyzer</span>
            </span>
          </NavLink>
          <button ref={menuButton} type="button" className="menu-button" aria-label="Menu" aria-expanded={menuOpen}
            aria-controls="main-nav" onClick={() => setMenuOpen(!menuOpen)}>
            <span className="menu-lines" aria-hidden="true"><span /><span /><span /></span>
          </button>
          <nav id="main-nav" className="nav" aria-label="Main" data-open={menuOpen || undefined}>
            {NAV.map((n) => (
              <NavLink key={n.to} to={n.to} end={n.end} onClick={closeMenu}>{n.label}</NavLink>
            ))}
          </nav>
          {menuOpen && <div className="nav-scrim" onClick={closeMenu} />}
        </div>
      </header>
      <main id="main" className="container">
        {meta.data ? (
          <MetaContext.Provider value={meta.data}>
            <Suspense fallback={<Loading />}>
              <Routes>
                <Route path="/" element={<AnalyzePage />} />
                <Route path="/un" element={<ExplorerPage />} />
                <Route path="/datasets" element={<DatasetsPage />} />
                <Route path="/datasets/:id" element={<DatasetPage />} />
                <Route path="/dictionaries" element={<DictionariesPage />} />
                <Route path="/method" element={<MethodPage />} />
                <Route path="*" element={<NotFound />} />
              </Routes>
            </Suspense>
          </MetaContext.Provider>
        ) : meta.error ? (
          <Notice kind="error" onRetry={meta.reload}>The app could not start: {meta.error}</Notice>
        ) : (
          <Loading />
        )}
      </main>
      <footer className="site-footer">
        <div className="container">
          <span>Built by Tuan Dung Nguyen</span>
          <span>UN data: Jankin, Baturo &amp; Dasandi (2024), <i>Journal of Peace Research</i></span>
          <a href="/api/docs">API documentation</a>
          <a href="https://github.com/dungnguyen0309/UndertoneLab">Source code</a>
          <span className="disclaimer">
            An independent research tool. Not affiliated with or endorsed by the United Nations.
          </span>
        </div>
        <div className="footer-wordmark" aria-hidden="true" />
      </footer>
    </BrowserRouter>
  );
}

function NotFound() {
  useDocumentTitle("Page not found");
  return (
    <div className="page-intro">
      <h1>Page not found</h1>
      <p>
        That address does not exist. Go to <NavLink to="/">Analyze a text</NavLink>,{" "}
        <NavLink to="/un">the UN General Debate</NavLink> or <NavLink to="/method">the method</NavLink>.
      </p>
    </div>
  );
}
