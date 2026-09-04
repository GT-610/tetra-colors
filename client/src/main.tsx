import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

import "./styles.css";

function App() {
  return (
    <main className="shell">
      <section className="hero" aria-labelledby="page-title">
        <div className="mark" aria-hidden="true">
          <span className="shape shape-circle" />
          <span className="shape shape-diamond" />
          <span className="shape shape-triangle" />
          <span className="shape shape-square" />
        </div>
        <p className="eyebrow">开源 · 自托管 · 多人在线</p>
        <h1 id="page-title">Tetra Colors</h1>
        <p className="lede">工程地基已就绪，牌桌正在搭建中。</p>
        <a className="health-link" href="/api/health">
          查看服务状态
        </a>
      </section>
    </main>
  );
}

const rootElement = document.getElementById("root");

if (!rootElement) {
  throw new Error("Root element was not found");
}

createRoot(rootElement).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
