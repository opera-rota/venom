import { LogoMark } from "./components/Header.tsx";
import { Onboarding } from "./components/Onboarding.tsx";
import { Workspace } from "./components/Workspace.tsx";
import { useAuth } from "./use-auth.ts";

export function App() {
  const auth = useAuth(window.venom);

  switch (auth.kind) {
    case "loading":
      return (
        <main className="flex h-full items-center justify-center" aria-busy="true">
          <LogoMark size={48} />
        </main>
      );
    case "signed_out":
      return <Onboarding bridge={window.venom} notice={auth.notice} />;
    case "signed_in":
      return <Workspace key={auth.device.id} bridge={window.venom} account={auth.account} device={auth.device} />;
  }
}
