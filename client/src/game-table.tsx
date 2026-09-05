import { type CSSProperties, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";

import type { Card, CardColor } from "../../src/logic";
import type { ClientMessage, RoomEvent, RoomSnapshot } from "../../src/protocol";
import {
  CARD_DEAL_ANIMATION_MS,
  CARD_PLAY_ANIMATION_MS,
  CARD_REVEAL_ANIMATION_MS,
} from "../../src/transition-timing";
import { copy } from "./copy";
import { arrangeOpponentSeats, calculateHandLayout } from "./game-layout";
import {
  buildVisualTransitionPlan,
  isDirectionChangeEvent,
  projectedHandCount,
  type RoomTransition,
  type VisualTransitionPlan,
} from "./game-transition";
import type { ConnectionState } from "./room-client";

const COLOR_ORDER = ["coral", "amber", "teal", "azure"] as const satisfies readonly CardColor[];
const TURN_DURATION_MS = 30_000;
const ANIMATION_SETTLE_MS = 50;

interface CardFlight {
  key: number;
  card: Card;
  source: "self" | "opponent";
  delay: number;
  fromX: number;
  fromY: number;
  toX: number;
  toY: number;
  fromScale: number;
  width: number;
}

interface DealtCardFlight {
  key: string;
  card: Card | null;
  source: "self" | "opponent";
  reveal: boolean;
  delay: number;
  fromX: number;
  fromY: number;
  toX: number;
  toY: number;
  toScale: number;
  width: number;
}

interface HandViewport {
  width: number;
  paddingLeft: number;
  cardWidth: number;
}

interface HandCardStyle extends CSSProperties {
  "--hand-card-layer": number;
}

interface DirectionStyle extends CSSProperties {
  "--direction-delay": string;
  "--direction-spin": string;
}

interface SeatStyle extends CSSProperties {
  "--seat-left": string;
  "--seat-top": string;
}

interface FlightStyle extends CSSProperties {
  "--flight-delay": string;
  "--flight-duration": string;
  "--flight-from-scale": string;
  "--flight-from-x": string;
  "--flight-from-y": string;
  "--flight-to-x": string;
  "--flight-to-y": string;
  "--flight-width": string;
}

interface DealFlightStyle extends CSSProperties {
  "--deal-delay": string;
  "--deal-duration": string;
  "--deal-from-x": string;
  "--deal-from-y": string;
  "--deal-reveal-delay": string;
  "--deal-reveal-duration": string;
  "--deal-to-x": string;
  "--deal-to-y": string;
  "--deal-to-scale": string;
  "--deal-width": string;
}

interface SkipStyle extends CSSProperties {
  "--skip-delay": string;
}

interface GameTableProps {
  snapshot: RoomSnapshot;
  connectionState: ConnectionState;
  error: string | null;
  latestEvent: RoomEvent | null;
  transition: RoomTransition | null;
  onSend: (message: ClientMessage) => boolean;
  onTransitionComplete: () => void;
  onLeave: () => void;
}

export function GameTable({
  snapshot,
  connectionState,
  error,
  latestEvent,
  transition,
  onSend,
  onTransitionComplete,
  onLeave,
}: GameTableProps) {
  const [pending, setPending] = useState<"draw" | "pass" | "play" | null>(null);
  const [wildCard, setWildCard] = useState<Card | null>(null);
  const [cardFlights, setCardFlights] = useState<CardFlight[]>([]);
  const [dealtCardFlights, setDealtCardFlights] = useState<DealtCardFlight[]>([]);
  const [serverBlockActive, setServerBlockActive] = useState(false);
  const stageRef = useRef<HTMLElement | null>(null);
  const drawPileRef = useRef<HTMLButtonElement | null>(null);
  const discardRef = useRef<HTMLDivElement | null>(null);
  const handScrollerRef = useRef<HTMLDivElement | null>(null);
  const handCardRefs = useRef(new Map<string, HTMLButtonElement>());
  const opponentRefs = useRef(new Map<string, HTMLElement>());
  const pendingCardOriginRef = useRef<DOMRect | null>(null);
  const flightSequenceRef = useRef(0);
  const scrollAfterSelfDealRef = useRef(false);
  const [handViewport, setHandViewport] = useState<HandViewport>({
    width: 0,
    paddingLeft: 0,
    cardWidth: 76,
  });
  const game = snapshot.game;
  const transitionPlan = useMemo(
    () => (transition ? buildVisualTransitionPlan(transition) : null),
    [transition],
  );
  const playableCardIds = new Set(game?.playableCardIds ?? []);
  const handSlotCount = projectedHandCount(snapshot.hand.length, snapshot.selfId, transitionPlan);
  const handLayout = useMemo(
    () => calculateHandLayout(handViewport.width, handViewport.cardWidth, handSlotCount),
    [handViewport, handSlotCount],
  );
  const directionEventActive = isDirectionChangeEvent(latestEvent);

  useEffect(() => {
    if (error) setPending(null);
  }, [error]);

  useEffect(() => {
    setPending(null);
    setWildCard(null);
  }, [snapshot]);

  useEffect(() => {
    if (!scrollAfterSelfDealRef.current) return;
    scrollAfterSelfDealRef.current = false;
    const scroller = handScrollerRef.current;
    if (scroller) scroller.scrollLeft = scroller.scrollWidth;
  }, [snapshot.hand]);

  useLayoutEffect(() => {
    const scroller = handScrollerRef.current;
    if (!scroller) return;
    const measure = () => {
      const measured = measureHandViewport(scroller);
      setHandViewport((current) =>
        current.width === measured.width &&
        current.paddingLeft === measured.paddingLeft &&
        current.cardWidth === measured.cardWidth
          ? current
          : measured,
      );
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(scroller);
    return () => observer.disconnect();
  }, [snapshot.hand.length]);

  useEffect(() => {
    const blockedFor = (game?.actionBlockedUntil ?? 0) - Date.now();
    if (blockedFor <= 0) {
      setServerBlockActive(false);
      return;
    }
    setServerBlockActive(true);
    const timer = window.setTimeout(() => setServerBlockActive(false), blockedFor);
    return () => window.clearTimeout(timer);
  }, [game?.actionBlockedUntil]);

  useEffect(() => {
    setCardFlights([]);
    setDealtCardFlights([]);
    if (!transition || !transitionPlan) return;

    const frame = window.requestAnimationFrame(() => {
      const stageBounds = stageRef.current?.getBoundingClientRect();
      const discardBounds = discardRef.current?.getBoundingClientRect();
      if (!stageBounds) return;

      const nextCardFlights: CardFlight[] = [];
      for (const step of transitionPlan.playedCards) {
        const isSelf = step.playerId === snapshot.selfId;
        const sourceBounds = isSelf
          ? (pendingCardOriginRef.current ??
            handCardRefs.current.get(step.card.id)?.getBoundingClientRect())
          : opponentRefs.current.get(step.playerId)?.getBoundingClientRect();
        if (!sourceBounds || !discardBounds) continue;

        const key = flightSequenceRef.current + 1;
        flightSequenceRef.current = key;
        nextCardFlights.push({
          key,
          card: step.card,
          source: isSelf ? "self" : "opponent",
          delay: step.startsAt,
          fromX: centerX(sourceBounds) - stageBounds.left,
          fromY: centerY(sourceBounds) - stageBounds.top,
          toX: centerX(discardBounds) - stageBounds.left,
          toY: centerY(discardBounds) - stageBounds.top,
          fromScale: isSelf ? Math.min(1, sourceBounds.width / discardBounds.width) : 0.48,
          width: discardBounds.width,
        });
        if (isSelf) pendingCardOriginRef.current = null;
      }
      setCardFlights(nextCardFlights);

      const drawBounds = drawPileRef.current?.getBoundingClientRect();
      if (!drawBounds) return;
      const nextDealFlights: DealtCardFlight[] = [];
      for (const [index, step] of transitionPlan.dealtCards.entries()) {
        const isSelf = step.playerId === snapshot.selfId;
        let targetX: number;
        let targetY: number;
        let toScale = 0.5;
        if (isSelf) {
          const scroller = handScrollerRef.current;
          if (step.targetIndex === null || step.targetCount === null || !scroller) continue;
          const viewport = measureHandViewport(scroller);
          const layout = calculateHandLayout(viewport.width, viewport.cardWidth, step.targetCount);
          const target = handTargetPoint(scroller, viewport, layout, step.targetIndex);
          targetX = target.x;
          targetY = target.y;
          toScale = viewport.cardWidth / drawBounds.width;
        } else {
          const targetBounds = opponentRefs.current.get(step.playerId)?.getBoundingClientRect();
          if (!targetBounds) continue;
          targetX = centerX(targetBounds);
          targetY = centerY(targetBounds);
        }
        nextDealFlights.push({
          key: `${step.playerId}-${step.startsAt}-${index}`,
          card: step.card,
          source: isSelf ? "self" : "opponent",
          reveal: step.reveal,
          delay: step.startsAt,
          fromX: centerX(drawBounds) - stageBounds.left,
          fromY: centerY(drawBounds) - stageBounds.top,
          toX: targetX - stageBounds.left,
          toY: targetY - stageBounds.top,
          toScale,
          width: drawBounds.width,
        });
      }
      setDealtCardFlights(nextDealFlights);
    });

    const completionTimer = window.setTimeout(() => {
      scrollAfterSelfDealRef.current = transitionPlan.dealtCards.some(
        (step) => step.playerId === snapshot.selfId,
      );
      onTransitionComplete();
    }, transitionPlan.durationMs + ANIMATION_SETTLE_MS);
    return () => {
      window.cancelAnimationFrame(frame);
      window.clearTimeout(completionTimer);
    };
  }, [transition, transitionPlan, snapshot.selfId, onTransitionComplete]);

  if (!game) return null;

  const self = snapshot.players.find((player) => player.id === snapshot.selfId);
  const currentPlayer = snapshot.players.find((player) => player.id === game.currentPlayerId);
  const isSelfTurn = game.currentPlayerId === snapshot.selfId;
  const initialDealActive = transition?.kind === "initial-deal";
  const waitingForConnection = connectionState !== "connected";
  const transitionActive =
    transition !== null || serverBlockActive || game.actionBlockedUntil > Date.now();
  const actionDisabled = pending !== null || waitingForConnection || transitionActive;
  const opponentSeats = arrangeOpponentSeats(snapshot.players, snapshot.selfId);
  const playedSelfCardIds = new Set(
    transitionPlan?.playedCards
      .filter((step) => step.playerId === snapshot.selfId)
      .map((step) => step.card.id) ?? [],
  );
  const selfSkip = skipPresentation(snapshot.selfId, game.skippedPlayerId, transitionPlan);
  const directionEventCommitted =
    latestEvent?.type === "card-played" && latestEvent.card.id === game.topDiscard.id;
  const directionNoticeActive =
    directionEventActive && (Boolean(transitionPlan?.directionChange) || directionEventCommitted);
  const displayedDirection = transitionPlan?.directionChange?.direction ?? game.direction;
  const directionStyle = directionNoticeActive
    ? ({
        "--direction-delay": `${transitionPlan?.directionChange?.startsAt ?? 0}ms`,
        "--direction-spin": displayedDirection === 1 ? "360deg" : "-360deg",
      } as DirectionStyle)
    : undefined;

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
        {latestEvent ? (
          <EventToast key={JSON.stringify(latestEvent)} event={latestEvent} snapshot={snapshot} />
        ) : null}
        <div className="game-top-actions">
          <span className={`connection-badge state-${connectionState}`}>
            {copy.connection[connectionState]}
          </span>
          <button className="text-button" type="button" onClick={onLeave}>
            {copy.leave}
          </button>
        </div>
      </header>

      <section
        className={`turn-status ${isSelfTurn && !initialDealActive ? "self-turn-status" : ""}`}
        aria-live="polite"
      >
        <div>
          <span
            className={`turn-pulse ${isSelfTurn && !initialDealActive ? "self-turn" : ""}`}
            aria-hidden="true"
          />
          <strong>
            {initialDealActive
              ? copy.dealing
              : isSelfTurn
                ? copy.yourTurn
                : `${currentPlayer?.nickname ?? "玩家"}${copy.theirTurn}`}
          </strong>
        </div>
        <TurnTimer deadline={game.turnDeadline} paused={transitionActive} />
      </section>

      <section className="table-stage" aria-label="牌桌" ref={stageRef}>
        {cardFlights.map((flight) => (
          <PlayedCardFlight flight={flight} key={flight.key} />
        ))}
        {dealtCardFlights.map((flight) => (
          <DealtCardFlightView flight={flight} key={flight.key} />
        ))}

        <section className="opponent-arc" aria-label="其他玩家">
          {opponentSeats.map(({ player, left, top }, index) => {
            const skip = skipPresentation(player.id, game.skippedPlayerId, transitionPlan);
            return (
              <article
                className={`opponent-chip ${player.id === game.currentPlayerId ? "active-player" : ""} ${skip.className}`}
                key={player.id}
                ref={(element) => {
                  if (element) opponentRefs.current.set(player.id, element);
                  else opponentRefs.current.delete(player.id);
                }}
                style={opponentSeatStyle(left, top, skip.delay)}
              >
                <span
                  className={`opponent-symbol symbol-${COLOR_ORDER[index % COLOR_ORDER.length]}`}
                />
                <div>
                  <strong>{player.nickname}</strong>
                  <span>
                    {player.handCount} {copy.cards}
                  </span>
                </div>
                {skip.visible ? <SkipBadge /> : null}
              </article>
            );
          })}
        </section>

        <section className="table-center" aria-label="牌桌中央">
          <div
            className={`direction-label ${directionNoticeActive ? "direction-changing" : ""}`}
            style={directionStyle}
          >
            <span>{displayedDirection === 1 ? "↻" : "↺"}</span>
            {directionNoticeActive ? `${copy.directionChanged} · ` : ""}
            {displayedDirection === 1 ? copy.directionClockwise : copy.directionCounterClockwise}
          </div>

          <button
            className="pile-button draw-pile"
            ref={drawPileRef}
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

      {error ? (
        <p className="game-error" role="alert">
          {error}
        </p>
      ) : null}

      <section
        className={`hand-zone ${selfSkip.className}`}
        style={{ "--skip-delay": `${selfSkip.delay}ms` } as SkipStyle}
        aria-label={copy.yourHand}
      >
        {selfSkip.visible ? <SkipBadge /> : null}
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

        <div className="hand-scroller" ref={handScrollerRef}>
          <div
            className="hand-track"
            style={{
              width: `${handLayout.contentWidth}px`,
              height: `${handLayout.cardWidth / 0.68 + 30}px`,
            }}
          >
            {snapshot.hand.map((card, index) => {
              const playable = playableCardIds.has(card.id);
              const isDrawn = game.drawnCardId === card.id;
              return (
                <button
                  className={`hand-card ${playable ? "playable-card" : ""} ${isDrawn ? "drawn-card" : ""} ${playedSelfCardIds.has(card.id) ? "card-origin-hidden" : ""}`}
                  type="button"
                  key={card.id}
                  style={
                    {
                      left: `${index * handLayout.step}px`,
                      "--hand-card-layer": index + 1,
                    } as HandCardStyle
                  }
                  ref={(element) => {
                    if (element) handCardRefs.current.set(card.id, element);
                    else handCardRefs.current.delete(card.id);
                  }}
                  disabled={!isSelfTurn || !playable || actionDisabled}
                  onClick={(event) => playCard(card, event.currentTarget)}
                  aria-label={`打出${cardLabel(card)}`}
                >
                  <CardFace card={card} />
                </button>
              );
            })}
          </div>
        </div>
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
    "--flight-delay": `${flight.delay}ms`,
    "--flight-duration": `${CARD_PLAY_ANIMATION_MS}ms`,
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

function DealtCardFlightView({ flight }: { flight: DealtCardFlight }) {
  const style: DealFlightStyle = {
    "--deal-delay": `${flight.delay}ms`,
    "--deal-duration": `${CARD_DEAL_ANIMATION_MS}ms`,
    "--deal-from-x": `${flight.fromX}px`,
    "--deal-from-y": `${flight.fromY}px`,
    "--deal-reveal-delay": `${flight.delay + CARD_DEAL_ANIMATION_MS}ms`,
    "--deal-reveal-duration": `${CARD_REVEAL_ANIMATION_MS}ms`,
    "--deal-to-x": `${flight.toX}px`,
    "--deal-to-y": `${flight.toY}px`,
    "--deal-to-scale": String(flight.toScale),
    "--deal-width": `${flight.width}px`,
  };

  return (
    <div className={`deal-flight deal-flight-${flight.source}`} style={style} aria-hidden="true">
      <span className={`deal-card ${flight.reveal ? "deal-card-reveal" : ""}`}>
        <span className="deal-card-side deal-card-back">
          <CardBack />
        </span>
        {flight.card ? (
          <span className="deal-card-side deal-card-front">
            <CardFace card={flight.card} />
          </span>
        ) : null}
      </span>
    </div>
  );
}

function opponentSeatStyle(left: number, top: number, skipDelay: number): SeatStyle & SkipStyle {
  return {
    "--seat-left": `${left}%`,
    "--seat-top": `${top}%`,
    "--skip-delay": `${skipDelay}ms`,
  };
}

function TurnTimer({ deadline, paused }: { deadline: number; paused: boolean }) {
  const [now, setNow] = useState(Date.now());

  useEffect(() => {
    if (paused) return;
    setNow(Date.now());
    const timer = window.setInterval(() => setNow(Date.now()), 250);
    return () => window.clearInterval(timer);
  }, [paused]);

  const remainingMs = Math.min(TURN_DURATION_MS, Math.max(0, deadline - now));
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
  else if (event.type === "player-became-bot") text = `${playerName}已由电脑托管`;
  else if (event.type === "player-skipped") text = `${playerName}${copy.skipped}`;
  else text = `${playerName}${copy.skipCleared}`;
  return (
    <div className="event-toast" role="status">
      {text}
    </div>
  );
}

function SkipBadge() {
  return (
    <span className="skip-badge" aria-label={copy.skippedStatus} role="img">
      <span aria-hidden="true" />
    </span>
  );
}

function skipPresentation(
  playerId: string,
  skippedPlayerId: string | null,
  plan: VisualTransitionPlan | null,
): { className: string; delay: number; visible: boolean } {
  const effect = plan?.skipStatuses.find((status) => status.playerId === playerId);
  const isSkipped = skippedPlayerId === playerId;
  return {
    className: effect
      ? effect.type === "skip"
        ? "skip-applying"
        : "skip-clearing"
      : isSkipped
        ? "is-skipped"
        : "",
    delay: effect?.startsAt ?? 0,
    visible: isSkipped || effect !== undefined,
  };
}

function centerX(bounds: DOMRect): number {
  return bounds.left + bounds.width / 2;
}

function centerY(bounds: DOMRect): number {
  return bounds.top + bounds.height / 2;
}

function measureHandViewport(scroller: HTMLElement): HandViewport {
  const style = window.getComputedStyle(scroller);
  const paddingLeft = Number.parseFloat(style.paddingLeft) || 0;
  const paddingRight = Number.parseFloat(style.paddingRight) || 0;
  const cardWidth = Number.parseFloat(style.getPropertyValue("--hand-card-width")) || 76;
  return {
    width: Math.max(0, scroller.clientWidth - paddingLeft - paddingRight),
    paddingLeft,
    cardWidth,
  };
}

function handTargetPoint(
  scroller: HTMLElement,
  viewport: HandViewport,
  layout: ReturnType<typeof calculateHandLayout>,
  targetIndex: number,
): { x: number; y: number } {
  const bounds = scroller.getBoundingClientRect();
  const centeredOffset = Math.max(0, (viewport.width - layout.contentWidth) / 2);
  const finalScrollLeft = Math.max(0, layout.contentWidth - viewport.width);
  return {
    x:
      bounds.left +
      viewport.paddingLeft +
      centeredOffset +
      targetIndex * layout.step +
      layout.cardWidth / 2 -
      finalScrollLeft,
    y: bounds.top + 15 + layout.cardWidth / 0.68 / 2,
  };
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
