import { type CSSProperties, useEffect, useRef, useState } from "react";

import type { Card, CardColor } from "../../src/logic";
import type { ClientMessage, RoomEvent, RoomSnapshot } from "../../src/protocol";
import { copy } from "./copy";
import { arrangeOpponentSeats } from "./game-layout";
import type { ConnectionState } from "./room-client";

const COLOR_ORDER = ["coral", "amber", "teal", "azure"] as const satisfies readonly CardColor[];
const CARD_FLIGHT_MS = 560;
const TURN_DURATION_MS = 30_000;

interface CardFlight {
  key: number;
  card: Card;
  source: "self" | "opponent";
  fromX: number;
  fromY: number;
  toX: number;
  toY: number;
  fromScale: number;
  width: number;
}

interface SeatStyle extends CSSProperties {
  "--seat-left": string;
  "--seat-top": string;
}

interface FlightStyle extends CSSProperties {
  "--flight-duration": string;
  "--flight-from-scale": string;
  "--flight-from-x": string;
  "--flight-from-y": string;
  "--flight-to-x": string;
  "--flight-to-y": string;
  "--flight-width": string;
}

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
  const [cardFlight, setCardFlight] = useState<CardFlight | null>(null);
  const stageRef = useRef<HTMLElement | null>(null);
  const discardRef = useRef<HTMLDivElement | null>(null);
  const opponentRefs = useRef(new Map<string, HTMLElement>());
  const pendingCardOriginRef = useRef<DOMRect | null>(null);
  const flightSequenceRef = useRef(0);
  const game = snapshot.game;
  const playableCardIds = new Set(game?.playableCardIds ?? []);

  useEffect(() => {
    if (error) setPending(null);
  }, [error]);

  useEffect(() => {
    setPending(null);
    setWildCard(null);
  }, [snapshot]);

  useEffect(() => {
    setCardFlight(null);
    if (latestEvent?.type !== "card-played") return;

    const stageBounds = stageRef.current?.getBoundingClientRect();
    const targetBounds = discardRef.current?.getBoundingClientRect();
    const isSelf = latestEvent.playerId === snapshot.selfId;
    const sourceBounds = isSelf
      ? pendingCardOriginRef.current
      : opponentRefs.current.get(latestEvent.playerId)?.getBoundingClientRect();
    if (isSelf) pendingCardOriginRef.current = null;
    if (!stageBounds || !targetBounds || !sourceBounds) return;

    const key = flightSequenceRef.current + 1;
    flightSequenceRef.current = key;
    setCardFlight({
      key,
      card: latestEvent.card,
      source: isSelf ? "self" : "opponent",
      fromX: sourceBounds.left + sourceBounds.width / 2 - stageBounds.left,
      fromY: sourceBounds.top + sourceBounds.height / 2 - stageBounds.top,
      toX: targetBounds.left + targetBounds.width / 2 - stageBounds.left,
      toY: targetBounds.top + targetBounds.height / 2 - stageBounds.top,
      fromScale: isSelf ? Math.min(1, sourceBounds.width / targetBounds.width) : 0.48,
      width: targetBounds.width,
    });

    const timer = window.setTimeout(() => {
      setCardFlight((current) => (current?.key === key ? null : current));
    }, CARD_FLIGHT_MS);
    return () => window.clearTimeout(timer);
  }, [latestEvent, snapshot.selfId]);

  if (!game) return null;

  const self = snapshot.players.find((player) => player.id === snapshot.selfId);
  const currentPlayer = snapshot.players.find((player) => player.id === game.currentPlayerId);
  const isSelfTurn = game.currentPlayerId === snapshot.selfId;
  const waitingForConnection = connectionState !== "connected";
  const actionDisabled = pending !== null || waitingForConnection;
  const opponentSeats = arrangeOpponentSeats(snapshot.players, snapshot.selfId);

  const playCard = (card: Card, source: HTMLElement) => {
    const sourceBounds = source.getBoundingClientRect();
    if (card.kind === "wild" || card.kind === "wild-draw-four") {
      pendingCardOriginRef.current = sourceBounds;
      setWildCard(card);
      return;
    }
    if (onSend({ type: "game.play-card", cardId: card.id })) {
      pendingCardOriginRef.current = sourceBounds;
      setPending("play");
    }
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

      <section className="turn-status" aria-live="polite">
        <div>
          <span className={`turn-pulse ${isSelfTurn ? "self-turn" : ""}`} aria-hidden="true" />
          <strong>
            {isSelfTurn ? copy.yourTurn : `${currentPlayer?.nickname ?? "玩家"}${copy.theirTurn}`}
          </strong>
        </div>
        <TurnTimer deadline={game.turnDeadline} />
      </section>

      <section className="table-stage" aria-label="牌桌" ref={stageRef}>
        {cardFlight ? <PlayedCardFlight flight={cardFlight} /> : null}

        <section className="opponent-arc" aria-label="其他玩家">
          {opponentSeats.map(({ player, left, top }, index) => (
            <article
              className={`opponent-chip ${player.id === game.currentPlayerId ? "active-player" : ""}`}
              key={player.id}
              ref={(element) => {
                if (element) opponentRefs.current.set(player.id, element);
                else opponentRefs.current.delete(player.id);
              }}
              style={opponentSeatStyle(left, top)}
            >
              <span
                className={`opponent-symbol symbol-${COLOR_ORDER[index % COLOR_ORDER.length]}`}
              />
              <div>
                <strong>{player.nickname}</strong>
                <span>
                  {player.handCount} {copy.cards}
                  {player.isBot ? ` · ${copy.bot}` : ""}
                </span>
              </div>
            </article>
          ))}
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

          <div
            className="discard-pile"
            ref={discardRef}
            role="img"
            aria-label={`弃牌：${cardLabel(game.topDiscard)}`}
          >
            <CardFace card={game.topDiscard} />
          </div>

          <div className={`color-indicator indicator-${game.currentColor}`}>
            <span>{copy.currentColor}</span>
            <strong>{copy.colors[game.currentColor]}</strong>
          </div>
        </section>
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
            const playable = playableCardIds.has(card.id);
            const isDrawn = game.drawnCardId === card.id;
            return (
              <button
                className={`hand-card ${playable ? "playable-card" : ""} ${isDrawn ? "drawn-card" : ""}`}
                type="button"
                key={card.id}
                disabled={!isSelfTurn || !playable || actionDisabled}
                onClick={(event) => playCard(card, event.currentTarget)}
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
        <ColorDialog
          card={wildCard}
          onChoose={playWild}
          onClose={() => {
            pendingCardOriginRef.current = null;
            setWildCard(null);
          }}
        />
      ) : null}
    </main>
  );
}

function PlayedCardFlight({ flight }: { flight: CardFlight }) {
  const style: FlightStyle = {
    "--flight-duration": `${CARD_FLIGHT_MS}ms`,
    "--flight-from-scale": String(flight.fromScale),
    "--flight-from-x": `${flight.fromX}px`,
    "--flight-from-y": `${flight.fromY}px`,
    "--flight-to-x": `${flight.toX}px`,
    "--flight-to-y": `${flight.toY}px`,
    "--flight-width": `${flight.width}px`,
  };

  return (
    <div className={`card-flight card-flight-${flight.source}`} style={style} aria-hidden="true">
      <CardFace card={flight.card} />
    </div>
  );
}

function opponentSeatStyle(left: number, top: number): SeatStyle {
  return {
    "--seat-left": `${left}%`,
    "--seat-top": `${top}%`,
  };
}

function TurnTimer({ deadline }: { deadline: number }) {
  const [now, setNow] = useState(Date.now());

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 250);
    return () => window.clearInterval(timer);
  }, []);

  const remainingMs = Math.max(0, deadline - now);
  return (
    <div className={`turn-timer ${remainingMs <= 5_000 ? "timer-urgent" : ""}`}>
      <time>{Math.ceil(remainingMs / 1_000)}s</time>
      <progress max={TURN_DURATION_MS} value={remainingMs} aria-label="回合剩余时间" />
    </div>
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
  else if (event.type === "player-reconnected") text = `${playerName}已重新连接`;
  else text = `${playerName}已由电脑托管`;
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
