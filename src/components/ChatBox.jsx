import React, { useState, useRef, useEffect } from 'react';
import { Send, Bot, User, Sparkles, Trash2, AlertCircle, XCircle } from 'lucide-react';

const renderMessageContent = (text) => {
  if (!text) return null;

  // 1. Split by bold first
  const boldParts = text.split(/(\*\*[^*]+\*\*)/g);

  return boldParts.map((part, boldIdx) => {
    const isBold = part.startsWith('**') && part.endsWith('**');
    const content = isBold ? part.slice(2, -2) : part;

    // 2. Split by markdown link pattern [text](url)
    const linkParts = content.split(/(\[[^\]]+\]\([^)]+\))/g);

    const renderedLinkParts = linkParts.map((subPart, linkIdx) => {
      const match = subPart.match(/^\[([^\]]+)\]\(([^)]+)\)$/);
      if (match) {
        const linkText = match[1];
        const linkUrl = match[2];
        return (
          <a
            key={`${boldIdx}-${linkIdx}`}
            href={linkUrl}
            target="_blank"
            rel="noopener noreferrer"
            style={{ color: 'var(--primary-hover)', textDecoration: 'underline', fontWeight: '600' }}
          >
            {linkText}
          </a>
        );
      }
      return subPart;
    });

    if (isBold) {
      return (
        <strong key={boldIdx} style={{ fontWeight: '800', color: '#ffffff' }}>
          {renderedLinkParts}
        </strong>
      );
    }
    return <React.Fragment key={boldIdx}>{renderedLinkParts}</React.Fragment>;
  });
};

export default function ChatBox({ onClose }) {
  const [messages, setMessages] = useState(() => {
    try {
      const saved = sessionStorage.getItem('dubbs_chat_history');
      return saved ? JSON.parse(saved) : [];
    } catch (_) {
      return [];
    }
  });
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [config, setConfig] = useState(null);
  const [configLoading, setConfigLoading] = useState(true);

  const messagesEndRef = useRef(null);

  // Fetch config on mount
  useEffect(() => {
    const fetchConfig = async () => {
      try {
        const res = await fetch('/api/chat');
        if (res.ok) {
          const data = await res.json();
          setConfig(data);
        }
      } catch (err) {
        console.error('Error fetching chat config:', err);
      } finally {
        setConfigLoading(false);
      }
    };
    fetchConfig();
  }, []);

  const suggestionChips = [
    { text: "Which games did we do the worst on?", icon: "📉" },
    { text: "Who is leading in exact scores?", icon: "👑" },
    { text: "How many total cards have been shown?", icon: "🟨" },
    { text: "Summarize the standings", icon: "📊" }
  ];

  // Save history to sessionStorage
  useEffect(() => {
    try {
      sessionStorage.setItem('dubbs_chat_history', JSON.stringify(messages));
    } catch (_) {}
    scrollToBottom();
  }, [messages]);

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  const handleSend = async (textToSend) => {
    const query = (textToSend || input).trim();
    if (!query) return;

    if (!textToSend) setInput('');
    setError(null);

    const userMessage = { role: 'user', content: query };
    const updatedMessages = [...messages, userMessage];
    setMessages(updatedMessages);
    setLoading(true);

    try {
      const response = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ messages: updatedMessages })
      });

      const data = await response.json();
      if (!response.ok) {
        throw new Error(data.error || `Server error: ${response.status}`);
      }

      setMessages(prev => [...prev, { role: 'assistant', content: data.reply }]);
    } catch (err) {
      console.error('Chat error:', err);
      setError(err.message);
      // Remove the last message from user if it failed, or keep it and show error
    } finally {
      setLoading(false);
    }
  };

  const clearChat = () => {
    if (window.confirm("Are you sure you want to clear the chat history?")) {
      setMessages([]);
      setError(null);
    }
  };

  return (
    <div className="chat-container glass-panel" style={{ display: 'flex', flexDirection: 'column', height: '100%', minHeight: '100%', maxHeight: '100%', padding: '0', overflow: 'hidden', border: 'none' }}>
      
      {/* Chat Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '16px 20px', borderBottom: '1px solid var(--glass-border)', background: 'linear-gradient(135deg, rgba(139,92,246,0.08) 0%, rgba(99,102,241,0.04) 100%)' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
          <div style={{ width: '36px', height: '36px', borderRadius: '10px', background: 'rgba(139,92,246,0.15)', border: '1px solid rgba(139,92,246,0.3)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--primary)' }}>
            <Sparkles size={18} />
          </div>
          <div>
            <h3 style={{ fontSize: '15px', fontWeight: '800', margin: 0, display: 'flex', alignItems: 'center', gap: '6px' }}>
              Dubbs AI Assistant
            </h3>
            <span style={{ fontSize: '11px', color: 'var(--text-muted)' }}>
              {!configLoading && config?.model ? `Powered by ${config.model === 'gemini-2.5-flash' ? 'Gemini 2.5 Flash' : config.model}` : 'Powered by Gemini'}
            </span>
          </div>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          {!configLoading && config?.enabled && messages.length > 0 && (
            <button 
              onClick={clearChat}
              style={{ background: 'rgba(239, 68, 68, 0.05)', border: '1px solid rgba(239, 68, 68, 0.15)', color: '#ef4444', borderRadius: '8px', padding: '6px 10px', fontSize: '12px', fontWeight: '600', display: 'flex', alignItems: 'center', gap: '6px', cursor: 'pointer', transition: 'all 0.2s' }}
              title="Clear Chat History"
              className="chat-clear-btn"
            >
              <Trash2 size={13} />
              <span className="hide-mobile">Clear</span>
            </button>
          )}

          {onClose && (
            <button
              onClick={onClose}
              style={{ background: 'rgba(255, 255, 255, 0.05)', border: '1px solid var(--glass-border)', color: 'var(--text-primary)', borderRadius: '8px', width: '30px', height: '30px', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', transition: 'all 0.2s' }}
              title="Close Chat"
              className="chat-close-btn"
            >
              <XCircle size={16} />
            </button>
          )}
        </div>
      </div>

      {configLoading ? (
        <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '40px' }}>
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '16px' }}>
            <div className="btn-secondary animate-spin" style={{ width: '32px', height: '32px', borderRadius: '50%', border: '3px solid var(--glass-border)', borderTopColor: 'var(--primary)', background: 'transparent' }}></div>
            <span style={{ color: 'var(--text-secondary)', fontSize: '14px', fontWeight: '500' }}>Initializing AI Assistant...</span>
          </div>
        </div>
      ) : config && !config.enabled ? (
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: '40px', textAlign: 'center', overflowY: 'auto' }}>
          <div style={{ width: '64px', height: '64px', borderRadius: '50%', background: 'rgba(239, 68, 68, 0.08)', border: '1px solid rgba(239, 68, 68, 0.2)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#ef4444', marginBottom: '24px', boxShadow: '0 0 20px rgba(239, 68, 68, 0.1)', flexShrink: 0 }}>
            <AlertCircle size={32} />
          </div>
          <h3 style={{ fontSize: '20px', fontWeight: '800', margin: '0 0 12px 0' }}>AI Assistant Disabled</h3>
          <p style={{ fontSize: '14px', color: 'var(--text-muted)', maxWidth: '360px', lineHeight: '1.6', margin: '0 0 24px 0' }}>
            The Gemini AI chat box requires a Google AI Studio API Key to be configured in your Cloudflare dashboard environment variables.
          </p>
          <div style={{ background: 'rgba(255, 255, 255, 0.02)', border: '1px solid var(--glass-border)', borderRadius: '12px', padding: '16px 20px', textAlign: 'left', maxWidth: '440px', fontSize: '13px', fontFamily: 'monospace', color: 'var(--text-secondary)' }}>
            <span style={{ color: 'var(--primary)', fontWeight: '700' }}># Environment variables to set:</span><br />
            GEMINI_API_KEY="AIzaSy..."
          </div>
        </div>
      ) : (
        <>
          {/* Messages Pane */}
          <div style={{ flex: 1, padding: '20px', overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '16px' }} className="chat-messages-pane">
            
            {messages.length === 0 && (
              <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '100%', gap: '20px', padding: '20px 0', textAlign: 'center' }}>
                <div style={{ width: '60px', height: '60px', borderRadius: '50%', background: 'rgba(139,92,246,0.08)', border: '1px solid rgba(139,92,246,0.2)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--primary)', boxShadow: '0 0 20px rgba(139,92,246,0.15)' }}>
                  <Bot size={30} />
                </div>
                <div>
                  <h4 style={{ margin: '0 0 8px 0', fontSize: '18px', fontWeight: '800' }}>Ask about our pool!</h4>
                  <p style={{ margin: 0, fontSize: '13px', color: 'var(--text-muted)', maxWidth: '280px', lineHeight: '1.5' }}>
                    Ask me who is winning, who got exact scores, which games were the most hard-fought, or how many goals a team scored.
                  </p>
                </div>
              </div>
            )}

            {messages.map((msg, index) => {
              const isUser = msg.role === 'user';
              return (
                <div 
                  key={index}
                  style={{ 
                    maxWidth: '92%',
                    alignSelf: isUser ? 'flex-end' : 'flex-start'
                  }}
                >
                  {/* Bubble */}
                  <div 
                    style={{ 
                      background: isUser 
                        ? 'linear-gradient(135deg, rgba(139,92,246,0.2) 0%, rgba(99,102,241,0.2) 100%)' 
                        : 'rgba(255,255,255,0.03)',
                      border: isUser 
                        ? '1px solid rgba(139,92,246,0.3)' 
                        : '1px solid var(--glass-border)',
                      borderRadius: isUser ? '16px 16px 2px 16px' : '16px 16px 16px 2px',
                      padding: '12px 16px',
                      fontSize: '14px',
                      lineHeight: '1.5',
                      color: 'var(--text-primary)',
                      whiteSpace: 'pre-wrap',
                      wordBreak: 'break-word',
                      boxShadow: isUser ? 'var(--shadow-glow)' : 'none'
                    }}
                    className={isUser ? 'chat-bubble-user' : 'chat-bubble-assistant'}
                  >
                    {renderMessageContent(msg.content)}
                  </div>
                </div>
              );
            })}

            {/* Typing Loader */}
            {loading && (
              <div style={{ alignSelf: 'flex-start' }}>
                <div style={{ background: 'rgba(255,255,255,0.02)', border: '1px solid var(--glass-border)', borderRadius: '16px 16px 16px 2px', padding: '12px 20px', display: 'flex', gap: '6px', alignItems: 'center' }}>
                  <span className="chat-dot" style={{ width: '6px', height: '6px', background: 'var(--primary)', borderRadius: '50%', display: 'inline-block', animation: 'chatDotBounce 1.4s infinite ease-in-out both' }}></span>
                  <span className="chat-dot" style={{ width: '6px', height: '6px', background: 'var(--primary)', borderRadius: '50%', display: 'inline-block', animation: 'chatDotBounce 1.4s infinite ease-in-out both', animationDelay: '0.2s' }}></span>
                  <span className="chat-dot" style={{ width: '6px', height: '6px', background: 'var(--primary)', borderRadius: '50%', display: 'inline-block', animation: 'chatDotBounce 1.4s infinite ease-in-out both', animationDelay: '0.4s' }}></span>
                </div>
              </div>
            )}

            {/* Error Alert */}
            {error && (
              <div className="glass-panel" style={{ background: 'rgba(239, 68, 68, 0.08)', border: '1px solid rgba(239, 68, 68, 0.25)', borderRadius: '12px', padding: '14px 16px', display: 'flex', gap: '12px', alignItems: 'flex-start', color: '#ef4444', alignSelf: 'stretch', fontSize: '13px' }}>
                <AlertCircle size={18} style={{ flexShrink: 0, marginTop: '1px' }} />
                <div style={{ flex: 1 }}>
                  <strong style={{ display: 'block', marginBottom: '4px' }}>Chat Error</strong>
                  {error}
                </div>
              </div>
            )}

            <div ref={messagesEndRef} />
          </div>

          {/* Suggestion Chips */}
          {messages.length === 0 && (
            <div style={{ padding: '0 20px 10px 20px', display: 'flex', gap: '8px', flexWrap: 'wrap', justifyContent: 'center' }}>
              {suggestionChips.map((chip, idx) => (
                <button
                  key={idx}
                  onClick={() => handleSend(chip.text)}
                  className="chat-suggestion-chip"
                  style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid var(--glass-border)', color: 'var(--text-secondary)', borderRadius: '10px', padding: '8px 12px', fontSize: '12px', fontWeight: '600', display: 'flex', alignItems: 'center', gap: '6px', cursor: 'pointer', transition: 'all 0.2s' }}
                >
                  <span>{chip.icon}</span>
                  <span>{chip.text}</span>
                </button>
              ))}
            </div>
          )}

          {/* Input Bar */}
          <div style={{ padding: '16px 20px 20px 20px', borderTop: '1px solid var(--glass-border)', background: 'rgba(9,6,20,0.5)' }}>
            <form 
              onSubmit={(e) => { e.preventDefault(); handleSend(); }}
              style={{ display: 'flex', gap: '10px', alignItems: 'center' }}
            >
              <input
                type="text"
                value={input}
                onChange={(e) => setInput(e.target.value)}
                placeholder="Ask AI about predictions or match results..."
                disabled={loading}
                style={{ flex: 1, padding: '12px 16px', background: 'rgba(255,255,255,0.03)', border: '1px solid var(--glass-border)', borderRadius: '10px', color: 'var(--text-primary)', fontSize: '14px', outline: 'none', transition: 'border-color 0.2s' }}
                className="chat-input-field"
              />
              <button
                type="submit"
                disabled={loading || !input.trim()}
                style={{ width: '44px', height: '44px', borderRadius: '10px', background: (!input.trim() || loading) ? 'rgba(255,255,255,0.03)' : 'linear-gradient(135deg, var(--primary) 0%, var(--secondary) 100%)', border: 'none', color: '#ffffff', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: (!input.trim() || loading) ? 'default' : 'pointer', transition: 'all 0.25s', boxShadow: (!input.trim() || loading) ? 'none' : '0 4px 14px rgba(139, 92, 246, 0.4), var(--shadow-glow)' }}
                className="chat-submit-btn"
              >
                <Send size={16} />
              </button>
            </form>
          </div>
        </>
      )}
    </div>
  );
}
