import { isValidElement, memo, useState, type ReactNode } from "react";
import ReactMarkdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";
import { button, text } from "../ui.ts";
import { Icon } from "./Icon.tsx";

function textOf(node: ReactNode): string {
  if (typeof node === "string" || typeof node === "number") {
    return String(node);
  }
  if (Array.isArray(node)) {
    return node.map(textOf).join("");
  }
  if (isValidElement<{ children?: ReactNode }>(node)) {
    return textOf(node.props.children);
  }
  return "";
}

function languageOf(node: ReactNode): string | null {
  if (isValidElement<{ className?: string }>(node)) {
    return /language-([\w+-]+)/.exec(node.props.className ?? "")?.[1] ?? null;
  }
  return null;
}

function CodeBlock({ children }: { readonly children?: ReactNode }) {
  const [copied, setCopied] = useState(false);
  const code = textOf(children).replace(/\n$/, "");
  const language = languageOf(children);

  async function copy() {
    await navigator.clipboard.writeText(code);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }

  return (
    <div className="my-3 overflow-hidden rounded-control border border-line bg-sunken">
      <div className={`flex items-center justify-between border-b border-line-subtle px-3 py-1 ${text.detail}`}>
        <span className="text-ink-faint">{language ?? "code"}</span>
        <button type="button" onClick={() => void copy()} className={`${button.ghost} px-1.5 py-0.5 text-[11.5px]`}>
          <Icon name={copied ? "check" : "copy"} />
          <span>{copied ? "Copied" : "Copy"}</span>
        </button>
      </div>
      <pre className="overflow-x-auto px-3.5 py-3 text-[12.5px] leading-relaxed text-ink">
        <code>{code}</code>
      </pre>
    </div>
  );
}

function components(onOpenLink: (url: string) => void): Components {
  return {
    p: ({ children }) => <p className="my-2 first:mt-0 last:mb-0">{children}</p>,
    ul: ({ children }) => <ul className="my-2 list-disc space-y-1 pl-5 marker:text-ink-faint">{children}</ul>,
    ol: ({ children }) => <ol className="my-2 list-decimal space-y-1 pl-5 marker:text-ink-faint">{children}</ol>,
    h1: ({ children }) => <h3 className={`mt-4 mb-2 first:mt-0 ${text.section}`}>{children}</h3>,
    h2: ({ children }) => <h3 className={`mt-4 mb-2 first:mt-0 ${text.section}`}>{children}</h3>,
    h3: ({ children }) => <h4 className="mt-3 mb-1.5 font-semibold text-ink first:mt-0">{children}</h4>,
    strong: ({ children }) => <strong className="font-semibold text-ink">{children}</strong>,
    blockquote: ({ children }) => <blockquote className="my-2 border-l-2 border-line-strong pl-3 text-ink-muted">{children}</blockquote>,
    hr: () => <hr className="my-4 border-line-subtle" />,
    pre: ({ children }) => <CodeBlock>{children}</CodeBlock>,
    code: ({ className, children }) => (
      <code className={`rounded-tag bg-surface-3 px-1 py-px text-[12.5px] text-green-300 ${className ?? ""}`}>{children}</code>
    ),
    table: ({ children }) => (
      <div className="my-3 overflow-x-auto">
        <table className="w-full border-collapse text-[13px]">{children}</table>
      </div>
    ),
    th: ({ children }) => <th className="border border-line px-2.5 py-1.5 text-left font-semibold text-ink">{children}</th>,
    td: ({ children }) => <td className="border border-line px-2.5 py-1.5">{children}</td>,
    a: ({ href, children }) => (
      <a
        href={href}
        onClick={(event) => {
          event.preventDefault();
          if (href !== undefined) {
            onOpenLink(href);
          }
        }}
        className="text-green-300 underline decoration-line-strong underline-offset-2 hover:decoration-green-400"
      >
        {children}
      </a>
    ),
    img: ({ alt }) => <span className="text-ink-faint">{alt ?? ""}</span>,
  };
}

export interface MarkdownProps {
  readonly source: string;
  readonly onOpenLink: (url: string) => void;
}

export const Markdown = memo(function Markdown({ source, onOpenLink }: MarkdownProps) {
  return (
    <div className="min-w-0 break-words text-ink">
      <ReactMarkdown remarkPlugins={[remarkGfm]} components={components(onOpenLink)} skipHtml>
        {source}
      </ReactMarkdown>
    </div>
  );
});
