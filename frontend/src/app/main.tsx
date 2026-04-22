import React from "react";
import ReactDOM from "react-dom/client";
import { Gamepad2, Home, MessageCircle, Newspaper, Settings, Users } from "lucide-react";

import "../styles/globals.css";

const friends = ["Nikitin", "Vega", "Mira", "Zero", "RiotKid"];

function App() {
  return (
    <main className="shell">
      <aside className="sidebar">
        <div className="brand">FC</div>
        <button aria-label="Главная"><Home size={20} /></button>
        <button aria-label="Чаты"><MessageCircle size={20} /></button>
        <button aria-label="Друзья"><Users size={20} /></button>
        <button aria-label="Лента"><Newspaper size={20} /></button>
        <button aria-label="Игры"><Gamepad2 size={20} /></button>
        <button aria-label="Настройки"><Settings size={20} /></button>
      </aside>

      <section className="content">
        <header className="topbar">
          <p>Добро пожаловать, <strong>NIKITIN</strong></p>
          <input placeholder="Поиск" />
        </header>

        <section className="hero">
          <div>
            <span>Популярное</span>
            <h1>FrCenter</h1>
            <p>Игровой чат, друзья, группы, новости и сквозное шифрование.</p>
          </div>
        </section>

        <section className="grid">
          <article>
            <h2>Чаты</h2>
            <p>Личные и групповые E2EE-чаты через WebSocket.</p>
          </article>
          <article>
            <h2>Лента</h2>
            <p>Посты друзей, комментарии, реакции и игровые статусы.</p>
          </article>
          <article>
            <h2>Статистика</h2>
            <p>Steam и Riot появятся первыми, Epic и EA позже.</p>
          </article>
        </section>
      </section>

      <aside className="friends">
        {friends.map((friend) => (
          <div className="friend" key={friend}>
            <div>{friend.slice(0, 1)}</div>
            <span>{friend}</span>
          </div>
        ))}
      </aside>
    </main>
  );
}

ReactDOM.createRoot(document.getElementById("root")!).render(<App />);
