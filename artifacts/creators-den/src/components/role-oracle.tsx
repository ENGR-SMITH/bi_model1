import { useEffect, useRef, useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { oracleChat } from '@workspace/api-client-react';
import type { OracleMessage } from '@workspace/api-client-react';
import { Send, Sparkles } from 'lucide-react';

export type StudioLeg = 'SELECTS' | 'CUT' | 'SOUND' | 'FINISH';

const ROLE_PROMPTS: Record<StudioLeg, string> = {
  SELECTS:
    "You are the Story Architect's assistant in a video relay (Creators Den). " +
    'You help the architect turn raw footage + transcript into golden selects and a narrative spine ' +
    '(Hook → Setup → Core → Payoff → CTA). Answer concretely: give timecodes, quote the transcript, ' +
    'and suggest which lines to mark as selects. Keep answers under ~180 words unless asked for a plan.',
  CUT:
    "You are the Visual Editor's assistant in a video relay (Creators Den). " +
    'You help with precision cutting: trim decisions, camera switches, B-roll placement, pacing, ' +
    'and picture-lock checks. Refer to the timeline clips and beat markers when given. ' +
    'Suggest exact timecodes and cut points. Keep answers under ~180 words unless asked for a plan.',
  SOUND:
    "You are the Sound Designer's assistant in a video relay (Creators Den). " +
    'You help clean captured audio, place music, duck the score under speech, and schedule pickup ' +
    'voiceover. Talk in terms of audio passes (noise reduction, EQ, ducking, leveling), music in/out ' +
    'points, and timecodes. Keep answers under ~180 words unless asked for a plan.',
  FINISH:
    "You are the Motion & Color director's assistant in a video relay (Creators Den). " +
    'You help with color grading (LUT presets, exposure, warmth), captions, lower thirds, thumbnails, ' +
    'and export formats. Suggest concrete grade values and placements with timecodes. ' +
    'Keep answers under ~180 words unless asked for a plan.',
};

interface ChatMessage {
  role: 'user' | 'oracle';
  content: string;
  providerId?: string;
  modelId?: string;
  attempted?: string[];
}

export interface QuickAction {
  id: string;
  label: string;
  run: () => void;
  busy?: boolean;
}

export function RoleOracle({
  leg,
  roleName,
  context,
  quickActions = [],
  disabled = false,
  placeholder,
}: {
  leg: StudioLeg;
  roleName: string;
  context: string;
  quickActions?: QuickAction[];
  disabled?: boolean;
  placeholder?: string;
}) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState('');
  const scrollRef = useRef<HTMLDivElement>(null);

  const ask = useMutation({
    mutationFn: (history: OracleMessage[]) =>
      oracleChat({ messages: history, context: context || null, temperature: 0.6 }),
  });

  const send = (text: string) => {
    const trimmed = text.trim();
    if (!trimmed || ask.isPending) return;
    const history: OracleMessage[] = [
      { role: 'system', content: ROLE_PROMPTS[leg] },
      ...messages.map((m) => ({
        role: m.role === 'user' ? ('user' as const) : ('assistant' as const),
        content: m.content.slice(0, 4000),
      })),
      { role: 'user', content: trimmed.slice(0, 4000) },
    ];
    setMessages((prev) => [...prev, { role: 'user', content: trimmed }]);
    setInput('');
    ask.mutate(history, {
      onSuccess: (result) => {
        setMessages((prev) => [
          ...prev,
          { role: 'oracle', content: result.content, providerId: result.providerId, modelId: result.modelId, attempted: result.attempted },
        ]);
      },
      onError: () => {
        setMessages((prev) => [
          ...prev,
          { role: 'oracle', content: 'The oracle could not answer right now — check that an AI provider is configured (settings → providers), then try again.' },
        ]);
      },
    });
  };

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' });
  }, [messages.length, ask.isPending]);

  return (
    <div className="den-oracle" data-testid={`oracle-${leg}`}>
      <div className="den-oracle-head">
        <span className="eyebrow">
          <Sparkles size={13} />
          The {roleName}&apos;s oracle
        </span>
        <small>role-aware AI · {leg.toLowerCase()}</small>
      </div>

      <div className="den-oracle-messages" ref={scrollRef}>
        {messages.length === 0 && (
          <p className="den-oracle-empty">
            Ask anything about this {leg.toLowerCase()} pass — the oracle reads the current snapshot,
            the transcript, and the project. Try one of the quick prompts below.
          </p>
        )}
        {messages.map((message, index) => (
          <div key={index} className={`den-oracle-msg ${message.role}`}>
            {message.content}
            {message.providerId && (
              <span className="oracle-answer-meta">
                <span>
                  {message.providerId} · {message.modelId}
                </span>
                <small>oracle</small>
              </span>
            )}
          </div>
        ))}
        {ask.isPending && (
          <span className="den-oracle-pending">
            <Sparkles size={12} className="spin" />
            The oracle is thinking…
          </span>
        )}
      </div>

      {quickActions.length > 0 && (
        <div className="den-oracle-actions">
          {quickActions.map((action) => (
            <button
              key={action.id}
              type="button"
              className="den-oracle-chip"
              onClick={action.run}
              disabled={action.busy || ask.isPending || disabled}
              data-testid={`oracle-action-${action.id}`}
            >
              {action.busy ? <Sparkles size={10} className="spin" /> : <Sparkles size={10} />}
              {action.label}
            </button>
          ))}
        </div>
      )}

      <div className="den-oracle-compose">
        <textarea
          value={input}
          onChange={(event) => setInput(event.target.value)}
          placeholder={placeholder ?? `Ask the ${roleName.toLowerCase()} oracle…`}
          onKeyDown={(event) => {
            if (event.key === 'Enter' && !event.shiftKey) {
              event.preventDefault();
              send(input);
            }
          }}
          disabled={ask.isPending || disabled}
          data-testid={`oracle-input-${leg}`}
        />
        <button
          type="button"
          className="primary-btn"
          onClick={() => send(input)}
          disabled={ask.isPending || disabled || !input.trim()}
          data-testid={`oracle-send-${leg}`}
        >
          <Send size={13} />
          Ask
        </button>
      </div>
    </div>
  );
}

/** Renders an AI one-click result inside a page (provider meta + copy + actions). */
export function AiResult({
  title,
  meta,
  children,
  actions,
}: {
  title: string;
  meta?: { providerId: string; modelId: string; attempted?: string[] } | null;
  children: React.ReactNode;
  actions?: React.ReactNode;
}) {
  return (
    <div className="den-ai-result" data-testid="ai-result">
      <span className="oracle-answer-meta">
        <span>
          <Sparkles size={11} />
          {title}
        </span>
        {meta && <small>{meta.providerId} · {meta.modelId}</small>}
      </span>
      <div className="den-ai-copy">{children}</div>
      {actions && <div className="den-ai-actions">{actions}</div>}
    </div>
  );
}
