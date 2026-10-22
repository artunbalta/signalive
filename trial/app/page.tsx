import Image from "next/image";
import { LanguageSwitch } from "@/components/LanguageSwitch";
import { SignalBand } from "@/components/landing/SignalBand";
import { StartButton } from "@/components/landing/StartButton";
import { getRequestMessages } from "@/lib/i18n/server";

export default async function Landing({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { messages: m } = await getRequestMessages();
  const deleted = (await searchParams).deleted === "1";
  return (
    <main className="relative z-10 mx-auto flex min-h-[100dvh] max-w-[1180px] flex-col px-5 pb-8 pt-[max(20px,env(safe-area-inset-top))] sm:px-10">
      <header className="flex items-center justify-between py-3">
        <Image src="/brand/wordmark-light.png" alt="Signalive" width={150} height={13} priority className="h-auto w-[132px] sm:w-[150px]" />
        <LanguageSwitch />
      </header>

      <section className="flex flex-1 flex-col justify-center py-10 sm:py-16">
        {deleted ? (
          <p role="status" className="mb-8 max-w-xl rounded-[12px] border border-[var(--hairline-strong)] px-4 py-3 text-[0.95rem]">
            {m.settings.deleted}
          </p>
        ) : null}
        <p className="t-label rise">{m.landing.eyebrow}</p>
        <h1 className="t-display rise rise-1 mt-4 max-w-[13ch] text-[clamp(2.6rem,8.5vw,5.6rem)]">{m.landing.title}</h1>
        <p className="rise rise-2 mt-6 max-w-[36rem] text-[1.08rem] leading-relaxed text-mist sm:text-[1.15rem]">
          {m.landing.lead}
        </p>
        <div className="rise rise-3 mt-9">
          <StartButton />
        </div>
        <ol className="rise rise-4 mt-12 grid max-w-3xl gap-4 border-t border-[var(--hairline)] pt-5 sm:grid-cols-3">
          {m.landing.steps.map((step, i) => (
            <li key={step} className="flex items-baseline gap-3">
              <span className="t-mono text-[0.75rem] text-fog">{String(i + 1).padStart(2, "0")}</span>
              <span className="text-[0.95rem]">{step}</span>
            </li>
          ))}
        </ol>
      </section>

      <SignalBand />

      <footer className="mt-4 flex flex-col gap-3 text-[0.82rem] text-fog sm:flex-row sm:items-center sm:justify-between">
        <p className="max-w-xl">{m.landing.fine}</p>
        <a href="https://signalive.com" className="text-mist underline-offset-4 hover:text-paper hover:underline">
          {m.landing.marketing}
        </a>
      </footer>
    </main>
  );
}
