import { useRef, useState } from "react";
import type { RankedInterest } from "../home/model";
import { MAX_FIELDS } from "../home/model";

const ROW_HEIGHT = 40;

interface Props {
  interests: RankedInterest[];
  onReorder: (keys: string[]) => void;
}

/**
 * The viewer's interests, highest first, draggable to re-rank. The top few
 * mappable ones become the fields on the canvas, so this list is the control
 * for what the canvas is about.
 *
 * Pointer events rather than HTML5 drag-and-drop: touch works, it matches the
 * canvas's input model, and there is no drag image to fight.
 */
export function InterestRankList({ interests, onReorder }: Props) {
  const [dragKey, setDragKey] = useState<string | null>(null);
  const [order, setOrder] = useState<RankedInterest[] | null>(null);
  const startY = useRef(0);
  const startIndex = useRef(0);

  const list = order ?? interests;
  let fieldSlot = 0;

  const commit = (next: RankedInterest[]) => {
    setOrder(null);
    setDragKey(null);
    onReorder(next.map((i) => i.key));
  };

  const onPointerDown = (e: React.PointerEvent<HTMLLIElement>, index: number) => {
    e.currentTarget.setPointerCapture(e.pointerId);
    setDragKey(list[index].key);
    setOrder([...list]);
    startY.current = e.clientY;
    startIndex.current = index;
  };

  const onPointerMove = (e: React.PointerEvent<HTMLLIElement>) => {
    if (!dragKey || !order) return;
    const delta = Math.round((e.clientY - startY.current) / ROW_HEIGHT);
    const target = Math.max(0, Math.min(order.length - 1, startIndex.current + delta));
    const current = order.findIndex((i) => i.key === dragKey);
    if (current === target || current < 0) return;
    const next = [...order];
    const [moved] = next.splice(current, 1);
    next.splice(target, 0, moved);
    setOrder(next);
  };

  const onPointerUp = () => {
    if (order) commit(order);
  };

  // Keyboard equivalent — the meaningful reorder gesture, and the one that has
  // to work without a pointer at all.
  const onKeyDown = (e: React.KeyboardEvent<HTMLLIElement>, index: number) => {
    if (!e.altKey) return;
    let target = index;
    if (e.key === "ArrowUp") target = index - 1;
    else if (e.key === "ArrowDown") target = index + 1;
    else return;
    if (target < 0 || target >= list.length) return;
    e.preventDefault();
    const next = [...list];
    const [moved] = next.splice(index, 1);
    next.splice(target, 0, moved);
    commit(next);
  };

  return (
    <div
      style={{
        width: 268,
        background: "var(--surface)",
        border: "1px solid var(--ink-200)",
        borderRadius: 14,
        padding: 16,
        boxShadow: "0 1px 2px rgba(15,23,36,0.04), 0 8px 24px rgba(15,23,36,0.06)",
      }}
    >
      <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 8 }}>
        <h2 style={{ fontSize: "var(--fs-sm)", fontWeight: 600, color: "var(--ink-900)" }}>Your interests</h2>
        <span style={{ fontSize: "var(--fs-xs)", color: "var(--ink-500)" }}>drag to rank</span>
      </div>

      <ul style={{ listStyle: "none", margin: "10px 0 0", padding: 0 }}>
        {list.map((interest, index) => {
          const isField = interest.mappable && fieldSlot < MAX_FIELDS;
          if (isField) fieldSlot++;
          const dragging = dragKey === interest.key;
          return (
            <li
              key={interest.key}
              tabIndex={0}
              onPointerDown={(e) => onPointerDown(e, index)}
              onPointerMove={onPointerMove}
              onPointerUp={onPointerUp}
              onPointerCancel={onPointerUp}
              onKeyDown={(e) => onKeyDown(e, index)}
              aria-label={`${interest.label}, rank ${index + 1}${
                isField ? ", shown on the map" : ", not shown on the map"
              }. Hold Alt and press the up or down arrow to move it.`}
              style={{
                display: "grid",
                gridTemplateColumns: "18px 1fr auto",
                alignItems: "center",
                gap: 8,
                height: ROW_HEIGHT,
                padding: "0 6px",
                borderRadius: 8,
                cursor: "grab",
                touchAction: "none",
                background: dragging ? "var(--tq-050)" : "transparent",
                boxShadow: dragging ? "0 4px 12px rgba(15,23,36,0.12)" : "none",
                transition: "background var(--t-fast) var(--ease-out)",
              }}
            >
              <span
                aria-hidden="true"
                style={{
                  fontSize: "var(--fs-xs)",
                  color: "var(--ink-500)",
                  fontVariantNumeric: "tabular-nums",
                }}
              >
                {index + 1}
              </span>
              <span
                style={{
                  fontSize: "var(--fs-sm)",
                  color: isField ? "var(--ink-900)" : "var(--ink-500)",
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  whiteSpace: "nowrap",
                }}
                title={interest.label}
              >
                {interest.shownAs}
              </span>
              {isField ? (
                <span
                  aria-hidden="true"
                  title="Shown as an area on the map"
                  style={{
                    width: 10,
                    height: 10,
                    borderRadius: 999,
                    background: "var(--field-fill-active)",
                    border: "1px solid var(--field-stroke)",
                  }}
                />
              ) : (
                <span
                  style={{ fontSize: "var(--fs-xs)", color: "var(--ink-400)" }}
                  title={
                    interest.mappable
                      ? "Rank it in the top five to show it on the map"
                      : "Not resolved to a concept yet, so it can't be matched against people"
                  }
                >
                  {interest.mappable ? "—" : "unmapped"}
                </span>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
