import { useRef } from "react";

const suggestions = [
  [
    "Review my portfolio",
    "Review my positions, concentration, and biggest risks today.",
  ],
  [
    "Plan a trade",
    "Build a risk-defined plan for NVDA without placing an order.",
  ],
  [
    "Explain today's move",
    "Explain what is driving my portfolio today in plain language.",
  ],
] as const;

function choose(value: string) {
  const prompt = document.querySelector<HTMLTextAreaElement>("#prompt");
  if (!prompt) return;
  const setter = Object.getOwnPropertyDescriptor(
    HTMLTextAreaElement.prototype,
    "value",
  )?.set;
  setter?.call(prompt, value);
  prompt.dispatchEvent(new Event("input", { bubbles: true }));
  prompt.focus();
}

export function Welcome() {
  const section = useRef<HTMLElement>(null);
  return (
    <section className="welcome" ref={section}>
      <p className="welcome-kicker">Trishula chat</p>
      <h1>What are you watching?</h1>
      <p>
        Ask about your portfolio, a market move, or a trade idea. Trishula shows
        the tools it uses and keeps the final decision in your hands.
      </p>
      <div className="suggestions">
        {suggestions.map(([title, prompt]) => (
          <button type="button" key={title} onClick={() => choose(prompt)}>
            <strong>{title}</strong>
            <span>{prompt}</span>
          </button>
        ))}
      </div>
    </section>
  );
}
