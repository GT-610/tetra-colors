import { useEffect, useState } from "react";

import type { Card, CardColor } from "../../src/logic";
import type { ClientMessage, RoomEvent, RoomSnapshot } from "../../src/protocol";
import { copy } from "./copy";
import type { ConnectionState } from "./room-client";

const COLOR_ORDER: CardColor[] = ["coral", "amber", "teal", "azure"];
const TURN_DURATION_MS = 30_000;

interface GameTableProps {
  snapshot: RoomSnapshot;
  connectionState: ConnectionState;
  error: string | null;
  latestEvent: RoomEvent | null;
  onSend: (message: ClientMessage) => boolean;
  onLeave: () => void;
}

export function GameTable({
  snapshot,
  connectionState,
  error,
  latestEvent,
  onSend,
  onLeave,
}: GameTableProps) {
  const [pending, setPending] = useState<"draw" | "pass" | "play" | null>(null);
  const [wildCard, setWildCard] = useState<Card | null>(null);
  const [now, setNow] = useState(Date.now());
  const game = snapshot.game;

  useEffect(() => {
    if (error) setPending(null);
  }, [error]);

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 250);
    return () => window.clearInterval(timer);
  }, []);

  if (!game) return null;

  const self = snapshot.players.find((player) => player.id === snapshot.selfId);
  const currentPlayer = snapshot.players.find((player) => player.id === game.currentPlayerId);
  const isSelfTurn = game.currentPlayerId === snapshot.selfId;
  const remainingMs = Math.max(0, game.turnDeadline - now);
  const waitingForConnection = connectionState !== "connected";
  const actionDisabled = pending !== null || waitingForConnection;
  const opponents = snapshot.players.filter((player) => player.id !== snapshot.selfId);

  const playCard = (card: Card) => {
    if (card.kind === "wild" || card.kind === "wild-draw-four") {
      setWildCard(card);
      return;
    }
    if (onSend({ type: "game.play-card", cardId: card.id })) setPending("play");
  };

  const playWild = (chosenColor: CardColor) => {
    if (!wildCard) return;
    if (onSend({ type: "game.play-card", cardId: wildCard.id, chosenColor })) {
      setPending("play");
      setWildCard(null);
    }
  };

  return (
    <main className={`game-shell table-color-${game.currentColor}`}>
      <header className="game-topbar">
        <div>
          <strong>{copy.brand}</strong>
          <span>
            {copy.room} {snapshot.roomCode}
          </span>
        </div>
        <div className="game-top-actions">
          <span className={`connection-badge state-${connectionState}`}>
            {copy.connection[connectionState]}
          </span>
          <button className="text-button" type="button" onClick={onLeave}>
            {copy.leave}
          </button>
        </div>
      </header>

      <section className="opponent-row" aria-label="其他玩家">
        {opponents.map((player, index) => (
          <article
            className={`opponent-chip ${player.id === game.currentPlayerId ? "active-player" : ""}`}
            key={player.id}
          >
            <span className={`opponent-symbol symbol-${COLOR_ORDER[index % COLOR_ORDER.length]}`} />
            <div>
              <strong>{player.nickname}</strong>
              <span>
                {player.handCount} {copy.cards}
              </span>
            </div>
            {player.isBot ? <em>{copy.bot}</em> : null}
          </article>
        ))}
      </section>

      <section className="turn-status" aria-live="polite">
        <div>
          <span className={`turn-pulse ${isSelfTurn ? "self-turn" : ""}`} aria-hidden="true" />
          <strong>
            {isSelfTurn ? copy.yourTurn : `${currentPlayer?.nickname ?? "玩家"}${copy.theirTurn}`}
          </strong>
        </div>
        <div className={`turn-timer ${remainingMs <= 5_000 ? "timer-urgent" : ""}`}>
          <time>{Math.ceil(remainingMs / 1_000)}s</time>
          <progress max={TURN_DURATION_MS} value={remainingMs} aria-label="回合剩余时间" />
        </div>
      </section>

      <section className="table-center" aria-label="牌桌中央">
        <div className="direction-label">
          <span>{game.direction === 1 ? "↻" : "↺"}</span>
          {game.direction === 1 ? copy.directionClockwise : copy.directionCounterClockwise}
        </div>

        <button
          className="pile-button draw-pile"
          type="button"
          disabled={!isSelfTurn || game.drawnCardId !== null || actionDisabled}
          onClick={() => {
            if (onSend({ type: "game.draw-card" })) setPending("draw");
          }}
          aria-label={`${copy.drawCard}，剩余 ${game.drawPileCount} 张`}
        >
          <CardBack />
          <span>{game.drawPileCount}</span>
        </button>

        <div className="discard-pile" role="img" aria-label={`弃牌：${cardLabel(game.topDiscard)}`}>
          <CardFace card={game.topDiscard} />
        </div>

        <div className={`color-indicator indicator-${game.currentColor}`}>
          <span>{copy.currentColor}</span>
          <strong>{copy.colors[game.currentColor]}</strong>
        </div>
      </section>

      {latestEvent ? (
        <EventToast key={JSON.stringify(latestEvent)} event={latestEvent} snapshot={snapshot} />
      ) : null}
      {error ? (
        <p className="game-error" role="alert">
          {error}
        </p>
      ) : null}

      <section className="hand-zone" aria-label={copy.yourHand}>
        <div className="hand-heading">
          <div>
            <span>{copy.yourHand}</span>
            <strong>
              {self?.handCount ?? snapshot.hand.length} {copy.cards}
            </strong>
          </div>
          {isSelfTurn && game.drawnCardId ? (
            <button
              className="button pass-button"
              type="button"
              disabled={actionDisabled}
              onClick={() => {
                if (onSend({ type: "game.pass-turn" })) setPending("pass");
              }}
            >
              {pending === "pass" ? copy.passing : copy.passTurn}
            </button>
          ) : null}
        </div>

        <div className="hand-scroller">
          {snapshot.hand.map((card) => {
            const playable = game.playableCardIds.includes(card.id);
            const isDrawn = game.drawnCardId === card.id;
            return (
              <button
                className={`hand-card ${playable ? "playable-card" : ""} ${isDrawn ? "drawn-card" : ""}`}
                type="button"
                key={card.id}
                disabled={!isSelfTurn || !playable || actionDisabled}
                onClick={() => playCard(card)}
                aria-label={`打出${cardLabel(card)}`}
              >
                <CardFace card={card} />
              </button>
            );
          })}
        </div>

        {isSelfTurn && !game.drawnCardId ? (
          <button
            className="button mobile-draw-button"
            type="button"
            disabled={actionDisabled}
            onClick={() => {
              if (onSend({ type: "game.draw-card" })) setPending("draw");
            }}
          >
            {pending === "draw" ? copy.drawing : copy.drawCard}
          </button>
        ) : null}
      </section>

      {waitingForConnection ? (
        <div className="reconnect-overlay" role="status">
          <div className="spinner" aria-hidden="true" />
          <strong>{copy.connection[connectionState]}</strong>
          <span>{copy.reconnectOverlay}</span>
        </div>
      ) : null}

      {wildCard ? (
        <ColorDialog card={wildCard} onChoose={playWild} onClose={() => setWildCard(null)} />
      ) : null}
    </main>
  );
}

export function ResultScreen({
  snapshot,
  onSend,
  onLeave,
}: Pick<GameTableProps, "snapshot" | "onSend" | "onLeave">) {
  const winner = snapshot.players.find((player) => player.id === snapshot.game?.winnerId);
  const isWinner = winner?.id === snapshot.selfId;
  const isHost = snapshot.hostId === snapshot.selfId;

  return (
    <main className="result-shell">
      <section className="result-card">
        <div className="result-symbols" aria-hidden="true">
          {COLOR_ORDER.map((color) => (
            <span className={`result-shape symbol-${color}`} key={color} />
          ))}
        </div>
        <p className="section-kicker">{copy.roundFinished}</p>
        <h1>{winner?.nickname ?? "玩家"}</h1>
        <p className="result-lede">{isWinner ? copy.youWon : copy.playerWon}</p>
        <ol className="result-players">
          {[...snapshot.players]
            .sort((left, right) => left.handCount - right.handCount)
            .map((player) => (
              <li key={player.id}>
                <span>{player.nickname}</span>
                <strong>
                  {player.handCount} {copy.cards}
                </strong>
              </li>
            ))}
        </ol>
        {isHost ? (
          <button
            className="button button-primary"
            type="button"
            onClick={() => onSend({ type: "game.rematch" })}
          >
            {copy.rematch}
          </button>
        ) : (
          <p className="waiting-message">{copy.waitingRematch}</p>
        )}
        <button className="button button-ghost" type="button" onClick={onLeave}>
          {copy.leave}
        </button>
      </section>
    </main>
  );
}

function CardFace({ card }: { card: Card }) {
  const colorClass = "color" in card ? `card-${card.color}` : "card-wild";
  const value = card.kind === "number" ? String(card.number) : actionSymbol(card);
  return (
    <span className={`card-face ${colorClass}`}>
      <span className="card-corner">{value}</span>
      <span className="card-center-shape">
        {card.kind === "number" ? value : actionSymbol(card)}
      </span>
      <span className="card-caption">{cardLabel(card)}</span>
    </span>
  );
}

function CardBack() {
  return (
    <span className="card-face card-back">
      <span className="back-shapes" aria-hidden="true">
        {COLOR_ORDER.map((color) => (
          <i className={`symbol-${color}`} key={color} />
        ))}
      </span>
      <span className="card-caption">{copy.brand}</span>
    </span>
  );
}

function ColorDialog({
  card,
  onChoose,
  onClose,
}: {
  card: Card;
  onChoose: (color: CardColor) => void;
  onClose: () => void;
}) {
  return (
    <div className="dialog-backdrop" role="presentation">
      <section
        className="color-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="color-dialog-title"
      >
        <CardFace card={card} />
        <div>
          <p className="section-kicker">{cardLabel(card)}</p>
          <h2 id="color-dialog-title">{copy.chooseColor}</h2>
          <p>{copy.chooseColorHint}</p>
        </div>
        <div className="color-options">
          {COLOR_ORDER.map((color) => (
            <button
              className={`color-option option-${color}`}
              type="button"
              key={color}
              onClick={() => onChoose(color)}
              aria-label={`选择${copy.colors[color]}`}
            >
              <span className={`symbol-${color}`} aria-hidden="true" />
              {copy.colors[color]}
            </button>
          ))}
        </div>
        <button className="button button-ghost" type="button" onClick={onClose}>
          {copy.close}
        </button>
      </section>
    </div>
  );
}

function EventToast({ event, snapshot }: { event: RoomEvent; snapshot: RoomSnapshot }) {
  const playerName =
    "playerId" in event
      ? (snapshot.players.find((player) => player.id === event.playerId)?.nickname ?? "玩家")
      : "";
  let text: string;
  if (event.type === "card-played") text = `${playerName}打出${cardLabel(event.card)}`;
  else if (event.type === "cards-drawn") text = `${playerName}抽了 ${event.count} 张牌`;
  else if (event.type === "turn-timed-out") text = `${playerName}回合超时，已自动行动`;
  else if (event.type === "player-joined") text = `${event.nickname}加入房间`;
  else if (event.type === "player-left") text = `${playerName}离开房间`;
  else if (event.type === "player-reconnected") text = `${playerName}已重新连接`;
  else if (event.type === "player-became-bot") text = `${playerName}已由电脑托管`;
  else text = "本局已经结束";
  return (
    <div className="event-toast" role="status">
      {text}
    </div>
  );
}

function cardLabel(card: Card): string {
  if (card.kind === "number") return `${copy.colors[card.color]} ${card.number}`;
  if ("color" in card) return `${copy.colors[card.color]}${copy.cardKinds[card.kind]}`;
  return copy.cardKinds[card.kind];
}

function actionSymbol(card: Card): string {
  if (card.kind === "skip") return "Ⅱ";
  if (card.kind === "reverse") return "↺";
  if (card.kind === "draw-two") return "+2";
  if (card.kind === "wild-draw-four") return "+4";
  return "◇";
}
