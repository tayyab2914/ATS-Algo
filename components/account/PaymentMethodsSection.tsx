"use client";

import { useMemo, useState, type FormEvent } from "react";
import { DangerAction, PrimaryAction, SettingsCard } from "@/components/account/SettingsCard";
import { Notice, type NoticeData } from "@/components/ui/Notice";
import { TextField } from "@/components/ui/TextField";
import {
  detectCardBrand,
  formatExpiry,
  luhnValid,
  MAX_PAYMENT_METHODS,
  normalizeCardNumber,
  type PaymentMethodView,
} from "@/lib/payment";

/** Group digits into blocks of four for the card-number field. */
function formatCardInput(value: string): string {
  const digits = value.replace(/\D/g, "").slice(0, 19);
  return digits.replace(/(.{4})(?=.)/g, "$1 ");
}

/** Coerce free typing into "MM/YY" as the user goes. */
function formatExpiryInput(value: string): string {
  const digits = value.replace(/\D/g, "").slice(0, 4);
  if (digits.length <= 2) return digits;
  return `${digits.slice(0, 2)}/${digits.slice(2)}`;
}

const EMPTY_FORM = { number: "", expiry: "", cvv: "", holderName: "", label: "" };

/** Sort default first; otherwise preserve incoming order (newest-first from the server). */
function sortMethods(methods: PaymentMethodView[]): PaymentMethodView[] {
  return [...methods].sort((a, b) => Number(b.isDefault) - Number(a.isDefault));
}

/**
 * Account Settings → Payment Methods. Users save personal cards for their own
 * reference. For security only non-sensitive details are sent to the server: the
 * full card number is masked to brand + last four server-side, and the CVV is
 * validated here but never transmitted or stored.
 */
export function PaymentMethodsSection({ initial }: { initial: PaymentMethodView[] }) {
  const [methods, setMethods] = useState<PaymentMethodView[]>(() => sortMethods(initial));
  const [adding, setAdding] = useState(false);
  const [form, setForm] = useState(EMPTY_FORM);
  const [banner, setBanner] = useState<NoticeData | null>(null);
  const [pending, setPending] = useState(false);
  // Per-card pending flag so a row's own buttons disable while it mutates.
  const [busyId, setBusyId] = useState<string | null>(null);

  const previewBrand = useMemo(
    () => (form.number ? detectCardBrand(form.number) : null),
    [form.number],
  );
  const atLimit = methods.length >= MAX_PAYMENT_METHODS;

  function set<K extends keyof typeof form>(key: K, value: string) {
    setForm((prev) => ({ ...prev, [key]: value }));
  }

  function openForm() {
    setBanner(null);
    setForm(EMPTY_FORM);
    setAdding(true);
  }

  function closeForm() {
    setAdding(false);
    setForm(EMPTY_FORM);
  }

  async function add(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBanner(null);

    // Validate on the client first for instant feedback (the server re-checks).
    const number = normalizeCardNumber(form.number);
    if (!luhnValid(number)) {
      setBanner({ type: "error", message: "Enter a valid card number." });
      return;
    }
    const [mm, yy] = form.expiry.split("/");
    const expMonth = Number(mm);
    const expYear = yy ? 2000 + Number(yy) : NaN;
    if (!Number.isInteger(expMonth) || expMonth < 1 || expMonth > 12 || !Number.isInteger(expYear)) {
      setBanner({ type: "error", message: "Enter a valid expiry date (MM/YY)." });
      return;
    }
    if (form.holderName.trim().length < 2) {
      setBanner({ type: "error", message: "Enter the name on the card." });
      return;
    }
    if (!/^\d{3,4}$/.test(form.cvv)) {
      setBanner({ type: "error", message: "Enter the 3- or 4-digit security code." });
      return;
    }

    setPending(true);
    try {
      // Note: `cvv` is deliberately NOT included in the request body.
      const res = await fetch("/api/account/payment-methods", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          number,
          expMonth,
          expYear,
          holderName: form.holderName.trim(),
          label: form.label.trim(),
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setBanner({ type: "error", message: data.error ?? "Could not save card." });
        return;
      }
      setMethods((prev) => sortMethods([...prev, data.paymentMethod as PaymentMethodView]));
      setBanner({ type: "success", message: "Payment method added." });
      closeForm();
    } catch {
      setBanner({ type: "error", message: "Network error. Please try again." });
    } finally {
      setPending(false);
    }
  }

  async function makeDefault(id: string) {
    setBanner(null);
    setBusyId(id);
    try {
      const res = await fetch("/api/account/payment-methods", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setBanner({ type: "error", message: data.error ?? "Could not update default." });
        return;
      }
      setMethods((prev) =>
        sortMethods(prev.map((m) => ({ ...m, isDefault: m.id === id }))),
      );
    } catch {
      setBanner({ type: "error", message: "Network error. Please try again." });
    } finally {
      setBusyId(null);
    }
  }

  async function remove(id: string) {
    setBanner(null);
    setBusyId(id);
    try {
      const res = await fetch("/api/account/payment-methods", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setBanner({ type: "error", message: data.error ?? "Could not remove card." });
        return;
      }
      const newDefaultId: string | null = data.newDefaultId ?? null;
      setMethods((prev) =>
        sortMethods(
          prev
            .filter((m) => m.id !== id)
            .map((m) => (newDefaultId && m.id === newDefaultId ? { ...m, isDefault: true } : m)),
        ),
      );
    } catch {
      setBanner({ type: "error", message: "Network error. Please try again." });
    } finally {
      setBusyId(null);
    }
  }

  return (
    <SettingsCard
      title="Payment Methods"
      subtitle="Save your personal cards for quick reference. We never store your full card number or security code."
    >
      {banner && <Notice notice={banner} />}

      {methods.length === 0 ? (
        <p className="rounded-xl border border-dashed border-line bg-background/40 px-4 py-6 text-center text-xs text-muted">
          No payment methods saved yet.
        </p>
      ) : (
        <ul className="flex flex-col gap-3">
          {methods.map((m) => {
            const busy = busyId === m.id;
            return (
              <li
                key={m.id}
                className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-line bg-background/40 p-4"
              >
                <div className="flex items-center gap-3">
                  <span className="flex h-9 w-12 shrink-0 items-center justify-center rounded-md border border-line bg-surface" aria-hidden>
                    <svg width="20" height="14" viewBox="0 0 24 16" fill="none" stroke="currentColor" strokeWidth="1.5" className="text-accent">
                      <rect x="0.75" y="0.75" width="22.5" height="14.5" rx="2" />
                      <path d="M1 5h22" />
                    </svg>
                  </span>
                  <div className="flex flex-col gap-0.5">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-sm font-semibold text-white">
                        {m.brand} •••• {m.last4}
                      </span>
                      {m.isDefault && (
                        <span className="rounded-full bg-accent/15 px-2 py-0.5 text-[11px] font-medium text-accent">
                          Default
                        </span>
                      )}
                      {m.expired && (
                        <span className="rounded-full bg-red-500/15 px-2 py-0.5 text-[11px] font-medium text-red-400">
                          Expired
                        </span>
                      )}
                    </div>
                    <span className="text-xs text-muted">
                      {m.holderName} · Expires {formatExpiry(m.expMonth, m.expYear)}
                      {m.label ? ` · ${m.label}` : ""}
                    </span>
                  </div>
                </div>

                <div className="flex items-center gap-3">
                  {!m.isDefault && (
                    <button
                      type="button"
                      onClick={() => makeDefault(m.id)}
                      disabled={busy}
                      className="text-xs font-semibold text-muted underline-offset-4 transition-colors hover:text-white hover:underline disabled:opacity-60"
                    >
                      Set default
                    </button>
                  )}
                  <DangerAction type="button" onClick={() => remove(m.id)} disabled={busy}>
                    {busy ? "…" : "Remove"}
                  </DangerAction>
                </div>
              </li>
            );
          })}
        </ul>
      )}

      {adding ? (
        <form
          onSubmit={add}
          className="flex flex-col gap-3 rounded-xl border border-line bg-background p-4"
          noValidate
        >
          <div className="flex flex-col gap-2">
            <label htmlFor="pm-number" className="text-xs leading-[18px] text-muted">
              Card Number {previewBrand && previewBrand !== "Card" && (
                <span className="text-accent">· {previewBrand}</span>
              )}
            </label>
            <input
              id="pm-number"
              inputMode="numeric"
              autoComplete="cc-number"
              placeholder="1234 5678 9012 3456"
              value={form.number}
              onChange={(e) => set("number", formatCardInput(e.target.value))}
              className="h-[42px] w-full rounded-lg border border-line bg-surface px-3 text-sm text-white placeholder-muted outline-none transition focus:border-accent"
            />
          </div>

          <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
            <TextField
              id="pm-holder"
              label="Name on Card"
              autoComplete="cc-name"
              placeholder="Jane Doe"
              value={form.holderName}
              onChange={(e) => set("holderName", e.target.value)}
            />
            <TextField
              id="pm-label"
              label="Label (optional)"
              placeholder="Personal Visa"
              value={form.label}
              onChange={(e) => set("label", e.target.value)}
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="flex w-full flex-col gap-2">
              <label htmlFor="pm-expiry" className="text-xs leading-[18px] text-muted">
                Expiry (MM/YY)
              </label>
              <input
                id="pm-expiry"
                inputMode="numeric"
                autoComplete="cc-exp"
                placeholder="MM/YY"
                value={form.expiry}
                onChange={(e) => set("expiry", formatExpiryInput(e.target.value))}
                className="h-[42px] w-full rounded-lg border border-line bg-surface px-3 text-sm text-white placeholder-muted outline-none transition focus:border-accent"
              />
            </div>
            <div className="flex w-full flex-col gap-2">
              <label htmlFor="pm-cvv" className="text-xs leading-[18px] text-muted">
                Security Code
              </label>
              <input
                id="pm-cvv"
                inputMode="numeric"
                autoComplete="cc-csc"
                placeholder="CVC"
                value={form.cvv}
                onChange={(e) => set("cvv", e.target.value.replace(/\D/g, "").slice(0, 4))}
                className="h-[42px] w-full rounded-lg border border-line bg-surface px-3 text-sm text-white placeholder-muted outline-none transition focus:border-accent"
              />
            </div>
          </div>

          <div className="flex items-center gap-3">
            <PrimaryAction type="submit" disabled={pending}>
              {pending ? "Saving…" : "Save Card"}
            </PrimaryAction>
            <button
              type="button"
              onClick={closeForm}
              className="text-sm text-muted transition-colors hover:text-white"
            >
              Cancel
            </button>
          </div>
        </form>
      ) : (
        <PrimaryAction type="button" onClick={openForm} disabled={atLimit}>
          Add Payment Method
        </PrimaryAction>
      )}

      {atLimit && !adding && (
        <p className="text-[11px] text-muted/70">
          You&apos;ve reached the limit of {MAX_PAYMENT_METHODS} saved cards.
        </p>
      )}
    </SettingsCard>
  );
}
