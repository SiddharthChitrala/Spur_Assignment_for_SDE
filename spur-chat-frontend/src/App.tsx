import React, { useState, useEffect, useRef } from 'react';
import axios from 'axios';
import { Send, Bot, User, RefreshCw, MessageSquare, ShoppingBag, Download, Trash } from 'lucide-react';
import './App.css';

const API_URL = process.env.REACT_APP_API_URL || 'http://localhost:3001/api';

interface Message {
  id: string;
  sender: 'user' | 'ai';
  text: string;
  createdAt?: string;
  modelUsed?: string;
  timestamp: string;
}

interface Conversation {
  id: string;
  createdAt: string;
}

function App() {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [conversationId, setConversationId] = useState<string>('');
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [error, setError] = useState<string>('');
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  // Load conversations and current conversation
  useEffect(() => {
    loadConversations();
    const savedId = localStorage.getItem('current_conversation_id');
    if (savedId) {
      setConversationId(savedId);
      loadHistory(savedId);
    }
  }, []);

  // Focus input on load
  useEffect(() => {
    if (inputRef.current) {
      inputRef.current.focus();
    }
  }, []);

  // Scroll to bottom when messages change
  useEffect(() => {
    scrollToBottom();
  }, [messages]);

  const loadConversations = async () => {
    try {
      // Prefer server-sourced list so multi-device works. Fallback to localStorage for older sessions.
      // TODO: add pagination if this becomes large
      const url = `${API_URL.replace('/api','')}/api/conversations`.replace('//api','/api');
      const resp = await axios.get(url);
      if (resp?.data?.conversations) {
        setConversations(resp.data.conversations);
        // keep a local cache for offline dev / fallback
        try { localStorage.setItem('chat_conversations', JSON.stringify(resp.data.conversations)); } catch (e) { /* ignore storage errors */ }
        return;
      }

      // fallback: previous behavior
      const savedConversations = localStorage.getItem('chat_conversations');
      if (savedConversations) {
        setConversations(JSON.parse(savedConversations));
      }
    } catch (error) {
      // If backend is not available, silently fallback to localStorage
      console.warn('Could not fetch conversations from server, using saved list. Error:', (error as any)?.message || error);
      const savedConversations = localStorage.getItem('chat_conversations');
      if (savedConversations) {
        setConversations(JSON.parse(savedConversations));
      }
    }
  };

  const createConversation = async () => {
    try {
      const response = await axios.post(`${API_URL}/conversation`);
      const { conversationId } = response.data;
      
      setConversationId(conversationId);
      localStorage.setItem('current_conversation_id', conversationId);
      
      // Add to conversations list
      const newConversation: Conversation = {
        id: conversationId,
        createdAt: new Date().toISOString()
      };
      
      const updatedConversations = [newConversation, ...conversations];
      setConversations(updatedConversations);
      localStorage.setItem('chat_conversations', JSON.stringify(updatedConversations));
      
      // Clear previous messages
      setMessages([]);
      setError('');
      
    } catch (error) {
      console.error('Failed to create conversation:', error);
      setError('Failed to start new conversation');
    }
  };

  const loadHistory = async (id: string) => {
    try {
      const response = await axios.get(`${API_URL}/conversation/${id}`);
      if (response.data.messages) {
        const formattedMessages: Message[] = response.data.messages.map((msg: any) => ({
          id: msg.id,
          sender: msg.sender,
          text: msg.text,
          timestamp: msg.created_at,
          modelUsed: msg.modelUsed
        }));
        setMessages(formattedMessages);
      }
      setError('');
    } catch (error) {
      console.error('Failed to load history:', error);
      setError('Failed to load conversation history');
    }
  };

  const sendMessage = async () => {
    if (!input.trim() || loading) return;

    const userMessage: Message = {
      id: Date.now().toString(),
      sender: 'user',
      text: input.trim(),
      timestamp: new Date().toISOString()
    };

    setMessages(prev => [...prev, userMessage]);
    setInput('');
    setLoading(true);
    setError('');

    try {
      const response = await axios.post(`${API_URL}/message`, {
        message: userMessage.text,
        conversationId: conversationId || undefined
      });

      const aiMessage: Message = {
        id: (Date.now() + 1).toString(),
        sender: 'ai',
        text: response.data.reply,
        modelUsed: response.data.modelUsed,
        timestamp: new Date().toISOString()
      };

      // If this is a new conversation, save the ID
      if (response.data.conversationId && !conversationId) {
        const newId = response.data.conversationId;
        setConversationId(newId);
        localStorage.setItem('current_conversation_id', newId);
        
        const newConversation: Conversation = {
          id: newId,
          createdAt: new Date().toISOString()
        };
        
        const updatedConversations = [newConversation, ...conversations];
        setConversations(updatedConversations);
        localStorage.setItem('chat_conversations', JSON.stringify(updatedConversations));
      }

      setMessages(prev => [...prev, aiMessage]);

    } catch (error: any) {
      console.error('Error:', error);
      
      const errorText = error.response?.data?.error || 
                       error.response?.data?.reply || 
                       'Sorry, something went wrong. Please try again.';
      
      setError(errorText);
      
      const errorMessage: Message = {
        id: (Date.now() + 1).toString(),
        sender: 'ai',
        text: errorText,
        timestamp: new Date().toISOString()
      };

      setMessages(prev => [...prev, errorMessage]);
    } finally {
      setLoading(false);
      if (inputRef.current) {
        inputRef.current.focus();
      }
    }
  };

  const scrollToBottom = () => {
    const el = messagesEndRef.current as any;
    if (el && typeof el.scrollIntoView === 'function') {
      el.scrollIntoView({ behavior: 'smooth' });
    }
  };

  const handleKeyPress = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  };

  const formatTime = (timestamp: string) => {
    const date = new Date(timestamp);
    return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  };

  const clearChat = () => {
    setMessages([]);
    createConversation();
  };

  // helper to set conversation in one place (refactored halfway)
  const setActiveConversation = (id: string) => {
    // unify setting + storage + loading history
    setConversationId(id);
    localStorage.setItem('current_conversation_id', id);
    loadHistory(id);
  };

  // Export the current conversation as a JSON file
  const exportConversation = async () => {
    if (!conversationId) {
      setError('No conversation selected to export');
      return;
    }
    // being overly cautious - double check
    if (!conversationId) return;

    setLoading(true);
    try {
      const resp = await axios.get(`${API_URL}/conversation/${conversationId}/export`);
      // NOTE: server sends JSON; create a blob for download (works in browsers)
      const blob = new Blob([JSON.stringify(resp.data, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `conversation-${conversationId.substring(0,8)}.json`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
      // small debug message, remove later maybe
      console.log('Exported conversation', conversationId);
    } catch (error) {
      console.error('Export failed:', error);
      setError('Failed to export conversation');
    } finally {
      setLoading(false);
    }
  };

  // Delete the current conversation (we show a nice in-app confirm dialog instead of browser confirm)
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);

  const promptDeleteConversation = () => {
    if (!conversationId) {
      setError('No conversation selected to delete');
      return;
    }
    // show our custom popover
    setShowDeleteConfirm(true);
  };

  const confirmDeleteConversation = async () => {
    // user confirmed, proceed to delete
    setShowDeleteConfirm(false);
    setLoading(true); // small redundancy but keeps UI consistent

    try {
      await axios.delete(`${API_URL}/conversation/${conversationId}`);
      const remaining = conversations.filter(c => c.id !== conversationId);
      setConversations(remaining);
      localStorage.setItem('chat_conversations', JSON.stringify(remaining));

      // unselect and clear
      setConversationId('');
      localStorage.removeItem('current_conversation_id');
      setMessages([]);
      setError('');
    } catch (error) {
      console.error('Delete failed:', error);
      setError('Failed to delete conversation');
    } finally {
      setLoading(false);
    }
  };

  // small helper to cancel delete prompt
  const cancelDeletePrompt = () => {
    setShowDeleteConfirm(false);
  };

  const suggestedQuestions = [
    "What is your return policy?",
    "Do you ship internationally?",
    "What are your support hours?",
    "How can I track my order?",
    "Do you offer free shipping?",
  ];

  return (
    <div className="app">
      {/* Sidebar */}
      <div className={`sidebar ${sidebarOpen ? 'open' : ''}`}>
        <div className="sidebar-header">
          <h3>Conversations</h3>
          <button 
            className="new-chat-btn"
            onClick={createConversation}
          >
            <MessageSquare size={16} />
            New Chat
          </button>
        </div>
        
        <div className="conversations-list">
          {conversations.map((conv) => (
            <div
              key={conv.id}
              className={`conversation-item ${conv.id === conversationId ? 'active' : ''}`}
              onClick={() => { setActiveConversation(conv.id); setSidebarOpen(false); }}
            >
              <ShoppingBag size={16} />
              <span className="conversation-preview">
                {conv.id.substring(0, 8)}...
              </span>
            </div>
          ))}
          
          {conversations.length === 0 && (
            <div className="empty-conversations">
              <p>No conversations yet</p>
              <p className="hint">Start chatting to see them here</p>
            </div>
          )}
        </div>
      </div>

      {/* Main Chat Area */}
      <div className="main-content">
        {/* Header */}
        <header className="header">
          <button 
            className="menu-btn"
            onClick={() => setSidebarOpen(!sidebarOpen)}
          >
            <div className="menu-icon"></div>
            <div className="menu-icon"></div>
            <div className="menu-icon"></div>
          </button>
          
          <div className="header-content">
            <div className="store-info">
              <ShoppingBag size={24} />
              <div>
                <h1>QuickShop Support</h1>
                <p>AI-powered customer support agent</p>
              </div>
            </div>
            
            <div className="header-actions">
              <button 
                className="export-chat-btn"
                onClick={() => exportConversation()}
                disabled={!conversationId || loading}
                title="Export conversation"
              >
                <Download size={16} />
                Export
              </button>

              <button 
                className="clear-chat-btn"
                onClick={clearChat}
                disabled={loading}
              >
                <RefreshCw size={18} />
                New Chat
              </button>

              <div className="delete-wrapper">
                <button
                  className="delete-chat-btn"
                  onClick={() => promptDeleteConversation()}
                  disabled={!conversationId || loading}
                  title="Delete conversation"
                  aria-haspopup="dialog"
                >
                  <Trash size={16} />
                  Delete
                </button>

                {showDeleteConfirm && (
                  <div className="confirm-popover" role="dialog" aria-modal="true">
                    <p className="confirm-text">Delete this conversation? This action cannot be undone.</p>
                    <div className="confirm-actions">
                      <button className="btn btn-cancel" onClick={cancelDeletePrompt}>Cancel</button>
                      <button className="btn btn-confirm" onClick={confirmDeleteConversation} disabled={loading}>Delete</button>
                    </div>
                  </div>
                )}
              </div>
            </div>
          </div>
        </header>

        {/* Error Display */}
        {error && (
          <div className="error-banner">
            <p>{error}</p>
            <button onClick={() => setError('')}>×</button>
          </div>
        )}

        {/* Chat Messages */}
        <div className="messages-container" id="messages-container">
          {messages.length === 0 ? (
            <div className="welcome-screen">
              <div className="welcome-header">
                <Bot size={64} className="welcome-icon" />
                <h2>Hello! I'm your QuickShop Assistant</h2>
                <p>I can help you with returns, shipping, store policies, and more.</p>
              </div>
              
              <div className="suggested-questions">
                <p className="suggested-title">Try asking me:</p>
                <div className="questions-grid">
                  {suggestedQuestions.map((question, index) => (
                    <button
                      key={index}
                      className="suggestion-btn"
                      onClick={() => {
                        setInput(question);
                        setTimeout(() => {
                          if (inputRef.current) {
                            inputRef.current.focus();
                          }
                        }, 100);
                      }}
                      disabled={loading}
                    >
                      {question}
                    </button>
                  ))}
                </div>
              </div>
              
              <div className="quick-info">
                <div className="info-card">
                  <h4>📦 Shipping</h4>
                  <p>Free on orders over $50</p>
                  <p>5-7 business days standard</p>
                </div>
                <div className="info-card">
                  <h4>↩️ Returns</h4>
                  <p>30-day return policy</p>
                  <p>Original condition required</p>
                </div>
                <div className="info-card">
                  <h4>🕐 Support</h4>
                  <p>Mon-Fri: 9AM-6PM EST</p>
                  <p>support@quickshop.com</p>
                </div>
              </div>
            </div>
          ) : (
            messages.map((msg) => (
              <div
                key={msg.id}
                className={`message ${msg.sender === 'user' ? 'user-message' : 'ai-message'}`}
              >
                <div className="message-header">
                  <div className="message-sender">
                    {msg.sender === 'user' ? (
                      <>
                        <User size={16} />
                        <span>You</span>
                      </>
                    ) : (
                      <>
                        <Bot size={16} />
                        <span>Assistant</span>
                      </>
                    )}
                  </div>
                  <div className="message-time">
                    {formatTime(msg.timestamp)}
                  </div>
                </div>
                
                <div className="message-content">
                  <div className="message-text">
                    {msg.text.split('\n').map((line, i) => (
                      <p key={i}>{line}</p>
                    ))}
                  </div>
                  
                  {msg.sender === 'ai' && msg.modelUsed && (
                    <div className="model-info">
                      <span className="model-badge">{msg.modelUsed}</span>
                    </div>
                  )}
                </div>
              </div>
            ))
          )}

          {loading && (
            <div className="message ai-message">
              <div className="message-header">
                <div className="message-sender">
                  <Bot size={16} />
                  <span>Assistant</span>
                </div>
              </div>
              <div className="message-content">
                <div className="typing-indicator">
                  <div className="typing-dots">
                    <span></span>
                    <span></span>
                    <span></span>
                  </div>
                  <p className="typing-text">Thinking...</p>
                </div>
              </div>
            </div>
          )}

          <div ref={messagesEndRef} />
        </div>

        {/* Input Area */}
        <div className="input-area">
          <div className="input-wrapper">
            <textarea
              ref={inputRef}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyPress={handleKeyPress}
              placeholder="Type your message here..."
              disabled={loading}
              maxLength={1000}
              rows={1}
              className="message-input"
            />
            
            <div className="input-controls">
              <div className="char-count">
                {input.length}/1000
              </div>
              
              <button
                onClick={sendMessage}
                disabled={loading || !input.trim()}
                className="send-button"
                aria-label="Send message"
              >
                {loading ? (
                  <div className="spinner"></div>
                ) : (
                  <Send size={20} />
                )}
              </button>
            </div>
          </div>
          
          <div className="input-hints">
            <p>💡 Press <kbd>Enter</kbd> to send • <kbd>Shift</kbd> + <kbd>Enter</kbd> for new line</p>
            {conversationId && (
              <p className="conversation-id">
                Conversation: {conversationId.substring(0, 12)}...
              </p>
            )}
          </div>
        </div>
      </div>

      {/* Mobile Sidebar Overlay */}
      {sidebarOpen && (
        <div 
          className="sidebar-overlay"
          onClick={() => setSidebarOpen(false)}
        />
      )}
    </div>
  );
}

export default App;