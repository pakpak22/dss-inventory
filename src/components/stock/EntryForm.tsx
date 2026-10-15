"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { startTransition, useActionState, useEffect, useMemo, useRef, useState } from "react";
import { lookupIntakeAction, saveEntryAction, type EntryFormState } from "@/app/actions/stock";
import { PartPicker } from "@/components/parts/PartPicker";
import { OWNER_LABEL, formatQuantity } from "@/lib/parts/codes";
import type { PartRow } from "@/lib/parts/types";
import { CHARGE_LABEL, CHARGE_TYPES, ENTRY_TYPE_LABEL, PURPOSES, PURPOSE_LABEL, RECORDABLE_TYPES, needsConfirmation, sheetNoText, type RecordableType } from "@/lib/stock/codes";
import type { ReturnCandidate } from "@/lib/stock/queries";

/**
 * 수량 변경 기록 `/entries/new` (DESIGN 2-4절). 🔴 **휴대폰에서도 쓰는 화면** — 한 줄에 칸 하나씩 세로로.
 *
 * - 종류를 고르면 칸이 달라진다. 부품은 찾아서 고르고, 고르면 현재 수량이 보인다.
 * - 부품 줄은 로컬 state 로 들고 있다가 JSON 글자 하나(`lines`)로 보낸다. 서버가 전부 다시 검사한다.
 * - 제출은 직접 다룬다(<form action> 은 되돌아올 때 폼을 비운다 — CLAUDE.md 함정).
 * - 인수번호 [확인] 은 같은 폼의 다른 액션(lookupIntakeAction)이다. 저장할 때 서버가 다시 묻는다.
 */
export interface EntryFormProps {
  parts: PartRow[];
  initialType: RecordableType;
  /** `?part=No.` 로 들어왔으면 그 부품이 첫 줄에 들어 있다 */
  initialPartNo: number | null;
  isAdmin: boolean;
  today: string;
  /** 반환 화면: 부품을 고르면 서버가 그 부품의 되돌릴 수 있는 줄을 가져온다 — 주소의 `rpart=No.` 로 */
  returnCandidates: ReturnCandidate[];
  returnPartNo: number | null;
}

const INPUT = "w-full rounded-md border border-zinc-200 bg-white px-2 py-1.5 text-sm text-zinc-900";
const LABEL = "flex flex-col gap-1 text-xs text-zinc-500";
const BTN = "rounded-md border border-zinc-300 px-3 py-1.5 text-sm text-zinc-700 hover:bg-zinc-100 disabled:opacity-50";
const BTN_PRIMARY = "w-full rounded-md bg-zinc-900 px-3 py-2 text-sm font-medium text-white hover:bg-zinc-800 disabled:opacity-50";
const CARD = "rounded-lg border border-zinc-200 bg-white p-4 flex flex-col gap-3";
const EMPTY: EntryFormState = { errors: {}, lookup: null, saved: null };

function Err({ msg }: { msg?: string }) {
  return msg ? <span className="text-xs text-red-600">{msg}</span> : null;
}

interface Line {
  partId: string;
  quantity: string;
  chargeType: "PAID" | "FREE";
  note: string;
  actualQuantity: string;
  showActual: boolean;
}

function newLine(partId: string): Line {
  return { partId, quantity: "1", chargeType: "FREE", note: "", actualQuantity: "", showActual: false };
}

export function EntryForm({ parts, initialType, initialPartNo, isAdmin, today, returnCandidates, returnPartNo }: EntryFormProps) {
  const router = useRouter();
  const [state, formAction, pending] = useActionState<EntryFormState, FormData>(saveEntryAction, EMPTY);
  const [lookupState, lookupAction, looking] = useActionState<EntryFormState, FormData>(lookupIntakeAction, EMPTY);
  const [type, setType] = useState<RecordableType>(initialType);
  const [occurredOn, setOccurredOn] = useState(today);
  const [note, setNote] = useState("");
  // 사용
  const [intakeNumber, setIntakeNumber] = useState("");
  const [noRepairCase, setNoRepairCase] = useState(false);
  const [reason, setReason] = useState("");
  const [purpose, setPurpose] = useState<(typeof PURPOSES)[number]>("REPAIR");
  const [purposeText, setPurposeText] = useState("");
  // 대여
  const [counterparty, setCounterparty] = useState("");
  // 부품 줄
  const byId = useMemo(() => new Map(parts.map((p) => [p.id, p])), [parts]);
  const initialPart = initialPartNo === null ? null : parts.find((p) => p.no === initialPartNo) ?? null;
  const [lines, setLines] = useState<Line[]>(initialPart ? [newLine(initialPart.id)] : []);
  // 조정·소유 옮김
  const [singlePartId, setSinglePartId] = useState<string>(initialPart?.id ?? "");
  const [actualQuantity, setActualQuantity] = useState("");
  const [toPartId, setToPartId] = useState("");
  const [transferQty, setTransferQty] = useState("1");
  // 반환
  const [returnLines, setReturnLines] = useState<Record<string, string>>({});

  const err = state.errors;

  // 저장 뒤 그 자리에 남는다 (담당자 답변3 5번). 🔴 함정: 남으면 **자료를 다시 읽어야** 방금 저장한 수량이 보인다 → router.refresh().
  // 새 저장을 알아채는 열쇠는 saved.key. 부품 줄만 비우고 종류·날짜는 그대로 둔다(같은 날 여러 건을 잇달아 적는 흐름).
  const [seenSavedKey, setSeenSavedKey] = useState<number | null>(null);
  const [popup, setPopup] = useState<EntryFormState["saved"]>(null);
  if (state.saved && state.saved.key !== seenSavedKey) {
    setSeenSavedKey(state.saved.key);
    setPopup(state.saved);
    setLines([]);
    setReturnLines({});
    setSinglePartId("");
    setToPartId("");
    setActualQuantity("");
    setIntakeNumber("");
    setNote("");
  }
  const popupRef = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const el = popupRef.current;
    if (!el) return;
    if (popup && !el.open) {
      el.showModal();
      router.refresh();
    } else if (!popup && el.open) el.close();
  }, [popup, router]);

  const lineIds = new Set(lines.map((l) => l.partId));
  const singlePart = singlePartId ? byId.get(singlePartId) ?? null : null;
  const toPart = toPartId ? byId.get(toPartId) ?? null : null;
  const returnPart = returnPartNo === null ? null : parts.find((p) => p.no === returnPartNo) ?? null;

  const typeOptions = RECORDABLE_TYPES.filter((t) => isAdmin || (t !== "ADJUST" && t !== "TRANSFER"));
  // 반출 계열은 **누가 적든** 바로 수량이 바뀌지 않고 담당자 확인을 기다린다 (2026-10-15 사용자 결정 —
  // 10-06 의 「관리자는 바로」를 뒤집었다. 까닭은 codes.ts 의 needsConfirmation 주석에).
  // 🔵 위 `isAdmin` 은 여전히 쓰인다 — 「누가 **적을 수 있나**」(조정·소유 옮김)는 그대로이기 때문이다.
  const confirmLater = needsConfirmation(type);

  function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    fd.set("type", type);
    if (type === "RETURN") {
      fd.set(
        "lines",
        JSON.stringify(
          Object.entries(returnLines)
            .filter(([, q]) => q.trim() !== "" && Number(q) > 0)
            .map(([transactionId, quantity]) => ({ transactionId, quantity: Number(quantity) })),
        ),
      );
    } else if (type === "USE") {
      fd.set("lines", JSON.stringify(lines.map((l) => ({ partId: l.partId, quantity: Number(l.quantity), chargeType: l.chargeType, note: l.note, actualQuantity: l.showActual && l.actualQuantity.trim() !== "" ? Number(l.actualQuantity) : null }))));
    } else {
      fd.set("lines", JSON.stringify(lines.map((l) => ({ partId: l.partId, quantity: Number(l.quantity), note: l.note }))));
    }
    startTransition(() => formAction(fd));
  }

  function doLookup() {
    const fd = new FormData();
    fd.set("intakeNumber", intakeNumber);
    startTransition(() => lookupAction(fd));
  }

  function updateLine(i: number, patch: Partial<Line>) {
    setLines((prev) => prev.map((l, j) => (j === i ? { ...l, ...patch } : l)));
  }

  const lineError = (i: number) => err[`lines.${i}`];

  return (
    <form onSubmit={onSubmit} className="mx-auto flex w-full max-w-xl flex-col gap-4">
      <input type="hidden" name="type" value={type} />
      {err.form ? (
        <p role="alert" className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
          {err.form}
        </p>
      ) : null}

      <section className={CARD}>
        <label className={LABEL}>
          종류 *
          <select
            className={INPUT}
            value={type}
            onChange={(e) => {
              const t = e.target.value as RecordableType;
              setType(t);
              // 주소에 남겨 새로고침·뒤로 가기가 맞게. 반환은 서버가 되돌릴 줄을 가져와야 하므로 주소로 간다.
              router.replace(`/entries/new?type=${t}${initialPartNo !== null ? `&part=${initialPartNo}` : ""}`, { scroll: false });
            }}
          >
            {typeOptions.map((t) => (
              <option key={t} value={t}>
                {ENTRY_TYPE_LABEL[t]}
              </option>
            ))}
          </select>
        </label>
        <label className={LABEL}>
          날짜 *
          <input type="date" name="occurredOn" className={INPUT} value={occurredOn} onChange={(e) => setOccurredOn(e.target.value)} max={today} required />
          <Err msg={err.occurredOn} />
        </label>
      </section>

      {type === "USE" && (
        <section className={CARD}>
          <h2 className="text-sm font-semibold text-zinc-900">수리 건</h2>
          <label className="inline-flex items-center gap-2 text-sm text-zinc-700">
            <input type="checkbox" name="noRepairCase" value="1" checked={noRepairCase} onChange={(e) => setNoRepairCase(e.target.checked)} />
            수리 건 없음
          </label>
          {noRepairCase ? (
            <label className={LABEL}>
              사유 *
              <input name="reason" className={INPUT} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="예: 데모 장비용" />
              <Err msg={err.reason} />
            </label>
          ) : (
            <>
              <label className={LABEL}>
                인수번호 *
                <div className="flex gap-2">
                  <input
                    name="intakeNumber"
                    className={`${INPUT} font-mono uppercase`}
                    value={intakeNumber}
                    onChange={(e) => setIntakeNumber(e.target.value.toUpperCase())}
                    placeholder="D260701"
                    inputMode="text"
                    autoCapitalize="characters"
                  />
                  <button type="button" className={`${BTN} shrink-0`} onClick={doLookup} disabled={looking || intakeNumber.length < 7}>
                    {looking ? "확인 중" : "확인"}
                  </button>
                </div>
                <Err msg={err.intakeNumber} />
              </label>
              {lookupState.lookup?.kind === "found" ? (
                <dl className="grid grid-cols-[5rem_1fr] gap-y-1 rounded-md border border-zinc-200 bg-zinc-50 p-3 text-sm">
                  <dt className="text-zinc-500">고객사</dt>
                  <dd>{lookupState.lookup.info.customerName || "-"}</dd>
                  <dt className="text-zinc-500">End-User</dt>
                  <dd>{lookupState.lookup.info.endUser || "-"}</dd>
                  <dt className="text-zinc-500">기종</dt>
                  <dd>{lookupState.lookup.info.productModel || "-"}</dd>
                  <dt className="text-zinc-500">S/N · L/N</dt>
                  <dd className="font-mono text-xs">
                    {lookupState.lookup.info.productSerial || "-"} · {lookupState.lookup.info.productLot || "-"}
                  </dd>
                </dl>
              ) : lookupState.lookup?.kind === "message" ? (
                <p className={`rounded-md px-3 py-2 text-sm ${lookupState.lookup.soft ? "border border-amber-300 bg-amber-50 text-amber-900" : "border border-red-200 bg-red-50 text-red-700"}`}>{lookupState.lookup.text}</p>
              ) : null}
            </>
          )}
          <label className={LABEL}>
            목적 *
            <select name="purpose" className={INPUT} value={purpose} onChange={(e) => setPurpose(e.target.value as (typeof PURPOSES)[number])}>
              {PURPOSES.map((p) => (
                <option key={p} value={p}>
                  {PURPOSE_LABEL[p]}
                </option>
              ))}
            </select>
            <Err msg={err.purpose} />
          </label>
          {purpose === "OTHER" && (
            <label className={LABEL}>
              무엇인지 *
              <input name="purposeText" className={INPUT} value={purposeText} onChange={(e) => setPurposeText(e.target.value)} />
              <Err msg={err.purposeText} />
            </label>
          )}
        </section>
      )}

      {type === "LOAN" && (
        <section className={CARD}>
          <label className={LABEL}>
            빌려준 곳 *
            <input name="counterparty" className={INPUT} value={counterparty} onChange={(e) => setCounterparty(e.target.value)} placeholder="예: 상해수리소" />
            <Err msg={err.counterparty} />
          </label>
        </section>
      )}

      {type === "DISPOSE" && (
        <section className={CARD}>
          <label className={LABEL}>
            폐기·불량 사유 *
            <input name="reason" className={INPUT} value={reason} onChange={(e) => setReason(e.target.value)} />
            <Err msg={err.reason} />
          </label>
        </section>
      )}

      {(type === "USE" || type === "RECEIVE" || type === "LOAN" || type === "DISPOSE") && (
        <section className={CARD}>
          <h2 className="text-sm font-semibold text-zinc-900">부품 {lines.length > 0 ? `${lines.length}줄` : ""}</h2>
          <Err msg={err.lines} />
          {lines.map((l, i) => {
            const p = byId.get(l.partId);
            if (!p) return null;
            const q = Number(l.quantity);
            const minus = type !== "RECEIVE";
            const after = Number.isInteger(q) ? (l.showActual && l.actualQuantity !== "" ? Number(l.actualQuantity) : p.quantity) + (minus ? -q : q) : null;
            return (
              <div key={l.partId} className="flex flex-col gap-2 rounded-md border border-zinc-200 p-3">
                <div className="flex items-start justify-between gap-2">
                  <div className="text-sm">
                    <span className="text-zinc-500">No. {p.no}</span> <b>{p.name}</b>
                    {p.name2 ? <span className="text-zinc-500"> · {p.name2}</span> : null}
                    <div className="text-xs text-zinc-500">
                      {OWNER_LABEL[p.owner]} · 지금 <span className="tabular">{formatQuantity(p.quantity)}</span>개
                      {after !== null ? (
                        <>
                          {" "}
                          → 저장 뒤 <span className={`tabular ${after < 0 ? "text-red-600" : ""}`}>{after}</span>개
                        </>
                      ) : null}
                    </div>
                  </div>
                  <button type="button" className={BTN} onClick={() => setLines((prev) => prev.filter((_, j) => j !== i))}>
                    빼기
                  </button>
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <label className={LABEL}>
                    수량 *
                    <input type="number" inputMode="numeric" min={1} className={`${INPUT} tabular`} value={l.quantity} onChange={(e) => updateLine(i, { quantity: e.target.value })} required />
                  </label>
                  {type === "USE" ? (
                    <label className={LABEL}>
                      유상·무상 *
                      <select className={INPUT} value={l.chargeType} onChange={(e) => updateLine(i, { chargeType: e.target.value as "PAID" | "FREE" })}>
                        {CHARGE_TYPES.map((c) => (
                          <option key={c} value={c}>
                            {CHARGE_LABEL[c]}
                          </option>
                        ))}
                      </select>
                    </label>
                  ) : null}
                </div>
                <label className={LABEL}>
                  비고
                  <input className={INPUT} value={l.note} onChange={(e) => updateLine(i, { note: e.target.value })} />
                </label>
                {type === "USE" ? (
                  <div className="flex flex-col gap-1">
                    <label className="inline-flex items-center gap-2 text-xs text-zinc-700">
                      <input type="checkbox" checked={l.showActual} onChange={(e) => updateLine(i, { showActual: e.target.checked, actualQuantity: e.target.checked ? l.actualQuantity : "" })} />
                      실제 수량이 다릅니다 (저장할 때 조정 기록이 함께 남습니다)
                    </label>
                    {l.showActual ? (
                      <label className={LABEL}>
                        선반에 실제로 있는 수량 (가져가기 전)
                        <input type="number" inputMode="numeric" min={0} className={`${INPUT} tabular`} value={l.actualQuantity} onChange={(e) => updateLine(i, { actualQuantity: e.target.value })} />
                      </label>
                    ) : null}
                  </div>
                ) : null}
                <Err msg={lineError(i)} />
              </div>
            );
          })}
          <PartPicker parts={parts} exclude={lineIds} label={lines.length === 0 ? "부품 찾기 *" : "부품 더 넣기"} onPick={(p) => setLines((prev) => [...prev, newLine(p.id)])} />
        </section>
      )}

      {type === "RETURN" && (
        <section className={CARD}>
          <h2 className="text-sm font-semibold text-zinc-900">되돌릴 기록</h2>
          <p className="text-xs text-zinc-500">부품을 고르면 그 부품의 사용·대여 기록 중 아직 돌아오지 않은 것이 보입니다. 돌아온 수량을 적으십시오.</p>
          {returnPart ? (
            <div className="rounded-md border border-zinc-200 bg-zinc-50 px-3 py-2 text-sm">
              <span className="text-zinc-500">No. {returnPart.no}</span> <b>{returnPart.name}</b> · 지금 {formatQuantity(returnPart.quantity)}개{" "}
              <Link href="/entries/new?type=RETURN" className="text-xs underline">
                다른 부품
              </Link>
            </div>
          ) : (
            <PartPicker parts={parts} exclude={new Set()} label="부품 찾기 *" onPick={(p) => router.replace(`/entries/new?type=RETURN&rpart=${p.no}`, { scroll: false })} />
          )}
          <Err msg={err.lines} />
          {returnPart && returnCandidates.length === 0 ? <p className="text-sm text-zinc-500">되돌릴 수 있는 사용·대여 기록이 없습니다.</p> : null}
          {returnCandidates.map((c, i) => (
            <div key={c.transactionId} className="flex flex-col gap-2 rounded-md border border-zinc-200 p-3 text-sm">
              <div>
                <b>{ENTRY_TYPE_LABEL[c.type]}</b> {c.occurredOn} · 번호 {sheetNoText(c.type, c.sheetYear, c.sheetNo)}
                {c.intakeNumber ? ` · ${c.intakeNumber}` : ""}
                {c.counterparty ? ` · ${c.counterparty}` : ""}
                <div className="text-xs text-zinc-500">
                  가져간 {c.taken}개 · 돌아온 {c.returned}개 · 남은 <b className="tabular">{c.remaining}</b>개{c.usagePlace ? ` · ${c.usagePlace}` : ""}
                </div>
              </div>
              <label className={LABEL}>
                이번에 돌아온 수량
                <input type="number" inputMode="numeric" min={0} max={c.remaining} className={`${INPUT} tabular`} value={returnLines[c.transactionId] ?? ""} onChange={(e) => setReturnLines((prev) => ({ ...prev, [c.transactionId]: e.target.value }))} placeholder="0" />
              </label>
              <Err msg={lineError(i)} />
            </div>
          ))}
        </section>
      )}

      {type === "ADJUST" && (
        <section className={CARD}>
          <h2 className="text-sm font-semibold text-zinc-900">조정</h2>
          <p className="text-xs text-zinc-500">세어 본 실제 수량을 적으면 차이는 프로그램이 계산합니다.</p>
          {singlePart ? (
            <div className="rounded-md border border-zinc-200 bg-zinc-50 px-3 py-2 text-sm">
              <input type="hidden" name="partId" value={singlePart.id} />
              <span className="text-zinc-500">No. {singlePart.no}</span> <b>{singlePart.name}</b> · 지금 <span className="tabular">{formatQuantity(singlePart.quantity)}</span>개{" "}
              <button type="button" className="text-xs underline" onClick={() => setSinglePartId("")}>
                다른 부품
              </button>
            </div>
          ) : (
            <PartPicker parts={parts} exclude={new Set()} label="부품 찾기 *" onPick={(p) => setSinglePartId(p.id)} />
          )}
          <Err msg={err.partId} />
          <label className={LABEL}>
            실제로 센 수량 *
            <input type="number" name="actualQuantity" inputMode="numeric" min={0} className={`${INPUT} tabular`} value={actualQuantity} onChange={(e) => setActualQuantity(e.target.value)} required />
            {singlePart && actualQuantity !== "" ? (
              <span className="text-xs text-zinc-500">
                차이 <b className="tabular">{Number(actualQuantity) - singlePart.quantity > 0 ? "+" : ""}{Number(actualQuantity) - singlePart.quantity}</b>개
              </span>
            ) : null}
            <Err msg={err.actualQuantity} />
          </label>
          <label className={LABEL}>
            사유 *
            <input name="reason" className={INPUT} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="예: 정기 실사" />
            <Err msg={err.reason} />
          </label>
        </section>
      )}

      {type === "TRANSFER" && (
        <section className={CARD}>
          <h2 className="text-sm font-semibold text-zinc-900">소유 옮김</h2>
          <p className="text-xs text-zinc-500">같은 부품의 다른 소유 No. 로 옮깁니다. 보내는 쪽이 줄고 받는 쪽이 늘어납니다.</p>
          {singlePart ? (
            <div className="rounded-md border border-zinc-200 bg-zinc-50 px-3 py-2 text-sm">
              <input type="hidden" name="fromPartId" value={singlePart.id} />
              보내는 부품: <span className="text-zinc-500">No. {singlePart.no}</span> <b>{singlePart.name}</b> · {OWNER_LABEL[singlePart.owner]} · 지금 {formatQuantity(singlePart.quantity)}개{" "}
              <button type="button" className="text-xs underline" onClick={() => { setSinglePartId(""); setToPartId(""); }}>
                다시
              </button>
            </div>
          ) : (
            <PartPicker parts={parts} exclude={new Set()} label="보내는 부품 *" onPick={(p) => setSinglePartId(p.id)} />
          )}
          <Err msg={err.fromPartId} />
          {singlePart ? (
            toPart ? (
              <div className="rounded-md border border-zinc-200 bg-zinc-50 px-3 py-2 text-sm">
                <input type="hidden" name="toPartId" value={toPart.id} />
                받는 부품: <span className="text-zinc-500">No. {toPart.no}</span> <b>{toPart.name}</b> · {OWNER_LABEL[toPart.owner]} · 지금 {formatQuantity(toPart.quantity)}개{" "}
                <button type="button" className="text-xs underline" onClick={() => setToPartId("")}>
                  다시
                </button>
              </div>
            ) : (
              <PartPicker parts={parts.filter((p) => p.name === singlePart.name && p.owner !== singlePart.owner)} exclude={new Set([singlePart.id])} label="받는 부품 * (같은 품명, 다른 소유)" onPick={(p) => setToPartId(p.id)} />
            )
          ) : null}
          <Err msg={err.toPartId} />
          <label className={LABEL}>
            옮길 수량 *
            <input type="number" name="quantity" inputMode="numeric" min={1} className={`${INPUT} tabular`} value={transferQty} onChange={(e) => setTransferQty(e.target.value)} required />
            <Err msg={err.quantity} />
          </label>
        </section>
      )}

      <section className={CARD}>
        <label className={LABEL}>
          비고
          <textarea name="note" rows={2} className={INPUT} value={note} onChange={(e) => setNote(e.target.value)} />
          <Err msg={err.note} />
        </label>
      </section>

      {confirmLater ? (
        <p className="rounded-md border border-zinc-200 bg-zinc-50 px-3 py-2 text-xs text-zinc-700">
          {/* 🔵 쓰는 분이 쓰는 낱말은 「요청」이다(머리말 단추도 「부품 요청」) — 사람이 보는 글자를 거기 맞춘다 (2026-10-15). */}
          요청하면 <b>확인 대기</b>로 올라갑니다. 담당자(관리자)가 확인하면 그때 수량이 바뀝니다. 부품 요청에서 진행을 볼 수 있습니다.
        </p>
      ) : null}
      <dialog
        ref={popupRef}
        className="w-full max-w-sm rounded-lg border border-zinc-200 bg-white p-4 text-center text-zinc-900 backdrop:bg-black/40"
        onCancel={(e) => {
          e.preventDefault();
          setPopup(null);
        }}
      >
        {popup ? (
          <div className="flex flex-col gap-3">
            <p className="text-base font-semibold">
              {popup.kind === "request" ? `${ENTRY_TYPE_LABEL[popup.type as RecordableType] ?? popup.type} 요청이 올라갔습니다.` : `${ENTRY_TYPE_LABEL[popup.type as RecordableType] ?? popup.type} 기록 ${popup.sheetYear !== null && popup.sheetNo !== null ? sheetNoText(popup.type as RecordableType, popup.sheetYear, popup.sheetNo) : ""} 저장되었습니다.`}
            </p>
            {popup.kind === "request" ? <p className="text-sm text-zinc-600">담당자(관리자)가 확인하면 그때 수량이 바뀝니다.</p> : null}
            {popup.intakeUnverified ? <p className="rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900">A/S 가 응답하지 않아 「인수번호 확인 안 됨」으로 남았습니다. 기록 내역에서 나중에 [확인]을 누르십시오.</p> : null}
            <div className="flex justify-center gap-2">
              {/* 🔵 [계속 기록]은 그대로 둔다 — 같은 날 여러 건을 잇달아 적는 흐름이다(위 saved.key 주석). */}
              <button type="button" className={BTN} onClick={() => setPopup(null)}>
                계속 기록
              </button>
              {/* 🔴 가는 곳이 갈린다 (2026-10-15): 요청으로 올라간 것은 `/requests` 에서 보고, **바로 기록된 것**
                  (입고·반환 등)은 거기에 아예 없으므로 기록 내역으로 보낸다. */}
              {popup.kind === "request" ? (
                <Link href="/requests" className={BTN}>
                  부품 요청으로
                </Link>
              ) : (
                <Link href="/entries" className={BTN}>
                  기록 내역으로
                </Link>
              )}
            </div>
          </div>
        ) : null}
      </dialog>

      <div className="flex flex-col gap-2">
        {/* 🔵 반출이면 「사용 요청」·「요청 중」, 그 밖(입고·반환·조정·소유 옮김)은 그대로 「입고 저장」·「저장 중」.
            단추 글자가 그 자리에서 무슨 일이 일어나는지를 말한다 — 반출은 저장이 아니라 요청이다 (2026-10-15). */}
        <button type="submit" className={BTN_PRIMARY} disabled={pending}>
          {pending ? (confirmLater ? "요청 중" : "저장 중") : confirmLater ? `${ENTRY_TYPE_LABEL[type]} 요청` : `${ENTRY_TYPE_LABEL[type]} 저장`}
        </button>
        <Link href="/" className={`${BTN} text-center`}>
          취소
        </Link>
      </div>
    </form>
  );
}
