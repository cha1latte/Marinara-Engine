// ──────────────────────────────────────────────
// CYOA Choices — interactive choice buttons after assistant messages
// ──────────────────────────────────────────────
import { useCallback } from "react";
import { Sparkles } from "lucide-react";
import { useAgentStore } from "../../stores/agent.store";
import { useGenerate } from "../../hooks/use-generate";
import { useChatStore } from "../../stores/chat.store";

export function CyoaChoices() {
  const choices = useAgentStore((s) => s.cyoaChoices);
  const clearCyoaChoices = useAgentStore((s) => s.clearCyoaChoices);
  const { generate } = useGenerate();
  const activeChatId = useChatStore((s) => s.activeChatId);
  const isStreaming = useChatStore((s) => s.isStreaming);

  const handleChoice = useCallback(
    async (text: string) => {
      if (!activeChatId || isStreaming) return;
      clearCyoaChoices();
      await generate({
        chatId: activeChatId,
        connectionId: null,
        userMessage: text,
      });
    },
    [activeChatId, isStreaming, clearCyoaChoices, generate],
  );

  if (choices.length === 0) return null;

  return (
    <div className="flex flex-col items-center gap-2 px-4 py-3 animate-message-in">
      <div className="flex items-center gap-1.5 text-[0.625rem] text-white/30">
        <Sparkles size="0.625rem" />
        <span>What will you do?</span>
      </div>
      <div className="flex flex-wrap justify-center gap-2 max-w-[85%]">
        {choices.map((choice, i) => (
          <button
            key={i}
            onClick={() => handleChoice(choice.text)}
            disabled={isStreaming}
            className="group relative rounded-xl border border-white/10 bg-black/50 px-4 py-2.5 text-left backdrop-blur-md transition-all hover:border-purple-400/40 hover:bg-purple-500/10 hover:shadow-lg hover:shadow-purple-500/5 active:scale-[0.98] disabled:opacity-50"
          >
            <span className="block text-[0.6875rem] font-semibold text-purple-300/90 group-hover:text-purple-200">
              {choice.label}
            </span>
            <span className="mt-0.5 block text-[0.625rem] leading-relaxed text-white/50 group-hover:text-white/70">
              {choice.text}
            </span>
          </button>
        ))}
      </div>
    </div>
  );
}
