import { useId, useState, type FormEvent, type ReactNode } from "react";
import type { StepResult, VenomBridge } from "../../../shared/bridge.ts";
import { button, field, surface, text } from "../ui.ts";
import { LogoMark } from "./Header.tsx";
import { Icon } from "./Icon.tsx";

type Step = "welcome" | "signup-details" | "signup-code" | "signup-secret" | "attach-details" | "attach-code";

interface FieldProps {
  readonly label: string;
  readonly hint?: string;
  readonly invalid: boolean;
  readonly children: (id: string, describedBy: string | undefined) => ReactNode;
}

function Field({ label, hint, invalid, children }: FieldProps) {
  const id = useId();
  const hintId = hint === undefined ? undefined : `${id}-hint`;
  return (
    <div className="flex flex-col gap-1.5" data-invalid={invalid}>
      <label htmlFor={id} className={field.label}>
        {label}
      </label>
      {children(id, hintId)}
      {hint !== undefined && (
        <p id={hintId} className={field.hint}>
          {hint}
        </p>
      )}
    </div>
  );
}

interface StepFrameProps {
  readonly title: string;
  readonly intro: ReactNode;
  readonly error: string | null;
  readonly busy: boolean;
  readonly action: string;
  readonly onSubmit: () => void;
  readonly onBack?: () => void;
  readonly children: ReactNode;
}

function StepFrame({ title, intro, error, busy, action, onSubmit, onBack, children }: StepFrameProps) {
  function submit(event: FormEvent) {
    event.preventDefault();
    if (!busy) {
      onSubmit();
    }
  }

  return (
    <form onSubmit={submit} className={`flex w-full max-w-[420px] flex-col gap-5 p-6 ${surface.card}`} noValidate>
      <div className="flex flex-col gap-2">
        {onBack !== undefined && (
          <button type="button" onClick={onBack} className={`${button.ghost} -ml-3 self-start`}>
            <Icon name="back" />
            <span>Back</span>
          </button>
        )}
        <h2 className={text.title}>{title}</h2>
        <p className={text.support}>{intro}</p>
      </div>
      {children}
      {error !== null && (
        <p role="alert" className={field.error}>
          <Icon name="cross" className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          <span>{error}</span>
        </p>
      )}
      <button type="submit" disabled={busy} className={button.primary}>
        {busy ? "Working" : action}
      </button>
    </form>
  );
}

export function Onboarding({ bridge, notice }: { readonly bridge: VenomBridge; readonly notice: string | null }) {
  const [step, setStep] = useState<Step>("welcome");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [secretWord, setSecretWord] = useState("");
  const [repeated, setRepeated] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function go(next: Step) {
    setError(null);
    setCode("");
    setSecretWord("");
    setRepeated("");
    setStep(next);
  }

  function restart() {
    void bridge.cancelOnboarding();
    go("welcome");
  }

  async function run(work: () => Promise<StepResult>, next: Step | null) {
    setBusy(true);
    setError(null);
    const result = await work().catch((): StepResult => ({
      ok: false,
      code: "internal",
      reason: "Something went wrong on this computer. Please try again.",
    }));
    setBusy(false);
    if (!result.ok) {
      if (result.code === "challenge_expired") {
        void bridge.cancelOnboarding();
        go(step.startsWith("signup") ? "signup-details" : "attach-details");
      }
      setError(result.reason);
      return;
    }
    if (next !== null) {
      go(next);
    }
  }

  const invalid = error !== null;

  if (step === "welcome") {
    return (
      <Centered>
        <div className="flex w-full max-w-[420px] flex-col items-center gap-6 text-center">
          <LogoMark size={64} />
          <div className="flex flex-col gap-2">
            <h1 className={text.display}>VENOM</h1>
            <p className={text.support}>One assistant, every device. Create your VENOM on this computer, or add this computer to the VENOM you already have.</p>
          </div>
          {notice !== null && (
            <p role="status" className={`flex w-full items-start gap-2 p-3 text-left ${surface.card} ${text.support}`}>
              <Icon name="warning" className="mt-0.5 h-3.5 w-3.5 shrink-0 text-status-wait" />
              <span>{notice}</span>
            </p>
          )}
          <div className="flex w-full flex-col gap-3">
            <button type="button" className={button.primary} onClick={() => go("signup-details")}>
              <Icon name="plus" />
              <span>Create my VENOM</span>
            </button>
            <button type="button" className={button.secondary} onClick={() => go("attach-details")}>
              <Icon name="devices" />
              <span>Attach this device</span>
            </button>
          </div>
        </div>
      </Centered>
    );
  }

  if (step === "signup-details") {
    return (
      <Centered>
        <StepFrame
          title="Create your VENOM"
          intro="VENOM will email you a 6-number code to confirm the address."
          error={error}
          busy={busy}
          action="Send me a code"
          onBack={restart}
          onSubmit={() => void run(() => bridge.signup.start(name, email), "signup-code")}
        >
          <Field label="Your name" invalid={invalid}>
            {(id) => <input id={id} autoFocus autoComplete="name" value={name} onChange={(event) => setName(event.target.value)} className={field.text} />}
          </Field>
          <Field label="Email" invalid={invalid}>
            {(id) => (
              <input id={id} type="email" autoComplete="email" value={email} onChange={(event) => setEmail(event.target.value)} className={field.text} />
            )}
          </Field>
        </StepFrame>
      </Centered>
    );
  }

  if (step === "signup-code" || step === "attach-code") {
    const signup = step === "signup-code";
    return (
      <Centered>
        <StepFrame
          title="Check your email"
          intro={
            <>
              We sent a 6-number code to <span className="text-green-400">{email.trim()}</span>. It works once and expires in 10 minutes.
            </>
          }
          error={error}
          busy={busy}
          action={signup ? "Confirm email" : "Attach this device"}
          onBack={restart}
          onSubmit={() =>
            void (signup ? run(() => bridge.signup.verify(code), "signup-secret") : run(() => bridge.attach.confirm(code), null))
          }
        >
          <Field label="Code" invalid={invalid}>
            {(id) => (
              <input
                id={id}
                autoFocus
                inputMode="numeric"
                autoComplete="one-time-code"
                maxLength={6}
                placeholder="000000"
                value={code}
                aria-invalid={invalid}
                onChange={(event) => setCode(event.target.value.replace(/\D/g, ""))}
                className={field.code}
              />
            )}
          </Field>
        </StepFrame>
      </Centered>
    );
  }

  if (step === "signup-secret") {
    return (
      <Centered>
        <StepFrame
          title="Choose your secret word"
          intro="You will use it to add your other devices. It never leaves this computer: VENOM only receives a proof that you know it."
          error={error}
          busy={busy}
          action="Create my VENOM"
          onBack={restart}
          onSubmit={() => void run(() => bridge.signup.secretWord(secretWord, repeated), null)}
        >
          <Field label="Secret word or phrase" hint="At least 8 characters. A short phrase you can say out loud works well." invalid={invalid}>
            {(id, describedBy) => (
              <input
                id={id}
                type="password"
                autoFocus
                autoComplete="new-password"
                aria-describedby={describedBy}
                value={secretWord}
                onChange={(event) => setSecretWord(event.target.value)}
                className={field.text}
              />
            )}
          </Field>
          <Field label="Type it again" invalid={invalid}>
            {(id) => (
              <input
                id={id}
                type="password"
                autoComplete="new-password"
                value={repeated}
                onChange={(event) => setRepeated(event.target.value)}
                className={field.text}
              />
            )}
          </Field>
        </StepFrame>
      </Centered>
    );
  }

  return (
    <Centered>
      <StepFrame
        title="Attach this device"
        intro="Use the email and secret word of your VENOM. Then confirm with the code VENOM emails you."
        error={error}
        busy={busy}
        action="Continue"
        onBack={restart}
        onSubmit={() => void run(() => bridge.attach.start(email, secretWord), "attach-code")}
      >
        <Field label="Email" invalid={invalid}>
          {(id) => (
            <input id={id} type="email" autoFocus autoComplete="email" value={email} onChange={(event) => setEmail(event.target.value)} className={field.text} />
          )}
        </Field>
        <Field label="Secret word" invalid={invalid}>
          {(id) => (
            <input
              id={id}
              type="password"
              autoComplete="current-password"
              value={secretWord}
              onChange={(event) => setSecretWord(event.target.value)}
              className={field.text}
            />
          )}
        </Field>
      </StepFrame>
    </Centered>
  );
}

function Centered({ children }: { readonly children: ReactNode }) {
  return <main className="flex h-full items-center justify-center overflow-y-auto px-4 py-10">{children}</main>;
}
