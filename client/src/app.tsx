import { useEffect, useRef, useState } from "react";

import type { BotDifficulty, CardColor } from "../../src/logic";
import {
  MAX_NICKNAME_LENGTH,
  normalizeRoomCode,
  type PublicPlayer,
  type RoomSnapshot,
} from "../../src/protocol";
import { copy } from "./copy";
import { canAttemptJoin, leaveConfirmation } from "./entry-state";
import { GameTable, ResultScreen } from "./game-table";
import { type ConnectionState, useRoomClient } from "./room-client";

const SHAPE_CLASSES: Record<CardColor, string> = {
  coral: "shape-square",
  amber: "shape-triangle",
  teal: "shape-circle",
  azure: "shape-diamond",
};
const EMPTY_SEAT_IDS = ["empty-one", "empty-two", "empty-three", "empty-four", "empty-five"];
const PLAYER_COLORS = ["teal", "azure", "amber", "coral"] as const satisfies readonly CardColor[];

export function App() {
  const room = useRoomClient();
  const visibleSnapshot = room.transition?.previous ?? room.snapshot;
  const leave = () => {
    const confirmation = visibleSnapshot ? leaveConfirmation(visibleSnapshot) : null;
    if (confirmation && !window.confirm(copy.leaveConfirmation[confirmation])) return;
    room.leave();
  };

  if (!room.session) {
    return (
      <WelcomeScreen
        busy={room.busy}
        error={room.error}
        onCreate={room.createRoom}
        onJoin={room.joinRoom}
        onClearError={room.clearError}
      />
    );
  }

  if (!visibleSnapshot) {
    return (
      <main className="app-shell centered-shell">
        <section className="panel connecting-panel" aria-live="polite">
          <BrandMark />
          <div className="spinner" aria-hidden="true" />
          <h1>{room.connectionState === "reconnecting" ? copy.reconnecting : copy.connecting}</h1>
          {room.error ? <p className="error-banner">{room.error}</p> : null}
          <button className="button button-ghost" type="button" onClick={leave}>
            {copy.leave}
          </button>
        </section>
      </main>
    );
  }

  if (visibleSnapshot.phase === "lobby") {
    return (
      <LobbyScreen
        snapshot={visibleSnapshot}
        connectionState={room.connectionState}
        error={room.error}
        onSend={room.send}
        onLeave={leave}
      />
    );
  }

  if (visibleSnapshot.phase === "finished") {
    return <ResultScreen snapshot={visibleSnapshot} onSend={room.send} onLeave={leave} />;
  }

  return (
    <GameTable
      snapshot={visibleSnapshot}
      connectionState={room.connectionState}
      error={room.error}
      latestEvent={room.latestEvent}
      transition={room.transition}
      onSend={room.send}
      onTransitionComplete={room.completeTransition}
      onLeave={leave}
    />
  );
}

interface WelcomeScreenProps {
  busy: boolean;
  error: string | null;
  onCreate: (nickname: string) => Promise<void>;
  onJoin: (nickname: string, roomCode: string) => Promise<void>;
  onClearError: () => void;
}

function WelcomeScreen({ busy, error, onCreate, onJoin, onClearError }: WelcomeScreenProps) {
  const [nickname, setNickname] = useState("");
  const [roomCode, setRoomCode] = useState("");
  const [nicknameMissing, setNicknameMissing] = useState(false);
  const nicknameRef = useRef<HTMLInputElement | null>(null);
  const normalizedNickname = nickname.trim();
  const normalizedRoomCode = normalizeRoomCode(roomCode);
  const nicknameValid =
    normalizedNickname.length > 0 && normalizedNickname.length <= MAX_NICKNAME_LENGTH;

  return (
    <main className="app-shell welcome-shell">
      <section className="welcome-copy">
        <BrandMark />
        <p className="eyebrow">{copy.eyebrow}</p>
        <h1>{copy.brand}</h1>
        <p className="lede">{copy.intro}</p>
        <div className="card-back-preview" aria-hidden="true">
          <div className="card-back-grid">
            <span className="shape shape-circle" />
            <span className="shape shape-diamond" />
            <span className="shape shape-triangle" />
            <span className="shape shape-square" />
          </div>
        </div>
      </section>

      <section className="panel entry-panel" aria-labelledby="entry-title">
        <div>
          <p className="section-kicker">无需账号</p>
          <h2 id="entry-title">进入牌桌</h2>
        </div>

        <label className="field">
          <span>{copy.nicknameLabel}</span>
          <input
            ref={nicknameRef}
            autoComplete="nickname"
            aria-describedby={nicknameMissing ? "nickname-required" : undefined}
            aria-invalid={nicknameMissing}
            maxLength={MAX_NICKNAME_LENGTH}
            placeholder={copy.nicknamePlaceholder}
            value={nickname}
            onChange={(event) => {
              setNickname(event.target.value);
              setNicknameMissing(false);
              onClearError();
            }}
          />
          {nicknameMissing ? (
            <span className="field-error" id="nickname-required" role="alert">
              {copy.nicknameRequired}
            </span>
          ) : null}
        </label>

        <button
          className="button button-primary"
          type="button"
          disabled={!nicknameValid || busy}
          onClick={() => void onCreate(normalizedNickname)}
        >
          {busy ? copy.entering : copy.createRoom}
        </button>

        <div className="divider">
          <span>或凭房间码加入</span>
        </div>

        <label className="field">
          <span>{copy.roomCodeLabel}</span>
          <input
            autoCapitalize="characters"
            autoComplete="off"
            className="room-code-input"
            maxLength={5}
            placeholder={copy.roomCodePlaceholder}
            value={roomCode}
            onChange={(event) => {
              setRoomCode(event.target.value.toUpperCase());
              onClearError();
            }}
          />
        </label>

        <button
          className="button button-secondary"
          type="button"
          disabled={!canAttemptJoin(normalizedRoomCode, busy)}
          onClick={() => {
            if (!nicknameValid) {
              setNicknameMissing(true);
              nicknameRef.current?.focus();
              return;
            }
            if (normalizedRoomCode) void onJoin(normalizedNickname, normalizedRoomCode);
          }}
        >
          {busy ? copy.entering : copy.joinRoom}
        </button>

        {error ? (
          <p className="error-banner" role="alert">
            {error}
          </p>
        ) : null}
      </section>
    </main>
  );
}

interface LobbyScreenProps {
  snapshot: RoomSnapshot;
  connectionState: ConnectionState;
  error: string | null;
  onSend: ReturnType<typeof useRoomClient>["send"];
  onLeave: () => void;
}

function LobbyScreen({ snapshot, connectionState, error, onSend, onLeave }: LobbyScreenProps) {
  const [difficulty, setDifficulty] = useState<BotDifficulty>("medium");
  const [copied, setCopied] = useState(false);
  const isHost = snapshot.selfId === snapshot.hostId;
  const canStart = snapshot.players.length >= 2;

  useEffect(() => {
    if (!copied) return;
    const timer = window.setTimeout(() => setCopied(false), 1_500);
    return () => window.clearTimeout(timer);
  }, [copied]);

  const subtitle = `${snapshot.players.length} / 6 ${copy.seats}`;

  const copyRoomCode = async () => {
    try {
      await navigator.clipboard.writeText(snapshot.roomCode);
      setCopied(true);
    } catch {
      setCopied(false);
    }
  };

  return (
    <main className="app-shell lobby-shell">
      <header className="topbar">
        <BrandMark compact />
        <div className="topbar-actions">
          <ConnectionBadge state={connectionState} />
          <button className="text-button" type="button" onClick={onLeave}>
            {copy.leave}
          </button>
        </div>
      </header>

      <section className="room-code-card" aria-label={`${copy.room} ${snapshot.roomCode}`}>
        <div>
          <span>{copy.room}</span>
          <strong>{snapshot.roomCode}</strong>
        </div>
        <button className="copy-button" type="button" onClick={() => void copyRoomCode()}>
          {copied ? copy.copied : copy.copyCode}
        </button>
      </section>

      <section className="lobby-heading">
        <div>
          <p className="section-kicker">{subtitle}</p>
          <h1>{copy.lobbyTitle}</h1>
          <p>{copy.lobbyIntro}</p>
        </div>
      </section>

      <section className="player-grid" aria-label="玩家列表">
        {snapshot.players.map((player, index) => (
          <PlayerTile
            key={player.id}
            player={player}
            color={colorForIndex(index)}
            isHost={player.id === snapshot.hostId}
            isSelf={player.id === snapshot.selfId}
            canRemove={isHost && player.isBot}
            onRemove={() => onSend({ type: "lobby.remove-bot", playerId: player.id })}
          />
        ))}
        {EMPTY_SEAT_IDS.slice(0, 6 - snapshot.players.length).map((seatId) => (
          <div className="player-tile empty-seat" key={seatId} aria-hidden="true">
            <span>+</span>
          </div>
        ))}
      </section>

      <section className="panel lobby-controls">
        {isHost ? (
          <>
            <div className="bot-controls">
              <label className="field compact-field">
                <span>{copy.bot}</span>
                <select
                  value={difficulty}
                  onChange={(event) => setDifficulty(event.target.value as BotDifficulty)}
                >
                  <option value="easy">{copy.difficulty.easy}</option>
                  <option value="medium">{copy.difficulty.medium}</option>
                  <option value="hard">{copy.difficulty.hard}</option>
                </select>
              </label>
              <button
                className="button button-secondary"
                type="button"
                disabled={snapshot.players.length >= 6}
                onClick={() => onSend({ type: "lobby.add-bot", difficulty })}
              >
                {copy.addBot}
              </button>
            </div>
            <button
              className="button button-primary start-button"
              type="button"
              disabled={!canStart}
              onClick={() => onSend({ type: "lobby.start" })}
            >
              {canStart ? copy.startGame : copy.needPlayers}
            </button>
          </>
        ) : (
          <div className="waiting-message">
            <span className="waiting-dot" aria-hidden="true" />
            {copy.waitingForHost}
          </div>
        )}
        {error ? (
          <p className="error-banner" role="alert">
            {error}
          </p>
        ) : null}
      </section>
    </main>
  );
}

interface PlayerTileProps {
  player: PublicPlayer;
  color: CardColor;
  isHost: boolean;
  isSelf: boolean;
  canRemove: boolean;
  onRemove: () => void;
}

function PlayerTile({ player, color, isHost, isSelf, canRemove, onRemove }: PlayerTileProps) {
  return (
    <article className={`player-tile color-${color}`}>
      <div className={`player-symbol ${SHAPE_CLASSES[color]}`} aria-hidden="true" />
      <div className="player-details">
        <strong>{player.nickname}</strong>
        <span>
          {isHost
            ? copy.host
            : player.isBot
              ? copy.difficulty[player.difficulty ?? "medium"]
              : "玩家"}
          {isSelf ? ` · ${copy.you}` : ""}
          {!player.connected ? ` · ${copy.offline}` : ""}
        </span>
      </div>
      {canRemove ? (
        <button
          className="remove-button"
          type="button"
          onClick={onRemove}
          aria-label={`${copy.removeBot} ${player.nickname}`}
        >
          {copy.removeBot}
        </button>
      ) : null}
    </article>
  );
}

function ConnectionBadge({ state }: { state: ConnectionState }) {
  return <span className={`connection-badge state-${state}`}>{copy.connection[state]}</span>;
}

function BrandMark({ compact = false }: { compact?: boolean }) {
  return (
    <div className={`brand-mark ${compact ? "brand-mark-compact" : ""}`}>
      <span className="brand-symbols" aria-hidden="true">
        <i className="shape shape-circle" />
        <i className="shape shape-diamond" />
        <i className="shape shape-triangle" />
        <i className="shape shape-square" />
      </span>
      {compact ? <strong>{copy.brand}</strong> : null}
    </div>
  );
}

function colorForIndex(index: number): CardColor {
  return PLAYER_COLORS[index % PLAYER_COLORS.length] ?? "teal";
}
